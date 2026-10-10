import { describe, expect, it } from "vitest";
import { usFlowSignals } from "@jusik/shared";
import { createHttp, HttpError, type Http } from "../src/http";
import { SecClient, type SecFinancials, type SecSource } from "../src/sec";
import { mergeSecFinancials, WebProvider } from "../src/webProvider";
import { parseYahooFundamentals, parseYahooHolders, YAHOO } from "../src/yahoo";

const res = (status: number, body: string | Uint8Array, headers: Record<string, string> = {}) => new Response(body as BodyInit, { status, headers });
const noSleep = async () => {};

describe("http client", () => {
  it("retries 429/5xx with backoff and then succeeds", async () => {
    let n = 0;
    const sleeps: number[] = [];
    const http = createHttp({ minIntervalMs: 0, retries: 2, sleep: async (ms) => void sleeps.push(ms), fetchImpl: async () => (++n < 3 ? res(429, "slow down") : res(200, "ok")) });
    expect(await http.get("https://x.test/a")).toBe("ok");
    expect(n).toBe(3);
    expect(sleeps.filter((s) => s >= 1000)).toEqual([1000, 2000]);
  });
  it("throws HttpError for non-2xx without retrying 4xx", async () => {
    let n = 0;
    const http = createHttp({ minIntervalMs: 0, sleep: noSleep, fetchImpl: async () => (n++, res(403, "no")) });
    await expect(http.get("https://x.test/b")).rejects.toBeInstanceOf(HttpError);
    expect(n).toBe(1);
  });
  it("spaces requests and sends them one at a time", async () => {
    let active = 0, maxActive = 0;
    const waits: number[] = [];
    const http = createHttp({
      minIntervalMs: 200, sleep: async (ms) => void waits.push(ms),
      fetchImpl: async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 5)); active--; return res(200, "x"); },
    });
    await Promise.all([http.get("https://x.test/1"), http.get("https://x.test/2"), http.get("https://x.test/3")]);
    expect(maxActive).toBe(1);
    expect(waits.filter((w) => w > 0).length).toBeGreaterThanOrEqual(2);
  });
  it("decodes EUC-KR when UTF-8 is invalid ('auto')", async () => {
    const euckr = new Uint8Array([0xbb, 0xef, 0xbc, 0xba]); // 삼성
    const http = createHttp({ minIntervalMs: 0, fetchImpl: async () => res(200, euckr) });
    expect(await http.get("https://x.test/k", { encoding: "auto" })).toBe("삼성");
    const utf8 = createHttp({ minIntervalMs: 0, fetchImpl: async () => res(200, new TextEncoder().encode("삼성")) });
    expect(await utf8.get("https://x.test/u", { encoding: "auto" })).toBe("삼성");
  });
});

/** URL 일부 문자열 → 응답. 순서대로 소비되는 배열도 가능 */
function fakeHttp(routes: [string, (string | { status: number; text: string; cookies?: string[] })[]][]): Http & { calls: string[] } {
  const calls: string[] = [];
  const queues: [string, (string | { status: number; text: string; cookies?: string[] })[]][] = routes.map(([k, v]) => [k, [...v]]);
  const getResponse = async (url: string) => {
    calls.push(url);
    const q = queues.find(([k]) => url.includes(k));
    if (!q) return { status: 404, headers: new Headers(), text: "" };
    const item = q[1].length > 1 ? q[1].shift()! : q[1][0]!;
    if (typeof item === "string") return { status: 200, headers: new Headers(), text: item };
    const h = new Headers();
    item.cookies?.forEach((c) => h.append("set-cookie", c));
    return { status: item.status, headers: h, text: item.text };
  };
  return {
    calls,
    getResponse,
    async get(url) {
      const r = await getResponse(url);
      if (r.status < 200 || r.status >= 300) throw new HttpError(r.status, url);
      return r.text;
    },
  };
}

