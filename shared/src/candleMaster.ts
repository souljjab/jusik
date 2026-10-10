import type { Candle, Note } from "./types";
import { completedWeeks, toWeekly, type WeeklyBar } from "./weekly";

/*
 * 캔들마스터 주봉 캔들매매(자료집 4.5, M3-12·M3-13·M4-01·M4-03).
 * 이동평균·거래량·보조지표·지지/저항선을 쓰지 않고 파동 → 캔들군 → 캔들 신호 3층으로만 본다.
 * 책은 몸통 크기·꼬리 길이에 명확한 수치를 두지 않는다(4.5). 그래서 경계값은 대부분 앱 기본값이고,
 * 모두 CANDLE_MASTER_PARAMS에 열어 두어 백테스트로 조정한다. 책의 '3종 8개 패턴'은 그림으로 설명돼
 * 자료집에 남지 않았으므로, 여기서는 글로 남은 4가지(양봉 스프링·긴 위아래 꼬리 작은 양봉·1:1 위꼬리 양봉·이중/다중 꼬리군)만 정의한다.
 */

export const CANDLE_MASTER_PARAMS = {
  // ── 파동(4.5 "해석 대상과 제외 대상") ──
  /** 해석에 필요한 최소 주봉 수. 4.5 "상장 기간이 짧아 캔들이 적은 종목" 제외 — 52주는 앱 기본값 */
  minWeeks: 52,
  /** 파동(최저점·고점·하락폭)을 보는 전체 구간(주). 앱 기본값 */
  lookbackWeeks: 104,
  /** 수평 파동으로 볼 구간: 신호 주 직전 이 주 수(신호 캔들은 구간 저점을 잠깐 깰 수 있어 뺀다). 앱 기본값 */
  baseWeeks: 12,
  /** 수평 구간 고저폭 상한(구간 저가 대비 %). 앱 기본값 */
  baseMaxRangePct: 40,
  /** 수평 구간 고저폭 ≤ 직전 파동 고저폭 × 이 비율('직전 파동보다 좁다'). 앱 기본값 */
  baseVsPriorMax: 0.5,
  /** 저점 흐름 = 수평 구간 뒤쪽 절반 최저가 ÷ 앞쪽 절반 최저가 − 1(%). 이 범위면 '평평~서서히 상승'. 앱 기본값 */
  lowSlopeMinPct: -3,
  lowSlopeMaxPct: 25,
  /** 저점 흐름이 이 이상이면 '서서히 오르는 위치'(4.5)로 본다(%). 앱 기본값 */
  risingMinPct: 2,
  /** 직전 파동과의 간격: 수평 구간 고가가 직전 파동 고점보다 이 비율(%) 이상 아래. 앱 기본값 */
  minGapPct: 15,
  /** 직전 파동과의 간격: 직전 파동 고점과 수평 구간 시작 사이 최소 주 수. 앱 기본값 */
  minGapWeeks: 4,
  /** 제외: 구간 최저점에서 그 뒤 고점까지 이 배수 이상 이미 올랐으면. 4.5 "10배" — 책 */
  maxRunupMultiple: 10,
  /** 제외: 구간 고점 대비 종가 하락폭(%)이 이보다 크면. 4.5 "고점 대비 50%를 크게 넘는" — 50%는 책, '크게'를 60%로 둔 것은 앱 기본값 */
  maxDrawdownPct: 60,
  /** 제외: 최근 이 주 수 안에서 종가가 직전 저점(아래 breakRefWeeks주 최저가)을 깬 주가 maxLowBreaks번 이상. 4.5 "저점을 여러 번 하향 돌파" — 수치는 앱 기본값 */
  breakWindowWeeks: 13,
  breakRefWeeks: 8,
  maxLowBreaks: 2,

  // ── 캔들군 ──
  /** 신호 직전 캔들군 주 수. 앱 기본값 */
  groupWeeks: 6,
  /** 표준 캔들군: 고저폭(%) 이하이고 평균 몸통(종가 대비 %) 이하일 때 '수평 횡보 캔들군'. 앱 기본값 */
  groupMaxRangePct: 15,
  groupMaxAvgBodyPct: 5,

  // ── 캔들 신호(4.5 "매수 신호 캔들") — 책은 수치를 두지 않아 모두 앱 기본값 ──
  /** 양봉으로 인정하는 최소 몸통(종가 대비 %). 스프링·1:1 위꼬리 양봉에 쓴다 */
  minBodyPct: 1.5,
  /** '작은' 몸통 상한(종가 대비 %). 작은 양봉·꼬리군에 쓴다 */
  smallBodyMaxPct: 4,
  /** '긴' 꼬리: 몸통의 이 배수 이상이면서 */
  longTailVsBody: 1,
  /** 종가의 이 비율(%) 이상 */
  minTailPct: 2,
  /** 1:1 위꼬리 양봉: 위꼬리 ÷ 몸통이 이 범위('약 1:1') */
  upperRatioMin: 0.7,
  upperRatioMax: 1.4,
  /** 1:1 위꼬리 양봉: 아래꼬리 ≤ 몸통 × 이 비율(긴 위아래 꼬리 양봉과 구분) */
  upperTailMaxLowerVsBody: 0.5,
  /** 양봉 스프링: 직전 이 주 수의 최저가(지지)를 장중 깬 뒤 그 위에서 마감 */
  springRefWeeks: 8,
  /** 양봉 스프링: 지지 이탈 폭 상한(%) — 더 깊으면 붕괴로 본다 */
  springMaxBreakPct: 10,
  /** 양봉 스프링: 종가가 그 주 고저 범위의 이 위치(0 = 저가, 1 = 고가) 이상 */
  springMinCloseLoc: 0.5,
  /** 꼬리군: 연속 주 수 하한(2 = 이중 꼬리군, 3 이상 = 다중 꼬리군) */
  tailGroupMin: 2,
  /** 꼬리군: 각 캔들에서 그 꼬리가 고저 범위의 이 비율 이상(꼬리가 캔들의 중심) */
  tailGroupMinShare: 0.5,
  /** 꼬리군: 꼬리 끝(아래꼬리면 저가, 위꼬리면 고가)이 서로 이 비율(%) 안에 모일 것 */
  tailClusterPct: 3,
  /** 신호 손절가 = 기준 저가(신호 캔들 저가 또는 꼬리군 최저가) × (1 − 이 비율 %). 앱 기본값 */
  stopBufferPct: 1,

  // ── 진입·손절·목표(책) ──
  /** 진입가 = 종가 − (종가 − 손절가) × 이 비율. M3-12 "종가와 손절가 사이 1/3 지점" — 책 */
  entryFraction: 1 / 3,
  /** 기본 손절폭(%). M4-01 "돌파·캔들 기본 −10%" — 책 */
  defaultStopPct: 10,
  /** 최대 손절폭(%). M4-01 "최대 −20%", 넘으면 범위 안으로 내려올 때까지 진입을 미룬다(4.5) — 책 */
  maxStopPct: 20,
  /** 목표 배수: 표준 3배, 비표준 2배. M3-13 — 책 */
  standardMultiple: 3,
  nonStandardMultiple: 2,
  /** 본전 스탑 발동 배수: 진입가 × 2(+100%)에 닿은 뒤 밀리면 본전 매도. M3-13 — 책 */
  breakevenMultiple: 2,
};

