import { DEFAULT_SETTINGS, GUARD_DEFAULTS, MACRO_PARAMS, POSTURE_LABEL, type Posture, type Settings } from "@jusik/shared";

/*
 * 설정 화면 계산(UI 지도서 2장 전역·3.1·9.3). 입력 칸은 덜 친 값도 들고 있어야 해서 글자로 두고,
 * 저장할 때 숫자로 바꿔 범위를 확인한다. 범위는 서버(sanitizeSettings)와 같다 — 서버는 범위 밖 값을 조용히 맞추므로
 * 화면에서 먼저 막아 '저장했는데 다른 값'이 되지 않게 한다.
 */

// ───────────────────────── 구역 ─────────────────────────

export type SectionId = "display" | "alerts" | "limits" | "paper" | "data" | "about";
export const SECTION_IDS: SectionId[] = ["display", "alerts", "limits", "paper", "data", "about"];
export const SECTION_LABEL: Record<SectionId, string> = {
  display: "화면", alerts: "알림", limits: "매매 한도", paper: "모의계좌", data: "데이터·내보내기", about: "정보",
};
export function sectionOf(seg: string | undefined): SectionId | null {
  return seg && (SECTION_IDS as string[]).includes(seg) ? (seg as SectionId) : null;
}

// ───────────────────────── 매매 한도 ─────────────────────────

export type LimitKey =
  | "depositKRW" | "depositUSD" | "riskPct" | "maxWeightPct" | "maxPositions" | "reservePct"
  | "capATTACK" | "capNEUTRAL" | "capDEFENSE" | "dailyLossLimitPct" | "maxConsecutiveLosses";
export type LimitsDraft = Record<LimitKey, string>;

export interface LimitSpec {
  min: number;
  max: number;
  integer?: boolean;
  label: string;
  unit: string;
}

export const LIMIT_SPEC: Record<LimitKey, LimitSpec> = {
  depositKRW: { min: 0, max: 1e13, integer: true, label: "원화 예수금", unit: "원" },
  depositUSD: { min: 0, max: 1e10, label: "달러 예수금", unit: "달러" },
  riskPct: { min: 0.1, max: 10, label: "1회 손실 비율", unit: "%" },
  maxWeightPct: { min: 1, max: 100, label: "종목 비중 상한", unit: "%" },
  maxPositions: { min: 1, max: 10, integer: true, label: "최대 보유 종목 수", unit: "종목" },
  reservePct: { min: 0, max: 90, label: "예비 현금", unit: "%" },
  capATTACK: { min: 0, max: 100, label: `${POSTURE_LABEL.ATTACK} 국면 상한`, unit: "%" },
  capNEUTRAL: { min: 0, max: 100, label: `${POSTURE_LABEL.NEUTRAL} 국면 상한`, unit: "%" },
  capDEFENSE: { min: 0, max: 100, label: `${POSTURE_LABEL.DEFENSE} 국면 상한`, unit: "%" },
  dailyLossLimitPct: { min: 0, max: 50, label: "일일 손실 한도", unit: "%" },
  maxConsecutiveLosses: { min: 0, max: 20, integer: true, label: "연속 손실 휴식", unit: "회" },
};
export const LIMIT_KEYS = Object.keys(LIMIT_SPEC) as LimitKey[];
const CAP_KEY: Record<Posture, LimitKey> = { ATTACK: "capATTACK", NEUTRAL: "capNEUTRAL", DEFENSE: "capDEFENSE" };

