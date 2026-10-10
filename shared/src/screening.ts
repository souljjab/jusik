import type { Fundamentals, Note, PeriodFinancials } from "./types";

export type CheckStatus = "pass" | "fail" | "unknown";

export interface Check {
  id: string;
  group: "안정성" | "저평가" | "실적";
  label: string;
  /** 통과 기준 설명(예: "150% 이하") */
  rule: string;
  value: string;
  status: CheckStatus;
  /** 참고 설명 */
  hint?: string;
  /** 근거 규칙 ID와 출처(예: "M2-02 설춘환"). Note.rule과 같은 형식. `rule`은 이미 기준 설명이라 이름을 달리했다 */
  ruleId?: string;
}

export type Grade = "A" | "B" | "C" | "D" | "N/A";

/** M2-03 실적 그룹: A=3년 연속 세 항목 증가, B=하나라도 감소(정체 포함), null=데이터 부족 */
export type GrowthGroup = "A" | "B" | null;

export interface ScreeningResult {
  grade: Grade;
  passed: number;
  known: number;
  total: number;
  /** 소프트 체크(가점). 등급은 이 목록에서 확인된 항목의 통과 비율로 매긴다 */
  checks: Check[];
  /** 하드 필터(M2-01·M2-04)에 걸려 추천 후보에서 빼야 하는지. 등급과 별개 */
  excluded: boolean;
  /** 하드 필터 점검 결과 전체. status "fail"이 제외 사유, "unknown"은 데이터 없음(제외하지 않음) */
  exclusions: Check[];
  growthGroup: GrowthGroup;
  /** 꼬리표(예: TAG_LYNCH) */
  tags: string[];
  /** 계산에 쓴 파생 지표(%, 배) */
  metrics: { epsYoY?: number; epsGrowth?: number; peg?: number };
}

/**
 * 소프트 체크 기준 — 『알짜 주식 선정 노하우 9가지』(설춘환) 등. 저자 경험 기준이며 검증된 통계가 아니다.
 * 자료집 3.1(안정성)·3.2(실적)·3.3(밸류에이션), 부록 A M2-02·M2-03·M2-05·M2-07.
 */
export const SCREEN_RULES = {
  debtRatioMax: 150,
  currentRatioMin: 100,
  reserveRatioMin: 200,
  perMax: 10,
  pbrMax: 1,
  /** M2-07 설춘환: 당시 BBB 1년 회사채 수익률(약 4%) 대비. 금리 수준에 따라 옮겨야 한다 */
  roeMin: 5,
  /** M2-05 박용선이 소개한 오닐 기준(분기 EPS 전년 동기 대비 25~50% 이상)의 하단 */
  epsYoYMin: 25,
  /** M2-03 설춘환 '3년 연속 증가' — 최근 확정 연간 값 몇 개를 볼지 */
  growthYears: 3,
} as const;

/** 하드 필터(제외) 기준 — 자료집 3.1 표의 '제외 기준'(설춘환, M2-01) */
export const HARD_RULES = { debtRatioMax: 300, currentRatioMin: 50 } as const;

/**
 * M2-08 린치형 성장주 후보 — 박병창이 소개한 피터 린치 기준(PER 20 이하, 부채비율 50% 미만, 낮은 PEG).
 * 자료집에는 '낮은 PEG'로만 나와 PEG 1 이하는 흔히 쓰는 기준선을 썼다.
 */
export const LYNCH_RULES = { perMax: 20, debtRatioMax: 50, pegMax: 1 } as const;

/** 공시 지연(일) — 자료집 3.6(설춘환): 분기·반기보고서는 분기 말부터 45일, 사업보고서는 결산일부터 90일 이내 */
export const DISCLOSURE_LAG_DAYS = { quarterly: 45, annual: 90 } as const;

export const TAG_LYNCH = "성장주 후보(린치)";

type Params<T> = { -readonly [K in keyof T]: number };

