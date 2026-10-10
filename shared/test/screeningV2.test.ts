import { describe, expect, it } from "vitest";
import {
  annualEpsGrowth,
  confirmedPeriods,
  disclosedBy,
  growthGroupOf,
  HARD_RULES,
  quarterlyEpsYoY,
  screenFundamentals,
  screeningNotes,
  TAG_LYNCH,
  type Check,
} from "../src/screening";
import type { Fundamentals, PeriodFinancials } from "../src/types";

const yr = (period: string, revenue: number, opIncome: number, netIncome: number, eps?: number, estimate = false): PeriodFinancials => ({
  period, estimate, revenue, opIncome, netIncome, eps,
});
const q = (period: string, eps: number | undefined, estimate = false): PeriodFinancials => ({ period, estimate, eps });
const byId = (cs: Check[], id: string) => cs.find((c) => c.id === id)!;

/** 세 항목이 3년 연속 늘어난 건전한 기업 */
const growing: PeriodFinancials[] = [yr("2021.12", 1000, 100, 80, 1000), yr("2022.12", 1200, 130, 100, 1250), yr("2023.12", 1500, 160, 120, 1500), yr("2024.12", 1400, 90, 60, 1100, true)];
const quarters: PeriodFinancials[] = [q("2023.06", 300), q("2023.09", 340), q("2023.12", 380), q("2024.03", 360), q("2024.06", 390), q("2024.09", 100, true)];

describe("screening v2 — 규칙 ID", () => {
  it("attaches rule ids to the original seven checks and the new soft checks", () => {
    const r = screenFundamentals({});
    const ids = Object.fromEntries(r.checks.map((c) => [c.id, c.ruleId]));
    expect(ids).toMatchObject({
      debt: "M2-02 설춘환", current: "M2-02 설춘환", reserve: "M2-02 설춘환",
      per: "3.3 설춘환", pbr: "3.3 설춘환", rev: "3.2 설춘환", op: "3.2 설춘환",
      growth3y: "M2-03 설춘환", epsYoY: "M2-05 박용선(오닐)", sectorPer: "M2-06 설춘환", roe: "M2-07 설춘환",
    });
    expect(r.exclusions.map((c) => c.ruleId)).toEqual(["M2-01 설춘환", "M2-01 설춘환", "M2-04 설춘환"]);
  });
});

describe("screening v2 — 데이터 없음", () => {
  it("leaves everything unknown and excludes nothing", () => {
    for (const r of [screenFundamentals(undefined), screenFundamentals({})]) {
      expect(r.grade).toBe("N/A");
      expect(r.checks.every((c) => c.status === "unknown")).toBe(true);
      expect(r.exclusions.every((c) => c.status === "unknown")).toBe(true);
      expect(r.excluded).toBe(false);
      expect(r.growthGroup).toBeNull();
      expect(r.tags).toEqual([]);
      expect(r.total).toBe(11);
    }
  });
});

