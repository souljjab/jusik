import { describe, expect, it } from "vitest";
import { classifySecFiling, secDisclosureNotes, usFlowSignals } from "../../shared/src/usFlows";
import type { GetOptions, Http } from "../src/http";
import { HttpError } from "../src/http";
import { MockUsSource, sampleSecFilings, sampleSecFinancials, sampleUsHolders } from "../src/mockUs";
import { parseCompanyFacts, parseCompanyTickers, parseSubmissions, SEC, SEC_PARAMS, SecClient, secPeriodLabel } from "../src/sec";

/*
 * 아래 JSON은 SEC 문서에 적힌 형식(company_tickers.json, submissions의 filings.recent 열 배열,
 * companyfacts의 facts.us-gaap.<태그>.units)을 흉내 낸 테스트용 값이다. 실제 응답이나 실제 회사 수치가 아니다.
 */

// ───────────────────────── 티커 목록 ─────────────────────────

const TICKERS = JSON.stringify({
  "0": { cik_str: 320193, ticker: "FOO", title: "Foo Corp" },
  "1": { cik_str: 1067983, ticker: "BRK-B", title: "Berkshire Sample" },
  "2": { cik_str: 999, ticker: "foo", title: "Duplicate keeps first" },
  "3": { cik_str: "1234", ticker: "BAR", title: "Bar Inc" },
  "4": { cik_str: -1, ticker: "BAD", title: "invalid cik" },
  "5": { ticker: "NOCIK" },
});

describe("parseCompanyTickers", () => {
  it("maps upper-cased tickers to CIK and title, keeping the first duplicate", () => {
    const m = parseCompanyTickers(TICKERS);
    expect(m.get("FOO")).toEqual({ cik: 320193, title: "Foo Corp" });
    expect(m.get("BRK-B")?.cik).toBe(1067983);
    expect(m.get("BAR")).toEqual({ cik: 1234, title: "Bar Inc" });
    expect(m.has("BAD")).toBe(false);
    expect(m.has("NOCIK")).toBe(false);
    expect(m.size).toBe(3);
  });
  it("also reads the fields/data layout and parsed objects", () => {
    const m = parseCompanyTickers({ fields: ["cik", "name", "ticker", "exchange"], data: [[320193, "Foo Corp", "FOO", "Nasdaq"], [5, "Bar", "bar", "NYSE"]] });
    expect(m.get("FOO")).toEqual({ cik: 320193, title: "Foo Corp" });
    expect(m.get("BAR")?.cik).toBe(5);
  });
  it("returns an empty map for unknown formats", () => {
    expect(parseCompanyTickers("<html>blocked</html>").size).toBe(0);
    expect(parseCompanyTickers(JSON.stringify([1, 2, 3])).size).toBe(0);
    expect(parseCompanyTickers({ fields: ["a"], data: [[1]] }).size).toBe(0);
    expect(parseCompanyTickers(null).size).toBe(0);
  });
});

// ───────────────────────── 공시 목록 ─────────────────────────

const SUBMISSIONS = JSON.stringify({
  cik: "320193",
  name: "Foo Corp",
  filings: {
    recent: {
      accessionNumber: ["0000320193-24-000070", "0000320193-24-000081", "0000320193-24-000080", "0001140361-24-000001", "not-an-accession", "0000320193-24-000060", "0000320193-24-000050"],
      filingDate: ["2024-02-02", "2024-05-02", "2024-05-02", "2024-04-15", "2024-04-01", "2023-13-01", "2024-03-01"],
      reportDate: ["", "2024-05-02", "2024-03-30", "2024-04-12", "", "", ""],
      form: ["SC 13G/A", "8-K", "10-Q", "4", "8-K", "8-K", "S-3"],
      items: ["", "2.02,9.01", "", "", "", "", ""],
      primaryDocument: ["", "foo-20240502.htm", "foo-20240330.htm", "xslF345X05/wk-form4_1.xml", "x.htm", "y.htm", "s3.htm"],
      primaryDocDescription: ["", "8-K", "10-Q", "FORM 4", "", "", "Registration statement"],
    },
    files: [],
  },
});

