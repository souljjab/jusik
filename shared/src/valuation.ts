import { confirmedPeriods, type GrowthGroup } from "./screening";
import type { Candle, Fundamentals, Note, PeriodFinancials } from "./types";

/*
 * 밸류에이션: PER 밴드·PSR — 기초 자료집 3.3(밸류에이션 표: 안전마진 최병운, PER 밴드 하단 강영현, PSR 김연수·강영현),
 * 규칙 M2-09(현재 PER ≤ 과거 N년 PER 밴드 하단 → 가치 후보), M2-10(금리 상승기이고 PSR ≥ 20 → 과열 경고),
 * 3.3 공통 경고(PER·PBR이 낮다는 이유만으로 사지 말라).
 * 과거 시점 계산은 모두 그날까지 공시됐을 확정 실적만 쓴다(confirmedPeriods: 실제 제출일 filed, 없으면 공시 지연 추정).
 */

export type ValuationBasis = "TTM" | "연간";
export type AmountUnit = NonNullable<Fundamentals["amountUnit"]>;

export interface PerBandParams {
  /** 밴드 기간(년). M2-09는 '과거 N년'이라고만 해서 3년은 앱 기본값 */
  years: number;
  /** 밴드 하단 백분위(%). 책에 수치 정의가 없어 하위 20%를 앱 기본값으로 쓴다(stats.p20) */
  lowPct: number;
  /** 밴드 상단 백분위(%). 앱 기본값(stats.p80) */
  highPct: number;
  /** 통계를 낼 최소 PER 표본 수(거래일). 앱 기본값(약 반년) */
  minPoints: number;
}

export const PER_BAND_PARAMS: Readonly<PerBandParams> = { years: 3, lowPct: 20, highPct: 80, minPoints: 120 };

export const VALUATION_RULES = {
  /** M2-10 강영현: 금리 상승기에 PSR 20배 이상은 거품(과열) 경고 — 책 기준 */
  psrBubble: 20,
  /** 3.3 김연수: 산업 태동기에는 PSR 10배 이상도 용인된 사례 — 책 기준(이 이상이면 참고 알림) */
  psrHigh: 10,
} as const;

// ───────────────────────── 최근 12개월(TTM)·연간 실적 ─────────────────────────

/** "2024.12", "2024-06" → 월 번호(연×12+월). 라벨을 못 읽으면 undefined */
function monthIndex(period: string): number | undefined {
  const r = /(\d{4})\D(\d{1,2})/.exec(period);
  if (!r) return undefined;
  const y = Number(r[1]), m = Number(r[2]);
  return m >= 1 && m <= 12 ? y * 12 + m - 1 : undefined;
}

/** 부동소수 합계 잡음 제거(0.1+0.2 등) */
const tidy = (n: number) => Math.round(n * 1e4) / 1e4;

type Key = "eps" | "revenue";

interface Trailing {
  value: number;
  basis: ValuationBasis;
  /** TTM이면 마지막 분기 라벨, 연간이면 결산 기간 라벨 */
  period: string;
}

/** 값이 있는 마지막 4개 분기가 3개월 간격으로 이어지면 그 합(TTM). 이어지지 않으면 null */
function ttmOf(quarterly: PeriodFinancials[], key: Key): (Trailing & { end: number }) | null {
  const byMonth = new Map<number, PeriodFinancials>();
  for (const p of quarterly) {
    const m = monthIndex(p.period);
    if (m != null && p[key] != null) byMonth.set(m, p); // 같은 분기가 겹치면 뒤의 것
  }
  const months = [...byMonth.keys()].sort((a, b) => a - b).slice(-4);
  if (months.length < 4) return null;
  for (let i = 1; i < 4; i++) if (months[i]! - months[i - 1]! !== 3) return null;
  const last = byMonth.get(months[3]!)!;
  return { value: tidy(months.reduce((s, m) => s + byMonth.get(m)![key]!, 0)), basis: "TTM", period: last.period, end: months[3]! };
}

/**
 * 확정 실적에서 최근 12개월 값: 최근 4개 연속 분기 합(TTM)을 먼저 쓰고, 없으면 최근 확정 연간 값.
 * 단, 연간 결산이 TTM 마지막 분기보다 더 최근이면 연간 값을 쓴다(분기 자료가 끊긴 경우).
 */
