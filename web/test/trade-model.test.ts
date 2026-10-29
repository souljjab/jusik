import { describe, expect, it } from "vitest";
import { EXPOSURE_CAP_REASON, newPaperAccount, type DayTradeCandidate, type JournalEntry, type PaperPosition, type Plan, type ServerState, type Settings } from "@jusik/shared";
import {
  accountBase, accountView, capHit, currenciesShown, distPct, holdingPnl, manualHoldings, paperLossStreak, planCashBase, planRisk,
  positionView, reasonCounts, ruleLines,
} from "../src/screens/trade/tradeModel";

let seq = 0;
function je(p: Partial<JournalEntry> & Pick<JournalEntry, "code" | "side" | "price" | "qty" | "date">): JournalEntry {
  return { id: `e${++seq}`, name: p.code, reason: "", ...p };
}

const settings: Settings = {
  depositKRW: 10_000_000, depositUSD: 7_000, riskPct: 1, maxWeightPct: 30, maxPositions: 3, reservePct: 10, minScore: 55,
  minTradeValueKRW: 1e9, minTradeValueUSD: 5e6, scanIntervalMin: 10, monitorIntervalSec: 60, paperEnabled: true,
  markets: { KOSPI: true, KOSDAQ: false, US: false }, maxScanPerMarket: 40, postureCaps: { ATTACK: 90, NEUTRAL: 60, DEFENSE: 30 },
  dailyLossLimitPct: 2, maxConsecutiveLosses: 3, ismManual: null, minuteMode: "filter",
};

const pos = (p: Partial<PaperPosition> = {}): PaperPosition => ({
  code: "005930", name: "삼성전자", openedAt: "2026-10-05T01:00:00Z", entryDate: "2026-10-05", entryPrice: 10_000, qty: 10,
  stop: 9_000, target: 12_000, maxHoldDays: 5, cost: 100_015, lastPrice: 10_500, reason: "", ...p,
});

describe("positionView", () => {
  it("평가손익은 수수료 포함 원가 기준, 손절·목표 거리와 보유 일수", () => {
    const v = positionView(pos(), "2026-10-08", 1_000_000);
    expect(v.last).toBe(10_500);
    expect(v.pnl).toBeCloseTo(4_985, 6);
    expect(v.pnlPct).toBeCloseTo((4_985 / 100_015) * 100, 6);
    expect(v.leftToStopPct).toBeCloseTo((1_500 / 10_500) * 100, 6);
    expect(v.toTargetPct).toBeCloseTo((1_500 / 10_500) * 100, 6);
    expect(v.nearStop).toBe(false);
    expect(v.heldDays).toBe(3);
    expect(v.weightPct).toBeCloseTo(10.5, 6);
  });
  it("손절가 2% 안쪽이면 근접, 최근가가 없으면 진입가", () => {
    expect(positionView(pos({ lastPrice: 9_150 }), "2026-10-05", 0).nearStop).toBe(true);
    const v = positionView(pos({ lastPrice: undefined }), "2026-10-05", 0);
    expect(v.last).toBe(10_000);
    expect(v.weightPct).toBeNull();
    expect(v.heldDays).toBe(0);
  });
});

describe("accountView", () => {
  it("총자산·보유 평가액·승률", () => {
    const acct = { ...newPaperAccount(500_000), positions: [pos()], realizedPnl: 12_000, closed: 4, wins: 1 };
    const a = accountView(acct, "KRW", "2026-10-06");
    expect(a.equity).toBe(500_000 + 105_000);
    expect(a.heldValue).toBe(105_000);
    expect(a.winRate).toBe(0.25);
    expect(a.unrealized).toBeCloseTo(4_985, 6);
    expect(accountView(newPaperAccount(1), "USD", "2026-10-06").winRate).toBeNull();
  });
});