/** 천 단위 쉼표를 붙여 보여 준다(소수점 아래는 그대로) */
export function withCommas(s: string): string {
  const [i = "", d] = s.split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return d === undefined ? int : `${int}.${d}`;
}
/** 입력 글자 정리: 숫자와 소수점 하나만 남긴다(integer면 소수점도 뺀다) */
export function cleanNumText(s: string, integer = false): string {
  let t = s.replace(/[^\d.]/g, "");
  if (integer) t = t.replace(/\./g, "");
  else {
    const at = t.indexOf(".");
    if (at >= 0) t = t.slice(0, at + 1) + t.slice(at + 1).replace(/\./g, "");
  }
  return t;
}
/** 글자 → 숫자. 비었거나 숫자가 아니면 null */
export function parseNum(s: string): number | null {
  const t = s.replace(/[,\s]/g, "");
  if (!t || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const str = (n: number) => String(Number(n.toFixed(4)));

export function limitsDraftOf(s: Settings): LimitsDraft {
  const caps = { ...DEFAULT_SETTINGS.postureCaps, ...s.postureCaps };
  return {
    depositKRW: str(s.depositKRW), depositUSD: str(s.depositUSD), riskPct: str(s.riskPct), maxWeightPct: str(s.maxWeightPct),
    maxPositions: str(s.maxPositions), reservePct: str(s.reservePct),
    capATTACK: str(caps.ATTACK), capNEUTRAL: str(caps.NEUTRAL), capDEFENSE: str(caps.DEFENSE),
    dailyLossLimitPct: str(s.dailyLossLimitPct ?? GUARD_DEFAULTS.dailyLossLimitPct),
    maxConsecutiveLosses: str(s.maxConsecutiveLosses ?? GUARD_DEFAULTS.maxConsecutiveLosses),
  };
}
export const DEFAULT_LIMITS: LimitsDraft = limitsDraftOf(DEFAULT_SETTINGS);

const fmtRange = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });

/** 칸별 오류(저장을 막는다): 비었음, 숫자 아님, 범위 밖, 정수가 아님 */
export function limitsErrors(d: LimitsDraft): Partial<Record<LimitKey, string>> {
  const out: Partial<Record<LimitKey, string>> = {};
  for (const k of LIMIT_KEYS) {
    const spec = LIMIT_SPEC[k];
    const n = parseNum(d[k]);
    if (n == null) out[k] = `${spec.label}을(를) 숫자로 넣어 주세요.`;
    else if (n < spec.min || n > spec.max) out[k] = `${fmtRange(spec.min)}~${fmtRange(spec.max)}${spec.unit === "원" || spec.unit === "달러" ? ` ${spec.unit}` : spec.unit} 사이로 넣어 주세요.`;
    else if (spec.integer && !Number.isInteger(n)) out[k] = "소수점 없이 정수로 넣어 주세요.";
  }
  return out;
}

export interface LimitWarning {
  text: string;
  rule?: string;
}

/** 저장은 되지만 책의 기준과 다른 값(막지 않고 알린다) */
export function limitsWarnings(d: LimitsDraft): LimitWarning[] {
  const n = (k: LimitKey) => parseNum(d[k]);
  const out: LimitWarning[] = [];
  const risk = n("riskPct"), weight = n("maxWeightPct"), daily = n("dailyLossLimitPct"), streak = n("maxConsecutiveLosses");
  const a = n("capATTACK"), m = n("capNEUTRAL"), f = n("capDEFENSE");
  if (risk != null && risk > GUARD_DEFAULTS.maxPerTradeRiskPct)
    out.push({ text: `1회 손실 비율 ${fmtRange(risk)}%가 책의 1회 손실 한도 ${GUARD_DEFAULTS.maxPerTradeRiskPct}%보다 커요.`, rule: "M4-04 슈웨거" });
  if (weight != null && weight > GUARD_DEFAULTS.maxWeightPct)
    out.push({ text: `종목 비중 상한 ${fmtRange(weight)}%가 책의 상한 ${GUARD_DEFAULTS.maxWeightPct}%보다 커요.`, rule: "M4-03 강영현" });
  if (a != null && m != null && f != null && (a < m || m < f))
    out.push({ text: "국면별 상한이 공격 ≥ 중립 ≥ 방어 순서가 아니에요. 의도한 값인지 확인하세요.", rule: "2.5 강동진" });
  if (daily === 0) out.push({ text: "일일 손실 한도를 0으로 두면 꺼져요. 하루 손실이 커져도 신규 매수를 멈추지 않아요.", rule: "M4-04 슈웨거" });
  if (streak === 0) out.push({ text: "연속 손실 휴식을 0으로 두면 꺼져요. 연속으로 손절해도 쉬라고 하지 않아요.", rule: "5.5 박용선·슈웨거" });
  return out;
}

/** 바뀐 칸(숫자로 비교해 '30'과 '30.0'은 같다고 본다) */
export function limitsChanged(saved: LimitsDraft, d: LimitsDraft): LimitKey[] {
  return LIMIT_KEYS.filter((k) => {
    const a = parseNum(saved[k]), b = parseNum(d[k]);
    return a == null || b == null ? saved[k].trim() !== d[k].trim() : Math.abs(a - b) > 1e-9;
  });
}

