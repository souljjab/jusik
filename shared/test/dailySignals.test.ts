import { describe, expect, it } from "vitest";
import {
  DAILY_SIGNAL_PARAMS,
  dailySignals,
  dailySignalsAt,
  dailySignalsFromPrep,
  prepareDailySignals,
  toNotes,
  type DailySignal,
  type DailySignalOptions,
} from "../src/dailySignals";
import { argMax, argMin, disparity, meanOf, smaSeries, stochastic, swingHighs, swingLows } from "../src/indicatorsExtra";
import type { Candle } from "../src/types";

type Bar = { o?: number; h?: number; l?: number; c: number; v?: number };

/** 시가 = 전일 종가(지정 없을 때), 고가·저가 = 몸통 ±0.5%, 거래량 1000 */
function build(bars: Bar[]): Candle[] {
  const base = Date.UTC(2022, 0, 3);
  let prev = bars[0]?.c ?? 100;
  return bars.map((b, i) => {
    const o = b.o ?? prev;
    prev = b.c;
    return {
      date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
      open: o,
      high: b.h ?? Math.max(o, b.c) * 1.005,
      low: b.l ?? Math.min(o, b.c) * 0.995,
      close: b.c,
      volume: b.v ?? 1000,
    };
  });
}
const flat = (n: number, c = 100, v = 1000): Bar[] => Array.from({ length: n }, () => ({ c, v }));
/** from에서 매 봉 pct%씩 변하는 종가(첫 봉이 from × (1+pct)) */
const ramp = (n: number, from: number, pct: number, v = 1000): Bar[] => Array.from({ length: n }, (_, k) => ({ c: from * (1 + pct / 100) ** (k + 1), v }));
const lastC = (bars: Bar[]) => bars[bars.length - 1]!.c;
const keys = (bars: Bar[], ctx?: DailySignalOptions) => dailySignals(build(bars), ctx).map((s) => s.key);
const find = (bars: Bar[], key: string, ctx?: DailySignalOptions) => dailySignals(build(bars), ctx).find((s) => s.key === key);

/** 재현 가능한 의사 난수 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 거래량 급증·갭·급락이 섞인 무작위 일봉 */
function randomWalk(n: number, seed: number, start = 100): Candle[] {
  const r = rng(seed);
  const bars: Bar[] = [];
  let px = start;
  for (let k = 0; k < n; k++) {
    const shock = r() < 0.05 ? (r() - 0.5) * 0.2 : 0;
    const gap = r() < 0.03 ? 0.08 + r() * 0.05 : (r() - 0.5) * 0.01;
    const o = px * (1 + gap);
    const c = Math.max(1, o * (1 + (r() - 0.5) * 0.06 + shock));
    const v = Math.round(1000 * (r() < 0.04 ? 3 + r() * 12 : 0.5 + r()));
    bars.push({ o, c, h: Math.max(o, c) * (1 + r() * 0.02), l: Math.min(o, c) * (1 - r() * 0.02), v });
    px = c;
  }
  return build(bars);
}

