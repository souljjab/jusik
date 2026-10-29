import { describe, expect, it } from "vitest";
import { MANUAL_STRATEGY, newPaperAccount, type DayTradeCandidate, type GuardResult, type JournalEntry, type Plan, type ScanResult, type ServerState, type Settings } from "@jusik/shared";
import { planEntries } from "../src/screens/trade/PlanTab";
import {
  amountText, buyMoreRequest, manualHoldings, manualNearStopCount, manualStreakNotes, paperAsOf, payoffText, planCashBase, ruleLines, sellRequest, streakMeterText,
} from "../src/screens/trade/tradeModel";

/* 매매 화면 리뷰 수정(R029·R030·R031·R037·R038·R040·R041·R111·R135)의 순수 계산 */

let seq = 0;
function je(p: Partial<JournalEntry> & Pick<JournalEntry, "code" | "side" | "price" | "qty" | "date">): JournalEntry {
  return { id: `t${++seq}`, name: p.code, reason: "", ...p };
}

const settings: Settings = {
  depositKRW: 10_000_000, depositUSD: 7_000, riskPct: 1, maxWeightPct: 30, maxPositions: 3, reservePct: 10, minScore: 55,
  minTradeValueKRW: 1e9, minTradeValueUSD: 5e6, scanIntervalMin: 10, monitorIntervalSec: 60, paperEnabled: true,
  markets: { KOSPI: true, KOSDAQ: false, US: false }, maxScanPerMarket: 40, postureCaps: { ATTACK: 90, NEUTRAL: 60, DEFENSE: 30 },
  dailyLossLimitPct: 2, maxConsecutiveLosses: 3, ismManual: null, minuteMode: "filter",
};

describe("계획 당시 현금(R038)", () => {
  const st = { settings, paper: { KRW: newPaperAccount(8_000_000), USD: newPaperAccount(5_623.08) } };
  it("계획에 그때 현금이 있으면 지금 현금 대신 그 값을 '계획 당시 현금'으로", () => {
    expect(planCashBase(st, "USD", { cash: 7_000 })).toEqual({ cash: 7_000, label: "계획 당시 현금", snapshot: true });
  });
  it("이전 저장분(plan.cash 없음)만 지금 값", () => {
    expect(planCashBase(st, "KRW", {})).toEqual({ cash: 8_000_000, label: "모의계좌 현금", snapshot: false });
    expect(planCashBase({ ...st, settings: { ...settings, paperEnabled: false } }, "USD", {})).toEqual({ cash: 7_000, label: "예수금", snapshot: false });
  });
});

describe("모의계좌 시세 기준 시각(R037)", () => {
  const scan = { at: "2026-10-26T01:11:00.000Z" } as ScanResult;
  it("서버가 현재가를 받은 때, 없으면 마지막 스캔, 둘 다 없으면 없음(받은 시각은 쓰지 않는다)", () => {
    const priced = { ...newPaperAccount(1), pricedAt: "2026-10-26T01:20:00.000Z" };
    expect(paperAsOf({ paper: { KRW: priced, USD: newPaperAccount(1) }, latestScan: scan }, "KRW")).toBe("2026-10-26T01:20:00.000Z");
    expect(paperAsOf({ paper: { KRW: priced, USD: newPaperAccount(1) }, latestScan: scan }, "USD")).toBe(scan.at);
    expect(paperAsOf({ paper: { KRW: newPaperAccount(1), USD: newPaperAccount(1) }, latestScan: null }, "KRW")).toBeNull();
  });
});

describe("직접 보유 주문 요청(R040·R135)", () => {
  const [h] = manualHoldings([je({ code: "000660", name: "SK하이닉스", side: "BUY", price: 150_000, qty: 2, date: "2026-10-01", stop: 140_000, target: 100_000, strategy: "2단계 돌파" })]).holdings;
  it("이미 손절가 아래면 예전 손절가를 넘기지 않는다(시트가 잘못된 손절가·수량 0으로 열리지 않게)", () => {
    const r = buyMoreRequest({ h: h!, q: { price: 103_041 } });
    expect(r.stop).toBeUndefined();
    expect(r.target).toBeUndefined(); // 목표가도 지금 가격보다 낮으면 넘기지 않는다
    expect(r.price).toBe(103_041);
    expect(r.side).toBe("BUY");
  });
  it("손절가가 지금 가격보다 낮으면 그대로", () => {
    expect(buyMoreRequest({ h: h!, q: { price: 150_000 } }).stop).toBe(140_000);
    // 현재가를 못 받으면 평균 단가 기준
    expect(buyMoreRequest({ h: h! }).stop).toBe(140_000);
  });
  it("전략은 산 기록의 전략, 없으면 '직접 판단'(이전의 '직접 매매'가 아니다)", () => {
    expect(sellRequest({ h: h!, q: { price: 100 } }).strategy).toBe("2단계 돌파");
    const [plain] = manualHoldings([je({ code: "005930", side: "BUY", price: 100, qty: 1, date: "2026-10-01" })]).holdings;
    expect(buyMoreRequest({ h: plain! }).strategy).toBe(MANUAL_STRATEGY);
    expect(sellRequest({ h: plain! }).strategy).toBe(MANUAL_STRATEGY);
  });
});

