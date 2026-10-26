import { describe, expect, it } from "vitest";
import type { Candle, DayTradeCandidate, MacroSnapshot, PaperPosition } from "@jusik/shared";
import {
  breadthStateOf, candidateFilters, capSource, currenciesOf, enabledMarkets, filterCandidates, indexSeries, lastMacdCross, macroItems,
  pickMarket, regimeReasons, scoreParts, srIndex, unrealized,
} from "../src/screens/home/homeModel";

/** 평일만 이어지는 일봉(종가는 f(i)) */
function candles(n: number, f: (i: number) => number, start = "2024-01-01"): Candle[] {
  const out: Candle[] = [];
  let t = Date.parse(start);
  while (out.length < n) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const c = f(out.length);
      out.push({ date: d.toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 });
    }
    t += 86_400_000;
  }
  return out;
}

function cand(code: string, checks: Partial<NonNullable<DayTradeCandidate["checks"]>>, score = 70): DayTradeCandidate {
  return {
    code, name: code, market: "KOSPI", asOf: "2024-05-01", price: 10_000, changePct: 4, volume: 1, tradeValue: 1, volumeRatio: 2.5, score,
    entry: 10_000, stop: 9_500, target: 11_000, stopPct: 5, targetPct: 10, netRR: 2, maxHoldDays: 3, notes: [],
    checks: { volume2x: true, breakout20: false, trend: true, closeHigh: false, momentum: true, regime: true, ...checks },
  };
}

describe("markets", () => {
  it("uses enabled markets in fixed order, falls back to scan markets then KOSPI", () => {
    expect(enabledMarkets({ markets: { US: true, KOSPI: true, KOSDAQ: false } })).toEqual(["KOSPI", "US"]);
    expect(enabledMarkets({ markets: { US: false, KOSPI: false, KOSDAQ: false } }, { markets: ["KOSDAQ"] })).toEqual(["KOSDAQ"]);
    expect(enabledMarkets(null)).toEqual(["KOSPI"]);
    expect(pickMarket("US", ["KOSPI"])).toBe("KOSPI");
    expect(pickMarket("KOSDAQ", ["KOSPI", "KOSDAQ"])).toBe("KOSDAQ");
    expect(currenciesOf(["KOSDAQ", "US"])).toEqual(["KRW", "USD"]);
    expect(currenciesOf(["US"])).toEqual(["USD"]);
  });
  it("names where the applied cap came from", () => {
    expect(capSource("KRW", ["KOSPI", "KOSDAQ", "US"])).toBe("코스피·코스닥 중 낮은 쪽");
    expect(capSource("USD", ["KOSPI"])).toContain("중립 상한");
    expect(capSource("USD", ["US"])).toBe("미국 기준");
  });
});

describe("regime reasons (지도서 그림 4 D)", () => {
  it("writes the 30-week line and MACD cross sentences", () => {
    const r = regimeReasons({ stageRegime: "BULL", macdBullish: false, choppy: false }, { dir: "down", barsAgo: 3 });
    expect(r.map((x) => x.long)).toEqual(["지수는 30주선 위에서 상승 중이에요", "MACD는 3일 전 하락 교차했어요"]);
    expect(r.map((x) => x.short).join(", ")).toBe("지수 30주선 위, MACD 하락 교차");
  });
  it("ignores a cross that disagrees with the verdict and handles missing data", () => {
    const r = regimeReasons({ stageRegime: null, macdBullish: true, choppy: true }, { dir: "down", barsAgo: 1 });
    expect(r[0]!.long).toContain("30주선 판정은 빠졌어요");
    expect(r[1]!.long).toBe("MACD가 시그널 위에 있어요(교차가 잦아 횡보장일 수 있어요)");
    expect(regimeReasons({ stageRegime: "BEAR", macdBullish: null, choppy: false })).toHaveLength(1);
  });
  it("finds the last MACD cross", () => {
    // 점점 빨리 오르다가(MACD가 시그널 위) 마지막 15봉 동안 내리면 시그널 아래로 내려간다
    const c = candles(120, (i) => (i < 105 ? 100 + (i * i) / 50 : 320 - (i - 105) * 6));
    const x = lastMacdCross(c.map((k) => k.close));
    expect(x?.dir).toBe("down");
    expect(x!.barsAgo).toBeGreaterThanOrEqual(0);
    expect(x!.barsAgo).toBeLessThan(15);
    expect(lastMacdCross([1, 2, 3])).toBeNull();
  });
});