describe("indicatorsExtra", () => {
  it("smaSeries skips nulls and restarts after a gap", () => {
    expect(smaSeries([null, 1, 2, 3, null, 4, 5], 2)).toEqual([null, null, 1.5, 2.5, null, null, 4.5]);
  });
  it("stochastic is 50 on a flat range, 100 at the top and bounded", () => {
    const flatC = build(flat(30));
    expect(stochastic(flatC).k.at(-1)).toBeCloseTo(50);
    const top = build(ramp(30, 100, 1).map((b) => ({ ...b, h: b.c })));
    expect(stochastic(top, 14, 3, 1).k.at(-1)).toBeCloseTo(100);
    const st = stochastic(randomWalk(200, 7));
    for (const v of [...st.k, ...st.d]) if (v != null) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
    // %K는 k + smooth - 2, %D는 그보다 d - 1 뒤부터
    expect(st.k[14]).toBeNull();
    expect(st.k[15]).not.toBeNull();
    expect(st.d[16]).toBeNull();
    expect(st.d[17]).not.toBeNull();
  });
  it("disparity is close / SMA × 100", () => {
    expect(disparity([100, 100, 100, 130], 4).at(-1)).toBeCloseTo((130 / 107.5) * 100);
    expect(disparity([1, 2], 3)).toEqual([null, null]);
  });
  it("swing lows/highs use only data up to `to`", () => {
    const v = [5, 4, 3, 4, 5, 4, 2, 4, 5];
    expect(swingLows(v, 1, 0, 8)).toEqual([2, 6]);
    expect(swingLows(v, 1, 0, 6)).toEqual([2]); // 6번 저점은 7번 봉이 있어야 확정
    expect(swingHighs(v, 1, 0, 8)).toEqual([4]);
    expect(swingLows(v, 2, 3, 8)).toEqual([6]);
  });
  it("meanOf / argMax / argMin", () => {
    expect(meanOf([1, 2, 3, 4], 1, 2)).toBe(2.5);
    expect(meanOf([1, 2], -1, 1)).toBeNull();
    expect(argMax([1, 3, 3, 2], 0, 3)).toBe(2);
    expect(argMin([2, 1, 1, 3], 0, 3)).toBe(2);
    expect(argMax([1, 9, 3], 0, 0)).toBe(0);
  });
});

describe("M3-05 golden/dead cross", () => {
  it("5/20 cross within the last 3 bars", () => {
    expect(keys([...flat(30), { c: 103 }])).toContain("ma5-20-golden");
    expect(keys([...flat(30), { c: 103 }, { c: 103.5 }, { c: 104 }])).toContain("ma5-20-golden");
    expect(keys([...flat(30), { c: 103 }, { c: 103.5 }, { c: 104 }, { c: 104.5 }])).not.toContain("ma5-20-golden");
    expect(keys([...flat(30), { c: 97 }])).toContain("ma5-20-dead");
    expect(keys(flat(40))).not.toContain("ma5-20-golden");
    expect(keys(flat(40))).not.toContain("ma5-20-dead");
  });
  it("20/60 cross is the mid-term signal", () => {
    expect(keys([...flat(70), { c: 103 }])).toContain("ma20-60-golden");
    expect(keys([...flat(70), { c: 97 }])).toContain("ma20-60-dead");
    expect(keys([...flat(30), { c: 103 }])).not.toContain("ma20-60-golden"); // 60일선 없음
    const s = find([...flat(30), { c: 103 }], "ma5-20-golden")!;
    expect(s).toMatchObject({ id: "M3-05", source: "설춘환", side: "buy" });
    expect(s.text).toContain("단기 골든크로스");
  });
});

describe("M3-06 moving-average exits", () => {
  const up = ramp(30, 100, 1);
  it("close falling under the 5-day line (prev above) is a short-term sell", () => {
    const k = keys([...up, { c: 130 }]);
    expect(k).toContain("below-sma5");
    expect(k).not.toContain("below-sma20");
  });
  it("breaking the 20-day line too", () => {
    const k = keys([...up, { c: 115 }]);
    expect(k).toContain("below-sma5");
    expect(k).toContain("below-sma20");
  });
  it("no exit while riding above", () => {
    const k = keys(ramp(31, 100, 1));
    expect(k).not.toContain("below-sma5");
    expect(k).not.toContain("below-sma20");
  });
});

describe("M3-07 volume surge", () => {
  it("10× volume with a rise is a buy", () => {
    expect(keys([...flat(30), { c: 103, v: 10_000 }])).toContain("volume-surge-up");
    expect(keys([...flat(30), { c: 103, v: 9_000 }])).not.toContain("volume-surge-up");
  });
  it("5× volume with a fall is a no-buy warning", () => {
    const s = find([...flat(30), { c: 97, v: 5_000 }], "volume-surge-down")!;
    expect(s.side).toBe("warn");
    expect(s.text).toContain("매수 금지");
    expect(keys([...flat(30), { c: 97, v: 4_000 }])).not.toContain("volume-surge-down");
    expect(keys([...flat(30), { c: 103, v: 6_000 }])).not.toContain("volume-surge-down");
  });
  it("thresholds are parameters", () => {
    expect(keys([...flat(30), { c: 103, v: 6_000 }], { params: { surgeUpMult: 5 } })).toContain("volume-surge-up");
  });
});

