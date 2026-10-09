import type { Candle, Reason, ScoreResult } from "./types";
import type { IndicatorSet, Series } from "./indicators";

/** 최근 lookback일 안에 a가 b를 위로(up) 또는 아래로(down) 교차했는지 */
function crossedWithin(a: Series, b: Series, i: number, lookback: number, dir: "up" | "down"): boolean {
  for (let k = 0; k < lookback; k++) {
    const t = i - k;
    if (t < 1) return false;
    const a0 = a[t - 1], b0 = b[t - 1], a1 = a[t], b1 = b[t];
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
    if (dir === "up" && a0 <= b0 && a1 > b1) return true;
    if (dir === "down" && a0 >= b0 && a1 < b1) return true;
  }
  return false;
}

/**
 * i번째 봉 종가 시점의 기술적 점수(-100~100).
 * i 이후의 데이터는 쓰지 않는다(백테스트에서 미래 참조 방지).
 */
export function technicalScoreAt(candles: Candle[], ind: IndicatorSet, i: number): ScoreResult {
  const reasons: Reason[] = [];
  const add = (points: number, text: string) => reasons.push({ points, text });
  const c = candles[i]!;
  const prev = i > 0 ? candles[i - 1]! : undefined;

  const s20 = ind.sma20[i], s60 = ind.sma60[i], s120 = ind.sma120[i];
  if (s20 != null) c.close > s20 ? add(10, "종가가 20일선 위") : add(-10, "종가가 20일선 아래");
  if (s20 != null && s60 != null)
    s20 > s60 ? add(15, "20일선이 60일선 위(중기 상승 추세)") : add(-15, "20일선이 60일선 아래(중기 하락 추세)");
  if (s120 != null) c.close > s120 ? add(10, "종가가 120일선 위") : add(-10, "종가가 120일선 아래");

  if (crossedWithin(ind.sma5, ind.sma20, i, 3, "up")) add(15, "5일선이 20일선을 상향 돌파(골든크로스)");
  else if (crossedWithin(ind.sma5, ind.sma20, i, 3, "down")) add(-15, "5일선이 20일선을 하향 돌파(데드크로스)");

  const h = ind.macd.hist[i];
  if (h != null) h > 0 ? add(10, "MACD 히스토그램 양수") : add(-10, "MACD 히스토그램 음수");
  if (crossedWithin(ind.macd.macd, ind.macd.signal, i, 3, "up")) add(10, "MACD가 시그널선 상향 돌파");
  else if (crossedWithin(ind.macd.macd, ind.macd.signal, i, 3, "down")) add(-10, "MACD가 시그널선 하향 돌파");

  const r = ind.rsi14[i];
  if (r != null) {
    if (r < 30) add(15, `RSI ${r.toFixed(0)}: 과매도 구간`);
    else if (r > 70) add(-15, `RSI ${r.toFixed(0)}: 과매수 구간`);
  }

  const lo = ind.bb.lower[i], up = ind.bb.upper[i];
  if (lo != null && c.close < lo) add(10, "볼린저밴드 하단 이탈(반등 가능성)");
  else if (up != null && c.close > up) add(-10, "볼린저밴드 상단 돌파(과열 가능성)");

  const vAvg = ind.volSma20[i];
  if (vAvg != null && vAvg > 0 && prev && c.volume > vAvg * 2) {
    if (c.close > prev.close) add(10, "거래량 급증(20일 평균의 2배↑)과 함께 상승");
    else if (c.close < prev.close) add(-10, "거래량 급증(20일 평균의 2배↑)과 함께 하락");
  }

  const score = Math.max(-100, Math.min(100, reasons.reduce((a, r) => a + r.points, 0)));
  return { score, reasons };
}
