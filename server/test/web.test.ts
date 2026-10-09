import { describe, expect, it } from "vitest";
import { createHttp, HttpError, type Http } from "../src/http";
import { WebProvider } from "../src/webProvider";

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
