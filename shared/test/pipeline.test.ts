import { describe, expect, it } from "vitest";
import {
  analyze,
  detectCandlePatterns,
  downgradeBuy,
  expectancy,
  marketRegime,
  positionSize,
  relativeStrength,
  runStageBacktest,
  screenFundamentals,
  summarizeJournal,
  toWeekly,
  weekKeyOf,
  completedWeeks,
  prepareStage,
  stageAt,
  type Candle,
  type JournalEntry,
} from "../src";

const ramp = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 1)) / n);

/** 주별 종가 수준 배열 -> 월~금 5일짜리 일봉. volAt[주]=그 주 일 거래량 */
function fromWeeks(levels: number[], volAt: Record<number, number> = {}, vol = 1000): Candle[] {
  const out: Candle[] = [];
  levels.forEach((L, w) => {
    for (let d = 0; d < 5; d++) {
      const t = Date.UTC(2022, 0, 3) + (w * 7 + d) * 86_400_000;
      out.push({ date: new Date(t).toISOString().slice(0, 10), open: L, high: L * 1.01, low: L * 0.99, close: L, volume: volAt[w] ?? vol });
    }
  });
  return out;
}

const decline = ramp(100, 70, 60);
const base = Array(40).fill(70) as number[];
const advance = ramp(70, 140, 60);
// 완전히 평평하면 종가가 30주선과 정확히 같아지는 비현실적인 경계가 되므로 조금 출렁이게 한다
const top = Array.from({ length: 40 }, (_, i) => (i % 2 ? 142 : 140));
const fall = ramp(140, 80, 60);

function stageAtWeek(levels: number[], endWeek: number) {
  const weekly = toWeekly(fromWeeks(levels));
  return stageAt(prepareStage(weekly), endWeek)!;
}

describe("weekly", () => {
  it("groups by Monday and drops an in-progress week", () => {
    expect(weekKeyOf("2024-01-05")).toBe("2024-01-01");
    expect(weekKeyOf("2024-01-07")).toBe("2024-01-01");
    const c = fromWeeks([100, 101, 102]);
    const w = toWeekly(c);
    expect(w).toHaveLength(3);
    expect(w[0]).toMatchObject({ startIndex: 0, endIndex: 4 });
    expect(completedWeeks(w)).toHaveLength(3); // 마지막이 금요일
    expect(completedWeeks(toWeekly(c.slice(0, -2)))).toHaveLength(2); // 수요일에 끝남 -> 진행 중
  });
});

describe("Weinstein stage", () => {
  const lv = [...decline, ...base, ...advance, ...top, ...fall];
  it("classifies each phase of a full cycle", () => {
    expect(stageAtWeek(lv, decline.length - 1).stage).toBe(4);
    expect(stageAtWeek(lv, decline.length + base.length - 1).stage).toBe(1);
    expect(stageAtWeek(lv, decline.length + base.length + advance.length - 1).stage).toBe(2);
    expect(stageAtWeek(lv, decline.length + base.length + advance.length + top.length - 1).stage).toBe(3);
    expect(stageAtWeek(lv, lv.length - 1).stage).toBe(4);
  });
  it("stage 4 is a strong sell, stage 2 a buy, flat top a hold", () => {
    expect(stageAtWeek(lv, decline.length - 1).action).toBe("STRONG_SELL");
    expect(["BUY", "STRONG_BUY"]).toContain(stageAtWeek(lv, decline.length + base.length + advance.length - 1).action);
    const topEnd = decline.length + base.length + advance.length + top.length - 1;
    expect(stageAtWeek(lv, topEnd).action).toBe("HOLD");
    // 천장권에서 30주선 아래로 이탈하면 매도
    const broken = [...decline, ...base, ...advance, ...top, 128];
    const r = stageAt(prepareStage(toWeekly(fromWeeks(broken))), broken.length - 1)!;
    expect(r.stage).toBe(3);
    expect(r.action).toBe("SELL");
  });
  it("stop loss is the lowest low of the last 8 weeks", () => {
    const r = stageAtWeek(lv, decline.length - 1);
    const weekly = toWeekly(fromWeeks(lv));
    const lows = weekly.slice(decline.length - 8, decline.length).map((w) => w.low);
    expect(r.stopLoss).toBe(Math.min(...lows));
  });
  it("needs a volume-confirmed breakout from a base", () => {
    const levels = [...decline, ...base, 80]; // 바닥에서 갑자기 +14% 돌파
    const k = levels.length - 1;
    const weak = stageAt(prepareStage(toWeekly(fromWeeks(levels))), k)!;
    const strong = stageAt(prepareStage(toWeekly(fromWeeks(levels, { [k]: 4000 }))), k)!;
    expect(weak.breakout).toBe(true);
    expect(weak.action).toBe("HOLD");
    expect(strong.volumeRatio).toBeCloseTo(4);
    expect(["BUY", "STRONG_BUY"]).toContain(strong.action);
  });
  it("refuses to chase an extended advance", () => {
    const levels = [...decline, ...base, ...ramp(70, 200, 14)];
    const r = stageAt(prepareStage(toWeekly(fromWeeks(levels))), levels.length - 1)!;
    expect(r.pctFromMa).toBeGreaterThan(25);
    expect(r.action).toBe("HOLD");
  });
  it("does not look ahead", () => {
    const a = stageAtWeek(lv, 100);
    const lv2 = [...lv.slice(0, 101), ...Array(60).fill(10)];
    expect(stageAtWeek(lv2, 100)).toEqual(a);
  });
  it("relative strength compares to the index", () => {
    const stockW = toWeekly(fromWeeks(ramp(100, 200, 80)));
    const flatIdx = toWeekly(fromWeeks(Array(80).fill(100)));
    const rs = relativeStrength(stockW, flatIdx);
    expect(rs[10]).toBeNull();
    expect(rs[79]!).toBeGreaterThan(0);
    expect(relativeStrength(stockW, toWeekly(fromWeeks(ramp(100, 400, 80))))[79]!).toBeLessThan(0);
  });
});