describe("parseSubmissions", () => {
  const list = parseSubmissions(SUBMISSIONS, 320193);

  it("zips the column arrays into newest-first disclosures with Korean labels and EDGAR links", () => {
    expect(list.map((d) => d.date)).toEqual(["2024-05-02", "2024-05-02", "2024-04-15", "2024-03-01", "2024-02-02"]);
    expect(list[0]).toEqual({
      date: "2024-05-02",
      title: "실적 발표 · 8-K (Item 2.02, 9.01)",
      url: "https://www.sec.gov/Archives/edgar/data/320193/000032019324000081/foo-20240502.htm",
      source: "SEC",
      form: "8-K",
    });
    expect(list[1]!.title).toBe("정기보고서 · 10-Q"); // 설명이 서식과 같으면 붙이지 않는다
    expect(list[2]!.title).toBe("내부자 거래 · 4 — FORM 4");
    expect(list[2]!.url).toBe("https://www.sec.gov/Archives/edgar/data/320193/000114036124000001/xslF345X05/wk-form4_1.xml");
    expect(list[3]!.title).toBe("증자·공모 · S-3 — Registration statement");
    // 주 문서가 없으면 폴더 주소
    expect(list[4]!.url).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019324000070/");
  });

  it("drops rows with a bad accession number or date", () => {
    expect(list).toHaveLength(5);
    expect(list.some((d) => d.url?.includes("x.htm") || d.url?.includes("y.htm"))).toBe(false);
  });

  it("round-trips with classification and notes (title carries 8-K items)", () => {
    const notes = secDisclosureNotes(list, "2024-05-03");
    expect(notes.map((n) => n.text.split(":")[0])).toEqual(["확인할 공시(실적 발표)", "확인할 공시(정기보고서)"]);
    expect(classifySecFiling(list[0]!.form!, "2.02").type).toBe("실적 발표");
  });

  it("returns [] for unknown shapes", () => {
    expect(parseSubmissions("oops", 1)).toEqual([]);
    expect(parseSubmissions({ filings: {} }, 1)).toEqual([]);
    expect(parseSubmissions({ filings: { recent: { accessionNumber: ["0000320193-24-000081"] } } }, 1)).toEqual([]);
  });
});

// ───────────────────────── 재무 사실 ─────────────────────────

type F = { start?: string; end: string; val: number; form: string; filed: string; fy?: number; fp?: string; accn?: string };
const fact = (start: string | undefined, end: string, val: number, form: string, filed: string): F => ({ ...(start ? { start } : {}), end, val, form, filed, accn: "0000000000-00-000000" });
const facts = (gaap: Record<string, Record<string, F[]>>) => JSON.stringify({ cik: 320193, entityName: "Foo Corp", facts: { dei: {}, "us-gaap": Object.fromEntries(Object.entries(gaap).map(([tag, units]) => [tag, { label: tag, units }])) } });
const M = 1_000_000;