export type CandleMasterParams = typeof CANDLE_MASTER_PARAMS;

export type CandleMasterSignalId = "SPRING" | "LONG_TAILS" | "UPPER_TAIL" | "TAIL_GROUP";

export const CANDLE_MASTER_SIGNAL_LABEL: Record<CandleMasterSignalId, string> = {
  SPRING: "양봉 스프링",
  LONG_TAILS: "긴 위아래 꼬리의 작은 양봉",
  UPPER_TAIL: "몸통:꼬리 1:1 위꼬리 양봉",
  TAIL_GROUP: "이중·다중 꼬리군",
};

/** 진입 근거로 쓸 신호 우선순위(앞이 먼저). 단봉 신호는 그 캔들 저가, 꼬리군은 군 최저가가 손절 기준이다 */
const SIGNAL_ORDER: CandleMasterSignalId[] = ["SPRING", "UPPER_TAIL", "LONG_TAILS", "TAIL_GROUP"];

export type CandleMasterExclusion = "SHORT_HISTORY" | "RUNUP" | "DEEP_DRAWDOWN" | "BROKEN_LOWS";

export interface CandleMasterWaveMetrics {
  /** 수평 구간(신호 주 직전 baseWeeks주) 고가·저가·고저폭(%) */
  baseHigh: number;
  baseLow: number;
  baseRangePct: number;
  /** 직전 파동(수평 구간 앞, 전체 구간 안) 고가·저가·고저폭(%) */
  priorHigh: number;
  priorLow: number;
  priorRangePct: number;
  /** 수평 구간 고저폭 ÷ 직전 파동 고저폭 */
  rangeRatio: number;
  /** 수평 구간 뒤쪽 절반 최저가 ÷ 앞쪽 절반 최저가 − 1(%) */
  lowSlopePct: number;
  /** 수평 구간 고가가 직전 파동 고점보다 낮은 정도(%) */
  gapPct: number;
  /** 직전 파동 고점 주와 수평 구간 첫 주 사이 주 수 */
  gapWeeks: number;
  /** 전체 구간 최저점 → 그 뒤 고점 배수 */
  runupMultiple: number;
  /** 전체 구간 고점 대비 이번 주 종가 하락폭(%) */
  drawdownPct: number;
  /** 최근 breakWindowWeeks주 동안 종가가 직전 저점을 깬 주 수 */
  lowBreaks: number;
}

