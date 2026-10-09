import { sma } from "./indicators";
import type { Action, Note } from "./types";
import type { WeeklyBar } from "./weekly";

/** 와인스타인 4단계: 1 바닥(기초) / 2 상승 / 3 천장 / 4 하락 */
export type Stage = 1 | 2 | 3 | 4;

export const STAGE_LABEL: Record<Stage, string> = {
  1: "1단계 · 바닥 다지기",
  2: "2단계 · 상승",
  3: "3단계 · 천장권",
  4: "4단계 · 하락",
};

export const STAGE_PARAMS = {
  maPeriod: 30,
  /** 30주선 기울기를 보는 기간(주) */
  slopeWeeks: 4,
  /** 이 이상이면 상승/하락 기울기로 본다(%) */
  slopeFlatPct: 0.5,
  trendWeeks: 26,
  breakoutWeeks: 20,
  /** 돌파 시 필요한 거래량 배수(직전 4주 평균 대비) */
  breakoutVolume: 2,
  /** 30주선에서 이만큼 이상 벌어지면 과열(추격 금지, %) */
  extendedPct: 25,
  stopWeeks: 8,
  rsWeeks: 52,
} as const;

export const MIN_WEEKS = STAGE_PARAMS.maPeriod + STAGE_PARAMS.slopeWeeks - 1;

export interface StageContext {
  weekly: WeeklyBar[];
  ma30: (number | null)[];
}

export function prepareStage(weekly: WeeklyBar[]): StageContext {
  return { weekly, ma30: sma(weekly.map((w) => w.close), STAGE_PARAMS.maPeriod) };
}

export interface StageResult {
  stage: Stage;
  action: Action;
  weekDate: string;
  close: number;
  ma30: number;
  /** 30주선의 최근 4주 기울기(%) */
  slopePct: number;
  /** 30주선의 최근 약 26주 변화(%) — 직전 추세 방향 */
  trendPct: number;
  /** 종가가 30주선에서 벌어진 정도(%) */
  pctFromMa: number;
  breakout: boolean;
  /** 이번 주 거래량 / 직전 4주 평균 */
  volumeRatio: number | null;
  /** 만스필드 상대강도(지수 대비). 0 위면 지수보다 강함. 데이터 없으면 null */
  rs: number | null;
  /** 최근 8주 저점(참고 손절가) */
  stopLoss: number;
  notes: Note[];
}

/**
 * 만스필드 상대강도: (종목/지수 비율) / 비율의 52주 평균 - 1, %.
 * 주봉은 weekKey로 맞춘다. 지수가 없는 주가 52주 구간에 있으면 null.
 */
export function relativeStrength(weekly: WeeklyBar[], index: WeeklyBar[]): (number | null)[] {
  const idx = new Map(index.map((w) => [w.weekKey, w.close]));
  const ratio = weekly.map((w) => {
    const c = idx.get(w.weekKey);
    return c ? w.close / c : null;
  });
  const n = STAGE_PARAMS.rsWeeks;
  return ratio.map((r, k) => {
    if (r == null || k < n - 1) return null;
    let sum = 0;
    for (let j = k - n + 1; j <= k; j++) {
      const v = ratio[j];
      if (v == null) return null;
      sum += v;
    }
    return (r / (sum / n) - 1) * 100;
  });
}

