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

/** 책의 수치는 저자 경험칙이다. 백테스트로 조정할 기준값 */
export const STAGE_PARAMS = {
  maPeriod: 30,
  /** 30주선 기울기를 보는 기간(주) */
  slopeWeeks: 4,
  /** 이 이상이면 상승/하락 기울기로 본다(%) */
  slopeFlatPct: 0.5,
  trendWeeks: 26,
  breakoutWeeks: 20,
  /** 돌파 시 필요한 거래량 배수(직전 4주 평균 대비). M3-01 와인스타인 */
  breakoutVolume: 2,
  /** 대안 거래량 조건(4.1 와인스타인 "최근 3~4주 누적 거래량이 평균의 2배 이상 + 돌파 주 증가"): 최근 4주 누적 */
  cumVolumeWeeks: 4,
  /** 대안 거래량 조건의 '평균' 구간: 그 이전 12주 평균 주간 거래량(정리자 정의 — 책엔 구간 수치 없음) */
  cumVolumeBaseWeeks: 12,
  /** 최근 4주 누적 ≥ 평균 주간 거래량 × 4 × 이 배수 */
  cumVolumeMultiple: 2,
  /** 30주선에서 이만큼 이상 벌어지면 과열(추격 금지, %) */
  extendedPct: 25,
  stopWeeks: 8,
  /** 손절폭 상한(종가 대비 비율). M4-01 와인스타인 "최대 약 10%", 역주의 국내 기관 약 10% 로스컷 */
  maxStopPct: 0.1,
  rsWeeks: 52,
  /** 스윙 목표(M3-03)를 찾는 구간(주) */
  swingWeeks: 52,
  /** 고점 대비 이만큼(%) 이상 떨어지면 '주요 하락'으로 본다(정리자 정의 — 책엔 수치 없음) */
  swingDropPct: 15,
  /** 풀백 추가 매수(M3-02): 돌파 후 이 주 수 안의 첫 풀백만 본다 */
  pullbackMaxWeeks: 6,
  /** 풀백이 돌파 기준가 ±이 비율(%) 안에 닿아야 한다 */
  pullbackBandPct: 3,
} as const;

export const MIN_WEEKS = STAGE_PARAMS.maPeriod + STAGE_PARAMS.slopeWeeks - 1;

export interface StageContext {
  weekly: WeeklyBar[];
  ma30: (number | null)[];
}

export function prepareStage(weekly: WeeklyBar[]): StageContext {
  return { weekly, ma30: sma(weekly.map((w) => w.close), STAGE_PARAMS.maPeriod) };
}

/** 돌파 거래량을 어느 조건으로 확인했는지: 돌파 주 단독(WEEK) / 최근 4주 누적(CUMULATIVE) */
export type VolumeBasis = "WEEK" | "CUMULATIVE";

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
  /** 최근 4주 누적 거래량 / (그 이전 12주 평균 주간 거래량 × 4). 데이터가 모자라면 null */
  cumVolumeRatio: number | null;
  /** 돌파 거래량 조건을 통과한 기준. 돌파가 아니거나 거래량이 부족하면 null */
  volumeBasis: VolumeBasis | null;
  /** 만스필드 상대강도(지수 대비). 0 위면 지수보다 강함. 데이터 없으면 null */
  rs: number | null;
  /** 최근 8주 저점(지지선) */
  supportLow: number;
  /** 손절가 = max(최근 8주 저점, 종가 × (1 − 10%)). 손절폭이 10%를 넘지 않게 한다(M4-01) */
  stopLoss: number;
  /** 스윙 목표가 A + (A − B). 최근 52주 안의 주요 하락(고점 A → 저점 B)을 넘어섰을 때만 값이 있다(M3-03) */
  swingTarget: number | null;
  /** 돌파 후 첫 풀백에서 돌파가 위를 지켰다 → 추가 매수 자리(M3-02) */
  pullbackBuy: boolean;
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

