import { describe, expect, it } from "vitest";
import type { Disclosure } from "../src/flows";
import {
  classifySecFiling,
  normalizeSecItems,
  SEC_NOTE_PARAMS,
  secDisclosureNotes,
  secItemsOfTitle,
  US_FLOW_RULES,
  usFlowSignals,
  type UsHolders,
} from "../src/usFlows";

// 아래 수치·공시는 모두 테스트용으로 만든 값이다(실제 종목 데이터 아님).

describe("classifySecFiling", () => {
  it("maps each covered 8-K item", () => {
    const table: [string, string, string][] = [
      ["1.01", "중요 계약", "good"],
      ["1.02", "중요 계약", "bad"],
      ["1.03", "파산", "bad"],
      ["2.01", "인수·매각", "info"],
      ["2.02", "실적 발표", "info"],
      ["3.01", "상장폐지·요건 미달", "bad"],
      ["3.02", "증자·공모", "bad"],
      ["4.02", "재무제표 신뢰성 문제", "bad"],
      ["5.02", "경영진 변동", "info"],
      ["8.01", "기타", "info"],
    ];
    for (const [item, type, tone] of table) expect(classifySecFiling("8-K", item), item).toEqual({ type, tone });
  });

  it("picks bad over good over info when an 8-K has several items, and 8.01 never wins over a named item", () => {
    expect(classifySecFiling("8-K", "2.02,9.01")).toEqual({ type: "실적 발표", tone: "info" });
    expect(classifySecFiling("8-K", "1.01,2.03,9.01")).toEqual({ type: "중요 계약", tone: "good" });
    expect(classifySecFiling("8-K", "2.02,4.02")).toEqual({ type: "재무제표 신뢰성 문제", tone: "bad" });
    expect(classifySecFiling("8-K", "1.01,3.01")).toEqual({ type: "상장폐지·요건 미달", tone: "bad" });
    expect(classifySecFiling("8-K", "8.01,5.02")).toEqual({ type: "경영진 변동", tone: "info" });
    expect(classifySecFiling("8-K", "5.02,8.01")).toEqual({ type: "경영진 변동", tone: "info" });
    expect(classifySecFiling("8-K", ["9.01", "1.01"])).toEqual({ type: "중요 계약", tone: "good" });
    expect(classifySecFiling("8-K/A", "2.02")).toEqual({ type: "실적 발표", tone: "info" });
    expect(classifySecFiling("8-K")).toEqual({ type: "기타", tone: "info" });
    expect(classifySecFiling("8-K", "7.01,9.01")).toEqual({ type: "기타", tone: "info" });
  });

  it("maps the covered forms", () => {
    const table: [string, string, string][] = [
      ["10-K", "정기보고서", "info"],
      ["10-Q", "정기보고서", "info"],
      ["10-K/A", "정기보고서", "info"],
      ["4", "내부자 거래", "info"],
      ["4/A", "내부자 거래", "info"],
      ["SC 13D", "대량보유(행동주의)", "good"],
      ["SC 13D/A", "대량보유(행동주의)", "info"],
      ["SC 13G", "대량보유(단순)", "good"],
      ["SC 13G/A", "대량보유(단순)", "info"],
      ["SCHEDULE 13D", "대량보유(행동주의)", "good"],
      ["SCHEDULE 13G/A", "대량보유(단순)", "info"],
      ["S-1", "증자·공모", "bad"],
      ["S-1/A", "증자·공모", "bad"],
      ["S-3", "증자·공모", "bad"],
      ["S-3ASR", "증자·공모", "bad"],
      ["424B2", "증자·공모", "bad"],
      ["424B5", "증자·공모", "bad"],
      ["NT 10-K", "제출 지연", "bad"],
      ["NT 10-Q", "제출 지연", "bad"],
      ["25", "상장폐지·요건 미달", "bad"],
      ["25-NSE", "상장폐지·요건 미달", "bad"],
      ["DEF 14A", "주주총회", "info"],
      ["SD", "기타", "info"],
      ["", "기타", "info"],
    ];
    for (const [form, type, tone] of table) expect(classifySecFiling(form), form).toEqual({ type, tone });
  });

  it("tolerates case and spacing", () => {
    expect(classifySecFiling(" sc  13d ")).toEqual({ type: "대량보유(행동주의)", tone: "good" });
    expect(classifySecFiling("nt 10-k")).toEqual({ type: "제출 지연", tone: "bad" });
  });
});

