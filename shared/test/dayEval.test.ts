import { describe, expect, it } from "vitest";
import { DAYTRADE_BY_REGION, evaluateTrades, paperTradesFromJournal, replayDayTrade, stats, type Candle, type EvalTrade, type JournalEntry } from "../src";

const ref = { code: "005930", name: "삼성전자", market: "KOSPI" as const };
const kr = { ...DAYTRADE_BY_REGION.KR, minTradeValue: 1 };

/** 평일 횡보 60일 → 거래량 동반 돌파 → after(이후 종가 배율 목록) */
function scenario(after: number[], { gapOpen = 1.0 } = {}): Candle[] {
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
  push(px * 1.005, bc * 1.003, px * 0.998, bc, 5000); // 신호일
  px = bc;
  after.forEach((m, k) => {
    const open = k === 0 ? px * gapOpen : px;
    const c = bc * m;
    push(open, Math.max(open, c) * 1.002, Math.min(open, c) * 0.998, c, 1500);
    px = c;
  });
  return out;
}

describe("replayDayTrade", () => {
  it("enters at the next open and exits at the target on a run-up", () => {
    const t = replayDayTrade(ref, scenario([1.0, 1.03, 1.08, 1.1]), kr);
    expect(t).toHaveLength(1);
    expect(t[0]!.exitReason).toBe("목표 도달");
    expect(t[0]!.returnPct).toBeGreaterThan(0);
    expect(t[0]!.returnPct).toBeLessThan(t[0]!.stopPct * 2); // 비용만큼 명목 목표보다 작다
  });
  it("stops out on a drop and books the loss with costs", () => {
    const t = replayDayTrade(ref, scenario([1.0, 0.99, 0.9, 0.85]), kr);
    expect(t[0]!.exitReason).toBe("손절");
    expect(t[0]!.returnPct).toBeLessThan(-t[0]!.stopPct);
  });
  it("exits on time when nothing happens", () => {
    const t = replayDayTrade(ref, scenario([1.0, 1.001, 0.999, 1.0, 1.001, 1.0]), kr);
    expect(t[0]!.exitReason).toBe("시간 청산");
    expect(t[0]!.holdDays).toBe(kr.maxHoldDays);
  });
  it("assumes the stop first when a bar touches both", () => {
    const cs = scenario([1.0]);
    const last = cs[cs.length - 1]!;
    cs.push({ ...last, date: "2099-01-01", open: last.close, high: last.close * 1.2, low: last.close * 0.8, close: last.close });
    expect(replayDayTrade(ref, cs, kr)[0]!.exitReason).toBe("손절");
  });
  it("skips gap-up chases and trades that never closed", () => {
    expect(replayDayTrade(ref, scenario([1.06, 1.08, 1.1, 1.12], { gapOpen: 1.06 }), kr)).toHaveLength(0);
    expect(replayDayTrade(ref, scenario([1.0, 1.01]), kr)).toHaveLength(0);
  });
  it("does not use data after the signal day to decide entry", () => {
    const a = replayDayTrade(ref, scenario([1.0, 1.03, 1.08, 1.1]), kr);
    const b = replayDayTrade(ref, scenario([1.0, 0.99, 0.9, 0.85]), kr);
    expect(a[0]!.date).toBe(b[0]!.date);
    expect(a[0]!.score).toBe(b[0]!.score);
  });
});

describe("stats", () => {
  it("computes win rate, expectancy, profit factor and a confidence bound", () => {
    const s = stats([2, 2, -1, -1]);
    expect(s).toMatchObject({ n: 4, winRate: 0.5, avgWinPct: 2, avgLossPct: -1, expectancyPct: 0.5, profitFactor: 2, reliable: false });
    expect(s.lowerBoundPct!).toBeLessThan(0.5);
    expect(stats([]).expectancyPct).toBeNull();
  });
});

function trade(date: string, score: number, ret: number, extra: Partial<EvalTrade> = {}): EvalTrade {
  return { code: "X", name: "X", date, score, volumeRatio: 3, changePct: 5, stopPct: 3, market: "KOSPI", regime: "BULL", exitReason: ret > 0 ? "목표 도달" : "손절", holdDays: 1, returnPct: ret, ...extra };
}
const day = (i: number) => new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

