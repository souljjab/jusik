import { describe, expect, it } from "vitest";
import { DAYTRADE_BY_REGION } from "../src/daytrade";
import { replayDayTrade } from "../src/dayEval";
import { prepareStage, stageAt, STAGE_PARAMS } from "../src/stage";
import { candleMasterAt } from "../src/candleMaster";
import {
  bbcPullbackStrategy, candleMasterStrategy, compareStrategies, dayTradeBreakoutStrategy, DEFAULT_RUN, getStrategy, rsiRecoveryStrategy, runStrategy, seolSwingStrategy,
  STRATEGIES, TRADE_REASON_LABEL, weinsteinStrategy,
  type Strategy, type StrategyEntry, type StrategyExit,
} from "../src/strategies";
import type { Candle } from "../src/types";
import { toWeekly } from "../src/weekly";

const ramp = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 1)) / n);
const geo = (a: number, r: number, n: number) => Array.from({ length: n }, (_, i) => a * r ** (i + 1));
const noCost = { feeRate: 0, sellTaxRate: 0, slippagePct: 0 };

/** 주별 종가 수준 → 월~금 일봉(고가 +1%, 저가 −1%). volAt[주] = 그 주 일 거래량 */
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

/** 종가 목록 → 평일 일봉(시가 = 전일 종가, 고·저가는 몸통 ±0.3%) */
function daily(closes: number[], vols: number[] = []): Candle[] {
  const out: Candle[] = [];
  let t = Date.UTC(2024, 0, 1);
  closes.forEach((c, i) => {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
    const open = i ? closes[i - 1]! : c;
    out.push({ date: new Date(t).toISOString().slice(0, 10), open, high: Math.max(open, c) * 1.003, low: Math.min(open, c) * 0.997, close: c, volume: vols[i] ?? 1000 });
    t += 86_400_000;
  });
  return out;
}

/** OHLC를 직접 지정하는 평일 일봉 */
function bars(rows: [number, number, number, number][]): Candle[] {
  let t = Date.UTC(2024, 0, 1);
  return rows.map(([open, high, low, close]) => {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
    const c = { date: new Date(t).toISOString().slice(0, 10), open, high, low, close, volume: 1000 };
    t += 86_400_000;
    return c;
  });
}
const flat = (n: number, p = 100): [number, number, number, number][] => Array.from({ length: n }, () => [p, p, p, p]);

/** 정해 둔 봉에서만 진입·청산하는 시험용 전략. entry가 불린 봉을 기록한다 */
function scripted(entries: Record<number, StrategyEntry>, exits: Record<number, StrategyExit> = {}) {
  const entryCalls: number[] = [];
  const s: Strategy<null> = {
    id: "test", name: "시험", source: "시험", timeframe: "daily", description: "", rules: [],
    prepare: () => null,
    startIndex: () => 0,
    entry: (i) => {
      entryCalls.push(i);
      return entries[i] ?? null;
    },
    exit: (i) => exits[i] ?? null,
  };
  return { s, entryCalls };
}

/** 재현 가능한 의사 난수(mulberry32) */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomWalk(n: number, seed: number, drift = 0.0006): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let t = Date.UTC(2021, 0, 4);
  let px = 10_000;
  for (let i = 0; i < n; i++) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
    const open = px * (1 + (r() - 0.5) * 0.01);
    const close = open * (1 + drift + (r() - 0.5) * 0.06);
    const high = Math.max(open, close) * (1 + r() * 0.015);
    const low = Math.min(open, close) * (1 - r() * 0.015);
    const volume = Math.round(100_000 * (0.4 + r() * 1.2) * (r() < 0.06 ? 4 : 1));
    out.push({ date: new Date(t).toISOString().slice(0, 10), open, high, low, close, volume });
    px = close;
    t += 86_400_000;
  }
  return out;
}