/** k번째 주 마감 시점의 단계 판정(k 이후 데이터는 쓰지 않는다). 데이터가 모자라면 null */
export function stageAt(ctx: StageContext, k: number, rs?: (number | null)[]): StageResult | null {
  const P = STAGE_PARAMS;
  const { weekly, ma30 } = ctx;
  const w = weekly[k];
  const m = ma30[k];
  const mPrev = ma30[k - P.slopeWeeks];
  if (!w || m == null || mPrev == null) return null;

  const slopePct = (m / mPrev - 1) * 100;
  const firstValid = P.maPeriod - 1;
  const back = Math.min(P.trendWeeks, k - firstValid);
  const mOld = ma30[k - back];
  const trendPct = mOld ? (m / mOld - 1) * 100 : 0;
  const pctFromMa = (w.close / m - 1) * 100;
  const above = w.close > m;

  let stage: Stage;
  if (slopePct > P.slopeFlatPct && above) stage = 2;
  else if (slopePct < -P.slopeFlatPct && !above) stage = 4;
  else stage = trendPct >= 0 ? 3 : 1;

  const prior = weekly.slice(Math.max(0, k - P.breakoutWeeks), k);
  const priorHigh = prior.length ? Math.max(...prior.map((x) => x.high)) : Infinity;
  const breakout = prior.length >= P.breakoutWeeks / 2 && w.close > priorHigh;

  const volPrev = weekly.slice(Math.max(0, k - 4), k);
  const volAvg = volPrev.length ? volPrev.reduce((a, x) => a + x.volume, 0) / volPrev.length : 0;
  const volumeRatio = volAvg > 0 ? w.volume / volAvg : null;
  const volOk = volumeRatio != null && volumeRatio >= P.breakoutVolume;

  const rsVal = rs?.[k] ?? null;
  const stopLoss = Math.min(...weekly.slice(Math.max(0, k - P.stopWeeks + 1), k + 1).map((x) => x.low));
  const extended = pctFromMa > P.extendedPct;

  const notes: Note[] = [];
  const stageNote: Record<Stage, Note> = {
    1: { tone: "info", text: "30주선이 평평하고 직전엔 하락 추세 — 바닥을 다지는 중(매수는 돌파 확인 후)" },
    2: { tone: "good", text: "종가가 상승 중인 30주선 위 — 상승 단계" },
    3: { tone: "warn", text: "30주선이 평평하거나 가격이 선 아래로 흔들림 — 천장권/조정 가능성" },
    4: { tone: "bad", text: "종가가 하락 중인 30주선 아래 — 하락 단계(매수 금지 목록)" },
  };
  notes.push(stageNote[stage]);
  if (breakout) notes.push({ tone: volOk ? "good" : "warn", text: volOk ? `최근 ${P.breakoutWeeks}주 고점 돌파 + 거래량 ${volumeRatio!.toFixed(1)}배(유효한 돌파)` : `최근 ${P.breakoutWeeks}주 고점 돌파했지만 거래량이 부족해요(${volumeRatio?.toFixed(1) ?? "-"}배, 기준 ${P.breakoutVolume}배)` });
  if (rsVal != null) notes.push({ tone: rsVal > 0 ? "good" : "bad", text: `상대강도 ${rsVal > 0 ? "+" : ""}${rsVal.toFixed(1)}: 지수보다 ${rsVal > 0 ? "강함" : "약함"}` });
  if (stage === 2 && extended) notes.push({ tone: "warn", text: `30주선에서 ${pctFromMa.toFixed(0)}% 벌어짐(기준 ${P.extendedPct}%) — 추격 매수 금지, 눌림 대기` });

  let action: Action = "HOLD";
  if (stage === 4) action = "STRONG_SELL";
  else if (stage === 3) action = above ? "HOLD" : "SELL";
  else if (stage === 2) {
    if (extended) action = "HOLD";
    else if (breakout && volOk) action = rsVal != null && rsVal < 0 ? "BUY" : "STRONG_BUY";
    else if (rsVal != null && rsVal < 0) action = "HOLD";
    else action = "BUY";
  } else if (stage === 1 && above && breakout && volOk) {
    action = "BUY";
    notes.push({ tone: "good", text: "바닥권에서 거래량을 동반해 30주선 위로 돌파 — 2단계 진입 초입" });
  }

  return { stage, action, weekDate: w.date, close: w.close, ma30: m, slopePct, trendPct, pctFromMa, breakout, volumeRatio, rs: rsVal, stopLoss, notes };
}