function trailingOf(periods: { annual: PeriodFinancials[]; quarterly: PeriodFinancials[] }, key: Key): Trailing | null {
  const ttm = ttmOf(periods.quarterly, key);
  let annual: PeriodFinancials | undefined;
  for (let i = periods.annual.length - 1; i >= 0; i--) if (periods.annual[i]![key] != null) { annual = periods.annual[i]; break; }
  const aEnd = annual ? monthIndex(annual.period) : undefined;
  if (ttm && (!annual || aEnd == null || ttm.end >= aEnd)) return { value: ttm.value, basis: ttm.basis, period: ttm.period };
  return annual ? { value: annual[key]!, basis: "연간", period: annual.period } : null;
}

/**
 * date(YYYY-MM-DD) 시점에 알 수 있었던 최근 12개월 EPS. date를 빼면 확정(비추정) 실적 전부.
 * 그날까지 공시된 기간만 쓴다(filed ≤ date, 없으면 공시 지연 추정) — 미래 참조 없음.
 * 최근 4개 연속 확정 분기 EPS 합(TTM)을 먼저, 없으면 최근 확정 연간 EPS. 둘 다 없으면 null.
 */
export function trailingEpsAt(f: Fundamentals | undefined, date?: string): { eps: number; basis: ValuationBasis; period: string } | null {
  const t = trailingOf(confirmedPeriods(f, date), "eps");
  return t ? { eps: t.value, basis: t.basis, period: t.period } : null;
}

/** 최근 12개월 매출(금액 단위는 f.amountUnit). trailingEpsAt과 같은 규칙 */
export function trailingRevenueAt(f: Fundamentals | undefined, date?: string): { revenue: number; basis: ValuationBasis; period: string } | null {
  const t = trailingOf(confirmedPeriods(f, date), "revenue");
  return t ? { revenue: t.value, basis: t.basis, period: t.period } : null;
}

// ───────────────────────── PER 기록·밴드 ─────────────────────────

export interface PerPoint {
  date: string;
  close: number;
  /** 그날 알 수 있었던 최근 12개월 EPS. 확정 실적이 없으면 null */
  eps: number | null;
  /** 종가 ÷ EPS. EPS가 없거나 0 이하(적자)면 null */
  per: number | null;
}

/**
 * 날짜별 최근 12개월 EPS. 확정 기간 집합은 날짜가 늦을수록 커지기만 하므로, 두 날짜의 집합 크기가 같으면
 * 그 사이 날짜도 모두 같은 집합이다 → 오름차순이면 이분해서 공시로 값이 바뀌는 곳만 계산한다(결과는 봉마다 계산한 것과 같다).
 */
function epsByDate(dates: string[], f: Fundamentals | undefined): (number | null)[] {
  const at = (i: number) => {
    const p = confirmedPeriods(f, dates[i]);
    return { key: p.annual.length * 1e6 + p.quarterly.length, eps: trailingOf(p, "eps")?.value ?? null };
  };
  if (!dates.every((d, i) => i === 0 || dates[i - 1]! <= d)) return dates.map((_, i) => at(i).eps);
  const out: (number | null)[] = new Array(dates.length).fill(null);
  type V = ReturnType<typeof at>;
  const fill = (lo: number, hi: number, a: V, b: V): void => {
    if (a.key === b.key) {
      for (let i = lo; i <= hi; i++) out[i] = a.eps;
    } else if (hi - lo <= 1) {
      out[lo] = a.eps;
      out[hi] = b.eps;
    } else {
      const mid = (lo + hi) >> 1, m = at(mid);
      fill(lo, mid, a, m);
      fill(mid, hi, m, b);
    }
  };
  if (dates.length) fill(0, dates.length - 1, at(0), at(dates.length - 1));
  return out;
}

/** 봉마다 그날까지 공시된 실적으로 계산한 PER — 각 봉은 그 날짜까지의 정보만 쓴다(미래 참조 없음) */
export function perHistory(candles: Candle[], f: Fundamentals | undefined): PerPoint[] {
  const eps = epsByDate(candles.map((c) => c.date), f);
  return candles.map((c, i) => {
    const e = eps[i] ?? null;
    return { date: c.date, close: c.close, eps: e, per: e != null && e > 0 ? c.close / e : null };
  });
}

export type BandLevel = "min" | "p20" | "median" | "p80" | "max";
export type BandPosition = "below" | "low" | "mid" | "high" | "above";

export interface PerBandLine {
  level: BandLevel;
  /** 예: "하단 20% 8.4배" */
  label: string;
  /** 밴드 배수(유효숫자 2자리로 반올림) */
  multiple: number;
  /** 그날 EPS × 배수. EPS가 0 이하이거나 없는 날은 뺀다 */
  points: { date: string; price: number }[];
}