export interface ScreenOptions {
  /**
   * 기준일(YYYY-MM-DD). 주면 그날까지 공시가 끝났을 연간·분기 실적만 쓴다(백테스트용 미래 참조 방지).
   * PER·부채비율 같은 단일 값은 현재 스냅숏이라 거를 수 없다.
   */
  asOf?: string;
  /** 기준값 덮어쓰기(백테스트·전략별 조정용) */
  rules?: Partial<Params<typeof SCREEN_RULES>>;
  hard?: Partial<Params<typeof HARD_RULES>>;
  lynch?: Partial<Params<typeof LYNCH_RULES>>;
}

const f1 = (n: number, u: string) => `${n.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${u}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${f1(n, "%")}`;

/** undefined 값은 기본값을 덮지 않는다 */
function merge<T extends Record<string, number>>(base: T, over: Partial<Record<keyof T, number>> | undefined): Params<T> {
  const out = { ...base } as Params<T>;
  for (const [k, v] of Object.entries(over ?? {})) if (typeof v === "number") (out as Record<string, number>)[k] = v;
  return out;
}

function check(
  id: string,
  group: Check["group"],
  label: string,
  rule: string,
  v: number | undefined,
  unit: string,
  ok: (n: number) => boolean,
  ruleId: string,
  hint?: string,
): Check {
  return { id, group, label, rule, value: v == null ? "-" : f1(v, unit), status: v == null ? "unknown" : ok(v) ? "pass" : "fail", hint, ruleId };
}

/**
 * 유동비율 ≥ min 판단. 유동비율이 없으면 당좌비율로 대신한다 —
 * 당좌자산 ⊂ 유동자산이라 당좌비율 ≥ min이면 유동비율도 min 이상이다(그 반대는 알 수 없어 unknown).
 */
function currentCheck(base: Omit<Check, "value" | "status">, x: Fundamentals, min: number): Check {
  if (x.currentRatio != null) return { ...base, value: f1(x.currentRatio, "%"), status: x.currentRatio >= min ? "pass" : "fail" };
  if (x.quickRatio == null) return { ...base, value: "-", status: "unknown" };
  const value = `당좌 ${f1(x.quickRatio, "%")}`;
  if (x.quickRatio >= min) return { ...base, value, status: "pass", hint: "유동비율이 없어 당좌비율로 판단했어요(당좌비율은 유동비율보다 작거나 같아요)" };
  return { ...base, value, status: "unknown", hint: "유동비율이 없고 당좌비율만으로는 판단할 수 없어요" };
}

/** "2024.12", "2024-06", "2024/03(E)" → 연·월 */
function yearMonth(period: string): { y: number; m: number } | undefined {
  const r = /(\d{4})\D(\d{1,2})/.exec(period);
  if (!r) return undefined;
  const y = Number(r[1]), m = Number(r[2]);
  return m >= 1 && m <= 12 ? { y, m } : undefined;
}