/** 저장할 값(오류가 있으면 null). 한도 칸만 보내 다른 화면에서 고친 스캔 조건을 덮지 않는다 */
export function limitsPatch(d: LimitsDraft): Partial<Settings> | null {
  if (Object.keys(limitsErrors(d)).length) return null;
  const n = (k: LimitKey) => parseNum(d[k])!;
  return {
    depositKRW: Math.round(n("depositKRW")), depositUSD: n("depositUSD"), riskPct: n("riskPct"), maxWeightPct: n("maxWeightPct"),
    maxPositions: n("maxPositions"), reservePct: n("reservePct"),
    postureCaps: { ATTACK: n(CAP_KEY.ATTACK), NEUTRAL: n(CAP_KEY.NEUTRAL), DEFENSE: n(CAP_KEY.DEFENSE) },
    dailyLossLimitPct: n("dailyLossLimitPct"), maxConsecutiveLosses: n("maxConsecutiveLosses"),
  };
}

// ───────────────────────── 모의계좌 점검 주기 ─────────────────────────

export const MONITOR_RANGE = { min: 15, max: 3600 } as const;
export function monitorError(s: string): string | null {
  const n = parseNum(s);
  if (n == null) return "점검 주기를 초 단위 숫자로 넣어 주세요.";
  if (!Number.isInteger(n)) return "소수점 없이 정수로 넣어 주세요.";
  if (n < MONITOR_RANGE.min || n > MONITOR_RANGE.max) return `${MONITOR_RANGE.min}~${MONITOR_RANGE.max.toLocaleString("ko-KR")}초 사이로 넣어 주세요.`;
  return null;
}

// ───────────────────────── ISM 직접 입력(2.3 강영현·강동진) ─────────────────────────

export const ISM_MIN = 20;
export const ISM_MAX = 80;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface IsmDraft {
  value: string;
  month: string;
}
export const ismDraftOf = (m: Settings["ismManual"] | undefined): IsmDraft => (m ? { value: String(m.value), month: m.month } : { value: "", month: "" });

export type IsmParse = { ok: true; value: Settings["ismManual"] } | { ok: false; errors: { value?: string; month?: string } };

/** 둘 다 비면 null(직접 입력 지움). 하나만 채웠거나 범위 밖이면 칸별 오류 */
export function parseIsm(d: IsmDraft): IsmParse {
  const v = d.value.trim(), m = d.month.trim();
  if (!v && !m) return { ok: true, value: null };
  const errors: { value?: string; month?: string } = {};
  const n = parseNum(v);
  if (!v) errors.value = "PMI 값을 넣어 주세요.";
  else if (n == null || n < ISM_MIN || n > ISM_MAX) errors.value = `${ISM_MIN}~${ISM_MAX} 사이 값으로 넣어 주세요.`;
  if (!m) errors.month = "가리키는 달을 골라 주세요.";
  else if (!MONTH_RE.test(m)) errors.month = "달은 2026-09처럼 넣어 주세요.";
  if (errors.value || errors.month) return { ok: false, errors };
  return { ok: true, value: { value: Math.round(n! * 10) / 10, month: m } };
}

/** 이번 달(서버와 같이 UTC 날짜 기준) "YYYY-MM" */
export const thisMonthUtc = (now: Date) => now.toISOString().slice(0, 7);
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** 저장은 되지만 쓰이지 않을 값 안내(막지 않는다) */
export function ismNotes(v: Settings["ismManual"], now: Date): string[] {
  if (!v) return [];
  if (v.month >= thisMonthUtc(now)) return [`${v.month}은(는) 아직 끝나지 않은 달이라 쓰이지 않아요. ISM은 다음 달 첫 영업일에 지난달 값을 발표해요.`];
  const [y, m] = v.month.split("-").map(Number) as [number, number];
  // 발표일 ≈ 다음 달 1일(실제는 첫 영업일)
  const age = (now.getTime() - Date.UTC(y, m, 1)) / 86_400_000;
  if (age > MACRO_PARAMS.ismMaxAgeDays)
    return [`${v.month} 값은 발표된 지 ${MACRO_PARAMS.ismMaxAgeDays}일이 넘어 쓰이지 않고, 지역 연준 제조업 지수(대용)로 판단해요.`];
  return [];
}

export const sameIsm = (a: Settings["ismManual"], b: Settings["ismManual"]) => (a == null || b == null ? a == b : a.value === b.value && a.month === b.month);