describe("M3-08 pullback", () => {
  it("5/20 lines within 1.5% with rising volume, price and both lines", () => {
    const base = ramp(40, 100, 0.1);
    expect(keys([...base, { c: lastC(base) * 1.001, v: 1200 }])).toContain("pullback-buy");
  });
  it("no buy without more volume, or when the lines are far apart", () => {
    const base = ramp(40, 100, 0.1);
    expect(keys([...base, { c: lastC(base) * 1.001, v: 1000 }])).not.toContain("pullback-buy");
    const steep = ramp(40, 100, 1);
    expect(keys([...steep, { c: lastC(steep) * 1.01, v: 1200 }])).not.toContain("pullback-buy");
    expect(keys([...base, { c: lastC(base) * 0.999, v: 1200 }])).not.toContain("pullback-buy");
  });
});

describe("M3-09 half recovery of a big bearish candle", () => {
  it("a volume-backed bullish candle recovering ≥50% of yesterday's big body", () => {
    expect(keys([...flat(30), { o: 100, c: 96 }, { o: 96, c: 98.5, v: 1500 }])).toContain("recover-half");
  });
  it("not when recovery is below 50%, volume is lower, or the bearish body is small", () => {
    expect(keys([...flat(30), { o: 100, c: 96 }, { o: 96, c: 97.5, v: 1500 }])).not.toContain("recover-half");
    expect(keys([...flat(30), { o: 100, c: 96 }, { o: 96, c: 98.5, v: 900 }])).not.toContain("recover-half");
    expect(keys([...flat(30), { o: 100, c: 98 }, { o: 98, c: 99.5, v: 1500 }])).not.toContain("recover-half");
  });
});

describe("M3-10 sell rule 1", () => {
  const up = ramp(30, 100, 1);
  it("a big bearish candle with 2× volume above the 5-day line → partial sell", () => {
    const s = find([...up, { o: 136, c: 131, v: 2500 }], "sell-rule1")!;
    expect(s).toMatchObject({ id: "M3-10", source: "박병창", side: "sell" });
    expect(s.text).toContain("30~50% 분할 매도");
  });
  it("not without the volume, with a small body, or below the 5-day line", () => {
    expect(keys([...up, { o: 136, c: 131, v: 1500 }])).not.toContain("sell-rule1");
    expect(keys([...up, { o: 136, c: 134, v: 2500 }])).not.toContain("sell-rule1");
    const down = ramp(30, 100, -1);
    expect(keys([...down, { o: 75, c: 72, v: 2500 }])).not.toContain("sell-rule1");
  });
});

