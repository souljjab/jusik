import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flowSignals } from "@jusik/shared/src/flows";
import type { GetOptions, Http } from "../src/http";
import { HttpError } from "../src/http";
import {
  NAVER_API,
  naverDate,
  naverFundamentals,
  naverNum,
  parseEok,
  parseNaverDisclosures,
  parseNaverFinanceTable,
  parseNaverIndustries,
  parseNaverIndustryGroup,
  parseNaverIntegration,
  parseNaverMarketValue,
  parseNaverStockList,
  parseNaverStockListPage,
  parseNaverTrend,
  parseNaverUpDown,
} from "../src/naverApi";
import { fetchDisclosures, fetchInvestorFlows, fetchItemSector, fetchSectors } from "../src/naverExtra";

/*
 * 네이버페이 증권 모바일 JSON API 파서. test/fixtures/naver는 2026-10-30 실제 응답을 줄인 것이다(목록은 몇 줄만 남김).
 */
const fx = (name: string) => readFileSync(join(__dirname, "fixtures/naver", name), "utf8");

describe("naverNum / parseEok / naverDate", () => {
  it("reads signed numbers with separators and units", () => {
    expect(naverNum("+1,742,739")).toBe(1742739);
    expect(naverNum("-4.96")).toBe(-4.96);
    expect(naverNum("9.89배")).toBe(9.89);
    expect(naverNum("22,292원")).toBe(22292);
    expect(naverNum("46.15%")).toBe(46.15);
    expect(naverNum("-")).toBeUndefined();
    expect(naverNum("N/A")).toBeUndefined();
    expect(naverNum(undefined)).toBeUndefined();
  });
  it("reads 조·억 amounts as 억 원 and refuses unit-less numbers", () => {
    expect(parseEok("1,289조 1,044억")).toBe(12_891_044);
    expect(parseEok("5,616억원")).toBe(5616);
    expect(parseEok("1조")).toBe(10_000);
    expect(parseEok("5,616")).toBeUndefined();
    expect(parseEok("5,616", true)).toBe(5616);
    expect(parseEok("0억원")).toBeUndefined();
  });
  it("normalizes bizdate and datetime", () => {
    expect(naverDate("20261030")).toBe("2026-10-30");
    expect(naverDate("2026-10-29T06:52:29")).toBe("2026-10-29");
    expect(naverDate("x")).toBeUndefined();
  });
});

describe("stock lists (거래량·상승률 상위, 시가총액 순위)", () => {
  it("keeps stocks only, with signed change and trade value from 백만 원", () => {
    const rows = parseNaverStockList(fx("quantTop-KOSPI.json"), "KOSPI");
    expect(rows.map((r) => r.name)).toEqual(["삼성전자", "대우건설"]);
    expect(rows[0]).toEqual({ code: "005930", name: "삼성전자", market: "KOSPI", price: 220_500, changePct: -4.96, volume: 19_485_781, tradeValue: 4_336_878_000_000 });
  });
  it("drops ETF and ETN rows from the rise list", () => {
    const rows = parseNaverStockList(fx("up-KOSPI.json"), "KOSDAQ");
    expect(rows.map((r) => [r.code, r.changePct, r.market])).toEqual([["051630", 30, "KOSDAQ"], ["093240", 29.94, "KOSDAQ"]]);
    // 다음 쪽이 있는지는 영숫자 코드 ETF(0197X0)까지 센 전체 줄 수로 본다
    expect(parseNaverStockListPage(fx("up-KOSPI.json"), "KOSPI").raw).toBe(4);
  });
  it("lists market-value ranking in order without ETFs (preferred shares are filtered by name later)", () => {
    expect(parseNaverMarketValue(fx("marketValue-KOSPI.json")).map((r) => r.name)).toEqual(["삼성전자", "SK하이닉스", "삼성전자우", "SK스퀘어", "삼성전기", "LG에너지솔루션"]);
  });
  it("returns [] for blocked or changed responses", () => {
    for (const bad of ["", "<html>점검 중</html>", "{}", JSON.stringify({ stocks: [{ itemCode: "x" }] })]) {
      expect(parseNaverStockList(bad, "KOSPI")).toEqual([]);
      expect(parseNaverMarketValue(bad)).toEqual([]);
    }
  });
});