describe("strategy engine", () => {
  it("fills at the next open, holds one position at a time, and skips re-entry on the exit bar", () => {
    const cs = bars([...flat(3), [101, 102, 100, 101], ...flat(8)]);
    const always: Record<number, StrategyEntry> = {};
    for (let i = 0; i < cs.length; i++) always[i] = { stop: 50, reason: "항상" };
    const { s, entryCalls } = scripted(always, { 5: { fraction: 1, kind: "SIGNAL", reason: "청산" } });
    const r = runStrategy(s, cs, {}, noCost)!;
    expect(r.trades[0]).toMatchObject({ buyDate: cs[1]!.date, buyPrice: 100, sellDate: cs[6]!.date, sellPrice: 100, reason: "SIGNAL", fraction: 1 });
    // 보유 중(1~5)과 청산한 봉(6)에서는 진입을 평가하지 않는다
    expect(entryCalls.slice(0, 2)).toEqual([0, 7]);
    expect(r.openPosition).toBe(true); // 7일 신호로 8일에 다시 샀다
    expect(r.trades[0]!.entryReason).toBe("항상");
  });

  it("checks the stop before the target and fills gaps at the open", () => {
    // 같은 봉에서 손절·목표 모두 닿으면 손절
    const both = bars([...flat(2), [100, 120, 80, 100], ...flat(2)]);
    const a = runStrategy(scripted({ 0: { stop: 90, target: 110, reason: "x" } }).s, both, {}, noCost)!;
    expect(a.trades).toHaveLength(1);
    expect(a.trades[0]).toMatchObject({ reason: "STOP_LOSS", sellPrice: 90 });
    // 시가가 손절가 아래로 갭하락 → 시가 체결
    const gapDown = bars([...flat(2), [85, 86, 84, 85], ...flat(2)]);
    expect(runStrategy(scripted({ 0: { stop: 90, target: 110, reason: "x" } }).s, gapDown, {}, noCost)!.trades[0]).toMatchObject({ reason: "STOP_LOSS", sellPrice: 85 });
    // 시가가 목표가 위로 갭상승 → 시가 체결
    const gapUp = bars([...flat(2), [115, 116, 114, 115], ...flat(2)]);
    expect(runStrategy(scripted({ 0: { stop: 90, target: 110, reason: "x" } }).s, gapUp, {}, noCost)!.trades[0]).toMatchObject({ reason: "TARGET", sellPrice: 115 });
    // 시가가 목표가 위에서 시작한 뒤 장중 손절가까지 밀리면: 시가에 목표 청산이 먼저(시가가 그날 첫 가격)
    const gapThenFall = bars([...flat(2), [112, 115, 88, 95], ...flat(2)]);
    expect(runStrategy(scripted({ 0: { stop: 90, target: 110, reason: "x" } }).s, gapThenFall, {}, noCost)!.trades).toMatchObject([{ reason: "TARGET", sellPrice: 112 }]);
    const half = runStrategy(scripted({ 0: { stop: 90, target: 110, targetFraction: 0.5, reason: "x" } }).s, gapThenFall, {}, noCost)!;
    expect(half.trades.map((t) => [t.reason, t.sellPrice])).toEqual([["TARGET", 112], ["STOP_LOSS", 90]]);
  });

  it("books partial exits with fees, tax and slippage", () => {
    const cs = bars([...flat(1), [100, 100, 100, 100], [100, 104, 99, 104], [105, 111, 104, 110], [110, 112, 109, 111], [120, 121, 119, 120], [120, 120, 120, 120]]);
    const o = { initialCash: 100_000, feeRate: 0.001, sellTaxRate: 0.002, slippagePct: 0.5 };
    const { s } = scripted({ 0: { stop: 90, target: 110, targetFraction: 0.5, reason: "x" } }, { 4: { fraction: 1, kind: "SIGNAL", reason: "청산" } });
    const r = runStrategy(s, cs, {}, o)!;
    const buy = 100 * 1.005;
    const cps = buy * 1.001;
    const n = Math.floor(100_000 / cps);
    const p1 = 497 * 110 * 0.995 * (1 - 0.003);
    const p2 = (n - 497) * 120 * 0.995 * (1 - 0.003);
    expect(n).toBe(994);
    expect(r.trades.map((t) => [t.reason, t.shares])).toEqual([["TARGET", 497], ["SIGNAL", 497]]);
    expect(r.trades[0]!.fraction).toBeCloseTo(0.5);
    expect(r.trades[0]!.sellPrice).toBeCloseTo(110 * 0.995);
    expect(r.trades[0]!.returnPct).toBeCloseTo((p1 / (497 * cps) - 1) * 100, 8);
    expect(r.finalEquity).toBeCloseTo(100_000 - n * cps + p1 + p2, 6);
    expect(r.openPosition).toBe(false);
    // 같은 거래를 비용 없이 돌리면 더 많이 남는다
    expect(runStrategy(s, cs, {}, { initialCash: 100_000, ...noCost })!.finalEquity).toBeGreaterThan(r.finalEquity);
  });

  it("time exits fill at the close; other exits never fill at the same close", () => {
    const cs = bars([...flat(3), [100, 101, 99, 100.5], [101, 102, 100, 101.5], ...flat(2, 102)]);
    const timed = runStrategy(scripted({ 0: { stop: 50, reason: "x" } }, { 3: { fraction: 1, kind: "TIME", atClose: true, reason: "시간" } }).s, cs, {}, noCost)!;
    expect(timed.trades[0]).toMatchObject({ reason: "TIME", sellDate: cs[3]!.date, sellPrice: 100.5 });
    const sig = runStrategy(scripted({ 0: { stop: 50, reason: "x" } }, { 3: { fraction: 1, kind: "SIGNAL", atClose: true, reason: "신호" } }).s, cs, {}, noCost)!;
    expect(sig.trades[0]).toMatchObject({ reason: "SIGNAL", sellDate: cs[4]!.date, sellPrice: 101 });
  });

  it("applies stop/target percentages to the actual fill, skips gap chases, and sizes by fraction", () => {
    const cs = bars([...flat(1), [100, 100, 100, 100], [100, 100, 100, 100], ...flat(2)]);
    const pct = runStrategy(scripted({ 0: { stop: 1, stopPct: 5, target: 999, targetPct: 10, reason: "x" } }).s, bars([...flat(1), [100, 100, 100, 100], [100, 111, 99, 110], ...flat(2)]), {}, noCost)!;
    expect(pct.trades[0]!.reason).toBe("TARGET");
    expect(pct.trades[0]!.sellPrice).toBeCloseTo(110, 9);
    const chase = runStrategy(scripted({ 0: { stop: 90, maxEntryPrice: 99, reason: "x" } }).s, cs, {}, noCost)!;
    expect(chase.trades).toHaveLength(0);
    expect(chase.openPosition).toBe(false);
    const stopAbove = runStrategy(scripted({ 0: { stop: 100, reason: "x" } }).s, cs, {}, noCost)!;
    expect(stopAbove.openPosition).toBe(false); // 시가가 이미 손절가 이하면 들어가지 않는다
    const half = runStrategy(scripted({ 0: { stop: 90, sizeFraction: 0.5, reason: "x" } }, { 2: { fraction: 1, kind: "SIGNAL", reason: "y" } }).s, cs, {}, { initialCash: 10_000, ...noCost })!;
    expect(half.trades[0]!.shares).toBe(50);
  });

  it("labels every trade reason", () => {
    expect(Object.keys(TRADE_REASON_LABEL).sort()).toEqual(["PARTIAL", "SIGNAL", "STOP_LOSS", "TARGET", "TIME"]);
  });
});