describe("evaluateTrades", () => {
  it("refuses to suggest with too few trades", () => {
    const e = evaluateTrades([trade(day(0), 60, 1), trade(day(1), 70, -1)], 55);
    expect(e.suggestion.minScore).toBeNull();
    expect(e.suggestion.reason).toContain("거래가 더 쌓여야");
  });
  it("suggests a higher bar only when it also works in the later half", () => {
    // 낮은 점수(55~64)는 손실, 높은 점수(70+)는 이익 — 앞·뒤 기간 모두 같은 패턴
    const ts: EvalTrade[] = [];
    for (let i = 0; i < 160; i++) ts.push(i % 2 ? trade(day(i), 72, i % 6 === 1 ? -1 : 2) : trade(day(i), 58, i % 4 === 0 ? 1 : -1.5));
    const e = evaluateTrades(ts, 55);
    // 점수가 58·72뿐이라 60~70 기준은 모두 같은 거래(72점)를 고른다 → 같으면 가장 느슨한 60을 고른다
    expect(e.suggestion.minScore).toBe(60);
    expect(e.thresholds.find((r) => r.minScore === 60)!.secondHalf.expectancyPct!).toBeGreaterThan(0);
    expect(e.thresholds.find((r) => r.minScore === 55)!.secondHalf.expectancyPct!).toBeLessThan(e.thresholds.find((r) => r.minScore === 60)!.secondHalf.expectancyPct!);
    expect(e.groups.find((g) => g.title === "점수")!.buckets.map((b) => b.label)).toEqual(["55~64", "65~74"]);
  });
  it("does not chase a threshold that only worked in the first half (overfitting guard)", () => {
    const ts: EvalTrade[] = [];
    for (let i = 0; i < 160; i++) {
      const early = i < 80;
      ts.push(i % 2 ? trade(day(i), 72, early ? 2 : -1.5) : trade(day(i), 58, early ? -1 : 0.6));
    }
    const e = evaluateTrades(ts, 55);
    expect(e.suggestion.minScore).toBeNull();
  });
  it("withholds a suggestion when the out-of-sample edge is not distinguishable from noise", () => {
    // 높은 점수가 뒤 기간에도 조금 낫지만 변동이 커서 하한이 0 아래
    const ts: EvalTrade[] = [];
    for (let i = 0; i < 200; i++) ts.push(i % 2 ? trade(day(i), 72, i % 4 === 1 ? 8 : -7.5) : trade(day(i), 58, i % 4 === 0 ? 7.6 : -8));
    const e = evaluateTrades(ts, 55);
    expect(e.suggestion.minScore).toBeNull();
  });
  it("ignores tiny out-of-sample improvements", () => {
    // 높은 점수가 아주 조금(0.1%p)만 나음
    const ts: EvalTrade[] = [];
    for (let i = 0; i < 200; i++) ts.push(i % 2 ? trade(day(i), 72, i % 4 === 1 ? 1.1 : 0.9) : trade(day(i), 58, i % 4 === 0 ? 0.95 : 0.75));
    const e = evaluateTrades(ts, 55);
    expect(e.suggestion.minScore).toBeNull();
    expect(e.suggestion.reason).toContain("%p 미만");
  });
  it("says so when every threshold loses out of sample", () => {
    const ts = Array.from({ length: 120 }, (_, i) => trade(day(i), 50 + (i % 30), -0.5));
    const e = evaluateTrades(ts, 55);
    expect(e.suggestion.minScore).toBeNull();
    expect(e.suggestion.reason).toContain("손실");
  });
});

describe("paperTradesFromJournal", () => {
  const meta = { score: 70, volumeRatio: 4, changePct: 6, stopPct: 3, market: "KOSPI", regime: "BULL" };
  const e = (id: string, date: string, side: "BUY" | "SELL", price: number, extra: Partial<JournalEntry> = {}): JournalEntry => ({ id, code: "005930", name: "삼성전자", date, side, price, qty: 10, reason: "", source: "자동(모의)", ...extra });
  it("pairs auto buys and sells, reads net return from the review, and skips manual or meta-less trades", () => {
    const t = paperTradesFromJournal([
      e("1", "2024-01-02", "BUY", 100, { meta }),
      e("2", "2024-01-04", "SELL", 105, { reason: "목표 도달(105)", review: "순손익 4600 (+4.60%)" }),
      e("3", "2024-01-05", "BUY", 100), // meta 없음
      e("4", "2024-01-06", "SELL", 90, { reason: "손절(90)" }),
      e("5", "2024-01-07", "BUY", 100, { meta, source: "수동" }),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ exitReason: "목표 도달", returnPct: 4.6, holdDays: 2, score: 70 });
  });
});
