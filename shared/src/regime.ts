import { rsi } from "./indicators";
import { prepareStage, stageAt, STAGE_LABEL, type StageResult } from "./stage";
import type { Candle, Note } from "./types";
import { completedWeeks, toWeekly, type WeeklyBar } from "./weekly";

/** 시장 국면: 지수가 돈을 벌 수 있는 구간인가 */
export type Regime = "BULL" | "NEUTRAL" | "BEAR";

export const REGIME_LABEL: Record<Regime, string> = { BULL: "강세", NEUTRAL: "중립", BEAR: "약세" };

export function regimeFromStage(r: StageResult): Regime {
  if (r.stage === 2) return "BULL";
  if (r.stage === 4) return "BEAR";
  if (r.stage === 3 && r.close < r.ma30) return "BEAR";
  return "NEUTRAL";
}

export interface RegimeResult {
  regime: Regime;
  stage: StageResult;
  /** 지수 일봉 RSI(14) */
  rsi: number | null;
  asOf: string;
  notes: Note[];
}

export function marketRegime(indexCandles: Candle[]): RegimeResult | null {
  const weekly = completedWeeks(toWeekly(indexCandles));
  const ctx = prepareStage(weekly);
  const st = stageAt(ctx, weekly.length - 1);
  if (!st) return null;
  const regime = regimeFromStage(st);
  const r = rsi(indexCandles.map((c) => c.close), 14).at(-1) ?? null;
  const notes: Note[] = [
    { tone: regime === "BULL" ? "good" : regime === "BEAR" ? "bad" : "info", text: `지수 ${STAGE_LABEL[st.stage]} → 시장 ${REGIME_LABEL[regime]}` },
  ];
  if (r != null && r > 75) notes.push({ tone: "warn", text: `지수 RSI ${r.toFixed(0)}: 단기 과열 — 신규 진입은 비중을 줄이세요` });
  if (r != null && r < 25) notes.push({ tone: "info", text: `지수 RSI ${r.toFixed(0)}: 단기 과매도` });
  return { regime, stage: st, rsi: r, asOf: st.weekDate, notes };
}

/** 백테스트용: 지수 주봉별 국면(weekKey -> regime). 각 주는 그 주까지의 데이터만 사용 */
export function regimeByWeek(index: WeeklyBar[]): Map<string, Regime> {
  const ctx = prepareStage(index);
  const out = new Map<string, Regime>();
  for (let k = 0; k < index.length; k++) {
    const st = stageAt(ctx, k);
    if (st) out.set(index[k]!.weekKey, regimeFromStage(st));
  }
  return out;
}