describe("stage.ts additions", () => {
  const decline = ramp(100, 70, 60);
  const base = Array(40).fill(70) as number[];

  it("accepts the cumulative-volume alternative (M3-01)", () => {
    const levels = [...decline, ...base, 80];
    const k = levels.length - 1;
    // 돌파 주 단독으로는 4주 평균의 2배가 안 되지만 최근 4주 누적이 평소의 2배 이상이고 돌파 주에 늘었다
    const vols = { [k - 3]: 2400, [k - 2]: 2400, [k - 1]: 2400, [k]: 2600 };
    const r = stageAt(prepareStage(toWeekly(fromWeeks(levels, vols))), k)!;
    expect(r.volumeRatio!).toBeLessThan(STAGE_PARAMS.breakoutVolume);
    expect(r.cumVolumeRatio!).toBeCloseTo((2400 * 3 + 2600) / (1000 * 4));
    expect(r.volumeBasis).toBe("CUMULATIVE");
    expect(["BUY", "STRONG_BUY"]).toContain(r.action);
    expect(r.notes.find((n) => n.text.includes("누적"))?.rule).toBe("M3-01 와인스타인");
    // 돌파 주 거래량이 전주보다 늘지 않았으면 인정하지 않는다
    const flatWeek = stageAt(prepareStage(toWeekly(fromWeeks(levels, { ...vols, [k]: 2400 }))), k)!;
    expect(flatWeek.volumeBasis).toBeNull();
    expect(flatWeek.action).toBe("HOLD");
    // 돌파 주 단독 조건은 그대로
    const week = stageAt(prepareStage(toWeekly(fromWeeks(levels, { [k]: 4000 }))), k)!;
    expect(week.volumeBasis).toBe("WEEK");
  });

  it("caps the stop at 10% below the close and keeps the 8-week low as supportLow (M4-01)", () => {
    const levels = [...decline, ...base, ...ramp(70, 95, 5)];
    const k = levels.length - 1;
    const weekly = toWeekly(fromWeeks(levels));
    const r = stageAt(prepareStage(weekly), k)!;
    expect(r.supportLow).toBe(Math.min(...weekly.slice(k - 7, k + 1).map((w) => w.low)));
    expect(r.stopLoss).toBeCloseTo(95 * (1 - STAGE_PARAMS.maxStopPct));
    expect(r.stopLoss).toBeGreaterThan(r.supportLow);
    expect(r.notes.find((n) => n.rule === "M4-01 와인스타인")?.text).toContain("손절폭 10% 상한 적용");
    // 지지선이 10% 안이면 지지선 그대로, 안내 없음
    const tight = stageAt(prepareStage(toWeekly(fromWeeks([...decline, ...base, 72]))), decline.length + base.length)!;
    expect(tight.stopLoss).toBe(tight.supportLow);
    expect(tight.notes.some((n) => n.rule === "M4-01 와인스타인")).toBe(false);
  });

  it("sets the swing target A + (A − B) once the close clears A (M3-03)", () => {
    const lv = [...ramp(60, 100, 36), ...ramp(100, 80, 5), ...ramp(80, 130, 25)];
    const st = (k: number) => stageAt(prepareStage(toWeekly(fromWeeks(lv))), k)!;
    const A = 100 * 1.01, B = 80 * 0.99;
    const crossK = lv.findIndex((x, k) => k > 41 && x > A);
    expect(st(crossK - 1).swingTarget).toBeNull(); // 아직 A 아래
    expect(st(crossK).swingTarget).toBeCloseTo(A + (A - B));
    expect(st(crossK).notes.find((n) => n.rule === "M3-03 와인스타인")?.text).toContain("스윙 목표가");
    // 15% 미만 조정은 주요 하락이 아니다
    const shallow = [...ramp(60, 100, 36), ...ramp(100, 90, 5), ...ramp(90, 130, 25)];
    expect(stageAt(prepareStage(toWeekly(fromWeeks(shallow))), shallow.length - 1)!.swingTarget).toBeNull();
  });

  it("flags the first pullback that holds the breakout level (M3-02)", () => {
    const pre = [...decline, ...base];
    const j = pre.length; // 돌파 주
    const pivot = 70 * 1.01;
    const run = (tail: number[]) => {
      const lv = [...pre, 80, ...tail];
      return stageAt(prepareStage(toWeekly(fromWeeks(lv, { [j]: 4000 }))), lv.length - 1)!;
    };
    const hit = run([84, 72]); // 저가 71.28: 기준가 70.7의 ±3% 안, 종가 72 ≥ 기준가
    expect(hit.pullbackBuy).toBe(true);
    expect(hit.notes.find((n) => n.rule === "M3-02 와인스타인")?.text).toContain("추가 매수");
    expect(72 * 0.99).toBeLessThanOrEqual(pivot * 1.03);
    expect(run([84, 70.5]).pullbackBuy).toBe(false); // 종가가 기준가 아래
    expect(run([72.5, 84, 72]).pullbackBuy).toBe(false); // 첫 풀백이 아니다
    expect(run([84, 85, 86, 87, 88, 89, 72]).pullbackBuy).toBe(false); // 6주가 지났다
    // 거래량 없는 돌파 뒤 풀백은 아니다
    const lv = [...pre, 80, 84, 72];
    expect(stageAt(prepareStage(toWeekly(fromWeeks(lv))), lv.length - 1)!.pullbackBuy).toBe(false);
  });

  it("new fields do not look ahead", () => {
    const lv = [...ramp(60, 100, 36), ...ramp(100, 80, 5), ...ramp(80, 130, 25)];
    const k = 55;
    const a = stageAt(prepareStage(toWeekly(fromWeeks(lv))), k)!;
    const lv2 = [...lv.slice(0, k + 1), ...Array(30).fill(5)];
    expect(stageAt(prepareStage(toWeekly(fromWeeks(lv2, { [k + 1]: 99_999 }))), k)).toEqual(a);
    expect(a.swingTarget).not.toBeNull();
  });
});