const FACTS = facts({
  Revenues: {
    USD: [
      fact("2021-01-01", "2021-12-31", 1000 * M, "10-K", "2022-02-20"),
      fact("2021-01-01", "2021-12-31", 1010 * M, "10-K", "2023-02-20"), // 다음 해 10-K의 재작성 비교값 → 버림
      fact("2022-01-01", "2022-12-31", 1200 * M, "10-K", "2023-02-20"),
      fact("2022-01-01", "2022-12-31", 1250 * M, "10-K/A", "2023-06-01"), // 정정 → 버림
      fact("2023-01-01", "2023-12-31", 1500 * M, "10-K", "2024-02-21"),
      fact("2023-01-01", "2023-03-31", 300 * M, "10-Q", "2023-05-05"),
      fact("2023-04-01", "2023-06-30", 350 * M, "10-Q", "2023-08-04"),
      fact("2023-01-01", "2023-06-30", 650 * M, "10-Q", "2023-08-04"), // 6개월 누적 → 버림
      fact("2023-07-01", "2023-09-30", 400 * M, "10-Q", "2023-11-03"),
      fact("2023-01-01", "2023-03-31", 310 * M, "10-Q", "2024-05-03"), // 다음 해 1분기 보고서의 비교값 → 버림
      fact("2024-01-01", "2024-03-31", 420 * M, "10-Q", "2024-05-03"),
      fact(undefined, "2023-12-31", 1 * M, "10-K", "2024-02-21"), // 시점 값 → 버림
      fact("2023-10-01", "2023-12-31", 999 * M, "10-K", "2024-02-21"), // 10-K 안의 분기 길이 값 → 분기는 10-Q만
    ],
  },
  RevenueFromContractWithCustomerExcludingAssessedTax: {
    USD: [
      fact("2023-01-01", "2023-12-31", 1450 * M, "10-K", "2024-02-21"), // 같은 날 Revenues가 있으면 우선순위로 Revenues
      fact("2020-01-01", "2020-12-31", 905 * M, "10-K", "2022-02-20"), // 2020년은 SalesRevenueNet이 먼저 제출됨
    ],
  },
  SalesRevenueNet: { USD: [fact("2020-01-01", "2020-12-31", 900 * M, "10-K", "2021-02-25")] },
  OperatingIncomeLoss: {
    USD: [
      fact("2022-01-01", "2022-12-31", 200 * M, "10-K", "2023-02-20"),
      fact("2023-01-01", "2023-12-31", 260 * M, "10-K", "2024-02-21"),
      fact("2023-01-01", "2023-03-31", 50 * M, "10-Q", "2023-05-05"),
      fact("2023-04-01", "2023-06-30", 60 * M, "10-Q", "2023-08-04"),
      fact("2023-07-01", "2023-09-30", 70 * M, "10-Q", "2023-11-03"),
    ],
  },
  NetIncomeLoss: {
    USD: [
      fact("2023-01-01", "2023-12-31", 200 * M, "10-K", "2024-02-21"),
      fact("2023-01-01", "2023-03-31", 40 * M, "10-Q", "2023-05-05"),
      fact("2023-04-01", "2023-06-30", 45 * M, "10-Q", "2023-08-04"),
      // 3분기 순이익 없음 → 4분기 순이익은 계산하지 않는다
    ],
  },
  EarningsPerShareDiluted: {
    "USD/shares": [
      fact("2023-01-01", "2023-12-31", 2.0, "10-K", "2024-02-21"),
      fact("2023-01-01", "2023-03-31", 0.4, "10-Q", "2023-05-05"),
      fact("2023-04-01", "2023-06-30", 0.45, "10-Q", "2023-08-04"),
      fact("2023-07-01", "2023-09-30", 0.5, "10-Q", "2023-11-03"),
    ],
  },
  EarningsPerShareBasic: {
    "USD/shares": [
      fact("2022-01-01", "2022-12-31", 1.6, "10-K", "2023-02-20"), // 희석 EPS가 없는 해는 기본 EPS
      fact("2023-01-01", "2023-12-31", 2.05, "10-K", "2024-02-21"), // 희석이 있으면 희석
    ],
  },
});