export interface CandleMasterWave {
  k: number;
  /** k까지의 주봉 수 */
  weeks: number;
  /** 주봉이 모자라면 null */
  metrics: CandleMasterWaveMetrics | null;
  /** 최근 구간이 직전 파동보다 좁고 저점이 평평~완만히 오름 */
  horizontal: boolean;
  /** 직전 파동 고점과 가격·시간 간격을 둠 */
  spaced: boolean;
  /** 저점이 서서히 오름(수평 파동 후반의 오르는 자리) */
  rising: boolean;
  exclusions: CandleMasterExclusion[];
  excluded: boolean;
  /** 해석 대상: 제외 아님 + 수평 + 간격 */
  ok: boolean;
  /** 교과서형 파동: ok + 저점이 서서히 오름 */
  textbook: boolean;
  notes: Note[];
}

export interface CandleMasterGroup {
  /** 신호 주 직전 캔들군 주 수 */
  weeks: number;
  rangePct: number;
  avgBodyPct: number;
  /** 좁은 범위의 작은 몸통 캔들이 모인 수평 횡보 캔들군 */
  compact: boolean;
  notes: Note[];
}

export interface CandleMasterSignal {
  id: CandleMasterSignalId;
  name: string;
  /** 신호를 이루는 주 수(단봉 1, 꼬리군은 2 이상) */
  weeks: number;
  /** 손절 기준 저가(신호 캔들 저가 또는 꼬리군 최저가) */
  refLow: number;
  notes: Note[];
}

export interface CandleMasterResult {
  k: number;
  /** k주의 마지막 거래일 */
  date: string;
  close: number;
  wave: CandleMasterWave;
  /** 주봉이 모자라면 null */
  group: CandleMasterGroup | null;
  signals: CandleMasterSignal[];
  /** 손절 기준으로 쓴 신호 */
  primary: CandleMasterSignalId | null;
  /** 파동 해석 대상 + 신호 + 손절폭 ≤ 최대 */
  valid: boolean;
  /** 파동·캔들군·신호 모두 교과서형(표준 → 목표 3배) */
  standard: boolean;
  /** M3-12 진입가(종가와 손절가 사이 1/3 지점). valid가 아니면 null */
  entry: number | null;
  /** 대안 진입가(종가와 손절가 중간). valid가 아니면 null */
  entryMid: number | null;
  /** 신호별 손절가. 신호가 없으면 null */
  stop: number | null;
  /** 진입가(1/3 지점) 대비 손절폭(%) */
  stopPct: number | null;
  /** 손절폭이 최대를 넘을 때: 진입가가 이 가격 이하로 내려와야 범위 안 */
  waitPrice: number | null;
  /** M3-13 목표가(표준 × 3, 비표준 × 2) */
  target: number | null;
  targetMultiple: number | null;
  /** M3-13 본전 스탑 발동가(진입가 × 2) */
  breakevenTrigger: number | null;
  notes: Note[];
}

const RULE_45 = "4.5 캔들마스터";
const px = (x: number) => (Math.abs(x) >= 1000 ? Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : x.toFixed(2));
const pct = (x: number) => x.toFixed(1);
const minOf = (xs: number[]) => xs.reduce((a, b) => Math.min(a, b), Infinity);
const maxOf = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), -Infinity);