describe("weinstein strategy", () => {
  const lv = [...ramp(60, 100, 36), ...ramp(100, 80, 5), ...ramp(80, 130, 25), ...ramp(130, 90, 15)];
  const cs = fromWeeks(lv);

  it("buys at the open after a week closes, sells half at the swing target, trails the stop", () => {
    const r = runStrategy(weinsteinStrategy(), cs, {}, noCost)!;
    expect(r.trades.length).toBeGreaterThan(0);
    // 주봉 신호라 체결은 항상 다음 주 첫 거래일(월요일) 시가
    for (const t of r.trades) expect(new Date(Date.parse(t.buyDate)).getUTCDay()).toBe(1);
    const tgt = r.trades.find((t) => t.reason === "TARGET")!;
    expect(tgt).toBeDefined();
    expect(tgt.fraction).toBeCloseTo(0.5, 2);
    expect(tgt.sellPrice).toBeCloseTo(100 * 1.01 + (100 * 1.01 - 80 * 0.99));
    // 남은 절반은 끌어올린 손절이나 매도 신호로 정리되고, 손절가는 진입 때보다 높다
    const rest = r.trades.filter((t) => t.buyDate === tgt.buyDate && t !== tgt);
    expect(rest).toHaveLength(1);
    expect(rest[0]!.sellPrice).toBeGreaterThan(tgt.buyPrice);
    expect(r.totalReturnPct).toBeGreaterThan(r.buyHoldReturnPct);
  });

  it("does not open positions while the index is in a bear phase", () => {
    const bear = fromWeeks(ramp(200, 80, lv.length));
    const bull = fromWeeks(ramp(80, 200, lv.length));
    expect(runStrategy(weinsteinStrategy(), cs, { index: bear }, noCost)!.tradeCount).toBe(0);
    expect(runStrategy(weinsteinStrategy(), cs, { index: bull }, noCost)!.tradeCount).toBeGreaterThan(0);
    expect(runStrategy(weinsteinStrategy({ useRegime: false }), cs, { index: bear }, noCost)!.tradeCount).toBeGreaterThan(0);
  });

  it("returns null without enough weeks", () => {
    expect(runStrategy(weinsteinStrategy(), fromWeeks(ramp(100, 110, 20)))).toBeNull();
  });
});

describe("seol swing strategy", () => {
  const up = ramp(100, 130, 80);
  const dip = ramp(130, 124, 8);
  const climb = geo(124, 1.01, 5);

  it("enters on a 5/20 golden cross, sells half at +10%, the rest on a 5-day line break", () => {
    const rise = geo(124, 1.01, 15);
    const cs = daily([...up, ...dip, ...rise, ...geo(rise.at(-1)!, 0.985, 10)]);
    const r = runStrategy(seolSwingStrategy(), cs, {}, noCost)!;
    expect(r.trades.map((t) => t.reason)).toEqual(["TARGET", "SIGNAL"]);
    const [a, b] = r.trades;
    expect(a!.entryRule).toBe("M3-05 설춘환");
    expect(a!.sellPrice).toBeCloseTo(a!.buyPrice * 1.1);
    expect(a!.fraction).toBeCloseTo(0.5, 2);
    expect(b!.exitRule).toBe("M3-06 설춘환");
    expect(b!.exitReason).toContain("5일선");
  });

  it("sells everything when the close breaks the 20-day line before the split", () => {
    const cs = daily([...up, ...dip, ...climb, ...geo(124 * 1.01 ** 5, 0.98, 6)]);
    const r = runStrategy(seolSwingStrategy(), cs, {}, noCost)!;
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ reason: "SIGNAL", fraction: 1 });
    expect(r.trades[0]!.exitReason).toContain("20일선");
  });

  it("uses the stop percentage from the actual entry", () => {
    const cs = daily([...up, ...dip, ...climb, 115, 114, 113]);
    const t5 = runStrategy(seolSwingStrategy({ stopPct: 5 }), cs, {}, noCost)!.trades[0]!;
    const t10 = runStrategy(seolSwingStrategy({ stopPct: 10 }), cs, {}, noCost)!.trades[0]!;
    expect(t5).toMatchObject({ reason: "STOP_LOSS" });
    expect(t5.sellPrice).toBeCloseTo(t5.buyPrice * 0.95);
    expect(t10.sellPrice).toBeCloseTo(t10.buyPrice * 0.9);
  });

  it("does not chase an extended move", () => {
    const cs = daily([...up, ...dip, ...climb, ...geo(124 * 1.01 ** 5, 1.01, 10)]);
    expect(runStrategy(seolSwingStrategy({ maxExtendPct: 0.1 }), cs, {}, noCost)!.tradeCount).toBe(0);
  });
});

describe("rsi recovery strategy", () => {
  const drop = [...Array(30).fill(100), ...geo(100, 0.98, 15)];
  const bottom = 100 * 0.98 ** 15;

  it("buys when RSI climbs back over 30, holds while RSI stays above 70, and sells when it drops back under 70", () => {
    const rally = geo(bottom, 1.015, 25);
    const held = runStrategy(rsiRecoveryStrategy({ maxHoldBars: 100 }), daily([...drop, ...rally]), {}, noCost)!;
    expect(held.trades).toHaveLength(0);
    expect(held.openPosition).toBe(true);

    const cs = daily([...drop, ...rally, ...geo(bottom * 1.015 ** 25, 0.985, 8)]);
    const r = runStrategy(rsiRecoveryStrategy({ maxHoldBars: 100 }), cs, {}, noCost)!;
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ reason: "SIGNAL", entryRule: "M3-14 강영현·강동진", exitRule: "4.6 강동진" });
    expect(r.trades[0]!.exitReason).toContain("아래로 이탈");
    expect(r.trades[0]!.returnPct).toBeGreaterThan(0);
  });

  it("exits on time after 20 bars and on an 8% stop", () => {
    const sideways = Array.from({ length: 30 }, (_, i) => 79.5 + (i % 2) * 0.3);
    const cs = daily([...drop, ...geo(bottom, 1.015, 5), ...sideways]);
    const r = runStrategy(rsiRecoveryStrategy(), cs, {}, noCost)!;
    const t = r.trades[0]!;
    expect(t.reason).toBe("TIME");
    const bi = cs.findIndex((c) => c.date === t.buyDate);
    expect(cs.findIndex((c) => c.date === t.sellDate) - bi).toBe(20);
    expect(t.sellPrice).toBe(cs[bi + 20]!.close);

    const crash = daily([...drop, ...geo(bottom, 1.015, 5), ...geo(bottom * 1.015 ** 5, 0.97, 5)]);
    const s = runStrategy(rsiRecoveryStrategy(), crash, {}, noCost)!.trades[0]!;
    expect(s.reason).toBe("STOP_LOSS");
    expect(s.sellPrice).toBeCloseTo(s.buyPrice * 0.92, 6);
  });
});

