import { describe, expect, it } from "vitest";
import { analyzeBreadth, analyzeBreadthAt, type BreadthAnalysis, type BreadthDay } from "../src/breadth";
import { rsi } from "../src/indicators";
import { buildMacroSnapshot, type MacroSnapshot } from "../src/macro";
import { assessRegime, assessRegimeAt, DEFAULT_POSTURE_CAPS, POSTURE_LABEL } from "../src/regimeScore";
import type { Candle } from "../src/types";

const DAY = 86_400_000;

/** 2022-01-03(월)부터 평일 일봉 */
function daily(closes: number[]): Candle[] {
  const out: Candle[] = [];
  let t = Date.UTC(2022, 0, 3);
  for (const c of closes) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += DAY;
    out.push({ date: new Date(t).toISOString().slice(0, 10), open: c, high: c * 1.005, low: c * 0.995, close: c, volume: 1e6 });
    t += DAY;
  }
  return out;
}

const range = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
/** 하루씩 번갈아 위아래로 흔들어 RSI가 100에 붙지 않게 한다 */
const zig = (i: number, a: number) => 1 + a * (i % 2 ? 1 : -1);

// 하루 0.4% 복리 우상향 + 0.6% 흔들림: 30주선 2단계, MACD 시그널 위, RSI 70 안팎
const bullCloses = range(300, (i) => 100 * 1.004 ** i * zig(i, 0.006));
// 150일 상승 뒤 150일 하락: 30주선 아래 4단계
const bearCloses = [...range(150, (i) => 100 + (40 * i) / 149), ...range(150, (i) => 140 - (50 * (i + 1)) / 150)].map((c, i) => c * zig(i, 0.003));
// 하락장 끝의 6일 반등: MACD는 시그널 위로, RSI는 30 아래에서 회복 — 그래도 국면은 약세
const bearBounceCloses = [...bearCloses, ...range(6, (i) => bearCloses.at(-1)! * 1.012 ** (i + 1))];
// 16일 주기로 위아래 3% 출렁이는 횡보
const sideCloses = range(300, (i) => 100 * (1 + 0.03 * Math.sin((2 * Math.PI * i) / 16)));

const negativeMacro: MacroSnapshot = {
  asOf: "2023-02-24",
  yieldSpread: { value: -0.4, date: "2023-02-24" },
  m2YoY: { value: 1, date: "2023-01-01" },
  gdpYoY: { value: 5, date: "2022-10-01" },
  excessLiquidity: -4,
};