/** 결산 기간 라벨 → 그 달 말일부터 lagDays가 지난 날짜(YYYY-MM-DD). 라벨을 못 읽으면 undefined */
export function disclosedBy(period: string, lagDays: number): string | undefined {
  const p = yearMonth(period);
  if (!p) return undefined;
  return new Date(Date.UTC(p.y, p.m, 0) + lagDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 판단에 쓸 확정 실적만 남긴다: 추정치 제외, asOf가 있으면 그날까지 공시됐을 기간만.
 * 결산월 분기(예: 12월 결산의 4분기)는 사업보고서로 나오므로 연간 지연을 쓴다.
 * 연간 실적이 없어 결산월을 모르면 국내에 가장 흔한 12월 결산으로 본다.
 */
export function confirmedPeriods(f: Fundamentals | undefined, asOf?: string): { annual: PeriodFinancials[]; quarterly: PeriodFinancials[] } {
  const fyMonths = new Set((f?.annual ?? []).map((p) => yearMonth(p.period)?.m).filter((m): m is number => m != null));
  if (!fyMonths.size) fyMonths.add(12);
  const keep = (p: PeriodFinancials, lag: number) => {
    if (p.estimate) return false;
    if (!asOf) return true;
    if (p.filed) return p.filed <= asOf; // 실제 제출일을 알면 그 날짜로
    const d = disclosedBy(p.period, lag);
    return d != null && d <= asOf; // 날짜를 모르면 공시 여부를 장담할 수 없어 뺀다
  };
  return {
    annual: (f?.annual ?? []).filter((p) => keep(p, DISCLOSURE_LAG_DAYS.annual)),
    quarterly: (f?.quarterly ?? []).filter((p) =>
      keep(p, fyMonths.has(yearMonth(p.period)?.m ?? 0) ? DISCLOSURE_LAG_DAYS.annual : DISCLOSURE_LAG_DAYS.quarterly),
    ),
  };
}

const GROWTH_ITEMS = [["revenue", "매출"], ["opIncome", "영업이익"], ["netIncome", "순이익"]] as const;

/**
 * M2-03(설춘환): 최근 years개 확정 연간 값에서 매출·영업이익·순이익이 매년 늘었는지.
 * 하나라도 줄거나 그대로면 B, 모두 늘었으면 A, 판단할 값이 모자라면 null. annual은 오래된 → 최신 순서.
 */
export function growthGroupOf(annual: PeriodFinancials[], years: number = SCREEN_RULES.growthYears): { group: GrowthGroup; weak: string[] } {
  const n = Math.max(2, years);
  const last = annual.filter((p) => !p.estimate).slice(-n);
  const weak: string[] = [];
  let complete = last.length >= n;
  for (const [k, name] of GROWTH_ITEMS) {
    for (let i = 1; i < last.length; i++) {
      const a = last[i - 1]![k], b = last[i]![k];
      if (a == null || b == null) continue;
      if (b <= a && !weak.includes(name)) weak.push(name);
    }
    if (last.some((p) => p[k] == null)) complete = false;
  }
  return { group: weak.length ? "B" : complete ? "A" : null, weak };
}

/**
 * M2-05: 최근 확정 분기 EPS와 전년 동기(같은 달 라벨, 라벨을 못 읽으면 4칸 앞) EPS.
 * 전년 동기 EPS가 0 이하면 증가율(pct)은 계산하지 않는다.
 */
export function quarterlyEpsYoY(quarterly: PeriodFinancials[]): { cur: PeriodFinancials; prev: PeriodFinancials; pct?: number } | undefined {
  const qs = quarterly.filter((p) => !p.estimate);
  let ci = -1;
  for (let i = qs.length - 1; i >= 0; i--) if (qs[i]!.eps != null) { ci = i; break; }
  if (ci < 0) return undefined;
  const cur = qs[ci]!;
  const ym = yearMonth(cur.period);
  const prev = ym ? qs.find((p) => { const o = yearMonth(p.period); return o?.y === ym.y - 1 && o.m === ym.m; }) : qs[ci - 4];
  if (prev?.eps == null) return undefined;
  return { cur, prev, pct: prev.eps > 0 ? ((cur.eps! - prev.eps) / prev.eps) * 100 : undefined };
}

/** 최근 두 확정 연간 EPS의 증가율 %(앞 해가 0 이하면 undefined) */
export function annualEpsGrowth(annual: PeriodFinancials[]): number | undefined {
  const eps = annual.filter((p) => !p.estimate && p.eps != null).map((p) => p.eps!);
  if (eps.length < 2) return undefined;
  const prev = eps[eps.length - 2]!, cur = eps[eps.length - 1]!;
  return prev > 0 ? ((cur - prev) / prev) * 100 : undefined;
}

const lastValue = (list: PeriodFinancials[], k: "opIncome" | "netIncome") => {
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i]![k];
    if (v != null) return { v, period: list[i]!.period };
  }
  return undefined;
};

/** M2-04(설춘환): 최근 확정 연간 영업이익·순이익 중 하나라도 0 이하면 흑자 전환 전까지 제외 */
function lossCheck(annual: PeriodFinancials[]): Check {
  const base = { id: "x-loss", group: "실적" as const, label: "흑자 여부", rule: "최근 확정 연간 영업이익·순이익 0 이하", ruleId: "M2-04 설춘환" };
  const op = lastValue(annual, "opIncome"), net = lastValue(annual, "netIncome");
  const losses = [op && op.v <= 0 ? `영업이익 적자(${op.period})` : "", net && net.v <= 0 ? `순이익 적자(${net.period})` : ""].filter(Boolean);
  if (losses.length) return { ...base, value: losses.join(", "), status: "fail", hint: "흑자로 돌아설 때까지 관심 종목에 넣지 않아요" };
  if (!op || !net) return { ...base, value: op || net ? "일부만 확인" : "-", status: "unknown" };
  return { ...base, value: "흑자", status: "pass" };
}