describe("bbc pullback strategy", () => {
  // 상승 추세 → 거래량 줄며 3봉 조정(마지막 날 급락) → 거래량 2.5배 양봉이 하락폭의 64% 회복
  const closes = [...ramp(100, 130, 60), 130.5, 130.8, 131, 124, 128.5, 130, 132, 135, 139, 144, 139.5, 141, 142, 130, 126, 122];
  const vols = [...Array(60).fill(1000), 1200, 1000, 800, 600, 1500, 1000, 1000, 1000, 1000, 1000, 3000, 1000, 1000, 1000, 1000, 1000];
  const cs = daily(closes, vols);

  it("buys the volume rebound, sells half on a heavy red candle, the rest under the 20-day line", () => {
    const r = runStrategy(bbcPullbackStrategy(), cs, {}, noCost)!;
    expect(r.trades.map((t) => t.reason)).toEqual(["PARTIAL", "SIGNAL"]);
    const [a, b] = r.trades;
    expect(a!.buyDate).toBe(cs[65]!.date); // 64일 종가 신호 → 65일 시가
    expect(a!.entryRule).toBe("4.4 박병창");
    expect(a!.exitRule).toBe("M3-10 박병창");
    expect(a!.sellDate).toBe(cs[71]!.date);
    expect(a!.fraction).toBeCloseTo(0.5, 2);
    expect(b!.exitReason).toContain("20일선");
  });

  it("needs the volume to dry up first and a real rebound", () => {
    const loud = [...vols];
    loud[62] = 1300; // 직전 3봉 거래량이 줄지 않음
    expect(runStrategy(bbcPullbackStrategy(), daily(closes, loud), {}, noCost)!.tradeCount).toBe(0);
    const weak = [...closes];
    weak[64] = 126.5; // 하락폭(131→124)의 50% 미만 회복
    expect(runStrategy(bbcPullbackStrategy(), daily(weak, vols), {}, noCost)!.tradeCount).toBe(0);
  });

  it("can read the 5~20 zone on the signal bar or the pullback bar", () => {
    // 이 시나리오는 눌림 봉(전날) 종가가 20일선 아래라 오늘 종가 기준일 때만 신호가 난다
    expect(runStrategy(bbcPullbackStrategy({ zoneBar: "signal" }), cs, {}, noCost)!.tradeCount).toBeGreaterThan(0);
    expect(runStrategy(bbcPullbackStrategy({ zoneBar: "pullback" }), cs, {}, noCost)!.tradeCount).toBe(0);
  });

  it("puts the stop under the recent 5-bar low", () => {
    const r = runStrategy(bbcPullbackStrategy(), daily([...closes.slice(0, 66), 110, 110], vols), {}, noCost)!;
    const lows = cs.slice(60, 65).map((c) => c.low);
    expect(r.trades[0]!.reason).toBe("STOP_LOSS");
    expect(r.trades[0]!.sellPrice).toBeCloseTo(Math.min(...lows) * 0.99);
  });
});

describe("day-trade breakout strategy", () => {
  const ref = { code: "005930", name: "삼성전자", market: "KOSPI" as const };
  const kr = { ...DAYTRADE_BY_REGION.KR, minTradeValue: 1 };
  /** 평일 횡보 60일 → 거래량 동반 돌파 → after(이후 종가 배율) */
  function scenario(after: number[]): Candle[] {
    const out: Candle[] = [];
    let t = Date.UTC(2024, 0, 1);
    let px = 10_000;
    const push = (o: number, h: number, l: number, c: number, v: number) => {
      while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
      out.push({ date: new Date(t).toISOString().slice(0, 10), open: o, high: h, low: l, close: c, volume: v });
      t += 86_400_000;
    };
    for (let i = 0; i < 60; i++) {
      const c = px * (1 + 0.004 * (i % 2 ? 1 : -1));
      push(px, Math.max(px, c) * 1.004, Math.min(px, c) * 0.996, c, 1000);
      px = c;
    }
    const bc = px * 1.05;
    push(px * 1.005, bc * 1.003, px * 0.998, bc, 5000);
    px = bc;
    after.forEach((m) => {
      const c = bc * m;
      push(px, Math.max(px, c) * 1.002, Math.min(px, c) * 0.998, c, 1500);
      px = c;
    });
    return out;
  }
  const cases: [string, number[], string, string][] = [
    ["target", [1.0, 1.03, 1.08, 1.1], "TARGET", "목표 도달"],
    ["stop", [1.0, 0.99, 0.9, 0.85], "STOP_LOSS", "손절"],
    ["time", [1.0, 1.001, 0.999, 1.0, 1.001, 1.0], "TIME", "시간 청산"],
  ];
  for (const [name, after, reason, replayReason] of cases) {
    it(`matches replayDayTrade on the ${name} path`, () => {
      const cs = scenario(after);
      const r = runStrategy(dayTradeBreakoutStrategy({ minTradeValue: 1 }), cs, { ref })!;
      const replay = replayDayTrade(ref, cs, kr, { floorScore: kr.minScore });
      expect(replay).toHaveLength(1);
      expect(r.trades).toHaveLength(1);
      expect(r.trades[0]!.reason).toBe(reason);
      expect(replay[0]!.exitReason).toBe(replayReason);
      expect(Math.sign(r.trades[0]!.returnPct)).toBe(Math.sign(replay[0]!.returnPct));
      expect(r.trades[0]!.returnPct).toBeCloseTo(replay[0]!.returnPct, 0);
      expect(r.trades[0]!.buyDate).toBe(cs[cs.findIndex((c) => c.date === replay[0]!.date) + 1]!.date);
    });
  }
});