describe("WebProvider", () => {
  const chartUS = JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 190, chartPreviousClose: 180, gmtoffset: 0, shortName: "Foo Corp" }, timestamp: [1704205800, 1704292200], indicators: { quote: [{ open: [1, 2], high: [2, 3], low: [1, 1], close: [2, 3], volume: [10, 20] }] } }] } });
  const realtime = JSON.stringify({ result: { areas: [{ datas: [{ cd: "005930", nm: "삼성전자", nv: 78000, cv: 500, cr: 0.64, aq: 1000 }, { cd: "000660", nm: "SK하이닉스", nv: 130000, cv: 0, cr: 0, aq: 5 }] }] } });

  it("routes Korean codes to Naver and tickers to Yahoo", async () => {
    const http = fakeHttp([["polling.finance.naver.com", [realtime]], ["query1.finance.yahoo.com/v8", [chartUS]]]);
    const p = new WebProvider(http);
    expect((await p.getQuote("005930")).price).toBe(78000);
    const us = await p.getQuote("FOO");
    expect(us).toMatchObject({ price: 190, change: 10 });
    expect(http.calls[0]).toContain("naver");
    expect(http.calls[1]).toContain("yahoo");
  });
  it("batches Korean prices and skips failures", async () => {
    const http = fakeHttp([["polling.finance.naver.com", [realtime]], ["query1.finance.yahoo.com", [{ status: 500, text: "" }]]]);
    const prices = await new WebProvider(http).getPrices(["005930", "000660", "ZZZ"]);
    expect(prices).toEqual({ "005930": 78000, "000660": 130000 });
    expect(http.calls.filter((c: string) => c.includes("polling")).length).toBe(1);
  });
  it("resolves unknown names via the sites", async () => {
    const http = fakeHttp([["query1.finance.yahoo.com/v8", [chartUS]]]);
    expect(await new WebProvider(http).getInfo("FOO")).toEqual({ code: "FOO", name: "Foo Corp", market: "US" });
  });
  it("builds the universe from both ranking pages, deduping, and errors clearly when both fail", async () => {
    const row = (code: string, v: number) => `<tr><td>1</td><td><a href="/item/main.naver?code=${code}">N${code}</a></td><td>10,000</td><td>1</td><td>+3.00%</td><td>${v}</td></tr>`;
    const page = (rows: string) => `<table class="type_2"><tr><th>N</th><th>종목명</th><th>현재가</th><th>전일비</th><th>등락률</th><th>거래량</th></tr>${rows}</table>`;
    const http = fakeHttp([["sise_quant", [page(row("000001", 5) + row("000002", 6))]], ["sise_rise", [page(row("000002", 6) + row("000003", 7))]]]);
    const u = await new WebProvider(http).getUniverse("KOSPI");
    expect(u.map((r) => r.code).sort()).toEqual(["000001", "000002", "000003"]);
    const dead = fakeHttp([["sise_", [{ status: 403, text: "" }]]]);
    await expect(new WebProvider(dead).getUniverse("KOSPI")).rejects.toThrow(/순위표를 읽지 못했어요/);
  });
  it("gets a Yahoo crumb once when the screener returns 401, then retries", async () => {
    const screener = JSON.stringify({ finance: { result: [{ quotes: [{ symbol: "NVDA", quoteType: "EQUITY", regularMarketPrice: 900, regularMarketChangePercent: 4, regularMarketVolume: 1e7 }] }] } });
    const http = fakeHttp([
      ["screener/predefined", [{ status: 401, text: "" }, { status: 200, text: screener }, { status: 200, text: screener }]],
      ["fc.yahoo.com", [{ status: 404, text: "", cookies: ["A3=abc; Domain=.yahoo.com; Path=/", "B=zzz; Path=/"] }]],
      ["getcrumb", ["CRUMB123"]],
    ]);
    const u = await new WebProvider(http).getUniverse("US");
    expect(u[0]).toMatchObject({ code: "NVDA" });
    expect(http.calls.some((c: string) => c.includes("crumb=CRUMB123"))).toBe(true);
    expect(http.calls.filter((c: string) => c.includes("getcrumb")).length).toBe(1);
  });
  it("returns empty fundamentals instead of failing the analysis", async () => {
    const p = new WebProvider(fakeHttp([["naver", [{ status: 500, text: "" }]]]));
    expect(await p.getFundamentals("005930")).toEqual({});
  });
});

// ───────────────────────── 미국: 야후 지분·수급, SEC 실적 합치기 ─────────────────────────
// 아래 JSON은 야후 quoteSummary 모듈 형식({raw, fmt})을 흉내 낸 테스트용 값이다(실제 응답·실제 수치 아님).