/** 캔들 모양(주봉). 비율은 종가 대비 % */
function shape(w: WeeklyBar) {
  const body = Math.abs(w.close - w.open);
  const upper = w.high - Math.max(w.open, w.close);
  const lower = Math.min(w.open, w.close) - w.low;
  const ref = w.close > 0 ? w.close : 1;
  return { bull: w.close > w.open, body, upper, lower, range: w.high - w.low, bodyPct: (body / ref) * 100, upperPct: (upper / ref) * 100, lowerPct: (lower / ref) * 100 };
}

// ───────────────────────── 파동 ─────────────────────────

/**
 * k주 시점의 파동 맥락(4.5). weekly[0..k]만 쓴다(미래 참조 없음).
 * 수평 구간은 k주를 뺀 직전 baseWeeks주, 하락폭·급등 배수·저점 이탈은 k주까지 본다.
 */
export function candleMasterWave(weekly: WeeklyBar[], k: number, params: Partial<CandleMasterParams> = {}): CandleMasterWave {
  const P = { ...CANDLE_MASTER_PARAMS, ...params };
  const weeks = k + 1;
  const notes: Note[] = [];
  const exclusions: CandleMasterExclusion[] = [];
  const empty = (): CandleMasterWave => ({ k, weeks, metrics: null, horizontal: false, spaced: false, rising: false, exclusions, excluded: true, ok: false, textbook: false, notes });

  const baseStart = k - P.baseWeeks;
  const lbStart = Math.max(0, k - P.lookbackWeeks + 1);
  if (weeks < P.minWeeks || baseStart - 1 < lbStart || k >= weekly.length) {
    exclusions.push("SHORT_HISTORY");
    notes.push({ tone: "bad", text: `주봉이 ${Math.max(0, Math.min(weeks, weekly.length))}개뿐이라(기준 ${P.minWeeks}개) 해석하지 않아요 — 상장 기간이 짧은 종목`, rule: RULE_45 });
    return empty();
  }

  const lb = weekly.slice(lbStart, k + 1);
  const base = weekly.slice(baseStart, k);
  const prior = weekly.slice(lbStart, baseStart);
  const cur = weekly[k]!;

  // 수평 구간·직전 파동
  const baseHigh = maxOf(base.map((w) => w.high));
  const baseLow = minOf(base.map((w) => w.low));
  const baseRangePct = ((baseHigh - baseLow) / baseLow) * 100;
  let priorHighIdx = lbStart;
  prior.forEach((w, j) => {
    if (w.high >= weekly[priorHighIdx]!.high) priorHighIdx = lbStart + j;
  });
  const priorHigh = weekly[priorHighIdx]!.high;
  const priorLow = minOf(prior.map((w) => w.low));
  const priorRangePct = ((priorHigh - priorLow) / priorLow) * 100;
  const rangeRatio = priorRangePct > 0 ? baseRangePct / priorRangePct : Infinity;
  const half = Math.floor(base.length / 2);
  const lowSlopePct = (minOf(base.slice(half).map((w) => w.low)) / minOf(base.slice(0, half).map((w) => w.low)) - 1) * 100;
  const gapPct = (1 - baseHigh / priorHigh) * 100;
  const gapWeeks = baseStart - priorHighIdx;

  // 제외 조건
  let runupMultiple = 1;
  let runLow = Infinity;
  for (const w of lb) {
    runLow = Math.min(runLow, w.low);
    if (runLow > 0) runupMultiple = Math.max(runupMultiple, w.high / runLow);
  }
  const lbHigh = maxOf(lb.map((w) => w.high));
  const drawdownPct = (1 - cur.close / lbHigh) * 100;
  let lowBreaks = 0;
  for (let j = Math.max(1, k - P.breakWindowWeeks + 1); j <= k; j++) {
    const ref = minOf(weekly.slice(Math.max(0, j - P.breakRefWeeks), j).map((w) => w.low));
    if (weekly[j]!.close < ref) lowBreaks++;
  }

  const metrics: CandleMasterWaveMetrics = { baseHigh, baseLow, baseRangePct, priorHigh, priorLow, priorRangePct, rangeRatio, lowSlopePct, gapPct, gapWeeks, runupMultiple, drawdownPct, lowBreaks };

  if (runupMultiple >= P.maxRunupMultiple) {
    exclusions.push("RUNUP");
    notes.push({ tone: "bad", text: `최저점에서 고점까지 이미 ${runupMultiple.toFixed(1)}배 올랐어요(기준 ${P.maxRunupMultiple}배) — 해석 대상에서 빼요`, rule: RULE_45 });
  }
  if (drawdownPct > P.maxDrawdownPct) {
    exclusions.push("DEEP_DRAWDOWN");
    notes.push({ tone: "bad", text: `고점 대비 ${pct(drawdownPct)}% 내려 있어요(50%를 크게 넘는 큰 파동, 앱 기준 ${P.maxDrawdownPct}%) — 해석하지 않아요`, rule: RULE_45 });
  }
  if (lowBreaks >= P.maxLowBreaks) {
    exclusions.push("BROKEN_LOWS");
    notes.push({ tone: "bad", text: `최근 ${P.breakWindowWeeks}주 동안 종가가 직전 저점을 ${lowBreaks}번 깼어요 — 저점을 여러 번 하향 돌파한 구간이라 해석하지 않아요`, rule: RULE_45 });
  }

  // 저가가 0 이하인 잘못된 봉이 섞이면 비율이 무의미해 수평으로 보지 않는다
  const narrow = baseLow > 0 && priorLow > 0 && baseRangePct <= P.baseMaxRangePct && rangeRatio <= P.baseVsPriorMax;
  const flatLows = lowSlopePct >= P.lowSlopeMinPct && lowSlopePct <= P.lowSlopeMaxPct;
  const horizontal = narrow && flatLows;
  const spaced = gapPct >= P.minGapPct && gapWeeks >= P.minGapWeeks;
  const rising = horizontal && lowSlopePct >= P.risingMinPct;

  if (horizontal)
    notes.push({ tone: "good", text: `최근 ${P.baseWeeks}주 고저폭 ${pct(baseRangePct)}%로 직전 파동(${pct(priorRangePct)}%)보다 좁고 저점이 ${lowSlopePct >= 0 ? "+" : ""}${pct(lowSlopePct)}%로 평평하거나 완만히 올라요 — 수평 파동`, rule: RULE_45 });
  else if (!narrow)
    notes.push({ tone: "info", text: `최근 ${P.baseWeeks}주 고저폭 ${pct(baseRangePct)}%가 직전 파동(${pct(priorRangePct)}%)에 비해 넓어요 — 아직 수평 파동이 아니에요`, rule: RULE_45 });
  else
    notes.push({ tone: "info", text: `최근 ${P.baseWeeks}주 저점 흐름이 ${lowSlopePct >= 0 ? "+" : ""}${pct(lowSlopePct)}%라 평평하거나 완만히 오르는 모양이 아니에요`, rule: RULE_45 });
  if (spaced) notes.push({ tone: "good", text: `수평 구간 고가가 직전 파동 고점(${px(priorHigh)})보다 ${pct(gapPct)}% 아래, 고점 뒤 ${gapWeeks}주 지나 자리를 잡았어요 — 직전 파동과 간격`, rule: RULE_45 });
  else notes.push({ tone: "info", text: `직전 파동 고점(${px(priorHigh)})과 간격이 부족해요(가격 ${pct(gapPct)}%, 기준 ${P.minGapPct}% · ${gapWeeks}주, 기준 ${P.minGapWeeks}주)`, rule: RULE_45 });
  if (rising) notes.push({ tone: "good", text: "저점이 서서히 올라가는 수평 파동 후반의 자리예요", rule: RULE_45 });

  const excluded = exclusions.length > 0;
  const ok = !excluded && horizontal && spaced;
  return { k, weeks, metrics, horizontal, spaced, rising, exclusions, excluded, ok, textbook: ok && rising, notes };
}