describe("market regime and gates", () => {
  const bull = fromWeeks(ramp(100, 160, 80));
  const bear = fromWeeks([...ramp(100, 140, 40), ...ramp(140, 90, 60)]);
  const stockUp = fromWeeks(ramp(100, 160, 80));
  it("bull / bear regime from the index", () => {
    expect(marketRegime(bull)!.regime).toBe("BULL");
    expect(marketRegime(bear)!.regime).toBe("BEAR");
  });
  it("blocks new buys in a bear market and explains why", () => {
    const ok = analyze({ candles: stockUp, indexCandles: bull })!;
    expect(["BUY", "STRONG_BUY"]).toContain(ok.action);
    const gated = analyze({ candles: stockUp, indexCandles: bear })!;
    expect(gated.timingAction).toBe(ok.timingAction);
    expect(gated.action).toBe("HOLD");
    expect(gated.gates.some((g) => g.text.includes("약세"))).toBe(true);
  });
  it("never upgrades a sell because of a good market", () => {
    const falling = fromWeeks(ramp(160, 80, 80));
    const a = analyze({ candles: falling, indexCandles: bull })!;
    expect(a.action).toBe("STRONG_SELL");
  });
  it("downgradeBuy only touches buy actions", () => {
    expect(downgradeBuy("STRONG_BUY")).toBe("BUY");
    expect(downgradeBuy("BUY")).toBe("HOLD");
    expect(downgradeBuy("SELL")).toBe("SELL");
  });
  it("returns null without enough weeks", () => {
    expect(analyze({ candles: fromWeeks(ramp(100, 110, 20)) })).toBeNull();
  });
});

describe("screening", () => {
  it("passes the book thresholds", () => {
    const r = screenFundamentals({ debtRatio: 100, currentRatio: 150, reserveRatio: 500, per: 8, pbr: 0.8, revenueGrowth: 10, opIncomeGrowth: 5 });
    expect(r.grade).toBe("A");
    expect(r.passed).toBe(7);
  });
  it("fails weak balance sheets and unknowns are not failures", () => {
    const bad = screenFundamentals({ debtRatio: 400, currentRatio: 50, reserveRatio: 100, per: 40, pbr: 3, revenueGrowth: -5, opIncomeGrowth: -9 });
    expect(bad.grade).toBe("D");
    const few = screenFundamentals({ per: 5, pbr: 0.5 });
    expect(few.grade).toBe("N/A");
    // PER·PBR만 확인되고 나머지(소프트 체크가 늘어도)는 모두 unknown
    expect(few.checks.filter((c) => c.status === "unknown")).toHaveLength(few.checks.length - 2);
  });
  it("treats negative PER (loss) as fail", () => {
    expect(screenFundamentals({ per: -3 }).checks.find((c) => c.id === "per")!.status).toBe("fail");
  });
});

