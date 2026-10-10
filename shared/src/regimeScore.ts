import { macd, rsi } from "./indicators";
import { macroNotes, macroPressure, type MacroSnapshot } from "./macro";
import { marketRegime, REGIME_LABEL, type Regime } from "./regime";
import { STAGE_LABEL } from "./stage";
import type { Candle, Note, Region } from "./types";

/*
 * 시장 국면 점수(자료집 2장 구현 메모, 규칙 M1-01~03·M1-06~08, 2.5절).
 * 지수 추세(주봉 30주선 단계, 일봉 MACD)를 1차 신호로, RSI와 매크로를 보조 신호로 더해
 * 공격·중립·방어 3단계와 그에 맞는 주식 투자 상한을 낸다.
 */

export type Posture = "ATTACK" | "NEUTRAL" | "DEFENSE";

export const POSTURE_LABEL: Record<Posture, string> = { ATTACK: "공격", NEUTRAL: "중립", DEFENSE: "방어" };

/**
 * 국면별 "예수금 대비 주식 투자 상한(%)".
 * 강동진의 지수 MACD 비중 조절(표준 40% ↔ 매수 신호 60%)과 자료집 구현 메모의 예시(60·40·20%)를 참고해
 * 정리자가 고른 예시값이다. 책에 정해진 값이 아니므로 백테스트로 정해야 한다.
 */
export const DEFAULT_POSTURE_CAPS: Record<Posture, number> = { ATTACK: 80, NEUTRAL: 50, DEFENSE: 20 };

/** 점수 배점과 판정 기준. 모두 저자 경험칙이나 사양에서 정한 예시값이라 조정 대상이다 */
export const REGIME_SCORE_PARAMS = {
  /** 주봉 국면 강세 +2 / 약세 -2(M1-01·02 와인스타인) */
  stagePoints: 2,
  /** 지수 MACD가 시그널 위 +1 / 아래 -1(M1-03 강동진) */
  macdPoints: 1,
  /** 이 기간(봉) 안에 MACD-시그널 교차가 choppyCrosses번 이상이면 횡보장 가능성(2.1 강동진, 횟수는 예시값) */
  choppyLookback: 60,
  choppyCrosses: 4,
  /** RSI가 최근 rsiRecoveryLookback봉 안에 이 아래였다가 지금 이 이상이면 +1(M1-08 강영현) */
  rsiOversold: 30,
  rsiRecoveryLookback: 10,
  /** 지수 RSI 과열(기존 regime.ts와 같은 75) → -1 */
  rsiOverheat: 75,
  /** 매크로 부정 신호 1개당 -1, 최대 감점 */
  macroMaxPenalty: 2,
  /** 점수가 이 이상이면 공격, 이 이하면 방어 */
  attackScore: 2,
  defenseScore: -2,
} as const;

export interface RegimeAssessment {
  posture: Posture;
  /** 예수금 대비 주식 투자 상한(%) = caps[posture] */
  exposureCapPct: number;
  score: number;
  /** 지수 주봉 30주선 단계로 본 국면. 주봉이 모자라면 null */
  stageRegime: Regime | null;
  /** 지수 일봉 MACD(12,26,9)가 시그널 위인가. 데이터가 모자라면 null */
  macdBullish: boolean | null;
  /** 최근 60봉에서 MACD 교차가 잦음 → 횡보장 가능성 */
  choppy: boolean;
  /** 지수 일봉 RSI(14) */
  rsi: number | null;
  /** 점수 구성(합이 score) */
  breakdown: { stage: number; macd: number; rsi: number; macro: number };
  /** 마지막 봉 날짜 */
  asOf: string;
  notes: Note[];
}

export interface AssessRegimeOptions {
  /** 지수의 지역. US면 원화 약세 신호를 매크로 감점에서 뺀다 */
  region?: Region;
}

