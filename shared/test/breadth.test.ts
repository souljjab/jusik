import { describe, expect, it } from "vitest";
import { analyzeBreadth, analyzeBreadthAt, BREADTH_PARAMS, breadthFromCandles, type BreadthDay } from "../src/breadth";
import type { Candle } from "../src/types";

const DAY = 86_400_000;

/** 2022-01-03(월)부터 평일 n개 */
function bdays(n: number, start = Date.UTC(2022, 0, 3)): string[] {
  const out: string[] = [];
  for (let t = start; out.length < n; t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** 고가=저가=종가인 단순 봉(신고가·신저가를 손으로 따지기 쉽게) */
const bar = (date: string, close: number): Candle => ({ date, open: close, high: close, low: close, close, volume: 1 });
/** closes의 null은 그날 봉 없음 */
const stock = (dates: string[], closes: (number | null)[]): Candle[] =>
  closes.flatMap((c, k) => (c == null ? [] : [bar(dates[k]!, c)]));

/** 순상승 수열 → 집계일(표본 total종목, 보합은 홀짝 맞춤용 0~1) */
function mkDays(nets: number[], { total = 100, dates = bdays(nets.length), extra = {} as Partial<BreadthDay> } = {}): BreadthDay[] {
  return nets.map((net, k) => {
    const adv = Math.floor((total + net) / 2);
    const dec = adv - net;
    return { date: dates[k]!, adv, dec, unch: total - adv - dec, newHigh: 0, newLow: 0, total, ...extra };
  });
}

/** 재현 가능한 의사난수(테스트 전용) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    s ^= s >>> 13;
    return (s >>> 0) / 4294967296;
  };
}
const range = <T,>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
const index = (dates: string[], f: (i: number) => number): Candle[] => dates.map((d, i) => bar(d, f(i)));

describe("breadthFromCandles", () => {
  it("counts adv/dec/unch by close vs previous close, only for stocks with both bars", () => {
    const d = bdays(5);
    const series = [
      stock(d, [10, 11, 11, 12, 11]), // A
      stock(d, [10, 9, 8, 9, 9]), // B
      stock(d, [10, 10, null, 11, 12]), // C: d2 봉 없음 → d2·d3은 빠진다
      stock(d, [null, null, null, null, 50]), // D: 신규 상장 → 전일 봉이 없어 빠진다
    ];
    const days = breadthFromCandles(series);
    expect(days.map((x) => x.date)).toEqual(d.slice(1));
    expect(days.map(({ adv, dec, unch, total }) => ({ adv, dec, unch, total }))).toEqual([
      { adv: 1, dec: 1, unch: 1, total: 3 },
      { adv: 0, dec: 1, unch: 1, total: 2 },
      { adv: 2, dec: 0, unch: 0, total: 2 },
      { adv: 1, dec: 1, unch: 1, total: 3 },
    ]);
    // 봉이 1년치가 안 되면 신고가·신저가는 판정하지 않는다
    for (const x of days) expect([x.newHigh, x.newLow, x.hiLoBase]).toEqual([0, 0, 0]);
  });

  it("drops dates where fewer than half the basket reported and compares with the previous kept date", () => {
    const d = bdays(4);
    const series = [
      stock(d, [10, 11, 99, 12]), // d2에 혼자만 봉(휴장일 잡음)
      stock(d, [10, 9, null, 8]),
      stock(d, [10, 10, null, 10]),
      stock(d, [10, 10, null, 11]),
    ];
    const days = breadthFromCandles(series);
    expect(days.map((x) => x.date)).toEqual([d[1], d[3]]);
    // d3은 d1과 비교: A 11→12 상승(d2의 99는 무시), B 하락, C 보합, D 상승
    expect(days[1]).toMatchObject({ adv: 2, dec: 1, unch: 1, total: 4 });
    // 기준을 바꾸면 d2도 남는다(그날은 A만 센다)
    const loose = breadthFromCandles(series, { minReportRatio: 0.25 });
    expect(loose.map((x) => x.date)).toEqual(d.slice(1));
    expect(loose[1]).toMatchObject({ adv: 1, total: 1 });
  });

  it("drops a date when too few stocks have the previous bar as well", () => {
    const d = bdays(3);
    const series = [stock(d, [10, 11, 12]), stock(d, [10, null, null]), stock(d, [null, 10, 9]), stock(d, [null, 10, 11])];
    // d1: 3종목이 봉을 냈지만(≥2) 전일 봉까지 있는 건 A뿐(1 < 2) → 버림. d2: A·C·D 셈
    const days = breadthFromCandles(series);
    expect(days.map((x) => x.date)).toEqual([d[2]]);
    expect(days[0]).toMatchObject({ adv: 2, dec: 1, total: 3 });
  });

  it("new highs/lows compare the close with the prior lookback bars, only when that many exist", () => {
    const d = bdays(6);
    const series = [stock(d, [10, 11, 12, 11, 13, 9]), stock(d, [null, null, 10, 10, 10, 10])];
    const days = breadthFromCandles(series, { hiLoLookback: 3 });
    const at = (date: string) => days.find((x) => x.date === date)!;
    expect(at(d[3]!)).toMatchObject({ newHigh: 0, newLow: 0, hiLoBase: 1 }); // A: 11, 직전 3봉 10~12
    expect(at(d[4]!)).toMatchObject({ newHigh: 1, newLow: 0, hiLoBase: 1 }); // A 13 > 12, B는 직전 봉 2개뿐
    expect(at(d[5]!)).toMatchObject({ newHigh: 0, newLow: 1, hiLoBase: 2 }); // A 9 < 11, B 10은 최고가와 같아 신고가 아님
  });

  it("uses a 250-bar (52-week) lookback by default", () => {
    expect(BREADTH_PARAMS.hiLoLookback).toBe(250);
    const d = bdays(252);
    const days = breadthFromCandles([stock(d, range(252, (i) => 100 + i))]);
    expect(days.at(-3)!.hiLoBase).toBe(0); // 직전 249봉
    expect(days.at(-2)).toMatchObject({ newHigh: 1, hiLoBase: 1 }); // 직전 250봉
    expect(days.at(-1)).toMatchObject({ newHigh: 1, hiLoBase: 1 });
  });

  it("handles unsorted and duplicated bars", () => {
    const d = bdays(4);
    const a = stock(d, [10, 11, 12, 11]);
    const b = stock(d, [10, 9, 9, 10]);
    const messy = [[a[2]!, a[0]!, a[3]!, a[1]!, { ...a[1]!, close: 11 }], [...b].reverse()];
    expect(breadthFromCandles(messy)).toEqual(breadthFromCandles([a, b]));
    expect(breadthFromCandles([])).toEqual([]);
    expect(breadthFromCandles([[], []])).toEqual([]);
  });

  it("has no look-ahead: truncating the bars after a date leaves earlier days unchanged", () => {
    const d = bdays(120);
    const r = rng(7);
    const series = range(8, (s) => {
      let px = 100;
      return d.flatMap((date) => {
        px *= 1 + (r() - 0.5) * 0.04;
        return r() < 0.05 ? [] : [{ date, open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 1 }];
      });
    });
    const full = breadthFromCandles(series, { hiLoLookback: 20 });
    expect(full.length).toBeGreaterThan(100);
    expect(full.some((x) => x.newHigh > 0) && full.some((x) => x.newLow > 0)).toBe(true);
    for (const cut of [d[30]!, d[75]!, d[110]!]) {
      const part = breadthFromCandles(series.map((cs) => cs.filter((c) => c.date <= cut)), { hiLoLookback: 20 });
      expect(part).toEqual(full.filter((x) => x.date <= cut));
    }
  });
});

describe("analyzeBreadth: series", () => {
  it("A/D line is the cumulative adv − dec (M1-04)", () => {
    const nets = [10, -4, 0, 6, -20];
    const a = analyzeBreadth(mkDays(nets))!;
    expect(a.adLine.map((p) => p.value)).toEqual([10, 6, 6, 12, -8]);
    expect(a.asOf).toBe(bdays(5)[4]);
    expect(a.sampleSize).toBe(100);
  });

  it("MI is the 200-day rolling sum of adv − dec and empty before 200 days (M1-05)", () => {
    const r = rng(3);
    const nets = range(260, () => 2 * Math.round((r() - 0.5) * 40));
    const days = mkDays(nets);
    const a = analyzeBreadth(days)!;
    expect(a.mi).toHaveLength(61);
    expect(a.mi[0]!.date).toBe(days[199]!.date);
    for (const j of [0, 1, 30, 60]) {
      const brute = nets.slice(j, j + 200).reduce((x, y) => x + y, 0);
      expect(a.mi[j]!.value).toBe(brute);
    }
    const short = analyzeBreadth(days.slice(0, 199))!;
    expect(short.mi).toEqual([]);
    expect(short.signals.some((n) => n.rule === "M1-05 와인스타인" && n.text.includes("집계일이 더 필요"))).toBe(true);
    expect(analyzeBreadth(days.slice(0, 200))!.mi).toHaveLength(1);
  });

  it("McClellan oscillator = EMA19 − EMA39 of ratio-adjusted net advances (companion indicator, not the book's MI)", () => {
    const r = rng(11);
    const dates = bdays(120);
    const days: BreadthDay[] = dates.map((date) => {
      const adv = Math.floor(r() * 50), dec = Math.floor(r() * 50);
      return { date, adv, dec, unch: 100 - adv - dec, newHigh: 0, newLow: 0, total: 100 };
    });
    const a = analyzeBreadth(days)!;
    // 기준 구현: SMA로 시작하는 지수이동평균
    const ratio = days.map((x) => (x.adv + x.dec > 0 ? ((x.adv - x.dec) / (x.adv + x.dec)) * 1000 : 0));
    const refEma = (p: number) => {
      const out: (number | null)[] = ratio.map(() => null);
      let prev = ratio.slice(0, p).reduce((x, y) => x + y, 0) / p;
      out[p - 1] = prev;
      for (let i = p; i < ratio.length; i++) out[i] = prev = ratio[i]! * (2 / (p + 1)) + prev * (1 - 2 / (p + 1));
      return out;
    };
    const e19 = refEma(19), e39 = refEma(39);
    expect(a.mcclellan).toHaveLength(120 - 38);
    expect(a.mcclellan[0]!.date).toBe(days[38]!.date);
    for (const k of [38, 60, 119]) {
      const p = a.mcclellan.find((x) => x.date === days[k]!.date)!;
      expect(p.value).toBeCloseTo(e19[k]! - e39[k]!, 9);
    }
    // 합산지수는 오실레이터 누적
    let s = 0;
    a.mcclellan.forEach((p, j) => {
      s += p.value;
      expect(a.mcclellanSum[j]!.value).toBeCloseTo(s, 9);
    });
  });

  it("McClellan is ~0 for a constant ratio and turns positive on a breadth thrust", () => {
    const flat = analyzeBreadth(mkDays(range(80, () => 10)))!;
    for (const p of flat.mcclellan) expect(p.value).toBeCloseTo(0, 9);
    const thrust = analyzeBreadth(mkDays([...range(60, () => 0), ...range(10, () => 80)]))!;
    expect(thrust.mcclellan.at(-1)!.value).toBeGreaterThan(100);
    // 점수에는 넣지 않는다
    expect(thrust.score).toBe(0);
  });
});

describe("analyzeBreadth: M1-04 divergence", () => {
  const dates = bdays(100);
  const rising = index(dates, (i) => 1000 + i);
  const falling = index(dates, (i) => 2000 - i);

  it("index higher high + A/D lower high → bearish warning (bad, −1)", () => {
    const days = mkDays([...range(80, () => 20), ...range(20, () => -10)], { dates });
    const a = analyzeBreadth(days, rising)!;
    expect(a.divergence).toBe("BEARISH");
    expect(a.score).toBe(-1);
    const n = a.signals.find((x) => x.rule === "M1-04 와인스타인")!;
    expect(n.tone).toBe("bad");
    expect(n.text).toContain("하락장 선행 경고");
    expect(n.text).toContain("1,600 → 1,590");
  });

  it("index lower low + A/D higher low → bullish divergence as info only (0 points)", () => {
    const days = mkDays([...range(80, () => -20), ...range(20, () => 10)], { dates });
    const a = analyzeBreadth(days, falling)!;
    expect(a.divergence).toBe("BULLISH");
    expect(a.score).toBe(0);
    expect(a.signals.find((x) => x.rule === "M1-04 와인스타인")!.tone).toBe("info");
  });

  it("no divergence when both make higher highs, or the A/D gap is within noise", () => {
    expect(analyzeBreadth(mkDays(range(100, () => 20), { dates }), rising)!.divergence).toBeNull();
    // 최근 고점 1,598 vs 이전 1,600: 차이 2 < 평균 종목 수의 5%(5) → 괴리 아님
    const noise = mkDays([...range(80, () => 20), -2, ...range(19, () => 0)], { dates });
    const a = analyzeBreadth(noise, rising)!;
    expect(a.divergence).toBeNull();
    expect(a.signals.some((x) => x.rule === "M1-04 와인스타인")).toBe(false);
    // 기준을 낮추면 잡힌다
    expect(analyzeBreadth(noise, rising, { divMinGapPct: 1 })!.divergence).toBe("BEARISH");
  });

  it("aligns by date, ignores index bars after the last breadth day, and needs enough overlap", () => {
    const days = mkDays([...range(80, () => 20), ...range(20, () => -10)], { dates });
    const future = [...rising, bar("2030-01-02", 1)];
    expect(analyzeBreadth(days, future)).toEqual(analyzeBreadth(days, rising));
    // 지수가 99일치뿐 → 판단하지 않는다고 알린다
    const thin = analyzeBreadth(days, rising.slice(1))!;
    expect(thin.divergence).toBeNull();
    expect(thin.signals.some((x) => x.rule === "M1-04 와인스타인" && x.tone === "info" && x.text.includes("따지지 않았어요"))).toBe(true);
    // 지수가 없으면 아무 말도 하지 않는다
    expect(analyzeBreadth(days)!.signals.some((x) => x.rule === "M1-04 와인스타인")).toBe(false);
    expect(analyzeBreadth(days, [])!.divergence).toBeNull();
  });
});

describe("analyzeBreadth: M1-05 MI deep stay then zero cross", () => {
  // +30(65:35)이 250일 → MI +6,000(깊은 기준 1,000 = 평균 100종목 × 1000%), 그 뒤 전 종목 하락(−100)이 47일째에 0선 아래
  const topNets = [...range(250, () => 30), ...range(47, () => -100)];

  it("deep above zero for long, then crossing down → sell signal (bad, −1)", () => {
    const days = mkDays(topNets);
    const a = analyzeBreadth(days)!;
    expect(a.mi.at(-2)!.value).toBe(20);
    expect(a.mi.at(-1)!.value).toBe(-110);
    expect(a.miSignal).toEqual({ dir: "DOWN", date: days.at(-1)!.date, deepDays: 51 + 38 });
    expect(a.score).toBe(-1);
    const n = a.signals.find((x) => x.rule === "M1-05 와인스타인")!;
    expect(n.tone).toBe("bad");
    expect(n.text).toContain("지수보다 먼저");
  });

  it("deep below zero for long, then crossing up → late confirmation (good, +1)", () => {
    const days = mkDays(topNets.map((x) => -x));
    const a = analyzeBreadth(days)!;
    expect(a.miSignal?.dir).toBe("UP");
    expect(a.score).toBe(1);
    const n = a.signals.find((x) => x.rule === "M1-05 와인스타인")!;
    expect(n.tone).toBe("good");
    expect(n.text).toContain("늦게");
  });

  it("only counts a cross within the last few days", () => {
    const after = (k: number) => analyzeBreadth(mkDays([...topNets, ...range(k, () => -100)]))!;
    expect(after(4).miSignal?.dir).toBe("DOWN"); // 교차가 끝에서 5번째 날
    const old = after(5);
    expect(old.miSignal).toBeNull();
    expect(old.score).toBe(0);
    expect(old.signals.find((x) => x.rule === "M1-05 와인스타인")!.text).toContain("0선 아래");
  });

  it("a cross without a long deep stay is not a trend-change signal", () => {
    // +4가 250일 → MI +800(깊은 기준 1,000 미만), 8일 하락으로 0선 아래
    const a = analyzeBreadth(mkDays([...range(250, () => 4), ...range(8, () => -100)]))!;
    expect(a.mi.at(-1)!.value).toBeLessThan(0);
    expect(a.miSignal).toBeNull();
    expect(a.score).toBe(0);
    const n = a.signals.find((x) => x.rule === "M1-05 와인스타인")!;
    expect(n.tone).toBe("info");
    expect(n.text).toContain("깊은 영역에 머문 날이 0일");
    // 최소 일수를 올리면 위의 하락 교차도 신호가 아니다
    expect(analyzeBreadth(mkDays(topNets), null, { miMinDeepDays: 90 })!.miSignal).toBeNull();
    expect(analyzeBreadth(mkDays(topNets), null, { miMinDeepDays: 89 })!.miSignal?.dir).toBe("DOWN");
  });

  it("reports a deep MI that has not crossed yet as info", () => {
    const a = analyzeBreadth(mkDays(range(230, () => 30)))!;
    expect(a.miSignal).toBeNull();
    expect(a.signals.find((x) => x.rule === "M1-05 와인스타인")!.text).toContain("+6,000: 0선 위 깊은 영역");
  });
});

describe("analyzeBreadth: new highs vs new lows (2.2)", () => {
  const withHiLo = (newHigh: number, newLow: number, hiLoBase = 100) => mkDays(range(30, () => 0), { extra: { newHigh, newLow, hiLoBase } });

  it("more new highs → good (+1), more new lows → bad (−1), with the 'not alone' caveat", () => {
    const good = analyzeBreadth(withHiLo(10, 1))!;
    expect(good.hiLoState).toBe("GOOD");
    expect(good.score).toBe(1);
    expect(good.hiLo).toEqual({ newHigh: 10, newLow: 1, avg10High: 10, avg10Low: 1 });
    const gn = good.signals.find((x) => x.tone === "good" && x.rule === "2.2 와인스타인")!;
    expect(gn.text).toContain("이것만으로 판단하지 않아요");
    const bad = analyzeBreadth(withHiLo(1, 10))!;
    expect(bad.hiLoState).toBe("BAD");
    expect(bad.score).toBe(-1);
    expect(bad.signals.some((x) => x.tone === "bad" && x.rule === "2.2 와인스타인" && x.text.includes("이것만으로"))).toBe(true);
  });

  it("neutral when neither side dominates or counts are tiny; null without a year of bars", () => {
    expect(analyzeBreadth(withHiLo(4, 3))!.hiLoState).toBe("NEUTRAL");
    expect(analyzeBreadth(withHiLo(2, 0))!.hiLoState).toBe("NEUTRAL"); // 2 < 판정 가능 100종목의 3%
    const none = analyzeBreadth(withHiLo(0, 0, 0))!;
    expect(none.hiLoState).toBeNull();
    expect(none.signals.some((x) => x.text.includes("1년치"))).toBe(true);
    // hiLoBase가 없는 외부 자료는 total을 기준으로 본다
    expect(analyzeBreadth(mkDays(range(30, () => 0), { extra: { newHigh: 10, newLow: 0 } }))!.hiLoState).toBe("GOOD");
  });

  it("averages the last 10 days", () => {
    const days = [...withHiLo(0, 0).slice(0, 20), ...withHiLo(0, 0).slice(20).map((d, k) => ({ ...d, newHigh: k < 5 ? 20 : 0 }))];
    const a = analyzeBreadth(days)!;
    expect(a.hiLo.avg10High).toBe(10);
    expect(a.hiLo.newHigh).toBe(0);
  });
});

describe("analyzeBreadth: score, basis and notes", () => {
  it("score is the clamped sum of the three signals", () => {
    const dates = bdays(100);
    const bearish = mkDays([...range(80, () => 20), ...range(20, () => -10)], { dates, extra: { newHigh: 0, newLow: 10, hiLoBase: 100 } });
    const a = analyzeBreadth(bearish, index(dates, (i) => 1000 + i))!;
    expect(a.divergence).toBe("BEARISH");
    expect(a.hiLoState).toBe("BAD");
    expect(a.score).toBe(-1);
    // MI 상향(+1)과 신저가 우위(−1)는 상쇄
    const mixed = analyzeBreadth(mkDays([-30, 100].flatMap((x, j) => range(j ? 47 : 250, () => x)), { extra: { newHigh: 0, newLow: 10, hiLoBase: 100 } }))!;
    expect(mixed.miSignal?.dir).toBe("UP");
    expect(mixed.hiLoState).toBe("BAD");
    expect(mixed.score).toBe(0);
  });

  it("states the basis first and tags every note with a rule", () => {
    const days = mkDays(range(260, (i) => (i % 3 ? 10 : -12)), { extra: { newHigh: 3, newLow: 1, hiLoBase: 100 } });
    const a = analyzeBreadth(days, index(bdays(260), (i) => 1000 + i))!;
    expect(a.signals[0]).toMatchObject({ tone: "info", rule: "2.2 와인스타인" });
    expect(a.signals[0]!.text).toContain("표본 100종목 기준 근사");
    expect(a.basis).toBe("표본 100종목 기준 근사");
    const custom = analyzeBreadth(days, null, { basis: "KOSPI 시가총액 상위 60종목 기준 근사" })!;
    expect(custom.basis).toBe("KOSPI 시가총액 상위 60종목 기준 근사");
    expect(custom.signals[0]!.text).toContain("시가총액 상위 60종목 기준 근사");
    for (const n of [...a.signals, ...custom.signals]) {
      expect(n.rule).toMatch(/^(M1-04|M1-05|2\.2) 와인스타인$/);
      expect(["good", "bad", "warn", "info"]).toContain(n.tone);
      expect(n.text.replace(/\([^()]*\)$/, "")).toMatch(/요$/);
    }
  });

  it("returns null for no days and tolerates unsorted / duplicated input", () => {
    expect(analyzeBreadth([])).toBeNull();
    const days = mkDays(range(60, (i) => (i % 2 ? 6 : -4)));
    const messy = [...days].reverse().concat([days[5]!]);
    expect(analyzeBreadth(messy)).toEqual(analyzeBreadth(days));
  });
});

describe("analyzeBreadthAt (no look-ahead)", () => {
  const n = 320;
  const dates = bdays(n);
  const r = rng(21);
  const nets = range(n, () => 2 * Math.round((r() - 0.45) * 30));
  const days = mkDays(nets, { dates, extra: { newHigh: 2, newLow: 1, hiLoBase: 100 } });
  const idx = index(dates, (i) => 1000 + i + 30 * Math.sin(i / 9));

  it("equals analyzing the prefix, and changing the future does not change the past", () => {
    // date 이후를 정반대 자료와 폭락 지수로 바꾼 가짜 미래
    const flipped = days.map((d, k) => (k > 250 ? { ...d, adv: d.dec, dec: d.adv, newHigh: 0, newLow: 50 } : d));
    const crashed = idx.map((c, k) => (k > 250 ? bar(c.date, c.close * 0.3) : c));
    for (const k of [120, 210, 250]) {
      const date = dates[k]!;
      const a = analyzeBreadthAt(days, idx, date)!;
      expect(a.asOf).toBe(date);
      expect(a).toEqual(analyzeBreadth(days.slice(0, k + 1), idx.slice(0, k + 1)));
      expect(analyzeBreadthAt(flipped, crashed, date)).toEqual(a);
      expect(a.adLine.at(-1)!.date).toBe(date);
      expect(a.mi.every((p) => p.date <= date)).toBe(true);
    }
    expect(analyzeBreadthAt(flipped, crashed, dates[n - 1]!)).not.toEqual(analyzeBreadthAt(days, idx, dates[n - 1]!));
  });

  it("uses the last breadth day on or before the date, and null before the first", () => {
    // 2022-01-08은 토요일 → 1월 7일(금)까지
    expect(analyzeBreadthAt(days, idx, "2022-01-08")!.asOf).toBe("2022-01-07");
    expect(analyzeBreadthAt(days, idx, "2021-12-31")).toBeNull();
    expect(analyzeBreadthAt(days, null, dates[100]!)!.divergence).toBeNull();
  });
});

describe("breadthFromCandles → analyzeBreadth end to end", () => {
  it("a basket rising together is all advances with 52-week highs", () => {
    const d = bdays(300);
    const series = range(20, (s) => stock(d, range(300, (i) => 100 + s + i * (1 + s / 10))));
    const days = breadthFromCandles(series);
    expect(days).toHaveLength(299);
    expect(days.every((x) => x.adv === 20 && x.dec === 0)).toBe(true);
    const a = analyzeBreadth(days, index(d, (i) => 1000 + i), { basis: "테스트 표본 20종목" })!;
    expect(a.adLine.at(-1)!.value).toBe(20 * 299);
    expect(a.mi.at(-1)!.value).toBe(20 * 200);
    expect(a.hiLo).toEqual({ newHigh: 20, newLow: 0, avg10High: 20, avg10Low: 0 });
    expect(a.hiLoState).toBe("GOOD");
    expect(a.divergence).toBeNull();
    expect(a.score).toBe(1);
  });
});