describe("assessRegime", () => {
  it("rising index → ATTACK with the attack cap", () => {
    const a = assessRegime(daily(bullCloses))!;
    expect(a.stageRegime).toBe("BULL");
    expect(a.macdBullish).toBe(true);
    expect(a.choppy).toBe(false);
    expect(a.breakdown).toEqual({ stage: 2, macd: 1, rsi: 0, macro: 0, breadth: 0 });
    expect(a.score).toBe(3);
    expect(a.posture).toBe("ATTACK");
    expect(a.exposureCapPct).toBe(DEFAULT_POSTURE_CAPS.ATTACK);
    expect(a.notes[0]!.text).toContain(POSTURE_LABEL.ATTACK);
    expect(a.notes.some((n) => n.rule === "M1-01 와인스타인" && n.tone === "good")).toBe(true);
    expect(a.notes.some((n) => n.rule === "M1-03 강동진" && n.tone === "good")).toBe(true);
  });

  it("every note carries a rule tag", () => {
    for (const cs of [bullCloses, bearCloses, sideCloses]) {
      const a = assessRegime(daily(cs), negativeMacro)!;
      for (const n of a.notes) expect(n.rule, n.text).toBeTruthy();
    }
  });

  it("index below a falling 30-week line → DEFENSE", () => {
    const a = assessRegime(daily(bearCloses))!;
    expect(a.stageRegime).toBe("BEAR");
    expect(a.posture).toBe("DEFENSE");
    expect(a.exposureCapPct).toBe(DEFAULT_POSTURE_CAPS.DEFENSE);
    expect(a.notes.some((n) => n.rule === "M1-02 와인스타인" && n.tone === "bad")).toBe(true);
  });

  it("a bear-market bounce cannot lift the posture (M1-02 overrides the score)", () => {
    const a = assessRegime(daily(bearBounceCloses))!;
    expect(a.stageRegime).toBe("BEAR");
    expect(a.macdBullish).toBe(true);
    expect(a.score).toBeGreaterThan(-2); // 점수만 보면 중립
    expect(a.posture).toBe("DEFENSE");
  });

  it("frequent MACD crosses in a sideways market → choppy", () => {
    const a = assessRegime(daily(sideCloses))!;
    expect(a.choppy).toBe(true);
    expect(a.notes.some((n) => n.text.includes("횡보장") && n.rule === "M1-03 강동진")).toBe(true);
    expect(a.posture).not.toBe("ATTACK");
  });

  it("macro inversion and negative excess liquidity lower the score (capped at -2)", () => {
    const base = assessRegime(daily(bullCloses))!;
    const withMacro = assessRegime(daily(bullCloses), negativeMacro)!;
    expect(withMacro.breakdown.macro).toBe(-2);
    expect(withMacro.score).toBe(base.score - 2);
    expect(withMacro.posture).toBe("NEUTRAL");
    expect(withMacro.exposureCapPct).toBe(DEFAULT_POSTURE_CAPS.NEUTRAL);
    expect(withMacro.notes.some((n) => n.rule === "M1-06 강영현" && n.tone === "bad")).toBe(true);
    expect(withMacro.notes.some((n) => n.rule === "M1-07 강영현" && n.tone === "warn")).toBe(true);
    // 신호가 더 많아도 감점은 -2까지
    const worse = assessRegime(daily(bullCloses), { ...negativeMacro, vix: { value: 45, date: "2023-02-24" }, krwChange20dPct: 5 })!;
    expect(worse.breakdown.macro).toBe(-2);
    // 한 개면 -1
    const one = assessRegime(daily(bullCloses), { asOf: "2023-02-24", yieldSpread: { value: -0.1, date: "2023-02-24" } })!;
    expect(one.breakdown.macro).toBe(-1);
    // 원화 약세는 미국 지수에는 감점하지 않는다
    const krwOnly: MacroSnapshot = { asOf: "2023-02-24", krwPerUsd: { value: 1400, date: "2023-02-24" }, krwChange20dPct: 4 };
    expect(assessRegime(daily(bullCloses), krwOnly)!.breakdown.macro).toBe(-1);
    expect(assessRegime(daily(bullCloses), krwOnly, DEFAULT_POSTURE_CAPS, { region: "US" })!.breakdown.macro).toBe(0);
  });

  it("works with a snapshot built from raw series", () => {
    // 2022-01 ~ 2023-02 매월 같은 값 → 전년 대비 0%
    const monthly = Array.from({ length: 14 }, (_, k) => ({ date: new Date(Date.UTC(2022, k, 1)).toISOString().slice(0, 10), value: 100 }));
    const snap = buildMacroSnapshot({ T10Y2Y: [{ date: "2023-02-24", value: -0.5 }], M2SL: monthly });
    expect(snap.m2YoY?.value).toBeCloseTo(0);
    expect(assessRegime(daily(bullCloses), snap)!.breakdown.macro).toBe(-1);
  });

  it("RSI recovering from below 30 adds a point (M1-08)", () => {
    const closes = bearBounceCloses;
    const r = rsi(closes, 14);
    const i = closes.length - 1;
    // 전제: 최근 10봉 안에 30 아래, 지금은 30 이상
    expect(r.slice(i - 10, i).some((v) => v != null && v < 30)).toBe(true);
    expect(r[i]!).toBeGreaterThanOrEqual(30);
    const a = assessRegime(daily(closes))!;
    expect(a.breakdown.rsi).toBe(1);
    expect(a.notes.some((n) => n.rule === "M1-08 강영현" && n.tone === "good")).toBe(true);
    // 회복 전(아직 30 아래)에는 가점 없음
    const before = assessRegime(daily(bearCloses))!;
    expect(before.rsi!).toBeLessThan(30);
    expect(before.breakdown.rsi).toBe(0);
  });

  it("an overheated index RSI (>75) costs a point", () => {
    const a = assessRegime(daily(range(300, (i) => 100 * 1.002 ** i)))!;
    expect(a.rsi!).toBeGreaterThan(75);
    expect(a.breakdown.rsi).toBe(-1);
    expect(a.notes.some((n) => n.tone === "warn" && n.rule === "2.4 강영현")).toBe(true);
  });

  it("custom caps are applied", () => {
    const caps = { ATTACK: 60, NEUTRAL: 40, DEFENSE: 20 };
    expect(assessRegime(daily(bullCloses), null, caps)!.exposureCapPct).toBe(60);
    expect(assessRegime(daily(bearCloses), null, caps)!.exposureCapPct).toBe(20);
  });

  it("returns null without enough data and never ATTACKs without the weekly stage", () => {
    expect(assessRegime([])).toBeNull();
    expect(assessRegime(daily(bullCloses.slice(0, 20)))).toBeNull();
    // 56봉: MACD는 되지만 30주선은 안 됨. MACD +1, RSI 회복 +1 = 2점이어도 중립
    const down = range(50, (i) => 100 * 0.99 ** i * zig(i, 0.003));
    const short = [...down, ...range(6, (i) => down.at(-1)! * 1.02 ** (i + 1))];
    const a = assessRegime(daily(short))!;
    expect(a.stageRegime).toBeNull();
    expect(a.score).toBe(2);
    expect(a.posture).toBe("NEUTRAL");
  });
});

