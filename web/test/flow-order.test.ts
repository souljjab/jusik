import { describe, expect, it } from "vitest";
import { dayTradeEvidence, MANUAL_STRATEGY, newPaperAccount, PAPER_STRATEGY, type DayTradeCandidate, type GuardResult, type JournalEntry, type PaperPosition, type ServerState, type Settings } from "@jusik/shared";
import { defaultBuyQty, maxQtyByCap } from "../src/features/orderMath";
import { extraCheckNotes, journalStrategyFor, priceToInput } from "../src/features/OrderReviewSheet";
import { guardOf, guardView, manualStreakOf, nearStopSentence, riskSummary, stopDistanceText } from "../src/features/risk/riskSummary";
import { candidateLabel, toRows } from "../src/features/candidates/CandidateList";

// 리뷰 수정(흐름): 주문 검토 시트·리스크 요약·후보 목록의 계산

const settings = { maxWeightPct: 30, riskPct: 1, dailyLossLimitPct: 4, maxConsecutiveLosses: 3, paperEnabled: true, postureCaps: { ATTACK: 80, NEUTRAL: 50, DEFENSE: 20 } } as Settings;
const state = (over: Partial<ServerState> = {}): ServerState =>
  ({ settings, latestScan: null, paper: { KRW: newPaperAccount(10_000_000), USD: newPaperAccount(7_000) }, ...over }) as ServerState;
const pos = (code: string, last: number, stop: number): PaperPosition => ({
  code, name: `종목${code}`, openedAt: "", entryDate: "2024-03-14", entryPrice: 200_000, qty: 1, stop, target: 250_000, maxHoldDays: 3, cost: 200_000, lastPrice: last, reason: "",
});

describe("default buy quantity (R052·R076·R136)", () => {
  it("counts shares already held against the weight cap", () => {
    // 1천만 원, 비중 30% = 300만 원 / 8만 원 = 37주, 이미 5주 → 32주까지. 손실 기준은 10만 원 / 2천 원 = 50주
    expect(defaultBuyQty({ capital: 10_000_000, riskPct: 1, maxWeightPct: 30, price: 80_000, stop: 78_000, held: 5 })).toEqual({ qty: 32, overRisk: false });
    expect(maxQtyByCap({ capital: 10_000_000, maxWeightPct: 30, price: 80_000, held: 5 })).toBe(32);
  });
  it("proposes 0 shares instead of a quantity over the cap when not even one more share fits", () => {
    // 7천 달러, 30% = 2,100달러 < 1주 2,500달러
    expect(defaultBuyQty({ capital: 7_000, riskPct: 1, maxWeightPct: 30, price: 2_500, stop: 2_470 })).toEqual({ qty: 0, overRisk: false, overWeight: true });
    expect(defaultBuyQty({ capital: 10_000_000, riskPct: 1, maxWeightPct: 30, price: 80_000, stop: 78_000, held: 40 })).toMatchObject({ qty: 0, overWeight: true });
  });
});

describe("order sheet helpers", () => {
  it("records journal strategy names only (R135)", () => {
    const ev = dayTradeEvidence({ code: "000001", name: "x", market: "KOSPI", asOf: "", price: 1, changePct: 5, volume: 1, tradeValue: 1, volumeRatio: 3, score: 70, entry: 1, stop: 1, target: 1, stopPct: 1, targetPct: 1, netRR: 1, maxHoldDays: 3, notes: [] });
    expect(journalStrategyFor({ strategy: "단타 돌파" })).toBe(PAPER_STRATEGY);
    expect(journalStrategyFor({ strategy: "2단계 돌파" })).toBe("주봉 단계 돌파");
    expect(journalStrategyFor({ strategy: "캔들 신호" })).toBe("캔들마스터 주봉 캔들");
    expect(journalStrategyFor({ strategy: "직접 매매" })).toBe(MANUAL_STRATEGY);
    expect(journalStrategyFor({ evidence: ev })).toBe(PAPER_STRATEGY);
    expect(journalStrategyFor({})).toBe(MANUAL_STRATEGY);
  });
  it("shows prices in the input with separators (KR) or cents (US) (R054·R063·R107)", () => {
    expect(priceToInput(80_680, "KR")).toBe("80,680");
    expect(priceToInput(80_680.4, "KR")).toBe("80,680");
    expect(priceToInput(132.7333, "US")).toBe("132.73");
    expect(priceToInput(120.5, "US")).toBe("120.5");
    expect(priceToInput(0, "KR")).toBe("");
  });
  it("keeps only the server notes the sheet does not already show (R045)", () => {
    const notes = extraCheckNotes([
      { tone: "bad", text: "손절가를 먼저 정해요.", rule: "5.1 박용선·와인스타인" },
      { tone: "warn", text: "목표가(매도 기준)를 정하지 않았어요.", rule: "5.5 헬로마녀·박용선" },
      { tone: "bad", text: "매수 근거를 적어요.", rule: "5.5 헬로마녀·박용선" },
      { tone: "bad", text: "비중이 40%예요.", rule: "M4-03 강영현" },
      { tone: "warn", text: "손실 중 추가 매수예요(1/1회).", rule: "M4-02 캔들마스터" },
      { tone: "info", text: "평균 단가 이상", rule: "5.3 와인스타인" },
    ]);
    expect(notes.map((n) => n.text)).toEqual(["목표가(매도 기준)를 정하지 않았어요.", "매수 근거를 적어요."]);
  });
});