const HOLDERS = JSON.stringify({
  quoteSummary: {
    result: [
      {
        majorHoldersBreakdown: {
          maxAge: 1,
          insidersPercentHeld: { raw: 0.0171, fmt: "1.71%" },
          institutionsPercentHeld: { raw: 0.6193, fmt: "61.93%" },
          institutionsFloatPercentHeld: { raw: 0.63, fmt: "63.00%" },
          institutionsCount: { raw: 6532, fmt: "6.53k", longFmt: "6,532" },
        },
        institutionOwnership: {
          maxAge: 1,
          ownershipList: [
            { maxAge: 1, reportDate: { raw: 1711843200, fmt: "2024-03-31" }, organization: "Sample Fund A", pctHeld: { raw: 0.0838, fmt: "8.38%" }, position: { raw: 1.3e9 }, value: { raw: 2.2e11 }, pctChange: { raw: 0.0124, fmt: "1.24%" } },
            { maxAge: 1, reportDate: { raw: 1711843200, fmt: "2024-03-31" }, organization: "Sample Fund B", pctHeld: { raw: 0.0662 }, pctChange: { raw: -0.005 } },
            { maxAge: 1, reportDate: { fmt: "2024-03-31" }, organization: "Sample Fund C", pctHeld: 0.031 },
            { maxAge: 1, organization: "", pctHeld: { raw: 0.02 }, reportDate: { raw: 1711843200 } },
          ],
        },
        netSharePurchaseActivity: {
          maxAge: 1,
          period: "6m",
          buyInfoCount: { raw: 4 },
          buyInfoShares: { raw: 120000 },
          sellInfoCount: { raw: 9 },
          sellInfoShares: { raw: 300000 },
          netInfoCount: { raw: 13 },
          netInfoShares: { raw: -180000 },
          totalInsiderShares: { raw: 5e7 },
        },
        insiderTransactions: {
          maxAge: 1,
          transactions: [
            { maxAge: 1, shares: { raw: 5000, longFmt: "5,000" }, value: { raw: 850000, fmt: "850k" }, filerName: "SAMPLE PERSON A", filerRelation: "Chief Financial Officer", transactionText: "Sale at price 170.00 per share.", startDate: { raw: 1714521600, fmt: "2024-05-01" }, ownership: "D" },
            { maxAge: 1, shares: { raw: 2000 }, filerName: "SAMPLE PERSON B", filerRelation: "Director", transactionText: "", startDate: { raw: 1715212800 }, ownership: "D" },
            { maxAge: 1, shares: { raw: 100 }, filerName: "NO DATE" },
          ],
        },
        defaultKeyStatistics: {
          sharesShort: { raw: 120000000 },
          sharesShortPriorMonth: { raw: 95000000 },
          shortRatio: { raw: 1.52 },
          shortPercentOfFloat: { raw: 0.0071 },
          heldPercentInsiders: { raw: 0.0007 },
          heldPercentInstitutions: { raw: 0.61 },
        },
      },
    ],
    error: null,
  },
});

describe("Yahoo US parsers (holders, market cap)", () => {
  it("parses holders from raw values into percentages and sorted lists", () => {
    const h = parseYahooHolders(HOLDERS);
    expect(h).toMatchObject({ insidersPct: 1.71, institutionsPct: 61.93, institutionsCount: 6532, shortPctFloat: 0.71, shortRatio: 1.52, sharesShort: 120000000, sharesShortPrior: 95000000 });
    expect(h.insiderNet6m).toEqual({ buyShares: 120000, sellShares: 300000, netShares: -180000, buyCount: 4, sellCount: 9 });
    expect(h.recentInsider).toEqual([
      { name: "SAMPLE PERSON B", text: "Director", shares: 2000, date: "2024-05-09" },
      { name: "SAMPLE PERSON A", text: "Chief Financial Officer · Sale at price 170.00 per share.", shares: 5000, value: 850000, date: "2024-05-01" },
    ]);
    expect(h.topInstitutions).toEqual([
      { name: "Sample Fund A", pctHeld: 8.38, pctChange: 1.24, date: "2024-03-31" },
      { name: "Sample Fund B", pctHeld: 6.62, pctChange: -0.5, date: "2024-03-31" },
      { name: "Sample Fund C", pctHeld: 3.1, date: "2024-03-31" },
    ]);
  });
  it("tolerates missing modules and falls back to key statistics", () => {
    const only = JSON.stringify({ quoteSummary: { result: [{ defaultKeyStatistics: { heldPercentInsiders: { raw: 0.05 }, heldPercentInstitutions: 0.4, shortPercentOfFloat: { raw: 0.25 } } }] } });
    expect(parseYahooHolders(only)).toEqual({ insidersPct: 5, institutionsPct: 40, shortPctFloat: 25 });
    expect(parseYahooHolders(JSON.stringify({ quoteSummary: { result: [{}] } }))).toEqual({});
    expect(parseYahooHolders(JSON.stringify({ quoteSummary: { result: null, error: { code: "Not Found" } } }))).toEqual({});
    expect(parseYahooHolders("<html>")).toEqual({});
  });
  it("builds the holders URL with the needed modules", () => {
    expect(YAHOO.holders("BRK-B")).toContain("/quoteSummary/BRK-B?modules=majorHoldersBreakdown,institutionOwnership,netSharePurchaseActivity,insiderTransactions,defaultKeyStatistics");
    expect(YAHOO.summary("FOO")).toContain("modules=price,");
  });
  it("adds market cap in millions of USD, shares outstanding and the amount unit to fundamentals", () => {
    const text = JSON.stringify({ quoteSummary: { result: [{ price: { marketCap: { raw: 2_950_000_000_000 } }, summaryDetail: { trailingPE: { raw: 30 }, marketCap: { raw: 1 } }, defaultKeyStatistics: { sharesOutstanding: { raw: 15_400_000_000 } } }] } });
    expect(parseYahooFundamentals(text)).toEqual({ per: 30, marketCap: 2_950_000, sharesOutstanding: 15_400_000_000, amountUnit: "백만달러" });
    const fallback = JSON.stringify({ quoteSummary: { result: [{ summaryDetail: { marketCap: { raw: 123_456_789 } } }] } });
    expect(parseYahooFundamentals(fallback)).toEqual({ marketCap: 123.46, amountUnit: "백만달러" });
  });
});

