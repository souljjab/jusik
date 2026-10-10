import { describe, expect, it } from "vitest";
import {
  classifyDisclosure,
  disclosureNotes,
  DISCLOSURE_RECENT_DAYS,
  FLOW_RULES,
  flowSignals,
  normalizeDisclosureTitle,
  sectorStrength,
  type Disclosure,
  type InvestorFlow,
  type SectorRow,
} from "../src/flows";

// 아래 수치는 모두 테스트용으로 만든 값이다(실제 종목 데이터 아님).

describe("classifyDisclosure", () => {
  it("recognizes the six good disclosure types from 3.6 (손익구조 is info)", () => {
    expect(classifyDisclosure("단일판매ㆍ공급계약체결")).toEqual({ type: "공급계약", tone: "good" });
    expect(classifyDisclosure("주식등의대량보유상황보고서(일반)")).toEqual({ type: "대량보유", tone: "good" });
    expect(classifyDisclosure("자기주식취득결정")).toEqual({ type: "자사주", tone: "good" });
    expect(classifyDisclosure("주식소각결정")).toEqual({ type: "자사주", tone: "good" });
    expect(classifyDisclosure("무상증자결정")).toEqual({ type: "무상증자", tone: "good" });
    expect(classifyDisclosure("현금ㆍ현물배당결정")).toEqual({ type: "배당", tone: "good" });
    expect(classifyDisclosure("매출액또는손익구조30%(대규모법인은15%)이상변경")).toEqual({ type: "손익구조변동", tone: "info" });
  });

  it("recognizes representative bad disclosures", () => {
    expect(classifyDisclosure("유상증자결정(제3자배정)")).toEqual({ type: "유상증자", tone: "bad" });
    expect(classifyDisclosure("유무상증자결정")).toEqual({ type: "유상증자", tone: "bad" }); // 무상증자 키워드가 있어도 희석이 먼저
    expect(classifyDisclosure("전환사채권발행결정")).toEqual({ type: "전환사채", tone: "bad" });
    expect(classifyDisclosure("신주인수권부사채권발행결정")).toEqual({ type: "전환사채", tone: "bad" });
    expect(classifyDisclosure("감자결정")).toEqual({ type: "감자", tone: "bad" });
    expect(classifyDisclosure("관리종목지정")).toEqual({ type: "관리·불성실", tone: "bad" });
    expect(classifyDisclosure("불성실공시법인지정예고")).toEqual({ type: "관리·불성실", tone: "bad" });
    expect(classifyDisclosure("상장폐지사유발생")).toEqual({ type: "관리·불성실", tone: "bad" });
    expect(classifyDisclosure("횡령ㆍ배임혐의발생")).toEqual({ type: "관리·불성실", tone: "bad" });
  });

  it("handles spacing, dot variants, corrections and undo wording", () => {
    expect(classifyDisclosure("[기재정정] 단일판매 · 공급계약 체결")).toEqual({ type: "공급계약", tone: "good" });
    expect(classifyDisclosure("현금・현물 배당 결정")).toEqual({ type: "배당", tone: "good" });
    expect(classifyDisclosure("단일판매ㆍ공급계약해지")).toEqual({ type: "공급계약", tone: "bad" });
    expect(classifyDisclosure("관리종목지정해제")).toEqual({ type: "관리·불성실", tone: "info" });
    expect(classifyDisclosure("유상증자결정철회")).toEqual({ type: "유상증자", tone: "info" });
    expect(classifyDisclosure("자기주식취득신탁계약해지결정")).toEqual({ type: "자사주", tone: "info" });
    expect(classifyDisclosure("전환사채(해외전환사채포함)발행후만기전사채취득")).toEqual({ type: "전환사채", tone: "info" });
  });

  it("treats treasury stock disposal and routine filings as 기타", () => {
    expect(classifyDisclosure("자기주식처분결정")).toEqual({ type: "기타", tone: "info" });
    expect(classifyDisclosure("기업설명회(IR)개최(안내공시)")).toEqual({ type: "기타", tone: "info" });
    expect(classifyDisclosure("")).toEqual({ type: "기타", tone: "info" });
  });
});

