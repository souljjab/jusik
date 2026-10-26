import { describe, expect, it } from "vitest";
import { JOURNAL_STRATEGIES, MANUAL_STRATEGY, PAPER_STRATEGY, type JournalEntry } from "@jusik/shared";
import {
  breaches, failText, journalCsv, periodStats, ruleVerdict, sellResults, sentence, srPnl, srRet, STRATEGY_OPTIONS, tradeRows, violationItems, weightOf,
} from "../src/screens/records/recordsModel";

let seq = 0;
function je(p: Partial<JournalEntry> & Pick<JournalEntry, "code" | "side" | "price" | "qty" | "date">): JournalEntry {
  return { id: `f${++seq}`, name: p.code, reason: "", source: "수동", ...p };
}

describe("R032 같은 규칙은 한 번만 센다", () => {
  it("서버가 손절가 위반을 남겼으면 스스로 표시한 '손절가' 체크는 더하지 않는다", () => {
    const e = je({
      code: "035720", side: "BUY", price: 50_000, qty: 1, date: "2026-10-26",
      violations: ["손절가를 먼저 정해요. 사기 전에 얼마까지 잃을지 적어 둬요."], selfCheck: { stopSet: false, weightOk: true, unplanned: false },
    });
    expect(breaches(e)).toEqual(["손절가를 먼저 정해요. 사기 전에 얼마까지 잃을지 적어 둬요."]);
    expect(ruleVerdict(e)).toEqual({ ok: false, text: "위반 1건" });
  });
  it("비중 위반도 같은 규칙이면 한 번, 서로 다른 규칙은 모두 센다", () => {
    const e = je({
      code: "005930", side: "BUY", price: 1, qty: 1, date: "2026-10-26",
      violations: ["비중이 43.1%예요. 한 종목에 30% 넘게 싣지 않아요."], selfCheck: { stopSet: false, weightOk: false, unplanned: true },
    });
    expect(breaches(e)).toEqual(["비중이 43.1%예요. 한 종목에 30% 넘게 싣지 않아요.", "손절가를 미리 정하지 않았어요.", "계획에 없던 매수예요."]);
  });
  it("서버 위반이 없으면 체크에서 어긴 것을 그대로 센다", () => {
    const e = je({ code: "005930", side: "BUY", price: 1, qty: 1, date: "2026-10-26", selfCheck: { stopSet: false, weightOk: false, unplanned: false } });
    expect(breaches(e)).toEqual(["손절가를 미리 정하지 않았어요.", "비중 상한을 넘었어요."]);
  });
});

