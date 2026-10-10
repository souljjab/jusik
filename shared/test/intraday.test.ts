import { describe, expect, it } from "vitest";
import {
  aggregateBars, assessIntraday, assessIntradayAt, barMinutes, hmToMinutes, INTRADAY_PARAMS, isDailyAligned, minutesToHm, smaOf,
  type IntradayBar, type IntradayInput,
} from "../src/intraday";

const D = "2024-03-18";
const PREV = "2024-03-15";
const O = 9 * 60;

/** 종가 배열로 1분봉을 만든다: 시가 = 직전 종가(첫 봉은 firstOpen), 고가·저가 = 시가·종가의 max·min */
function mk(closes: number[], firstOpen = closes[0]!, date = D, start = O): IntradayBar[] {
  return closes.map((c, i) => {
    const o = i === 0 ? firstOpen : closes[i - 1]!;
    return { t: `${date}T${minutesToHm(start + i)}`, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 1000 };
  });
}
const ramp = (from: number, step: number, n: number) => Array.from({ length: n }, (_, i) => from + step * i);
const input = (bars1m: IntradayBar[], over: Partial<IntradayInput> = {}): IntradayInput => ({
  bars1m, prevClose: 10_000, prevHigh: 10_300, dailyAligned: true, sessionOpen: "09:00", ...over,
});
const rules = (notes: { rule?: string }[]) => notes.map((n) => n.rule);
const closesOf = (bars: IntradayBar[]) => bars.map((b) => b.close);

describe("time helpers, aggregation, SMA", () => {
  it("parses HH:mm and bar times", () => {
    expect(hmToMinutes("09:30")).toBe(570);
    expect(hmToMinutes("9:05")).toBe(545);
    expect(hmToMinutes("25:00")).toBeNaN();
    expect(hmToMinutes("x")).toBeNaN();
    expect(barMinutes("2024-03-18T15:30")).toBe(930);
    expect(minutesToHm(545)).toBe("09:05");
  });

  it("aggregates 1-minute bars into N-minute bars aligned to the session open", () => {
    const b = mk([10, 11, 12, 13, 9, 14, 15, 16], 10);
    b[1] = { ...b[1]!, high: 20 };
    const a = aggregateBars(b, 3, "09:00");
    expect(a.map((x) => x.t)).toEqual([`${D}T09:00`, `${D}T09:03`, `${D}T09:06`]);
    expect(a[0]).toEqual({ t: `${D}T09:00`, open: 10, high: 20, low: 10, close: 12, volume: 3000 });
    expect(a[1]).toEqual({ t: `${D}T09:03`, open: 12, high: 14, low: 9, close: 14, volume: 3000 });
    expect(a[2]).toMatchObject({ open: 14, close: 16, volume: 2000 }); // 진행 중인 마지막 구간
  });

  it("aligns to a 09:30 open, survives a delayed first bar (VI) and splits days", () => {
    const us = mk([1, 2, 3, 4, 5, 6, 7], 1, D, 9 * 60 + 30);
    expect(aggregateBars(us, 5, "09:30").map((x) => x.t.slice(11))).toEqual(["09:30", "09:35"]);
    const late = mk([5, 6, 7, 8], 5, D, O + 2); // 09:02부터
    expect(aggregateBars(late, 3, "09:00").map((x) => x.t.slice(11))).toEqual(["09:00", "09:03"]);
    const twoDays = [...mk([1, 2], 1, PREV, 15 * 60 + 19), ...mk([3, 4], 3, D, O)];
    expect(aggregateBars(twoDays, 3, "09:00").map((x) => x.t)).toEqual([`${PREV}T15:18`, `${D}T09:00`]);
    // 순서가 섞여 들어와도 시간순으로 합친다
    expect(aggregateBars([...b3()].reverse(), 3, "09:00")).toEqual(aggregateBars(b3(), 3, "09:00"));
    expect(aggregateBars(b3(), 0, "09:00")).toEqual([]);
    expect(aggregateBars(b3(), 3, "bad")).toEqual([]);
    function b3() {
      return mk([1, 2, 3, 4, 5, 6], 1);
    }
  });

  it("smaOf averages the last N values (or up to end) and returns null when short", () => {
    expect(smaOf([1, 2, 3, 4], 2)).toBe(3.5);
    expect(smaOf([1, 2, 3, 4], 2, 2)).toBe(1.5);
    expect(smaOf([1, 2, 3, 4], 4)).toBe(2.5);
    expect(smaOf([1, 2], 3)).toBeNull();
    expect(smaOf([1, 2], 0)).toBeNull();
  });

  it("isDailyAligned: 5>20>60 and all rising", () => {
    const up = Array.from({ length: 80 }, (_, i) => 100 + i);
    expect(isDailyAligned(up)).toBe(true);
    expect(isDailyAligned([...up].reverse())).toBe(false);
    // 정배열이지만 최근 꺾여 5일선이 내려가면 우상향이 아니다
    const bent = [...up.slice(0, 75), 170, 165, 160, 158, 157];
    expect(isDailyAligned(bent)).toBe(false);
    expect(isDailyAligned(up.slice(0, 64))).toBeNull();
    expect(isDailyAligned(up.slice(0, 65))).toBe(true);
  });
});

