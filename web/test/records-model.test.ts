import { describe, expect, it } from "vitest";
import type { JournalEntry } from "@jusik/shared";
import {
  addDays, breaches, composeEmotion, cumulativePnl, emotionStats, emotionTags, exitValue, groupByDate, inRange, isWin, journalCsv, NO_EMOTION, parseEmotion,
  parseExit, pct0, periodRange, periodStats, ruleVerdict, sellResults, tradeRows, violationItems, weekStart, weightOf,
} from "../src/screens/records/recordsModel";

let seq = 0;
function je(p: Partial<JournalEntry> & Pick<JournalEntry, "code" | "side" | "price" | "qty" | "date">): JournalEntry {
  return { id: `e${++seq}`, name: p.code, reason: "", source: "수동", ...p };
}

describe("감정 태그", () => {
  it("이전 이름(조급함)을 지금 칩(조급)으로 읽고, 모르는 말은 직접 적은 글로 남긴다", () => {
    expect(parseEmotion("조급함, 욕심, 손이 먼저 나감")).toEqual({ chips: ["조급", "욕심"], text: "손이 먼저 나감" });
    expect(parseEmotion(undefined)).toEqual({ chips: [], text: "" });
  });
  it("칩은 정해진 순서로, 직접 적은 글은 끝에 붙인다", () => {
    expect(composeEmotion(["불안", "차분"], "  메모 ")).toBe("차분, 불안, 메모");
    expect(composeEmotion([], "")).toBe("");
  });
  it("태그는 중복 없이", () => {
    expect(emotionTags("조급, 조급함, 확신")).toEqual(["조급", "확신"]);
  });
});

