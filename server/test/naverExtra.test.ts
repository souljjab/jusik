import { describe, expect, it } from "vitest";
import { flowSignals } from "@jusik/shared/src/flows";
import type { GetOptions, Http } from "../src/http";
import { HttpError } from "../src/http";
import {
  fetchDisclosures,
  fetchInvestorFlows,
  fetchItemSector,
  fetchSectors,
  NAVER_EXTRA,
  normalizeNaverDate,
  parseDisclosures,
  parseInvestorFlows,
  parseItemSector,
  parseSectors,
} from "../src/naverExtra";

// ⚠ 아래 샘플은 네이버 금융 페이지 형식을 기억대로 흉내 낸 것이다. 실제 응답과 대조하지 못했고, 숫자는 모두 테스트용으로 만든 값이다.

const BLOCKED = "<html><body><h1>일시적으로 서비스를 이용할 수 없습니다</h1></body></html>";

/** frgn.naver 흉내: 앞에 '거래원' 표, 2줄 머리글(기관/외국인 아래 순매매량), 빈 구분 행 */
function frgnPage(rows: { date: string; close: string; vol: string; inst: string; frgn: string; hold: string; instClass?: string; frgnClass?: string }[]) {
  const body = rows
    .map(
      (r) => `<tr onmouseover="mouseOver(this)">
        <td class="tc"><span class="tah p10 gray03">${r.date}</span></td>
        <td class="num"><span class="tah p11">${r.close}</span></td>
        <td class="num"><img src="ico_down.gif" alt="하락"><span class="tah p11 nv01">100</span></td>
        <td class="num"><span class="tah p11 nv01">-0.99%</span></td>
        <td class="num"><span class="tah p11">${r.vol}</span></td>
        <td class="num"><span class="tah p11 ${r.instClass ?? ""}">${r.inst}</span></td>
        <td class="num"><span class="tah p11 ${r.frgnClass ?? ""}">${r.frgn}</span></td>
        <td class="num"><span class="tah p11">1,000,000</span></td>
        <td class="num"><span class="tah p11">${r.hold}</span></td>
      </tr><tr><td colspan="9" class="blank_09"></td></tr>`,
    )
    .join("");
  return `<html><body>
    <table class="type2" summary="거래원정보에 관한표"><tr><th>매도상위</th><th>거래량</th><th>매수상위</th><th>거래량</th></tr>
      <tr><td>가증권</td><td>1,000</td><td>나증권</td><td>2,000</td></tr></table>
    <table class="type2" summary="외국인 기관 순매매 거래량에 관한표">
      <tr><td colspan="9" class="blank_08"></td></tr>
      <tr><th rowspan="2">날짜</th><th rowspan="2">종가</th><th rowspan="2">전일비</th><th rowspan="2">등락률</th><th rowspan="2">거래량</th>
        <th>기관</th><th colspan="3">외국인</th></tr>
      <tr><th>순매매량</th><th>순매매량</th><th>보유주수</th><th>보유율</th></tr>
      <tr><td colspan="9" class="blank_09"></td></tr>
      ${body}
    </table></body></html>`;
}