describe("assessIntraday — 시초가 +10% 갭(M3-18)", () => {
  // 전일 종가 10,000 → 시가 11,200(+12%), 30원씩 오르다가 20분선까지 눌림
  const base = ramp(11_200, 30, 25); // 09:00~09:24
  const withPullback = () => {
    const closes = [...base, 11_880, 11_840, 11_800, 11_760, 11_780];
    const bars = mk(closes, 11_200);
    const ma = smaOf(closesOf(bars), 20)!;
    bars[29] = { ...bars[29]!, low: Math.floor(ma) - 5 }; // 09:29 봉이 1분봉 20분선에 닿고 위에서 마감
    return { bars, ma };
  };

  it("forbids buying at the open and waits ~20 minutes", () => {
    const bars = mk(base, 11_200);
    const a = assessIntradayAt(input(bars), 10);
    expect(a.gapPct).toBe(12);
    expect(a.minutesSinceOpen).toBe(11);
    expect(a.entry.verdict).toBe("wait");
    const n = a.entry.notes.find((x) => x.rule === "M3-18 강창권")!;
    expect(n.tone).toBe("warn");
    expect(n.text).toContain("시초가 매수는 금지");
    expect(n.text).toContain("09:20");
  });

  it("after 20 minutes buys only when the 1-minute 20-line support is confirmed, stop = session low", () => {
    const { bars, ma } = withPullback();
    const a = assessIntraday(input(bars));
    expect(a.minutesSinceOpen).toBe(30);
    expect(a.hold.ma20on1m).toBeCloseTo(ma, 6);
    expect(a.entry.verdict).toBe("buy");
    expect(a.entry.stop).toBe(11_200);
    expect(a.sessionLow).toBe(11_200);
    expect(a.entry.notes[0]).toMatchObject({ tone: "good", rule: "M3-18 강창권" });
    // 3분봉 첫 캔들(09:00~09:02): 시가 11,200 종가 11,260 → 1/3선 11,240, 몸통 중심 11,230
    expect(a.entry.splitPrices).toEqual([11_240, 11_230]);
  });

  it("keeps waiting when price runs away without touching the line (no chasing)", () => {
    const bars = mk(ramp(11_200, 30, 30), 11_200);
    const a = assessIntraday(input(bars));
    expect(a.entry.verdict).toBe("wait");
    expect(a.entry.notes.at(-1)!.text).toContain("추격 금지");
    expect(a.entry.stop).toBeNull();
  });

  it("does not count a cross from below as support, and waits when below the line", () => {
    const closes = [...ramp(11_200, 30, 20), 11_500, 11_400, 11_300, 11_250, 11_300, 11_420, 11_520];
    const bars = mk(closes, 11_200);
    const a = assessIntradayAt(input(bars), 23);
    expect(a.entry.verdict).toBe("wait");
    expect(a.entry.notes.at(-1)!.text).toContain("아래예요");
    // 아래에서 위로 다시 올라선 봉은 돌파일 뿐 지지 확인이 아니다
    const b = assessIntraday(input(bars));
    expect(b.last).toBe(11_520);
    expect(b.last! > b.hold.ma20on1m!).toBe(true);
    expect(b.entry.verdict).toBe("wait");
  });

  it("refuses when the last bar breaks the session low", () => {
    const closes = [...base, 11_500, 11_100];
    const a = assessIntraday(input(mk(closes, 11_200)));
    expect(a.sessionLow).toBe(11_100);
    expect(a.entry.verdict).toBe("wait");
    expect(a.entry.notes.some((n) => n.tone === "bad" && n.text.includes("당일 저점"))).toBe(true);
  });

  it("split prices need a completed first 3-minute candle", () => {
    expect(assessIntradayAt(input(mk(base, 11_200)), 1).entry.splitPrices).toEqual([]);
    expect(assessIntradayAt(input(mk(base, 11_200)), 2).entry.splitPrices).toEqual([11_240, 11_230]);
  });
});