describe("DART report names", () => {
  it("normalizes tags, (자율공시) and the 주요사항보고서 wrapper", () => {
    expect(normalizeDisclosureTitle("[기재정정]단일판매ㆍ공급계약체결")).toBe("단일판매공급계약체결");
    expect(normalizeDisclosureTitle("[기재정정][첨부추가] 단일판매ㆍ공급계약체결(자율공시)")).toBe("단일판매공급계약체결");
    expect(normalizeDisclosureTitle("[발행조건확정]증권신고서(지분증권)")).toBe("증권신고서(지분증권)");
    expect(normalizeDisclosureTitle("[첨부정정]현금ㆍ현물배당결정")).toBe("현금현물배당결정");
    expect(normalizeDisclosureTitle("투자판단관련주요경영사항(자율공시)(자율공시)")).toBe("투자판단관련주요경영사항");
    expect(normalizeDisclosureTitle("주요사항보고서(유상증자결정)")).toBe("유상증자결정");
    expect(normalizeDisclosureTitle("[기재정정] 주요사항보고서 (유상증자결정)")).toBe("유상증자결정");
    expect(normalizeDisclosureTitle("주요사항보고서(유상증자결정(제3자배정))")).toBe("유상증자결정(제3자배정)");
    expect(normalizeDisclosureTitle("주요사항보고서(전환사채권발행결정) (철회)")).toBe("전환사채권발행결정(철회)");
    // 짝이 안 맞는 괄호는 그대로 둔다
    expect(normalizeDisclosureTitle("주요사항보고서(유상증자결정")).toBe("주요사항보고서(유상증자결정");
    // 되돌림 표현이 든 꼬리표는 남긴다
    expect(normalizeDisclosureTitle("[철회]유상증자결정")).toBe("[철회]유상증자결정");
    expect(normalizeDisclosureTitle("")).toBe("");
  });

  it("classifies DART-style names like the matching Naver titles", () => {
    const cases: [string, ReturnType<typeof classifyDisclosure>][] = [
      ["주요사항보고서(자기주식취득결정)", { type: "자사주", tone: "good" }],
      ["주요사항보고서(자기주식처분결정)", { type: "기타", tone: "info" }],
      ["주요사항보고서(무상증자결정)", { type: "무상증자", tone: "good" }],
      ["주요사항보고서(유무상증자결정)", { type: "유상증자", tone: "bad" }],
      ["[기재정정]주요사항보고서(유상증자결정)", { type: "유상증자", tone: "bad" }],
      ["주요사항보고서(감자결정)", { type: "감자", tone: "bad" }],
      ["주요사항보고서(전환사채권발행결정)", { type: "전환사채", tone: "bad" }],
      ["주요사항보고서(교환사채권발행결정)", { type: "전환사채", tone: "bad" }],
      ["주요사항보고서(자기주식취득신탁계약해지결정)", { type: "자사주", tone: "info" }],
      ["주요사항보고서(전환사채권발행결정) (철회)", { type: "전환사채", tone: "info" }],
      ["[철회]주요사항보고서(유상증자결정)", { type: "유상증자", tone: "info" }],
      ["단일판매ㆍ공급계약체결(자율공시)", { type: "공급계약", tone: "good" }],
      ["[기재정정]단일판매ㆍ공급계약해지", { type: "공급계약", tone: "bad" }],
      ["[첨부정정]현금ㆍ현물배당결정", { type: "배당", tone: "good" }],
      ["주식등의대량보유상황보고서(일반)", { type: "대량보유", tone: "good" }],
      ["[기재정정]매출액또는손익구조30%(대규모법인은15%)이상변경", { type: "손익구조변동", tone: "info" }],
      ["[발행조건확정]증권신고서(지분증권)", { type: "기타", tone: "info" }],
      ["사업보고서 (2023.12)", { type: "기타", tone: "info" }],
      ["임원ㆍ주요주주특정증권등소유상황보고서", { type: "기타", tone: "info" }],
    ];
    for (const [title, want] of cases) expect([title, classifyDisclosure(title)]).toEqual([title, want]);
  });

  it("keeps Naver-style results unchanged when the same title gets a DART tag or wrapper", () => {
    const naver = ["단일판매ㆍ공급계약체결", "자기주식취득결정", "유상증자결정(제3자배정)", "전환사채권발행결정", "감자결정", "무상증자결정", "현금ㆍ현물배당결정", "자기주식처분결정"];
    for (const t of naver) {
      const base = classifyDisclosure(t);
      expect(classifyDisclosure(`[기재정정]${t}`)).toEqual(base);
      expect(classifyDisclosure(`${t}(자율공시)`)).toEqual(base);
      expect(classifyDisclosure(`주요사항보고서(${t})`)).toEqual(base);
    }
  });

  it("counts a same-day correction or (자율공시) variant once in the notes", () => {
    const notes = disclosureNotes([
      { date: "2024-03-15", title: "단일판매ㆍ공급계약체결" },
      { date: "2024-03-15", title: "[기재정정]단일판매ㆍ공급계약체결" },
      { date: "2024-03-15", title: "단일판매ㆍ공급계약체결(자율공시)" },
      { date: "2024-03-14", title: "[기재정정]단일판매ㆍ공급계약체결" }, // 다른 날 정정은 따로 센다
    ], "2024-03-15");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ tone: "good", rule: "M2-15 설춘환" });
    expect(notes[0]!.text).toContain("외 1건");
  });
});