export interface PerBand {
  years: number;
  /** 기간 안의 유효한(EPS > 0) PER 표본 수 */
  n: number;
  /** 기간 첫·마지막 봉 날짜(봉이 없으면 null) */
  from: string | null;
  to: string | null;
  /** 마지막 봉 기준. per는 EPS가 0 이하면 null. 확정 EPS가 아예 없으면 current 자체가 null */
  current: { per: number | null; eps: number; price: number; basis: ValuationBasis; period: string } | null;
  /** 기간 PER 분포(p20·p80은 params.lowPct·highPct 백분위). 표본이 minPoints보다 적으면 null */
  stats: { min: number; p20: number; median: number; p80: number; max: number } | null;
  bands: PerBandLine[];
  /** below: 기간 최저 이하, low: 하단(p20) 이하, mid, high: 상단(p80) 이상, above: 기간 최고 이상 */
  position: BandPosition | null;
  /** 중앙값 PER로 돌아갈 때의 주가(3.3 최병운 '목표가 역산'). 현재 PER이 없으면 null */
  target: { multiple: number; price: number; upsidePct: number } | null;
}

/** 선형 보간 백분위(정렬된 배열, p는 0~100) */
function percentile(sorted: number[], p: number): number {
  const pos = ((sorted.length - 1) * Math.min(100, Math.max(0, p))) / 100;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** YYYY-MM-DD에서 개월 수를 뺀 날짜(말일 넘침은 Date가 다음 달로 넘긴다) */
function monthsBefore(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1 - months, d)).toISOString().slice(0, 10);
}

/** 밴드 배수 반올림: 유효숫자 2자리(7.34 → 7.3, 12.4 → 12, 123 → 120) */
export const roundMultiple = (x: number) => Number(x.toPrecision(2));

const round2 = (n: number) => Math.round(n * 100) / 100;

/** undefined 값은 기본값을 덮지 않는다 */
const bandParams = (over: Partial<PerBandParams> | undefined): PerBandParams =>
  ({ ...PER_BAND_PARAMS, ...Object.fromEntries(Object.entries(over ?? {}).filter(([, v]) => typeof v === "number")) }) as PerBandParams;

/**
 * PER 밴드(M2-09 강영현·최병운) — candles 마지막 봉 기준 최근 params.years년의 일별 PER 분포와 밴드선.
 * 각 봉의 PER·밴드 가격은 그날까지 공시된 EPS만 쓴다. 백테스트에서는 candles.slice(0, i + 1)을 넘기면 i 시점 판단이 된다.
 * 현재 봉도 분포에 포함하므로 position "below"는 '기간 최저 PER을 새로 쓰는 중'이라는 뜻이다.
 */
export function perBand(candles: Candle[], f: Fundamentals | undefined, params: Partial<PerBandParams> = {}): PerBand {
  const P = bandParams(params);
  const last = candles.at(-1);
  const empty: PerBand = { years: P.years, n: 0, from: null, to: null, current: null, stats: null, bands: [], position: null, target: null };
  if (!last) return empty;
  const start = monthsBefore(last.date, Math.round(P.years * 12));
  const win = candles.filter((c) => c.date > start && c.date <= last.date);
  const hist = perHistory(win, f);
  const pers = hist.map((h) => h.per).filter((v): v is number => v != null).sort((a, b) => a - b);

  const now = trailingEpsAt(f, last.date);
  const current = now ? { per: now.eps > 0 ? last.close / now.eps : null, eps: now.eps, price: last.close, basis: now.basis, period: now.period } : null;
  const stats =
    pers.length >= Math.max(1, P.minPoints)
      ? { min: pers[0]!, p20: percentile(pers, P.lowPct), median: percentile(pers, 50), p80: percentile(pers, P.highPct), max: pers.at(-1)! }
      : null;
  const out: PerBand = { ...empty, n: pers.length, from: win[0]?.date ?? null, to: last.date, current, stats };
  if (!stats) return out;

  const names: [BandLevel, string][] = [["min", "최저"], ["p20", `하단 ${P.lowPct}%`], ["median", "중앙"], ["p80", `상단 ${100 - P.highPct}%`], ["max", "최고"]];
  out.bands = names.map(([level, name]) => {
    const multiple = roundMultiple(stats[level]);
    const points = hist.filter((h) => h.eps != null && h.eps > 0).map((h) => ({ date: h.date, price: round2(h.eps! * multiple) }));
    return { level, label: `${name} ${multiple}배`, multiple, points };
  });
  const per = current?.per;
  if (per != null) {
    out.position = per <= stats.min ? "below" : per <= stats.p20 ? "low" : per >= stats.max ? "above" : per >= stats.p80 ? "high" : "mid";
    const multiple = roundMultiple(stats.median);
    const price = round2(current!.eps * multiple);
    out.target = { multiple, price, upsidePct: (price / last.close - 1) * 100 };
  }
  return out;
}

