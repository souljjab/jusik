import type { Fundamentals } from "./types";

export type CheckStatus = "pass" | "fail" | "unknown";

export interface Check {
  id: string;
  group: "안정성" | "저평가" | "실적";
  label: string;
  rule: string;
  value: string;
  status: CheckStatus;
  /** 참고 설명 */
  hint?: string;
}

export type Grade = "A" | "B" | "C" | "D" | "N/A";

export interface ScreeningResult {
  grade: Grade;
  passed: number;
  known: number;
  total: number;
  checks: Check[];
}

/** 『알짜 주식 선정 노하우 9가지』의 수치 기준. 저자 경험 기준이며 검증된 통계가 아니다. */
export const SCREEN_RULES = { debtRatioMax: 150, currentRatioMin: 100, reserveRatioMin: 200, perMax: 10, pbrMax: 1 } as const;

const f1 = (n: number, u: string) => `${n.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${u}`;

function check(
  id: string,
  group: Check["group"],
  label: string,
  rule: string,
  v: number | undefined,
  unit: string,
  ok: (n: number) => boolean,
  hint?: string,
): Check {
  return { id, group, label, rule, value: v == null ? "-" : f1(v, unit), status: v == null ? "unknown" : ok(v) ? "pass" : "fail", hint };
}

export function screenFundamentals(f: Fundamentals | undefined): ScreeningResult {
  const R = SCREEN_RULES;
  const x = f ?? {};
  const checks: Check[] = [
    check("debt", "안정성", "부채비율", `${R.debtRatioMax}% 이하`, x.debtRatio, "%", (n) => n <= R.debtRatioMax),
    check("current", "안정성", "유동비율", `${R.currentRatioMin}% 이상`, x.currentRatio, "%", (n) => n >= R.currentRatioMin, "1년 안에 갚을 빚을 감당할 현금성 자산이 있는지"),
    check("reserve", "안정성", "유보율", `${R.reserveRatioMin}% 이상`, x.reserveRatio, "%", (n) => n >= R.reserveRatioMin),
    check("per", "저평가", "PER", `0 초과 ${R.perMax} 이하`, x.per, "배", (n) => n > 0 && n <= R.perMax, "동일 업종 평균과 비교해야 해요(업종 평균 데이터는 아직 없음)"),
    check("pbr", "저평가", "PBR", `${R.pbrMax} 이하`, x.pbr, "배", (n) => n > 0 && n <= R.pbrMax, "동일 업종 평균과 비교해야 해요(업종 평균 데이터는 아직 없음)"),
    check("rev", "실적", "매출 증가율", "0% 초과", x.revenueGrowth, "%", (n) => n > 0),
    check("op", "실적", "영업이익 증가율", "0% 초과", x.opIncomeGrowth, "%", (n) => n > 0),
  ];
  const known = checks.filter((c) => c.status !== "unknown");
  const passed = known.filter((c) => c.status === "pass").length;
  let grade: Grade = "N/A";
  if (known.length >= 3) {
    const ratio = passed / known.length;
    grade = ratio >= 0.8 ? "A" : ratio >= 0.6 ? "B" : ratio >= 0.4 ? "C" : "D";
  }
  return { grade, passed, known: known.length, total: checks.length, checks };
}