describe("strategy comparison and look-ahead", () => {
  // 다섯 전략 모두 자르는 지점 전에 거래가 있는 시드
  const cs = randomWalk(500, 26);
  const index = randomWalk(500, 11, 0.0003);

  it("runs every strategy on the same window", () => {
    const rows = compareStrategies(cs, { index });
    expect(rows.map((x) => x.id)).toEqual(STRATEGIES.map((s) => s.id));
    const results = rows.map((x) => x.result!);
    for (const r of results) {
      expect(r).not.toBeNull();
      expect(r.equity[0]!.date).toBe(results[0]!.equity[0]!.date);
      expect(r.buyHoldReturnPct).toBeCloseTo(results[0]!.buyHoldReturnPct, 9);
    }
    expect(results.reduce((a, r) => a + r.tradeCount, 0)).toBeGreaterThan(0);
    expect(compareStrategies(cs, {}, ["rsi-recovery", "nope", "weinstein"]).map((x) => x.id)).toEqual(["rsi-recovery", "weinstein"]);
  });

  it("skips strategies that lack history without blocking the others", () => {
    const short = cs.slice(0, 120);
    const rows = compareStrategies(short);
    expect(rows.find((x) => x.id === "weinstein")!.result).toBeNull();
    expect(rows.find((x) => x.id === "seol-swing")!.result).not.toBeNull();
  });

  // 캔들마스터 패턴은 난수 보행에서 거의 나오지 않아 거래 여부는 따로 만든 시나리오(아래 candle master strategy)로 확인한다
  const SPARSE = new Set(["candle-master"]);
  for (const s of STRATEGIES) {
    it(`${s.id} is unaffected by data after the evaluation bar`, () => {
      const cut = 380;
      const tampered = cs.map((c, i) => (i >= cut ? { ...c, open: c.open * 3, high: c.high * 3.5, low: c.low * 0.2, close: c.close * 0.3, volume: c.volume * 9 } : c));
      const a = runStrategy(s, cs, { index })!;
      const b = runStrategy(s, tampered, { index })!;
      const n = a.equity.findIndex((p) => p.date === cs[cut]!.date);
      expect(n).toBeGreaterThan(0);
      expect(b.equity.slice(0, n)).toEqual(a.equity.slice(0, n));
      const before = (r: typeof a) => r.trades.filter((t) => t.sellDate < cs[cut]!.date);
      if (!SPARSE.has(s.id)) expect(before(a).length).toBeGreaterThan(0);
      expect(before(b)).toEqual(before(a));
    });
  }
});

describe("limit orders", () => {
  const lim = (limitPrice: number, limitBars: number, extra: Partial<StrategyEntry> = {}): StrategyEntry => ({ stop: 80, limitPrice, limitBars, reason: "지정가", ...extra });

  it("fills at the open when the open is at or below the limit", () => {
    const cs = bars([...flat(1), [99, 100, 98, 99], ...flat(4)]);
    const r = runStrategy(scripted({ 0: lim(100, 3) }, { 2: { fraction: 1, kind: "SIGNAL", reason: "청산" } }).s, cs, {}, noCost)!;
    expect(r.trades[0]).toMatchObject({ buyDate: cs[1]!.date, buyPrice: 99, sellDate: cs[3]!.date });
  });

  it("fills at the limit intrabar and skips the target on that bar", () => {
    const cs = bars([...flat(1), [103, 104, 102, 103], [103, 106, 99, 101], [101, 106, 100, 105], ...flat(2, 105)]);
    const r = runStrategy(scripted({ 0: lim(100, 3, { target: 104 }) }).s, cs, {}, noCost)!;
    // 1봉: 저가 102 > 100이라 안 닿음 → 2봉 장중 100에 체결. 2봉 고가 106은 체결 전일 수 있어 목표로 보지 않는다
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ buyDate: cs[2]!.date, buyPrice: 100, sellDate: cs[3]!.date, sellPrice: 104, reason: "TARGET" });
  });

  it("expires after limitBars, never fills on the order bar, and pauses new entries while pending", () => {
    const cs = bars([[100, 100, 90, 100], [100, 101, 96, 100], [100, 101, 96, 100], [100, 101, 90, 95], ...flat(2)]);
    const { s, entryCalls } = scripted({ 0: lim(95, 2) });
    const r = runStrategy(s, cs, {}, noCost)!;
    // 0봉 저가 90은 주문 전(종가에 낸 주문). 1·2봉은 안 닿고 2봉에서 만료 → 3봉 저가 90에도 체결 없음
    expect(r.trades).toHaveLength(0);
    expect(r.openPosition).toBe(false);
    expect(r.finalEquity).toBe(DEFAULT_RUN.initialCash);
    // 대기 중(1봉)에는 진입을 평가하지 않고, 만료된 2봉 종가부터 다시 평가한다
    expect(entryCalls).toEqual([0, 2, 3, 4]);
    // 유효 기간을 3봉으로 늘리면 3봉에 지정가로 체결
    const longer = runStrategy(scripted({ 0: lim(95, 3) }, { 4: { fraction: 1, kind: "SIGNAL", reason: "청산" } }).s, cs, {}, noCost)!;
    expect(longer.trades[0]).toMatchObject({ buyDate: cs[3]!.date, buyPrice: 95 });
  });

  it("cancels when the open gaps under the stop", () => {
    const cs = bars([...flat(1), [75, 76, 74, 75], [96, 97, 94, 96], ...flat(2)]);
    const { s, entryCalls } = scripted({ 0: lim(95, 3) });
    const r = runStrategy(s, cs, {}, noCost)!;
    expect(r.openPosition).toBe(false);
    expect(r.trades).toHaveLength(0);
    expect(entryCalls.slice(0, 2)).toEqual([0, 1]); // 취소된 봉 종가에 다시 평가
  });

  it("checks the stop on the fill bar, measured from the fill price", () => {
    const cs = bars([...flat(1), [103, 104, 85, 90], ...flat(2, 90)]);
    const r = runStrategy(scripted({ 0: lim(100, 3, { stopPct: 10 }) }).s, cs, {}, noCost)!;
    expect(r.trades[0]).toMatchObject({ buyDate: cs[1]!.date, buyPrice: 100, sellDate: cs[1]!.date, sellPrice: 90, reason: "STOP_LOSS" });
  });

  it("does not look ahead", () => {
    const cs = bars([...flat(1), [103, 104, 102, 103], [103, 106, 99, 101], [101, 106, 100, 105], ...flat(2, 105)]);
    const tampered = cs.map((c, i) => (i >= 3 ? { ...c, open: 50, high: 300, low: 1, close: 60 } : c));
    const run = (x: Candle[]) => runStrategy(scripted({ 0: lim(100, 3, { target: 104 }) }).s, x, {}, noCost)!;
    const a = run(cs), b = run(tampered);
    expect(b.equity.slice(0, 3)).toEqual(a.equity.slice(0, 3));
    expect(b.trades[0]!.buyDate).toBe(cs[2]!.date);
    expect(b.trades[0]!.buyPrice).toBe(100);
  });

  it("lets updateStop rename the stop and its rule", () => {
    const s: Strategy<null> = {
      ...scripted({ 0: { stop: 80, reason: "x" } }).s,
      updateStop: (i) => (i >= 2 ? { price: 100, rule: "M3-13 캔들마스터", label: "본전 스탑" } : null),
    };
    const cs = bars([...flat(1), [100, 110, 99.5, 108], [108, 112, 104, 110], [105, 106, 98, 99], ...flat(2)]);
    const t = runStrategy(s, cs, {}, noCost)!.trades[0]!;
    expect(t).toMatchObject({ reason: "STOP_LOSS", sellPrice: 100, exitRule: "M3-13 캔들마스터", sellDate: cs[3]!.date });
    expect(t.exitReason).toContain("본전 스탑 100.00 이탈");
  });
});