describe("parseCompanyFacts", () => {
  const r = parseCompanyFacts(FACTS);

  it("builds annual periods in millions of USD from 10-K durations, old → new", () => {
    expect(r.annual).toEqual([
      { period: "2020.12", filed: "2021-02-25", estimate: false, revenue: 900 },
      { period: "2021.12", filed: "2022-02-20", estimate: false, revenue: 1000 },
      { period: "2022.12", filed: "2023-02-20", estimate: false, revenue: 1200, opIncome: 200, eps: 1.6 },
      { period: "2023.12", filed: "2024-02-21", estimate: false, revenue: 1500, opIncome: 260, netIncome: 200, eps: 2 },
    ]);
  });

  it("keeps the first-filed value per period end (no restatement look-ahead)", () => {
    expect(r.annual.find((p) => p.period === "2021.12")!.revenue).toBe(1000);
    expect(r.annual.find((p) => p.period === "2022.12")!.revenue).toBe(1200);
    expect(r.quarterly.find((p) => p.period === "2023.03")).toMatchObject({ revenue: 300, filed: "2023-05-05" });
    // 모든 기간의 filed는 그 값이 처음 공개된 날이라 기간 끝 이후다
    for (const p of [...r.annual, ...r.quarterly]) expect(p.filed! > `${p.period.replace(".", "-")}-01`).toBe(true);
  });

  it("derives Q4 = FY − Q1 − Q2 − Q3 per metric and marks it", () => {
    expect(r.quarterly.map((p) => p.period)).toEqual(["2023.03", "2023.06", "2023.09", "2023.12", "2024.03"]);
    const q4 = r.quarterly.find((p) => p.period === "2023.12")!;
    expect(q4).toEqual({ period: "2023.12", filed: "2024-02-21", estimate: false, revenue: 450, opIncome: 80, eps: 0.65, derived: true });
    expect(q4.netIncome).toBeUndefined(); // 3분기 순이익이 없어서
    expect(r.quarterly.filter((p) => p.derived)).toHaveLength(1);
    expect(r.quarterly.find((p) => p.period === "2024.03")).toEqual({ period: "2024.03", filed: "2024-05-03", estimate: false, revenue: 420 });
  });

  it("does not derive Q4 when a quarter is missing", () => {
    const g = parseCompanyFacts(
      facts({
        Revenues: {
          USD: [
            fact("2023-01-01", "2023-12-31", 100 * M, "10-K", "2024-02-21"),
            fact("2023-01-01", "2023-03-31", 20 * M, "10-Q", "2023-05-05"),
            fact("2023-07-01", "2023-09-30", 30 * M, "10-Q", "2023-11-03"),
          ],
        },
      }),
    );
    expect(g.quarterly.map((p) => p.period)).toEqual(["2023.03", "2023.09"]);
    expect(g.annual).toHaveLength(1);
  });

  it("labels 52/53-week years by the month they belong to and handles non-calendar fiscal years", () => {
    expect(secPeriodLabel("2025-01-03")).toBe("2024.12");
    expect(secPeriodLabel("2024-09-28")).toBe("2024.09");
    expect(secPeriodLabel("2024-10-05")).toBe("2024.09");
    expect(secPeriodLabel("2024-12-31")).toBe("2024.12");
    const g = parseCompanyFacts(
      facts({
        Revenues: {
          USD: [
            fact("2022-09-25", "2023-09-30", 383 * M, "10-K", "2023-11-03"), // 53주
            fact("2022-09-25", "2022-12-31", 117 * M, "10-Q", "2023-02-03"), // 14주
            fact("2023-01-01", "2023-04-01", 95 * M, "10-Q", "2023-05-05"),
            fact("2023-04-02", "2023-07-01", 82 * M, "10-Q", "2023-08-04"),
          ],
        },
      }),
    );
    expect(g.annual).toEqual([{ period: "2023.09", filed: "2023-11-03", estimate: false, revenue: 383 }]);
    expect(g.quarterly.map((p) => [p.period, p.revenue, p.derived ?? false])).toEqual([
      ["2022.12", 117, false],
      ["2023.03", 95, false], // 2023-04-01 끝 → 3월
      ["2023.06", 82, false], // 2023-07-01 끝 → 6월
      ["2023.09", 89, true],
    ]);
  });

  it("keeps the last 5 years and 12 quarters", () => {
    const rev: F[] = [];
    for (let y = 2010; y <= 2023; y++) {
      rev.push(fact(`${y}-01-01`, `${y}-12-31`, 1000 * M, "10-K", `${y + 1}-02-20`));
      for (const [s, e, f] of [["01-01", "03-31", "05-05"], ["04-01", "06-30", "08-05"], ["07-01", "09-30", "11-05"]] as const)
        rev.push(fact(`${y}-${s}`, `${y}-${e}`, 250 * M, "10-Q", `${y}-${f}`));
    }
    const g = parseCompanyFacts(facts({ Revenues: { USD: rev } }));
    expect(g.annual).toHaveLength(SEC_PARAMS.annualKeep);
    expect(g.annual[0]!.period).toBe("2019.12");
    expect(g.quarterly).toHaveLength(SEC_PARAMS.quarterKeep);
    expect(g.quarterly.at(-1)).toMatchObject({ period: "2023.12", revenue: 250, derived: true });
    expect(g.quarterly[0]!.period).toBe("2021.03");
  });

  it("returns empty results for unknown shapes or non-USD units", () => {
    const empty = { annual: [], quarterly: [] };
    expect(parseCompanyFacts("oops")).toEqual(empty);
    expect(parseCompanyFacts({ facts: {} })).toEqual(empty);
    expect(parseCompanyFacts(facts({ Revenues: { EUR: [fact("2023-01-01", "2023-12-31", 1, "10-K", "2024-02-01")] } }))).toEqual(empty);
    expect(parseCompanyFacts(facts({ Revenues: { USD: [{ start: "2023-01-01", end: "2023-12-31", val: "1" as unknown as number, form: "10-K", filed: "2024-02-01" }] } }))).toEqual(empty);
  });
});

