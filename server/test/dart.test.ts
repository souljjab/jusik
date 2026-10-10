import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { classifyDisclosure, type PeriodFinancials } from "@jusik/shared";
import { describe, expect, it } from "vitest";
import {
  attachFiledDates, checkDartStatus, DART, DART_PARAMS, DartClient, DartError, dartReportKind, parseCorpCodeXml, parseDartList, parseDartXmlStatus,
  parseSingleAcnt, periodicReports, SampleDart,
} from "../src/dart";
import { createHttp, HttpError, type Http } from "../src/http";
import { crc32 } from "../src/zip";
import { tmp } from "./helpers";

/*
 * 아래 JSON·XML은 OpenDART 개발 가이드에 적힌 응답 형식을 흉내 낸 가짜 샘플이다(회사·숫자 모두 지어낸 값).
 * 외부 접속이 막힌 환경이라 실제 응답과 대조하지 못했다(미검증).
 */

const res = (status: number, body: string | Uint8Array) => new Response(body as BodyInit, { status });
const noSleep = async () => {};

// ───────────────────────── http.getBytes ─────────────────────────

describe("createHttp().getBytes", () => {
  it("returns the raw body bytes", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80]);
    const http = createHttp({ minIntervalMs: 0, fetchImpl: async () => res(200, bytes) });
    expect(Array.from(await http.getBytes!("https://x.test/z"))).toEqual(Array.from(bytes));
  });

  it("retries 429/5xx with the same backoff as get() and throws HttpError for 4xx", async () => {
    let n = 0;
    const sleeps: number[] = [];
    const http = createHttp({ minIntervalMs: 0, retries: 2, sleep: async (ms) => void sleeps.push(ms), fetchImpl: async () => (++n < 3 ? res(503, "busy") : res(200, new Uint8Array([1, 2]))) });
    expect(Array.from(await http.getBytes!("https://x.test/a"))).toEqual([1, 2]);
    expect(n).toBe(3);
    expect(sleeps.filter((s) => s >= 1000)).toEqual([1000, 2000]);

    let m = 0;
    const bad = createHttp({ minIntervalMs: 0, sleep: noSleep, fetchImpl: async () => (m++, res(404, "nope")) });
    await expect(bad.getBytes!("https://x.test/b")).rejects.toBeInstanceOf(HttpError);
    expect(m).toBe(1);
  });

  it("shares the serial queue and minimum interval with get()", async () => {
    let active = 0, maxActive = 0;
    const order: string[] = [];
    const waits: number[] = [];
    const http = createHttp({
      minIntervalMs: 200, sleep: async (ms) => void waits.push(ms),
      fetchImpl: async (u) => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(String(u));
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return res(200, "x");
      },
    });
    await Promise.all([http.get("https://x.test/1"), http.getBytes!("https://x.test/2"), http.get("https://x.test/3")]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(["https://x.test/1", "https://x.test/2", "https://x.test/3"]);
    expect(waits.filter((w) => w > 0).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps working after a failed bytes request", async () => {
    let n = 0;
    const http = createHttp({ minIntervalMs: 0, fetchImpl: async () => (n++ === 0 ? Promise.reject(new Error("down")) : res(200, "ok")) });
    await expect(http.getBytes!("https://x.test/a")).rejects.toThrow(/접속 실패/);
    expect(await http.get("https://x.test/b")).toBe("ok");
  });
});

// ───────────────────────── 고정 샘플 ─────────────────────────

const CORP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<result>
    <list>
        <corp_code>00999001</corp_code>
        <corp_name>샘플전자</corp_name>
        <corp_eng_name>SAMPLE ELECTRONICS</corp_eng_name>
        <stock_code>999990</stock_code>
        <modify_date>20240102</modify_date>
    </list>
    <list>
        <corp_code>00999002</corp_code>
        <corp_name>비상장샘플</corp_name>
        <stock_code> </stock_code>
        <modify_date>20230101</modify_date>
    </list>
    <list>
        <corp_code>00999003</corp_code>
        <corp_name>에이&amp;비 &#54637;업</corp_name>
        <stock_code>999980</stock_code>
        <modify_date>20220101</modify_date>
    </list>
    <list>
        <corp_code>00999004</corp_code>
        <corp_name>옛이름</corp_name>
        <stock_code>999980</stock_code>
        <modify_date>20210101</modify_date>
    </list>
    <list>
        <corp_code>00999005</corp_code>
        <corp_name>빈코드</corp_name>
        <stock_code/>
        <modify_date>20240101</modify_date>
    </list>
    <list>
        <corp_code>123</corp_code>
        <corp_name>깨진번호</corp_name>
        <stock_code>999970</stock_code>
    </list>