// ───────────────────────── PSR ─────────────────────────

export interface PsrResult {
  psr: number;
  revenue: number;
  basis: ValuationBasis;
  period: string;
  marketCap: number;
  /** marketCap·revenue 금액 단위 */
  unit: AmountUnit;
}

/**
 * PSR = 시가총액 ÷ 최근 12개월 매출(4개 연속 확정 분기 합, 없으면 최근 확정 연간).
 * 시가총액과 매출이 같은 단위(f.amountUnit)일 때만 계산하고, 단위를 모르면 null(엉뚱한 배수를 내지 않는다).
 * opts.asOf를 주면 그날까지 공시된 매출만 쓴다. 시가총액은 현재 스냅숏이라 과거 시점 PSR이 필요하면 opts.marketCap으로 넘긴다(같은 단위).
 */
export function psr(f: Fundamentals | undefined, opts: { asOf?: string; marketCap?: number } = {}): PsrResult | null {
  const unit = f?.amountUnit;
  const marketCap = opts.marketCap ?? f?.marketCap;
  if (!unit || marketCap == null || !(marketCap > 0)) return null;
  const t = trailingRevenueAt(f, opts.asOf);
  if (!t || !(t.revenue > 0)) return null;
  return { psr: marketCap / t.revenue, revenue: t.revenue, basis: t.basis, period: t.period, marketCap, unit };
}

/**
 * 샘플 모드(PROVIDER=mock) 전용 — 샘플 실적에 맞춰 시가총액·상장주식수를 만들어 낸다(실제 값 아님).
 * 상장주식수 = 최근 확정 연간 순이익 ÷ EPS, 시가총액 = 주가 × 주식 수를 금액 단위로 환산. 계산할 수 없으면 {}.
 */
export function sampleMarketFields(f: Fundamentals, price: number, unit: AmountUnit): Pick<Fundamentals, "marketCap" | "sharesOutstanding" | "amountUnit"> {
  const scale = unit === "억원" ? 1e8 : 1e6;
  const a = [...confirmedPeriods(f).annual].reverse().find((p) => p.netIncome != null && p.eps != null && p.netIncome > 0 && p.eps > 0);
  if (!a || !(price > 0)) return {};
  const shares = Math.round((a.netIncome! * scale) / a.eps!);
  return { marketCap: Math.round((price * shares) / scale), sharesOutstanding: shares, amountUnit: unit };
}

// ───────────────────────── 화면 근거 ─────────────────────────

export interface ValuationNoteInput {
  band: PerBand | null;
  psr: PsrResult | null;
  /** 금리 상승기 여부(미 10년물 추세 등). null·undefined면 모름 */
  rateRising?: boolean | null;
  /** M2-03 실적 그룹 */
  growthGroup?: GrowthGroup;
  /** 최근 EPS 증가 여부(연간 EPS 증가율 > 0 등). undefined면 모름 */
  epsGrowthPositive?: boolean;
  /** 시장 평균 PER(배). 있으면 안전마진(3.3 최병운)도 본다 */
  marketPer?: number | null;
  /** 밴드 백분위 표기용(perBand에 넘긴 값과 같게) */
  params?: Partial<PerBandParams>;
}

const fx = (n: number, digits = 1) => n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const BAND_RULE = "M2-09 강영현·최병운";
const CHEAP_RULE = "3.3 강영현·최병운·와인스타인·강동진";

/**
 * PER 밴드·안전마진·PSR 근거 Note.
 * - 현재 PER ≤ 밴드 하단(p20) → 가치 후보(good, M2-09). 이익 성장이 확인되지 않으면 '싸다는 이유만으로 사지 말라'(warn, 3.3 공통 경고)
 * - 현재 PER ≥ 밴드 상단(p80) → 비싸게 거래 중(warn)
 * - PSR ≥ 20: 금리 상승기면 bad(M2-10), 금리를 모르면 warn, 금리 상승기가 아니면 info. PSR ≥ 10 → info(3.3 김연수)
 */
