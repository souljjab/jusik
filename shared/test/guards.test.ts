import { describe, expect, it } from "vitest";
import { averagingDownCheck, consecutiveLosses, GUARD_DEFAULTS, preTradeChecklist, todayPnl, tradingGuards } from "../src/guards";
import { summarizeJournal, type JournalEntry } from "../src/journal";
import { newPaperAccount, PAPER_COSTS, PAPER_STRATEGY, paperCheckExits, paperOpen, paperUnrealizedPnl } from "../src/paper";
import { rMultiple } from "../src/risk";
import { planWithCash, type DayTradeCandidate } from "../src/daytrade";
import { marketClock } from "../src/sessions";
import { paperTradesFromJournal } from "../src/dayEval";

const entry = (id: string, date: string, side: "BUY" | "SELL", price: number, qty: number, extra: Partial<JournalEntry> = {}): JournalEntry => ({
  id, code: "005930", name: "삼성전자", date, side, price, qty, reason: "", ...extra,
});
const rules = (notes: { rule?: string }[]) => notes.map((n) => n.rule);

describe("guard defaults", () => {
  it("opens the book numbers as parameters", () => {
    expect(GUARD_DEFAULTS).toMatchObject({ dailyLossLimitPct: 4, maxConsecutiveLosses: 3, maxPerTradeRiskPct: 1.5, maxWeightPct: 30, maxLossAdds: 1 });
  });
});

describe("consecutiveLosses", () => {
  it("counts the losing streak at the end, treats 0% as a loss and skips non-numbers", () => {
    expect(consecutiveLosses([])).toBe(0);
    expect(consecutiveLosses([3, -1, -2])).toBe(2);
    expect(consecutiveLosses([-1, -2, 4])).toBe(0);
    expect(consecutiveLosses([5, 0, -1])).toBe(2);
    expect(consecutiveLosses([-1, Number.NaN, -1])).toBe(2);
  });
  it("uses only past returns: changing later values keeps earlier prefixes the same", () => {
    const xs = [2, -1, -3, 4, -2, -2, -1, 5];
    const before = xs.map((_, i) => consecutiveLosses(xs.slice(0, i + 1)));
    const tampered = [...xs.slice(0, 5), 9, 9, 9];
    expect(tampered.slice(0, 5).map((_, i) => consecutiveLosses(tampered.slice(0, i + 1)))).toEqual(before.slice(0, 5));
  });
});

describe("tradingGuards", () => {
  const base = { closedReturnsPct: [2, -1], todayPnl: 0, equityStartOfDay: 10_000_000, riskPct: 1, maxWeightPct: 25 };
  it("passes quietly when every limit holds", () => {
    expect(tradingGuards(base)).toEqual({ blocked: false, notes: [] });
  });
  it("blocks new entries at the daily loss limit (M4-04)", () => {
    const hit = tradingGuards({ ...base, todayPnl: -400_000 });
    expect(hit.blocked).toBe(true);
    expect(hit.notes[0]).toMatchObject({ tone: "bad", rule: "M4-04 슈웨거" });
    expect(hit.notes[0]!.text).toContain("4%");
    expect(tradingGuards({ ...base, todayPnl: -390_000 }).blocked).toBe(false);
    expect(tradingGuards({ ...base, todayPnl: 900_000 }).blocked).toBe(false);
    // 기준값은 바꿀 수 있다
    expect(tradingGuards({ ...base, todayPnl: -300_000, params: { dailyLossLimitPct: 2 } }).blocked).toBe(true);
  });
  it("blocks after N losses in a row and suggests a rest (5.5)", () => {
    const r = tradingGuards({ ...base, closedReturnsPct: [5, -1, -0.5, -2] });
    expect(r.blocked).toBe(true);
    expect(r.notes).toEqual([expect.objectContaining({ tone: "bad", rule: "5.5 박용선·슈웨거" })]);
    expect(r.notes[0]!.text).toMatch(/3번 연속 손실.*규모를 줄여요/);
    expect(tradingGuards({ ...base, closedReturnsPct: [-1, -1, -1, 2, -1, -1] }).blocked).toBe(false);
    expect(tradingGuards({ ...base, closedReturnsPct: [-1, -1], params: { maxConsecutiveLosses: 2 } }).blocked).toBe(true);
  });
  it("warns (without blocking) on a per-trade risk over 1.5% and a weight cap over 30%", () => {
    const r = tradingGuards({ ...base, riskPct: 2, maxWeightPct: 40 });
    expect(r.blocked).toBe(false);
    expect(r.notes.map((n) => n.tone)).toEqual(["warn", "warn"]);
    expect(rules(r.notes)).toEqual(["M4-04 슈웨거", "M4-03 강영현"]);
    expect(tradingGuards({ ...base, riskPct: 1.5, maxWeightPct: 30 }).notes).toEqual([]);
  });
  it("says so when the start-of-day equity is unknown instead of silently passing", () => {
    const r = tradingGuards({ ...base, equityStartOfDay: 0, todayPnl: -1 });
    expect(r.blocked).toBe(false);
    expect(r.notes[0]).toMatchObject({ tone: "warn", rule: "M4-04 슈웨거" });
  });
});