describe("candle patterns", () => {
  const down = (n: number) => Array.from({ length: n }, (_, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, open: 110 - i, high: 111 - i, low: 108 - i, close: 109 - i, volume: 1000 }));
  it("detects a hammer after a decline with its invalidation price", () => {
    const cs: Candle[] = [...down(8), { date: "2024-01-20", open: 100, high: 100.5, low: 94, close: 100.2, volume: 1500 }];
    const p = detectCandlePatterns(cs);
    expect(p.map((x) => x.id)).toContain("hammer");
    expect(p.find((x) => x.id === "hammer")!.invalidation).toBe(94);
  });
  it("detects bullish engulfing", () => {
    const cs: Candle[] = [...down(8), { date: "2024-01-20", open: 100, high: 101, low: 97, close: 98, volume: 1000 }, { date: "2024-01-21", open: 97.5, high: 103, low: 97, close: 102, volume: 2000 }];
    expect(detectCandlePatterns(cs).map((x) => x.id)).toContain("bullish-engulfing");
  });
  it("finds nothing in quiet data", () => {
    expect(detectCandlePatterns(fromWeeks(Array(10).fill(100)))).toEqual([]);
  });
});

describe("risk", () => {
  it("sizes by stop distance", () => {
    const s = positionSize({ capital: 10_000_000, entry: 10_000, stop: 9_000, riskPct: 1, maxWeightPct: 100, feeRate: 0 })!;
    expect(s.shares).toBe(100); // 손절 시 100주×1,000원 = 100만원(자본 10%)이 아니라 1% = 10만원 => 100주
    expect(s.riskAmount).toBe(100_000);
  });
  it("caps by max weight", () => {
    const s = positionSize({ capital: 10_000_000, entry: 10_000, stop: 9_900, riskPct: 1, maxWeightPct: 20, feeRate: 0 })!;
    expect(s.weightPct).toBeLessThanOrEqual(20);
    expect(s.cappedByWeight).toBe(true);
  });
  it("rejects stop above entry", () => {
    expect(positionSize({ capital: 1e7, entry: 100, stop: 110 })).toBeNull();
  });
  it("expectancy and kelly", () => {
    const e = expectancy({ winRate: 0.4, avgWinPct: 15, avgLossPct: -5, costPct: 0.4 });
    expect(e.expectancyPct).toBeCloseTo(0.4 * 15 - 0.6 * 5 - 0.4);
    expect(e.payoff).toBe(3);
    expect(e.kellyPct).toBeCloseTo((0.4 - 0.6 / 3) * 100);
    expect(e.halfKellyPct).toBeCloseTo(e.kellyPct / 2);
    expect(expectancy({ winRate: 0.2, avgWinPct: 5, avgLossPct: -5 }).kellyPct).toBe(0);
  });
});

describe("journal", () => {
  const e = (id: string, date: string, side: "BUY" | "SELL", price: number, qty: number): JournalEntry => ({ id, code: "005930", name: "삼성전자", date, side, price, qty, reason: "" });
  it("matches FIFO and reports open positions", () => {
    const s = summarizeJournal([e("1", "2024-01-01", "BUY", 100, 10), e("2", "2024-01-02", "BUY", 120, 10), e("3", "2024-02-01", "SELL", 130, 15)]);
    expect(s.closed).toHaveLength(2);
    expect(s.closed[0]).toMatchObject({ qty: 10, pnl: 300 });
    expect(s.closed[1]).toMatchObject({ qty: 5, pnl: 50 });
    expect(s.open).toEqual([{ code: "005930", name: "삼성전자", qty: 5, avgPrice: 120 }]);
    expect(s.winRate).toBe(1);
  });
  it("flags overselling", () => {
    expect(summarizeJournal([e("1", "2024-01-01", "BUY", 100, 1), e("2", "2024-01-02", "SELL", 90, 5)]).oversold).toBe(true);
  });
  it("win rate and average returns", () => {
    const s = summarizeJournal([
      e("1", "2024-01-01", "BUY", 100, 1), e("2", "2024-01-02", "SELL", 110, 1),
      e("3", "2024-01-03", "BUY", 100, 1), e("4", "2024-01-04", "SELL", 95, 1),
    ]);
    expect(s.winRate).toBe(0.5);
    expect(s.avgWinPct).toBeCloseTo(10);
    expect(s.avgLossPct).toBeCloseTo(-5);
  });
});