</result>`;

const ERROR_XML = `<?xml version="1.0" encoding="UTF-8"?><result><status>010</status><message>등록되지 않은 키입니다.</message></result>`;

const listJson = (rows: Record<string, string>[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ status: "000", message: "정상", page_no: 1, page_count: 100, total_count: rows.length, total_page: 1, list: rows, ...extra });

const row = (rcept_no: string, report_nm: string, rm = "") => ({
  corp_code: "00999001", corp_name: "샘플전자", stock_code: "999990", corp_cls: "Y", report_nm, rcept_no, flr_nm: "샘플전자", rcept_dt: rcept_no.slice(0, 8), rm,
});

const LIST = listJson([
  row("20240314800123", "단일판매ㆍ공급계약체결", "유"),
  row("20240315000456", "주요사항보고서(유상증자결정)  "),
  row("20240312000789", "사업보고서 (2023.12)", "연"),
  row("20240315000999", "[기재정정]주요사항보고서(유상증자결정)", "유"),
  row("20240313000111", "주요사항보고서(전환사채권발행결정)", "철"),
]);

type Amounts = [string | undefined, string | undefined, string | undefined];
const acnt = (fs: "CFS" | "OFS", name: string, [a, b, c]: Amounts, o: Partial<Record<string, string>> = {}) => ({
  rcept_no: "20240312000789", bsns_year: "2023", corp_code: "00999001", stock_code: "999990", reprt_code: "11011", account_nm: name,
  fs_div: fs, fs_nm: fs === "CFS" ? "연결재무제표" : "재무제표", sj_div: "IS", sj_nm: "손익계산서",
  thstrm_nm: "제 55 기", thstrm_dt: "2023.01.01 ~ 2023.12.31", thstrm_amount: a,
  frmtrm_nm: "제 54 기", frmtrm_dt: "2022.01.01 ~ 2022.12.31", frmtrm_amount: b,
  bfefrmtrm_nm: "제 53 기", bfefrmtrm_dt: "2021.01.01 ~ 2021.12.31", bfefrmtrm_amount: c,
  ord: "1", currency: "KRW", ...o,
});
const acntJson = (rows: object[]) => JSON.stringify({ status: "000", message: "정상", list: rows });

const ACNT = acntJson([
  acnt("CFS", "자산총계", ["900,000,000,000", "800,000,000,000", "700,000,000,000"], { sj_div: "BS", sj_nm: "재무상태표", thstrm_dt: "2023.12.31 현재" }),
  acnt("CFS", "매출액", ["258,935,494,000,000", "302,231,360,000,000", "279,604,799,000,000"]),
  acnt("CFS", "영업이익", ["6,566,976,000,000", "43,376,630,000,000", "51,633,856,000,000"]),
  acnt("CFS", "법인세차감전 순이익", ["11,006,000,000,000", "46,440,000,000,000", "53,351,000,000,000"]),
  acnt("CFS", "당기순이익(손실)", ["15,487,100,000,000", "55,654,077,000,000", "39,907,450,000,000"]),
  acnt("OFS", "매출액", ["170,374,090,000,000", "211,867,483,000,000", "199,744,705,000,000"]),
  acnt("OFS", "영업이익", ["-11,526,297,000,000", "25,319,329,000,000", "31,993,162,000,000"]),
  acnt("OFS", "당기순이익", ["25,397,099,000,000", "25,418,778,000,000", "30,970,954,000,000"]),
]);

// ───────────────────────── 파서 ─────────────────────────

describe("DART URL builders", () => {
  it("builds corpCode, list and single-account URLs with encoded params", () => {
    expect(DART.corpCode("k&y")).toBe("https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=k%26y");
    expect(DART.list("KEY", { corpCode: "00126380", bgnDe: "20240101", endDe: "20240331" })).toBe(
      "https://opendart.fss.or.kr/api/list.json?crtfc_key=KEY&corp_code=00126380&bgn_de=20240101&end_de=20240331&page_no=1&page_count=100",
    );
    expect(DART.list("KEY", { corpCode: "00126380", bgnDe: "20240101", endDe: "20240331", pageNo: 3 })).toContain("page_no=3&page_count=100");
    expect(DART.singleAcnt("KEY", { corpCode: "00126380", year: 2023 })).toBe(
      "https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=KEY&corp_code=00126380&bsns_year=2023&reprt_code=11011",
    );
    expect(DART.viewer("20240312000789")).toBe("https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20240312000789");
  });
});

describe("status handling", () => {
  it("maps 000/013 and throws DartError with Korean messages for the rest", () => {
    expect(checkDartStatus({ status: "000" })).toBe("ok");
    expect(checkDartStatus({ status: "013", message: "조회된 데이타가 없습니다." })).toBe("empty");
    expect(checkDartStatus({ list: [] })).toBe("unknown");
    const cases: [string, RegExp][] = [
      ["010", /등록되지 않은 키/], ["011", /사용할 수 없는 키/], ["012", /접근할 수 없는 IP/], ["020", /요청 제한/],
      ["100", /필드 값/], ["800", /시스템 점검/], ["900", /정의되지 않은 오류/],
    ];
    for (const [s, re] of cases) {
      let err: unknown;
      try {
        checkDartStatus({ status: s, message: "원문" });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(DartError);
      expect((err as DartError).status).toBe(s);
      expect((err as DartError).message).toMatch(re);
    }
    expect(() => checkDartStatus({ status: "999", message: "새 오류" })).toThrow("DART 999: 새 오류");
    expect(() => checkDartStatus({ status: "998" })).toThrow(/알 수 없는 오류/);
  });

  it("reads XML error bodies", () => {
    expect(parseDartXmlStatus(ERROR_XML)).toEqual({ status: "010", message: "등록되지 않은 키입니다." });
    expect(parseDartXmlStatus(CORP_XML)).toBeNull();
    expect(parseDartXmlStatus("")).toBeNull();
  });
});

describe("parseCorpCodeXml", () => {
  it("keeps only 6-digit stock codes and decodes entities", () => {
    const m = parseCorpCodeXml(CORP_XML);
    expect([...m.keys()].sort()).toEqual(["999980", "999990"]);
    expect(m.get("999990")).toEqual({ corpCode: "00999001", name: "샘플전자" });
    // 같은 종목 코드면 modify_date가 최신인 쪽
    expect(m.get("999980")).toEqual({ corpCode: "00999003", name: "에이&비 항업" });
  });

  it("returns an empty map for error bodies or unknown formats", () => {
    expect(parseCorpCodeXml(ERROR_XML).size).toBe(0);
    expect(parseCorpCodeXml("<html>점검 중</html>").size).toBe(0);
    expect(parseCorpCodeXml("").size).toBe(0);
  });
});

describe("parseDartList", () => {
  it("converts list rows to disclosures, newest first", () => {
    const list = parseDartList(LIST);
    expect(list.map((d) => [d.date, d.title])).toEqual([
      ["2024-03-15", "[기재정정]주요사항보고서(유상증자결정)"],
      ["2024-03-15", "주요사항보고서(유상증자결정)"],
      ["2024-03-14", "단일판매ㆍ공급계약체결"],
      ["2024-03-13", "주요사항보고서(전환사채권발행결정) (철회)"],
      ["2024-03-12", "사업보고서 (2023.12)"],
    ]);
    expect(list[1]).toEqual({
      date: "2024-03-15", title: "주요사항보고서(유상증자결정)", url: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20240315000456", source: "DART", form: "주요사항보고서",
    });
    expect(list[2]!.form).toBe("거래소공시");
    expect(list[4]!.form).toBe("사업보고서");
    expect(list.every((d) => d.source === "DART")).toBe(true);
  });

  it("feeds classifyDisclosure: DART names classify like Naver titles, withdrawn reports become undo", () => {
    const list = parseDartList(LIST);
    expect(classifyDisclosure(list[1]!.title)).toEqual({ type: "유상증자", tone: "bad" });
    expect(classifyDisclosure(list[0]!.title)).toEqual({ type: "유상증자", tone: "bad" });
    expect(classifyDisclosure(list[2]!.title)).toEqual({ type: "공급계약", tone: "good" });
    expect(classifyDisclosure(list[3]!.title)).toEqual({ type: "전환사채", tone: "info" });
  });

  it("accepts a parsed object, returns [] for 013 and unknown shapes, and throws for error statuses", () => {
    expect(parseDartList(JSON.parse(LIST))).toHaveLength(5);
    expect(parseDartList({ status: "013", message: "조회된 데이타가 없습니다." })).toEqual([]);
    expect(parseDartList("<html>error</html>")).toEqual([]);
    expect(parseDartList("{ broken")).toEqual([]);
    expect(parseDartList({ status: "000" })).toEqual([]);
    expect(parseDartList(null)).toEqual([]);
    expect(() => parseDartList({ status: "020", message: "사용한도를 초과하였습니다." })).toThrow(DartError);
    expect(() => parseDartList('{"status":"012","message":"접근할 수 없는 IP입니다."}')).toThrow(/접근할 수 없는 IP/);
  });

  it("skips malformed rows and omits the link when the receipt number is odd", () => {
    const list = parseDartList(listJson([
      { ...row("20240314000001", "무상증자결정"), rcept_dt: "2024-03-14" },
      { ...row("20240314000002", "  ") },
      { ...row("20240231000003", "현금ㆍ현물배당결정") }, // 없는 날짜
      { ...row("X", "주식소각결정"), rcept_dt: "20240310" },
    ]));
    expect(list).toEqual([{ date: "2024-03-10", title: "주식소각결정", source: "DART" }]);
  });
});

describe("dartReportKind", () => {
  it("infers the report kind from the name and remark", () => {
    expect(dartReportKind("[기재정정]반기보고서 (2024.06)")).toBe("반기보고서");
    expect(dartReportKind("분기보고서 (2024.03)")).toBe("분기보고서");
    expect(dartReportKind("주식등의대량보유상황보고서(일반)")).toBe("대량보유상황보고서");
    expect(dartReportKind("임원ㆍ주요주주특정증권등소유상황보고서")).toBe("소유상황보고서");
    expect(dartReportKind("[발행조건확정]증권신고서(지분증권)")).toBe("증권신고서");
    expect(dartReportKind("감사보고서제출", "유")).toBe("감사보고서");
    expect(dartReportKind("기업설명회(IR)개최(안내공시)", "코")).toBe("거래소공시");
    expect(dartReportKind("대규모기업집단현황공시", "공")).toBe("공정위공시");
    expect(dartReportKind("해외증권거래소등에신고한사업보고서등의국내신고")).toBeUndefined();
    expect(dartReportKind("기타")).toBeUndefined();
  });
});

describe("parseSingleAcnt", () => {
  it("prefers consolidated (CFS) statements and converts won to 억 원 for three years", () => {
    expect(parseSingleAcnt(ACNT)).toEqual<PeriodFinancials[]>([
      { period: "2021.12", estimate: false, revenue: 2_796_047.99, opIncome: 516_338.56, netIncome: 399_074.5 },
      { period: "2022.12", estimate: false, revenue: 3_022_313.6, opIncome: 433_766.3, netIncome: 556_540.77 },
      { period: "2023.12", filed: "2024-03-12", estimate: false, revenue: 2_589_354.94, opIncome: 65_669.76, netIncome: 154_871 },
    ]);
  });

  it("falls back to separate statements (OFS) and keeps negative amounts", () => {
    const ofsOnly = acntJson(JSON.parse(ACNT).list.filter((r: { fs_div: string }) => r.fs_div === "OFS"));
    const r = parseSingleAcnt(ofsOnly);
    expect(r.at(-1)).toEqual({ period: "2023.12", filed: "2024-03-12", estimate: false, revenue: 1_703_740.9, opIncome: -115_262.97, netIncome: 253_970.99 });
    expect(r).toHaveLength(3);
  });

  it("reads account-name variants, missing values and parenthesized negatives", () => {
    const r = parseSingleAcnt(acntJson([
      acnt("OFS", "수익(매출액)", ["1,000,000,000", "900,000,000", "-"]),
      acnt("OFS", "영업이익(손실)", ["(300,000,000)", "", undefined]),
      acnt("OFS", "당기순이익(손실)", ["-150,000,000", "50,000,000", "-"]),
    ]));
    expect(r).toEqual([
      { period: "2022.12", estimate: false, revenue: 9, netIncome: 0.5 },
      { period: "2023.12", filed: "2024-03-12", estimate: false, revenue: 10, opIncome: -3, netIncome: -1.5 },
    ]);
  });

  it("uses the fiscal month from the period dates (non-December year end)", () => {
    const march = (name: string, v: Amounts) =>
      acnt("CFS", name, v, { thstrm_dt: "2023.04.01 ~ 2024.03.31", frmtrm_dt: "2022.04.01 ~ 2023.03.31", bfefrmtrm_dt: "2021.04.01 ~ 2022.03.31", rcept_no: "20240620000001" });
    const r = parseSingleAcnt(acntJson([march("매출액", ["300,000,000", "200,000,000", "100,000,000"])]));
    expect(r.map((p) => [p.period, p.revenue, p.filed])).toEqual([["2022.03", 1, undefined], ["2023.03", 2, undefined], ["2024.03", 3, "2024-06-20"]]);
  });

  it("falls back to bsns_year (and month 12) when the period dates are missing", () => {
    const r = parseSingleAcnt(acntJson([acnt("CFS", "매출액", ["300,000,000", "200,000,000", "100,000,000"], { thstrm_dt: "", frmtrm_dt: "", bfefrmtrm_dt: "" })]));
    expect(r.map((p) => p.period)).toEqual(["2021.12", "2022.12", "2023.12"]);
  });

  it("ignores balance-sheet rows and pre-tax income", () => {
    const r = parseSingleAcnt(acntJson([
      acnt("CFS", "법인세차감전 순이익", ["999,900,000,000", "1", "1"]),
      acnt("CFS", "당기순이익", ["100,000,000", "100,000,000", "100,000,000"], { sj_div: "BS" }),
      acnt("CFS", "영업이익", ["200,000,000", "200,000,000", "200,000,000"]),
    ]));
    expect(r.at(-1)).toEqual({ period: "2023.12", filed: "2024-03-12", estimate: false, opIncome: 2 });
  });

  it("returns [] rather than wrong values for non-annual reports, foreign currency, 013 or unknown shapes", () => {
    expect(parseSingleAcnt(acntJson([acnt("CFS", "매출액", ["1", "1", "1"], { reprt_code: "11013" })]))).toEqual([]);
    expect(parseSingleAcnt(acntJson([acnt("CFS", "매출액", ["1", "1", "1"], { currency: "USD" })]))).toEqual([]);
    expect(parseSingleAcnt(acntJson([acnt("CFS", "자산총계", ["1", "1", "1"], { sj_div: "BS" })]))).toEqual([]);
    expect(parseSingleAcnt({ status: "013", message: "조회된 데이타가 없습니다." })).toEqual([]);
    expect(parseSingleAcnt("not json")).toEqual([]);
    expect(parseSingleAcnt({ list: [] })).toEqual([]);
    // 기간 라벨이 겹치면 버린다
    expect(parseSingleAcnt(acntJson([acnt("CFS", "매출액", ["1", "2", "3"], { frmtrm_dt: "2023.01.01 ~ 2023.12.31" })]))).toEqual([]);
    expect(() => parseSingleAcnt({ status: "011", message: "사용할 수 없는 키입니다." })).toThrow(/사용할 수 없는 키/);
  });
});

describe("periodicReports / attachFiledDates", () => {
  const d = (date: string, title: string) => ({ date, title, source: "DART" as const });

  it("extracts periodic reports with deadlines, preferring the original filing", () => {
    const r = periodicReports([
      d("2024-05-14", "분기보고서 (2024.03)"),
      d("2024-04-20", "[기재정정]사업보고서 (2023.12)"),
      d("2024-03-12", "사업보고서 (2023.12)"),
      d("2023-08-14", "반기보고서 (2023.06)"),
      d("2023-11-20", "[기재정정]분기보고서 (2023.09)"), // 원본이 목록에 없다
      d("2024-03-15", "주요사항보고서(유상증자결정)"),
      d("2024-03-15", "해외증권거래소등에신고한사업보고서등의국내신고"),
      d("2024-03-15", "사업보고서 (2022.12) (철회)"),
    ]);
    expect(r).toEqual([
      { period: "2023.06", kind: "반기보고서", filed: "2023-08-14", deadline: "2023-08-14", late: false },
      { period: "2023.09", kind: "분기보고서", filed: "2023-11-20", deadline: "2023-11-14", late: true, amended: true },
      { period: "2023.12", kind: "사업보고서", filed: "2024-03-12", deadline: "2024-04-01", late: false },
      { period: "2024.03", kind: "분기보고서", filed: "2024-05-14", deadline: "2024-05-15", late: false },
    ]);
  });

  it("uses book deadlines: 45 days for quarterly/half-year, 90 days for annual (weekends roll to Monday)", () => {
    expect(DART_PARAMS.reportDeadlineDays).toEqual({ 사업보고서: 90, 반기보고서: 45, 분기보고서: 45 });
    // 2022.12 + 90일 = 2023-03-31(금)
    expect(periodicReports([d("2023-04-03", "사업보고서 (2022.12)")])[0]).toMatchObject({ deadline: "2023-03-31", late: true });
  });

  it("fills missing filed dates from annual reports only", () => {
    const reports = periodicReports([d("2023-03-14", "사업보고서 (2022.12)"), d("2023-05-15", "분기보고서 (2023.03)")]);
    const periods: PeriodFinancials[] = [
      { period: "2022.12", estimate: false, revenue: 1 },
      { period: "2023.03", estimate: false, revenue: 2 },
      { period: "2023.12", filed: "2024-03-12", estimate: false, revenue: 3 },
    ];
    const out = attachFiledDates(periods, reports);
    expect(out.map((p) => p.filed)).toEqual(["2023-03-14", undefined, "2024-03-12"]);
    expect(periods[0]!.filed).toBeUndefined(); // 원본은 그대로
  });
});

// ───────────────────────── 클라이언트 ─────────────────────────

/** 단일 항목 ZIP(deflate) */
function zipOne(name: string, text: string): Uint8Array {
  const data = Buffer.from(text, "utf8");
  const comp = deflateRawSync(data);
  const nm = Buffer.from(name);
  const h = (n: number, size: 2 | 4) => {
    const b = Buffer.alloc(size);
    if (size === 2) b.writeUInt16LE(n);
    else b.writeUInt32LE(n >>> 0);
    return b;
  };
  const crc = crc32(data);
  const local = Buffer.concat([h(0x04034b50, 4), h(20, 2), h(0, 2), h(8, 2), h(0, 2), h(0, 2), h(crc, 4), h(comp.length, 4), h(data.length, 4), h(nm.length, 2), h(0, 2), nm, comp]);
  const cen = Buffer.concat([
    h(0x02014b50, 4), h(20, 2), h(20, 2), h(0, 2), h(8, 2), h(0, 2), h(0, 2), h(crc, 4), h(comp.length, 4), h(data.length, 4),
    h(nm.length, 2), h(0, 2), h(0, 2), h(0, 2), h(0, 2), h(0, 4), h(0, 4), nm,
  ]);
  const end = Buffer.concat([h(0x06054b50, 4), h(0, 2), h(0, 2), h(1, 2), h(1, 2), h(cen.length, 4), h(local.length, 4), h(0, 2)]);
  return new Uint8Array(Buffer.concat([local, cen, end]));
}

type Route = string | ((p: URLSearchParams) => string);
interface FakeOpts {
  corp?: () => Uint8Array | Promise<Uint8Array>;
  list?: Route;
  acnt?: Route;
  noBytes?: boolean;
}

function fakeDart(o: FakeOpts): Http & { calls: string[] } {
  const calls: string[] = [];
  const text = (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const r = u.pathname.endsWith("/list.json") ? o.list : u.pathname.endsWith("/fnlttSinglAcnt.json") ? o.acnt : undefined;
    if (r == null) return { status: 404, headers: new Headers(), text: "" };
    return { status: 200, headers: new Headers(), text: typeof r === "string" ? r : r(u.searchParams) };
  };
  const http: Http & { calls: string[] } = {
    calls,
    async getResponse(url) {
      return text(url);
    },
    async get(url) {
      const r = text(url);
      if (r.status !== 200) throw new HttpError(r.status, url);
      return r.text;
    },
  };
  if (!o.noBytes) {
    http.getBytes = async (url) => {
      calls.push(url);
      if (!o.corp) throw new HttpError(404, url);
      return o.corp();
    };
  }
  return http;
}

const CORP_ZIP = zipOne("CORPCODE.xml", CORP_XML);
const corpCalls = (h: { calls: string[] }) => h.calls.filter((c) => c.includes("corpCode.xml")).length;

describe("DartClient corp codes", () => {
  it("rejects an empty key", () => {
    expect(() => new DartClient(fakeDart({}), "  ")).toThrow(/DART_API_KEY/);
  });

  it("downloads and unzips corpCode.xml once, even for concurrent lookups", async () => {
    const http = fakeDart({ corp: () => CORP_ZIP });
    const c = new DartClient(http, "KEY");
    const [a, b, none] = await Promise.all([c.corpCodeOf("999990"), c.corpCodeOf("999980"), c.corpCodeOf("999970")]);
    expect([a, b, none]).toEqual(["00999001", "00999003", null]);
    expect(await c.corpOf("999990")).toEqual({ corpCode: "00999001", name: "샘플전자" });
    expect(corpCalls(http)).toBe(1);
    expect(http.calls[0]).toBe("https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=KEY");
  });

  it("does not download for non-Korean codes", async () => {
    const http = fakeDart({ corp: () => CORP_ZIP });
    const c = new DartClient(http, "KEY");
    expect(await c.corpCodeOf("AAPL")).toBeNull();
    expect(await c.disclosures("AAPL")).toEqual([]);
    expect(await c.annual("AAPL")).toEqual([]);
    expect(http.calls).toEqual([]);
  });

  it("caches the list in a JSON file for 7 days", async () => {
    const file = join(tmp(), "nested", "dart-corp.json");
    let t = Date.parse("2024-03-18T00:00:00Z");
    const now = () => new Date(t);
    const h1 = fakeDart({ corp: () => CORP_ZIP });
    expect(await new DartClient(h1, "KEY", { cacheFile: file, now }).corpCodeOf("999990")).toBe("00999001");
    expect(existsSync(file)).toBe(true);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved).toMatchObject({ version: 1, savedAt: "2024-03-18T00:00:00.000Z", entries: { "999990": ["00999001", "샘플전자"] } });

    // 새 클라이언트(서버 재시작)는 파일을 쓴다
    t += 6 * 86_400_000;
    const h2 = fakeDart({ corp: () => CORP_ZIP });
    expect(await new DartClient(h2, "KEY", { cacheFile: file, now }).corpCodeOf("999980")).toBe("00999003");
    expect(corpCalls(h2)).toBe(0);

    // 7일이 지나면 다시 받는다
    t += 2 * 86_400_000;
    const h3 = fakeDart({ corp: () => CORP_ZIP });
    expect(await new DartClient(h3, "KEY", { cacheFile: file, now }).corpCodeOf("999980")).toBe("00999003");
    expect(corpCalls(h3)).toBe(1);
  });

  it("expires the in-memory list after ttlMs", async () => {
    let t = 0;
    const http = fakeDart({ corp: () => CORP_ZIP });
    const c = new DartClient(http, "KEY", { ttlMs: 1000, now: () => new Date(t) });
    await c.corpCodeOf("999990");
    t = 999;
    await c.corpCodeOf("999990");
    expect(corpCalls(http)).toBe(1);
    t = 1000;
    await c.corpCodeOf("999990");
    expect(corpCalls(http)).toBe(2);
  });

  it("ignores a corrupt cache file", async () => {
    const file = join(tmp(), "corp.json");
    writeFileSync(file, "{ not json");
    const http = fakeDart({ corp: () => CORP_ZIP });
    expect(await new DartClient(http, "KEY", { cacheFile: file }).corpCodeOf("999990")).toBe("00999001");
    expect(corpCalls(http)).toBe(1);
    writeFileSync(file, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), entries: { "999990": ["bad", "x"] } }));
    const h2 = fakeDart({ corp: () => CORP_ZIP });
    expect(await new DartClient(h2, "KEY", { cacheFile: file }).corpCodeOf("999990")).toBe("00999001");
    expect(corpCalls(h2)).toBe(1);
  });

  it("turns an XML/JSON error body into DartError and does not cache the failure", async () => {
    let body: Uint8Array = new TextEncoder().encode(ERROR_XML);
    const http = fakeDart({ corp: () => body });
    const c = new DartClient(http, "BAD");
    await expect(c.corpCodeOf("999990")).rejects.toThrow(/DART 010: 등록되지 않은 키/);
    body = new TextEncoder().encode('{"status":"020","message":"사용한도 초과"}');
    await expect(c.corpCodeOf("999990")).rejects.toThrow(/요청 제한/);
    body = new TextEncoder().encode("<html>점검</html>");
    await expect(c.corpCodeOf("999990")).rejects.toThrow(/ZIP이 아니에요/);
    body = zipOne("CORPCODE.xml", "<result></result>");
    await expect(c.corpCodeOf("999990")).rejects.toThrow(/상장 종목을 찾지 못했어요/);
    body = zipOne("readme.txt", "x");
    await expect(c.corpCodeOf("999990")).rejects.toThrow(/XML 파일이 없어요/);
    body = CORP_ZIP;
    expect(await c.corpCodeOf("999990")).toBe("00999001");
  });

  it("needs getBytes on the Http client", async () => {
    const c = new DartClient(fakeDart({ noBytes: true }), "KEY");
    await expect(c.corpCodeOf("999990")).rejects.toThrow(/getBytes/);
  });

  it("falls back to a stale list when the download fails, and retries later", async () => {
    const file = join(tmp(), "corp.json");
    let t = Date.parse("2024-03-01T00:00:00Z");
    const now = () => new Date(t);
    await new DartClient(fakeDart({ corp: () => CORP_ZIP }), "KEY", { cacheFile: file, now }).corpCodeOf("999990");
    t += 30 * 86_400_000;
    let fail = true;
    const http = fakeDart({ corp: () => (fail ? Promise.reject(new Error("접속 실패")) : CORP_ZIP) });
    const c = new DartClient(http, "KEY", { cacheFile: file, now });
    expect(await c.corpCodeOf("999990")).toBe("00999001");
    expect(corpCalls(http)).toBe(1);
    t += DART_PARAMS.staleRetryMs - 1;
    await c.corpCodeOf("999990");
    expect(corpCalls(http)).toBe(1);
    fail = false;
    t += 1;
    await c.corpCodeOf("999990");
    expect(corpCalls(http)).toBe(2);
  });

  it("re-downloads once a day when a code is missing (new listings)", async () => {
    let t = Date.parse("2024-03-01T00:00:00Z");
    let xml = CORP_XML;
    const http = fakeDart({ corp: () => zipOne("CORPCODE.xml", xml) });
    const c = new DartClient(http, "KEY", { now: () => new Date(t) });
    expect(await c.corpCodeOf("999960")).toBeNull();
    expect(corpCalls(http)).toBe(1); // 방금 받은 목록이라 다시 받지 않는다
    t += DART_PARAMS.missRefreshMs;
    xml = CORP_XML.replace("</result>", "<list><corp_code>00999006</corp_code><corp_name>신규상장</corp_name><stock_code>999960</stock_code></list></result>");
    expect(await c.corpCodeOf("999960")).toBe("00999006");
    expect(corpCalls(http)).toBe(2);
    expect(await c.corpCodeOf("999950")).toBeNull();
    t += 3_600_000;
    expect(await c.corpCodeOf("999940")).toBeNull();
    expect(corpCalls(http)).toBe(2); // 하루에 한 번까지만
  });
});

describe("DartClient.disclosures", () => {
  const NOW = new Date("2024-03-18T16:00:00Z"); // 한국 시간 3월 19일 01시

  it("queries the KST date window and returns newest-first disclosures", async () => {
    const http = fakeDart({ corp: () => CORP_ZIP, list: LIST });
    const c = new DartClient(http, "KEY", { now: () => NOW });
    const list = await c.disclosures("999990", 30);
    expect(list.map((d) => d.date)).toEqual(["2024-03-15", "2024-03-15", "2024-03-14", "2024-03-13", "2024-03-12"]);
    const listUrl = new URL(http.calls.find((u) => u.includes("list.json"))!);
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({
      crtfc_key: "KEY", corp_code: "00999001", bgn_de: "20240218", end_de: "20240319", page_no: "1", page_count: "100",
    });
    // 기본 90일
    await c.disclosures("999990");
    expect(http.calls.some((u) => u.includes("bgn_de=20231220"))).toBe(true);
  });

  it("follows total_page up to maxPages and drops duplicate receipt numbers", async () => {
    const pages = (p: URLSearchParams) => {
      const n = Number(p.get("page_no"));
      return listJson([row(`2024031${n}00000${n}`, `단일판매ㆍ공급계약체결`), row("20240310000000", "무상증자결정")], { page_no: n, total_page: 99 });
    };
    const http = fakeDart({ corp: () => CORP_ZIP, list: pages });
    const list = await new DartClient(http, "KEY", { now: () => NOW }).disclosures("999990");
    expect(http.calls.filter((u) => u.includes("list.json"))).toHaveLength(DART_PARAMS.maxPages);
    expect(list).toHaveLength(DART_PARAMS.maxPages + 1);
    expect(list.at(-1)!.title).toBe("무상증자결정");
  });

  it("caches results briefly and returns [] for no data (013) or unknown companies", async () => {
    let t = NOW.getTime();
    const http = fakeDart({ corp: () => CORP_ZIP, list: JSON.stringify({ status: "013", message: "조회된 데이타가 없습니다." }) });
    const c = new DartClient(http, "KEY", { now: () => new Date(t) });
    expect(await c.disclosures("999990")).toEqual([]);
    expect(await c.disclosures("999990")).toEqual([]);
    expect(http.calls.filter((u) => u.includes("list.json"))).toHaveLength(1);
    t += DART_PARAMS.listTtlMs;
    await c.disclosures("999990");
    expect(http.calls.filter((u) => u.includes("list.json"))).toHaveLength(2);
    expect(await c.disclosures("123456")).toEqual([]); // 고유번호 없음 → 목록 조회 안 함
    expect(http.calls.filter((u) => u.includes("list.json"))).toHaveLength(2);
  });

  it("propagates DART errors and format problems without caching them", async () => {
    let body = JSON.stringify({ status: "800", message: "시스템 점검" });
    const http = fakeDart({ corp: () => CORP_ZIP, list: () => body });
    const c = new DartClient(http, "KEY", { now: () => NOW });
    await expect(c.disclosures("999990")).rejects.toThrow(/시스템 점검 중/);
    body = "<html>gateway</html>";
    await expect(c.disclosures("999990")).rejects.toThrow(/해석하지 못했어요/);
    body = JSON.stringify({ message: "?" });
    await expect(c.disclosures("999990")).rejects.toThrow(/형식을 알아보지 못했어요/);
    body = LIST;
    expect(await c.disclosures("999990")).toHaveLength(5);
  });
});

describe("DartClient.annual", () => {
  it("reads last year's annual report (three years from one call)", async () => {
    const http = fakeDart({ corp: () => CORP_ZIP, acnt: ACNT });
    const c = new DartClient(http, "KEY", { now: () => new Date("2024-06-01T00:00:00Z") });
    const r = await c.annual("999990");
    expect(r.map((p) => p.period)).toEqual(["2021.12", "2022.12", "2023.12"]);
    expect(r.at(-1)!.filed).toBe("2024-03-12");
    const calls = http.calls.filter((u) => u.includes("fnlttSinglAcnt"));
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!).searchParams.get("bsns_year")).toBe("2023");
    expect(new URL(calls[0]!).searchParams.get("reprt_code")).toBe("11011");
  });

  /** y년 사업보고서(당기·전기·전전기). 매출 "2023,000,000,000"원 = 20,230억 원, 제출일 y+1년 3월 15일 */
  const byYear = (y: number) =>
    acntJson([
      acnt("CFS", "매출액", [`${y},000,000,000`, `${y - 1},000,000,000`, `${y - 2},000,000,000`], {
        bsns_year: String(y), rcept_no: `${y + 1}0315000001`,
        thstrm_dt: `${y}.01.01 ~ ${y}.12.31`, frmtrm_dt: `${y - 1}.01.01 ~ ${y - 1}.12.31`, bfefrmtrm_dt: `${y - 2}.01.01 ~ ${y - 2}.12.31`,
      }),
    ]);
  const NO_DATA = JSON.stringify({ status: "013", message: "조회된 데이타가 없습니다." });

  it("steps back a year when the latest annual report is not filed yet (013)", async () => {
    const http = fakeDart({ corp: () => CORP_ZIP, acnt: (p) => (p.get("bsns_year") === "2023" ? NO_DATA : byYear(Number(p.get("bsns_year")))) });
    const r = await new DartClient(http, "KEY", { now: () => new Date("2024-02-01T00:00:00Z") }).annual("999990");
    expect(http.calls.filter((u) => u.includes("fnlttSinglAcnt")).map((u) => new URL(u).searchParams.get("bsns_year"))).toEqual(["2023", "2022"]);
    expect(r.map((p) => [p.period, p.filed])).toEqual([["2020.12", undefined], ["2021.12", undefined], ["2022.12", "2023-03-15"]]);
  });

  it("returns [] when no annual report exists in the last two years", async () => {
    const http = fakeDart({ corp: () => CORP_ZIP, acnt: NO_DATA });
    expect(await new DartClient(http, "KEY", { now: () => new Date("2024-02-01T00:00:00Z") }).annual("999990")).toEqual([]);
    expect(http.calls.filter((u) => u.includes("fnlttSinglAcnt"))).toHaveLength(2);
  });

  it("goes back three years per call for longer histories and stops when data runs out", async () => {
    const http = fakeDart({ corp: () => CORP_ZIP, acnt: (p) => (Number(p.get("bsns_year")) >= 2018 ? byYear(Number(p.get("bsns_year"))) : JSON.stringify({ status: "013" })) });
    const c = new DartClient(http, "KEY", { now: () => new Date("2024-06-01T00:00:00Z") });
    const r = await c.annual("999990", 5);
    expect(r.map((p) => [p.period, p.revenue, p.filed])).toEqual([
      ["2019.12", 20_190, undefined], ["2020.12", 20_200, "2021-03-15"], ["2021.12", 20_210, undefined], ["2022.12", 20_220, undefined], ["2023.12", 20_230, "2024-03-15"],
    ]);
    const years = http.calls.filter((u) => u.includes("fnlttSinglAcnt")).map((u) => new URL(u).searchParams.get("bsns_year"));
    expect(years).toEqual(["2023", "2020"]);
    // 캐시: 같은 요청은 다시 보내지 않는다
    await c.annual("999990", 5);
    expect(http.calls.filter((u) => u.includes("fnlttSinglAcnt"))).toHaveLength(2);

    const h2 = fakeDart({ corp: () => CORP_ZIP, acnt: (p) => (Number(p.get("bsns_year")) >= 2022 ? byYear(Number(p.get("bsns_year"))) : JSON.stringify({ status: "013" })) });
    const r2 = await new DartClient(h2, "KEY", { now: () => new Date("2024-06-01T00:00:00Z") }).annual("999990", 9);
    expect(r2.map((p) => p.period)).toEqual(["2021.12", "2022.12", "2023.12"]);
    expect(h2.calls.filter((u) => u.includes("fnlttSinglAcnt")).map((u) => new URL(u).searchParams.get("bsns_year"))).toEqual(["2023", "2020"]);
  });

  it("propagates key errors", async () => {
    const http = fakeDart({ corp: () => CORP_ZIP, acnt: JSON.stringify({ status: "012", message: "접근할 수 없는 IP입니다." }) });
    await expect(new DartClient(http, "KEY").annual("999990")).rejects.toThrow(/접근할 수 없는 IP/);
  });
});

// ───────────────────────── 샘플 ─────────────────────────

describe("SampleDart (PROVIDER=mock)", () => {
  const NOW = new Date("2024-03-18T03:00:00Z");

  it("is labeled sample and deterministic per code", async () => {
    const s = new SampleDart(() => NOW);
    expect(s.sample).toBe(true);
    expect(await s.disclosures("005930")).toEqual(await new SampleDart(() => NOW).disclosures("005930"));
    expect(await s.annual("005930")).toEqual(await new SampleDart(() => NOW).annual("005930"));
    expect(await s.corpCodeOf("005930")).toMatch(/^\d{8}$/);
    expect(await s.corpCodeOf("005930")).toBe(await s.corpCodeOf("005930"));
    expect(await s.disclosures("005930")).not.toEqual(await s.disclosures("000660"));
    expect(await s.corpCodeOf("AAPL")).toBeNull();
    expect(await s.disclosures("AAPL")).toEqual([]);
    expect(await s.annual("AAPL")).toEqual([]);
  });

  it("keeps disclosures inside the window, newest first, DART-shaped and without fake links", async () => {
    const s = new SampleDart(() => NOW);
    for (const code of ["005930", "000660", "035420", "123456"]) {
      const list = await s.disclosures(code, 60);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((d) => d.date >= "2024-01-18" && d.date <= "2024-03-18")).toBe(true);
      expect(list.every((d) => d.source === "DART" && d.url === undefined)).toBe(true);
      expect([...list].sort((a, b) => b.date.localeCompare(a.date))).toEqual(list);
    }
    // 90일 창이면 2023.12 사업보고서는 아직(3월 말 근처 제출)일 수 있지만 2023.09 분기보고서는 들어 있다
    const r = periodicReports(await s.disclosures("005930", 150));
    expect(r.some((x) => x.period === "2023.09" && x.kind === "분기보고서" && !x.late)).toBe(true);
  });

  it("never produces annual results filed after now (no look-ahead)", async () => {
    const s = new SampleDart(() => new Date("2024-02-01T00:00:00Z"));
    const r = await s.annual("005930", 3);
    expect(r.map((p) => p.period)).toEqual(["2020.12", "2021.12", "2022.12"]);
    expect(r.every((p) => p.filed! <= "2024-02-01" && !p.estimate)).toBe(true);
    const later = await new SampleDart(() => new Date("2024-06-01T00:00:00Z")).annual("005930", 3);
    expect(later.map((p) => p.period)).toEqual(["2021.12", "2022.12", "2023.12"]);
    expect(later.every((p) => (p.revenue ?? 0) > 0)).toBe(true);
    expect(await s.annual("005930", 0)).toEqual([]);
  });
});
