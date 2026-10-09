import type { Candle } from "./types";

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = toRsi(gain, loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = toRsi(gain, loss);
  }
  return out;
}

function toRsi(gain: number, loss: number): number {
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  hist: Series;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line: Series = values.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  // signal = EMA of the macd line, computed from its first defined value
  const first = line.findIndex((v) => v != null);
  const signal: Series = new Array(values.length).fill(null);
  if (first >= 0) {
    const tail = ema(line.slice(first) as number[], signalPeriod);
    tail.forEach((v, i) => (signal[first + i] = v));
  }
  const hist: Series = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i]! : null));
  return { macd: line, signal, hist };
}

export interface BollingerResult {
  mid: Series;
  upper: Series;
  lower: Series;
}

export function bollinger(values: number[], period = 20, mult = 2): BollingerResult {
  const mid = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i]!;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j]! - m) ** 2;
    const sd = Math.sqrt(v / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

/** Wilder's ATR */
export function atr(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  let prev = 0;
  for (let i = 1; i <= period; i++) prev += tr[i]!;
  prev /= period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

export interface IndicatorSet {
  sma5: Series;
  sma20: Series;
  sma60: Series;
  sma120: Series;
  rsi14: Series;
  macd: MacdResult;
  bb: BollingerResult;
  atr14: Series;
  volSma20: Series;
}

export function computeIndicators(candles: Candle[]): IndicatorSet {
  const closes = candles.map((c) => c.close);
  return {
    sma5: sma(closes, 5),
    sma20: sma(closes, 20),
    sma60: sma(closes, 60),
    sma120: sma(closes, 120),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    bb: bollinger(closes, 20, 2),
    atr14: atr(candles, 14),
    volSma20: sma(candles.map((c) => c.volume), 20),
  };
}