describe("assessIntraday — +7~10% 갭과 전일 시간외 급등", () => {
  const closes = [...ramp(10_800, 30, 25), 11_480, 11_440, 11_400, 11_360, 11_380];
  const make = () => {
    const bars = mk(closes, 10_800);
    const ma = smaOf(closesOf(bars), 20)!;
    bars[29] = { ...bars[29]!, low: Math.floor(ma) - 5 };
    return bars;
  };

  it("unknown after-hours status: conservative wait (warn) then the M3-18 procedure", () => {
    const early = assessIntradayAt(input(make()), 5);
    expect(early.gapPct).toBe(8);
    expect(early.entry.verdict).toBe("wait");
    expect(early.entry.notes[0]).toMatchObject({ tone: "warn", rule: "4.7 강창권" });
    expect(early.entry.notes[0]!.text).toContain("시간외");
    expect(rules(early.entry.notes)).toContain("M3-18 강창권");
    const later = assessIntraday(input(make()));
    expect(later.entry.verdict).toBe("buy");
  });

  it("known non-surge: same procedure without the after-hours hint; can be switched off", () => {
    const a = assessIntradayAt(input(make(), { afterHoursSurge: false }), 5);
    expect(a.entry.verdict).toBe("wait");
    expect(a.entry.notes[0]!.text).not.toContain("시간외");
    const off = assessIntradayAt(input(make(), { afterHoursSurge: false }), 5, { cautionGapWaits: false });
    expect(rules(off.entry.notes)).not.toContain("M3-18 강창권");
  });

  it("after-hours surge: +7% gap is a pass, +10% gap no chase (avoid all day)", () => {
    const a = assessIntraday(input(make(), { afterHoursSurge: true }));
    expect(a.entry.verdict).toBe("avoid");
    expect(a.entry.notes[0]).toMatchObject({ tone: "bad", rule: "4.7 강창권" });
    expect(a.entry.notes[0]!.text).toContain("원칙적으로 패스");
    const big = assessIntraday(input(mk(ramp(11_200, 30, 30), 11_200), { afterHoursSurge: true }));
    expect(big.entry.verdict).toBe("avoid");
    expect(big.entry.notes[0]!.text).toContain("추격 매수 금지");
    // +5% 갭은 시간외 급등 규칙 밖
    const small = assessIntraday(input(mk(ramp(10_500, 10, 10), 10_500), { afterHoursSurge: true }));
    expect(small.entry.verdict).not.toBe("avoid");
  });
});