describe("stage backtest", () => {
  const stock = fromWeeks([...decline, ...base, ...advance, ...top, ...fall]);
  const index = fromWeeks(ramp(100, 180, 260));
  it("enters during the advance and exits before the full decline", () => {
    const r = runStageBacktest(stock, index, { feeRate: 0, sellTaxRate: 0 })!;
    expect(r.trades.length).toBeGreaterThan(0);
    expect(r.trades[0]!.buyPrice).toBeGreaterThan(70);
    // 하락 구간 전체를 들고 있지 않았으므로 단순 보유보다 낫다
    expect(r.totalReturnPct).toBeGreaterThan(r.buyHoldReturnPct);
  });
  it("is unaffected by data after the evaluation day", () => {
    const a = runStageBacktest(stock, index)!;
    const tampered = stock.map((c, i) => (i >= stock.length - 40 ? { ...c, open: 5, high: 6, low: 4, close: 5 } : c));
    const b = runStageBacktest(tampered, index)!;
    const n = stock.length - 40 - (stock.length - a.equity.length);
    expect(b.equity.slice(0, n)).toEqual(a.equity.slice(0, n));
  });
  it("skips entries while the index is in a bear phase", () => {
    const bearIndex = fromWeeks(ramp(200, 80, 260));
    const withGate = runStageBacktest(stock, bearIndex, { useRegime: true })!;
    const noGate = runStageBacktest(stock, bearIndex, { useRegime: false })!;
    expect(withGate.tradeCount).toBeLessThan(noGate.tradeCount);
  });
  it("returns null for short history", () => {
    expect(runStageBacktest(fromWeeks(ramp(100, 110, 20)))).toBeNull();
  });
});

import {
  DAYTRADE_BY_REGION, marketClock, newPaperAccount, PAPER_COSTS, paperCheckExits, paperEquity, paperOpen,
  planWithCash, regionOfCode, scoreDayTrade, isValidCode, type DayTradeCandidate,
} from "../src";

/** 평일 일봉 n개(오래된 순). 끝 직전까지 횡보(RSI≈50) + 마지막 날 거래량 폭증 돌파 봉 */
function breakoutCandles(n = 60, { lastVol = 5000, lastClose = 1.05, base = 10_000 }: { lastVol?: number; lastClose?: number; base?: number } = {}): Candle[] {
  const out: Candle[] = [];
  let t = Date.UTC(2024, 0, 1);
  let px = base;
  for (let i = 0; i < n; i++) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
    const last = i === n - 1;
    const close = last ? px * lastClose : px * (1 + 0.004 * (i % 2 ? 1 : -1));
    const open = last ? px * 1.005 : px;
    out.push({
      date: new Date(t).toISOString().slice(0, 10), open, high: last ? close * 1.003 : Math.max(open, close) * 1.004,
      low: Math.min(open, close) * 0.996, close, volume: last ? lastVol : 1000,
    });
    px = close;
    t += 86_400_000;
  }
  return out;
}

const ref = { code: "005930", name: "삼성전자", market: "KOSPI" as const };
const kr = { ...DAYTRADE_BY_REGION.KR, minTradeValue: 1 };

describe("region helpers and clocks", () => {
  it("detects region from code", () => {
    expect(regionOfCode("005930")).toBe("KR");
    expect(regionOfCode("AAPL")).toBe("US");
    expect(isValidCode("BRK.B")).toBe(true);
    expect(isValidCode("aapl")).toBe(false);
    expect(isValidCode("12345")).toBe(false);
  });
  it("KR and US sessions, including US daylight time", () => {
    // 2024-07-01(월) 00:30 UTC = 09:30 KST = 20:30 EDT(전날)
    const t = new Date("2024-07-01T00:30:00Z");
    expect(marketClock("KR", t)).toMatchObject({ date: "2024-07-01", isOpen: true, inEntryWindow: true });
    expect(marketClock("US", t)).toMatchObject({ date: "2024-06-30", isOpen: false });
    // 2024-07-01 13:45 UTC = 09:45 EDT(여름) → 미국 장중. 겨울(2024-01-02 14:45 UTC=09:45 EST)도 장중
    expect(marketClock("US", new Date("2024-07-01T13:45:00Z"))).toMatchObject({ date: "2024-07-01", isOpen: true, inEntryWindow: true });
    expect(marketClock("US", new Date("2024-01-02T14:45:00Z")).isOpen).toBe(true);
    expect(marketClock("US", new Date("2024-01-02T14:15:00Z")).isOpen).toBe(false); // 09:15 EST: 개장 전
    expect(marketClock("KR", new Date("2024-06-29T02:00:00Z")).isOpen).toBe(false); // 토요일
  });
});