// ───── 캔들마스터 시나리오: 직전 파동 → 수평 횡보 → 양봉 스프링(60주) ─────

type Row = [number, number, number, number];

/** 주봉 행 → 월~금 일봉 행 5개(합치면 정확히 그 주봉) */
const weekDays = ([o, h, l, c]: Row): Row[] => {
  const m = (o + c) / 2;
  return [[o, o, o, o], [o, h, Math.min(o, m), m], [m, m, l, m], [m, m, m, m], [m, Math.max(m, c), Math.min(m, c), c]];
};

/** 0~19주 60→100 상승, 20~44주 100→50 하락, 45~59주 수평 횡보(저점이 매주 step씩 오름), 60주 신호 */
function cmWeeks(signal: Row, step = 0.25): Row[] {
  const rows: Row[] = [];
  const trend = (from: number, to: number, n: number) => {
    for (let j = 1; j <= n; j++) {
      const o = from + ((to - from) * (j - 1)) / n, c = from + ((to - from) * j) / n;
      rows.push([o, Math.max(o, c) * 1.02, Math.min(o, c) * 0.98, c]);
    }
  };
  trend(60, 100, 20);
  trend(100, 50, 25);
  for (let w = 0; w < 15; w++) {
    const b = 50 + w * step;
    rows.push(w % 2 ? [b + 1, b + 1.8, b - 0.8, b] : [b, b + 1.8, b - 0.8, b + 1]);
  }
  rows.push(signal);
  return rows;
}

function climb(from: number, to: number, r = 1.02): Row[] {
  const out: Row[] = [];
  for (let p = from; p < to; p *= r) out.push([p, p * r * 1.003, p * 0.997, p * r]);
  return out;
}
function slide(from: number, to: number, r = 0.98): Row[] {
  const out: Row[] = [];
  for (let p = from; p > to; p *= r) out.push([p, p * 1.003, p * r * 0.997, p * r]);
  return out;
}

