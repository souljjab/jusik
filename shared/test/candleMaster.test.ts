import { describe, expect, it } from "vitest";
import {
  CANDLE_MASTER_PARAMS, CANDLE_MASTER_SIGNAL_LABEL, candleMaster, candleMaster244Note, candleMasterAt, candleMasterSignals, candleMasterSizing, candleMasterWave,
} from "../src/candleMaster";
import type { Candle } from "../src/types";
import { toWeekly, type WeeklyBar } from "../src/weekly";

type Row = [number, number, number, number]; // 시가, 고가, 저가, 종가

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** 주봉 OHLC 행 → WeeklyBar(2022-01-03 월요일부터 매주, 날짜는 금요일) */
function weeksOf(rows: Row[], vol = 1000): WeeklyBar[] {
  const t0 = Date.UTC(2022, 0, 3);
  return rows.map(([open, high, low, close], k) => ({
    weekKey: iso(t0 + k * 7 * DAY), date: iso(t0 + (k * 7 + 4) * DAY), open, high, low, close, volume: vol, startIndex: k * 5, endIndex: k * 5 + 4,
  }));
}

/** 주봉 행 → 월~금 일봉 5개(합치면 정확히 그 주봉) */
function dailyOf(rows: Row[], vol = 1000): Candle[] {
  const t0 = Date.UTC(2022, 0, 3);
  return rows.flatMap(([o, h, l, c], k) => {
    const m = (o + c) / 2;
    const d: Row[] = [[o, o, o, o], [o, h, Math.min(o, m), m], [m, m, l, m], [m, m, m, m], [m, Math.max(m, c), Math.min(m, c), c]];
    return d.map(([open, high, low, close], j) => ({ date: iso(t0 + (k * 7 + j) * DAY), open, high, low, close, volume: vol }));
  });
}

interface ScenarioOpts {
  start?: number;
  peak?: number;
  bottom?: number;
  /** 수평 구간 저점이 매주 오르는 폭(바닥 50 기준) */
  step?: number;
  /** 바닥 50 기준 신호 주 행(바닥에 맞춰 배율 조정) */
  signal?: Row[];
}

/**
 * 직전 파동(0~19주 start→peak 상승, 20~44주 peak→bottom 하락) 뒤 45~59주 수평 횡보, 60주부터 signal.
 * 기본값: 고점 102, 수평 구간 저점이 서서히 오르는 교과서형 파동
 */
function scenario({ start = 60, peak = 100, bottom = 50, step = 0.25, signal = [] }: ScenarioOpts = {}): Row[] {
  const rows: Row[] = [];
  const s = bottom / 50;
  const trend = (from: number, to: number, n: number) => {
    for (let j = 1; j <= n; j++) {
      const o = from + ((to - from) * (j - 1)) / n, c = from + ((to - from) * j) / n;
      rows.push([o, Math.max(o, c) * 1.02, Math.min(o, c) * 0.98, c]);
    }
  };
  trend(start, peak, 20);
  trend(peak, bottom, 25);
  for (let w = 0; w < 15; w++) {
    const b = bottom + w * step * s;
    rows.push(w % 2 ? [b + s, b + 1.8 * s, b - 0.8 * s, b] : [b, b + 1.8 * s, b - 0.8 * s, b + s]);
  }
  rows.push(...signal.map((r) => r.map((x) => x * s) as Row));
  return rows;
}

const SPRING: Row = [52.5, 55.5, 50.2, 55];
const K = 60;
const at = (rows: Row[], k = rows.length - 1, params = {}) => candleMasterAt(weeksOf(rows), k, params)!;
const ids = (rows: Row[], k = rows.length - 1) => candleMasterSignals(weeksOf(rows), k).map((s) => s.id);