describe("disclosureNotes", () => {
  const list: Disclosure[] = [
    { date: "2024-03-15", title: "단일판매ㆍ공급계약체결" },
    { date: "2024-03-12", title: "단일판매ㆍ공급계약체결" },
    { date: "2024-03-14", title: "전환사채권발행결정" },
    { date: "2024-03-13", title: "매출액또는손익구조30%(대규모법인은15%)이상변경" },
    { date: "2024-03-10", title: "기업설명회(IR)개최" },
    { date: "2024-03-01", title: "현금ㆍ현물배당결정" }, // 10일 창 밖
  ];

  it("flags recent events grouped by type, bad first, with rule ids", () => {
    const notes = disclosureNotes(list, "2024-03-15");
    expect(notes.map((n) => n.tone)).toEqual(["bad", "good", "info"]);
    expect(notes[0]).toMatchObject({ tone: "bad", rule: "3.6 설춘환" });
    expect(notes[0]!.text).toContain("전환사채");
    expect(notes[1]).toMatchObject({ tone: "good", rule: "M2-15 설춘환" });
    expect(notes[1]!.text).toContain("2024-03-15");
    expect(notes[1]!.text).toContain("외 1건");
    expect(notes[2]).toMatchObject({ tone: "info", rule: "M2-15 설춘환" });
    expect(notes.some((n) => n.text.includes("배당"))).toBe(false); // 3/1은 10일 전보다 이전
    expect(notes.some((n) => n.text.includes("IR"))).toBe(false); // 기타는 노트 없음
  });

  it("uses the inclusive day window and the days parameter", () => {
    expect(DISCLOSURE_RECENT_DAYS).toBe(10);
    const one = [{ date: "2024-03-05", title: "무상증자결정" }];
    expect(disclosureNotes(one, "2024-03-15")).toHaveLength(1); // 정확히 10일 전은 포함
    expect(disclosureNotes(one, "2024-03-16")).toHaveLength(0);
    expect(disclosureNotes(one, "2024-03-16", 30)).toHaveLength(1);
  });

  it("dedupes the same title on the same date and ignores invalid input", () => {
    const dup = [
      { date: "2024-03-15", title: "현금ㆍ현물배당결정" },
      { date: "2024-03-15", title: "현금ㆍ현물 배당결정" },
    ];
    const notes = disclosureNotes(dup, "2024-03-15");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).not.toContain("외");
    expect(disclosureNotes(dup, "not-a-date")).toEqual([]);
    expect(disclosureNotes([{ date: "??", title: "무상증자결정" }], "2024-03-15")).toEqual([]);
  });

  it("does not look ahead: disclosures after today never change the notes", () => {
    const base = disclosureNotes(list, "2024-03-14");
    const withFuture = disclosureNotes([...list, { date: "2024-03-20", title: "유상증자결정" }, { date: "2024-03-15", title: "감자결정" }], "2024-03-14");
    expect(withFuture).toEqual(base);
  });

  it("cites 3.6 instead of M2-15 when a good-type disclosure is undone", () => {
    const notes = disclosureNotes([{ date: "2024-03-15", title: "단일판매ㆍ공급계약해지" }], "2024-03-15");
    expect(notes).toEqual([expect.objectContaining({ tone: "bad", rule: "3.6 설춘환" })]);
    expect(notes[0]!.text).toContain("해지");
  });
});

/** 날짜 오름차순 n일치 수급. f/i로 외국인·기관 순매매를 정한다 */
function makeFlows(n: number, f: (k: number) => number, i: (k: number) => number, volume = 100_000, hold?: (k: number) => number): InvestorFlow[] {
  const base = Date.UTC(2024, 0, 1);
  return Array.from({ length: n }, (_, k) => ({
    date: new Date(base + k * 86_400_000).toISOString().slice(0, 10),
    close: 10_000 + k,
    volume,
    foreignNet: f(k),
    institutionNet: i(k),
    ...(hold ? { foreignHoldPct: hold(k) } : {}),
  }));
}