describe("parseInvestorFlows", () => {
  it("reads the two-row header table, skips the broker table and returns dates ascending", () => {
    const html = frgnPage([
      { date: "2024.03.15", close: "10,100", vol: "200,000", inst: "+1,500", frgn: "-2,500", hold: "30.25%" },
      { date: "2024.03.14", close: "10,200", vol: "150,000", inst: "-700", frgn: "+3,000", hold: "30.10%" },
      { date: "2024.03.14", close: "1", vol: "1", inst: "1", frgn: "1", hold: "1%" }, // 중복 날짜는 첫 행만
    ]);
    expect(parseInvestorFlows(html)).toEqual([
      { date: "2024-03-14", close: 10_200, volume: 150_000, institutionNet: -700, foreignNet: 3_000, foreignHoldPct: 30.1 },
      { date: "2024-03-15", close: 10_100, volume: 200_000, institutionNet: 1_500, foreignNet: -2_500, foreignHoldPct: 30.25 },
    ]);
  });

  it("treats unsigned numbers with a down (nv) class as negative", () => {
    const html = frgnPage([{ date: "2024.03.15", close: "10,100", vol: "200,000", inst: "1,500", frgn: "2,500", hold: "30%", frgnClass: "nv01" }]);
    expect(parseInvestorFlows(html)[0]).toMatchObject({ institutionNet: 1_500, foreignNet: -2_500, close: 10_100 });
  });

  it("survives column reordering and single-row headers, holding ratio optional", () => {
    const html = `<table>
      <thead><tr><th>외국인 순매매량</th><th>거래량</th><th>일자</th><th>기관 순매매량</th><th>종가</th></tr></thead>
      <tbody><tr><td>-1,000</td><td>50,000</td><td>2024/03/15</td><td>+2,000</td><td>9,900</td></tr>
      <tr><td>+300</td><td>40,000</td><td>2024/03/13</td><td>0</td><td>9,800</td></tr></tbody></table>`;
    expect(parseInvestorFlows(html)).toEqual([
      { date: "2024-03-13", close: 9_800, volume: 40_000, institutionNet: 0, foreignNet: 300 },
      { date: "2024-03-15", close: 9_900, volume: 50_000, institutionNet: 2_000, foreignNet: -1_000 },
    ]);
  });

  it("returns [] for empty, blocked or changed pages", () => {
    expect(parseInvestorFlows("")).toEqual([]);
    expect(parseInvestorFlows(BLOCKED)).toEqual([]);
    expect(parseInvestorFlows(frgnPage([]))).toEqual([]);
    // 외국인 열이 사라진 경우: 틀린 값 대신 빈 배열
    expect(parseInvestorFlows(`<table><tr><th>날짜</th><th>종가</th><th>거래량</th><th>기관</th></tr><tr><td>2024.03.15</td><td>1</td><td>1</td><td>1</td></tr></table>`)).toEqual([]);
  });

  it("feeds flowSignals directly", () => {
    const html = frgnPage(
      Array.from({ length: 6 }, (_, k) => ({ date: `2024.03.${String(10 + k).padStart(2, "0")}`, close: "10,000", vol: "10,000", inst: "+400", frgn: "+400", hold: "30%" })),
    );
    const r = flowSignals(parseInvestorFlows(html));
    expect(r.score).toBe(2);
  });
});

describe("normalizeNaverDate", () => {
  it("normalizes the date formats seen on naver pages", () => {
    expect(normalizeNaverDate("2024.03.05")).toBe("2024-03-05");
    expect(normalizeNaverDate(" 2024.3.5 17:30 ")).toBe("2024-03-05");
    expect(normalizeNaverDate("2024-03-05")).toBe("2024-03-05");
    expect(normalizeNaverDate("2024/03/05")).toBe("2024-03-05");
    expect(normalizeNaverDate("2024년 3월 5일")).toBe("2024-03-05");
    expect(normalizeNaverDate("24.03.05")).toBe("2024-03-05");
    expect(normalizeNaverDate("20240305")).toBe("2024-03-05");
  });
  it("rejects junk", () => {
    expect(normalizeNaverDate("")).toBeUndefined();
    expect(normalizeNaverDate(undefined)).toBeUndefined();
    expect(normalizeNaverDate("날짜")).toBeUndefined();
    expect(normalizeNaverDate("2024.13.01")).toBeUndefined();
    expect(normalizeNaverDate("1,234")).toBeUndefined();
  });
});

describe("parseDisclosures", () => {
  const page = `<html><body><table class="type6" summary="공시 리스트">
    <thead><tr><th scope="col">제목</th><th scope="col">정보제공</th><th scope="col">날짜</th></tr></thead>
    <tbody>
      <tr class="first"><td class="title"><a href="/item/news_notice_read.naver?no=1&code=000000" title="가나다(주) 단일판매ㆍ공급계약체결">가나다(주) 단일판매ㆍ공급계...</a></td><td class="info">공시</td><td class="date">2024.03.14 17:30</td></tr>
      <tr><td class="title"><a href="/item/news_notice_read.naver?no=2&code=000000">가나다(주)  현금ㆍ현물배당결정</a></td><td class="info">공시</td><td class="date">2024.03.15 09:01</td></tr>
      <tr><td colspan="3" class="blank"></td></tr>
    </tbody></table></body></html>`;

  it("reads title (full title attribute first) and normalizes dates, newest first", () => {
    expect(parseDisclosures(page)).toEqual([
      { date: "2024-03-15", title: "가나다(주) 현금ㆍ현물배당결정" },
      { date: "2024-03-14", title: "가나다(주) 단일판매ㆍ공급계약체결" },
    ]);
  });

  it("survives column reordering", () => {
    const html = `<table><tr><th>날짜</th><th>제목</th></tr><tr><td>24.03.15</td><td><a href="#">무상증자결정</a></td></tr></table>`;
    expect(parseDisclosures(html)).toEqual([{ date: "2024-03-15", title: "무상증자결정" }]);
  });

  it("falls back to td.title / td.date classes when there is no header", () => {
    const html = `<table><tr><td class="title"><a href="#">유상증자결정</a></td><td class="date">2024.03.15</td></tr></table>`;
    expect(parseDisclosures(html)).toEqual([{ date: "2024-03-15", title: "유상증자결정" }]);
  });

  it("returns [] for empty or blocked pages", () => {
    expect(parseDisclosures("")).toEqual([]);
    expect(parseDisclosures(BLOCKED)).toEqual([]);
    expect(parseDisclosures(`<table><tr><th>제목</th><th>날짜</th></tr><tr><td colspan="2">공시가 없습니다.</td></tr></table>`)).toEqual([]);
  });
});