// ───────────────────────── 캔들군 ─────────────────────────

/** 신호 주 직전 groupWeeks주 캔들군(weekly[k − groupWeeks .. k − 1]만 본다) */
function candleGroup(weekly: WeeklyBar[], k: number, P: CandleMasterParams): CandleMasterGroup | null {
  const g = weekly.slice(Math.max(0, k - P.groupWeeks), k);
  if (g.length < P.groupWeeks) return null;
  const hi = maxOf(g.map((w) => w.high));
  const lo = minOf(g.map((w) => w.low));
  const rangePct = ((hi - lo) / lo) * 100;
  const avgBodyPct = g.reduce((a, w) => a + shape(w).bodyPct, 0) / g.length;
  const compact = rangePct <= P.groupMaxRangePct && avgBodyPct <= P.groupMaxAvgBodyPct;
  const notes: Note[] = [
    compact
      ? { tone: "good", text: `신호 직전 ${g.length}주가 고저폭 ${pct(rangePct)}%, 평균 몸통 ${pct(avgBodyPct)}%의 수평 횡보 캔들군이에요`, rule: RULE_45 }
      : { tone: "info", text: `신호 직전 ${g.length}주 캔들군이 넓거나 몸통이 커요(고저폭 ${pct(rangePct)}%, 평균 몸통 ${pct(avgBodyPct)}%) — 비표준`, rule: RULE_45 },
  ];
  return { weeks: g.length, rangePct, avgBodyPct, compact, notes };
}