describe("risk summary reads the live server guard (R029·R043·R073·R124·R126)", () => {
  const blocked: GuardResult = { blocked: true, reasons: ["dailyLoss"], notes: [{ tone: "bad", text: "오늘 손실이 5%로 하루 한도(4%)에 닿았어요. 오늘은 신규 진입을 멈춰요." }] };
  it("prefers server.guards and falls back to the last scan only when the server has none", () => {
    const scan = { guards: { KRW: blocked } } as unknown as ServerState["latestScan"];
    expect(riskSummary(state({ latestScan: scan, guards: { KRW: { blocked: false, notes: [] } } })).KRW.blocked).toBe(false);
    expect(riskSummary(state({ latestScan: scan })).KRW.blocked).toBe(true);
    expect(guardOf(state({ guards: {} }), "KRW")).toBeNull();
    expect(riskSummary(state({ guards: {} })).KRW.checked).toBe(false);
  });
  it("words the release by reason: next trading day for the daily limit, the server's rest note for a streak (R031·R074)", () => {
    expect(guardView(blocked)).toMatchObject({ blocked: true, blockReasons: ["dailyLoss"], releaseText: "다음 거래일에 풀려요.", notes: [] });
    const streak: GuardResult = {
      blocked: true, reasons: ["streak"], restUntil: "2024-03-18",
      notes: [
        { tone: "bad", text: "최근 3번 연속 손실이에요. 잠시 쉬고, 다시 시작할 때는 규모를 줄여요.", rule: "5.5 박용선·슈웨거" },
        { tone: "info", text: "마지막 손실이 난 날(3.15(금))과 그다음 거래일(3.18(월))까지 쉬어요.", rule: "5.5 박용선·슈웨거" },
      ],
    };
    const v = guardView(streak);
    expect(v.releaseText).toBe("마지막 손실이 난 날(3.15(금))과 그다음 거래일(3.18(월))까지 쉬어요.");
    expect(v.blockReason).toContain("연속 손실");
    expect(v.notes).toEqual([]);
    // 이전 서버(까닭 없음)도 노트로 고른다
    expect(guardView({ blocked: true, notes: [streak.notes[0]!] }).releaseText).toBe("마지막 손실이 난 날과 그다음 거래일까지 쉬어요.");
  });
  it("keeps the post-rest note as a note, not a lock (R030)", () => {
    const v = guardView({ blocked: false, notes: [{ tone: "warn", text: "최근 3번 연속 손실 뒤 쉬었어요. 다시 진입하되 규모를 줄이세요.", rule: "5.5 박용선·슈웨거" }] });
    expect(v).toMatchObject({ blocked: false, blockReason: null, releaseText: null });
    expect(v.notes[0]!.text).toContain("규모를 줄이세요");
  });
});

describe("near-stop positions already below the stop (R129)", () => {
  it("marks them breached and says how far below", () => {
    const st = state();
    st.paper.KRW.positions = [pos("000660", 100_000, 180_000), pos("005930", 69_000, 68_000)];
    const rs = riskSummary(st);
    expect(rs.nearStop.map((n) => [n.position.code, n.breached])).toEqual([["000660", true], ["005930", false]]);
    expect(stopDistanceText(rs.nearStop[0]!)).toBe("손절가보다 44.4% 아래");
    expect(nearStopSentence(rs.nearStop[0]!)).toBe("종목000660 손절가보다 44.4% 아래예요");
    expect(nearStopSentence(rs.nearStop[1]!)).toBe("종목005930 손절가까지 1.4% 남았어요");
  });
});

describe("manual losing streak (R039)", () => {
  const trade = (code: string, sell: string, buyPx: number, sellPx: number): JournalEntry[] => [
    { id: `${code}b`, code, name: code, date: "2024-03-11", side: "BUY", price: buyPx, qty: 1, reason: "" },
    { id: `${code}s`, code, name: code, date: sell, side: "SELL", price: sellPx, qty: 1, reason: "" },
  ];
  const j = [...trade("000001", "2024-03-13", 100, 90), ...trade("000002", "2024-03-14", 100, 95), ...trade("000003", "2024-03-15", 100, 99)];
  it("suggests recording only on the last loss day and the next trading day", () => {
    expect(manualStreakOf(j, "KR", "2024-03-15", 3)).toEqual({ streak: 3, lastLossDate: "2024-03-15", resting: true });
    expect(manualStreakOf(j, "KR", "2024-03-18", 3).resting).toBe(true); // 월요일(다음 거래일)
    expect(manualStreakOf(j, "KR", "2024-03-19", 3).resting).toBe(false);
    expect(manualStreakOf(j, "US", "2024-03-15", 3).streak).toBe(0);
    expect(manualStreakOf([...j, ...trade("000004", "2024-03-15", 100, 120)], "KR", "2024-03-15", 3).streak).toBe(0);
  });
});

describe("candidate rows (R024·R094)", () => {
  it("names the row link with the quote, strategy and score", () => {
    const c: DayTradeCandidate = { code: "000270", name: "기아", market: "KOSPI", asOf: "", price: 80_680, changePct: 6, volume: 1, tradeValue: 1, volumeRatio: 5, score: 82, entry: 1, stop: 1, target: 1, stopPct: 1, targetPct: 1, netRR: 1, maxHoldDays: 3, notes: [] };
    const [row] = toRows([c]);
    expect(candidateLabel(row!)).toMatch(/^기아, .+ 원, 6\.00% 상승, 단타 돌파, 점수 82점$/);
    expect(candidateLabel(row!, false)).toBe("기아, 단타 돌파, 점수 82점");
  });
});