describe("averagingDownCheck", () => {
  const next = (price: number, date = "2024-01-10", side: "BUY" | "SELL" = "BUY") => ({ code: "005930", side, price, date });
  it("allows a first buy and a sell without notes", () => {
    expect(averagingDownCheck([], next(10_000))).toEqual({ allowed: true, lossAdds: 0, notes: [] });
    expect(averagingDownCheck([entry("1", "2024-01-02", "BUY", 10_000, 10)], next(9_000, "2024-01-10", "SELL"))).toMatchObject({ allowed: true, notes: [] });
  });
  it("treats a same-day sell-then-rebuy as a new position (keeps the journal order within a day)", () => {
    const day = "2024-03-18";
    const book = [entry("1", day, "BUY", 100, 10), entry("2", day, "SELL", 90, 10), entry("3", day, "BUY", 95, 10)];
    const r = averagingDownCheck(book, next(93, day));
    expect(r.allowed).toBe(true);
    expect(r.lossAdds).toBe(1);
  });
  it("allows one add below the average price with a warning (M4-02)", () => {
    const r = averagingDownCheck([entry("1", "2024-01-02", "BUY", 10_000, 10)], next(9_000));
    expect(r).toMatchObject({ allowed: true, lossAdds: 1 });
    expect(r.notes).toEqual([expect.objectContaining({ tone: "warn", rule: "M4-02 캔들마스터" })]);
  });
  it("blocks the second add while losing, citing M4-02 and 5.3", () => {
    const js = [entry("1", "2024-01-02", "BUY", 10_000, 10), entry("2", "2024-01-03", "BUY", 9_000, 10)]; // 평균 9,500
    const r = averagingDownCheck(js, next(9_000));
    expect(r.allowed).toBe(false);
    expect(r.lossAdds).toBe(2);
    expect(rules(r.notes)).toEqual(["M4-02 캔들마스터", "5.3 박용선·와인스타인"]);
    expect(r.notes[1]!.text).toContain("물타기는 실패의 지름길");
    // 허용 횟수를 늘리면 통과
    expect(averagingDownCheck(js, next(9_000), { maxLossAdds: 2 }).allowed).toBe(true);
  });
  it("does not count adds above the average (adding to a winner)", () => {
    const up = averagingDownCheck([entry("1", "2024-01-02", "BUY", 10_000, 10)], next(11_000));
    expect(up).toMatchObject({ allowed: true, lossAdds: 0 });
    expect(up.notes[0]).toMatchObject({ tone: "info", rule: "5.3 와인스타인" });
    // 이익 중 추가 매수(평균 10,500) 뒤 첫 손실 중 추가 매수는 1회째라 허용
    const js = [entry("1", "2024-01-02", "BUY", 10_000, 10), entry("2", "2024-01-03", "BUY", 11_000, 10)];
    expect(averagingDownCheck(js, next(10_200))).toMatchObject({ allowed: true, lossAdds: 1 });
  });
  it("resets the count once the position is fully sold, and ignores other stocks", () => {
    const js = [
      entry("1", "2024-01-02", "BUY", 10_000, 10),
      entry("2", "2024-01-03", "BUY", 9_000, 10), // 손실 중 추가 매수 1회
      entry("3", "2024-01-04", "SELL", 9_500, 20), // 전량 매도
      entry("4", "2024-01-05", "BUY", 8_000, 10), // 새 포지션
      { ...entry("5", "2024-01-06", "BUY", 1, 10), code: "000660" },
    ];
    expect(averagingDownCheck(js, next(7_500))).toMatchObject({ allowed: true, lossAdds: 1 });
  });
  it("ignores journal entries dated after the order (no look-ahead)", () => {
    const past = [entry("1", "2024-01-02", "BUY", 10_000, 10)];
    const a = averagingDownCheck(past, next(9_000, "2024-01-05"));
    const withFuture = [...past, entry("2", "2024-01-08", "BUY", 8_000, 10), entry("3", "2024-01-09", "SELL", 7_000, 20)];
    expect(averagingDownCheck(withFuture, next(9_000, "2024-01-05"))).toEqual(a);
  });
});