describe("candle master wave", () => {
  it("reads a horizontal, spaced, slowly rising base after a prior wave", () => {
    const w = candleMasterWave(weeksOf(scenario({ signal: [SPRING] })), K);
    expect(w.exclusions).toEqual([]);
    expect(w).toMatchObject({ horizontal: true, spaced: true, rising: true, excluded: false, ok: true, textbook: true, weeks: 61 });
    const m = w.metrics!;
    // 수평 구간 = 48~59주(신호 주 제외)
    expect(m.baseHigh).toBeCloseTo(53.5 + 1.8);
    expect(m.baseLow).toBeCloseTo(50.75 - 0.8);
    expect(m.priorHigh).toBeCloseTo(102);
    expect(m.gapWeeks).toBe(48 - 20); // 고점(102)이 마지막으로 나온 20주
    expect(m.lowSlopePct).toBeCloseTo(((52.25 - 0.8) / (50.75 - 0.8) - 1) * 100);
    expect(m.rangeRatio).toBeLessThan(CANDLE_MASTER_PARAMS.baseVsPriorMax);
    expect(m.drawdownPct).toBeCloseTo((1 - 55 / 102) * 100);
    expect(m.runupMultiple).toBeCloseTo(102 / (60 * 0.98));
    expect(m.lowBreaks).toBe(0);
    expect(w.notes.every((n) => n.rule === "4.5 캔들마스터")).toBe(true);
    expect(w.notes.some((n) => n.text.includes("수평 파동"))).toBe(true);
  });

  it("flat lows are horizontal but not the textbook rising position", () => {
    const w = candleMasterWave(weeksOf(scenario({ step: 0, signal: [SPRING] })), K);
    expect(w.horizontal).toBe(true);
    expect(w.rising).toBe(false);
    expect(w.ok).toBe(true);
    expect(w.textbook).toBe(false);
    // 저점이 계속 내려가면 수평이 아니다
    expect(candleMasterWave(weeksOf(scenario({ step: -0.5, signal: [SPRING] })), K).horizontal).toBe(false);
  });

  it("excludes short histories", () => {
    const rows = scenario({ signal: [SPRING] }).slice(15); // 46주
    const w = candleMasterWave(weeksOf(rows), rows.length - 1);
    expect(w.exclusions).toEqual(["SHORT_HISTORY"]);
    expect(w.metrics).toBeNull();
    expect(w.ok).toBe(false);
    expect(w.notes[0]!.text).toContain("상장 기간이 짧은");
    const r = at(rows);
    expect(r.signals.map((s) => s.id)).toEqual(["SPRING"]); // 신호는 보이지만
    expect(r).toMatchObject({ valid: false, standard: false, entry: null, target: null, breakevenTrigger: null });
    expect(r.stop).not.toBeNull();
    expect(r.notes.some((n) => n.tone === "warn" && n.text.includes("진입 근거가 없어요"))).toBe(true);
    // 기준을 낮추면 해석한다
    expect(candleMasterWave(weeksOf(rows), rows.length - 1, { minWeeks: 40 }).exclusions).not.toContain("SHORT_HISTORY");
  });

  it("excludes a 10x run-up from the lowest low", () => {
    const w = candleMasterWave(weeksOf(scenario({ start: 9, signal: [SPRING] })), K);
    expect(w.metrics!.runupMultiple).toBeGreaterThanOrEqual(10);
    expect(w.exclusions).toContain("RUNUP");
    expect(w.ok).toBe(false);
    expect(w.notes.find((n) => n.tone === "bad")!.text).toContain("배 올랐어요");
    expect(candleMasterWave(weeksOf(scenario({ start: 12, signal: [SPRING] })), K).exclusions).not.toContain("RUNUP");
  });

  it("excludes a drawdown far beyond 50% from the high", () => {
    const deep = candleMasterWave(weeksOf(scenario({ bottom: 35, signal: [SPRING] })), K);
    expect(deep.metrics!.drawdownPct).toBeGreaterThan(60);
    expect(deep.exclusions).toContain("DEEP_DRAWDOWN");
    // 기본 시나리오(약 46% 하락)는 '50%를 크게 넘지' 않는다. 기준을 바꾸면 제외된다
    expect(candleMasterWave(weeksOf(scenario({ signal: [SPRING] })), K).exclusions).not.toContain("DEEP_DRAWDOWN");
    expect(candleMasterWave(weeksOf(scenario({ signal: [SPRING] })), K, { maxDrawdownPct: 40 }).exclusions).toContain("DEEP_DRAWDOWN");
  });

  it("excludes stretches whose lows were broken several times", () => {
    const once = scenario({ signal: [SPRING] });
    once[55] = [51.5, 52, 47.5, 48]; // 직전 8주 저점(약 49.95) 아래 마감 1번
    const w1 = candleMasterWave(weeksOf(once), K);
    expect(w1.metrics!.lowBreaks).toBe(1);
    expect(w1.exclusions).not.toContain("BROKEN_LOWS");
    const twice = [...once];
    twice[58] = [48.5, 49, 46.5, 47]; // 한 번 더
    const w2 = candleMasterWave(weeksOf(twice), K);
    expect(w2.metrics!.lowBreaks).toBe(2);
    expect(w2.exclusions).toContain("BROKEN_LOWS");
    expect(w2.notes.some((n) => n.text.includes("2번 깼어요"))).toBe(true);
    // 장중에만 깨고 위에서 마감(스프링)한 주는 세지 않는다
    expect(candleMasterWave(weeksOf(scenario({ signal: [SPRING] })), K).metrics!.lowBreaks).toBe(0);
  });

  it("needs the base to be narrow relative to the prior wave and spaced from its peak", () => {
    // 직전 파동 고점(약 58)과 수평 구간(약 55)이 너무 가깝다
    const close = candleMasterWave(weeksOf(scenario({ start: 25, peak: 57, signal: [SPRING] })), K);
    expect(close.horizontal).toBe(true);
    expect(close.spaced).toBe(false);
    expect(close.metrics!.gapPct).toBeLessThan(CANDLE_MASTER_PARAMS.minGapPct);
    expect(close.ok).toBe(false);
    // 시간 간격 기준
    expect(candleMasterWave(weeksOf(scenario({ signal: [SPRING] })), K, { minGapWeeks: 40 }).spaced).toBe(false);
    // 수평 구간이 넓게 출렁이면 수평 파동이 아니다
    const wide = scenario({ signal: [SPRING] }).map((r, k): Row => (k >= 48 && k < K ? (k % 2 ? [58, 72, 50, 52] : [52, 72, 50, 58]) : r));
    const ww = candleMasterWave(weeksOf(wide), K);
    expect(ww.horizontal).toBe(false);
    expect(ww.notes.some((n) => n.text.includes("넓어요"))).toBe(true);
  });

  it("only uses weeks up to k", () => {
    const rows = scenario({ signal: [SPRING, [55, 70, 20, 25], [25, 300, 1, 2]] });
    const a = candleMasterWave(weeksOf(rows), K);
    expect(candleMasterWave(weeksOf(rows.slice(0, K + 1)), K)).toEqual(a);
  });
});