const POSTURE_TEXT: Record<Posture, string> = {
  ATTACK: "추세 신호에 따르고 주도주에 집중해요",
  NEUTRAL: "포트폴리오를 가볍게 하고 승률 높은 스윙만 해요",
  DEFENSE: "보유 종목을 줄이고 신규 매수는 엄격하게 해요",
};

/**
 * 지수 일봉 마지막 봉 시점의 국면 판정. 넘겨준 배열 끝까지만 쓴다(과거 시점은 assessRegimeAt).
 * 주봉 단계와 MACD를 둘 다 계산할 수 없으면 null.
 */
export function assessRegime(
  indexCandles: Candle[],
  macro?: MacroSnapshot | null,
  caps: Record<Posture, number> = DEFAULT_POSTURE_CAPS,
  opts: AssessRegimeOptions = {},
): RegimeAssessment | null {
  const P = REGIME_SCORE_PARAMS;
  const i = indexCandles.length - 1;
  if (i < 0) return null;
  const closes = indexCandles.map((c) => c.close);

  // 1) 주봉 30주선 단계(M1-01·02 와인스타인)
  const st = marketRegime(indexCandles);
  const stageRegime = st?.regime ?? null;

  // 2) 일봉 MACD(M1-03 강동진)
  const m = macd(closes, 12, 26, 9);
  const mv = m.macd[i], sv = m.signal[i];
  const macdBullish = mv != null && sv != null ? mv > sv : null;
  if (stageRegime == null && macdBullish == null) return null;

  const notes: Note[] = [];
  const breakdown = { stage: 0, macd: 0, rsi: 0, macro: 0 };

  if (st) {
    breakdown.stage = stageRegime === "BULL" ? P.stagePoints : stageRegime === "BEAR" ? -P.stagePoints : 0;
    const head = `지수 ${STAGE_LABEL[st.stage.stage]} → 시장 ${REGIME_LABEL[st.regime]}`;
    if (stageRegime === "BULL") notes.push({ tone: "good", text: `${head}: 상승하는 30주선 위라 매수 우호 국면이에요`, rule: "M1-01 와인스타인" });
    else if (stageRegime === "BEAR") notes.push({ tone: "bad", text: `${head}: 30주선 아래라 신규 매수를 멈추고 보유를 줄여요`, rule: "M1-02 와인스타인" });
    else notes.push({ tone: "info", text: `${head}: 30주선 방향이 뚜렷하지 않아요`, rule: "M1-01 와인스타인" });
  } else {
    notes.push({ tone: "info", text: "지수 주봉이 모자라 30주선 국면은 빠졌어요. 공격 국면으로는 판정하지 않아요", rule: "M1-01 와인스타인" });
  }

  let choppy = false;
  if (macdBullish != null) {
    breakdown.macd = macdBullish ? P.macdPoints : -P.macdPoints;
    const zero = mv! >= 0 ? "0선 위" : "0선 아래";
    notes.push(
      macdBullish
        ? { tone: "good", text: `지수 MACD가 시그널 위(${zero}): 주식 비중을 늘리는 구간이에요`, rule: "M1-03 강동진" }
        : { tone: "warn", text: `지수 MACD가 시그널 아래(${zero}): 주식 비중을 줄이는 구간이에요`, rule: "M1-03 강동진" },
    );
    const crosses = countCrosses(m.macd, m.signal, i, P.choppyLookback);
    choppy = crosses >= P.choppyCrosses;
    if (choppy) notes.push({ tone: "warn", text: `최근 ${P.choppyLookback}봉에 MACD 교차가 ${crosses}번이에요. 신호가 어지러워 횡보장일 수 있어요`, rule: "M1-03 강동진" });
  }

  // 3) RSI 회복 가점(M1-08 강영현)과 과열 감점(2.4 강영현)
  const rs = rsi(closes, 14);
  const r = rs[i] ?? null;
  if (r != null) {
    let wasOversold = false;
    for (let k = Math.max(0, i - P.rsiRecoveryLookback); k < i; k++) {
      const v = rs[k];
      if (v != null && v < P.rsiOversold) wasOversold = true;
    }
    if (wasOversold && r >= P.rsiOversold) {
      breakdown.rsi = 1;
      notes.push({ tone: "good", text: `지수 RSI가 ${P.rsiOversold} 아래에서 ${r.toFixed(0)}로 회복했어요. 매수 구간이에요`, rule: "M1-08 강영현" });
    } else if (r < P.rsiOversold) {
      notes.push({ tone: "info", text: `지수 RSI ${r.toFixed(0)}: 과매도예요. ${P.rsiOversold} 위로 회복할 때를 기다려요`, rule: "M1-08 강영현" });
    } else if (r > P.rsiOverheat) {
      breakdown.rsi = -1;
      notes.push({ tone: "warn", text: `지수 RSI ${r.toFixed(0)}: 단기 과열이에요. 신규 진입 비중을 줄이세요`, rule: "2.4 강영현" });
    }
  }

  // 4) 매크로 감점(M1-06·07 강영현 등). 신호 1개당 -1, 최대 -2
  if (macro) {
    notes.push(...macroNotes(macro, opts.region));
    const pressure = macroPressure(macro, opts.region);
    breakdown.macro = pressure > 0 ? -Math.min(pressure, P.macroMaxPenalty) : 0;
    if (pressure > 0) notes.push({ tone: "warn", text: `매크로 부정 신호 ${pressure}개 → 국면 점수 ${breakdown.macro}점`, rule: "2.3 강영현" });
  }

  const score = breakdown.stage + breakdown.macd + breakdown.rsi + breakdown.macro;
  let posture: Posture = score >= P.attackScore ? "ATTACK" : score <= P.defenseScore ? "DEFENSE" : "NEUTRAL";
  // 지수가 30주선 아래 하락 국면이면 점수와 상관없이 방어(M1-02: 신규 매수 중단)
  if (stageRegime === "BEAR") posture = "DEFENSE";
  // 주봉 확인 없이 공격으로 가지 않는다(보수적 처리)
  if (stageRegime == null && posture === "ATTACK") posture = "NEUTRAL";
  const exposureCapPct = caps[posture];

  notes.unshift({
    tone: posture === "ATTACK" ? "good" : posture === "DEFENSE" ? "bad" : "info",
    text: `국면 점수 ${score > 0 ? "+" : ""}${score} → ${POSTURE_LABEL[posture]}: ${POSTURE_TEXT[posture]}. 주식 투자 상한 ${exposureCapPct}%`,
    rule: "2.5 강동진",
  });

  return { posture, exposureCapPct, score, stageRegime, macdBullish, choppy, rsi: r, breakdown, asOf: indexCandles[i]!.date, notes };
}

/**
 * 백테스트·재현용: i번째 봉 종가 시점의 판정. i 이후 데이터는 쓰지 않는다.
 * macro도 그 시점 것(buildMacroSnapshot의 asOf 옵션)을 넘겨야 미래 참조가 없다.
 */
export function assessRegimeAt(
  indexCandles: Candle[],
  i: number,
  macro?: MacroSnapshot | null,
  caps: Record<Posture, number> = DEFAULT_POSTURE_CAPS,
  opts: AssessRegimeOptions = {},
): RegimeAssessment | null {
  if (i < 0 || i >= indexCandles.length) return null;
  return assessRegime(indexCandles.slice(0, i + 1), macro, caps, opts);
}

/** i까지 lookback봉 안에서 a가 b를 교차한 횟수(위·아래 모두) */
function countCrosses(a: (number | null)[], b: (number | null)[], i: number, lookback: number): number {
  let n = 0;
  for (let t = Math.max(1, i - lookback + 1); t <= i; t++) {
    const a0 = a[t - 1], b0 = b[t - 1], a1 = a[t], b1 = b[t];
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
    if ((a0 <= b0 && a1 > b1) || (a0 >= b0 && a1 < b1)) n++;
  }
  return n;
}
