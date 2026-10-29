import { describe, expect, it } from "vitest";
import { dayTradeEvidence, type DayTradeCandidate, type Settings } from "@jusik/shared";
import { orderRequest, previewOf, previewWarnings, type OrderContext } from "../src/screens/stocks/OrderBox";
import { fitPanes, minuteClock, orderPreview, PANES } from "../src/screens/stocks/stocksModel";
import { pruneCache } from "../src/screens/stocks/useExtras";

// 리뷰 수정(종목): 주문 미리 보기·주문 요청·세 영역 폭·분봉 시점·보조 자료 캐시

const settings = { riskPct: 1, maxWeightPct: 30 } as Settings;
const candidate = {
  code: "000270", name: "기아", market: "KOSPI", price: 80_000, changePct: 6, stop: 77_000, target: 86_000, asOf: "2026-10-23",
  score: 82, volumeRatio: 5.4, notes: [], rules: [],
} as unknown as DayTradeCandidate;

function ctx(over: Partial<OrderContext> = {}): OrderContext {
  return {
    code: "000270", name: "기아", region: "KR", price: 80_000, capital: 10_000_000, paperBase: false, settings, held: 0,
    plan: { source: "daytrade", stop: 77_000, target: 86_000 }, evidence: null, ...over,
  };
}

describe("order preview counts held shares and flags limits (R052·R136·R008·R119)", () => {
  const base = { side: "BUY" as const, price: 80_000, stop: 78_000, capital: 10_000_000, riskPct: 1, maxWeightPct: 30, held: 0 };
  it("caps an add-on buy by the weight left after held shares", () => {
    // 비중 30% = 300만 원 / 8만 원 = 37주, 손실 기준 10만 원 / 2천 원 = 50주 → 37주. 이미 20주면 17주
    expect(orderPreview(base).qty).toBe(37);
    const add = orderPreview({ ...base, held: 20 });
    expect(add.qty).toBe(17);
    expect(add.weightAfter).toBeCloseTo(29.6, 1);
    expect(add.overWeight).toBe(false);
  });
  it("proposes 0 shares and overWeight when held shares already fill the cap", () => {
    const full = orderPreview({ ...base, held: 40 });
    expect(full.qty).toBe(0);
    expect(full.overWeight).toBe(true);
  });
  it("flags overRisk when even one share breaks the per-trade loss limit", () => {
    const us = orderPreview({ ...base, price: 700, stop: 600, capital: 7_000 });
    expect(us.qty).toBe(1);
    expect(us.overRisk).toBe(true);
    expect(us.lossPct).toBeCloseTo(1.43, 2);
  });
  it("turns the flags into the same warnings the review sheet shows", () => {
    const c = ctx({ price: 700, capital: 7_000, region: "US" });
    expect(previewWarnings(c, previewOf(c, "BUY", 700, 600))).toEqual(["1주만 사도 1회 손실 한도 1%를 넘어요"]);
    const held = ctx({ held: 40 });
    expect(previewWarnings(held, previewOf(held, "BUY", 80_000, 78_000))).toEqual(["이미 가진 40주로 종목 비중 상한 30%에 닿아 더 살 수 없어요"]);
    const near = ctx({ held: 33 });
    // 33 + 4 = 37주 → 29.6%: 상한 90% 이상이면 근접
    expect(previewWarnings(near, previewOf(near, "BUY", 80_000, 78_000))).toEqual(["주문 후 종목 비중이 상한 30%에 가까워요"]);
    const ok = ctx();
    expect(previewWarnings(ok, previewOf(ok, "BUY", 80_000, 70_000))).toEqual([]);
  });
});