describe("candle master signals", () => {
  const base = (signal: Row[]) => scenario({ signal });

  it("detects the bullish spring and rejects near misses", () => {
    expect(ids(base([SPRING]))).toEqual(["SPRING"]);
    const sig = candleMasterSignals(weeksOf(base([SPRING])), K)[0]!;
    expect(sig).toMatchObject({ id: "SPRING", name: CANDLE_MASTER_SIGNAL_LABEL.SPRING, weeks: 1, refLow: 50.2 });
    expect(sig.notes[0]!.rule).toBe("4.5 캔들마스터");
    expect(ids(base([[52.5, 55.5, 51.5, 55]]))).not.toContain("SPRING"); // 지지(50.95)를 깨지 않음
    expect(ids(base([[52.5, 55.5, 44, 55]]))).not.toContain("SPRING"); // 10% 넘게 깸(붕괴)
    expect(ids(base([[55, 55.5, 50.2, 52.5]]))).not.toContain("SPRING"); // 음봉
    expect(ids(base([[50.5, 55.5, 50.2, 50.9]]))).not.toContain("SPRING"); // 지지 아래에서 마감
    expect(ids(base([[51, 58, 50.2, 53]]))).not.toContain("SPRING"); // 범위 아래쪽에서 마감
  });

  it("detects the small bullish candle with long upper and lower tails", () => {
    const row: Row = [53, 56, 51.5, 54];
    expect(ids(base([row]))).toEqual(["LONG_TAILS"]);
    expect(ids(base([[51.9, 56, 51.5, 54.2]]))).not.toContain("LONG_TAILS"); // 몸통 4% 초과
    expect(ids(base([[53, 54.5, 51.5, 54]]))).not.toContain("LONG_TAILS"); // 위꼬리 짧음
    expect(ids(base([[54, 56, 51.5, 53]]))).not.toContain("LONG_TAILS"); // 음봉
  });

  it("detects the bullish candle whose upper tail is about as long as its body", () => {
    expect(ids(base([[52, 56, 51.8, 54]]))).toEqual(["UPPER_TAIL"]);
    expect(ids(base([[52, 54.2, 51.8, 54]]))).not.toContain("UPPER_TAIL"); // 위꼬리가 너무 짧음(0.1:1)
    expect(ids(base([[52, 58, 51.8, 54]]))).not.toContain("UPPER_TAIL"); // 위꼬리가 너무 김(2:1)
    expect(ids(base([[52, 56, 50.6, 54]]))).not.toContain("UPPER_TAIL"); // 아래꼬리도 김
    expect(ids(base([[53.6, 56, 53.5, 54]]))).not.toContain("UPPER_TAIL"); // 몸통이 너무 작음
  });

  it("treats double and multiple tail groups as a signal by themselves", () => {
    const two = scenario({ signal: [] });
    two[59] = [53, 53.6, 51.2, 53.3];
    two.push([53.2, 53.9, 51.4, 53.6]);
    const sig = candleMasterSignals(weeksOf(two), K);
    expect(sig.map((s) => s.id)).toEqual(["TAIL_GROUP"]);
    expect(sig[0]).toMatchObject({ weeks: 2, refLow: 51.2 });
    expect(sig[0]!.notes[0]!.text).toContain("이중 꼬리군");
    // 3주 연속이면 다중 꼬리군
    const three = [...two];
    three[58] = [52.8, 53.4, 51.3, 53.1];
    const s3 = candleMasterSignals(weeksOf(three), K)[0]!;
    expect(s3).toMatchObject({ id: "TAIL_GROUP", weeks: 3 });
    expect(s3.notes[0]!.text).toContain("다중 꼬리군");
    // 꼬리 끝이 흩어져 있으면 아니다
    const spread = [...two];
    spread[59] = [51, 51.6, 48.9, 51.3];
    expect(ids(spread)).not.toContain("TAIL_GROUP");
    // 한 주뿐이면 아니다
    expect(ids(base([[53.2, 53.9, 51.4, 53.6]]))).toEqual([]);
    // 꼬리가 캔들 고저 범위의 절반에 못 미치면(위꼬리도 길면) 꼬리군이 아니다
    const mixed = [...two];
    mixed[59] = [53, 55.5, 51.2, 53.3];
    expect(ids(mixed)).not.toContain("TAIL_GROUP");
    // 위꼬리 군도 같은 방식
    const upper = scenario({ signal: [] });
    upper[59] = [53, 56, 52.8, 53.3];
    upper.push([53.2, 56.2, 53, 53.6]);
    expect(ids(upper)).toEqual(["TAIL_GROUP"]);
    expect(candleMasterSignals(weeksOf(upper), K)[0]!.notes[0]!.text).toContain("위꼬리");
  });

  it("finds nothing in the plain base candles", () => {
    const rows = scenario();
    for (let k = 46; k < rows.length; k++) expect(ids(rows, k)).toEqual([]);
  });
});