describe("preTradeChecklist", () => {
  it("passes a complete plan", () => {
    expect(preTradeChecklist({ price: 10_000, stop: 9_300, target: 11_400, reason: "20일 고점 돌파 + 거래량 3배", weightPct: 15 })).toEqual([]);
  });
  it("requires stop, target, reason and weight before ordering (5.5: 손절가·목표가·비중 필수)", () => {
    const n = preTradeChecklist({ price: 10_000 });
    expect(n).toHaveLength(4);
    expect(n.every((x) => x.tone === "bad")).toBe(true);
    expect(n.map((x) => x.text).join(" ")).toMatch(/손절가.*목표가.*매수 근거.*비중/);
    expect(preTradeChecklist({ price: 10_000, stop: 9_000, target: 11_000, reason: "   ", weightPct: 10 })).toHaveLength(1);
    expect(preTradeChecklist({ price: 10_000, stop: 9_000, target: 11_000, reason: "x", weightPct: 10 })).toEqual([]);
  });
  it("flags a stop at or above the price, a target at or below it, a too-wide stop and an oversized weight", () => {
    expect(preTradeChecklist({ price: 10_000, stop: 10_000, target: 11_000, reason: "x" })[0]).toMatchObject({ tone: "bad", rule: "5.1 박용선·와인스타인" });
    expect(preTradeChecklist({ price: 10_000, stop: 9_000, target: 9_900, reason: "x" })[0]!.text).toContain("목표가가 매수가보다");
    const wide = preTradeChecklist({ price: 10_000, stop: 7_500, target: 15_000, reason: "x", weightPct: 10 });
    expect(wide).toEqual([expect.objectContaining({ tone: "warn", rule: "M4-01 캔들마스터" })]);
    expect(wide[0]!.text).toContain("25%");
    expect(preTradeChecklist({ price: 10_000, stop: 9_000, target: 12_000, reason: "x", weightPct: 35 })).toEqual([expect.objectContaining({ tone: "bad", rule: "M4-03 강영현" })]);
  });
});

describe("rMultiple", () => {
  it("measures the result in units of planned risk", () => {
    expect(rMultiple(10_000, 12_000, 9_000)).toBe(2);
    expect(rMultiple(10_000, 9_000, 9_000)).toBe(-1);
    expect(rMultiple(10_000, 9_500, 9_000)).toBe(-0.5);
    expect(rMultiple(10_000, 12_000, undefined)).toBeNull();
    expect(rMultiple(10_000, 12_000, 10_000)).toBeNull();
    expect(rMultiple(10_000, 12_000, 11_000)).toBeNull();
  });
});