describe("parseSectors", () => {
  const page = `<table class="type_1" summary="업종별 시세 리스트">
    <tr><th rowspan="2">업종명</th><th rowspan="2">전일대비</th><th colspan="4">전일대비 등락현황</th><th rowspan="2">등락그래프</th></tr>
    <tr><th>전체</th><th>상승</th><th>보합</th><th>하락</th></tr>
    <tr><td colspan="7" class="blank_08"></td></tr>
    <tr><td style="padding-left:10px;"><a href="/sise/sise_group_detail.naver?type=upjong&amp;no=101">가업종</a></td>
      <td class="number"><span class="tah p11 red01">+3.10%</span></td><td>10</td><td>8</td><td>1</td><td>1</td><td></td></tr>
    <tr><td><a href="/sise/sise_group_detail.naver?type=upjong&no=102">나업종</a></td>
      <td class="number"><span class="tah p11 nv01">-1.20%</span></td><td>5</td><td>1</td><td>0</td><td>4</td><td></td></tr>
    <tr><td><a href="/sise/sise_group_detail.naver?type=upjong&no=103">다업종</a></td>
      <td class="number"><span class="tah p11 nv01">0.50%</span></td><td>5</td><td>1</td><td>0</td><td>4</td><td></td></tr>
    <tr><td><a href="/sise/sise_group_detail.naver?type=theme&no=900">테마는 제외</a></td><td>+9.00%</td></tr>
  </table>`;

  it("reads sector no, name and signed change", () => {
    expect(parseSectors(page)).toEqual([
      { no: "101", name: "가업종", changePct: 3.1 },
      { no: "102", name: "나업종", changePct: -1.2 },
      { no: "103", name: "다업종", changePct: -0.5 }, // 부호 없는 파란 값은 하락
    ]);
  });

  it("survives column reordering and missing headers", () => {
    const html = `<table><tr><td>3</td><td>-0.40%</td><td><a href="sise_group_detail.naver?no=7&type=upjong">라업종</a></td></tr></table>`;
    expect(parseSectors(html)).toEqual([{ no: "7", name: "라업종", changePct: -0.4 }]);
  });

  it("returns [] for empty or blocked pages", () => {
    expect(parseSectors("")).toEqual([]);
    expect(parseSectors(BLOCKED)).toEqual([]);
  });
});

describe("parseItemSector", () => {
  it("finds the upjong link and ignores theme links", () => {
    const html = `<div><a href="/sise/sise_group_detail.naver?type=theme&no=50">어떤테마</a></div>
      <div class="section trade_compare"><h4 class="h_sub sub_tit7"><em><a href="/sise/sise_group_detail.naver?type=upjong&no=278"> 가업종 </a></em></h4></div>`;
    expect(parseItemSector(html)).toEqual({ no: "278", name: "가업종" });
  });
  it("returns null when there is no sector link", () => {
    expect(parseItemSector(BLOCKED)).toBeNull();
    expect(parseItemSector("")).toBeNull();
  });
});