describe("mergeSecFinancials", () => {
  const sec: SecFinancials = {
    annual: [
      { period: "2022.12", filed: "2023-02-20", estimate: false, revenue: 1000, opIncome: 100 },
      { period: "2023.12", filed: "2024-02-21", estimate: false, revenue: 1200, opIncome: 90 },
    ],
    quarterly: [{ period: "2024.03", filed: "2024-05-03", estimate: false, revenue: 320 }],
  };
  it("fills periods and computes growth from the last two confirmed years only when Yahoo lacks it", () => {
    expect(mergeSecFinancials({ per: 20 }, sec)).toEqual({ per: 20, annual: sec.annual, quarterly: sec.quarterly, amountUnit: "백만달러", revenueGrowth: 20, opIncomeGrowth: -10 });
    expect(mergeSecFinancials({ revenueGrowth: 8, opIncomeGrowth: 3 }, sec)).toMatchObject({ revenueGrowth: 8, opIncomeGrowth: 3 });
  });
  it("skips growth when the base year is not positive and ignores estimates", () => {
    const neg: SecFinancials = {
      annual: [
        { period: "2022.12", estimate: false, revenue: 0, opIncome: -5 },
        { period: "2023.12", estimate: false, revenue: 10, opIncome: 5 },
        { period: "2024.12(E)", estimate: true, revenue: 99, opIncome: 99 },
      ],
      quarterly: [],
    };
    const f = mergeSecFinancials({}, neg);
    expect(f.revenueGrowth).toBeUndefined();
    expect(f.opIncomeGrowth).toBeUndefined();
    expect(mergeSecFinancials({ per: 1 }, null)).toEqual({ per: 1 });
    expect(mergeSecFinancials({ per: 1 }, { annual: [], quarterly: [] })).toEqual({ per: 1 });
  });
});

