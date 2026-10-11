import { describe, expect, it } from "vitest";
import {
  candleMasterEvidence, DAYTRADE_CELLS, dayTradeEvidence, followedRules, marketSession, scoreDayTrade, shortDateKo, signalStats, weinsteinEvidence,
  type Analysis, type Candle, type CandleMasterResult, type DayTradeCandidate,
} from "../src";

// 아래 값은 모두 테스트용으로 만든 값이다(실제 종목 데이터 아님).

function risingCandles(n: number): Candle[] {
  const out: Candle[] = [];
  let px = 10_000;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const open = px;
    // 오르내리며 완만히 오르는 흐름(RSI 과열을 피한다), 마지막 봉은 +6% 거래량 급증
    const close = last ? px * 1.06 : px * (i % 2 ? 0.99 : 1.0115);
    out.push({
      date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), open,
      high: last ? close * 1.002 : Math.max(open, close) * 1.003, low: Math.min(open, close) * 0.997, close, volume: last ? 600_000 : 100_000,
    });
    px = close;
  }
  return out;
}

const cand = (over: Partial<DayTradeCandidate> = {}): DayTradeCandidate => ({
  code: "000001", name: "가상종목", market: "KOSPI", asOf: "2024-03-18", price: 10_000, changePct: 5, volume: 1, tradeValue: 1, volumeRatio: 2.3, score: 80,
  entry: 10_000, stop: 9_700, target: 10_600, stopPct: 3, targetPct: 6, netRR: 1.8, maxHoldDays: 3, notes: [], ...over,
});

describe("dayTradeEvidence", () => {
  it("builds the six cells in a fixed order from structured checks", () => {
    const r = scoreDayTrade({ code: "000001", name: "가상종목", market: "KOSPI" }, risingCandles(60), "BULL", { minTradeValue: 1, minScore: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidate.checks).toMatchObject({ volume2x: true, breakout20: true, regime: true });
    const ev = dayTradeEvidence(r.candidate);
    expect(ev.cells.map((c) => c.id)).toEqual(DAYTRADE_CELLS.map((c) => c.id));
    expect(ev.total).toBe(6);
    expect(ev.met).toBe(ev.cells.filter((c) => c.state === "met").length);
    expect(ev.headline).toContain("20일 고점 돌파");
    expect(ev.strategyName).toBe("단타 돌파");
  });

  it("marks the regime cell as no data when the market regime is unknown", () => {
    const ev = dayTradeEvidence(cand({ checks: { volume2x: true, breakout20: false, trend: true, closeHigh: false, momentum: true, regime: null } }));
    expect(ev.cells.map((c) => c.state)).toEqual(["met", "unmet", "met", "unmet", "met", "na"]);
    expect(ev.met).toBe(3);
  });

  it("falls back to note text for candidates saved before checks existed", () => {
    const ev = dayTradeEvidence(cand({ notes: [{ tone: "good", text: "직전 20일 고점 돌파" }, { tone: "bad", text: "시장 국면 약세 — 단타도 성공률이 떨어지는 구간" }] }));
    const by = Object.fromEntries(ev.cells.map((c) => [c.id, c.state]));
    expect(by).toMatchObject({ volume2x: "met", breakout20: "met", trend: "unmet", momentum: "met", regime: "unmet" });
  });
});

describe("weinsteinEvidence / candleMasterEvidence", () => {
  const a = {
    timing: { stage: 2, breakout: true, slopePct: 1.2, close: 110, ma30: 100, pctFromMa: 10, volumeRatio: 2.5, rs: 0.3 },
    screening: { growthGroup: null },
    posture: { posture: "DEFENSE", exposureCapPct: 30 },
  } as unknown as Analysis;

  it("maps stage, volume, RS, earnings and regime into cells", () => {
    const ev = weinsteinEvidence(a);
    expect(ev.cells.map((c) => [c.id, c.state])).toEqual([
      ["ma30Rising", "met"], ["aboveMa30", "met"], ["volume2x", "met"], ["rs", "met"], ["earnings", "na"], ["regime", "unmet"],
    ]);
    expect(ev.headline).toBe("2단계 돌파");
    expect(ev.cells.find((c) => c.id === "regime")!.detail).toContain("방어");
    expect(ev.cells.every((c) => c.rule)).toBe(true);
  });

  it("describes a candle-master result and returns null without one", () => {
    expect(candleMasterEvidence(null)).toBeNull();
    const r = { wave: { ok: true }, group: { compact: true }, signals: [{ name: "양봉 스프링" }], stopPct: 25, waitPrice: 50, standard: false } as unknown as CandleMasterResult;
    const ev = candleMasterEvidence(r)!;
    expect(ev.cells.map((c) => c.state)).toEqual(["met", "met", "met", "unmet", "unmet"]);
    expect(ev.headline).toBe("양봉 스프링");
  });
});

describe("signalStats", () => {
  it("computes count, win rate and payoff", () => {
    const s = signalStats({ trades: [{ returnPct: 10 }, { returnPct: -5 }, { returnPct: 6 }, { returnPct: -3 }] as never });
    expect(s.count).toBe(4);
    expect(s.winRatePct).toBe(50);
    expect(s.payoff).toBeCloseTo(8 / 4, 9);
    expect(signalStats(null)).toEqual({ count: 0, winRatePct: null, payoff: null, avgReturnPct: null });
    expect(signalStats({ trades: [{ returnPct: 3 }] as never }).payoff).toBeNull();
  });
});

describe("marketSession", () => {
  const at = (iso: string) => new Date(iso);
  it("covers each state", () => {
    expect(marketSession("KR", at("2024-03-17T23:30:00Z"))).toMatchObject({ state: "pre", label: "장 시작 전", sub: "전일 종가 기준" }); // 월 08:30 KST
    expect(marketSession("KR", at("2024-03-18T01:00:00Z")).state).toBe("open"); // 10:00
    expect(marketSession("KR", at("2024-03-18T06:35:00Z"))).toMatchObject({ state: "closed", sub: "15:30 종가" }); // 15:35
    expect(marketSession("KR", at("2024-03-18T07:00:00Z"))).toMatchObject({ state: "after", label: "시간외" }); // 16:00
    expect(marketSession("KR", at("2024-03-18T10:00:00Z")).state).toBe("closed"); // 19:00
    expect(marketSession("KR", at("2024-03-16T03:00:00Z"))).toMatchObject({ state: "holiday", nextOpen: "2024-03-18", sub: "다음 거래일 3.18(월)" }); // 토
    expect(marketSession("US", at("2024-03-18T12:00:00Z"))).toMatchObject({ state: "after", sub: "프리마켓" }); // 08:00 ET
    expect(marketSession("US", at("2024-03-18T14:00:00Z")).state).toBe("open"); // 10:00 ET
    expect(marketSession("US", at("2024-03-18T21:00:00Z"))).toMatchObject({ state: "after", sub: "애프터마켓" }); // 17:00 ET
    expect(shortDateKo("2026-10-12")).toBe("10.12(월)");
  });
});

describe("followedRules", () => {
  it("uses server violations first, then the self check", () => {
    expect(followedRules({ violations: ["손절가 미입력"] })).toBe(false);
    expect(followedRules({ selfCheck: { stopSet: true, weightOk: true, unplanned: false } })).toBe(true);
    expect(followedRules({ selfCheck: { stopSet: true, weightOk: true, unplanned: true } })).toBe(false);
    expect(followedRules({ source: "자동(모의)" })).toBe(true);
    expect(followedRules({ source: "수동" })).toBeNull();
  });
});