describe("summarizeJournal R", () => {
  it("averages R over closed trades whose buy has a planned stop", () => {
    const s = summarizeJournal([
      entry("1", "2024-01-01", "BUY", 100, 1, { stop: 95 }), entry("2", "2024-01-02", "SELL", 110, 1),
      entry("3", "2024-01-03", "BUY", 100, 1), entry("4", "2024-01-04", "SELL", 90, 1), // 손절가 없음 → R 제외
      entry("5", "2024-01-05", "BUY", 100, 1, { stop: 90 }), entry("6", "2024-01-06", "SELL", 95, 1),
    ]);
    expect(s.rCount).toBe(2);
    expect(s.avgR).toBeCloseTo((2 + -0.5) / 2);
    expect(s.closed[0]!.rMultiple).toBeCloseTo(2);
    expect(s.closed[1]).not.toHaveProperty("rMultiple");
    expect(s.winRate).toBeCloseTo(1 / 3); // 기존 필드는 그대로
  });
  it("reports null when no trade has a stop", () => {
    const s = summarizeJournal([entry("1", "2024-01-01", "BUY", 100, 1), entry("2", "2024-01-02", "SELL", 110, 1)]);
    expect(s.avgR).toBeNull();
    expect(s.rCount).toBe(0);
  });
});

const cand = (code: string, score: number, entryPx: number, stop: number): DayTradeCandidate => ({
  code, name: code, market: "KOSPI", asOf: "2024-01-01", price: entryPx, changePct: 5, volume: 1, tradeValue: 1, volumeRatio: 3, score,
  entry: entryPx, stop, target: entryPx + 2 * (entryPx - stop), stopPct: ((entryPx - stop) / entryPx) * 100, targetPct: 0, netRR: 1.5, maxHoldDays: 3, notes: [],
});

describe("planWithCash exposure cap", () => {
  const cands = [cand("A", 80, 10_000, 9_700), cand("B", 70, 50_000, 48_000), cand("C", 65, 20_000, 19_500)];
  const params = { cash: 10_000_000, riskPct: 1, maxWeightPct: 30, maxPositions: 5, reservePct: 10 };
  it("keeps the old behavior when no cap is given", () => {
    const strip = (p: ReturnType<typeof planWithCash>) => JSON.parse(JSON.stringify(p));
    expect(strip(planWithCash(cands, { ...params, heldValue: 5_000_000 }))).toEqual(strip(planWithCash(cands, params)));
  });
  it("limits new buys so held value + new buys stay under the cap", () => {
    // (1,000만 + 400만) × 50% − 400만 = 300만
    const p = planWithCash(cands, { ...params, exposureCapPct: 50, heldValue: 4_000_000 });
    expect(p.spendable).toBeCloseTo(3_000_000);
    expect(p.used).toBeLessThanOrEqual(3_000_000);
    expect(p.items.length).toBeGreaterThan(0);
    expect(p.skipped.some((s) => s.reason === "국면별 투자 상한 도달")).toBe(true);
  });
  it("skips everything once the cap is already used up", () => {
    const p = planWithCash(cands, { ...params, exposureCapPct: 40, heldValue: 8_000_000 });
    expect(p.items).toHaveLength(0);
    expect(p.spendable).toBe(0);
    expect(p.skipped.map((s) => s.reason)).toEqual(Array(3).fill("국면별 투자 상한 도달"));
  });
  it("uses the reserve-based amount when the cap is looser", () => {
    const loose = planWithCash(cands, { ...params, exposureCapPct: 100 });
    expect(loose.spendable).toBeCloseTo(9_000_000);
  });
});