describe("index chart series", () => {
  it("weekly close with a 30-week line computed before trimming", () => {
    const c = candles(750, (i) => 1000 + i);
    const s = indexSeries(c, "W");
    expect(s.maLabel).toBe("30주선");
    expect(s.close.length).toBe(104);
    // 앞에서 자르기 전에 계산하므로 보이는 구간 전부에 30주선이 있다
    expect(s.ma.length).toBe(104);
    expect(s.ma.at(-1)!.value).toBeLessThan(s.close.at(-1)!.value);
    expect(s.close.at(-1)!.time).toBe(c.at(-1)!.date);
  });
  it("daily and monthly variants", () => {
    const c = candles(300, (i) => 50 + (i % 7));
    expect(indexSeries(c, "D").close.length).toBe(250);
    expect(indexSeries(c, "D").maLabel).toBe("150일선");
    const m = indexSeries(c, "M");
    expect(m.maLabel).toBe("7개월선");
    expect(m.close.length).toBeGreaterThanOrEqual(13);
    expect(new Set(m.close.map((p) => p.time.slice(0, 7))).size).toBe(m.close.length);
  });
});

describe("candidate filter chips", () => {
  const list = [cand("A", { breakout20: true }), cand("B", { breakout20: false, closeHigh: true }), cand("C", {})];
  it("only offers cells that actually split the list, in strip order", () => {
    const chips = candidateFilters(list);
    // 거래량 2배·정배열·적정 상승폭·국면은 셋 다 충족이라 거르지 못한다
    expect(chips.map((c) => [c.id, c.count])).toEqual([["breakout20", 1], ["closeHigh", 1]]);
    expect(candidateFilters([])).toEqual([]);
  });
  it("filters by a met cell", () => {
    expect(filterCandidates(list, "breakout20").map((c) => c.code)).toEqual(["A"]);
    expect(filterCandidates(list, null)).toHaveLength(3);
  });
});

describe("score breakdown and states", () => {
  it("lists the five parts in order, treating a missing breadth as 0", () => {
    const parts = scoreParts({ stage: 2, macd: -1, rsi: 0, macro: -1 });
    expect(parts.map((p) => p.key)).toEqual(["stage", "macd", "rsi", "macro", "breadth"]);
    expect(parts.reduce((a, p) => a + p.value, 0)).toBe(0);
    expect(parts.find((p) => p.key === "macro")!.max).toBe(0);
  });
  it("reads the breadth state left by a scan", () => {
    expect(breadthStateOf({}, "KOSPI")).toBe("old");
    expect(breadthStateOf({ breadth: {} }, "KOSPI")).toBe("none");
    expect(breadthStateOf({ breadth: { KOSPI: null } }, "KOSPI")).toBe("pending");
  });
});

describe("macro items", () => {
  const s: MacroSnapshot = {
    asOf: "2024-05-01",
    yieldSpread: { value: -0.3, date: "2024-05-01" },
    vix: { value: 31.2, date: "2024-05-01" },
    us10y: { value: 4.5, date: "2024-05-01" },
    us10yChange6m: 0.62,
    rateRising: true,
    krwPerUsd: { value: 1380, date: "2024-05-01" },
    krwChange20dPct: 3.4,
    ism: { value: 48.7, month: "2024-04", date: "2024-05-01", source: "ISM" },
  };
  it("flags values past their thresholds", () => {
    const items = macroItems(s, "KR");
    const by = (l: string) => items.find((x) => x.label.startsWith(l))!;
    expect(by("장단기").warn).toBe(true);
    expect(by("장단기").value).toBe("-0.30%p 역전");
    expect(by("VIX").warn).toBe(true);
    expect(by("금리 추세").tag).toBe("금리 상승기");
    expect(by("원/달러").warn).toBe(true);
    expect(by("ISM").value).toBe("48.7 수축");
    expect(by("초과 유동성").value).toBe("-");
  });
  it("does not warn about the won for US markets", () => {
    expect(macroItems(s, "US").find((x) => x.label.startsWith("원/달러"))!.warn).toBe(false);
  });
});

describe("positions", () => {
  it("sums unrealized P&L against cost", () => {
    const p = (lastPrice: number | undefined, entryPrice: number, qty: number, cost: number) => ({ code: "X", name: "X", openedAt: "", entryDate: "", entryPrice, qty, stop: 1, target: 2, maxHoldDays: 3, cost, lastPrice, reason: "" }) as PaperPosition;
    const u = unrealized([p(110, 100, 10, 1000), p(undefined, 50, 10, 500)]);
    expect(u.pnl).toBe(100);
    expect(u.pct).toBeCloseTo(6.667, 2);
    expect(unrealized([]).pct).toBeNull();
  });
  it("reads an index for screen readers", () => {
    expect(srIndex("코스피", 2731.52, 0.84)).toBe("코스피 2,731.52, 0.84% 상승");
    expect(srIndex("코스닥", 812.4, -0.31)).toBe("코스닥 812.40, 0.31% 하락");
  });
});