// ───────────────────────── 캔들 신호 ─────────────────────────

/** k주 캔들의 매수 신호(4.5). weekly[0..k]만 본다 */
export function candleMasterSignals(weekly: WeeklyBar[], k: number, params: Partial<CandleMasterParams> = {}): CandleMasterSignal[] {
  const P = { ...CANDLE_MASTER_PARAMS, ...params };
  const w = weekly[k];
  if (!w) return [];
  const s = shape(w);
  const out: CandleMasterSignal[] = [];
  const sig = (id: CandleMasterSignalId, refLow: number, text: string, weeks = 1) =>
    out.push({ id, name: CANDLE_MASTER_SIGNAL_LABEL[id], weeks, refLow, notes: [{ tone: "good", text, rule: RULE_45 }] });

  // 1) 양봉 스프링: 직전 springRefWeeks주 최저가(지지)를 장중 깼다가 그 위, 범위 윗부분에서 끝난 양봉
  if (k >= P.springRefWeeks && s.bull && s.bodyPct >= P.minBodyPct && s.range > 0) {
    const support = minOf(weekly.slice(k - P.springRefWeeks, k).map((x) => x.low));
    const breakPct = ((support - w.low) / support) * 100;
    const loc = (w.close - w.low) / s.range;
    if (w.low < support && breakPct <= P.springMaxBreakPct && w.close > support && loc >= P.springMinCloseLoc)
      sig("SPRING", w.low, `양봉 스프링: 직전 ${P.springRefWeeks}주 저점(${px(support)})을 ${pct(breakPct)}% 깼다가 그 위에서 양봉으로 마감했어요`);
  }

  // 2) 1:1 위꼬리 양봉: 위꼬리 ≈ 몸통, 아래꼬리는 짧다
  if (s.bull && s.bodyPct >= P.minBodyPct) {
    const ratio = s.upper / s.body;
    if (ratio >= P.upperRatioMin && ratio <= P.upperRatioMax && s.lower <= s.body * P.upperTailMaxLowerVsBody)
      sig("UPPER_TAIL", w.low, `몸통과 위꼬리가 약 1:${ratio.toFixed(1)}인 위꼬리 양봉이에요`);
  }

  // 3) 긴 위아래 꼬리의 작은 양봉
  const longUpper = (x: ReturnType<typeof shape>) => x.upper >= x.body * P.longTailVsBody && x.upperPct >= P.minTailPct;
  const longLower = (x: ReturnType<typeof shape>) => x.lower >= x.body * P.longTailVsBody && x.lowerPct >= P.minTailPct;
  if (s.bull && s.bodyPct <= P.smallBodyMaxPct && longUpper(s) && longLower(s))
    sig("LONG_TAILS", w.low, `몸통 ${pct(s.bodyPct)}%의 작은 양봉에 위꼬리 ${pct(s.upperPct)}%·아래꼬리 ${pct(s.lowerPct)}%가 길게 달렸어요`);

  // 4) 이중·다중 꼬리군: k주까지 연속으로 같은 쪽 긴 꼬리를 단 작은 몸통 캔들이 비슷한 가격대에 모임(그 자체로 신호)
  for (const side of ["lower", "upper"] as const) {
    const has = (x: WeeklyBar) => {
      const t = shape(x);
      const tail = side === "lower" ? t.lower : t.upper;
      return t.bodyPct <= P.smallBodyMaxPct && t.range > 0 && tail >= t.range * P.tailGroupMinShare && (side === "lower" ? longLower(t) : longUpper(t));
    };
    let n = 0;
    while (k - n >= 0 && has(weekly[k - n]!)) n++;
    if (n < P.tailGroupMin) continue;
    const grp = weekly.slice(k - n + 1, k + 1);
    const tips = grp.map((x) => (side === "lower" ? x.low : x.high));
    const spread = (maxOf(tips) / minOf(tips) - 1) * 100;
    if (spread > P.tailClusterPct) continue;
    sig("TAIL_GROUP", minOf(grp.map((x) => x.low)), `${n === 2 ? "이중" : "다중"} 꼬리군: ${n}주 연속 ${side === "lower" ? "아래" : "위"}꼬리가 ${pct(spread)}% 안에 모였어요`, n);
    break;
  }

  return out.sort((a, b) => SIGNAL_ORDER.indexOf(a.id) - SIGNAL_ORDER.indexOf(b.id));
}