describe("4.4 Park's buy/sell principles", () => {
  const up = [...flat(30), ...ramp(20, 100, 1)];
  const top = lastC(up);
  const quietPull: Bar[] = [{ c: top * 0.985, v: 600 }, { c: top * 0.97, v: 600 }, { c: top * 0.96, v: 600 }];

  it("buy rule 2: quiet pullback between the 5/20 lines, then a volume bullish candle recovering >50%", () => {
    const s = find([...up, ...quietPull, { o: top * 0.96, c: top * 0.985, v: 900 }], "buy-rule2")!;
    expect(s).toMatchObject({ id: "4.4", source: "박병창", side: "buy" });
  });
  it("buy rule 2 needs the pullback on lower volume and a >50% rebound", () => {
    const loudPull = quietPull.map((b) => ({ ...b, v: 1500 }));
    expect(keys([...up, ...loudPull, { o: top * 0.96, c: top * 0.985, v: 1600 }])).not.toContain("buy-rule2");
    expect(keys([...up, ...quietPull, { o: top * 0.96, c: top * 0.965, v: 900 }])).not.toContain("buy-rule2");
  });

  it("sell rule 2: volume bearish candle that fails to recover half the decline", () => {
    const s = find([...up, ...quietPull, { o: top * 0.96, h: top * 0.965, c: top * 0.955, v: 1500 }], "sell-rule2")!;
    expect(s.side).toBe("sell");
    expect(s.text).toContain("20일선");
  });
  it("sell rule 2 not on a quiet bearish candle or when the high retraced half", () => {
    expect(keys([...up, ...quietPull, { o: top * 0.96, h: top * 0.965, c: top * 0.955, v: 500 }])).not.toContain("sell-rule2");
    expect(keys([...up, ...quietPull, { o: top * 0.96, h: top * 0.99, c: top * 0.955, v: 1500 }])).not.toContain("sell-rule2");
  });

  const crash = (v: number): Bar[] => [{ c: 97, v }, { c: 94, v }, { c: 91, v }, { c: 88, v }];
  it("buy rule 3: quiet ≥10% crash below the 20-day line, then a 2× volume bullish candle or doji", () => {
    expect(keys([...flat(30), ...crash(500), { o: 88, c: 90, v: 1500 }])).toContain("buy-rule3");
    const doji = find([...flat(30), ...crash(500), { o: 88, h: 89, l: 87, c: 88.05, v: 1500 }], "buy-rule3")!;
    expect(doji.text).toContain("도지");
  });
  it("buy rule 3 not after a loud crash, a slow 2% drift, or without the volume", () => {
    expect(keys([...flat(30), ...crash(2000), { o: 88, c: 90, v: 5000 }])).not.toContain("buy-rule3");
    const drift: Bar[] = [99.5, 99, 98.5, 98].map((c) => ({ c, v: 500 }));
    expect(keys([...flat(30), ...drift, { o: 98, c: 99, v: 1500 }])).not.toContain("buy-rule3");
    expect(keys([...flat(30), ...crash(500), { o: 88, c: 90, v: 1000 }])).not.toContain("buy-rule3");
    expect(keys([...flat(30), ...crash(500), { o: 90, c: 88.5, v: 1500 }])).not.toContain("buy-rule3"); // 음봉
  });

  it("classifies the zone as info", () => {
    expect(keys(ramp(30, 100, 1))).toContain("zone-above");
    expect(keys(ramp(30, 100, -1))).toContain("zone-below");
    expect(keys([...up, ...quietPull])).toContain("zone-between");
    expect(find(ramp(30, 100, 1), "zone-above")!.side).toBe("info");
  });
});

describe("M3-11 disparity overheat", () => {
  it("uses 106/110 unless the regime is BEAR, then 102/104", () => {
    const mild = [...flat(80), { c: 104.5 }];
    expect(keys(mild, { regime: "NEUTRAL" })).not.toContain("disparity-overheat");
    expect(keys(mild, { regime: "BULL" })).not.toContain("disparity-overheat");
    const s = find(mild, "disparity-overheat", { regime: "BEAR" })!;
    expect(s).toMatchObject({ id: "M3-11", source: "강창권", side: "warn" });
    expect(s.text).toContain("하락장");
    const hot = [...flat(80), { c: 107 }];
    expect(keys(hot, { regime: "BULL" })).toContain("disparity-overheat");
    expect(keys(hot)).toContain("disparity-overheat"); // 국면 모르면 상승장 기준
  });
  it("75-day disparity alone can trigger", () => {
    // 25일선은 따라 올라와 있고 75일선만 멀리 있음
    const bars = [...flat(80), ...ramp(30, 100, 0.5)];
    const k = keys(bars, { params: { overheatShort: 200 } });
    expect(k).toContain("disparity-overheat");
  });
});

describe("M3-14 / 4.6 RSI", () => {
  const down = [...flat(20), ...ramp(20, 100, -1)];
  it("reclaiming 30 after staying below is a scale-in buy", () => {
    const s = find([...down, { c: lastC(down) + 8 }], "rsi-reclaim-30")!;
    expect(s).toMatchObject({ id: "M3-14", source: "강영현·강동진", side: "buy" });
    expect(s.text).toContain("RSI 30 회복(분할 매수 구간)");
  });
  it("still below 30 → wait (info), no buy", () => {
    const k = keys([...down, { c: lastC(down) + 1.5 }]);
    expect(k).not.toContain("rsi-reclaim-30");
    expect(k).toContain("rsi-below-30");
  });
  it("dropping under 70 warns", () => {
    const upBars = [...flat(20), ...ramp(20, 100, 1)];
    expect(keys([...upBars, { c: lastC(upBars) - 8 }])).toContain("rsi-lose-70");
    expect(keys([...upBars, { c: lastC(upBars) - 2 }])).not.toContain("rsi-lose-70");
  });
});