describe("candle master strategy", () => {
  const SPRING: Row = [52.5, 55.5, 50.2, 55];
  const STOP = 50.2 * 0.99;
  const L = 55 - (55 - STOP) / 3; // M3-12 진입가
  const SIGNAL_BAR = 60 * 5 + 4; // 60주 금요일
  const FILL_BAR = SIGNAL_BAR + 2; // 다음 주 화요일
  const base = cmWeeks(SPRING).flatMap(weekDays);
  const dip: Row[] = [[54.5, 55, 54, 54.5], [54.5, 54.6, 53, 53.5]];
  const run = (tail: Row[], p = {}) => {
    const cs = bars([...base, ...dip, ...tail]);
    return { cs, r: runStrategy(candleMasterStrategy(p), cs, {}, noCost)! };
  };

  it("is listed with its metadata", () => {
    expect(STRATEGIES.map((s) => s.id)).toEqual(["weinstein", "seol-swing", "rsi-recovery", "bbc-pullback", "daytrade-breakout", "candle-master"]);
    expect(getStrategy("candle-master")).toMatchObject({ name: "캔들마스터 주봉 캔들", source: "캔들마스터", timeframe: "weekly" });
    expect(getStrategy("candle-master")!.rules).toEqual(expect.arrayContaining(["M3-12 캔들마스터", "M3-13 캔들마스터", "M4-01 캔들마스터"]));
  });

  it("matches candleMasterAt on the signal week", () => {
    const cs = bars(base);
    const r = candleMasterAt(toWeekly(cs), 60)!;
    expect(r).toMatchObject({ valid: true, standard: true, primary: "SPRING" });
    expect(r.entry).toBeCloseTo(L, 9);
    expect(cs[SIGNAL_BAR]!.date).toBe(r.date);
  });

  it("waits at the M3-12 limit, fills intrabar, and sells everything at 3x", () => {
    const { cs, r } = run(climb(53.5, 170));
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    expect(t.buyDate).toBe(cs[FILL_BAR]!.date);
    expect(t.buyPrice).toBeCloseTo(L, 9);
    expect(t).toMatchObject({ reason: "TARGET", fraction: 1, entryRule: "M3-12 캔들마스터", exitRule: "M3-13 캔들마스터" });
    expect(t.sellPrice).toBeCloseTo(L * 3, 6);
    expect(t.returnPct).toBeCloseTo(200, 6);
    expect(t.entryReason).toContain("양봉 스프링");
    expect(t.entryReason).toContain("표준");
  });

  it("raises the stop to breakeven after +100% (M3-13)", () => {
    const { r } = run([...climb(53.5, 110), ...slide(110, 40)]);
    const t = r.trades[0]!;
    expect(t).toMatchObject({ reason: "STOP_LOSS", exitRule: "M3-13 캔들마스터" });
    expect(t.exitReason).toContain("본전 스탑");
    expect(t.sellPrice).toBeCloseTo(L, 9);
    expect(t.returnPct).toBeCloseTo(0, 9);
    // +100%에 못 닿으면 원래 신호 손절가(M4-01)에서 나간다
    const { r: r2 } = run([...climb(53.5, 100), ...slide(100, 40)]);
    expect(r2.trades[0]).toMatchObject({ reason: "STOP_LOSS", exitRule: "M4-01 캔들마스터" });
    expect(r2.trades[0]!.sellPrice).toBeCloseTo(STOP, 9);
    expect(r2.trades[0]!.exitReason).toContain("손절가");
  });

  it("lets the limit order expire after about four weeks", () => {
    const wait: Row[] = Array.from({ length: 18 }, () => [56, 56.5, 55.5, 56]);
    const fall: Row[] = [[56, 56, 52, 52.5], ...Array.from({ length: 9 }, (): Row => [52.5, 52.6, 52.4, 52.5])];
    // dip 대신 4주(20봉) 내내 지정가 위 → 21번째 봉에서 닿아도 체결하지 않는다
    const cs = bars([...base, [56, 56.5, 55.5, 56], [56, 56.5, 55.5, 56], ...wait, ...fall]);
    const r = runStrategy(candleMasterStrategy(), cs, {}, noCost)!;
    expect(r.trades).toHaveLength(0);
    expect(r.openPosition).toBe(false);
    expect(cs[SIGNAL_BAR + 21]!.low).toBeLessThan(L);
    // 유효 기간이 더 길면 그 봉에서 지정가로 체결
    const longer = runStrategy(candleMasterStrategy({ limitBars: 30 }), cs, {}, noCost)!;
    expect(longer.openPosition).toBe(true);
  });

  it("can wait at the midpoint instead", () => {
    const deeper: Row[] = [[54.5, 55, 54, 54.5], [54.5, 54.6, 52, 53.5]];
    const cs = bars([...base, ...deeper, ...climb(53.5, 170)]);
    const mid = runStrategy(candleMasterStrategy({ entryMode: "mid" }), cs, {}, noCost)!.trades[0]!;
    const third = runStrategy(candleMasterStrategy(), cs, {}, noCost)!.trades[0]!;
    expect(mid.buyPrice).toBeCloseTo((55 + STOP) / 2, 9);
    expect(third.buyPrice).toBeCloseTo(L, 9);
    expect(mid.sellPrice).toBeCloseTo(mid.buyPrice * 3, 6);
  });

  it("targets 2x for a non-standard setup", () => {
    const sig: Row = [50.5, 53, 48.5, 52.8];
    const L2 = 52.8 - (52.8 - 48.5 * 0.99) / 3;
    const cs = bars([...cmWeeks(sig, 0).flatMap(weekDays), [52, 52.5, 51.8, 52], [52, 52.1, 51, 51.5], ...climb(51.5, 120)]);
    const t = runStrategy(candleMasterStrategy(), cs, {}, noCost)!.trades[0]!;
    expect(t.buyPrice).toBeCloseTo(L2, 9);
    expect(t).toMatchObject({ reason: "TARGET", fraction: 1 });
    expect(t.sellPrice).toBeCloseTo(L2 * 2, 6);
    expect(t.entryReason).toContain("비표준");
  });

  it("needs a year of weekly candles", () => {
    expect(runStrategy(candleMasterStrategy(), bars(base.slice(0, 40 * 5)))).toBeNull();
    expect(compareStrategies(bars(base.slice(0, 40 * 5))).find((x) => x.id === "candle-master")!.result).toBeNull();
  });

  it("is unaffected by data after the evaluation bar", () => {
    const { cs, r: a } = run(climb(53.5, 170));
    const sold = cs.findIndex((c) => c.date === a.trades[0]!.sellDate);
    for (const cut of [SIGNAL_BAR + 1, FILL_BAR, sold + 3]) {
      const tampered = cs.map((c, i) => (i >= cut ? { ...c, open: c.open * 3, high: c.high * 3.5, low: c.low * 0.2, close: c.close * 0.3 } : c));
      const b = runStrategy(candleMasterStrategy(), tampered, {}, noCost)!;
      const n = a.equity.findIndex((p) => p.date === cs[cut]!.date);
      expect(b.equity.slice(0, n)).toEqual(a.equity.slice(0, n));
      const before = (x: typeof a) => x.trades.filter((t) => t.sellDate < cs[cut]!.date);
      expect(before(b)).toEqual(before(a));
    }
    expect(a.trades.filter((t) => t.sellDate < cs[sold + 3]!.date)).toHaveLength(1);
  });
});