describe("8-K item helpers", () => {
  it("normalizes item lists from strings, arrays and titles", () => {
    expect(normalizeSecItems("2.02,9.01")).toEqual(["2.02", "9.01"]);
    expect(normalizeSecItems(["Item 1.01", "9.01", "1.01"])).toEqual(["1.01", "9.01"]);
    expect(normalizeSecItems("")).toEqual([]);
    expect(normalizeSecItems(null)).toEqual([]);
    expect(secItemsOfTitle("실적 발표 · 8-K (Item 2.02, 9.01) — Current report")).toEqual(["2.02", "9.01"]);
    expect(secItemsOfTitle("정기보고서 · 10-K")).toEqual([]);
  });
});

describe("secDisclosureNotes", () => {
  const d = (date: string, form: string, title?: string): Disclosure => ({ date, form, source: "SEC", title: title ?? `${classifySecFiling(form).type} · ${form}` });

  it("keeps only the recent window (today inclusive, no future filings) and groups by type", () => {
    const list = [
      d("2024-05-10", "8-K", "실적 발표 · 8-K (Item 2.02, 9.01)"),
      d("2024-05-11", "8-K", "실적 발표 · 8-K (Item 2.02, 9.01) — 미래"), // today 이후 → 제외
      d("2024-04-20", "S-3"), // 10일보다 오래됨 → 제외
      d("2024-05-08", "4"),
      d("2024-05-09", "4"),
      d("2024-05-09", "4"), // 같은 날 같은 제목 → 한 건
      d("2024-05-07", "SD"), // 기타 → 노트 없음
    ];
    const notes = secDisclosureNotes(list, "2024-05-10");
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.text.includes("실적 발표"))!.text).not.toContain("미래");
    const insider = notes.find((n) => n.text.includes("내부자 거래"))!;
    expect(insider.text).toContain("외 1건");
    expect(insider.tone).toBe("info");
    expect(notes.every((n) => n.rule === "3.6 설춘환(미국 공시 대응)")).toBe(true);
  });

  it("orders bad → good → info and tags good counterparts of the six types with M2-15", () => {
    const notes = secDisclosureNotes(
      [d("2024-05-09", "10-Q"), d("2024-05-08", "SC 13D"), d("2024-05-07", "NT 10-K"), d("2024-05-06", "8-K", "중요 계약 · 8-K (Item 1.01)")],
      "2024-05-10",
    );
    expect(notes.map((n) => n.tone)).toEqual(["bad", "good", "good", "info"]);
    expect(notes[0]!.text).toMatch(/^악재성 공시\(제출 지연\): NT 10-K · 2024-05-07\./); // 제목 앞 유형은 반복하지 않는다
    expect(notes[1]!.rule).toBe("M2-15 설춘환(미국 공시 대응)");
    expect(notes[2]!.text).toContain("중요 계약");
    expect(notes[3]!.text).toMatch(/^확인할 공시\(정기보고서\)/);
  });

  it("reads 8-K items back from the title, so a 4.02 8-K is bad", () => {
    const notes = secDisclosureNotes([d("2024-05-09", "8-K", "재무제표 신뢰성 문제 · 8-K (Item 4.02)")], "2024-05-10");
    expect(notes[0]).toMatchObject({ tone: "bad" });
    expect(notes[0]!.text).toContain("믿을 수 없다");
  });

  it("skips entries without a form and handles bad input", () => {
    expect(secDisclosureNotes([{ date: "2024-05-09", title: "유상증자결정" }], "2024-05-10")).toEqual([]);
    expect(secDisclosureNotes([d("2024-05-09", "S-1")], "not-a-date")).toEqual([]);
    expect(secDisclosureNotes([d("2024-05-01", "S-1")], "2024-05-10", 3)).toEqual([]);
    expect(SEC_NOTE_PARAMS.recentDays).toBe(10);
  });

  it("uses polite Korean text", () => {
    const notes = secDisclosureNotes([d("2024-05-09", "S-1"), d("2024-05-09", "SC 13G")], "2024-05-10");
    for (const n of notes) expect(n.text).toMatch(/(요|세요)\.$/);
  });
});