describe("assessRegimeAt (no look-ahead)", () => {
  it("equals assessing the prefix, and future candles do not change the past", () => {
    const candles = daily(bullCloses);
    // i 이후를 폭락으로 바꾼 가짜 미래
    const crashed = candles.map((c, k) => (k > 250 ? { ...c, open: c.close * 0.5, high: c.close * 0.5, low: c.close * 0.4, close: c.close * 0.45 } : c));
    for (const i of [180, 220, 250]) {
      const a = assessRegimeAt(candles, i, negativeMacro)!;
      expect(a).toEqual(assessRegime(candles.slice(0, i + 1), negativeMacro));
      expect(assessRegimeAt(crashed, i, negativeMacro)).toEqual(a);
      expect(a.asOf).toBe(candles[i]!.date);
    }
    expect(assessRegimeAt(crashed, 299)!.posture).not.toBe(assessRegimeAt(candles, 299)!.posture);
    expect(assessRegimeAt(candles, -1)).toBeNull();
    expect(assessRegimeAt(candles, 300)).toBeNull();
  });
});

/** 지수 날짜에 맞춘 시장 폭 집계일(표본 100종목). nets[k]가 k번째 날 순상승 */
function breadthDays(candles: Candle[], net: (k: number) => number, extra: Partial<BreadthDay> = {}): BreadthDay[] {
  return candles.map((c, k) => {
    const n = net(k);
    const adv = Math.floor((100 + n) / 2);
    return { date: c.date, adv, dec: adv - n, unch: 100 - adv - (adv - n), newHigh: 0, newLow: 0, total: 100, ...extra };
  });
}

/** 점수만 정해 둔 시장 폭 분석(통합 확인용) */
function fakeBreadth(asOf: string, score: -1 | 0 | 1): BreadthAnalysis {
  return {
    asOf,
    basis: "테스트",
    sampleSize: 100,
    adLine: [],
    mi: [],
    mcclellan: [],
    mcclellanSum: [],
    hiLo: { newHigh: 0, newLow: 0, avg10High: 0, avg10Low: 0 },
    divergence: null,
    miSignal: null,
    hiLoState: null,
    signals: [{ tone: score < 0 ? "bad" : score > 0 ? "good" : "info", text: "시장 폭 테스트 신호예요", rule: "M1-04 와인스타인" }],
    score,
  };
}

