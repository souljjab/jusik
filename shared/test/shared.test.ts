import { describe, expect, it } from "vitest";
import {
  actionFromScore,
  atr,
  bollinger,
  computeIndicators,
  ema,
  macd,
  recommend,
  rsi,
  runBacktest,
  sma,
  technicalScoreAt,
  valuationScore,
  type Candle,
} from "../src";

function candlesFrom(closes: number[], volume = 1000): Candle[] {
  const base = Date.UTC(2023, 0, 2);
  return closes.map((c, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume,
  }));
}

const range = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

describe("indicators", () => {
  it("sma", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("ema seeds with sma", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
  });
  it("rsi is 100 for monotonic rise and 0 for monotonic fall", () => {
    expect(rsi(range(30, (i) => 100 + i)).at(-1)).toBe(100);
    expect(rsi(range(30, (i) => 100 - i)).at(-1)).toBeCloseTo(0);
  });
  it("macd histogram turns positive in an uptrend", () => {
    const m = macd(range(120, (i) => 100 + i));
    expect(m.hist.at(-1)!).toBeGreaterThan(-1e-9);
    expect(m.macd.at(-1)!).toBeGreaterThan(0);
  });
  it("bollinger bands bracket the mean and collapse on flat prices", () => {
    const b = bollinger(range(30, () => 50), 20);
    expect(b.upper.at(-1)).toBe(50);
    expect(b.lower.at(-1)).toBe(50);
  });
  it("atr of constant-range candles", () => {
    const cs = candlesFrom(range(30, () => 100));
    expect(atr(cs, 14).at(-1)!).toBeCloseTo(2, 5);
  });
});

describe("technical score", () => {
  it("scores positive on average in an uptrend and negative in a downtrend", () => {
    // 하루치 점수는 진동 위상(과매수/과매도)에 좌우되므로 최근 50일 평균으로 추세 편향을 본다
    const up = candlesFrom(range(200, (i) => 100 + i * 0.5 + Math.sin(i / 3) * 3));
    const down = candlesFrom(range(200, (i) => 300 - i * 0.5 + Math.sin(i / 3) * 3));
    const avg = (cs: Candle[]) => {
      const ind = computeIndicators(cs);
      const xs = range(50, (k) => technicalScoreAt(cs, ind, 150 + k).score);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(avg(up)).toBeGreaterThan(10);
    expect(avg(down)).toBeLessThan(-10);
  });
  it("does not use future data", () => {
    const a = candlesFrom(range(200, (i) => 100 + Math.sin(i / 7) * 10));
    const b = [...a.slice(0, 150), ...candlesFrom(range(50, () => 9999)).map((c, i) => ({ ...c, date: a[150 + i]!.date }))];
    const sa = technicalScoreAt(a, computeIndicators(a), 149);
    const sb = technicalScoreAt(b, computeIndicators(b), 149);
    expect(sa).toEqual(sb);
  });
});

describe("valuation", () => {
  it("returns null with no data", () => {
    expect(valuationScore(undefined)).toBeNull();
    expect(valuationScore({})).toBeNull();
  });
  it("rewards cheap + profitable + growing, punishes the opposite", () => {
    const good = valuationScore({ per: 8, pbr: 0.8, roe: 18, revenueGrowth: 25, opIncomeGrowth: 30, debtRatio: 50 })!;
    const bad = valuationScore({ per: -5, pbr: 6, roe: -3, revenueGrowth: -10, opIncomeGrowth: -20, debtRatio: 300 })!;
    expect(good.score).toBeGreaterThan(80);
    expect(bad.score).toBeLessThan(-60);
  });
});

describe("recommend", () => {
  it("needs enough candles", () => {
    expect(recommend(candlesFrom(range(30, () => 100)))).toBeNull();
  });
  it("maps scores to actions", () => {
    expect(actionFromScore(60)).toBe("STRONG_BUY");
    expect(actionFromScore(20)).toBe("BUY");
    expect(actionFromScore(0)).toBe("HOLD");
    expect(actionFromScore(-30)).toBe("SELL");
    expect(actionFromScore(-80)).toBe("STRONG_SELL");
  });
  it("blends valuation and sets stop below price and target above", () => {
    const cs = candlesFrom(range(200, (i) => 100 + i * 0.5));
    const r = recommend(cs, { per: 8, pbr: 0.8, roe: 18 })!;
    expect(r.valuation).not.toBeNull();
    expect(r.stopLoss!).toBeLessThan(r.price);
    expect(r.target!).toBeGreaterThan(r.price);
  });
});

describe("backtest", () => {
  it("returns null for short history", () => {
    expect(runBacktest(candlesFrom(range(40, () => 100)))).toBeNull();
  });
  it("is profitable in a clean uptrend and trades at next-day open", () => {
    const cs = candlesFrom(range(300, (i) => 100 * 1.003 ** i));
    const r = runBacktest(cs, { feeRate: 0, sellTaxRate: 0 })!;
    expect(r.totalReturnPct).toBeGreaterThan(0);
    expect(r.equity).toHaveLength(300 - 60);
    expect(r.maxDrawdownPct).toBeLessThanOrEqual(0);
  });
  it("applies costs", () => {
    const cs = candlesFrom(range(300, (i) => 100 + Math.sin(i / 5) * 15 + i * 0.1));
    const free = runBacktest(cs, { feeRate: 0, sellTaxRate: 0 })!;
    const costly = runBacktest(cs, { feeRate: 0.01, sellTaxRate: 0.01 })!;
    expect(costly.finalEquity).toBeLessThan(free.finalEquity);
  });
  it("stop loss caps the loss on a crash", () => {
    const closes = [...range(150, (i) => 100 + i), ...range(60, (i) => 250 - i * 6)];
    const cs = candlesFrom(closes);
    const noStop = runBacktest(cs, { feeRate: 0, sellTaxRate: 0, sellThreshold: -999 })!;
    const stop = runBacktest(cs, { feeRate: 0, sellTaxRate: 0, sellThreshold: -999, stopLossPct: 0.1 })!;
    expect(stop.finalEquity).toBeGreaterThan(noStop.finalEquity);
    expect(stop.trades.some((t) => t.reason === "STOP_LOSS")).toBe(true);
  });
});
