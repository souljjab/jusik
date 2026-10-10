import { describe, expect, it } from "vitest";
import {
  buildDailyReview,
  DEFAULT_PAPER_TRACKING,
  parseNetPnl,
  paperTrackingStatus,
  REVIEW_HEADERS,
  reviewToRows,
  type DailyReviewInput,
  type MarketRowLike,
} from "../src/review";
import { newPaperAccount, paperCheckExits, paperOpen, PAPER_COSTS } from "../src/paper";
import type { DayTradeCandidate } from "../src/daytrade";
import type { JournalEntry } from "../src/journal";
import type { MarketClock } from "../src/sessions";
import type { Candle, Market, Note } from "../src/types";

const DATE = "2024-03-15";

/** 평일 일봉. closes[k]가 k번째 봉 종가, 마지막 봉 날짜가 end */
function bars(closes: number[], end = DATE): Candle[] {
  const dates: string[] = [];
  let t = Date.parse(end);
  while (dates.length < closes.length) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) dates.unshift(new Date(t).toISOString().slice(0, 10));
    t -= 86_400_000;
  }
  return closes.map((c, k) => ({ date: dates[k]!, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 }));
}

/** 다음 평일 날짜 */
function nextWeekday(d: string): string {
  let t = Date.parse(d) + 86_400_000;
  while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const row = (code: string, changePct: number, tradeValue: number, market: Market = "KOSPI"): MarketRowLike => ({
  code, name: `종목${code}`, market, price: 10_000, changePct, volume: Math.round(tradeValue / 10_000), tradeValue,
});

function cand(code: string, score: number, notes: Note[] = [], extra: Partial<DayTradeCandidate> = {}): DayTradeCandidate {
  return {
    code, name: `후보${code}`, market: "KOSPI", asOf: DATE, price: 10_000, changePct: 5, volume: 100_000, tradeValue: 1e9, volumeRatio: 3, score,
    entry: 10_000, stop: 9_700, target: 10_600, stopPct: 3, targetPct: 6, netRR: 1.8, maxHoldDays: 3, notes, ...extra,
  };
}

const clock = (date: string, extra: Partial<MarketClock> = {}): MarketClock => ({
  date, minutes: 10 * 60, weekday: 3, isOpen: true, inEntryWindow: true, nearClose: false, justClosed: false, ...extra,
});

/** 실제 모의매매 함수로 매수→청산 기록을 만든다(복기란 형식이 paper.ts와 같도록) */
function paperRoundTrip(code: string, buyDate: string, sellDate: string, exitPrice: number, market: Market = "KOSPI"): JournalEntry[] {
  const region = market === "US" ? "US" : "KR";
  const costs = PAPER_COSTS[region];
  const c = cand(code, 70, [{ tone: "good", text: "거래량 3배" }], { market, asOf: buyDate });
  const opened = paperOpen(newPaperAccount(1e8), { candidate: c, qty: 10, amount: 100_000, riskAmount: 3_000, weightPct: 1 }, new Date(`${buyDate}T01:00:00Z`), clock(buyDate), costs)!;
  const closed = paperCheckExits(opened.acct, { [code]: exitPrice }, clock(sellDate), costs);
  return [opened.entry, ...closed.entries];
}

function baseInput(over: Partial<DailyReviewInput> = {}): DailyReviewInput {
  const kospi = bars(Array.from({ length: 30 }, (_, k) => 2000 + k * 10)); // 마지막 2290, 직전 2280, 20봉 전 2090
  return {
    date: DATE,
    region: "KR",
    indices: [{ name: "KOSPI", candles: kospi }],
    universe: [row("000001", 12, 5e10), row("000002", 8, 9e10), row("000003", -6, 2e10), row("000004", 3, 1e11), row("000005", -2, 3e10)],
    candidates: [cand("000002", 72, [{ tone: "good", text: "직전 20일 고점 돌파" }]), cand("000004", 61)],
    journal: [],
    regime: "BULL",
    ...over,
  };
}

describe("buildDailyReview — 지수 흐름", () => {
  it("computes the last bar change and the change vs 20 trading days ago", () => {
    const r = buildDailyReview(baseInput());
    const m = r.indexMoves[0]!;
    expect(m.name).toBe("KOSPI");
    expect(m.close).toBe(2290);
    expect(m.changePct).toBeCloseTo((2290 / 2280 - 1) * 100, 10);
    expect(m.vs20dPct).toBeCloseTo((2290 / 2090 - 1) * 100, 10);
    expect(m.asOf).toBe(DATE);
  });
  it("returns null for the 20-day change when there are not enough bars", () => {
    const r = buildDailyReview(baseInput({ indices: [{ name: "KOSDAQ", candles: bars([800, 790, 780]) }] }));
    expect(r.indexMoves[0]!.vs20dPct).toBeNull();
    expect(r.indexMoves[0]!.changePct).toBeLessThan(0);
  });
  it("lists an index without enough data as missing", () => {
    const r = buildDailyReview(baseInput({ indices: [{ name: "KOSDAQ", candles: bars([800]) }] }));
    expect(r.indexMoves).toHaveLength(0);
    expect(r.missing).toContain("지수(KOSDAQ)");
    expect(buildDailyReview(baseInput({ indices: [] })).missing).toContain("지수");
  });
});

describe("buildDailyReview — 특징주", () => {
  it("sorts gainers, losers and trade value leaders and caps them at topN", () => {
    const r = buildDailyReview(baseInput());
    expect(r.topGainers.map((x) => x.code)).toEqual(["000001", "000002", "000004"]);
    expect(r.topLosers.map((x) => x.code)).toEqual(["000003", "000005"]);
    expect(r.mostTraded.map((x) => x.code)).toEqual(["000004", "000002", "000001", "000005", "000003"]);
    const many = Array.from({ length: 12 }, (_, k) => row(String(100_000 + k), k + 1, (k + 1) * 1e9));
    const r2 = buildDailyReview(baseInput({ universe: many }));
    expect(r2.topGainers).toHaveLength(5);
    expect(r2.topGainers[0]!.changePct).toBe(12);
    expect(r2.topLosers).toHaveLength(0);
    expect(buildDailyReview(baseInput({ universe: many }), { topN: 3 }).mostTraded).toHaveLength(3);
  });
  it("keeps the first row when the same code appears twice", () => {
    const r = buildDailyReview(baseInput({ universe: [row("000001", 5, 1e9), { ...row("000001", 30, 1e12) }] }));
    expect(r.topGainers).toHaveLength(1);
    expect(r.topGainers[0]!.changePct).toBe(5);
  });
});

describe("buildDailyReview — 지역 필터", () => {
  it("drops other-region universe rows, candidates and journal entries", () => {
    const usTrip = paperRoundTrip("AAPL", DATE, DATE, 100, "US");
    const r = buildDailyReview(baseInput({
      universe: [row("000001", 3, 1e9), row("AAPL", 20, 1e12, "US")],
      candidates: [cand("000002", 70), cand("NVDA", 90, [], { market: "US" })],
      journal: usTrip,
    }));
    expect(r.topGainers.map((x) => x.code)).toEqual(["000001"]);
    expect(r.mostTraded.map((x) => x.code)).toEqual(["000001"]);
    expect(r.candidatesTop.map((x) => x.code)).toEqual(["000002"]);
    expect(r.paper).toEqual({ buys: 0, sells: 0, realizedPnl: 0, wins: 0, losses: 0 });

    const us = buildDailyReview(baseInput({ region: "US", indices: [], universe: [row("AAPL", 20, 1e12, "US")], candidates: [cand("NVDA", 90, [], { market: "US" })], journal: usTrip }));
    expect(us.topGainers.map((x) => x.code)).toEqual(["AAPL"]);
    expect(us.candidatesTop.map((x) => x.code)).toEqual(["NVDA"]);
    expect(us.paper.buys).toBe(1);
    expect(us.paper.sells).toBe(1);
  });
  it("ignores candidates from another day", () => {
    const r = buildDailyReview(baseInput({ candidates: [cand("000002", 70, [], { asOf: "2024-03-14" })] }));
    expect(r.candidatesTop).toHaveLength(0);
  });
});

describe("buildDailyReview — 모의매매 순손익", () => {
  it("parses the net P&L written by paperCheckExits", () => {
    const [, sell] = paperRoundTrip("005930", "2024-03-14", DATE, 10_600);
    const n = parseNetPnl(sell!.review);
    expect(n).not.toBeNull();
    expect(n!).toBeGreaterThan(0);
    expect(parseNetPnl("수수료·세금·슬리피지 반영 순손익 -1234.5 (-1.20%)")).toBe(-1234.5);
    expect(parseNetPnl("순손익 1,234 (+1.00%)")).toBe(1234);
    expect(parseNetPnl("메모만 있음")).toBeNull();
    expect(parseNetPnl(undefined)).toBeNull();
  });
  it("sums the day's automatic paper trades and counts wins and losses", () => {
    const win = paperRoundTrip("005930", "2024-03-14", DATE, 10_600); // 목표 도달
    const loss = paperRoundTrip("000660", "2024-03-14", DATE, 9_600); // 손절
    const todayBuy = paperRoundTrip("035420", DATE, DATE, 10_000).slice(0, 1); // 오늘 매수만
    const manual: JournalEntry = { id: "m", code: "005380", name: "수동", date: DATE, side: "SELL", price: 1, qty: 1, reason: "", review: "순손익 999999 (+1%)", source: "수동" };
    const r = buildDailyReview(baseInput({ journal: [...win, ...loss, ...todayBuy, manual] }));
    const expected = Math.round((parseNetPnl(win[1]!.review)! + parseNetPnl(loss[1]!.review)!) * 100) / 100;
    expect(r.paper).toEqual({ buys: 1, sells: 2, realizedPnl: expected, wins: 1, losses: 1 });
  });
  it("flags sells whose review could not be parsed", () => {
    const sell: JournalEntry = { id: "s", code: "005930", name: "삼성전자", date: DATE, side: "SELL", price: 1, qty: 1, reason: "손절", review: "직접 고침", source: "자동(모의)" };
    const r = buildDailyReview(baseInput({ journal: [sell] }));
    expect(r.paper.sells).toBe(1);
    expect(r.paper.wins + r.paper.losses).toBe(0);
    expect(r.missing).toContain("모의 매도 손익 1건");
  });
});

describe("buildDailyReview — 신고가·빠진 항목·코멘트", () => {
  it("always lists sector and earnings as missing", () => {
    const r = buildDailyReview(baseInput());
    expect(r.missing).toEqual(expect.arrayContaining(["섹터", "실적", "52주 신고가"]));
    expect(r.rule).toBe("M5-01 김연수");
    expect(buildDailyReview(baseInput({ universe: [] })).missing).toContain("특징주");
  });
  it("takes new highs from candidate notes and from 52-week candles", () => {
    const flat = bars(Array.from({ length: 260 }, () => 100));
    const up = flat.map((c, k) => (k === flat.length - 1 ? { ...c, close: 110, high: 112 } : c));
    const below = flat.map((c, k) => (k === 5 ? { ...c, high: 200 } : c)); // 250거래일 창 밖의 더 높은 고점은 무시
    const inside = flat.map((c, k) => (k === flat.length - 100 ? { ...c, high: 200 } : k === flat.length - 1 ? { ...c, high: 150 } : c));
    const r = buildDailyReview(baseInput({
      candidates: [
        cand("000002", 72, [{ tone: "good", text: "직전 20일 고점 돌파" }]),
        cand("000007", 60, [{ tone: "warn", text: "두 봉 고점 돌파 시 무효" }]),
      ],
      candlesByCode: { "000004": up, "000005": below.map((c, k) => (k === below.length - 1 ? { ...c, high: 150 } : c)), "000006": inside, AAPL: up },
    }));
    expect(r.newHighs).toEqual([
      { code: "000002", name: "후보000002", basis: "직전 20일 고점 돌파" },
      { code: "000004", name: "종목000004", basis: "52주 신고가" },
      { code: "000005", name: "종목000005", basis: "52주 신고가" },
    ]);
    expect(r.missing).not.toContain("52주 신고가");
  });
  it("writes a comment with the key numbers", () => {
    const win = paperRoundTrip("005930", "2024-03-14", DATE, 10_600);
    const r = buildDailyReview(baseInput({ journal: win, posture: "공격" }));
    const pnl = parseNetPnl(win[1]!.review)!;
    expect(r.comment).toContain(`KOSPI +${r.indexMoves[0]!.changePct.toFixed(2)}%`);
    expect(r.comment).toContain("올랐어요");
    expect(r.comment).toContain("시장 국면은 강세예요");
    expect(r.comment).toContain("운용 태도는 공격이에요");
    expect(r.comment).toContain("단타 후보는 2개");
    expect(r.comment).toContain("후보000002 72점");
    expect(r.comment).toContain(`+${Math.round(pnl).toLocaleString("en-US")}원이에요`);
    expect(r.comment).toContain("1승 0패");
    expect(r.comment).toContain("섹터·실적");
  });
  it("describes mixed and missing data", () => {
    const down = bars([1000, 990]);
    const r = buildDailyReview(baseInput({ indices: [{ name: "KOSPI", candles: bars([100, 101]) }, { name: "KOSDAQ", candles: down }], candidates: [], regime: "NEUTRAL" }));
    expect(r.comment).toContain("엇갈렸어요");
    expect(r.comment).toContain("시장 국면은 중립이에요");
    expect(r.comment).toContain("단타 후보는 없어요");
    expect(r.comment).toContain("모의매매 기록은 없어요");
  });
});

describe("buildDailyReview — 미래 참조 없음", () => {
  it("gives the same review when data after the date changes", () => {
    const input = baseInput({ journal: paperRoundTrip("005930", "2024-03-14", DATE, 10_600) });
    const a = buildDailyReview(input);
    const next = nextWeekday(DATE);
    const later = buildDailyReview({
      ...input,
      indices: input.indices.map((ix) => ({ ...ix, candles: [...ix.candles, { date: next, open: 1, high: 1, low: 1, close: 1, volume: 1 }] })),
      candidates: [...input.candidates, cand("000009", 99, [], { asOf: next })],
      journal: [...input.journal, ...paperRoundTrip("000660", next, next, 9_000)],
    });
    expect(later).toEqual(a);
  });
  it("judges 52-week highs only with bars up to the date", () => {
    const flat = bars(Array.from({ length: 260 }, () => 100));
    const up = flat.map((c, k) => (k === flat.length - 1 ? { ...c, high: 112 } : c));
    const base = baseInput({ candidates: [], candlesByCode: { "000004": up } });
    const a = buildDailyReview(base);
    const b = buildDailyReview({ ...base, candlesByCode: { "000004": [...up, { date: nextWeekday(DATE), open: 1, high: 500, low: 1, close: 1, volume: 1 }] } });
    expect(b.newHighs).toEqual(a.newHighs);
    expect(a.newHighs.map((h) => h.code)).toEqual(["000004"]);
  });
});

describe("reviewToRows", () => {
  it("turns a review into two-column rows", () => {
    const r = { ...buildDailyReview(baseInput()), userComment: "내일은 쉬어요" };
    const rows = reviewToRows(r);
    expect(REVIEW_HEADERS).toEqual(["항목", "내용"]);
    expect(rows.every((x) => x.length === 2)).toBe(true);
    const get = (k: string) => rows.filter((x) => x[0] === k).map((x) => x[1]);
    expect(get("날짜")).toEqual([DATE]);
    expect(get("지역")).toEqual(["국내"]);
    expect(get("특징주(상승)")).toHaveLength(3);
    expect(String(get("특징주(거래대금)")[0])).toContain("1,000억 원");
    expect(get("섹터 흐름")[0]).toContain("데이터 없음");
    expect(get("실적")[0]).toContain("데이터 없음");
    expect(get("신고가")[0]).toContain("직전 20일 고점 돌파");
    expect(get("코멘트")).toEqual([r.comment]);
    expect(get("메모")).toEqual(["내일은 쉬어요"]);
    expect(get("근거")).toEqual(["M5-01 김연수"]);
  });
  it("writes 없음 for empty lists", () => {
    const rows = reviewToRows(buildDailyReview(baseInput({ universe: [], candidates: [] })));
    expect(rows.find((x) => x[0] === "특징주(하락)")![1]).toBe("없음");
    expect(rows.find((x) => x[0] === "단타 후보")![1]).toBe("없음");
  });
});

describe("paperTrackingStatus", () => {
  /** start부터 n건의 모의 왕복 거래(하루 간격, 이익이면 목표가 위, 손실이면 손절가 아래) */
  function history(start: string, n: number, win: (k: number) => boolean): JournalEntry[] {
    const out: JournalEntry[] = [];
    let d = start;
    for (let k = 0; k < n; k++) {
      const sell = nextWeekday(d);
      out.push(...paperRoundTrip(String(100_000 + k), d, sell, win(k) ? 10_700 : 9_600));
      d = sell;
    }
    return out;
  }

  it("reports no record yet", () => {
    const s = paperTrackingStatus([], DATE);
    expect(s).toMatchObject({ startedAt: null, days: 0, closedTrades: 0, ready: false });
    expect(s.note.rule).toBe("M5-02 캔들마스터");
  });
  it("asks for at least 90 days before going live", () => {
    const j = history("2024-03-01", 5, () => true);
    const s = paperTrackingStatus(j, DATE);
    expect(s.startedAt).toBe("2024-03-01");
    expect(s.days).toBe(15);
    expect(s.ready).toBe(false);
    expect(s.message).toContain("모의투자 15일째예요");
    expect(s.message).toContain("최소 3개월(90일)");
    expect(s.note).toMatchObject({ tone: "info", rule: "M5-02 캔들마스터" });
  });
  it("is ready after 90 days with 30+ closed trades and a positive expectancy", () => {
    const j = history("2024-01-02", 40, (k) => k % 3 !== 0);
    const s = paperTrackingStatus(j, "2024-04-30");
    expect(s.days).toBeGreaterThanOrEqual(DEFAULT_PAPER_TRACKING.minDays);
    expect(s.closedTrades).toBe(40);
    expect(s.expectancyPct!).toBeGreaterThan(0);
    expect(s.ready).toBe(true);
    expect(s.message).toContain("소액 실전 검토 가능");
    expect(s.note.tone).toBe("good");
  });
  it("gives the reason when 90 days passed but it is not ready", () => {
    const few = paperTrackingStatus(history("2024-01-02", 10, () => true), "2024-04-30");
    expect(few.ready).toBe(false);
    expect(few.message).toContain("청산 거래가 10건");
    const losing = paperTrackingStatus(history("2024-01-02", 40, (k) => k % 4 === 0), "2024-04-30");
    expect(losing.ready).toBe(false);
    expect(losing.expectancyPct!).toBeLessThan(0);
    expect(losing.message).toContain("기대값");
    expect(losing.note.tone).toBe("warn");
  });
  it("ignores manual entries, other regions when asked, and records after today", () => {
    const j = history("2024-03-01", 3, () => true);
    const manual: JournalEntry = { id: "m", code: "005930", name: "수동", date: "2023-01-02", side: "BUY", price: 1, qty: 1, reason: "", source: "수동" };
    const us = paperRoundTrip("AAPL", "2023-06-01", "2023-06-02", 100, "US");
    expect(paperTrackingStatus([...j, manual], DATE).startedAt).toBe("2024-03-01");
    expect(paperTrackingStatus([...j, ...us], DATE, { region: "KR" }).startedAt).toBe("2024-03-01");
    expect(paperTrackingStatus([...j, ...us], DATE).startedAt).toBe("2023-06-01");
    const before = paperTrackingStatus(j, "2024-03-05");
    const withFuture = paperTrackingStatus([...j, ...history("2024-03-20", 5, () => false)], "2024-03-05");
    expect(withFuture).toEqual(before);
  });
});