describe("M3-15 founding", () => {
  it("prior-high breakout + RSI ≥ 70 is a buy only in a BULL regime", () => {
    const bars = ramp(130, 100, 0.5);
    expect(keys(bars, { regime: "BULL" })).toContain("founding");
    expect(keys(bars, { regime: "NEUTRAL" })).toContain("founding-off");
    expect(keys(bars, { regime: "NEUTRAL" })).not.toContain("founding");
    expect(keys(bars)).not.toContain("founding");
  });
  it("needs at least 120 prior bars and a real breakout", () => {
    expect(keys(ramp(100, 100, 0.5), { regime: "BULL" })).not.toContain("founding");
    const bars = ramp(130, 100, 0.5);
    expect(keys([...bars, { c: lastC(bars) * 0.99 }], { regime: "BULL" })).not.toContain("founding");
  });
});

describe("M3-16 MACD", () => {
  it("signal-line cross within 2 bars", () => {
    expect(keys([...flat(60), { c: 101 }])).toContain("macd-golden");
    expect(keys([...flat(60), { c: 101 }, { c: 101 }])).toContain("macd-golden");
    expect(keys([...flat(60), { c: 99 }])).toContain("macd-dead");
    expect(keys(flat(61))).not.toContain("macd-golden");
  });

  // 긴 하락으로 MACD가 깊게 빠진 첫 저점 → 반등 → 짧은 급락으로 가격만 더 낮은 둘째 저점
  const low1 = lastC(ramp(20, 100, -1.8));
  const divBars = (secondLow: number): Bar[] => [
    ...flat(40),
    ...ramp(20, 100, -1.8),
    ...ramp(12, low1, 1),
    ...[75, 71, secondLow, 70, 72, 74, 75].map((c) => ({ c })),
  ];
  it("bullish divergence: lower price low, higher MACD low", () => {
    const s = find(divBars(low1 - 1.5), "macd-bull-div")!;
    expect(s).toMatchObject({ id: "M3-16", source: "강동진", side: "buy" });
    expect(s.text).toContain("강세 괴리");
  });
  it("no bullish divergence when the price low is higher, or when it is stale", () => {
    expect(keys(divBars(low1 + 1.5))).not.toContain("macd-bull-div");
    const stale = [...divBars(low1 - 1.5), ...ramp(10, 75, 1)];
    expect(keys(stale)).not.toContain("macd-bull-div");
  });
  it("bearish divergence mirrors it", () => {
    const mirror = divBars(low1 - 1.5).map((b) => ({ c: 200 - b.c }));
    const s = find(mirror, "macd-bear-div")!;
    expect(s.side).toBe("sell");
    expect(s.text).toContain("약세 괴리");
    expect(keys(divBars(low1 + 1.5).map((b) => ({ c: 200 - b.c })))).not.toContain("macd-bear-div");
  });
});

describe("M3-17 stochastic", () => {
  it("%K crossing %D up from ≤20 is a buy, down from ≥80 a sell", () => {
    const down = [...flat(20), ...ramp(20, 100, -1)];
    expect(keys([...down, { c: lastC(down) * 1.03 }])).toContain("stoch-buy");
    expect(keys([...down, { c: lastC(down) * 0.99 }])).not.toContain("stoch-buy");
    const up = [...flat(20), ...ramp(20, 100, 1)];
    expect(keys([...up, { c: lastC(up) * 0.97 }])).toContain("stoch-sell");
    expect(keys([...up, { c: lastC(up) * 1.01 }])).not.toContain("stoch-sell");
  });
  it("a cross in the middle range is ignored", () => {
    // 횡보 중 K=D=50 근처에서 교차
    const zig = [...flat(20), ...Array.from({ length: 20 }, (_, k) => ({ c: 100 + (k % 2 ? 1 : -1) }))];
    const st = stochastic(build(zig));
    const i = zig.length - 1;
    expect(st.k[i - 1]!).toBeLessThan(st.d[i - 1]!);
    expect(st.k[i]!).toBeGreaterThan(st.d[i]!); // 교차는 맞지만
    expect(Math.min(st.k[i - 1]!, st.k[i]!)).toBeGreaterThan(20); // 20 위에서 일어남
    expect(keys(zig)).not.toContain("stoch-buy");
    const zag = zig.slice(0, -1);
    const st2 = stochastic(build(zag));
    expect(st2.k[i - 2]!).toBeGreaterThan(st2.d[i - 2]!);
    expect(st2.k[i - 1]!).toBeLessThan(st2.d[i - 1]!);
    expect(Math.max(st2.k[i - 2]!, st2.k[i - 1]!)).toBeLessThan(80); // 하향 교차는 80 아래에서
    expect(keys(zag)).not.toContain("stoch-sell");
  });
});