describe("assessIntraday — 전일 상한가, 갭 없이 출발", () => {
  // 전일(상한가) 마지막 20분 10,000 횡보 → 오늘 10,050 출발, 매물 소화로 9,800까지 밀렸다가 회복, 20분선 눌림 후 지지
  const warm = mk(Array(20).fill(10_000), 10_000, PREV, 15 * 60);
  const closes = [10_020, 9_960, 9_900, 9_850, 9_810, 9_800, 9_850, 9_920, 9_990, 10_060, 10_120, 10_100, 10_150];
  const make = () => {
    const bars = mk(closes, 10_050);
    const ma = smaOf([...closesOf(warm), ...closes].slice(0, 32), 20)!;
    bars[11] = { ...bars[11]!, low: Math.floor(ma) - 3 };
    return bars;
  };
  const inp = (bars: IntradayBar[], over: Partial<IntradayInput> = {}) => input(bars, { prevLimitUp: true, prevBars1m: warm, ...over });

  it("waits while the early selling is digested", () => {
    const a = assessIntradayAt(inp(make()), 4);
    expect(a.gapPct).toBe(0.5);
    expect(a.entry.verdict).toBe("wait");
    expect(a.entry.notes[0]!.text).toContain("10~30분");
  });

  it("10~30 minutes: buys on 1-minute 20-line support (with previous-session warm-up)", () => {
    const a = assessIntradayAt(inp(make()), 11);
    expect(a.minutesSinceOpen).toBe(12);
    expect(a.entry.verdict).toBe("buy");
    expect(a.entry.stop).toBe(9_800);
    expect(a.entry.notes[0]).toMatchObject({ tone: "good", rule: "4.7 강창권" });
  });

  it("without warm-up the 20-line is not ready yet, so it waits", () => {
    const a = assessIntradayAt(inp(make(), { prevBars1m: undefined }), 11);
    expect(a.hold.ma20on1m).toBeNull();
    expect(a.entry.verdict).toBe("wait");
    expect(a.entry.notes[0]!.text).toContain("부족");
  });

  it("after 30 minutes falls back to the normal setups; a gap-up start is not this rule", () => {
    const long = mk([...closes, ...ramp(10_150, 5, 30)], 10_050);
    const a = assessIntraday(inp(long));
    expect(a.minutesSinceOpen).toBe(43);
    expect(a.entry.notes[0]!.text).toContain("지나");
    const gapUp = assessIntradayAt(inp(mk(closes, 10_400)), 4);
    expect(gapUp.entry.notes.some((n) => n.text.includes("소화"))).toBe(false);
  });
});

describe("assessIntraday — 보유 기준(1분봉 20분선, 3분봉 10분선)", () => {
  const up = Array.from({ length: 45 }, (_, i) => Math.round(10_000 * 1.002 ** (i + 1)));
  it("holds while above both lines", () => {
    const a = assessIntraday(input(mk(up, 10_000)));
    expect(a.hold.ma20on1m).not.toBeNull();
    expect(a.hold.ma10on3m).not.toBeNull();
    expect(a.hold.below1m20).toBe(false);
    expect(a.hold.below3m10).toBe(false);
    expect(a.hold.note.tone).toBe("good");
  });
  it("warns when only the 1-minute 20-line breaks (the 3-minute bar is not complete yet)", () => {
    const c = [...up, Math.round(up[44]! * 0.97)];
    const a = assessIntraday(input(mk(c, 10_000)));
    expect(a.hold.below1m20).toBe(true);
    expect(a.hold.below3m10).toBe(false);
    expect(a.hold.note.tone).toBe("warn");
  });
  it("is bad when both lines break on the completed 3-minute close", () => {
    const x = Math.round(up[44]! * 0.97);
    const c = [...up, x, Math.round(x * 0.99), Math.round(x * 0.98)];
    const a = assessIntraday(input(mk(c, 10_000)));
    expect(a.hold.below1m20).toBe(true);
    expect(a.hold.below3m10).toBe(true);
    expect(a.hold.note.tone).toBe("bad");
  });
  it("reports missing data early in the session", () => {
    const a = assessIntradayAt(input(mk(up, 10_000)), 5);
    expect(a.hold.ma20on1m).toBeNull();
    expect(a.hold.ma10on3m).toBeNull();
    expect(a.hold.note.tone).toBe("info");
  });
});