describe("WebProvider (US: SEC + Yahoo holders)", () => {
  const summary = JSON.stringify({ quoteSummary: { result: [{ summaryDetail: { trailingPE: { raw: 25 } }, price: { marketCap: { raw: 5e10 } } }] } });
  const fakeSec = (impl: () => Promise<SecFinancials>): SecSource & { calls: number } => {
    const s = {
      calls: 0,
      filings: async () => [],
      financials: async () => {
        s.calls++;
        return impl();
      },
    };
    return s;
  };
  const SECF: SecFinancials = {
    annual: [
      { period: "2022.12", estimate: false, revenue: 100, opIncome: 10 },
      { period: "2023.12", estimate: false, revenue: 150, opIncome: 12 },
    ],
    quarterly: [{ period: "2024.03", estimate: false, revenue: 40 }],
  };
  const down = { status: 500, text: "" };

  it("merges SEC annual/quarterly into Yahoo fundamentals for US tickers", async () => {
    const sec = fakeSec(async () => SECF);
    const f = await new WebProvider(fakeHttp([["quoteSummary", [summary]]]), sec).getFundamentals("FOO");
    expect(f).toMatchObject({ per: 25, marketCap: 50_000, amountUnit: "백만달러", revenueGrowth: 50, opIncomeGrowth: 20 });
    expect(f.annual).toHaveLength(2);
    expect(f.quarterly).toHaveLength(1);
    expect(sec.calls).toBe(1);
  });
  it("never fails because of SEC, and still uses SEC when Yahoo fails", async () => {
    const broken = fakeSec(async () => {
      throw new Error("SEC 접속 실패");
    });
    expect(await new WebProvider(fakeHttp([["quoteSummary", [summary]]]), broken).getFundamentals("FOO")).toEqual({ per: 25, marketCap: 50_000, amountUnit: "백만달러" });
    const yahooDown = await new WebProvider(fakeHttp([["quoteSummary", [down]]]), fakeSec(async () => SECF)).getFundamentals("FOO");
    expect(yahooDown).toMatchObject({ annual: SECF.annual, revenueGrowth: 50 });
    expect(await new WebProvider(fakeHttp([["quoteSummary", [down]]]), broken).getFundamentals("FOO")).toEqual({});
    // SEC 원천이 없으면 예전처럼 야후만
    expect(await new WebProvider(fakeHttp([["quoteSummary", [summary]]])).getFundamentals("FOO")).toEqual({ per: 25, marketCap: 50_000, amountUnit: "백만달러" });
  });
  it("does not ask SEC for Korean codes", async () => {
    const sec = fakeSec(async () => SECF);
    await new WebProvider(fakeHttp([["naver", [down]]]), sec).getFundamentals("005930");
    expect(sec.calls).toBe(0);
  });
  it("works end to end with a real SecClient on the same fake Http", async () => {
    const tickers = JSON.stringify({ "0": { cik_str: 42, ticker: "FOO", title: "Foo Corp" } });
    const usd = (start: string, end: string, val: number, form: string, filed: string) => ({ start, end, val, form, filed });
    const facts = JSON.stringify({
      facts: {
        "us-gaap": {
          Revenues: { units: { USD: [usd("2022-01-01", "2022-12-31", 2e9, "10-K", "2023-02-20"), usd("2023-01-01", "2023-12-31", 2.5e9, "10-K", "2024-02-20")] } },
          OperatingIncomeLoss: { units: { USD: [usd("2022-01-01", "2022-12-31", 4e8, "10-K", "2023-02-20"), usd("2023-01-01", "2023-12-31", 3e8, "10-K", "2024-02-20")] } },
        },
      },
    });
    const http = fakeHttp([["company_tickers", [tickers]], ["companyfacts/CIK0000000042", [facts]], ["quoteSummary", [summary]]]);
    const f = await new WebProvider(http, new SecClient(http, { userAgent: "jusik-test test@example.com" })).getFundamentals("FOO");
    expect(f.annual).toEqual([
      { period: "2022.12", filed: "2023-02-20", estimate: false, revenue: 2000, opIncome: 400 },
      { period: "2023.12", filed: "2024-02-20", estimate: false, revenue: 2500, opIncome: 300 },
    ]);
    expect(f).toMatchObject({ revenueGrowth: 25, opIncomeGrowth: -25, marketCap: 50_000 });
  });

  it("reads holders through the crumb-authenticated quoteSummary", async () => {
    const http = fakeHttp([
      ["quoteSummary/FOO?modules=majorHoldersBreakdown", [{ status: 401, text: "" }, { status: 200, text: HOLDERS }]],
      ["fc.yahoo.com", [{ status: 404, text: "", cookies: ["A3=abc; Domain=.yahoo.com; Path=/"] }]],
      ["getcrumb", ["CRUMB9"]],
    ]);
    const h = await new WebProvider(http).getUsHolders("FOO");
    expect(h.institutionsPct).toBe(61.93);
    expect(http.calls.some((c: string) => c.includes("modules=majorHoldersBreakdown") && c.includes("crumb=CRUMB9"))).toBe(true);
    expect(usFlowSignals(h).notes.at(-1)!.rule).toBe("3.4 강영현");
  });
  it("returns empty holders for Korean codes and surfaces Yahoo errors", async () => {
    const http = fakeHttp([]);
    expect(await new WebProvider(http).getUsHolders("005930")).toEqual({});
    expect(http.calls).toHaveLength(0);
    await expect(new WebProvider(fakeHttp([["quoteSummary", [down]]])).getUsHolders("FOO")).rejects.toBeInstanceOf(HttpError);
  });
});
