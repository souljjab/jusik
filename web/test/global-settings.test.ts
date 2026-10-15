import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@jusik/shared";
import {
  DEFAULT_LIMITS, cleanNumText, ismNotes, limitsChanged, limitsDraftOf, limitsErrors, limitsPatch, limitsWarnings, monitorError, parseIsm, parseNum,
  prevMonth, sameIsm, sectionOf, withCommas,
} from "../src/screens/settings/settingsModel";

describe("숫자 입력", () => {
  it("쉼표·정리·읽기", () => {
    expect(withCommas("10000000")).toBe("10,000,000");
    expect(withCommas("7000.5")).toBe("7,000.5");
    expect(cleanNumText("1,2a3.4.5")).toBe("123.45");
    expect(cleanNumText("12.5", true)).toBe("125");
    expect(parseNum("10,000")).toBe(10_000);
    expect(parseNum("")).toBeNull();
    expect(parseNum(".")).toBeNull();
  });
});

describe("매매 한도", () => {
  it("기본값 초안은 오류·경고가 없다", () => {
    expect(limitsErrors(DEFAULT_LIMITS)).toEqual({});
    expect(limitsWarnings(DEFAULT_LIMITS)).toEqual([]);
    expect(limitsChanged(limitsDraftOf(DEFAULT_SETTINGS), DEFAULT_LIMITS)).toEqual([]);
  });
  it("비었거나 범위 밖이거나 정수가 아니면 칸별 오류", () => {
    const e = limitsErrors({ ...DEFAULT_LIMITS, riskPct: "", maxWeightPct: "120", maxPositions: "2.5", depositKRW: "-1" });
    expect(Object.keys(e).sort()).toEqual(["depositKRW", "maxPositions", "maxWeightPct", "riskPct"]);
    expect(e.maxWeightPct).toMatch("1~100%");
    expect(e.maxPositions).toMatch("정수");
    expect(limitsPatch({ ...DEFAULT_LIMITS, riskPct: "" })).toBeNull();
  });
  it("책의 기준과 다르면 경고(막지 않음)", () => {
    const w = limitsWarnings({ ...DEFAULT_LIMITS, riskPct: "2", maxWeightPct: "40", capATTACK: "40", capNEUTRAL: "50", dailyLossLimitPct: "0", maxConsecutiveLosses: "0" });
    expect(w.map((x) => x.rule)).toEqual(["M4-04 슈웨거", "M4-03 강영현", "2.5 강동진", "M4-04 슈웨거", "5.5 박용선·슈웨거"]);
  });
  it("바뀐 칸은 숫자로 비교", () => {
    expect(limitsChanged(DEFAULT_LIMITS, { ...DEFAULT_LIMITS, riskPct: "1.0", maxWeightPct: "25" })).toEqual(["maxWeightPct"]);
  });
  it("저장 값은 한도 칸만, 국면 상한은 묶어서", () => {
    const p = limitsPatch({ ...DEFAULT_LIMITS, depositKRW: "20,000,000", capNEUTRAL: "45" })!;
    expect(p.depositKRW).toBe(20_000_000);
    expect(p.postureCaps).toEqual({ ATTACK: 80, NEUTRAL: 45, DEFENSE: 20 });
    expect(p).not.toHaveProperty("minScore");
    expect(p).not.toHaveProperty("paperEnabled");
  });
});

describe("점검 주기", () => {
  it("15~3600초 정수", () => {
    expect(monitorError("60")).toBeNull();
    expect(monitorError("5")).toMatch("15~3,600초");
    expect(monitorError("60.5")).toMatch("정수");
    expect(monitorError("")).toMatch("숫자");
  });
});

describe("ISM 직접 입력", () => {
  const now = new Date("2026-10-15T01:00:00Z");
  it("둘 다 비면 지움, 하나만 채우면 오류", () => {
    expect(parseIsm({ value: "", month: "" })).toEqual({ ok: true, value: null });
    const r = parseIsm({ value: "48.7", month: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.month).toBeTruthy();
    const r2 = parseIsm({ value: "90", month: "2026-09" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.value).toMatch("20~80");
    expect(parseIsm({ value: "48.74", month: "2026-09" })).toEqual({ ok: true, value: { value: 48.7, month: "2026-09" } });
  });
  it("끝나지 않은 달·오래된 값 안내", () => {
    expect(ismNotes({ value: 50, month: "2026-10" }, now)[0]).toMatch("끝나지 않은 달");
    expect(ismNotes({ value: 50, month: "2026-09" }, now)).toEqual([]);
    expect(ismNotes({ value: 50, month: "2026-05" }, now)[0]).toMatch("대용");
    expect(ismNotes(null, now)).toEqual([]);
  });
  it("prevMonth·sameIsm", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
    expect(prevMonth("2026-10")).toBe("2026-09");
    expect(sameIsm(null, null)).toBe(true);
    expect(sameIsm({ value: 1, month: "a" }, { value: 1, month: "a" })).toBe(true);
    expect(sameIsm(null, { value: 1, month: "a" })).toBe(false);
  });
});

describe("구역 경로", () => {
  it("sectionOf", () => {
    expect(sectionOf("limits")).toBe("limits");
    expect(sectionOf(undefined)).toBeNull();
    expect(sectionOf("nope")).toBeNull();
  });
});