describe("assessRegime with market breadth (2.2, M1-04·05)", () => {
  const candles = daily(bullCloses);
  const last = candles.at(-1)!.date;

  it("absent or null breadth changes nothing", () => {
    const base = assessRegime(candles)!;
    expect(assessRegime(candles, null, DEFAULT_POSTURE_CAPS, { breadth: null })).toEqual(base);
    expect(assessRegime(candles, null, DEFAULT_POSTURE_CAPS, { breadth: undefined })).toEqual(base);
    expect(base.breakdown.breadth).toBe(0);
  });

  it("adds the breadth score as a separate breakdown item and appends its signals with rule tags", () => {
    const base = assessRegime(candles)!;
    const bad = assessRegime(candles, null, DEFAULT_POSTURE_CAPS, { breadth: fakeBreadth(last, -1) })!;
    expect(bad.breakdown).toEqual({ ...base.breakdown, breadth: -1 });
    expect(bad.score).toBe(base.score - 1);
    expect(bad.notes.some((n) => n.text === "시장 폭 테스트 신호예요" && n.rule === "M1-04 와인스타인" && n.tone === "bad")).toBe(true);
    expect(bad.notes.some((n) => n.rule === "2.2 와인스타인" && n.text.includes("국면 점수 -1점"))).toBe(true);
    const good = assessRegime(candles, null, DEFAULT_POSTURE_CAPS, { breadth: fakeBreadth(last, 1) })!;
    expect(good.breakdown.breadth).toBe(1);
    expect(good.score).toBe(base.score + 1);
    // 0점이면 신호는 붙지만 점수 안내는 없다
    const flat = assessRegime(candles, null, DEFAULT_POSTURE_CAPS, { breadth: fakeBreadth(last, 0) })!;
    expect(flat.score).toBe(base.score);
    expect(flat.notes.some((n) => n.text.includes("시장 폭 신호 →"))).toBe(false);
    for (const n of bad.notes) expect(n.rule, n.text).toBeTruthy();
  });

  it("can move the posture as an auxiliary point (ATTACK 2 → NEUTRAL 1)", () => {
    const oneMacro: MacroSnapshot = { asOf: "2023-02-24", yieldSpread: { value: -0.1, date: "2023-02-24" } };
    const a = assessRegime(candles, oneMacro)!;
    expect(a.score).toBe(2);
    expect(a.posture).toBe("ATTACK");
    const b = assessRegime(candles, oneMacro, DEFAULT_POSTURE_CAPS, { breadth: fakeBreadth(last, -1) })!;
    expect(b.score).toBe(1);
    expect(b.posture).toBe("NEUTRAL");
    // 약세 국면(M1-02)은 시장 폭이 좋아도 방어
    const bear = daily(bearCloses);
    expect(assessRegime(bear, null, DEFAULT_POSTURE_CAPS, { breadth: fakeBreadth(bear.at(-1)!.date, 1) })!.posture).toBe("DEFENSE");
  });

  it("ignores breadth dated after the index's last bar (no look-ahead) or stale by more than a week", () => {
    const base = assessRegime(candles)!;
    const future = assessRegime(candles, null, DEFAULT_POSTURE_CAPS, { breadth: fakeBreadth("2099-01-01", -1) })!;
    expect(future.breakdown.breadth).toBe(0);
    expect(future.score).toBe(base.score);
    expect(future.notes.some((n) => n.rule === "2.2 와인스타인" && n.text.includes("늦어"))).toBe(true);
    expect(future.notes.some((n) => n.text === "시장 폭 테스트 신호예요")).toBe(false);
    const stale = assessRegime(candles, null, DEFAULT_POSTURE_CAPS, { breadth: fakeBreadth(candles.at(-7)!.date, -1) })!;
    expect(stale.breakdown.breadth).toBe(0);
    expect(stale.notes.some((n) => n.text.includes("오래돼"))).toBe(true);
    // 일주일 안쪽(직전 거래일 등)은 쓴다
    expect(assessRegime(candles, null, DEFAULT_POSTURE_CAPS, { breadth: fakeBreadth(candles.at(-2)!.date, -1) })!.breakdown.breadth).toBe(-1);
  });

  it("works with a real analysis: MI deep stay then cross down costs a point", () => {
    // 지수는 그대로 강세, 시장 내부는 250일 +30 뒤 47일 전 종목 하락 → MI 0선 하향 교차(M1-05)
    const days = breadthDays(candles.slice(0, 297), (k) => (k < 250 ? 30 : -100));
    const br = analyzeBreadth(days, candles)!;
    expect(br.miSignal?.dir).toBe("DOWN");
    expect(br.score).toBe(-1);
    const i = 296;
    const a = assessRegimeAt(candles, i, null, DEFAULT_POSTURE_CAPS, { breadth: br })!;
    expect(a.breakdown.breadth).toBe(-1);
    expect(a.notes.some((n) => n.rule === "M1-05 와인스타인" && n.tone === "bad")).toBe(true);
    expect(a.score).toBe(assessRegimeAt(candles, i)!.score - 1);
  });
});

describe("assessRegimeAt with breadth (no look-ahead)", () => {
  it("passes breadth through and past assessments ignore later breadth", () => {
    const candles = daily(bullCloses);
    const days = breadthDays(candles, (k) => (k % 3 ? 10 : -14), { newHigh: 0, newLow: 12, hiLoBase: 100 });
    const latest = analyzeBreadth(days, candles)!;
    for (const i of [200, 250]) {
      const date = candles[i]!.date;
      const asOf = analyzeBreadthAt(days, candles, date)!;
      expect(asOf.asOf).toBe(date);
      expect(asOf.score).toBe(-1); // 신저가 우위
      const a = assessRegimeAt(candles, i, null, DEFAULT_POSTURE_CAPS, { breadth: asOf })!;
      expect(a).toEqual(assessRegime(candles.slice(0, i + 1), null, DEFAULT_POSTURE_CAPS, { breadth: asOf }));
      expect(a.breakdown.breadth).toBe(-1);
      // 최신 분석(미래 날짜)을 넘기면 과거 판정에서는 빠진다
      const withLatest = assessRegimeAt(candles, i, null, DEFAULT_POSTURE_CAPS, { breadth: latest })!;
      expect(withLatest.breakdown.breadth).toBe(0);
      expect(withLatest.score).toBe(assessRegimeAt(candles, i)!.score);
    }
  });
});
