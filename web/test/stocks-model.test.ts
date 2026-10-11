import { describe, expect, it } from "vitest";
import type { Candle } from "@jusik/shared";
import {
  barTimeOf, candleMarks, chartMarkers, chartSummary, clampStopPct, dailyMarks, defaultPeriod, krTick, loadMemo, marksForPeriod, moveItem,
  orderPreview, parseStockRoute, restoreAt, saveMemo, stateLabel, stepCode, stopFromPct, toBars, weinsteinMarks, type SignalMark,
} from "../src/screens/stocks/stocksModel";

/** 평일만 이어지는 일봉(종가는 f(i), 거래량은 v(i)) */
function candles(n: number, f: (i: number) => number, v: (i: number) => number = () => 1000, start = "2023-01-02"): Candle[] {
  const out: Candle[] = [];
  let t = Date.parse(start);
  while (out.length < n) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const i = out.length;
      const c = f(i);
      out.push({ date: d.toISOString().slice(0, 10), open: c * 0.995, high: c * 1.01, low: c * 0.99, close: c, volume: v(i) });
    }
    t += 86_400_000;
  }
  return out;
}

describe("route", () => {
  it("reads code and tab, falls back to evidence", () => {
    expect(parseStockRoute(["stocks"])).toEqual({ code: null, tab: "evidence", minute: false });
    expect(parseStockRoute(["stocks", "005930"])).toEqual({ code: "005930", tab: "evidence", minute: false });
    expect(parseStockRoute(["stocks", "aapl", "fin"])).toEqual({ code: "AAPL", tab: "fin", minute: false });
    expect(parseStockRoute(["stocks", "005930", "disclosure"]).tab).toBe("disclosure");
    expect(parseStockRoute(["stocks", "005930", "nope"]).tab).toBe("evidence");
    expect(parseStockRoute(["stocks", "005930", "minute"])).toEqual({ code: "005930", tab: "evidence", minute: true });
  });
});

describe("bars", () => {
  const cs = candles(30, (i) => 100 + i, (i) => 10 + i);
  it("daily bars keep candles", () => {
    const d = toBars(cs, "D");
    expect(d).toHaveLength(30);
    expect(d[0]).toMatchObject({ time: cs[0]!.date, from: cs[0]!.date, close: 100 });
  });
  it("weekly bars end on the week's last day and sum volume", () => {
    const w = toBars(cs, "W");
    expect(w).toHaveLength(6); // 2023-01-02(월)부터 30거래일 = 6주
    expect(w[0]!.from).toBe("2023-01-02");
    expect(w[0]!.time).toBe("2023-01-06");
    expect(w[0]!.volume).toBe(10 + 11 + 12 + 13 + 14);
    expect(w[0]!.close).toBe(104);
    expect(w[0]!.high).toBeCloseTo(104 * 1.01);
  });
  it("monthly bars group by month", () => {
    const m = toBars(cs, "M");
    expect(m.map((b) => b.time.slice(0, 7))).toEqual(["2023-01", "2023-02"]);
    expect(m[0]!.from).toBe("2023-01-02");
    expect(m[0]!.time).toBe("2023-01-31");
  });
  it("finds the bar that contains a date", () => {
    const w = toBars(cs, "W");
    expect(barTimeOf(w, "2023-01-04")).toBe("2023-01-06");
    expect(barTimeOf(w, "2023-01-06")).toBe("2023-01-06");
    expect(barTimeOf(w, "2023-01-09")).toBe("2023-01-13");
    expect(barTimeOf(w, "2022-12-30")).toBe(null);
    expect(barTimeOf(w, "2030-01-01")).toBe(null);
  });
  it("summarizes the visible chart for screen readers", () => {
    const s = chartSummary("한빛반도체", toBars(cs, "D"), "D", (n) => String(n));
    expect(s).toContain("한빛반도체 일봉");
    expect(s).toContain("상승");
    expect(chartSummary("x", [], "W", String)).toContain("자료가 모자라요");
  });
});

describe("signal marks", () => {
  // 1년 반 동안 횡보 후, 거래량이 터지며 돌파하고 계속 오르는 종목
  const n = 420;
  const breakAt = 300;
  const cs = candles(
    n,
    (i) => (i < breakAt ? 100 + Math.sin(i / 6) * 2 : 104 + (i - breakAt) * 0.6),
    (i) => (i >= breakAt && i < breakAt + 5 ? 9000 : 1000),
  );

  it("marks the week a weinstein buy starts, once (not every following week)", () => {
    const marks = weinsteinMarks(cs);
    const buys = marks.filter((m) => m.side === "buy" && m.date >= cs[breakAt]!.date);
    expect(buys.length).toBeGreaterThanOrEqual(1);
    // BUY가 이어진 주(약 7주)는 첫 주만: 진입 표식은 하나
    expect(buys.filter((m) => m.label === "2단계 진입")).toHaveLength(1);
    const first = buys.find((m) => m.label === "2단계 진입")!;
    expect(first.stage?.stage).toBe(2);
    expect(first.id).toBe(`weinstein:${first.date}:buy`);
    // 매도 의견(3단계 이탈)은 횡보 구간에서 나오고, 이어지는 주는 첫 주만
    const sells = marks.filter((m) => m.side === "sell");
    const ids = marks.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sells.every((m) => m.date < cs[breakAt]!.date)).toBe(true);
  });

  it("maps marks to chart markers sorted by time, one per bar and kind", () => {
    const marks: SignalMark[] = [
      { id: "weinstein:2023-01-13:buy", kind: "weinstein", date: "2023-01-13", side: "buy", label: "2단계 돌파", short: "돌파", latest: false },
      { id: "daily:2023-01-10:buy", kind: "daily", date: "2023-01-10", side: "buy", label: "일봉 매수", short: "", latest: false },
      { id: "daily:2023-01-11:buy", kind: "daily", date: "2023-01-11", side: "buy", label: "일봉 매수", short: "", latest: false },
      { id: "candle:2023-01-06:buy", kind: "candle", date: "2023-01-06", side: "buy", label: "꼬리 양봉", short: "캔들", latest: false },
    ];
    const small = candles(30, (i) => 100 + i);
    const d = chartMarkers(marks, toBars(small, "D"), "D");
    expect(d.map((m) => m.time)).toEqual(["2023-01-06", "2023-01-10", "2023-01-11", "2023-01-13"]);
    const w = chartMarkers(marks, toBars(small, "W"), "W");
    // 주봉에는 일봉 보조 신호를 그리지 않는다
    expect(w.map((m) => m.kind)).toEqual(["candle", "weinstein"]);
    expect(marksForPeriod(marks, "M").some((m) => m.kind === "daily")).toBe(false);
  });

  it("daily and candle marks run on real-sized history without errors", () => {
    const d = dailyMarks(cs, null, 120);
    for (const m of d) {
      expect(m.kind).toBe("daily");
      expect(m.daily?.length).toBeGreaterThan(0);
      expect(m.daily!.every((s) => s.side === m.side)).toBe(true);
    }
    const c = candleMarks(cs);
    for (const m of c) expect(m.candle?.wave.ok).toBe(true);
  });
});