// ───────────────────────── 종합 ─────────────────────────

/**
 * k주 마감 시점의 캔들마스터 판정. weekly[0..k]만 쓴다(미래 참조 없음).
 * 진입가 M3-12(종가와 손절가 사이 1/3, 대안 중간), 손절 M4-01(기본 −10%, 최대 −20% — 넘으면 진입 보류),
 * 목표 M3-13(표준 × 3, 비표준 × 2)과 본전 스탑 발동가(진입가 × 2).
 */
export function candleMasterAt(weekly: WeeklyBar[], k: number, params: Partial<CandleMasterParams> = {}): CandleMasterResult | null {
  const P = { ...CANDLE_MASTER_PARAMS, ...params };
  const w = weekly[k];
  if (!w || k < 0) return null;
  const wave = candleMasterWave(weekly, k, P);
  const group = wave.metrics ? candleGroup(weekly, k, P) : null;
  const signals = candleMasterSignals(weekly, k, P);
  const notes: Note[] = [...wave.notes, ...(group?.notes ?? []), ...signals.flatMap((s) => s.notes)];
  const res: CandleMasterResult = {
    k, date: w.date, close: w.close, wave, group, signals, primary: null, valid: false, standard: false,
    entry: null, entryMid: null, stop: null, stopPct: null, waitPrice: null, target: null, targetMultiple: null, breakevenTrigger: null, notes,
  };

  const primary = signals[0];
  if (!primary) {
    if (wave.ok) notes.push({ tone: "info", text: "파동은 해석 대상이지만 이번 주 매수 신호 캔들이 없어요 — 신호가 나올 때까지 기다려요", rule: RULE_45 });
    return res;
  }
  res.primary = primary.id;
  const stop = primary.refLow * (1 - P.stopBufferPct / 100);
  const entry = w.close - (w.close - stop) * P.entryFraction;
  const stopPct = (1 - stop / entry) * 100;
  res.stop = stop;
  res.stopPct = stopPct;

  if (!wave.ok) {
    notes.push({ tone: "warn", text: `${primary.name} 신호가 나왔지만 파동이 해석 대상이 아니라 진입 근거가 없어요`, rule: RULE_45 });
    return res;
  }
  if (stopPct > P.maxStopPct) {
    res.waitPrice = stop / (1 - P.maxStopPct / 100);
    notes.push({ tone: "warn", text: `손절폭이 −${pct(stopPct)}%로 최대 −${P.maxStopPct}%를 넘어요. 진입가가 ${px(res.waitPrice)} 이하로, 범위 안으로 내려올 때까지 진입을 미뤄요`, rule: "M4-01 캔들마스터" });
    return res;
  }

  const signalTextbook = stopPct <= P.defaultStopPct;
  const standard = wave.textbook && (group?.compact ?? false) && signalTextbook;
  const mult = standard ? P.standardMultiple : P.nonStandardMultiple;
  const entryMid = (w.close + stop) / 2;
  res.valid = true;
  res.standard = standard;
  res.entry = entry;
  res.entryMid = entryMid;
  res.target = entry * mult;
  res.targetMultiple = mult;
  res.breakevenTrigger = entry * P.breakevenMultiple;
  notes.push(
    signalTextbook
      ? { tone: "good", text: `손절가 ${px(stop)}(${primary.name} 저점 아래), 진입가 대비 −${pct(stopPct)}%로 기본 −${P.defaultStopPct}% 안이에요`, rule: "M4-01 캔들마스터" }
      : { tone: "warn", text: `손절가 ${px(stop)}, 진입가 대비 −${pct(stopPct)}%로 기본 −${P.defaultStopPct}%보다 넓어요(최대 −${P.maxStopPct}% 안). 나눠 산다면 회차별 비중을 7~8%로 낮춰 실제 손실을 맞춰요`, rule: "M4-01 캔들마스터" },
    { tone: "info", text: `진입가 ${px(entry)}: 종가 ${px(w.close)}와 손절가 사이 1/3 지점에서 지정가로 기다려요(중간 지점 ${px(entryMid)}도 가능)`, rule: "M3-12 캔들마스터" },
    {
      tone: "info",
      text: `${standard ? "파동·캔들군·신호가 모두 표준이라" : "표준이 아닌 요소가 있어"} 목표는 진입가의 ${mult}배(${px(entry * mult)})예요. +100%(${px(entry * P.breakevenMultiple)})에 닿은 뒤 밀리면 본전에 팔아요`,
      rule: "M3-13 캔들마스터",
    },
  );
  return res;
}

