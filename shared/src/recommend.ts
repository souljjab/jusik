import type { Action, Candle, Fundamentals, Reason } from "./types";
import { computeIndicators } from "./indicators";
import { technicalScoreAt } from "./technical";
import { valuationScore } from "./valuation";

export interface Recommendation {
  action: Action;
  /** -100 ~ 100 */
  total: number;
  technical: number;
  /** 재무 데이터가 없으면 null */
  valuation: number | null;
  technicalReasons: Reason[];
  valuationReasons: Reason[];
  price: number;
  /** ATR 기반 참고 가격. 투자 판단의 근거가 아니라 위험 관리용 참고치 */
  stopLoss: number | null;
  target: number | null;
  asOf: string;
}

export const ACTION_LABEL: Record<Action, string> = {
  STRONG_BUY: "강력 매수",
  BUY: "매수",
  HOLD: "관망",
  SELL: "매도",
  STRONG_SELL: "강력 매도",
};

export function actionFromScore(total: number): Action {
  if (total >= 50) return "STRONG_BUY";
  if (total >= 20) return "BUY";
  if (total > -20) return "HOLD";
  if (total > -50) return "SELL";
  return "STRONG_SELL";
}

export const TECH_WEIGHT = 0.6;

/** 최소 필요 봉 수(120일선이 계산되기 전엔 신뢰도가 낮다) */
export const MIN_CANDLES = 60;

export function recommend(candles: Candle[], fundamentals?: Fundamentals): Recommendation | null {
  if (candles.length < MIN_CANDLES) return null;
  const ind = computeIndicators(candles);
  const i = candles.length - 1;
  const tech = technicalScoreAt(candles, ind, i);
  const val = valuationScore(fundamentals);
  const total = Math.round(val ? tech.score * TECH_WEIGHT + val.score * (1 - TECH_WEIGHT) : tech.score);
  const last = candles[i]!;
  const a = ind.atr14[i];
  return {
    action: actionFromScore(total),
    total,
    technical: tech.score,
    valuation: val ? val.score : null,
    technicalReasons: tech.reasons,
    valuationReasons: val ? val.reasons : [],
    price: last.close,
    stopLoss: a != null ? Math.round(last.close - 2 * a) : null,
    target: a != null ? Math.round(last.close + 3 * a) : null,
    asOf: last.date,
  };
}