describe("day-trade scoring", () => {
  it("accepts a volume breakout and builds a plan with net R/R", () => {
    const r = scoreDayTrade(ref, breakoutCandles(), null, kr);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.candidate;
    expect(c.volumeRatio).toBeGreaterThan(4);
    expect(c.stop).toBeLessThan(c.entry);
    expect(c.target).toBeGreaterThan(c.entry);
    expect(c.stopPct).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(c.stopPct).toBeLessThanOrEqual(5 + 1e-9);
    expect(c.netRR).toBeLessThan(kr.targetR); // 비용 때문에 명목 손익비보다 낮다
    expect(c.notes.some((n) => n.text.includes("돌파"))).toBe(true);
  });
  it("rejects weak volume, limit-up chasing, illiquid, and bear market gets a penalty", () => {
    expect(scoreDayTrade(ref, breakoutCandles(60, { lastVol: 1100 }), null, kr)).toMatchObject({ ok: false, reason: "거래량 증가 없음" });
    expect(scoreDayTrade(ref, breakoutCandles(60, { lastClose: 1.28 }), null, kr)).toMatchObject({ ok: false, reason: "상한가 근처 추격 위험" });
    expect(scoreDayTrade(ref, breakoutCandles(), null, { ...kr, minTradeValue: 1e15 })).toMatchObject({ ok: false, reason: "거래대금 부족" });
    expect(scoreDayTrade(ref, breakoutCandles(10), null, kr)).toMatchObject({ ok: false, reason: "데이터 부족" });
    const base = scoreDayTrade(ref, breakoutCandles(), null, kr);
    const bear = scoreDayTrade(ref, breakoutCandles(), "BEAR", kr);
    if (base.ok && bear.ok) expect(bear.candidate.score).toBeLessThan(base.candidate.score);
  });
  it("US uses 2-decimal prices and dollar thresholds", () => {
    const us = DAYTRADE_BY_REGION.US;
    expect(us.decimals).toBe(2);
    const r = scoreDayTrade({ code: "NVDA", name: "NVIDIA", market: "US" }, breakoutCandles(60, { base: 120.37, lastVol: 5_000_000 }), null, { ...us, minTradeValue: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number.isInteger(r.candidate.stop * 100 + 1e-6) || Math.abs(r.candidate.stop * 100 - Math.round(r.candidate.stop * 100)) < 1e-6).toBe(true);
  });
});

describe("cash plan", () => {
  const mk = (code: string, score: number, entry: number, stop: number): DayTradeCandidate => ({
    code, name: code, market: "KOSPI", asOf: "2024-01-01", price: entry, changePct: 5, volume: 1, tradeValue: 1, volumeRatio: 3, score,
    entry, stop, target: entry + 2 * (entry - stop), stopPct: ((entry - stop) / entry) * 100, targetPct: 0, netRR: 1.5, maxHoldDays: 3, notes: [],
  });
  const params = { cash: 10_000_000, riskPct: 1, maxWeightPct: 30, maxPositions: 3, reservePct: 10 };
  it("sizes by stop distance, honors weight cap, reserve and slot limits", () => {
    const plan = planWithCash([mk("A", 80, 10_000, 9_700), mk("B", 70, 50_000, 48_000), mk("C", 65, 20_000, 19_500), mk("D", 60, 30_000, 29_000)], params);
    expect(plan.items.map((i) => i.candidate.code)).toEqual(["A", "B", "C"]);
    expect(plan.skipped.map((s) => s.candidate.code)).toEqual(["D"]);
    for (const i of plan.items) expect(i.weightPct).toBeLessThanOrEqual(30 + 1e-9);
    expect(plan.used).toBeLessThanOrEqual(plan.spendable + 1e-6);
    expect(plan.remainingCash).toBeGreaterThanOrEqual(1_000_000 - 1e-6); // 예비 현금 10%
    expect(plan.items[0]!.riskAmount).toBeLessThanOrEqual(100_000 + 1e-6); // 1% 손실 한도
  });
  it("skips what cash cannot afford and already-held stocks", () => {
    const p = planWithCash([mk("E", 90, 5_000_000, 4_900_000), mk("F", 80, 10_000, 9_700)], { ...params, heldCodes: ["F"] });
    expect(p.items).toHaveLength(0);
    expect(p.skipped.map((s) => s.reason)).toEqual(expect.arrayContaining(["이미 보유 중"]));
  });
  it("counts held positions against the slot limit", () => {
    const p = planWithCash([mk("A", 80, 10_000, 9_700)], { ...params, heldCount: 3 });
    expect(p.items).toHaveLength(0);
  });
});

describe("paper trading", () => {
  const cand: DayTradeCandidate = {
    code: "005930", name: "삼성전자", market: "KOSPI", asOf: "2024-01-02", price: 10_000, changePct: 5, volume: 1, tradeValue: 1, volumeRatio: 3, score: 80,
    entry: 10_000, stop: 9_700, target: 10_600, stopPct: 3, targetPct: 6, netRR: 1.7, maxHoldDays: 3, notes: [{ tone: "good", text: "거래량 폭증" }],
  };
  const item = { candidate: cand, qty: 100, amount: 1_000_000, riskAmount: 30_000, weightPct: 10 };
  const mon = new Date("2024-01-08T01:30:00Z"); // 월 10:30 KST
  const costs = PAPER_COSTS.KR;

  it("opens at a slipped price, deducts cash with fee, and journals", () => {
    const r = paperOpen(newPaperAccount(2_000_000), item, mon, marketClock("KR", mon), costs)!;
    expect(r.acct.positions[0]!.entryPrice).toBe(10_010);
    expect(r.acct.cash).toBeCloseTo(2_000_000 - 100 * 10_010 * 1.00015);
    expect(r.entry).toMatchObject({ side: "BUY", source: "자동(모의)", qty: 100, date: "2024-01-08" });
    expect(paperOpen(r.acct, item, mon, marketClock("KR", mon), costs)).toBeNull(); // 같은 종목 중복 매수 금지
    expect(paperOpen(newPaperAccount(100_000), item, mon, marketClock("KR", mon), costs)).toBeNull(); // 예수금 부족
  });
  const open = () => paperOpen(newPaperAccount(2_000_000), item, mon, marketClock("KR", mon), costs)!.acct;
  it("exits on stop, target, and time; books net P&L", () => {
    const stop = paperCheckExits(open(), { "005930": 9_650 }, marketClock("KR", new Date("2024-01-08T02:00:00Z")), costs);
    expect(stop.entries[0]).toMatchObject({ side: "SELL", price: 9_640 });
    expect(stop.entries[0]!.reason).toContain("손절");
    expect(stop.acct.positions).toHaveLength(0);
    expect(stop.acct.realizedPnl).toBeLessThan(0);
    expect(stop.acct.wins).toBe(0);

    const tp = paperCheckExits(open(), { "005930": 10_700 }, marketClock("KR", new Date("2024-01-08T03:00:00Z")), costs);
    expect(tp.entries[0]!.reason).toContain("목표");
    expect(tp.acct.wins).toBe(1);
    expect(tp.acct.realizedPnl).toBeGreaterThan(0);
    // 순손익 = 매도대금(수수료·세금 차감) - 매수원가
    const fill = Math.round(10_700 * 0.999);
    expect(tp.acct.realizedPnl).toBeCloseTo(100 * fill * (1 - 0.00015 - 0.0018) - 100 * 10_010 * 1.00015);

    // 보유 중 가격이 손절·목표 사이면 유지하고 평가가만 갱신
    const hold = paperCheckExits(open(), { "005930": 10_100 }, marketClock("KR", new Date("2024-01-08T03:00:00Z")), costs);
    expect(hold.entries).toHaveLength(0);
    expect(hold.acct.positions[0]!.lastPrice).toBe(10_100);
    expect(paperEquity(hold.acct)).toBeCloseTo(hold.acct.cash + 100 * 10_100);

    // 월요일 진입, 3거래일 후 목요일 마감 임박 → 시간 청산. 목요일 장중(마감 전)에는 유지
    expect(paperCheckExits(open(), { "005930": 10_100 }, marketClock("KR", new Date("2024-01-11T02:00:00Z")), costs).entries).toHaveLength(0);
    const timed = paperCheckExits(open(), { "005930": 10_100 }, marketClock("KR", new Date("2024-01-11T06:10:00Z")), costs);
    expect(timed.entries[0]!.reason).toContain("시간 청산");
  });
  it("ignores positions without a fresh price", () => {
    const r = paperCheckExits(open(), {}, marketClock("KR", mon), costs);
    expect(r.entries).toHaveLength(0);
    expect(r.acct.positions).toHaveLength(1);
  });
});