describe("기간", () => {
  it("주는 월요일부터 일요일까지", () => {
    expect(weekStart("2026-10-15")).toBe("2026-10-12"); // 목 → 월
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // 일 → 그 주 월
    expect(periodRange("week", "2026-10-15")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(periodRange("week", "2026-10-15", -1)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });
  it("월은 1일부터 말일까지, 해를 넘겨도 된다", () => {
    expect(periodRange("month", "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("month", "2026-01-20", -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("month", "2026-03-05", -1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("일은 하루", () => {
    expect(periodRange("day", "2026-10-15", -2)).toEqual({ from: "2026-10-13", to: "2026-10-13" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(inRange("2026-10-12", { from: "2026-10-12", to: "2026-10-18" })).toBe(true);
    expect(inRange("2026-10-19", { from: "2026-10-12", to: "2026-10-18" })).toBe(false);
  });
});

describe("sellResults", () => {
  it("직접 쓴 매도는 같은 출처 매수분과 선입선출로 짝짓고 R·손절 지연을 낸다", () => {
    const b1 = je({ code: "005930", side: "BUY", price: 10_000, qty: 10, date: "2026-10-01", stop: 9_500 });
    const b2 = je({ code: "005930", side: "BUY", price: 11_000, qty: 10, date: "2026-10-02" });
    const s1 = je({ code: "005930", side: "SELL", price: 9_000, qty: 15, date: "2026-10-05" });
    const res = sellResults([b1, b2, s1]);
    const r = res.get(s1.id)!;
    // 원가 10,000×10 + 11,000×5 = 155,000, 매도 9,000×15 = 135,000
    expect(r.pnl).toBeCloseTo(-20_000, 6);
    expect(r.pct).toBeCloseTo((9_000 / (155_000 / 15) - 1) * 100, 6);
    expect(r.net).toBe(false);
    expect(r.buyIds).toEqual([b1.id, b2.id]);
    // R은 손절가가 있는 첫 매수분만: (9000-10000)/(10000-9500) = -2
    expect(r.r).toBeCloseTo(-2, 6);
    expect(r.rDerived).toBe(true);
    // 9,000 < 9,500 × 0.99 → 손절 지연
    expect(r.stopLate).toBe(true);
    expect(r.currency).toBe("KRW");
  });
  it("자동(모의) 매도는 순손익 숫자를 쓰고, 직접 쓴 매수분과 섞지 않는다", () => {
    const manual = je({ code: "AAPL", side: "BUY", price: 100, qty: 1, date: "2026-10-01" });
    const auto = je({ code: "AAPL", side: "SELL", price: 120, qty: 1, date: "2026-10-03", source: "자동(모의)", netPnl: 18.5, netPct: 18.2 });
    const r = sellResults([manual, auto]).get(auto.id)!;
    expect(r.pnl).toBe(18.5);
    expect(r.pct).toBe(18.2);
    expect(r.net).toBe(true);
    expect(r.buyIds).toEqual([]);
    expect(r.currency).toBe("USD");
  });
  it("짝지을 매수가 없고 순손익도 없으면 결과를 모른다", () => {
    const s = je({ code: "000660", side: "SELL", price: 100, qty: 1, date: "2026-10-03" });
    const r = sellResults([s]).get(s.id)!;
    expect(r.pnl).toBeNull();
    expect(isWin(r)).toBeNull();
  });
  it("같은 날 매수가 먼저", () => {
    const s = je({ code: "000660", side: "SELL", price: 110, qty: 1, date: "2026-10-03" });
    const b = je({ code: "000660", side: "BUY", price: 100, qty: 1, date: "2026-10-03" });
    expect(sellResults([s, b]).get(s.id)!.pnl).toBeCloseTo(10, 6);
  });
});

describe("규칙 판정과 기간 요약", () => {
  const buyOk = je({ code: "005930", side: "BUY", price: 100, qty: 1, date: "2026-10-12", selfCheck: { stopSet: true, weightOk: true, unplanned: false } });
  const buyBad = je({ code: "000660", side: "BUY", price: 100, qty: 1, date: "2026-10-12", violations: ["손절가를 먼저 정해요."], emotion: "조급" });
  const buyUnplanned = je({ code: "035720", side: "BUY", price: 100, qty: 1, date: "2026-10-13", selfCheck: { stopSet: true, weightOk: true, unplanned: true }, emotion: "확신" });
  const sellWin = je({ code: "005930", side: "SELL", price: 110, qty: 1, date: "2026-10-14", emotion: "차분" });
  const sellLoss = je({ code: "000660", side: "SELL", price: 90, qty: 1, date: "2026-10-14" });
  const sellUnk = je({ code: "035720", side: "SELL", price: 95, qty: 1, date: "2026-10-15" });
  const autoSell = je({ code: "AAPL", side: "SELL", price: 1, qty: 1, date: "2026-10-15", source: "자동(모의)", netPnl: -3, netPct: -1.5 });
  const all = [buyOk, buyBad, buyUnplanned, sellWin, sellLoss, sellUnk, autoSell];
  const res = sellResults(all);

  it("breaches·ruleVerdict: 서버 위반 + 스스로 표시한 체크", () => {
    expect(breaches(buyUnplanned)).toEqual(["계획에 없던 매수예요."]);
    expect(ruleVerdict(buyOk)).toEqual({ ok: true, text: "규칙 지킴" });
    expect(ruleVerdict(buyBad)).toEqual({ ok: false, text: "위반 1건" });
    expect(ruleVerdict(sellWin)).toBeNull();
    expect(ruleVerdict(autoSell)).toEqual({ ok: true, text: "규칙 지킴" });
  });

  it("periodStats: 거래 수·승률·규칙 준수율(직접 쓴 기록 중 판단 가능한 기록만)", () => {
    const st = periodStats(all, res);
    expect(st.buys).toBe(3);
    expect(st.sells).toBe(4);
    // 결과를 아는 매도: sellWin(+), sellLoss(-), sellUnk(-5), autoSell(-) → 4건 중 1승
    expect(st.closed).toBe(4);
    expect(st.wins).toBe(1);
    expect(st.winRate).toBeCloseTo(0.25, 6);
    // 판단 가능(직접 쓴 기록만): buyOk(지킴) buyBad(위반) buyUnplanned(위반) → 1/3. 자동(모의) autoSell은 빼고 센다
    expect(st.judged).toBe(3);
    expect(st.followed).toBe(1);
    expect(st.compliance).toBeCloseTo(1 / 3, 6);
    expect(st.pnl.KRW).toBeCloseTo(10 - 10 - 5, 6);
    expect(st.pnl.USD).toBeCloseTo(-3, 6);
    expect(pct0(st.compliance)).toBe("33%");
    expect(pct0(null)).toBe("-");
  });

  it("periodStats: 판단할 기록이 없으면 준수율 null", () => {
    const st = periodStats([sellWin], res);
    expect(st.compliance).toBeNull();
    expect(st.judged).toBe(0);
  });

  it("tradeRows: 매도마다 과정 태그와 매수·매도 감정", () => {
    const rows = tradeRows(all, all, res);
    expect(rows.map((r) => r.id)).toEqual([sellUnk.id, autoSell.id, sellWin.id, sellLoss.id].sort((a, b) => {
      const d = (id: string) => all.find((e) => e.id === id)!.date;
      return d(b).localeCompare(d(a));
    }));
    const win = rows.find((r) => r.id === sellWin.id)!;
    expect(win.tags.map((t) => t.label)).toEqual(["계획대로"]);
    expect(win.emotions).toEqual(["차분"]);
    const loss = rows.find((r) => r.id === sellLoss.id)!;
    expect(loss.followed).toBe(false);
    expect(loss.tags.map((t) => t.label)).toEqual(["위반 1건"]);
    expect(loss.emotions).toEqual(["조급"]);
    const unk = rows.find((r) => r.id === sellUnk.id)!;
    expect(unk.tags.map((t) => t.label)).toEqual(["계획 외 매수"]);
    expect(unk.emotions).toEqual(["확신"]);
  });

  it("emotionStats: 감정별 승률·평균 수익률, 기록 없음은 끝", () => {
    const stats = emotionStats(tradeRows(all, all, res));
    expect(stats.at(-1)!.tag).toBe(NO_EMOTION);
    const calm = stats.find((s) => s.tag === "차분")!;
    expect(calm).toMatchObject({ n: 1, wins: 1, winRate: 1 });
    expect(calm.avgPct).toBeCloseTo(10, 6);
    const rush = stats.find((s) => s.tag === "조급")!;
    expect(rush.winRate).toBe(0);
    expect(rush.avgPct).toBeCloseTo(-10, 6);
  });

  it("violationItems: 위반이 있는 기록만 최신 먼저", () => {
    const v = violationItems(all);
    expect(v.map((x) => x.id)).toEqual([buyUnplanned.id, buyBad.id]);
    expect(v[1]!.items).toEqual(["손절가를 먼저 정해요."]);
  });

  it("cumulativePnl: 통화별 누적", () => {
    const rows = tradeRows(all, all, res);
    expect(cumulativePnl(rows, "KRW")).toEqual([0, 10, 0, -5]);
    expect(cumulativePnl(rows, "USD")).toEqual([0, -3]);
  });
});

describe("일지 목록·입력", () => {
  it("groupByDate: 최신 날짜 먼저, 같은 날은 나중에 적은 것 먼저", () => {
    const a = je({ code: "A", side: "BUY", price: 1, qty: 1, date: "2026-10-12" });
    const b = je({ code: "B", side: "BUY", price: 1, qty: 1, date: "2026-10-14" });
    const c = je({ code: "C", side: "SELL", price: 1, qty: 1, date: "2026-10-12" });
    const g = groupByDate([a, b, c]);
    expect(g.map((x) => x.date)).toEqual(["2026-10-14", "2026-10-12"]);
    expect(g[1]!.items.map((x) => x.id)).toEqual([c.id, a.id]);
  });
  it("weightOf: 계좌 대비 비중", () => {
    expect(weightOf(10_000, 30, 1_000_000)).toBe(30);
    expect(weightOf(10_000, 1, 0)).toBeNull();
    expect(weightOf(undefined, 1, 100)).toBeNull();
  });
  it("청산 사유: 기타 설명을 붙이고 다시 나눈다", () => {
    expect(exitValue("기타", " 갭 하락 ")).toBe("기타: 갭 하락");
    expect(exitValue("손절", "무시")).toBe("손절");
    expect(exitValue("", "x")).toBe("");
    expect(parseExit("기타: 갭 하락")).toEqual({ reason: "기타", detail: "갭 하락" });
    expect(parseExit("목표 도달")).toEqual({ reason: "목표 도달", detail: "" });
    expect(parseExit("갑자기")).toEqual({ reason: "기타", detail: "갑자기" });
  });
  it("journalCsv: 머리행과 따옴표 처리", () => {
    const e = je({ code: "005930", name: "삼성전자", side: "BUY", price: 1, qty: 2, date: "2026-10-12", reason: "돌파, 거래량", selfCheck: { stopSet: true, weightOk: false, unplanned: false } });
    const csv = journalCsv([e], sellResults([e]));
    const [head, row] = csv.split("\n");
    expect(head!.startsWith("날짜,종목코드,종목명,구분")).toBe(true);
    expect(row).toContain('"돌파, 거래량"');
    // 규칙 체크는 엑셀 내보내기와 같은 세 칸(예·아니요)
    expect(head).toContain("어긴 규칙,손절가 미리 정함,비중 상한 지킴,계획에 없던 매수,계획한 분할 매수");
    expect(row).toContain(",예,아니요,아니요,,");
  });
});
