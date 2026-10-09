import type { Candle } from "./types";

export interface CandlePattern {
  id: string;
  name: string;
  direction: "bullish" | "bearish";
  /** 이 가격을 이탈하면 신호가 무효(손절 참고) */
  invalidation: number;
  note: string;
}

const body = (c: Candle) => Math.abs(c.close - c.open);
const range = (c: Candle) => c.high - c.low;
const upperShadow = (c: Candle) => c.high - Math.max(c.open, c.close);
const lowerShadow = (c: Candle) => Math.min(c.open, c.close) - c.low;
const bullish = (c: Candle) => c.close > c.open;
const bearish = (c: Candle) => c.close < c.open;

/** 마지막 봉 기준으로 대표적인 캔들 반전 신호를 찾는다. 단독으로 매매하지 말고 추세·거래량과 함께 보는 보조 신호. */
export function detectCandlePatterns(candles: Candle[]): CandlePattern[] {
  const n = candles.length;
  if (n < 6) return [];
  const c = candles[n - 1]!;
  const p = candles[n - 2]!;
  const out: CandlePattern[] = [];
  const downBefore = c.close < candles[n - 6]!.close;
  const upBefore = c.close > candles[n - 6]!.close;

  if (range(c) > 0 && body(c) <= range(c) * 0.35) {
    if (downBefore && lowerShadow(c) >= body(c) * 2 && upperShadow(c) <= Math.max(body(c) * 0.5, range(c) * 0.1))
      out.push({ id: "hammer", name: "망치형", direction: "bullish", invalidation: c.low, note: "하락 뒤 긴 아래꼬리 — 매수세 유입. 저점 이탈 시 무효" });
    if (upBefore && upperShadow(c) >= body(c) * 2 && lowerShadow(c) <= Math.max(body(c) * 0.5, range(c) * 0.1))
      out.push({ id: "shooting-star", name: "유성형", direction: "bearish", invalidation: c.high, note: "상승 뒤 긴 위꼬리 — 매도세 유입. 고점 돌파 시 무효" });
  }
  if (bearish(p) && bullish(c) && c.open <= p.close && c.close >= p.open && body(c) > body(p))
    out.push({ id: "bullish-engulfing", name: "상승 장악형", direction: "bullish", invalidation: Math.min(c.low, p.low), note: "직전 음봉을 양봉이 감쌈. 두 봉 저점 이탈 시 무효" });
  if (bullish(p) && bearish(c) && c.open >= p.close && c.close <= p.open && body(c) > body(p))
    out.push({ id: "bearish-engulfing", name: "하락 장악형", direction: "bearish", invalidation: Math.max(c.high, p.high), note: "직전 양봉을 음봉이 감쌈. 두 봉 고점 돌파 시 무효" });

  const a = candles[n - 3]!;
  if (bearish(a) && body(a) > 0 && body(p) <= body(a) * 0.3 && bullish(c) && c.close > (a.open + a.close) / 2)
    out.push({ id: "morning-star", name: "샛별형", direction: "bullish", invalidation: Math.min(a.low, p.low, c.low), note: "긴 음봉 → 작은 봉 → 양봉. 세 봉 저점 이탈 시 무효" });
  if (bullish(a) && body(a) > 0 && body(p) <= body(a) * 0.3 && bearish(c) && c.close < (a.open + a.close) / 2)
    out.push({ id: "evening-star", name: "석별형", direction: "bearish", invalidation: Math.max(a.high, p.high, c.high), note: "긴 양봉 → 작은 봉 → 음봉. 세 봉 고점 돌파 시 무효" });
  return out;
}