describe("order preview", () => {
  const base = { side: "BUY" as const, price: 84_300, stop: 77_500, capital: 100_000_000, riskPct: 1, maxWeightPct: 10, held: 0 };
  it("sizes by 1-trade risk within the weight cap, like the review sheet", () => {
    const p = orderPreview(base);
    // 1억 × 1% = 100만 원 ÷ 6,800 = 147주, 비중 상한 1,000만 원 ÷ 84,300 = 118주 → 118주
    expect(p.qty).toBe(118);
    expect(p.perShare).toBe(6_800);
    expect(p.loss).toBe(118 * 6_800);
    expect(p.lossPct).toBeCloseTo(0.8024, 3);
    expect(p.stopPct).toBeCloseTo(-8.066, 2);
    expect(p.weightAfter).toBeCloseTo(9.947, 2);
    expect(p.stopOk).toBe(true);
  });
  it("uses risk when it binds", () => {
    const p = orderPreview({ ...base, maxWeightPct: 30 });
    expect(p.qty).toBe(147);
  });
  it("refuses a stop at or above the price", () => {
    const p = orderPreview({ ...base, stop: 90_000 });
    expect(p.stopOk).toBe(false);
    expect(p.loss).toBe(0);
    const none = orderPreview({ ...base, stop: 0 });
    expect(none.stopOk).toBe(false);
    expect(none.stopPct).toBe(null);
  });
  it("sell uses held quantity", () => {
    const p = orderPreview({ ...base, side: "SELL", held: 12 });
    expect(p.qty).toBe(12);
    expect(p.loss).toBe(0);
    expect(p.weightAfter).toBe(0);
  });
  it("no deposit → one share, no account ratio", () => {
    const p = orderPreview({ ...base, capital: 0 });
    expect(p.qty).toBe(1);
    expect(p.lossPct).toBe(null);
    expect(p.weightAfter).toBe(null);
  });
});

describe("stop slider", () => {
  it("rounds down to KRX tick and US cents", () => {
    expect(krTick(1_500)).toBe(1);
    expect(krTick(4_000)).toBe(5);
    expect(krTick(15_000)).toBe(10);
    expect(krTick(30_000)).toBe(50);
    expect(krTick(84_300)).toBe(100);
    expect(krTick(300_000)).toBe(500);
    expect(krTick(600_000)).toBe(1_000);
    expect(stopFromPct(84_300, -8.1, "KR")).toBe(77_400); // 77,471.7 → 77,400
    expect(stopFromPct(23_950, -5, "KR")).toBe(22_750); // 22,752.5 → 22,750
    expect(stopFromPct(187.37, -5, "US")).toBe(178);
    expect(stopFromPct(0, -5, "KR")).toBe(0);
  });
  it("clamps to −15%~−1%", () => {
    expect(clampStopPct(-30)).toBe(-15);
    expect(clampStopPct(0)).toBe(-1);
    expect(clampStopPct(-8.06)).toBe(-8.1);
  });
});

describe("watchlist helpers", () => {
  it("moves, restores and steps", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(restoreAt(["a", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    expect(restoreAt(["a", "b"], "b", 0)).toEqual(["a", "b"]);
    expect(restoreAt([], "x", 5)).toEqual(["x"]);
    expect(stepCode(["a", "b", "c"], "b", 1)).toBe("c");
    expect(stepCode(["a", "b", "c"], "c", 1)).toBe("c");
    expect(stepCode(["a", "b", "c"], "a", -1)).toBe("a");
    expect(stepCode(["a", "b"], "zz", 1)).toBe("a");
    expect(stepCode([], "a", 1)).toBe(null);
  });
  it("labels rows by state", () => {
    expect(stateLabel({ held: true, candidate: true, analysis: null })).toBe("보유 중");
    expect(stateLabel({ held: false, candidate: true, analysis: null })).toBe("단타 돌파");
    expect(stateLabel({ held: false, candidate: false, analysis: null })).toBe("관찰");
  });
  it("defaults the period by strategy", () => {
    expect(defaultPeriod(true)).toBe("D");
    expect(defaultPeriod(false)).toBe("W");
  });
  it("memo storage degrades without localStorage", () => {
    expect(loadMemo("005930")).toBe("");
    expect(saveMemo("005930", "메모")).toBe(false);
  });
});