describe("assessIntraday — 3분봉 첫 눌림과 5·20분선 동반 이탈", () => {
  // 90분 급등 → 완만한 눌림·횡보(오르는 20분선이 따라와 첫 접촉) → 반등 → 두 번째 눌림 → 급락
  function day(): IntradayBar[] {
    const c: number[] = [];
    let p = 10_000;
    for (let i = 0; i < 90; i++) c.push((p = p * 1.0015));
    for (let i = 0; i < 15; i++) c.push((p = p * 0.999));
    for (let i = 0; i < 60; i++) c.push(p);
    for (let i = 0; i < 30; i++) c.push((p = p * 1.003));
    for (let i = 0; i < 20; i++) c.push((p = p * 0.996));
    for (let i = 0; i < 30; i++) c.push((p = p * 0.993));
    return mk(c.map((x) => Math.round(x)), 10_000);
  }
  const bars = day();
  const evals = bars.map((_, i) => assessIntradayAt(input(bars, { prevHigh: 20_000 }), i));

  it("signals only once, on the 3-minute bar that first touches the 20-line after a surge", () => {
    const sig = evals.map((a, i) => (a.pullback3m.signal ? i : -1)).filter((i) => i >= 0);
    expect(sig.length).toBeGreaterThan(0);
    const touches = new Set(sig.map((i) => evals[i]!.pullback3m.firstTouchAt));
    expect(touches.size).toBe(1); // 1회만
    const i0 = sig[0]!;
    expect((i0 + 1) % 3).toBe(0); // 3분봉이 완성되는 순간 판정
    expect(i0).toBeGreaterThan(90); // 급등 구간 이후
    // 독립 계산: 그 시점 마지막 완성 3분봉 저가가 3분봉 20분선(+0.3%)에 닿음
    const c3 = aggregateBars(bars.slice(0, i0 + 1), 3, "09:00");
    const m = smaOf(closesOf(c3), 20)!;
    expect(c3.at(-1)!.low).toBeLessThanOrEqual(m * 1.003);
    expect(c3.at(-1)!.t).toBe(evals[i0]!.pullback3m.firstTouchAt);
    // 그 전 완성 3분봉들은 (20분선이 생긴 뒤) 닿지 않았다
    for (let k = 20; k < c3.length - 1; k++) expect(c3[k]!.low).toBeGreaterThan(smaOf(closesOf(c3), 20, k + 1)! * 1.003);
    const a = evals[i0]!;
    expect(a.entry.verdict).toBe("buy");
    expect(a.entry.stop).toBe(Math.round(Math.min(smaOf(closesOf(c3), 5)!, m)));
    expect(c3.at(-1)!.close).toBeGreaterThanOrEqual(m);
    // 신호는 그 3분봉이 마지막 완성봉인 3분 동안만, 두 번째 눌림(195번째 봉 이후)에서는 다시 나오지 않는다
    expect(sig).toEqual([i0, i0 + 1, i0 + 2]);
    const second = aggregateBars(bars, 3, "09:00").slice(65);
    expect(second.some((b, k) => b.low <= smaOf(closesOf(aggregateBars(bars, 3, "09:00")), 20, 65 + k + 1)! * 1.003)).toBe(true);
    expect(evals.at(-1)!.pullback3m.note.text).toContain("1회");
  });

  it("does not arm without a surge", () => {
    const flat = mk(Array.from({ length: 120 }, (_, i) => 10_000 + (i % 7) * 10), 10_000);
    const a = assessIntraday(input(flat));
    expect(a.pullback3m.signal).toBe(false);
    expect(a.pullback3m.firstTouchAt).toBeNull();
    expect(a.pullback3m.note.text).toContain("급등");
  });

  it("stop3m fires when a completed 3-minute close is below both the 5- and 20-lines", () => {
    const fired = evals.map((a, i) => (a.stop3m.signal ? i : -1)).filter((i) => i >= 0);
    expect(fired.length).toBeGreaterThan(0);
    for (const i of fired) {
      const all3 = aggregateBars(bars.slice(0, i + 1), 3, "09:00");
      const done = (i + 1) % 3 === 0 ? all3 : all3.slice(0, -1);
      const cl = closesOf(done);
      expect(done.at(-1)!.close).toBeLessThan(smaOf(cl, 5)!);
      expect(done.at(-1)!.close).toBeLessThan(smaOf(cl, 20)!);
    }
    const last = evals.at(-1)!;
    expect(last.stop3m.signal).toBe(true);
    expect(last.stop3m.note).toMatchObject({ tone: "bad", rule: "4.7 강창권" });
    expect(last.entry.verdict).toBe("wait");
  });

  it("below the 5-line only is not a stop", () => {
    // 꾸준히 오르다 한 봉만 살짝 밀림: 5분선 아래, 20분선 위
    const c = Array.from({ length: 75 }, (_, i) => Math.round(10_000 * 1.002 ** (i + 1)));
    const p = c[71]!;
    c.splice(72, 3, Math.round(p * 0.99), Math.round(p * 0.98), Math.round(p * 0.975));
    const a = assessIntraday(input(mk(c, 10_000)));
    const c3 = aggregateBars(mk(c, 10_000), 3, "09:00");
    const cl = closesOf(c3);
    expect(c3.at(-1)!.close).toBeLessThan(smaOf(cl, 5)!);
    expect(c3.at(-1)!.close).toBeGreaterThan(smaOf(cl, 20)!);
    expect(a.stop3m.signal).toBe(false);
  });
});