export function valuationNotes(input: ValuationNoteInput): Note[] {
  const P = bandParams(input.params);
  const notes: Note[] = [];
  const band = input.band;
  const cur = band?.current;
  const per = cur?.per ?? null;
  const years = band ? `최근 ${fx(band.years)}년` : "";
  let cheap = false;

  if (cur && per == null) {
    notes.push({ tone: "info", text: `최근 12개월 EPS가 0 이하(적자)라 PER로 가치를 판단할 수 없어요`, rule: "3.3 강영현" });
  } else if (band && per != null) {
    const s = band.stats;
    if (!s) {
      notes.push({ tone: "info", text: `PER 기록이 ${band.n}거래일뿐이라 ${years} PER 밴드를 만들기엔 부족해요`, rule: BAND_RULE });
    } else if (band.position === "below" || band.position === "low") {
      cheap = true;
      const where = band.position === "below" ? `PER 밴드 최저(${fx(s.min)}배) 수준까지 내려왔어요` : `PER 밴드 하단(하위 ${P.lowPct}% ${fx(s.p20)}배) 이하예요`;
      notes.push({ tone: "good", text: `현재 PER ${fx(per)}배로 ${years} ${where}. 가치 후보예요`, rule: BAND_RULE });
      const t = band.target;
      if (t && t.upsidePct > 0)
        notes.push({ tone: "info", text: `PER이 밴드 중앙값 ${fx(t.multiple)}배로 돌아가면 주가는 약 ${fx(t.upsidePct, 0)}% 오를 수 있는 자리예요(목표가 역산)`, rule: "3.3 최병운" });
    } else if (band.position === "high" || band.position === "above") {
      const where = band.position === "above" ? `PER 밴드 최고(${fx(s.max)}배) 수준이에요` : `PER 밴드 상단(상위 ${100 - P.highPct}% ${fx(s.p80)}배) 이상이에요`;
      notes.push({ tone: "warn", text: `현재 PER ${fx(per)}배로 ${years} ${where}. 과거보다 비싸게 거래되고 있지만, 유동성 장세에는 너무 일찍 팔 위험도 있어요`, rule: "3.3 강영현" });
    } else if (band.position === "mid") {
      notes.push({ tone: "info", text: `현재 PER ${fx(per)}배는 ${years} PER 밴드 중간(${fx(s.p20)}~${fx(s.p80)}배)이에요`, rule: "3.3 강영현" });
    }
  }

  const mp = input.marketPer;
  if (per != null && mp != null && mp > 0 && per <= mp) {
    cheap = true;
    notes.push({ tone: "good", text: `현재 PER ${fx(per)}배가 시장 평균 PER ${fx(mp)}배 이하라 안전마진이 생긴 자리예요`, rule: "3.3 최병운" });
  }

  if (cheap) {
    const negative = input.epsGrowthPositive === false || input.growthGroup === "B";
    const positive = !negative && (input.epsGrowthPositive === true || input.growthGroup === "A");
    if (negative)
      notes.push({ tone: "warn", text: "이익 성장이 받쳐주지 않는데 PER만 낮아요. 싼 상태로 오래 머무는 종목이 많으니 PER이 낮다는 이유만으로 사지 마세요", rule: CHEAP_RULE });
    else if (!positive)
      notes.push({ tone: "warn", text: "이익 성장을 확인하지 못했어요. 싼 상태로 오래 머무는 종목이 많으니 PER이 낮다는 이유만으로 사지 마세요", rule: CHEAP_RULE });
  }

  const ps = input.psr;
  if (ps) {
    const R = VALUATION_RULES;
    const x = fx(ps.psr);
    if (ps.psr >= R.psrBubble) {
      if (input.rateRising === true) notes.push({ tone: "bad", text: `PSR ${x}배 — 금리 상승기에 PSR ${R.psrBubble}배 이상은 거품 경고예요`, rule: "M2-10 강영현" });
      else if (input.rateRising === false)
        notes.push({ tone: "info", text: `PSR ${x}배로 높아요. 지금은 금리 상승기가 아니라 과열 경고 조건은 아니지만, 금리가 오르기 시작하면 거품 경고 대상이에요`, rule: "M2-10 강영현" });
      else notes.push({ tone: "warn", text: `PSR ${x}배로 ${R.psrBubble}배 이상이에요. 금리 상승기라면 거품 경고 대상이에요(금리 추세를 확인하지 못했어요)`, rule: "M2-10 강영현" });
    } else if (ps.psr >= R.psrHigh) {
      notes.push({ tone: "info", text: `PSR ${x}배 — 산업 태동기에는 PSR ${R.psrHigh}배 이상도 용인된 사례가 있지만, 매출이 계속 크게 늘어야 해요`, rule: "3.3 김연수" });
    }
  }
  return notes;
}