export function screenFundamentals(f: Fundamentals | undefined, opt: ScreenOptions = {}): ScreeningResult {
  const R = merge(SCREEN_RULES, opt.rules);
  const H = merge(HARD_RULES, opt.hard);
  const L = merge(LYNCH_RULES, opt.lynch);
  const x = f ?? {};
  const { annual, quarterly } = confirmedPeriods(f, opt.asOf);

  // ── 소프트 체크(등급 계산) ──
  const growth = growthGroupOf(annual, R.growthYears);
  const yoy = quarterlyEpsYoY(quarterly);
  const growthCheck: Check = {
    id: "growth3y", group: "실적", label: `${R.growthYears}년 연속 실적 증가`, rule: "매출·영업이익·순이익 매년 증가", ruleId: "M2-03 설춘환",
    value: growth.group === "A" ? "모두 증가(A그룹)" : growth.group === "B" ? `${growth.weak.join("·")} 감소·정체(B그룹)` : "-",
    status: growth.group === "A" ? "pass" : growth.group === "B" ? "fail" : "unknown",
    hint: growth.group === "B" ? "B그룹은 A그룹보다 소극적으로 접근해요" : undefined,
  };
  const epsCheck: Check = { id: "epsYoY", group: "실적", label: "분기 EPS 전년 동기 대비", rule: `+${R.epsYoYMin}% 이상`, ruleId: "M2-05 박용선(오닐)", value: "-", status: "unknown" };
  if (yoy) {
    epsCheck.hint = `${yoy.cur.period} ${f1(yoy.cur.eps!, "")} / ${yoy.prev.period} ${f1(yoy.prev.eps!, "")}`;
    if (yoy.pct != null) {
      epsCheck.value = pct(yoy.pct);
      epsCheck.status = yoy.pct >= R.epsYoYMin ? "pass" : "fail";
    } else if (yoy.cur.eps! > 0) {
      // 전년 동기 적자 → 흑자: 증가율이 정의되지 않아 등급에서 뺀다
      epsCheck.value = "흑자 전환";
      epsCheck.hint += " · 전년 동기가 적자라 증가율을 계산할 수 없어요";
    } else {
      epsCheck.value = "적자";
      epsCheck.status = "fail";
    }
  }
  const sp = x.sectorPer != null && x.sectorPer > 0 ? x.sectorPer : undefined;
  const sectorCheck: Check = {
    id: "sectorPer", group: "저평가", label: "업종 대비 PER", rule: "동일업종 PER 미만", ruleId: "M2-06 설춘환",
    value: sp == null ? "-" : x.per == null ? `업종 ${f1(sp, "배")}` : `${f1(x.per, "배")} / 업종 ${f1(sp, "배")}`,
    status: sp == null || x.per == null ? "unknown" : x.per > 0 && x.per < sp ? "pass" : "fail",
  };
  const perHint = sp != null ? `동일업종 PER은 ${f1(sp, "배")}예요` : "동일 업종 평균과 비교해야 해요(업종 평균 데이터가 없어요)";

  const checks: Check[] = [
    check("debt", "안정성", "부채비율", `${R.debtRatioMax}% 이하`, x.debtRatio, "%", (n) => n <= R.debtRatioMax, "M2-02 설춘환"),
    currentCheck({ id: "current", group: "안정성", label: "유동비율", rule: `${R.currentRatioMin}% 이상`, ruleId: "M2-02 설춘환", hint: "1년 안에 갚을 빚을 감당할 현금성 자산이 있는지" }, x, R.currentRatioMin),
    check("reserve", "안정성", "유보율", `${R.reserveRatioMin}% 이상`, x.reserveRatio, "%", (n) => n >= R.reserveRatioMin, "M2-02 설춘환"),
    check("per", "저평가", "PER", `0 초과 ${R.perMax} 이하`, x.per, "배", (n) => n > 0 && n <= R.perMax, "3.3 설춘환", perHint),
    check("pbr", "저평가", "PBR", `${R.pbrMax} 이하`, x.pbr, "배", (n) => n > 0 && n <= R.pbrMax, "3.3 설춘환", "동일 업종 평균과 비교해야 해요(업종 PBR 데이터는 아직 없어요)"),
    sectorCheck,
    check("rev", "실적", "매출 증가율", "0% 초과", x.revenueGrowth, "%", (n) => n > 0, "3.2 설춘환"),
    check("op", "실적", "영업이익 증가율", "0% 초과", x.opIncomeGrowth, "%", (n) => n > 0, "3.2 설춘환"),
    growthCheck,
    epsCheck,
    check("roe", "실적", "ROE", `${R.roeMin}% 이상`, x.roe, "%", (n) => n >= R.roeMin, "M2-07 설춘환", "기준은 금리 수준(BBB 회사채 수익률)에 따라 옮겨야 해요"),
  ];
  const known = checks.filter((c) => c.status !== "unknown");
  const passed = known.filter((c) => c.status === "pass").length;
  let grade: Grade = "N/A";
  if (known.length >= 3) {
    const ratio = passed / known.length;
    grade = ratio >= 0.8 ? "A" : ratio >= 0.6 ? "B" : ratio >= 0.4 ? "C" : "D";
  }

  // ── 하드 필터(제외) ── status "pass" = 제외 기준에 걸리지 않음
  const exclusions: Check[] = [
    check("x-debt", "안정성", "부채비율", `${H.debtRatioMax}% 초과`, x.debtRatio, "%", (n) => n <= H.debtRatioMax, "M2-01 설춘환"),
    currentCheck({ id: "x-current", group: "안정성", label: "유동비율", rule: `${H.currentRatioMin}% 미만`, ruleId: "M2-01 설춘환" }, x, H.currentRatioMin),
    lossCheck(annual),
  ];

  // ── M2-08 린치형 성장주 후보 ──
  const epsGrowth = annualEpsGrowth(annual);
  const peg = x.per != null && x.per > 0 && epsGrowth != null && epsGrowth > 0 ? x.per / epsGrowth : undefined;
  const tags: string[] = [];
  if (peg != null && x.per! <= L.perMax && x.debtRatio != null && x.debtRatio < L.debtRatioMax && peg <= L.pegMax) tags.push(TAG_LYNCH);

  return {
    grade,
    passed,
    known: known.length,
    total: checks.length,
    checks,
    excluded: exclusions.some((c) => c.status === "fail"),
    exclusions,
    growthGroup: growth.group,
    tags,
    metrics: { epsYoY: yoy?.pct, epsGrowth, peg },
  };
}

/** 화면 근거용 Note: 제외 사유, 실적 그룹(A/B), 꼬리표 */
export function screeningNotes(r: ScreeningResult): Note[] {
  const notes: Note[] = [];
  for (const c of r.exclusions) {
    if (c.status !== "fail") continue;
    const what = c.id === "x-loss" ? c.value : `${c.label} ${c.value}`;
    notes.push({ tone: "bad", text: `${what} — 제외 기준(${c.rule})이라 추천 후보에서 빼요`, rule: c.ruleId });
  }
  if (r.growthGroup === "A") notes.push({ tone: "good", text: "매출·영업이익·순이익이 해마다 늘었어요(A그룹)", rule: "M2-03 설춘환" });
  else if (r.growthGroup === "B") notes.push({ tone: "warn", text: "실적 세 항목 중 줄었거나 그대로인 게 있어요(B그룹). 더 소극적으로 접근하세요", rule: "M2-03 설춘환" });
  if (r.tags.includes(TAG_LYNCH) && r.metrics.peg != null)
    notes.push({ tone: "good", text: `PER·부채비율이 낮고 PEG ${f1(r.metrics.peg, "")}로 린치형 성장주 후보예요`, rule: "M2-08 박병창(린치)" });
  return notes;
}