describe("assessIntraday — 전일 고가 돌파 후 지지", () => {
  // 전일 고가 10,300: 09:10 돌파 → 되돌림이 돌파가 근처까지 → 다시 위
  const closes = [...ramp(10_000, 30, 10), 10_330, 10_380, 10_420, 10_390, 10_340, 10_370];
  const make = () => {
    const bars = mk(closes, 10_000);
    bars[14] = { ...bars[14]!, low: 10_320 };
    return bars;
  };

  it("buys only after the break holds above (support) and the daily chart is aligned", () => {
    const at11 = assessIntradayAt(input(make()), 11);
    expect(at11.breakout.prevHighBroken).toBe(true);
    expect(at11.breakout.supportConfirmed).toBe(false); // 돌파 직후는 보류
    const a = assessIntraday(input(make()));
    expect(a.breakout).toMatchObject({ prevHighBroken: true, supportConfirmed: true });
    expect(a.breakout.note.tone).toBe("good");
    expect(a.entry.verdict).toBe("buy");
    expect(a.entry.stop).toBe(10_320);
    expect(a.entry.splitPrices).toEqual([10_040, 10_030]);
  });

  it("is gated by the daily 5·20·60 alignment", () => {
    const no = assessIntraday(input(make(), { dailyAligned: false }));
    expect(no.breakout.supportConfirmed).toBe(true);
    expect(no.breakout.note.tone).toBe("bad");
    expect(no.entry.verdict).toBe("wait");
    const unknown = assessIntraday(input(make(), { dailyAligned: null }));
    expect(unknown.breakout.note.tone).toBe("warn");
    expect(unknown.entry.verdict).toBe("wait");
  });

  it("not broken / failed break", () => {
    const below = assessIntraday(input(mk(ramp(10_000, 20, 15), 10_000)));
    expect(below.breakout.prevHighBroken).toBe(false);
    expect(below.breakout.note.text).toContain("전일 고가");
    const failed = assessIntraday(input(mk([...closes.slice(0, 13), 10_200, 10_150], 10_000)));
    expect(failed.breakout).toMatchObject({ prevHighBroken: true, supportConfirmed: false });
    expect(failed.breakout.note.tone).toBe("warn");
    expect(failed.entry.verdict).toBe("wait");
  });

  it("without a retest there is no support confirmation", () => {
    const runaway = assessIntraday(input(mk([...ramp(10_000, 30, 10), ...ramp(10_400, 60, 8)], 10_000)));
    expect(runaway.breakout.prevHighBroken).toBe(true);
    expect(runaway.breakout.supportConfirmed).toBe(false);
  });
});