describe("M2-13 52-week high", () => {
  const bars = ramp(260, 100, 0.1);
  it("new 250-bar closing high and within 5%", () => {
    expect(keys(bars)).toContain("high52-new");
    const near = find([...bars, { c: lastC(bars) * 0.97 }], "high52-near")!;
    expect(near).toMatchObject({ id: "M2-13", source: "김연수·박용선", side: "info" });
    expect(near.text).toContain("신고가 근접");
  });
  it("nothing when far from the high or with less than a year of data", () => {
    const k = keys([...bars, { c: lastC(bars) * 0.9 }]);
    expect(k).not.toContain("high52-new");
    expect(k).not.toContain("high52-near");
    expect(keys(ramp(200, 100, 0.1))).not.toContain("high52-new");
  });
});

describe("4.3 aligned moving averages", () => {
  it("5>20>60>120 is info; stretched (close/SMA20 > 1.15) becomes a sell-consider warning", () => {
    expect(keys(ramp(130, 100, 1))).toContain("aligned");
    const hot = keys(ramp(130, 100, 2));
    expect(hot).toContain("aligned-overheat");
    expect(hot).not.toContain("aligned");
    expect(find(ramp(130, 100, 2), "aligned-overheat")!.text).toContain("과열된 정배열(매도 고려)");
    expect(keys(flat(130))).not.toContain("aligned");
    expect(keys(ramp(130, 100, -1))).not.toContain("aligned");
  });
});

describe("3.7 long-term line breakout and overhead supply", () => {
  it("breaking a 240-day line after 60+ bars below with 3× volume", () => {
    const s = find([...flat(240), ...flat(70, 90), { c: 105, v: 3500 }], "long-ma240-break")!;
    expect(s).toMatchObject({ id: "3.7", source: "강창권·설춘환", side: "buy" });
    expect(s.text).toContain("장기선 대량 돌파");
  });
  it("not without volume, or after only a short stay below", () => {
    expect(keys([...flat(240), ...flat(70, 90), { c: 105, v: 2000 }])).not.toContain("long-ma240-break");
    expect(keys([...flat(300), ...flat(30, 90), { c: 105, v: 3500 }])).not.toContain("long-ma240-break");
  });
  it("480-day line too when there is enough data", () => {
    const k = keys([...flat(480), ...flat(70, 90), { c: 105, v: 3500 }]);
    expect(k).toContain("long-ma480-break");
    expect(k).toContain("long-ma240-break");
  });

  it("warns when ≥25% of the year's volume sits within 15% above the price", () => {
    const s = find([...flat(200, 110), ...flat(50, 100)], "overhead-supply")!;
    expect(s).toMatchObject({ id: "3.7", source: "와인스타인", side: "warn" });
    expect(s.text).toContain("위쪽 매물대 두꺼움");
  });
  it("no warning when the supply is far above, below, or data is short", () => {
    expect(keys([...flat(200, 130), ...flat(50, 100)])).not.toContain("overhead-supply");
    expect(keys([...flat(250, 100), { c: 120 }])).not.toContain("overhead-supply");
    expect(keys([...flat(60, 110), ...flat(50, 100)])).not.toContain("overhead-supply");
    expect(keys([...flat(220, 100), ...flat(30, 110, 100), { c: 100 }])).not.toContain("overhead-supply"); // 위쪽 거래량이 적음
  });
});

