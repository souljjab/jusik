import { describe, expect, it } from "vitest";
import { parseFchart, parseNaverFundamentals, parseRankingTable, parseRealtime } from "../src/naver";
import { parseYahooChart, parseYahooFundamentals, parseYahooScreener, parseYahooSearch } from "../src/yahoo";

// ⚠ 아래 샘플은 사이트 응답 형식을 기억대로 흉내 낸 것이다. 실제 응답과 같은지는 `npm run check:sources`로 확인해야 한다.

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

  const ranking = `<table class="type_2"><tr><th>N</th><th>종목명</th><th>현재가</th><th>전일비</th><th>등락률</th><th>거래량</th><th>거래대금(백만)</th><th>시가총액</th></tr>
    <tr><td class="no">1</td><td><a href="/item/main.naver?code=005930" class="tltle">삼성전자</a></td><td class="number">78,200</td><td class="number"><span class="tah p11 red02">1,000</span></td><td class="number"><span class="tah p11 red01">+1.30%</span></td><td class="number">12,345,678</td><td class="number">965,432</td><td class="number">4,670,000</td></tr>
    <tr><td class="no">2</td><td><a href="/item/main.naver?code=000660" class="tltle">SK하이닉스</a></td><td class="number">130,000</td><td class="number">500</td><td class="number"><span class="tah p11 nv01">-0.38%</span></td><td class="number">2,000,000</td><td class="number">260,000</td><td class="number">900,000</td></tr>
    <tr><td colspan="9" class="blank_08"></td></tr></table>`;
  it("parses the ranking table by header names", () => {
    const rows = parseRankingTable(ranking, "KOSPI");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ code: "005930", name: "삼성전자", market: "KOSPI", price: 78200, changePct: 1.3, volume: 12345678, tradeValue: 965_432_000_000 });
    expect(rows[1]!.changePct).toBe(-0.38);
  });
  it("derives a trade value when the page has no value column and survives column reordering", () => {
    const html = `<table class="type_2"><tr><th>N</th><th>종목명</th><th>거래량</th><th>현재가</th><th>등락률</th></tr>
      <tr><td>1</td><td><a href="/item/main.naver?code=035720">카카오</a></td><td>1,000</td><td>50,000</td><td>+4.00%</td></tr></table>`;
    expect(parseRankingTable(html, "KOSDAQ")[0]).toMatchObject({ code: "035720", price: 50000, volume: 1000, tradeValue: 50_000_000, changePct: 4, market: "KOSDAQ" });
  });
  it("returns [] when the table or headers are missing (site changed)", () => {
    expect(parseRankingTable("<html><body>점검 중</body></html>", "KOSPI")).toEqual([]);
    expect(parseRankingTable(`<table class="type_2"><tr><th>이름</th></tr></table>`, "KOSPI")).toEqual([]);
  });

  it("parses the realtime json", () => {
    const text = JSON.stringify({ resultCode: "success", result: { areas: [{ name: "SERVICE_ITEM", datas: [{ cd: "005930", nm: "삼성전자", nv: 78200, cv: -300, cr: -0.38, aq: 123456 }, { cd: "000000", nv: 0 }] }] } });
    expect(parseRealtime(text)).toEqual([{ code: "005930", name: "삼성전자", price: 78200, change: -300, changePct: -0.38, volume: 123456 }]);
    expect(parseRealtime("<html>")).toEqual([]);
  });

  const fundamentals = `<div class="section cop_analysis"><table><thead>
    <tr><th colspan="4">최근 연간 실적</th><th colspan="6">최근 분기 실적</th></tr>
    <tr><th>2021.12</th><th>2022.12</th><th>2023.12</th><th>2024.12(E)</th><th>2023.06</th></tr></thead><tbody>
    <tr><th class="h_th2">매출액</th><td>2,000,000</td><td>3,000,000</td><td>3,300,000</td><td>3,600,000</td><td>1</td></tr>
    <tr><th class="h_th2">영업이익</th><td>500,000</td><td>600,000</td><td>300,000</td><td>700,000</td><td>1</td></tr>
    <tr><th class="h_th2">부채비율</th><td>40.0</td><td>38.5</td><td>25.4</td><td></td><td></td></tr>
    <tr><th class="h_th2">유보율</th><td>1,000</td><td>1,200</td><td>1,500.5</td><td></td><td></td></tr>
    <tr><th class="h_th2">PER(배)</th><td>9.0</td><td>8.0</td><td>-</td><td>10.5</td><td></td></tr>
    <tr><th class="h_th2">PBR(배)</th><td>1.1</td><td>1.0</td><td>0.9</td><td>0.8</td><td></td></tr>
    <tr><th class="h_th2">ROE(지배주주)</th><td>12.0</td><td>10.0</td><td>8.5</td><td>9.0</td><td></td></tr>
    </tbody></table></div>`;
  it("reads the latest confirmed annual column and derives growth", () => {
    const f = parseNaverFundamentals(fundamentals);
    expect(f.debtRatio).toBe(25.4);
    expect(f.reserveRatio).toBe(1500.5);
    expect(f.pbr).toBe(0.9);
    expect(f.roe).toBe(8.5);
    expect(f.per).toBe(8); // 2023.12는 '-' 이므로 직전 확정값, 추정치(E)는 쓰지 않는다
    expect(f.revenueGrowth).toBeCloseTo(10);
    expect(f.opIncomeGrowth).toBeCloseTo(-50);
  });
  it("returns {} when the section is absent", () => {
    expect(parseNaverFundamentals("<html></html>")).toEqual({});
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