describe("manualHoldings", () => {
  it("직접 쓴 기록만 선입선출로 남은 수량과 평균 단가를 낸다", () => {
    const journal = [
      je({ code: "005930", name: "삼성전자", side: "BUY", price: 100, qty: 10, date: "2026-10-01", stop: 90 }),
      je({ code: "005930", name: "삼성전자", side: "BUY", price: 110, qty: 10, date: "2026-10-02", stop: 95, target: 130, strategy: "2단계 돌파" }),
      je({ code: "005930", name: "삼성전자", side: "SELL", price: 120, qty: 15, date: "2026-10-03" }),
      je({ code: "000660", name: "SK하이닉스", side: "BUY", price: 200, qty: 5, date: "2026-10-02", source: "자동(모의)" }),
      je({ code: "AAPL", name: "Apple", side: "BUY", price: 200.5, qty: 2, date: "2026-10-04", source: "수동" }),
    ];
    const { holdings, oversold } = manualHoldings(journal);
    expect(oversold).toEqual([]);
    expect(holdings.map((h) => h.code)).toEqual(["AAPL", "005930"]);
    const s = holdings.find((h) => h.code === "005930")!;
    expect(s.qty).toBe(5);
    expect(s.avgPrice).toBe(110);
    expect(s.since).toBe("2026-10-02");
    expect(s.stop).toBe(95);
    expect(s.target).toBe(130);
    expect(s.strategy).toBe("2단계 돌파");
    const a = holdings.find((h) => h.code === "AAPL")!;
    expect(a.currency).toBe("USD");
    expect(a.cost).toBeCloseTo(401, 6);
  });
  it("다 판 종목은 빠지고, 보유보다 많이 판 기록은 알려 준다", () => {
    const { holdings, oversold } = manualHoldings([
      je({ code: "035420", side: "BUY", price: 100, qty: 3, date: "2026-10-01" }),
      je({ code: "035420", side: "SELL", price: 100, qty: 5, date: "2026-10-02" }),
    ]);
    expect(holdings).toEqual([]);
    expect(oversold).toEqual(["035420"]);
  });
  it("같은 날 매도 후 재매수는 기록 순서대로 새 매수로 본다", () => {
    const { holdings } = manualHoldings([
      je({ code: "035420", side: "BUY", price: 100, qty: 3, date: "2026-10-01" }),
      je({ code: "035420", side: "SELL", price: 90, qty: 3, date: "2026-10-02" }),
      je({ code: "035420", side: "BUY", price: 80, qty: 2, date: "2026-10-02" }),
    ]);
    expect(holdings[0]!.qty).toBe(2);
    expect(holdings[0]!.avgPrice).toBe(80);
  });
});

describe("holdingPnl", () => {
  it("현재가가 있을 때만 평가한다", () => {
    const h = manualHoldings([je({ code: "005930", side: "BUY", price: 100, qty: 10, date: "2026-10-01", stop: 98 })]).holdings[0]!;
    expect(holdingPnl(h, null)).toEqual({ value: null, pnl: null, pct: null, leftToStopPct: null });
    const r = holdingPnl(h, 99);
    expect(r.pnl).toBe(-10);
    expect(r.pct).toBeCloseTo(-1, 6);
    expect(r.leftToStopPct).toBeCloseTo((1 / 99) * 100, 6);
  });
});

describe("연속 손실", () => {
  const meta = { score: 70, volumeRatio: 2, changePct: 4, stopPct: 3, market: "KOSPI", regime: null };
  const auto = (code: string, buyDate: string, sellDate: string, buy: number, sell: number): JournalEntry[] => [
    je({ code, side: "BUY", price: buy, qty: 1, date: buyDate, source: "자동(모의)", meta }),
    je({ code, side: "SELL", price: sell, qty: 1, date: sellDate, source: "자동(모의)", reason: "손절" }),
  ];
  it("모의 자동매매: 지역별로 끝에서부터 이어진 손실", () => {
    const journal = [
      ...auto("005930", "2026-10-01", "2026-10-02", 100, 110),
      ...auto("000660", "2026-10-02", "2026-10-05", 100, 95),
      ...auto("035420", "2026-10-05", "2026-10-06", 100, 99),
      ...auto("AAPL", "2026-10-05", "2026-10-06", 100, 120),
    ];
    expect(paperLossStreak(journal, "KR")).toBe(2);
    expect(paperLossStreak(journal, "US")).toBe(0);
  });
});