describe("M3-18 opening gap", () => {
  it("≥10% gap: no chasing; ≥7%: pass in principle", () => {
    const g10 = find([...flat(30), { o: 111, c: 112 }], "gap-10")!;
    expect(g10).toMatchObject({ id: "M3-18", source: "강창권", side: "warn" });
    const k7 = keys([...flat(30), { o: 108, c: 108 }]);
    expect(k7).toContain("gap-7");
    expect(k7).not.toContain("gap-10");
    const k5 = keys([...flat(30), { o: 105, c: 105 }]);
    expect(k5).not.toContain("gap-7");
    expect(k5).not.toContain("gap-10");
  });
});

describe("no look-ahead", () => {
  const full = randomWalk(600, 42);

  it("changing bars after i does not change signals at i", () => {
    const r = rng(99);
    for (let i = 1; i < full.length - 1; i += 13) {
      const future = randomWalk(full.length - i - 1, 1000 + i, full[i]!.close * (0.5 + r()));
      const alt = [...full.slice(0, i + 1), ...future];
      for (const regime of [null, "BULL", "BEAR"] as const) expect(dailySignalsAt(alt, i, { regime })).toEqual(dailySignalsAt(full, i, { regime }));
    }
  });

  it("prepared-once results equal per-bar sliced results at every i", () => {
    const prep = prepareDailySignals(full);
    for (let i = 0; i < full.length; i++) expect(dailySignalsFromPrep(prep, i, { regime: "BULL" })).toEqual(dailySignalsAt(full, i, { regime: "BULL" }));
  });

  it("random data produces both buy and sell signals with valid rule ids", () => {
    const prep = prepareDailySignals(full);
    const all: DailySignal[] = [];
    for (let i = 0; i < full.length; i++) all.push(...dailySignalsFromPrep(prep, i, { regime: "BULL" }));
    expect(all.some((s) => s.side === "buy")).toBe(true);
    expect(all.some((s) => s.side === "sell")).toBe(true);
    for (const s of all) {
      expect(s.id).toMatch(/^(M\d-\d{2}|\d\.\d)$/);
      expect(s.source.length).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(0);
    }
  });
});

describe("dailySignals / toNotes", () => {
  it("dailySignals is the last bar; too little data gives nothing", () => {
    const cs = randomWalk(300, 3);
    expect(dailySignals(cs)).toEqual(dailySignalsAt(cs, cs.length - 1));
    expect(dailySignals(cs.slice(0, 1))).toEqual([]);
    expect(dailySignals([])).toEqual([]);
    expect(dailySignalsAt(cs, 500)).toEqual([]);
  });
  it("maps sides to tones and fills rule as 'ID source'", () => {
    const sig: DailySignal[] = [
      { id: "M3-05", source: "설춘환", side: "buy", text: "a", key: "x" },
      { id: "M3-06", source: "설춘환", side: "sell", text: "b", key: "y" },
      { id: "M3-11", source: "강창권", side: "warn", text: "c", key: "z" },
      { id: "4.4", source: "박병창", side: "info", text: "d", key: "w" },
    ];
    expect(toNotes(sig)).toEqual([
      { tone: "good", text: "a", rule: "M3-05 설춘환" },
      { tone: "bad", text: "b", rule: "M3-06 설춘환" },
      { tone: "warn", text: "c", rule: "M3-11 강창권" },
      { tone: "info", text: "d", rule: "4.4 박병창" },
    ]);
  });
  it("default parameters match the book values", () => {
    const P = DAILY_SIGNAL_PARAMS;
    expect([P.surgeUpMult, P.pullbackGapPct, P.overheatShort, P.overheatLong, P.overheatShortBear, P.overheatLongBear]).toEqual([10, 1.5, 106, 110, 102, 104]);
    expect([P.gapChasePct, P.gapPassPct, P.stochLow, P.stochHigh, P.high52Window]).toEqual([10, 7, 20, 80, 250]);
  });
});