interface BreakoutCheck {
  breakout: boolean;
  /** 돌파 기준가: 직전 20주 고점 */
  pivot: number;
  volumeRatio: number | null;
  cumVolumeRatio: number | null;
  volumeBasis: VolumeBasis | null;
}

/** k번째 주의 돌파 여부와 거래량 조건(M3-01). k 이후 데이터는 쓰지 않는다 */
function breakoutAt(weekly: WeeklyBar[], k: number): BreakoutCheck {
  const P = STAGE_PARAMS;
  const w = weekly[k]!;
  const prior = weekly.slice(Math.max(0, k - P.breakoutWeeks), k);
  const pivot = prior.length ? Math.max(...prior.map((x) => x.high)) : Infinity;
  const breakout = prior.length >= P.breakoutWeeks / 2 && w.close > pivot;

  const volPrev = weekly.slice(Math.max(0, k - 4), k);
  const volAvg = volPrev.length ? volPrev.reduce((a, x) => a + x.volume, 0) / volPrev.length : 0;
  const volumeRatio = volAvg > 0 ? w.volume / volAvg : null;

  // 대안: 최근 4주(이번 주 포함) 누적이 그 이전 12주 평균 주간 거래량 × 4의 2배 이상이고, 이번 주가 전주보다 많다
  let cumVolumeRatio: number | null = null;
  const cumStart = k - P.cumVolumeWeeks + 1;
  const baseStart = cumStart - P.cumVolumeBaseWeeks;
  if (baseStart >= 0) {
    const cum = weekly.slice(cumStart, k + 1).reduce((a, x) => a + x.volume, 0);
    const baseAvg = weekly.slice(baseStart, cumStart).reduce((a, x) => a + x.volume, 0) / P.cumVolumeBaseWeeks;
    if (baseAvg > 0) cumVolumeRatio = cum / (baseAvg * P.cumVolumeWeeks);
  }
  const rising = k > 0 && w.volume > weekly[k - 1]!.volume;

  let volumeBasis: VolumeBasis | null = null;
  if (breakout) {
    if (volumeRatio != null && volumeRatio >= P.breakoutVolume) volumeBasis = "WEEK";
    else if (cumVolumeRatio != null && cumVolumeRatio >= P.cumVolumeMultiple && rising) volumeBasis = "CUMULATIVE";
  }
  return { breakout, pivot, volumeRatio, cumVolumeRatio, volumeBasis };
}

/**
 * 스윙 목표(M3-03): 최근 52주(이번 주 제외)에서 가장 최근의 주요 하락(고점 A → 15% 이상 하락 → 저점 B)을 찾고,
 * 이번 주 종가가 A를 넘었으면 A + (A − B). A를 다시 넘기 전까지는 같은 하락으로 보고 B만 갱신한다.
 */
function swingAt(weekly: WeeklyBar[], k: number): { target: number; a: number; b: number } | null {
  const P = STAGE_PARAMS;
  const start = Math.max(0, k - P.swingWeeks + 1);
  if (k - start < 2) return null;
  let peak = -Infinity;
  let decline: { a: number; b: number } | null = null;
  let falling = false;
  for (let j = start; j < k; j++) {
    const w = weekly[j]!;
    if (falling && decline) {
      decline.b = Math.min(decline.b, w.low);
      if (w.high > decline.a) {
        falling = false; // A를 되찾으면 그 하락은 끝, 다음 고점부터 다시 추적
        peak = w.high;
      }
      continue;
    }
    peak = Math.max(peak, w.high);
    if (w.low <= peak * (1 - P.swingDropPct / 100)) {
      decline = { a: peak, b: w.low };
      falling = true;
    }
  }
  if (!decline || !(weekly[k]!.close > decline.a)) return null;
  return { target: decline.a + (decline.a - decline.b), ...decline };
}