describe("직접 보유 손절가 근접 개수(R041)", () => {
  const { holdings } = manualHoldings([
    je({ code: "000660", side: "BUY", price: 150_000, qty: 1, date: "2026-10-01", stop: 140_000 }),
    je({ code: "373220", side: "BUY", price: 400_000, qty: 1, date: "2026-10-01", stop: 390_000 }),
    je({ code: "005930", side: "BUY", price: 70_000, qty: 1, date: "2026-10-01", stop: 60_000 }),
    je({ code: "035420", side: "BUY", price: 200_000, qty: 1, date: "2026-10-01" }),
  ]);
  it("손절가 아래·2% 안쪽만 세고, 현재가를 못 받았거나 손절가가 없으면 세지 않는다", () => {
    const q = { "000660": { price: 103_041 }, "373220": { price: 395_000 }, "005930": { price: 72_000 }, "035420": { price: 150_000 } };
    expect(manualNearStopCount(holdings, q)).toBe(2);
    expect(manualNearStopCount(holdings, {})).toBe(0);
  });
});

describe("연속 손실 휴식 문구(R030·R039)", () => {
  it("서버가 쉬게 하는 동안만 '휴식 중', 쉬는 기간이 지나면 '휴식 끝남'", () => {
    expect(streakMeterText(3, 3, true)).toEqual({ nearText: "휴식 중", overText: "휴식 중" });
    expect(streakMeterText(3, 3, false)).toEqual({ nearText: "휴식 끝남", overText: "휴식 끝남" });
    expect(streakMeterText(9, 10, false).nearText).toBe("휴식 기준 근접");
  });
  it("직접 매매: 쉬는 기간이 지난 뒤에만 '규모를 줄이세요' 메모", () => {
    expect(manualStreakNotes({ streak: 3, resting: true }, 3)).toEqual([]);
    expect(manualStreakNotes({ streak: 2, resting: false }, 3)).toEqual([]);
    expect(manualStreakNotes({ streak: 3, resting: false }, 0)).toEqual([]);
    const [n] = manualStreakNotes({ streak: 4, resting: false }, 3);
    expect(n!.tone).toBe("warn");
    expect(n!.text).toContain("규모를 줄이세요");
  });
});

describe("서식(R111)", () => {
  it("금액은 '199만 원'처럼 만 단위 뒤를 띄우고, 만 아래는 붙인다", () => {
    expect(amountText(1_985_295, "KRW")).toBe("199만 원");
    expect(amountText(123_000_000, "KRW")).toBe("1.2억 원");
    expect(amountText(5_000, "KRW")).toBe("5,000원");
    expect(amountText(1_327.3, "USD")).toBe("$1,327");
  });
  it("순손익비는 소수 첫째 자리", () => {
    expect(payoffText(2.456)).toBe("2.5");
    expect(payoffText(2)).toBe("2.0");
    expect(payoffText(NaN)).toBe("-");
  });
  it("일일 손실 한도는 음수 한도로(fmtRatio(-x))", () => {
    expect(ruleLines(settings, () => "").find((l) => l.label === "일일 손실 한도")!.value).toBe("-2%");
  });
});

describe("오늘의 계획 잠금은 서버가 지금 계산한 가드(R029·R031·R073)", () => {
  const cand = (code: string): DayTradeCandidate =>
    ({
      code, name: code, market: "KOSPI", asOf: "", price: 10_000, changePct: 4, volume: 1, tradeValue: 1, volumeRatio: 3, score: 70,
      entry: 10_000, stop: 9_500, target: 11_000, stopPct: 5, targetPct: 10, netRR: 2, maxHoldDays: 3, notes: [],
    }) satisfies DayTradeCandidate;
  const plan: Plan = { items: [{ candidate: cand("005930"), qty: 10, amount: 100_000, riskAmount: 5_000, weightPct: 1 }], skipped: [], spendable: 1e6, used: 1e5, remainingCash: 9e5, cash: 1e7 };
  const stale: GuardResult = { blocked: true, notes: [{ tone: "bad", text: "오늘 손실이 3%로 하루 한도(2%)에 닿았어요. 오늘은 신규 진입을 멈춰요." }], reasons: ["dailyLoss"] };
  const base = {
    settings, paper: { KRW: newPaperAccount(1e7), USD: newPaperAccount(7_000) },
    latestScan: { at: "2026-10-23T06:20:00.000Z", plans: { KRW: plan }, guards: { KRW: stale }, candidates: [], executed: [], minuteSkips: [] } as unknown as ScanResult,
  } as unknown as ServerState;

  it("어제 스캔의 잠금이 남아 있어도 서버의 지금 가드가 풀려 있으면 잠그지 않는다", () => {
    const [x] = planEntries({ ...base, guards: { KRW: { blocked: false, notes: [] } } });
    expect(x!.blocked).toBe(false);
    expect(x!.releaseText).toBeNull();
  });
  it("연속 손실 휴식은 서버 문장으로 풀리는 때를 말한다('다음 거래일에 풀려요'가 아니다)", () => {
    const rest: GuardResult = {
      blocked: true, reasons: ["streak"],
      notes: [
        { tone: "bad", text: "최근 3번 연속 손실이에요. 잠시 쉬고, 다시 시작할 때는 규모를 줄여요." },
        { tone: "info", text: "마지막 손실이 난 날(10.23(금))과 그다음 거래일(10.26(월))까지 쉬어요." },
      ],
    };
    const [x] = planEntries({ ...base, guards: { KRW: rest } });
    expect(x!.blocked).toBe(true);
    expect(x!.releaseText).toBe("마지막 손실이 난 날(10.23(금))과 그다음 거래일(10.26(월))까지 쉬어요.");
    expect(x!.blockReason).toContain("연속 손실");
  });
  it("일일 손실 한도는 '다음 거래일에 풀려요.'", () => {
    const [x] = planEntries({ ...base, guards: { KRW: stale } });
    expect(x!.releaseText).toBe("다음 거래일에 풀려요.");
  });
});