/** 일봉에서 마지막으로 마감된 주의 판정(진행 중인 주는 뺀다) */
export function candleMaster(candles: Candle[], params: Partial<CandleMasterParams> = {}): CandleMasterResult | null {
  const weekly = completedWeeks(toWeekly(candles));
  return weekly.length ? candleMasterAt(weekly, weekly.length - 1, params) : null;
}

// ───────────────────────── 비중·기대치 ─────────────────────────

export const CANDLE_MASTER_SIZING = {
  /** 소액 기준(원). M4-03·5.2 캔들마스터 "자금 1,000만 원 이하" — 책 */
  smallCapital: 10_000_000,
  /** 소액: 종목당 20%, 최대 5종목 — 책(5.2) */
  smallPerStockPct: 20,
  smallMaxPositions: 5,
  /** 그 이상: 종목당 10%, 최대 10종목 — 책(5.2) */
  perStockPct: 10,
  maxPositions: 10,
  /** 어떤 경우도 종목당 30% 이하 — 책(M4-03 강영현) */
  hardCapPct: 30,
};

export interface CandleMasterSizing {
  perStockPct: number;
  maxPositions: number;
  /** 종목당 금액(원) */
  perStockAmount: number;
  notes: Note[];
}

/** M4-03 캔들마스터 비중. capital은 원 단위(해외 계좌는 원화로 환산해 넣는다) */
export function candleMasterSizing(capital: number, sizing: Partial<typeof CANDLE_MASTER_SIZING> = {}): CandleMasterSizing {
  const S = { ...CANDLE_MASTER_SIZING, ...sizing };
  const cap = Number.isFinite(capital) && capital > 0 ? capital : 0;
  const small = cap <= S.smallCapital;
  const perStockPct = Math.min(small ? S.smallPerStockPct : S.perStockPct, S.hardCapPct);
  const maxPositions = small ? S.smallMaxPositions : S.maxPositions;
  const won = (x: number) => `${Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
  return {
    perStockPct, maxPositions, perStockAmount: (cap * perStockPct) / 100,
    notes: [
      { tone: "info", text: `자금 ${won(cap)}이 ${won(S.smallCapital)} ${small ? "이하라" : "을 넘어"} 종목당 ${perStockPct}%(${won((cap * perStockPct) / 100)}), 최대 ${maxPositions}종목까지 담아요`, rule: "M4-03 캔들마스터" },
      { tone: "info", text: "나눠 산다면 1·2차 각 5%, 예외적인 3차까지 합쳐 종목당 20% 안으로 맞추고, 손실 중 추가 매수는 2번 이상 하지 않아요", rule: "5.2 캔들마스터" },
    ],
  };
}

/**
 * 2-4-4 법칙 안내(4.5). 저자 경험칙이지 검증된 통계가 아니다.
 * counts를 주면 지금까지의 손절·본전·목표 건수를 함께 보여 준다.
 */
export function candleMaster244Note(counts?: { stop: number; breakeven: number; target: number }): Note {
  let text = "저자 경험칙(2-4-4 법칙): 신호대로 1년에 20종목을 사면 대략 4개는 손절, 8개는 본전, 8개는 목표 달성이 정상이라고 해요. 검증되지 않은 저자 주장이라 기대치를 맞추는 참고로만 봐 주세요";
  if (counts) {
    const n = counts.stop + counts.breakeven + counts.target;
    text += n > 0 ? `. 지금까지 ${n}건 중 손절 ${counts.stop} · 본전 ${counts.breakeven} · 목표 ${counts.target}건이에요` : ". 아직 마감한 거래가 없어요";
  }
  return { tone: "info", text, rule: RULE_45 };
}