/**
 * 풀백 추가 매수(M3-02): 최근 1~6주 안에 거래량을 확인한 돌파가 있었고, 그 뒤 처음으로 이번 주 저가가
 * 돌파 기준가 ±3% 안에 닿았으며 종가는 기준가 이상. 30주선 아래이거나 30주선이 내려가는 중이면 보지 않는다(M2-11, 3.7).
 */
function pullbackAt(weekly: WeeklyBar[], k: number, aboveMa: boolean, slopePct: number): { pivot: number; weeksAgo: number } | null {
  const P = STAGE_PARAMS;
  if (!aboveMa || slopePct < -P.slopeFlatPct) return null;
  const w = weekly[k]!;
  const band = P.pullbackBandPct / 100;
  for (let j = k - 1; j >= Math.max(1, k - P.pullbackMaxWeeks); j--) {
    const b = breakoutAt(weekly, j);
    if (!b.breakout || !b.volumeBasis) continue;
    const hi = b.pivot * (1 + band);
    const lo = b.pivot * (1 - band);
    // 첫 풀백만: 돌파 다음 주부터 지난주까지 기준가 +3% 안으로 내려온 적이 없어야 한다
    let touched = false;
    for (let t = j + 1; t < k; t++) if (weekly[t]!.low <= hi) touched = true;
    if (touched) continue;
    if (w.low >= lo && w.low <= hi && w.close >= b.pivot) return { pivot: b.pivot, weeksAgo: k - j };
  }
  return null;
}