describe("candle master entry, stop and target", () => {
  it("builds a standard setup: M3-12 entry, signal stop, 3x target and breakeven trigger", () => {
    const r = at(scenario({ signal: [SPRING] }));
    const stop = 50.2 * (1 - CANDLE_MASTER_PARAMS.stopBufferPct / 100);
    const entry = 55 - (55 - stop) / 3;
    expect(r).toMatchObject({ k: K, close: 55, primary: "SPRING", valid: true, standard: true, targetMultiple: 3, waitPrice: null });
    expect(r.stop).toBeCloseTo(stop, 9);
    expect(r.entry).toBeCloseTo(entry, 9);
    expect(r.entry).toBeCloseTo(53.2327, 3);
    expect(r.entryMid).toBeCloseTo((55 + stop) / 2, 9);
    expect(r.stopPct).toBeCloseTo((1 - stop / entry) * 100, 9);
    expect(r.target).toBeCloseTo(entry * 3, 9);
    expect(r.breakevenTrigger).toBeCloseTo(entry * 2, 9);
    expect(r.group).toMatchObject({ weeks: 6, compact: true });
    expect(r.date).toBe(weeksOf(scenario({ signal: [SPRING] }))[K]!.date);
    const rules = r.notes.map((n) => n.rule);
    for (const id of ["4.5 캔들마스터", "M3-12 캔들마스터", "M3-13 캔들마스터", "M4-01 캔들마스터"]) expect(rules).toContain(id);
    expect(r.notes.find((n) => n.rule === "M3-13 캔들마스터")!.text).toContain("3배");
    for (const n of r.notes) expect(n.text).toContain("요"); // 해요체
  });

  it("uses a 2x target when any layer is non-standard", () => {
    // 저점이 평평(파동 비표준). 수평 구간 저점이 49.2라 스프링은 그 아래를 찍어야 한다
    const flat = at(scenario({ step: 0, signal: [[50.5, 53, 48.5, 52.8]] }));
    expect(flat.primary).toBe("SPRING");
    expect(flat.wave).toMatchObject({ ok: true, textbook: false });
    expect(flat).toMatchObject({ valid: true, standard: false, targetMultiple: 2 });
    expect(flat.target).toBeCloseTo(flat.entry! * 2, 9);
    expect(flat.breakevenTrigger).toBeCloseTo(flat.entry! * 2, 9);
    expect(flat.notes.find((n) => n.rule === "M3-13 캔들마스터")!.text).toContain("2배");
    // 캔들군이 넓음
    const loose = scenario({ signal: [SPRING] });
    loose[56] = [52, 61, 51.5, 52.5];
    const lr = at(loose);
    expect(lr.group!.compact).toBe(false);
    expect(lr.wave.ok).toBe(true);
    expect(lr).toMatchObject({ valid: true, standard: false, targetMultiple: 2 });
    // 손절폭이 기본 10%보다 넓음(최대 20% 안) — 경고와 분할 비중 안내
    const wide = at(scenario({ signal: [[52.5, 55.5, 46, 55]] }));
    expect(wide.primary).toBe("SPRING");
    expect(wide.stopPct!).toBeGreaterThan(10);
    expect(wide.stopPct!).toBeLessThanOrEqual(20);
    expect(wide).toMatchObject({ valid: true, standard: false, targetMultiple: 2 });
    const m401 = wide.notes.find((n) => n.rule === "M4-01 캔들마스터")!;
    expect(m401.tone).toBe("warn");
    expect(m401.text).toContain("7~8%");
  });

  it("waits when the stop would be more than 20% away (M4-01)", () => {
    const r = at(scenario({ signal: [[54, 58, 40, 55]] }));
    expect(r.signals.map((s) => s.id)).toEqual(["LONG_TAILS"]);
    const stop = 40 * 0.99;
    const entry = 55 - (55 - stop) / 3;
    expect(r.stopPct).toBeCloseTo((1 - stop / entry) * 100, 9);
    expect(r.stopPct!).toBeGreaterThan(20);
    expect(r).toMatchObject({ valid: false, standard: false, entry: null, entryMid: null, target: null, breakevenTrigger: null });
    expect(r.stop).toBeCloseTo(stop, 9);
    expect(r.waitPrice).toBeCloseTo(stop / 0.8, 9);
    expect(r.notes.find((n) => n.rule === "M4-01 캔들마스터")!.text).toContain("범위 안으로 내려올 때까지 진입을 미뤄요");
    // 기준을 넓히면 진입할 수 있다(기본값은 책의 −20%)
    expect(at(scenario({ signal: [[54, 58, 40, 55]] }), K, { maxStopPct: 25 }).valid).toBe(true);
  });

  it("puts the tail-group stop under the group's lowest low", () => {
    const rows = scenario();
    rows[59] = [53, 53.6, 51.2, 53.3];
    rows.push([53.2, 53.9, 51.4, 53.6]);
    const r = at(rows);
    expect(r.primary).toBe("TAIL_GROUP");
    expect(r.stop).toBeCloseTo(51.2 * 0.99, 9);
    expect(r.valid).toBe(true);
  });

  it("prefers a single-candle signal's stop over the group's", () => {
    // 스프링이면서 꼬리군에도 걸리는 주: 스프링 캔들 저가 기준
    const rows = scenario();
    rows[59] = [53, 53.6, 51.6, 53.3];
    rows.push([52.4, 54.25, 50.5, 54.2]);
    const r = at(rows);
    expect(r.signals.map((s) => s.id)).toEqual(["SPRING", "TAIL_GROUP"]);
    expect(r.primary).toBe("SPRING");
    expect(r.stop).toBeCloseTo(50.5 * 0.99, 9);
  });

  it("says to wait when the wave is fine but there is no signal", () => {
    const r = at(scenario(), 59);
    expect(r.wave.ok).toBe(true);
    expect(r.signals).toEqual([]);
    expect(r).toMatchObject({ valid: false, primary: null, stop: null, entry: null });
    expect(r.notes.at(-1)!.text).toContain("기다려요");
  });

  it("does not look ahead and ignores volume", () => {
    const rows = scenario({ signal: [SPRING] });
    const a = at(rows, K);
    const future = [...rows, [55, 200, 1, 150], [150, 151, 10, 11]] as Row[];
    expect(candleMasterAt(weeksOf(future), K)).toEqual(a);
    // 이동평균·거래량을 쓰지 않는다
    const vols = weeksOf(rows).map((w, k) => ({ ...w, volume: (k * 7919) % 100_000 }));
    expect(candleMasterAt(vols, K)).toEqual(a);
    expect(candleMasterAt(weeksOf(rows), 999)).toBeNull();
    expect(candleMasterAt(weeksOf(rows), -1)).toBeNull();
  });

  it("reads the last completed week from daily candles", () => {
    const rows = scenario({ signal: [SPRING] });
    const daily = dailyOf(rows);
    // 일봉을 합친 주봉이 원래 주봉과 같다
    expect(toWeekly(daily).map((w) => [w.open, w.high, w.low, w.close])).toEqual(rows);
    const r = candleMaster(daily)!;
    expect(r).toEqual(at(rows));
    // 다음 주 월요일 하나만 더 있으면(진행 중인 주) 마감된 주(60주)를 본다
    const t = Date.parse(daily.at(-1)!.date) + 3 * DAY;
    const r2 = candleMaster([...daily, { date: iso(t), open: 55, high: 90, low: 20, close: 30, volume: 1 }])!;
    expect(r2.k).toBe(K);
    expect(r2.entry).toBeCloseTo(r.entry!, 9);
    expect(candleMaster([])).toBeNull();
  });
});