describe("계획", () => {
  const cand = (code: string) => ({ code, name: code }) as DayTradeCandidate;
  const plan: Plan = {
    items: [
      { candidate: cand("A"), qty: 1, amount: 100, riskAmount: 30, weightPct: 1 },
      { candidate: cand("B"), qty: 1, amount: 100, riskAmount: 20, weightPct: 1 },
    ],
    skipped: [
      { candidate: cand("C"), reason: "이미 보유 중" },
      { candidate: cand("D"), reason: EXPOSURE_CAP_REASON },
      { candidate: cand("E"), reason: EXPOSURE_CAP_REASON },
    ],
    spendable: 1000, used: 200, remainingCash: 800,
  };
  it("제외 사유 개수와 상한 도달, 손실 합계", () => {
    expect(reasonCounts(plan)).toEqual([[EXPOSURE_CAP_REASON, 2], ["이미 보유 중", 1]]);
    expect(capHit(plan)).toBe(true);
    expect(capHit({ skipped: [] })).toBe(false);
    expect(planRisk(plan)).toBe(50);
    expect(distPct(100, 92)).toBeCloseTo(-8, 6);
    expect(distPct(0, 92)).toBeNull();
  });
  it("기준 현금: 모의매매를 켜면 모의계좌, 끄면 예수금", () => {
    const st = { settings, paper: { KRW: { ...newPaperAccount(3_000_000), positions: [pos()] }, USD: newPaperAccount(7_000) } };
    expect(planCashBase(st, "KRW")).toEqual({ cash: 3_000_000, label: "모의계좌 현금", snapshot: false });
    expect(accountBase(st, "KRW")).toBe(3_000_000 + 105_000);
    const off = { ...st, settings: { ...settings, paperEnabled: false } };
    expect(planCashBase(off, "USD")).toEqual({ cash: 7_000, label: "예수금", snapshot: false });
    expect(accountBase(off, "KRW")).toBe(10_000_000);
  });
});

describe("currenciesShown", () => {
  const base = { settings, paper: { KRW: newPaperAccount(1), USD: newPaperAccount(1) }, latestScan: null } as Pick<ServerState, "settings" | "paper" | "latestScan">;
  it("스캔하는 시장이나 보유가 있는 통화만", () => {
    expect(currenciesShown(base)).toEqual(["KRW"]);
    expect(currenciesShown({ ...base, paper: { ...base.paper, USD: { ...newPaperAccount(1), positions: [pos({ code: "AAPL" })] } } })).toEqual(["KRW", "USD"]);
    expect(currenciesShown({ ...base, settings: { ...settings, markets: { KOSPI: false, KOSDAQ: false, US: true } } })).toEqual(["USD"]);
    expect(currenciesShown({ ...base, settings: { ...settings, markets: { KOSPI: false, KOSDAQ: false, US: false } } })).toEqual(["KRW"]);
  });
});

describe("ruleLines", () => {
  it("꺼진 한도는 '꺼짐'", () => {
    const lines = ruleLines({ ...settings, dailyLossLimitPct: 0, maxConsecutiveLosses: 0 }, (n, c) => `${c}${n}`);
    expect(lines.find((l) => l.label === "일일 손실 한도")!.value).toBe("꺼짐");
    expect(lines.find((l) => l.label === "연속 손실 휴식")!.value).toBe("꺼짐");
    expect(lines.find((l) => l.label === "국면별 비중 상한")!.value).toBe("공격 90% · 중립 60% · 방어 30%");
    expect(lines.find((l) => l.label === "예수금")!.value).toBe("KRW10000000 · USD7000");
  });
});
