import { describe, expect, it } from "vitest";
import { APP_DAYTRADE_RULE, dayTradeEvidence, netOf, nextWeekday, signedPct, tradingGuards, type DayTradeCandidate } from "../src";

// 리뷰 수정(흐름): 근거 출처·등락률 표기, 순손익 읽기, 다음 거래일, 가드 까닭

const cand = (over: Partial<DayTradeCandidate> = {}): DayTradeCandidate => ({
  code: "000001", name: "가상종목", market: "KOSPI", asOf: "2024-03-18", price: 10_000, changePct: 6, volume: 1, tradeValue: 1, volumeRatio: 2.3, score: 80,
  entry: 10_000, stop: 9_700, target: 10_600, stopPct: 3, targetPct: 6, netRR: 1.8, maxHoldDays: 3, notes: [],
  checks: { volume2x: true, breakout20: true, trend: true, closeHigh: true, momentum: true, regime: true }, ...over,
});

describe("day-trade evidence sources and numbers (R061·R112)", () => {
  it("gives every cell a source: catalog rules by number, the rest as the app's own day-trade rule", () => {
    const ev = dayTradeEvidence(cand());
    expect(Object.fromEntries(ev.cells.map((c) => [c.id, c.rule]))).toEqual({
      volume2x: APP_DAYTRADE_RULE, breakout20: APP_DAYTRADE_RULE, trend: "4.7 강창권", closeHigh: APP_DAYTRADE_RULE, momentum: APP_DAYTRADE_RULE, regime: "M1 시장 국면",
    });
  });
  it("writes today's change with a sign and two decimals, and the verb follows the sign", () => {
    const by = (pct: number) => dayTradeEvidence(cand({ changePct: pct })).cells.find((c) => c.id === "momentum")!.detail;
    expect(by(6)).toBe("오늘 +6.00% 올랐어요(기준 3~10%)");
    expect(by(3.6)).toBe("오늘 +3.60% 올랐어요(기준 3~10%)");
    expect(by(-1.5)).toBe("오늘 -1.50% 내렸어요(기준 3~10%)");
    expect(by(0)).toBe("오늘 0.00%로 그대로예요(기준 3~10%)");
  });
  it("formats signed percentages like the screens' fmtPct", () => {
    expect([signedPct(3.176), signedPct(-1.4), signedPct(0), signedPct(-0.001)]).toEqual(["+3.18%", "-1.40%", "0.00%", "0.00%"]);
  });
});

describe("netOf (R064)", () => {
  it("reads the paper engine's '순손익 X (x%)' text but not a percentage in a manual review", () => {
    expect(netOf({ review: "수수료·세금·슬리피지 반영 순손익 -3021.5 (-3.02%)" })).toEqual({ pnl: -3021.5, pct: -3.02 });
    expect(netOf({ review: "목표가 (+5%) 기대했는데 손절" })).toEqual({ pnl: null, pct: null });
    expect(netOf({ review: "손절가 이탈해서 정리 (-5%)" })).toEqual({ pnl: null, pct: null });
  });
});

describe("guard reasons and rest end (R031·R074)", () => {
  it("finds the next weekday", () => {
    expect(nextWeekday("2024-03-14")).toBe("2024-03-15"); // 목 → 금
    expect(nextWeekday("2024-03-15")).toBe("2024-03-18"); // 금 → 월
    expect(nextWeekday("2024-03-16")).toBe("2024-03-18"); // 토 → 월
  });
  it("says why entries are blocked", () => {
    const base = { closedReturnsPct: [], todayPnl: 0, equityStartOfDay: 10_000_000, riskPct: 1, maxWeightPct: 20 };
    expect(tradingGuards({ ...base, todayPnl: -500_000 }).reasons).toEqual(["dailyLoss"]);
    expect(tradingGuards({ ...base, closedReturnsPct: [-1, -1, -1] }).reasons).toEqual(["streak"]);
    expect(tradingGuards({ ...base, todayPnl: -500_000, closedReturnsPct: [-1, -1, -1] }).reasons).toEqual(["dailyLoss", "streak"]);
    expect(tradingGuards(base).reasons).toBeUndefined();
  });
});