describe("screening v2 — 하드 제외(M2-01, M2-04)", () => {
  it("excludes debt ratio above 300%", () => {
    expect(screenFundamentals({ debtRatio: 300.1 }).excluded).toBe(true);
    expect(byId(screenFundamentals({ debtRatio: 300.1 }).exclusions, "x-debt").status).toBe("fail");
    expect(screenFundamentals({ debtRatio: HARD_RULES.debtRatioMax }).excluded).toBe(false);
  });
  it("excludes current ratio below 50%, and uses the quick ratio only when it proves the current ratio is high enough", () => {
    expect(screenFundamentals({ currentRatio: 49 }).excluded).toBe(true);
    expect(screenFundamentals({ currentRatio: 50 }).excluded).toBe(false);
    // 당좌비율 ≤ 유동비율 → 당좌 60%면 유동비율도 50% 이상
    const quickOk = screenFundamentals({ quickRatio: 60 });
    expect(byId(quickOk.exclusions, "x-current").status).toBe("pass");
    expect(byId(quickOk.checks, "current").status).toBe("unknown"); // 100% 이상인지는 모름
    expect(byId(screenFundamentals({ quickRatio: 120 }).checks, "current")).toMatchObject({ status: "pass", value: "당좌 120%" });
    // 당좌 30%만으로는 유동비율이 50% 미만인지 알 수 없어 제외하지 않는다
    const quickLow = screenFundamentals({ quickRatio: 30 });
    expect(byId(quickLow.exclusions, "x-current").status).toBe("unknown");
    expect(quickLow.excluded).toBe(false);
    // 유동비율이 있으면 유동비율이 우선
    expect(screenFundamentals({ currentRatio: 40, quickRatio: 60 }).excluded).toBe(true);
  });
  it("excludes the latest confirmed annual operating or net loss until it turns profitable", () => {
    const opLoss = screenFundamentals({ annual: [yr("2022.12", 1000, 50, 30), yr("2023.12", 900, -20, 10)] });
    expect(opLoss.excluded).toBe(true);
    expect(byId(opLoss.exclusions, "x-loss").value).toContain("영업이익 적자(2023.12)");
    const netLoss = screenFundamentals({ annual: [yr("2023.12", 900, 20, 0)] });
    expect(netLoss.excluded).toBe(true);
    expect(byId(netLoss.exclusions, "x-loss").value).toContain("순이익 적자");
    // 적자였다가 최근 해에 흑자 전환 → 제외 해제
    const turned = screenFundamentals({ annual: [yr("2022.12", 900, -20, -30), yr("2023.12", 1000, 40, 20)] });
    expect(turned.excluded).toBe(false);
    expect(byId(turned.exclusions, "x-loss").status).toBe("pass");
    // 추정치(E)의 적자는 판단에 쓰지 않는다
    expect(screenFundamentals({ annual: [yr("2023.12", 1000, 40, 20), yr("2024.12", 900, -10, -5, undefined, true)] }).excluded).toBe(false);
    // 한쪽만 알면 unknown
    expect(byId(screenFundamentals({ annual: [{ period: "2023.12", estimate: false, opIncome: 10 }] }).exclusions, "x-loss").status).toBe("unknown");
  });
  it("keeps exclusion separate from the grade", () => {
    const r = screenFundamentals({ debtRatio: 100, currentRatio: 150, reserveRatio: 500, per: 8, pbr: 0.8, revenueGrowth: 10, opIncomeGrowth: 5, annual: [yr("2023.12", 1000, 10, -1)] });
    expect(r.grade).toBe("A");
    expect(r.excluded).toBe(true);
  });
  it("lets hard thresholds be overridden", () => {
    expect(screenFundamentals({ debtRatio: 250 }, { hard: { debtRatioMax: 200 } }).excluded).toBe(true);
  });
});

describe("screening v2 — 실적 A/B 그룹(M2-03)", () => {
  it("is A when revenue, operating and net income all grew for three confirmed years", () => {
    const r = screenFundamentals({ annual: growing });
    expect(r.growthGroup).toBe("A");
    expect(byId(r.checks, "growth3y").status).toBe("pass");
    expect(growthGroupOf(growing).group).toBe("A"); // 2024.12(E)의 감소는 무시
  });
  it("is B when any item fell or stayed flat", () => {
    const fell = [yr("2021.12", 1000, 100, 80), yr("2022.12", 1200, 90, 100), yr("2023.12", 1500, 160, 120)];
    expect(growthGroupOf(fell)).toEqual({ group: "B", weak: ["영업이익"] });
    const flat = [yr("2021.12", 1000, 100, 80), yr("2022.12", 1000, 130, 100), yr("2023.12", 1500, 160, 120)];
    expect(growthGroupOf(flat).group).toBe("B");
    const r = screenFundamentals({ annual: fell });
    expect(r.growthGroup).toBe("B");
    expect(byId(r.checks, "growth3y")).toMatchObject({ status: "fail", value: "영업이익 감소·정체(B그룹)" });
    // 두 해만 있어도 감소는 감소
    expect(growthGroupOf([yr("2022.12", 1000, 100, 80), yr("2023.12", 900, 110, 90)]).group).toBe("B");
  });
  it("is null (unknown) when fewer than three confirmed years or values are missing", () => {
    expect(growthGroupOf([yr("2022.12", 1000, 100, 80), yr("2023.12", 1100, 110, 90)]).group).toBeNull();
    const gap = [yr("2021.12", 1000, 100, 80), { period: "2022.12", estimate: false, revenue: 1100, opIncome: 110 }, yr("2023.12", 1200, 120, 100)];
    expect(growthGroupOf(gap).group).toBeNull();
    expect(byId(screenFundamentals({ annual: gap }).checks, "growth3y").status).toBe("unknown");
  });
  it("uses only the most recent N years", () => {
    const old = [yr("2020.12", 2000, 300, 200), ...growing.slice(0, 3)];
    expect(growthGroupOf(old).group).toBe("A");
    expect(screenFundamentals({ annual: old }, { rules: { growthYears: 4 } }).growthGroup).toBe("B");
  });
});