describe("usFlowSignals", () => {
  const finalNote = { tone: "info", rule: "3.4 강영현" };

  it("gives nothing but the reminder for empty data", () => {
    const r = usFlowSignals({});
    expect(r.score).toBe(0);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject(finalNote);
  });

  it("adds +1 for insider net buying over six months (Lynch) and only notes net selling", () => {
    const buy = usFlowSignals({ insiderNet6m: { buyShares: 50_000, sellShares: 10_000, netShares: 40_000, buyCount: 3, sellCount: 1 } });
    expect(buy.score).toBe(1);
    expect(buy.notes[0]).toMatchObject({ tone: "good", rule: "3.3 박병창(린치)" });
    expect(buy.notes[0]!.text).toContain("40,000주 순매수");
    const sell = usFlowSignals({ insiderNet6m: { buyShares: 0, sellShares: 90_000, netShares: -90_000, buyCount: 0, sellCount: 7 } });
    expect(sell.score).toBe(0);
    expect(sell.notes[0]).toMatchObject({ tone: "info" });
    expect(sell.notes[0]!.text).toContain("90,000주 순매도");
    // 순매수인데 매수 건수가 없으면(옵션 행사 등 집계 차이) 가점 없음
    expect(usFlowSignals({ insiderNet6m: { buyShares: 0, sellShares: 0, netShares: 10, buyCount: 0, sellCount: 0 } }).score).toBe(0);
  });

  it("adds +1 when most top institutions increased and warns when most decreased", () => {
    const inst = (chs: (number | undefined)[]): UsHolders["topInstitutions"] => chs.map((c, i) => ({ name: `기관${i}`, pctHeld: 5, pctChange: c, date: "2024-03-31" }));
    const up = usFlowSignals({ topInstitutions: inst([1.2, 0.5, 3, -1, 2]) });
    expect(up.score).toBe(1);
    expect(up.notes[0]).toMatchObject({ tone: "good", rule: "3.4 설춘환" });
    expect(up.notes[0]!.text).toContain("5곳 중 4곳");
    const down = usFlowSignals({ topInstitutions: inst([-1, -2, -0.5, 1, undefined, 0]) });
    expect(down.score).toBe(0);
    expect(down.notes[0]).toMatchObject({ tone: "warn" });
    expect(down.notes[0]!.text).toContain("4곳 중 3곳");
    // 변화 정보가 있는 기관이 3곳 미만이면 판단하지 않는다
    expect(usFlowSignals({ topInstitutions: inst([1, 2, undefined, 0]) }).notes).toHaveLength(1);
    // 반반이면 가점도 경고도 없다
    expect(usFlowSignals({ topInstitutions: inst([1, -1, 1, -1]) }).notes).toHaveLength(1);
  });

  it("warns on heavy or rising short interest without lowering the score", () => {
    const r = usFlowSignals({ shortPctFloat: 25, shortRatio: 6.2, sharesShort: 12_000_000, sharesShortPrior: 9_000_000 });
    expect(r.score).toBe(0);
    const warns = r.notes.filter((n) => n.tone === "warn");
    expect(warns).toHaveLength(2);
    expect(warns[0]!.text).toContain("25%");
    expect(warns[0]!.text).toContain("6.2일");
    expect(warns[1]!.text).toContain("33.3%");
    expect(warns.every((n) => n.rule === "3.4 강영현·박병창")).toBe(true);
    // 기준 바로 아래
    const calm = usFlowSignals({ shortPctFloat: 19.9, sharesShort: 11_900_000, sharesShortPrior: 10_000_000 });
    expect(calm.notes.filter((n) => n.tone === "warn")).toHaveLength(0);
    // 기준값 그대로면 경고
    expect(usFlowSignals({ shortPctFloat: US_FLOW_RULES.shortFloatWarnPct }).notes.some((n) => n.tone === "warn")).toBe(true);
    expect(usFlowSignals({ sharesShort: 120, sharesShortPrior: 100 }).notes.some((n) => n.tone === "warn")).toBe(true);
    expect(usFlowSignals({ sharesShort: 120, sharesShortPrior: 0 }).notes.some((n) => n.tone === "warn")).toBe(false);
  });

  it("caps the score at 2 and adds info notes for holdings", () => {
    const r = usFlowSignals({
      insidersPct: 12.5,
      institutionsPct: 61.93,
      institutionsCount: 6532,
      insiderNet6m: { buyShares: 10, sellShares: 0, netShares: 10, buyCount: 1, sellCount: 0 },
      topInstitutions: [1, 2, 3].map((c) => ({ name: `기관${c}`, pctHeld: 5, pctChange: c, date: "2024-03-31" })),
    });
    expect(r.score).toBe(US_FLOW_RULES.maxScore);
    expect(r.notes.some((n) => n.rule === "3.2 박용선(오닐)" && n.text.includes("12.5%"))).toBe(true);
    expect(r.notes.some((n) => n.text.includes("기관 보유율 61.9%(6,532곳)"))).toBe(true);
    expect(r.notes.at(-1)).toMatchObject(finalNote);
    for (const n of r.notes) expect(n.text).toMatch(/요\.$/);
  });

  it("exposes its thresholds", () => {
    expect(US_FLOW_RULES).toMatchObject({ shortFloatWarnPct: 20, shortChangeWarnPct: 20, instIncreasingShare: 0.6, maxScore: 2 });
  });
});
