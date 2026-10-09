import type { Action } from "./types";

export const ACTION_LABEL: Record<Action, string> = {
  STRONG_BUY: "강력 매수",
  BUY: "매수",
  HOLD: "관망",
  SELL: "매도",
  STRONG_SELL: "강력 매도",
};

export const BUY_ACTIONS: Action[] = ["STRONG_BUY", "BUY"];
export const SELL_ACTIONS: Action[] = ["SELL", "STRONG_SELL"];

/** 일봉 점수 -> 액션(단기 보조 점수용) */
export function actionFromScore(total: number): Action {
  if (total >= 50) return "STRONG_BUY";
  if (total >= 20) return "BUY";
  if (total > -20) return "HOLD";
  if (total > -50) return "SELL";
  return "STRONG_SELL";
}

/** 최소 필요 일봉 수(일봉 점수 전략용) */
export const MIN_CANDLES = 60;

const ORDER: Action[] = ["STRONG_SELL", "SELL", "HOLD", "BUY", "STRONG_BUY"];

/** 매수 쪽 액션을 한 단계 낮춘다(매도 쪽은 그대로) */
export function downgradeBuy(a: Action, steps = 1): Action {
  if (!BUY_ACTIONS.includes(a)) return a;
  const idx = Math.max(ORDER.indexOf("HOLD"), ORDER.indexOf(a) - steps);
  return ORDER[idx]!;
}