// ───────────────────────── 클라이언트 ─────────────────────────

function fakeSecHttp(routes: Record<string, (string | Error)[]>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const queues: [string, (string | Error)[]][] = Object.entries(routes).map(([k, v]) => [k, [...v]]);
  const http: Http = {
    async getResponse() {
      throw new Error("not used");
    },
    async get(url: string, opt?: GetOptions) {
      calls.push({ url, headers: opt?.headers ?? {} });
      const q = queues.find(([k]) => url.includes(k));
      if (!q) throw new HttpError(404, url);
      const item = q[1].length > 1 ? q[1].shift()! : q[1][0]!;
      if (item instanceof Error) throw item;
      return item;
    },
  };
  return { http, calls };
}

describe("SecClient", () => {
  const UA = "jusik-test test@example.com";

  it("requires a User-Agent and sends it on every request", async () => {
    const { http, calls } = fakeSecHttp({ "company_tickers.json": [TICKERS], "submissions/CIK0000320193.json": [SUBMISSIONS] });
    expect(() => new SecClient(http, { userAgent: "  " })).toThrow(/User-Agent/);
    const sec = new SecClient(http, { userAgent: UA, now: () => Date.parse("2024-05-10T12:00:00Z") });
    await sec.filings("FOO");
    expect(calls.map((c) => c.url)).toEqual([SEC.tickers, "https://data.sec.gov/submissions/CIK0000320193.json"]);
    expect(calls.every((c) => c.headers["user-agent"] === UA)).toBe(true);
  });

  it("resolves CIKs with dot/dash variants and returns empty results for unknown tickers", async () => {
    const { http, calls } = fakeSecHttp({ "company_tickers.json": [TICKERS] });
    const sec = new SecClient(http, { userAgent: UA });
    expect(await sec.cikOf("brk.b")).toBe(1067983);
    expect(await sec.cikOf("FOO")).toBe(320193);
    expect(await sec.cikOf("NOPE")).toBeUndefined();
    expect(await sec.filings("NOPE")).toEqual([]);
    expect(await sec.financials("NOPE")).toEqual({ annual: [], quarterly: [] });
    expect(calls).toHaveLength(1); // 티커 목록 한 번만
  });

  it("filters filings to the last N days as of now (nothing after today)", async () => {
    const { http } = fakeSecHttp({ "company_tickers.json": [TICKERS], submissions: [SUBMISSIONS] });
    let now = Date.parse("2024-04-20T00:00:00Z");
    const sec = new SecClient(http, { userAgent: UA, now: () => now });
    expect((await sec.filings("FOO", 30)).map((d) => d.date)).toEqual(["2024-04-15"]); // 5월 공시는 아직 미래
    now = Date.parse("2024-05-10T00:00:00Z");
    expect((await sec.filings("FOO", 30)).map((d) => d.form)).toEqual(["8-K", "10-Q", "4"]);
    expect((await sec.filings("FOO")).length).toBe(4); // 기본 90일: 2월 2일 공시는 빠진다
    expect((await sec.filings("FOO", 120)).length).toBe(5);
  });

  it("caches tickers for 7 days and filings/facts for ttlMs, without caching failures", async () => {
    const { http, calls } = fakeSecHttp({
      "company_tickers.json": [TICKERS],
      submissions: [new Error("접속 실패"), SUBMISSIONS],
      companyfacts: [FACTS],
    });
    let now = Date.parse("2024-05-10T00:00:00Z");
    const sec = new SecClient(http, { userAgent: UA, ttlMs: 60_000, now: () => now });
    await expect(sec.filings("FOO")).rejects.toThrow("접속 실패");
    expect((await sec.filings("FOO", 120)).length).toBe(5); // 실패는 캐시하지 않고 다시 읽는다
    await sec.filings("FOO");
    const count = (s: string) => calls.filter((c) => c.url.includes(s)).length;
    expect(count("submissions")).toBe(2);
    const fin = await sec.financials("FOO");
    expect(fin.annual.at(-1)).toMatchObject({ period: "2023.12", revenue: 1500 });
    expect(calls.at(-1)!.url).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json");
    await sec.financials("FOO");
    expect(count("companyfacts")).toBe(1);
    now += 61_000; // ttl 지남
    await sec.filings("FOO");
    expect(count("submissions")).toBe(3);
    expect(count("company_tickers")).toBe(1);
    now += 8 * 86_400_000; // 7일 지남
    await sec.cikOf("FOO");
    expect(count("company_tickers")).toBe(2);
  });
});