/** 주소별 응답을 정해 두는 가짜 Http. 호출 기록을 남긴다 */
function fakeHttp(pages: Record<string, string | Error>) {
  const calls: { url: string; opt?: GetOptions }[] = [];
  const http: Http = {
    async get(url, opt) {
      calls.push({ url, opt });
      const r = pages[url];
      if (r instanceof Error) throw r;
      if (r == null) throw new HttpError(404, url);
      return r;
    },
    async getResponse(url, opt) {
      return { status: 200, headers: new Headers(), text: await this.get(url, opt) };
    },
  };
  return { http, calls };
}

describe("naverExtra fetchers", () => {
  const p1 = frgnPage([
    { date: "2024.03.15", close: "10,100", vol: "1,000", inst: "+1", frgn: "+2", hold: "1%" },
    { date: "2024.03.14", close: "10,000", vol: "1,000", inst: "+1", frgn: "+2", hold: "1%" },
  ]);
  const p2 = frgnPage([
    { date: "2024.03.14", close: "10,000", vol: "1,000", inst: "+1", frgn: "+2", hold: "1%" },
    { date: "2024.03.13", close: "9,900", vol: "1,000", inst: "-1", frgn: "-2", hold: "1%" },
  ]);

  it("merges investor flow pages ascending with auto encoding", async () => {
    const { http, calls } = fakeHttp({ [NAVER_EXTRA.investor("000000", 1)]: p1, [NAVER_EXTRA.investor("000000", 2)]: p2 });
    const flows = await fetchInvestorFlows(http, "000000");
    expect(flows.map((f) => f.date)).toEqual(["2024-03-13", "2024-03-14", "2024-03-15"]);
    expect(calls.map((c) => c.url)).toEqual([
      "https://finance.naver.com/item/frgn.naver?code=000000&page=1",
      "https://finance.naver.com/item/frgn.naver?code=000000&page=2",
    ]);
    expect(calls.every((c) => c.opt?.encoding === "auto")).toBe(true);
  });

  it("stops when a page adds nothing new, keeps earlier pages on later failures, throws on first-page failure", async () => {
    const same = fakeHttp({ [NAVER_EXTRA.investor("000000", 1)]: p1, [NAVER_EXTRA.investor("000000", 2)]: p1 });
    expect(await fetchInvestorFlows(same.http, "000000", 5)).toHaveLength(2);
    expect(same.calls).toHaveLength(2);

    const partial = fakeHttp({ [NAVER_EXTRA.investor("000000", 1)]: p1, [NAVER_EXTRA.investor("000000", 2)]: new Error("접속 실패") });
    expect(await fetchInvestorFlows(partial.http, "000000", 3)).toHaveLength(2);

    const down = fakeHttp({ [NAVER_EXTRA.investor("000000", 1)]: new HttpError(503, "x") });
    await expect(fetchInvestorFlows(down.http, "000000")).rejects.toBeInstanceOf(HttpError);
  });

  it("skips non-Korean codes without any request", async () => {
    const { http, calls } = fakeHttp({});
    expect(await fetchInvestorFlows(http, "AAPL")).toEqual([]);
    expect(await fetchDisclosures(http, "AAPL")).toEqual([]);
    expect(await fetchItemSector(http, "AAPL")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("fetches disclosures, sectors and the item's sector from the expected pages", async () => {
    const { http, calls } = fakeHttp({
      "https://finance.naver.com/item/news_notice.naver?code=000000&page=1": `<table><tr><th>제목</th><th>날짜</th></tr><tr><td><a>무상증자결정</a></td><td>2024.03.15</td></tr></table>`,
      "https://finance.naver.com/sise/sise_group.naver?type=upjong": `<table><tr><td><a href="/sise/sise_group_detail.naver?type=upjong&no=1">가업종</a></td><td>+1.00%</td></tr></table>`,
      "https://finance.naver.com/item/main.naver?code=000000": `<a href="/sise/sise_group_detail.naver?type=upjong&no=1">가업종</a>`,
    });
    expect(await fetchDisclosures(http, "000000")).toEqual([{ date: "2024-03-15", title: "무상증자결정" }]);
    expect(await fetchSectors(http)).toEqual([{ no: "1", name: "가업종", changePct: 1 }]);
    expect(await fetchItemSector(http, "000000")).toEqual({ no: "1", name: "가업종" });
    expect(calls.every((c) => c.opt?.encoding === "auto" && c.opt.headers?.referer)).toBe(true);
    expect(calls[0]!.opt!.headers!.referer).toBe("https://finance.naver.com/item/main.naver?code=000000");
  });
});