describe("fundamentals (종목 요약 + 연간·분기 실적)", () => {
  it("reads current PER·PBR·EPS·BPS, market cap and industry code from the summary", () => {
    expect(parseNaverIntegration(fx("integration-005930.json"))).toEqual({ per: 9.89, pbr: 2.56, eps: 22_292, bps: 86_052, marketCap: 12_891_044, industryCode: "278" });
  });
  it("orders periods and marks the consensus column", () => {
    const t = parseNaverFinanceTable(fx("finance-annual-005930.json"))!;
    expect(t.periods.map((p) => `${p.label}${p.estimate ? "(E)" : ""}`)).toEqual(["2023.12", "2024.12", "2025.12", "2026.12(E)"]);
    expect(t.rows.get("매출액")!["202512"]).toBe(3_336_059);
  });
  it("combines into Fundamentals in 억 원 with confirmed ratios and growth", () => {
    const f = naverFundamentals(fx("integration-005930.json"), fx("finance-annual-005930.json"), fx("finance-quarter-005930.json"));
    expect(f).toMatchObject({ per: 9.89, pbr: 2.56, eps: 22_292, bps: 86_052, roe: 10.85, debtRatio: 29.94, quickRatio: 183.27, reserveRatio: 45_296.17, marketCap: 12_891_044, amountUnit: "억원" });
    // 확정 연간 2024 → 2025: 매출 3,008,709 → 3,336,059(+10.9%), 영업이익 327,260 → 436,011(+33.2%)
    expect(f.revenueGrowth).toBeCloseTo(10.88, 1);
    expect(f.opIncomeGrowth).toBeCloseTo(33.23, 1);
    expect(f.annual!.map((p) => p.period)).toEqual(["2023.12", "2024.12", "2025.12", "2026.12"]);
    expect(f.annual!.at(-1)).toMatchObject({ estimate: true, revenue: 7_118_157 });
    expect(f.annual![2]).toEqual({ period: "2025.12", estimate: false, revenue: 3_336_059, opIncome: 436_011, netIncome: 452_068, eps: 6_564 });
    expect(f.quarterly!.map((p) => p.period)).toEqual(["2025.06", "2025.09", "2025.12", "2026.03", "2026.06", "2026.09"]);
    expect(f.sectorPer).toBeUndefined(); // 이 API에는 동일업종 PER이 없다
  });
  it("falls back to the confirmed annual PER when the summary is missing, and returns {} when everything failed", () => {
    const f = naverFundamentals(null, fx("finance-annual-005930.json"), null);
    expect(f.per).toBe(18.27);
    expect(f.quarterly).toBeUndefined();
    expect(naverFundamentals(null, null, null)).toEqual({});
    expect(naverFundamentals("<html>", "{}", "")).toEqual({});
  });
});