describe("paper journal fields", () => {
  const c: DayTradeCandidate = { ...cand("005930", 80, 10_000, 9_700), name: "삼성전자", target: 10_600, notes: [{ tone: "good", text: "거래량 폭증" }] };
  const item = { candidate: c, qty: 100, amount: 1_000_000, riskAmount: 30_000, weightPct: 10 };
  const mon = new Date("2024-01-08T01:30:00Z"); // 월 10:30 KST
  const costs = PAPER_COSTS.KR;

  it("records strategy, target, regime and weight on the buy", () => {
    const r = paperOpen(newPaperAccount(2_000_000), item, mon, marketClock("KR", mon), costs, "BULL", 4_000_000)!;
    expect(r.entry).toMatchObject({ strategy: PAPER_STRATEGY, target: 10_600, regime: "BULL", stop: 9_700 });
    expect(r.entry.weightPct).toBeCloseTo((100 * 10_010 / 4_000_000) * 100, 1); // 소수 둘째 자리 반올림
    expect(r.entry.meta!.regime).toBe("BULL");
    const noEq = paperOpen(newPaperAccount(2_000_000), item, mon, marketClock("KR", mon), costs)!;
    expect(noEq.entry.weightPct).toBeUndefined();
    expect(noEq.entry.regime).toBeNull();
  });

  const open = () => paperOpen(newPaperAccount(2_000_000), item, mon, marketClock("KR", mon), costs, "BULL")!.acct;
  it("records exit reason and R on the sell, keeping the review format", () => {
    const stop = paperCheckExits(open(), { "005930": 9_650 }, marketClock("KR", new Date("2024-01-08T02:00:00Z")), costs).entries[0]!;
    expect(stop).toMatchObject({ exitReason: "손절", strategy: PAPER_STRATEGY, target: 10_600 });
    expect(stop.rMultiple).toBeCloseTo((9_640 - 10_010) / (10_010 - 9_700), 2);
    expect(stop.review).toMatch(/^수수료·세금·슬리피지 반영 순손익 -?\d+(\.\d+)? \([+-]\d+\.\d{2}%\)$/);

    const tp = paperCheckExits(open(), { "005930": 10_700 }, marketClock("KR", new Date("2024-01-08T03:00:00Z")), costs).entries[0]!;
    expect(tp.exitReason).toBe("목표 도달");
    expect(tp.rMultiple).toBeCloseTo((10_689 - 10_010) / 310, 2);

    const timed = paperCheckExits(open(), { "005930": 10_100 }, marketClock("KR", new Date("2024-01-11T06:10:00Z")), costs).entries[0]!;
    expect(timed.exitReason).toBe("시간 청산");
  });

  it("todayPnl sums that day's auto sells, and the evaluation still reads the review", () => {
    const buy = paperOpen(newPaperAccount(2_000_000), item, mon, marketClock("KR", mon), costs, "BULL")!;
    const r = paperCheckExits(buy.acct, { "005930": 9_650 }, marketClock("KR", new Date("2024-01-08T02:00:00Z")), costs);
    const journal = [
      buy.entry, ...r.entries,
      entry("m1", "2024-01-08", "SELL", 1, 1, { review: "순손익 99999 (+1.00%)", source: "수동" }), // 수동 기록은 제외
      entry("o1", "2024-01-05", "SELL", 1, 1, { review: "수수료·세금·슬리피지 반영 순손익 5000 (+1.00%)", source: "자동(모의)" }), // 다른 날
    ];
    expect(todayPnl(journal, "2024-01-08")).toBeCloseTo(r.acct.realizedPnl, 1);
    expect(todayPnl(journal, "2024-01-05")).toBe(5000);
    expect(todayPnl(journal, "2024-01-09")).toBe(0);
    const t = paperTradesFromJournal(journal);
    expect(t[0]).toMatchObject({ exitReason: "손절", regime: "BULL" });
    expect(t[0]!.returnPct).toBeLessThan(0);
  });

  it("paperUnrealizedPnl is market value minus cost including the buy fee", () => {
    const acct = open();
    const held = { ...acct, positions: acct.positions.map((p) => ({ ...p, lastPrice: 10_200 })) };
    expect(paperUnrealizedPnl(held)).toBeCloseTo(100 * 10_200 - 100 * 10_010 * 1.00015);
    expect(paperUnrealizedPnl(newPaperAccount(1))).toBe(0);
  });

  it("feeds tradingGuards end to end: a big loss today blocks new entries", () => {
    const buy = paperOpen(newPaperAccount(2_000_000), { ...item, qty: 190 }, mon, marketClock("KR", mon), costs)!;
    const r = paperCheckExits(buy.acct, { "005930": 9_000 }, marketClock("KR", new Date("2024-01-08T02:00:00Z")), costs);
    const pnl = todayPnl(r.entries, "2024-01-08") + paperUnrealizedPnl(r.acct);
    const g = tradingGuards({ closedReturnsPct: [], todayPnl: pnl, equityStartOfDay: 2_000_000, riskPct: 1, maxWeightPct: 25 });
    expect(pnl / 2_000_000).toBeLessThan(-0.04);
    expect(g.blocked).toBe(true);
  });
});
