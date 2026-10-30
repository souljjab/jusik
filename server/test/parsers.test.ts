import { describe, expect, it } from "vitest";
import { parseFchart, parseRealtime } from "../src/naver";
import { parseYahooChart, parseYahooFundamentals, parseYahooScreener, parseYahooSearch } from "../src/yahoo";

// ⚠ 아래 샘플은 사이트 응답 형식을 흉내 낸 것이다. 네이버 순위표·재무·수급·공시·업종은 실제 응답으로 만든 naverApi.test.ts에서 본다.

describe("naver parsers", () => {
  it("parses fchart xml, sorts and skips junk", () => {
    const xml = `<?xml version="1.0"?><protocol><chartdata symbol="005930" name="삼성전자">
      <item data="20240103|78500|79500|77800|78200|12345678" />
      <item data="20240102|78000|78900|77500|78500|11111111" />
      <item data="20240104|0|0|0|0|0" />
    </chartdata></protocol>`;
    const c = parseFchart(xml);
    expect(c.map((x) => x.date)).toEqual(["2024-01-02", "2024-01-03"]);
    expect(c[1]).toEqual({ date: "2024-01-03", open: 78500, high: 79500, low: 77800, close: 78200, volume: 12345678 });
    expect(parseFchart("<html>blocked</html>")).toEqual([]);
  });

  it("parses the realtime json", () => {
    const text = JSON.stringify({ resultCode: "success", result: { areas: [{ name: "SERVICE_ITEM", datas: [{ cd: "005930", nm: "삼성전자", nv: 78200, cv: -300, cr: -0.38, aq: 123456 }, { cd: "000000", nv: 0 }] }] } });
    expect(parseRealtime(text)).toEqual([{ code: "005930", name: "삼성전자", price: 78200, change: -300, changePct: -0.38, volume: 123456 }]);
    expect(parseRealtime("<html>")).toEqual([]);
  });
});

describe("yahoo parsers", () => {
  const chart = JSON.stringify({
    chart: { result: [{ meta: { regularMarketPrice: 190.5, chartPreviousClose: 188, shortName: "Apple Inc.", gmtoffset: -18000, fullExchangeName: "NasdaqGS" },
      timestamp: [1704205800, 1704292200, 1704378600], // 2024-01-02, 01-03, 01-04 장 시작(UTC)
      indicators: { quote: [{ open: [187, 184, null], high: [188, 185, null], low: [183, 183, null], close: [185.6, 184.25, null], volume: [82e6, 58e6, null] }] } }] },
  });
  it("parses chart candles, skipping null rows, with exchange-local dates", () => {
    const { candles, meta } = parseYahooChart(chart);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({ date: "2024-01-02", open: 187, high: 188, low: 183, close: 185.6, volume: 82e6 });
    expect(meta).toMatchObject({ price: 190.5, previousClose: 188, name: "Apple Inc." });
    expect(parseYahooChart("not json").candles).toEqual([]);
    expect(parseYahooChart(JSON.stringify({ chart: { result: null, error: { code: "Not Found" } } })).candles).toEqual([]);
  });
  it("parses the screener, dropping non-equities", () => {
    const text = JSON.stringify({ finance: { result: [{ quotes: [
      { symbol: "NVDA", shortName: "NVIDIA", quoteType: "EQUITY", regularMarketPrice: 900, regularMarketChangePercent: 4.2, regularMarketVolume: 50_000_000 },
      { symbol: "SPY", quoteType: "ETF", regularMarketPrice: 500, regularMarketVolume: 1 },
      { symbol: "BAD", regularMarketPrice: -1 },
    ] }] } });
    expect(parseYahooScreener(text)).toEqual([{ code: "NVDA", name: "NVIDIA", market: "US", price: 900, changePct: 4.2, volume: 50_000_000, tradeValue: 45_000_000_000 }]);
    expect(parseYahooScreener("{}")).toEqual([]);
  });
  it("parses search results, keeping US equities only", () => {
    const text = JSON.stringify({ quotes: [
      { symbol: "AAPL", shortname: "Apple Inc.", quoteType: "EQUITY", exchDisp: "NASDAQ" },
      { symbol: "005930.KS", shortname: "Samsung", quoteType: "EQUITY", exchDisp: "KSE" },
      { symbol: "AAPLX", quoteType: "MUTUALFUND", exchDisp: "NASDAQ" },
    ] });
    expect(parseYahooSearch(text)).toEqual([{ code: "AAPL", name: "Apple Inc.", market: "US" }]);
  });
  it("parses fundamentals (percent conversion)", () => {
    const text = JSON.stringify({ quoteSummary: { result: [{ summaryDetail: { trailingPE: { raw: 28.5 } }, defaultKeyStatistics: { priceToBook: { raw: 40 }, trailingEps: { raw: 6.1 } }, financialData: { returnOnEquity: { raw: 1.5 }, revenueGrowth: { raw: 0.08 }, debtToEquity: { raw: 150 } } }] } });
    expect(parseYahooFundamentals(text)).toMatchObject({ per: 28.5, pbr: 40, eps: 6.1, roe: 150, revenueGrowth: 8, debtRatio: 150 });
    expect(parseYahooFundamentals("oops")).toEqual({});
  });
});
