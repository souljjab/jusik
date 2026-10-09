import { computeIndicators } from "./indicators";
import { BUY_ACTIONS, downgradeBuy } from "./action";
import { detectCandlePatterns, type CandlePattern } from "./candles";
import { marketRegime, REGIME_LABEL, type RegimeResult } from "./regime";
import { screenFundamentals, type ScreeningResult } from "./screening";
import { MIN_WEEKS, prepareStage, relativeStrength, stageAt, STAGE_LABEL, type StageResult } from "./stage";
import { technicalScoreAt } from "./technical";
import type { Action, Candle, Fundamentals, Note, ScoreResult } from "./types";
import { completedWeeks, toWeekly } from "./weekly";

export interface Analysis {
  /** 시장 국면과 종목 스크리닝을 반영한 최종 의견 */
  action: Action;
  /** 단계 신호만 본 원래 의견(게이트 적용 전) */
  timingAction: Action;
  /** 게이트에서 의견이 바뀐 이유 */
  gates: Note[];
  asOf: string;
  price: number;
  /** ① 시장 국면. 지수 데이터가 없으면 null */
  regime: RegimeResult | null;
  /** ② 종목 스크리닝(재무 체크리스트) */
  screening: ScreeningResult;
  /** ③ 주봉 단계 + 진입·청산 */
  timing: StageResult;
  /** 현재가가 참고 손절가 아래인지 */
  belowStop: boolean;
  /** 참고 손절가 기준 1:2 손익비 목표가 */
  target: number;
  /** 보조: 일봉 캔들 신호 */
  candlePatterns: CandlePattern[];
  /** 보조: 일봉 기반 단기 점수(-100~100). 진입 판단이 아니라 단기 과열/눌림 참고용 */
  shortTerm: ScoreResult;
}

export interface AnalyzeInput {
  candles: Candle[];
  fundamentals?: Fundamentals;
  /** 종목이 속한 시장 지수의 일봉. 없으면 시장 국면과 상대강도를 건너뛴다 */
  indexCandles?: Candle[];
}

/** 4단계 파이프라인: 시장 국면 → 종목 스크리닝 → 진입·청산 → (리스크는 risk.ts에서 계산) */
export function analyze({ candles, fundamentals, indexCandles }: AnalyzeInput): Analysis | null {
  const weekly = completedWeeks(toWeekly(candles));
  if (weekly.length < MIN_WEEKS) return null;

  const ctx = prepareStage(weekly);
  const rs = indexCandles?.length ? relativeStrength(weekly, toWeekly(indexCandles)) : undefined;
  const timing = stageAt(ctx, weekly.length - 1, rs);
  if (!timing) return null;

  const regime = indexCandles?.length ? marketRegime(indexCandles) : null;
  const screening = screenFundamentals(fundamentals);

  let action = timing.action;
  const gates: Note[] = [];
  if (BUY_ACTIONS.includes(action)) {
    if (regime?.regime === "BEAR") {
      action = "HOLD";
      gates.push({ tone: "bad", text: `시장 국면이 ${REGIME_LABEL.BEAR}이라 신규 매수를 보류해요(개별 종목이 좋아도 지수가 약하면 실패 확률이 높아요)` });
    } else if (screening.grade === "D") {
      action = downgradeBuy(action);
      gates.push({ tone: "warn", text: `재무 체크리스트 ${screening.passed}/${screening.known} 통과(D등급) — 재무가 약해 한 단계 낮췄어요` });
    }
  }
  if (regime?.regime === "NEUTRAL" && BUY_ACTIONS.includes(action))
    gates.push({ tone: "info", text: "시장 국면이 중립이에요. 분할 진입하고 비중을 줄이세요" });
  if (screening.grade === "N/A") gates.push({ tone: "info", text: "재무 데이터가 부족해 스크리닝은 반영하지 않았어요" });
  if (!regime) gates.push({ tone: "info", text: "지수 데이터가 없어 시장 국면·상대강도는 반영하지 않았어요" });

  const ind = computeIndicators(candles);
  const last = candles[candles.length - 1]!;
  const risk = last.close - timing.stopLoss;
  return {
    action,
    timingAction: timing.action,
    gates,
    asOf: last.date,
    price: last.close,
    regime,
    screening,
    timing,
    belowStop: last.close < timing.stopLoss,
    target: Math.round(last.close + Math.max(risk, 0) * 2),
    candlePatterns: detectCandlePatterns(candles),
    shortTerm: technicalScoreAt(candles, ind, candles.length - 1),
  };
}

export { STAGE_LABEL };