describe("screening v2 — 분기 EPS 전년 동기 대비(M2-05)", () => {
  it("compares the latest confirmed quarter with the same quarter a year earlier", () => {
    const y = quarterlyEpsYoY(quarters)!;
    expect(y.cur.period).toBe("2024.06"); // 2024.09(E)는 건너뜀
    expect(y.prev.period).toBe("2023.06");
    expect(y.pct).toBeCloseTo(30);
    const r = screenFundamentals({ quarterly: quarters });
    expect(byId(r.checks, "epsYoY")).toMatchObject({ status: "pass", value: "+30%" });
    expect(r.metrics.epsYoY).toBeCloseTo(30);
  });
  it("fails below +25%", () => {
    const qs = quarters.map((p) => (p.period === "2024.06" ? { ...p, eps: 360 } : p));
    expect(byId(screenFundamentals({ quarterly: qs }).checks, "epsYoY").status).toBe("fail");
    expect(byId(screenFundamentals({ quarterly: qs }, { rules: { epsYoYMin: 15 } }).checks, "epsYoY").status).toBe("pass");
  });
  it("is unknown without the year-ago quarter and handles losses", () => {
    expect(byId(screenFundamentals({ quarterly: quarters.slice(1) }).checks, "epsYoY").status).toBe("unknown");
    const turn = screenFundamentals({ quarterly: [q("2023.06", -50), q("2024.06", 40)] });
    expect(byId(turn.checks, "epsYoY")).toMatchObject({ status: "unknown", value: "흑자 전환" });
    const loss = screenFundamentals({ quarterly: [q("2023.06", -50), q("2024.06", -10)] });
    expect(byId(loss.checks, "epsYoY")).toMatchObject({ status: "fail", value: "적자" });
  });
  it("falls back to four slots earlier when period labels are unreadable", () => {
    const qs = ["Q1", "Q2", "Q3", "Q4", "Q5"].map((p, i) => q(p, i === 4 ? 150 : 100));
    expect(quarterlyEpsYoY(qs)!.pct).toBeCloseTo(50);
  });
});

describe("screening v2 — 업종 PER(M2-06)·ROE(M2-07)", () => {
  it("passes when PER is below the sector PER", () => {
    expect(byId(screenFundamentals({ per: 8, sectorPer: 12 }).checks, "sectorPer")).toMatchObject({ status: "pass", value: "8배 / 업종 12배" });
    expect(byId(screenFundamentals({ per: 12, sectorPer: 12 }).checks, "sectorPer").status).toBe("fail");
    expect(byId(screenFundamentals({ per: -3, sectorPer: 12 }).checks, "sectorPer").status).toBe("fail"); // 적자
  });
  it("is unknown without PER or a usable sector PER", () => {
    expect(byId(screenFundamentals({ per: 8 }).checks, "sectorPer").status).toBe("unknown");
    expect(byId(screenFundamentals({ sectorPer: 12 }).checks, "sectorPer")).toMatchObject({ status: "unknown", value: "업종 12배" });
    expect(byId(screenFundamentals({ per: 8, sectorPer: -4 }).checks, "sectorPer").status).toBe("unknown");
  });
  it("mentions the sector PER in the PER hint when available", () => {
    expect(byId(screenFundamentals({ per: 8, sectorPer: 12 }).checks, "per").hint).toContain("12배");
  });
  it("checks ROE ≥ 5%", () => {
    expect(byId(screenFundamentals({ roe: 5 }).checks, "roe").status).toBe("pass");
    expect(byId(screenFundamentals({ roe: 4.9 }).checks, "roe").status).toBe("fail");
    expect(byId(screenFundamentals({ roe: 6 }, { rules: { roeMin: 8 } }).checks, "roe").status).toBe("fail");
  });
  it("counts the new soft checks in the grade", () => {
    // 확인된 5개(부채·PER·업종PER·3년 실적·ROE) 중 1개 통과 → 20% → D
    expect(screenFundamentals({ roe: 3, per: 30, sectorPer: 12, annual: [yr("2021.12", 3, 3, 3), yr("2022.12", 2, 2, 2), yr("2023.12", 4, 4, 4)], debtRatio: 100 }).grade).toBe("D");
    const good = screenFundamentals({ roe: 12, per: 8, sectorPer: 12, annual: growing, quarterly: quarters });
    expect(good.passed).toBe(good.known);
    expect(good.grade).toBe("A");
  });
});