/** 가격 표시: 큰 값은 정수에 천 단위 쉼표, 작은 값(달러 등)은 소수 둘째 자리 */
const px = (x: number) => (Math.abs(x) >= 1000 ? Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : x.toFixed(2));

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

  const { breakout, volumeRatio, cumVolumeRatio, volumeBasis } = breakoutAt(weekly, k);
  const volOk = volumeBasis != null;

  const rsVal = rs?.[k] ?? null;
  const supportLow = Math.min(...weekly.slice(Math.max(0, k - P.stopWeeks + 1), k + 1).map((x) => x.low));
  const capStop = w.close * (1 - P.maxStopPct);
  const stopLoss = Math.max(supportLow, capStop);
  const extended = pctFromMa > P.extendedPct;
  const swing = swingAt(weekly, k);
  const pullback = pullbackAt(weekly, k, above, slopePct);

  const notes: Note[] = [];
  const stageNote: Record<Stage, Note> = {
    1: { tone: "info", text: "30주선이 평평하고 직전엔 하락 추세 — 바닥을 다지는 중(매수는 돌파 확인 후)", rule: "4.1 와인스타인" },
    2: { tone: "good", text: "종가가 상승 중인 30주선 위 — 상승 단계", rule: "4.1 와인스타인" },
    3: { tone: "warn", text: "30주선이 평평하거나 가격이 선 아래로 흔들림 — 천장권/조정 가능성", rule: "4.1 와인스타인" },
    4: { tone: "bad", text: "종가가 하락 중인 30주선 아래 — 하락 단계(매수 금지 목록)", rule: "M3-04 와인스타인" },
  };
  notes.push(stageNote[stage]);
  if (breakout) {
    const rule = "M3-01 와인스타인";
    if (volumeBasis === "WEEK") notes.push({ tone: "good", text: `최근 ${P.breakoutWeeks}주 고점 돌파 + 거래량 ${volumeRatio!.toFixed(1)}배(유효한 돌파)`, rule });
    else if (volumeBasis === "CUMULATIVE")
      notes.push({ tone: "good", text: `최근 ${P.breakoutWeeks}주 고점 돌파 + 최근 ${P.cumVolumeWeeks}주 누적 거래량 평소의 ${cumVolumeRatio!.toFixed(1)}배, 돌파 주 증가(유효한 돌파 · 누적 기준)`, rule });
    else notes.push({ tone: "warn", text: `최근 ${P.breakoutWeeks}주 고점 돌파했지만 거래량이 부족해요(${volumeRatio?.toFixed(1) ?? "-"}배, 기준 ${P.breakoutVolume}배)`, rule });
  }
  if (rsVal != null) notes.push({ tone: rsVal > 0 ? "good" : "bad", text: `상대강도 ${rsVal > 0 ? "+" : ""}${rsVal.toFixed(1)}: 지수보다 ${rsVal > 0 ? "강함" : "약함"}`, rule: "M3-01 와인스타인" });
  if (stage === 2 && extended) notes.push({ tone: "warn", text: `30주선에서 ${pctFromMa.toFixed(0)}% 벌어짐(기준 ${P.extendedPct}%) — 추격 매수 금지, 눌림 대기`, rule: "4.2 와인스타인" });
  if (pullback)
    notes.push({ tone: "good", text: `돌파 후 첫 풀백(${pullback.weeksAgo}주 전 돌파, 기준가 ${px(pullback.pivot)}), 돌파가 위 유지 → 추가 매수`, rule: "M3-02 와인스타인" });
  if (swing) {
    const reached = w.close >= swing.target;
    notes.push({
      tone: reached ? "warn" : "info",
      text: reached
        ? `스윙 목표가 ${px(swing.target)}에 도달했어요 — 일부 이익 실현을 고려하세요`
        : `스윙 목표가 ${px(swing.target)}(하락 전 고점 ${px(swing.a)} + 하락폭 ${px(swing.a - swing.b)}) — 근처에서 일부 매도`,
      rule: "M3-03 와인스타인",
    });
  }

  let action: Action = "HOLD";
  if (stage === 4) action = "STRONG_SELL";
  else if (stage === 3) action = above ? "HOLD" : "SELL";
  else if (stage === 2) {
    if (extended) action = "HOLD";
    else if (rsVal != null && rsVal <= 0) {
      // M3-01: 돌파여도 상대강도가 0 이하면 사지 않는다(4.1 "RS가 열악한 종목은 절대 사지 않는다")
      action = "HOLD";
      if (breakout && volOk) notes.push({ tone: "warn", text: "돌파했지만 상대강도가 0 이하라 매수하지 않아요(지수보다 약한 종목)", rule: "M3-01 와인스타인" });
    } else if (breakout && volOk) action = "STRONG_BUY";
    else action = "BUY";
  } else if (stage === 1 && above && breakout && volOk) {
    if (slopePct < -P.slopeFlatPct)
      notes.push({ tone: "warn", text: "30주선 위로 돌파했지만 30주선이 아직 내려가는 중이라 매수 후보에서 빼요", rule: "M2-11 와인스타인" });
    else if (rsVal != null && rsVal <= 0)
      notes.push({ tone: "warn", text: "바닥권 돌파지만 상대강도가 0 이하라 매수하지 않아요", rule: "M3-01 와인스타인" });
    else {
      action = "BUY";
      notes.push({ tone: "good", text: "바닥권에서 거래량을 동반해 30주선 위로 돌파 — 2단계 진입 초입", rule: "M3-01 와인스타인" });
    }
  }
  // 하락 단계는 손절가보다 매도가 먼저라 상한 안내를 붙이지 않는다
  if (stage !== 4 && capStop > supportLow)
    notes.push({ tone: "info", text: `손절폭 ${Math.round(P.maxStopPct * 100)}% 상한 적용: 최근 ${P.stopWeeks}주 저점(${px(supportLow)})이 멀어 종가 −${Math.round(P.maxStopPct * 100)}%(${px(capStop)})를 손절가로 써요`, rule: "M4-01 와인스타인" });

  return {
    stage, action, weekDate: w.date, close: w.close, ma30: m, slopePct, trendPct, pctFromMa, breakout, volumeRatio, cumVolumeRatio, volumeBasis,
    rs: rsVal, supportLow, stopLoss, swingTarget: swing?.target ?? null, pullbackBuy: pullback != null, notes,
  };
}