// ───────────────────────── 샘플 모드 ─────────────────────────

describe("sample-mode US data (mockUs)", () => {
  const now = new Date("2026-10-10T03:00:00Z");

  it("is deterministic per ticker and date, differs across tickers, and is empty for Korean codes", () => {
    expect(sampleUsHolders("AAPL", now)).toEqual(sampleUsHolders("AAPL", now));
    expect(sampleUsHolders("AAPL", now)).not.toEqual(sampleUsHolders("MSFT", now));
    expect(sampleSecFinancials("AAPL", now)).toEqual(sampleSecFinancials("AAPL", now));
    expect(sampleSecFilings("AAPL", now)).toEqual(sampleSecFilings("AAPL", now));
    expect(sampleUsHolders("005930", now)).toEqual({});
    expect(sampleSecFilings("005930", now)).toEqual([]);
    expect(sampleSecFinancials("005930", now)).toEqual({ annual: [], quarterly: [] });
  });

  it("labels sample holders and filings as samples and links nothing", () => {
    const h = sampleUsHolders("NVDA", now);
    expect(h.topInstitutions!.every((x) => x.name.includes("샘플"))).toBe(true);
    expect(h.recentInsider!.every((x) => x.name.includes("샘플") && x.date < "2026-10-10")).toBe(true);
    expect(h.insiderNet6m!.netShares).toBe(h.insiderNet6m!.buyShares - h.insiderNet6m!.sellShares);
    const f = sampleSecFilings("NVDA", now);
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((d) => d.title.endsWith("샘플 공시") && d.url === undefined && d.source === "SEC" && !!d.form)).toBe(true);
    expect(f.every((d) => d.date <= "2026-10-10" && d.date >= "2026-07-12")).toBe(true);
    expect([...f].sort((a, b) => b.date.localeCompare(a.date))).toEqual(f);
  });

  it("produces financials only up to now, old → new, with consistent derived Q4", () => {
    for (const code of ["AAPL", "MSFT", "TSLA", "KO", "BRK-B"]) {
      const { annual, quarterly } = sampleSecFinancials(code, now);
      expect(annual.length).toBeGreaterThan(0);
      expect(annual.length).toBeLessThanOrEqual(5);
      expect(quarterly.length).toBeLessThanOrEqual(12);
      for (const p of [...annual, ...quarterly]) {
        expect(p.filed! <= "2026-10-10").toBe(true);
        expect(p.estimate).toBe(false);
      }
      const periods = quarterly.map((p) => p.period);
      expect([...periods].sort()).toEqual(periods);
      for (const a of annual) {
        const q4 = quarterly.find((p) => p.period === a.period);
        if (!q4) continue;
        expect(q4.derived).toBe(true);
        const i = quarterly.indexOf(q4);
        if (i < 3) continue;
        const sum = quarterly.slice(i - 3, i + 1).reduce((s, p) => s + p.revenue!, 0);
        expect(Math.abs(sum - a.revenue!)).toBeLessThan(0.05);
      }
      // 1년 전 시점이면 그 뒤에 제출된 실적은 없다
      const past = sampleSecFinancials(code, new Date("2025-10-10T00:00:00Z"));
      expect([...past.annual, ...past.quarterly].every((p) => p.filed! <= "2025-10-10")).toBe(true);
    }
  });

  it("serves the SecSource shape and feeds usFlowSignals", async () => {
    const src = new MockUsSource(() => now);
    expect(src.sample).toBe(true);
    expect(await src.financials("AAPL")).toEqual(sampleSecFinancials("AAPL", now));
    expect(await src.filings("AAPL", 30)).toEqual(sampleSecFilings("AAPL", now, 30));
    const s = usFlowSignals(await src.holders("AAPL"));
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(2);
  });
});