describe("screening v2 — 린치형 성장주 후보(M2-08)", () => {
  // 연간 EPS 1250 → 1500: +20% → PEG = PER / 20
  const base: Fundamentals = { per: 15, debtRatio: 40, annual: growing };
  it("tags low PER, low debt, positive EPS growth and PEG ≤ 1", () => {
    expect(annualEpsGrowth(growing)).toBeCloseTo(20);
    const r = screenFundamentals(base);
    expect(r.tags).toEqual([TAG_LYNCH]);
    expect(r.metrics.peg).toBeCloseTo(0.75);
  });
  it("does not tag when any condition is missed", () => {
    expect(screenFundamentals({ ...base, debtRatio: 50 }).tags).toEqual([]);
    expect(screenFundamentals({ ...base, per: 21 }).tags).toEqual([]);
    expect(screenFundamentals({ ...base, per: 20.5, debtRatio: 10 }, { lynch: { perMax: 25 } }).tags).toEqual([]); // PEG 1.03
    expect(screenFundamentals({ ...base, per: -5 }).tags).toEqual([]);
    expect(screenFundamentals({ ...base, annual: [yr("2022.12", 1, 1, 1, 1500), yr("2023.12", 1, 1, 1, 1200)] }).tags).toEqual([]);
    expect(screenFundamentals({ per: 15, annual: growing }).tags).toEqual([]); // 부채비율 모름
  });
});

describe("screening v2 — 근거 Note", () => {
  it("explains exclusions, the growth group and tags with rule ids", () => {
    const notes = screeningNotes(screenFundamentals({ debtRatio: 420, annual: [yr("2022.12", 1000, 100, 80, 100), yr("2023.12", 900, -5, 70, 120)] }));
    expect(notes.find((n) => n.rule === "M2-01 설춘환")).toMatchObject({ tone: "bad" });
    expect(notes.find((n) => n.rule === "M2-04 설춘환")!.text).toContain("영업이익 적자(2023.12)");
    expect(notes.find((n) => n.rule === "M2-03 설춘환")).toMatchObject({ tone: "warn" });
    const lynch = screeningNotes(screenFundamentals({ per: 15, debtRatio: 40, annual: growing }));
    expect(lynch.map((n) => n.rule)).toEqual(["M2-03 설춘환", "M2-08 박병창(린치)"]);
  });
});

describe("screening v2 — 기준일(asOf)과 미래 참조 방지", () => {
  it("computes disclosure deadlines (quarter +45 days, annual +90 days)", () => {
    expect(disclosedBy("2024.06", 45)).toBe("2024-08-14");
    expect(disclosedBy("2024.12", 90)).toBe("2025-03-31");
    expect(disclosedBy("최근", 45)).toBeUndefined();
  });
  it("keeps only periods disclosed by the as-of date; the fiscal-year-end quarter waits for the annual report", () => {
    const f: Fundamentals = { annual: growing, quarterly: quarters };
    const at = confirmedPeriods(f, "2024-03-15");
    expect(at.annual.map((p) => p.period)).toEqual(["2021.12", "2022.12"]); // 2023.12 사업보고서는 2024-03-30까지
    expect(at.quarterly.map((p) => p.period)).toEqual(["2023.06", "2023.09"]); // 2023.12 분기도 사업보고서로 나옴
    expect(confirmedPeriods(f, "2024-08-14").quarterly.map((p) => p.period)).toEqual(["2023.06", "2023.09", "2023.12", "2024.03", "2024.06"]);
    expect(confirmedPeriods(f).annual).toHaveLength(3); // 기준일이 없으면 추정치만 뺀다
  });
  it("gives the same result when data disclosed after the as-of date changes", () => {
    const asOf = "2024-05-20";
    const past: Fundamentals = { per: 9, sectorPer: 12, debtRatio: 40, annual: growing.slice(0, 3), quarterly: quarters.slice(0, 4) };
    const futureA: Fundamentals = { ...past, annual: [...growing.slice(0, 3), yr("2024.12", 100, -50, -60, -100)], quarterly: [...quarters.slice(0, 4), q("2024.06", 1), q("2024.09", 999)] };
    const futureB: Fundamentals = { ...past, annual: [...growing.slice(0, 3), yr("2024.12", 9000, 900, 800, 9000)], quarterly: [...quarters.slice(0, 4), q("2024.06", 5000), q("2024.12", 1, true)] };
    const base = screenFundamentals(past, { asOf });
    expect(screenFundamentals(futureA, { asOf })).toEqual(base);
    expect(screenFundamentals(futureB, { asOf })).toEqual(base);
    // 기준일 없이 보면 미래 값이 결과를 바꾼다(위 비교가 의미 있다는 확인)
    expect(screenFundamentals(futureA).excluded).toBe(true);
    expect(base.excluded).toBe(false);
    expect(base.growthGroup).toBe("A");
  });
  it("assumes a December fiscal year when there is no annual data", () => {
    const qs = confirmedPeriods({ quarterly: quarters }, "2024-03-15").quarterly.map((p) => p.period);
    expect(qs).toEqual(["2023.06", "2023.09"]); // 2023.12 분기는 2024-03-30까지 기다린다
  });
  it("drops periods with unreadable labels when an as-of date is given", () => {
    expect(confirmedPeriods({ quarterly: [q("Q1", 1)] }, "2030-01-01").quarterly).toEqual([]);
  });
});