describe("order request from the stock screen (R001·R002·R133·R135)", () => {
  const ev = dayTradeEvidence(candidate);
  it("keeps the plan stop only when the caller did not pass one", () => {
    expect(orderRequest(ctx(), "BUY").stop).toBe(77_000);
    // 주문 상자에서 손절가를 지웠으면(0) 시트도 손절가 없이 연다 — 계획 손절가로 되돌리지 않는다
    const cleared = orderRequest(ctx(), "BUY", { stop: 0, qty: undefined });
    expect(cleared.stop).toBeUndefined();
    expect(cleared.qty).toBeUndefined();
    expect(orderRequest(ctx(), "BUY", { stop: 72_000 }).stop).toBe(72_000);
    expect(orderRequest(ctx(), "BUY", { target: null }).target).toBeUndefined();
  });
  it("attaches the buy evidence, reason and journal strategy name to buys only", () => {
    const buy = orderRequest(ctx({ evidence: ev }), "BUY");
    expect(buy.evidence).toBe(ev);
    expect(buy.strategy).toBe("단타 돌파");
    expect(buy.reason).toContain("근거");
    const sell = orderRequest(ctx({ evidence: ev, held: 5 }), "SELL", { qty: 5 });
    expect(sell.evidence).toBeUndefined();
    expect(sell.reason).toBeUndefined();
    expect(sell.strategy).toBeUndefined();
    expect(sell.stop).toBeUndefined();
    expect(sell.qty).toBe(5);
  });
});

describe("three-pane widths keep the chart usable (R004·R148)", () => {
  it("uses the saved widths when there is room", () => {
    expect(fitPanes(1640, { list: 300, side: 420 })).toMatchObject({ list: 300, side: 420 });
  });
  it("starts narrower on small windows and never squeezes the chart below its minimum when it can", () => {
    // 1280 창: 상자 1016 → 기본 220 + 340, 차트 1016 − 16 − 560 = 440
    const f = fitPanes(1016, {});
    expect(f).toMatchObject({ list: PANES.list.narrowDef, side: PANES.side.narrowDef });
    expect(1016 - PANES.handles - f.list - f.side).toBeGreaterThanOrEqual(PANES.centerMin);
  });
  it("shrinks saved wide panes (side first, then list) instead of collapsing the chart", () => {
    const f = fitPanes(1160, { list: 420, side: 600 });
    expect(f.side + f.list).toBe(1160 - PANES.handles - PANES.centerMin);
    expect(f.list).toBe(384);
    expect(f.side).toBe(PANES.side.min);
    expect(f.sideMax).toBe(PANES.side.min);
  });
  it("falls back to the minimums when even they leave less than the chart minimum (1200 window)", () => {
    const f = fitPanes(936, { list: 420, side: 600 });
    expect(f).toMatchObject({ list: PANES.list.min, side: PANES.side.min, listMax: PANES.list.min, sideMax: PANES.side.min });
    expect(936 - PANES.handles - f.list - f.side).toBeGreaterThan(f.side);
  });
  it("limits how far the handles can drag", () => {
    const f = fitPanes(1160, {});
    expect(f.listMax).toBe(1160 - PANES.handles - PANES.centerMin - f.side);
    expect(f.sideMax).toBe(Math.min(PANES.side.max, 1160 - PANES.handles - PANES.centerMin - f.list));
  });
});

describe("minute view after the close (R013)", () => {
  it("shows elapsed time only while the session is open", () => {
    expect(minuteClock({ open: true, sessionDate: "2026-10-26", today: "2026-10-26", close: "15:30", minutesSinceOpen: 125 })).toEqual({ closed: false, elapsed: "2시간 5분" });
    expect(minuteClock({ open: false, sessionDate: "2026-10-26", today: "2026-10-26", close: "15:30", minutesSinceOpen: 650 })).toEqual({ closed: true, closeText: "15:30 종가 기준" });
    expect(minuteClock({ open: false, sessionDate: "2026-10-23", today: "2026-10-26", close: "16:00", minutesSinceOpen: 0 })).toEqual({ closed: true, closeText: "10.23(금) 16:00 종가 기준" });
  });
});

describe("extras cache stays bounded (R082)", () => {
  it("drops expired entries and keeps only the newest max entries", () => {
    const m = new Map<string, { at: number }>();
    for (let i = 0; i < 40; i++) m.set(`c${i}`, { at: 1_000 + i });
    m.set("old", { at: 0 });
    pruneCache(m, 1_100, 100, 30);
    expect(m.has("old")).toBe(false);
    expect(m.size).toBe(30);
    expect(m.has("c39")).toBe(true);
    expect(m.has("c0")).toBe(false);
  });
});