describe("candle master sizing and expectations", () => {
  it("uses 20% x 5 up to 10 million won and 10% x 10 above (M4-03)", () => {
    expect(candleMasterSizing(5_000_000)).toMatchObject({ perStockPct: 20, maxPositions: 5, perStockAmount: 1_000_000 });
    expect(candleMasterSizing(10_000_000)).toMatchObject({ perStockPct: 20, maxPositions: 5, perStockAmount: 2_000_000 });
    expect(candleMasterSizing(10_000_001)).toMatchObject({ perStockPct: 10, maxPositions: 10 });
    expect(candleMasterSizing(50_000_000).perStockAmount).toBe(5_000_000);
    expect(candleMasterSizing(Number.NaN)).toMatchObject({ perStockPct: 20, maxPositions: 5, perStockAmount: 0 });
    expect(candleMasterSizing(-5)).toMatchObject({ perStockAmount: 0 });
    const s = candleMasterSizing(5_000_000);
    expect(s.notes[0]).toMatchObject({ tone: "info", rule: "M4-03 캔들마스터" });
    expect(s.notes[0]!.text).toContain("5,000,000원");
    expect(s.notes[0]!.text).toContain("최대 5종목");
    expect(s.notes[1]!.rule).toBe("5.2 캔들마스터");
    // 어떤 경우도 30% 이하
    expect(candleMasterSizing(1_000_000, { smallPerStockPct: 50 }).perStockPct).toBe(30);
  });

  it("explains the 2-4-4 rule as the author's unverified claim", () => {
    const n = candleMaster244Note();
    expect(n).toMatchObject({ tone: "info", rule: "4.5 캔들마스터" });
    expect(n.text).toContain("4개는 손절, 8개는 본전, 8개는 목표");
    expect(n.text).toContain("검증되지 않은 저자 주장");
    expect(candleMaster244Note({ stop: 2, breakeven: 4, target: 4 }).text).toContain("10건 중 손절 2 · 본전 4 · 목표 4건");
    expect(candleMaster244Note({ stop: 0, breakeven: 0, target: 0 }).text).toContain("아직 마감한 거래가 없어요");
  });

  it("keeps the book's numbers in the params", () => {
    expect(CANDLE_MASTER_PARAMS).toMatchObject({ maxRunupMultiple: 10, defaultStopPct: 10, maxStopPct: 20, standardMultiple: 3, nonStandardMultiple: 2, breakevenMultiple: 2 });
    expect(CANDLE_MASTER_PARAMS.entryFraction).toBeCloseTo(1 / 3);
  });
});