describe("flowSignals", () => {
  const CAUTION = "3.4 강영현";

  it("returns 0 and no notes without data", () => {
    expect(flowSignals([])).toEqual({ score: 0, notes: [] });
    expect(flowSignals(makeFlows(5, () => 1, () => 1), -1)).toEqual({ score: 0, notes: [] });
  });

  it("gives the full bonus for steady co-buying and always adds the caution note", () => {
    const flows = makeFlows(25, () => 4_000, () => 3_000); // 20일 순매수 합 = 거래량의 7%
    const r = flowSignals(flows);
    expect(r.score).toBe(FLOW_RULES.maxScore);
    expect(r.notes.filter((n) => n.tone === "good")).toHaveLength(3);
    expect(r.notes.filter((n) => n.tone === "good").every((n) => n.rule === "3.4 설춘환·강동진")).toBe(true);
    expect(r.notes.some((n) => n.text.includes("25일 연속"))).toBe(true);
    const last = r.notes.at(-1)!;
    expect(last).toMatchObject({ tone: "info", rule: CAUTION });
    expect(last.text).toContain("가점으로만");
  });

  it("gives half a point when only one side is buying", () => {
    const r = flowSignals(makeFlows(10, () => 1_000, () => -500));
    expect(r.score).toBe(0.5);
    expect(r.notes[0]!.text).toContain("외국인만 순매수");
  });

  it("never goes negative on heavy selling, but warns", () => {
    const r = flowSignals(makeFlows(20, () => -5_000, () => -5_000));
    expect(r.score).toBe(0);
    expect(r.notes.filter((n) => n.tone === "warn")).toHaveLength(2);
    expect(r.notes.at(-1)!.rule).toBe(CAUTION);
  });

  it("requires the co-buying streak to reach the minimum", () => {
    // 마지막 2일만 동반 순매수, 그 전은 순매도 → 5일 합은 음수
    const r = flowSignals(makeFlows(10, (k) => (k >= 8 ? 1_000 : -2_000), (k) => (k >= 8 ? 1_000 : -2_000)));
    expect(r.notes.some((n) => n.text.includes("연속"))).toBe(false);
    const r3 = flowSignals(makeFlows(10, (k) => (k >= 7 ? 1_000 : -100), (k) => (k >= 7 ? 1_000 : -100), 1e9));
    expect(r3.notes.some((n) => n.text.includes("3일 연속"))).toBe(true);
    expect(r3.score).toBe(1.5); // 5일 동반 +1, 연속 +0.5, 거래량 대비는 미달
  });

  it("notes a change in foreign holding ratio", () => {
    const r = flowSignals(makeFlows(20, () => 0, () => 0, 100_000, (k) => 30 + k * 0.1));
    const hold = r.notes.find((n) => n.text.includes("보유율"));
    expect(hold).toMatchObject({ tone: "info", rule: "3.4 설춘환" });
    expect(hold!.text).toContain("늘었어요");
  });

  it("uses only data up to index at (no look-ahead)", () => {
    const flows = makeFlows(40, (k) => (k % 7) * 300 - 600, (k) => (k % 5) * 200 - 300, 50_000, (k) => 20 + (k % 3));
    for (let at = 0; at < flows.length; at++) {
      const expected = flowSignals(flows.slice(0, at + 1));
      expect(flowSignals(flows, at)).toEqual(expected);
      // 미래 데이터를 바꿔도 결과가 같아야 한다
      const mutated = flows.map((x, k) => (k > at ? { ...x, foreignNet: -9e9, institutionNet: 9e9, volume: 1, foreignHoldPct: 99 } : x));
      expect(flowSignals(mutated, at)).toEqual(expected);
    }
  });
});

describe("sectorStrength", () => {
  const rows: SectorRow[] = Array.from({ length: 10 }, (_, k) => ({ no: String(100 + k), name: `업종${k}`, changePct: 5 - k }));

  it("marks the top 20% as a leading sector candidate", () => {
    const r = sectorStrength(rows, "101");
    expect(r).toMatchObject({ rank: 2, total: 10 });
    expect(r.notes).toEqual([expect.objectContaining({ tone: "good", rule: "3.5 와인스타인·박병창" })]);
    expect(r.notes[0]!.text).toContain("주도 업종 후보");
  });

  it("warns for the bottom 20% and stays neutral in the middle", () => {
    expect(sectorStrength(rows, "108").notes[0]).toMatchObject({ tone: "warn", rule: "3.5 박병창" });
    expect(sectorStrength(rows, "105").notes[0]).toMatchObject({ tone: "info" });
    expect(sectorStrength(rows, "107").notes[0]!.tone).toBe("info");
  });

  it("ranks ties together and ignores invalid rows", () => {
    const tie = [...rows, { no: "999", name: "동률", changePct: 5 }, { no: "998", name: "깨짐", changePct: Number.NaN }];
    expect(sectorStrength(tie, "999")).toMatchObject({ rank: 1, total: 11 });
    expect(sectorStrength(tie, "100")).toMatchObject({ rank: 1, total: 11 });
    expect(sectorStrength(tie, "101").rank).toBe(3);
  });

  it("returns rank null when the sector is unknown and only informs on tiny lists", () => {
    expect(sectorStrength(rows, null)).toEqual({ rank: null, total: 10, notes: [] });
    expect(sectorStrength(rows, "000")).toEqual({ rank: null, total: 10, notes: [] });
    expect(sectorStrength([], "100")).toEqual({ rank: null, total: 0, notes: [] });
    const small = sectorStrength(rows.slice(0, 3), "100");
    expect(small.rank).toBe(1);
    expect(small.notes[0]!.tone).toBe("info");
  });
});