describe("assessIntraday — no look-ahead and input hygiene", () => {
  const c = Array.from({ length: 120 }, (_, i) => Math.round(10_000 * (1 + 0.06 * Math.sin(i / 9) + i * 0.0008)));
  const bars = mk(c, 10_000);

  it("assessIntradayAt(i) equals slicing, and equals nowMinutes clipping", () => {
    for (const i of [0, 5, 19, 20, 47, 61, 89, 119]) {
      const at = assessIntradayAt(input(bars), i);
      expect(at).toEqual(assessIntraday(input(bars.slice(0, i + 1))));
      expect(at).toEqual(assessIntraday(input(bars, { nowMinutes: O + i + 1 })));
    }
  });

  it("changing future bars never changes the past assessment", () => {
    const wild = bars.map((b, k) => (k > 60 ? { ...b, open: 1, high: 99_999, low: 1, close: 50_000 } : b));
    for (const i of [30, 45, 60]) expect(assessIntradayAt(input(wild), i)).toEqual(assessIntradayAt(input(bars), i));
  });

  it("ignores pre-open bars and bars of other days in bars1m; warm-up never sets the gap or the low", () => {
    const pre = mk([20_000, 20_000], 20_000, D, O - 5);
    const a = assessIntraday(input([...pre, ...bars.slice(0, 30)]));
    expect(a.gapPct).toBe(0);
    const warm = mk(Array(30).fill(5_000), 5_000, PREV, 15 * 60);
    const b = assessIntraday(input(bars.slice(0, 30), { prevBars1m: warm }));
    expect(b.gapPct).toBe(0);
    expect(b.sessionLow).toBe(Math.min(...bars.slice(0, 30).map((x) => x.low)));
  });

  it("empty input waits with info notes", () => {
    const a = assessIntraday(input([]));
    expect(a).toMatchObject({ asOf: null, gapPct: null, sessionLow: null, last: null, minutesSinceOpen: 0 });
    expect(a.entry.verdict).toBe("wait");
    expect(a.notes[0]!.tone).toBe("info");
    const before = assessIntraday(input(bars, { nowMinutes: O }));
    expect(before.asOf).toBeNull();
  });

  it("notes are polite Korean with rule tags and no duplicates; params are exported", () => {
    const a = assessIntraday(input(bars));
    expect(a.notes.length).toBeGreaterThan(3);
    expect(new Set(a.notes.map((n) => n.text)).size).toBe(a.notes.length);
    for (const n of a.notes) {
      expect(n.rule).toMatch(/^(M3-18|4\.7) 강창권$/);
      expect(n.text).toMatch(/요[.)]?$|요\(.*\)\.?$/);
    }
    expect(INTRADAY_PARAMS.gapNoChasePct).toBe(10);
    expect(INTRADAY_PARAMS.gapCautionPct).toBe(7);
    expect(INTRADAY_PARAMS.gapWaitMinutes).toBe(20);
  });

  it("US session (09:30 open, cents)", () => {
    const us = mk([100.5, 100.8, 101.1, 101.4, 101.2], 100, D, 9 * 60 + 30);
    const a = assessIntraday({ bars1m: us, prevClose: 100, prevHigh: 101, dailyAligned: true, sessionOpen: "09:30" });
    expect(a.minutesSinceOpen).toBe(5);
    expect(a.gapPct).toBe(0);
    expect(a.entry.splitPrices).toEqual([100.73, 100.55]);
  });
});