describe("R033·R035·R036·R064 거래 결과와 규칙 준수", () => {
  // 카카오: 손절가 48,000에 사서 46,500에 팜(3.1% 아래 → 손절 지연)
  const kBuy = je({ code: "035720", side: "BUY", price: 50_000, qty: 20, date: "2026-10-26", stop: 48_000, selfCheck: { stopSet: true, weightOk: true, unplanned: false } });
  const kSell = je({ code: "035720", side: "SELL", price: 46_500, qty: 20, date: "2026-10-27" });
  // 한국전력: 모의매매가 손절가 19,400에 사서 갭 하락으로 18,900에 손절
  const aBuy = je({ code: "015760", side: "BUY", price: 20_000, qty: 10, date: "2026-10-26", stop: 19_400, source: "자동(모의)" });
  const aSell = je({ code: "015760", side: "SELL", price: 18_900, qty: 10, date: "2026-10-27", source: "자동(모의)", netPnl: -11_500, netPct: -5.75 });
  // 삼성전자: 직접 쓴 매도 복기에 '(+5%)'가 있어도 결과는 선입선출(30,000 → 27,000 = -10%)
  const sBuy = je({ code: "005930", side: "BUY", price: 30_000, qty: 10, date: "2026-10-26", selfCheck: { stopSet: true, weightOk: true, unplanned: false }, stop: 26_000 });
  const sSell = je({ code: "005930", side: "SELL", price: 27_000, qty: 10, date: "2026-10-28", review: "목표가 (+5%) 기대했는데 손절" });
  const all = [kBuy, kSell, aBuy, aSell, sBuy, sSell];
  const res = sellResults(all);

  it("직접 쓴 매도는 복기 글이 아니라 선입선출 결과를 쓴다(R064)", () => {
    const r = res.get(sSell.id)!;
    expect(r.pnl).toBeCloseTo(-30_000, 6);
    expect(r.pct).toBeCloseTo(-10, 6);
    expect(r.net).toBe(false);
  });

  it("손절 지연은 직접 쓴 매도에만, 자동 손절의 갭 체결은 사실로만(R036)", () => {
    const k = res.get(kSell.id)!;
    expect(k.stopLate).toBe(true);
    expect(k.belowStopPct).toBeCloseTo((1 - 46_500 / 48_000) * 100, 6);
    const a = res.get(aSell.id)!;
    expect(a.stopLate).toBe(false);
    expect(a.belowStopPct).toBeCloseTo((1 - 18_900 / 19_400) * 100, 6);
    expect(a.pnl).toBe(-11_500);
    const rows = tradeRows(all, all, res);
    expect(rows.find((x) => x.id === kSell.id)!.tags.map((t) => t.label)).toEqual(["손절 지연"]);
    const auto = rows.find((x) => x.id === aSell.id)!;
    expect(auto.tags.map((t) => t.label)).toEqual(["계획대로", "손절가 아래 체결"]);
    expect(auto.tags.find((t) => t.label === "손절가 아래 체결")!.tone).toBe("plain");
  });

  it("손절 지연 매도는 위반 기록이고 판정·위반 목록·준수율이 같은 규칙을 쓴다(R033)", () => {
    expect(breaches(kSell, res.get(kSell.id))).toEqual(["계획한 손절가보다 3.1% 아래에서 팔았어요."]);
    expect(ruleVerdict(kSell, res.get(kSell.id))).toEqual({ ok: false, text: "위반 1건" });
    expect(ruleVerdict(kSell)).toBeNull();
    // 자동 손절은 위반이 아니다
    expect(ruleVerdict(aSell, res.get(aSell.id))).toEqual({ ok: true, text: "규칙 지킴" });
    const v = violationItems(all, res);
    expect(v.map((x) => x.id)).toEqual([kSell.id]);
    // 결과를 주지 않으면 예전처럼 기록에 남은 위반만
    expect(violationItems(all)).toEqual([]);
  });

  it("규칙 준수율은 직접 쓴 기록만 보고, '거래'는 결과를 아는 청산 수(R034·R035)", () => {
    const st = periodStats(all, res);
    expect(st.buys).toBe(3);
    expect(st.sells).toBe(3);
    expect(st.closed).toBe(3);
    expect(st.wins).toBe(0);
    // 직접: kBuy(지킴) kSell(손절 지연 → 어김) sBuy(지킴) sSell(판단 근거 없음) → 2/3. 자동 aBuy·aSell은 빼고 센다
    expect(st.judged).toBe(3);
    expect(st.followed).toBe(2);
    expect(st.compliance).toBeCloseTo(2 / 3, 6);
    expect(st.pnl.KRW).toBeCloseTo(-70_000 - 11_500 - 30_000, 6);
  });

  it("CSV에 손절 지연과 계획한 분할 매수를 쓴다", () => {
    const planned = je({ code: "000270", side: "BUY", price: 75_000, qty: 4, date: "2026-10-26", plannedAdd: true });
    const csv = journalCsv([kSell, planned], sellResults([kBuy, kSell, planned]));
    const [head, sell, buy] = csv.split("\n");
    const cols = head!.split(",");
    const at = (row: string, name: string) => row.split(",")[cols.indexOf(name)];
    expect(at(sell!, "손절 지연")).toBe("예");
    expect(at(buy!, "계획한 분할 매수")).toBe("예");
    expect(at(buy!, "손절가 미리 정함")).toBe("");
  });
});

describe("R134 일지 비중은 주문 뒤 그 종목 전체 비중", () => {
  it("이미 가진 수량을 더해 계산한다", () => {
    // 보유 33주 + 이번 4주, 가격 75,000, 계좌 9,270,000 → 29.9%
    expect(weightOf(75_000, 33 + 4, 9_270_000)).toBe(29.9);
    expect(weightOf(75_000, 4, 9_270_000)).toBe(3.2);
  });
});

describe("R135 전략 목록은 일지 전략 이름만", () => {
  it("값이 JOURNAL_STRATEGIES와 같고, 단타 돌파·직접 판단을 포함한다", () => {
    expect(STRATEGY_OPTIONS.map(([v]) => v)).toEqual(JOURNAL_STRATEGIES);
    expect(STRATEGY_OPTIONS.find(([v]) => v === PAPER_STRATEGY)![1]).toContain(PAPER_STRATEGY);
    expect(STRATEGY_OPTIONS.find(([v]) => v === MANUAL_STRATEGY)![1]).toBe(MANUAL_STRATEGY);
  });
});

describe("R088·R115 문장", () => {
  it("손익·수익률은 부호 대신 말로 읽는다", () => {
    expect(srPnl(-81_000, "KRW")).toBe("8만 1천 원 손실");
    expect(srPnl(18.5, "USD")).toBe("18.50달러 이익");
    expect(srRet(-3.1)).toBe("3.10% 손실");
    expect(srRet(0)).toBe("0.00% 보합");
  });
  it("연결 실패는 영어 메시지 대신 한국어 문장(방법 포함), 서버 문장에는 방법을 덧붙인다", () => {
    const net = failText(new TypeError("Failed to fetch"), "다시 저장해 주세요.");
    expect(net).toBe("서버에 연결하지 못했어요. 앱 서버가 켜져 있는지 확인해 주세요.");
    expect(net).not.toMatch(/fetch/i);
    expect(failText(new Error("가격은 0보다 크고 수량은 1 이상의 정수여야 해요"), "입력을 고친 뒤 다시 저장해 주세요.")).toBe(
      "가격은 0보다 크고 수량은 1 이상의 정수여야 해요. 입력을 고친 뒤 다시 저장해 주세요.",
    );
    expect(sentence(" 끝 ")).toBe("끝.");
  });
});