describe("investor flows, disclosures, industries, up/down counts", () => {
  it("reads daily net buying ascending with the foreign holding ratio", () => {
    const f = parseNaverTrend(fx("trend-005930.json"));
    expect(f.map((x) => x.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(f.at(-1)).toEqual({ date: "2026-10-30", close: 220_500, volume: 19_485_781, institutionNet: 1_742_739, foreignNet: -1_072_820, foreignHoldPct: 46.15 });
    expect(parseNaverTrend("<html>")).toEqual([]);
  });
  it("feeds flowSignals directly", () => {
    const rows = Array.from({ length: 6 }, (_, k) => ({ bizdate: `202403${10 + k}`, closePrice: "10,000", accumulatedTradingVolume: "10,000", organPureBuyQuant: "+400", foreignerPureBuyQuant: "+400" }));
    expect(flowSignals(parseNaverTrend(JSON.stringify(rows))).score).toBe(2);
  });
  it("reads disclosures newest first", () => {
    const d = parseNaverDisclosures(fx("disclosure-005930.json"));
    expect(d).toHaveLength(5);
    expect(d[0]).toEqual({ date: "2026-10-29", title: "삼성전자(주) 기타 경영사항(자율공시)", source: "네이버" });
    expect(d.every((x, i) => i === 0 || d[i - 1]!.date >= x.date)).toBe(true);
    expect(parseNaverDisclosures("{}")).toEqual([]);
  });
  it("reads industries and an industry's name", () => {
    expect(parseNaverIndustries(fx("industry.json"))[0]).toEqual({ no: "287", name: "소프트웨어", changePct: 4.2 });
    expect(parseNaverIndustryGroup(fx("industry-278.json"))).toEqual({ no: "278", name: "반도체와반도체장비" });
    expect(parseNaverIndustryGroup("{}")).toBeNull();
  });
  it("reads today's exchange-wide up/down counts and refuses incomplete data", () => {
    expect(parseNaverUpDown(fx("index-KOSPI.json"))).toEqual({ upperLimit: 2, up: 234, unchanged: 22, down: 656, lowerLimit: 0 });
    expect(parseNaverUpDown(JSON.stringify({ upDownStockInfo: { riseCount: "1", fallCount: "2" } }))).toBeNull();
    expect(parseNaverUpDown(JSON.stringify({ upDownStockInfo: { upperCount: "0", riseCount: "0", steadyCount: "0", fallCount: "0", lowerCount: "0" } }))).toBeNull();
    expect(parseNaverUpDown("<html>")).toBeNull();
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
  it("fetch flows, disclosures, sectors and the item's sector from the mobile API", async () => {
    const { http, calls } = fakeHttp({
      [NAVER_API.trend("005930", 40)]: fx("trend-005930.json"),
      [NAVER_API.disclosure("005930")]: fx("disclosure-005930.json"),
      [NAVER_API.industries()]: fx("industry.json"),
      [NAVER_API.integration("005930")]: fx("integration-005930.json"),
      [NAVER_API.industry("278")]: fx("industry-278.json"),
    });
    expect(await fetchInvestorFlows(http, "005930")).toHaveLength(5);
    expect((await fetchDisclosures(http, "005930"))[0]!.date).toBe("2026-10-29");
    expect(await fetchSectors(http)).toHaveLength(4);
    expect(await fetchItemSector(http, "005930")).toEqual({ no: "278", name: "반도체와반도체장비" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://m.stock.naver.com/api/stock/005930/trend?pageSize=40",
      "https://m.stock.naver.com/api/stock/005930/disclosure?page=1&pageSize=20",
      "https://m.stock.naver.com/api/stocks/industry?page=1&pageSize=100",
      "https://m.stock.naver.com/api/stock/005930/integration",
      "https://m.stock.naver.com/api/stocks/industry/278?page=1&pageSize=1",
    ]);
    expect(calls.every((c) => c.opt?.encoding === "utf-8" && c.opt.headers?.referer === "https://m.stock.naver.com/")).toBe(true);
  });
  it("asks for 20 days per old page", async () => {
    const { http, calls } = fakeHttp({ [NAVER_API.trend("005930", 60)]: "[]" });
    expect(await fetchInvestorFlows(http, "005930", 3)).toEqual([]);
    expect(calls[0]!.url).toContain("pageSize=60");
  });
  it("skips non-Korean codes without any request, and passes failures through", async () => {
    const { http, calls } = fakeHttp({});
    expect(await fetchInvestorFlows(http, "AAPL")).toEqual([]);
    expect(await fetchDisclosures(http, "AAPL")).toEqual([]);
    expect(await fetchItemSector(http, "AAPL")).toBeNull();
    expect(calls).toHaveLength(0);
    await expect(fetchInvestorFlows(http, "005930")).rejects.toBeInstanceOf(HttpError);
  });
  it("returns null when the summary has no industry code", async () => {
    const { http } = fakeHttp({ [NAVER_API.integration("005930")]: JSON.stringify({ totalInfos: [] }) });
    expect(await fetchItemSector(http, "005930")).toBeNull();
  });
});
