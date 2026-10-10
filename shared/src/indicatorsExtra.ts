import { sma, type Series } from "./indicators";
import type { Candle } from "./types";

/** 결측(null)이 섞인 시계열의 단순이동평균. 직전 period개가 모두 있을 때만 값을 낸다(i 이후는 보지 않음) */
export function smaSeries(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  let run = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      sum = 0;
      run = 0;
      continue;
    }
    sum += v;
    run++;
    if (run > period) sum -= values[i - period]!;
    if (run >= period) out[i] = sum / period;
  }
  return out;
}

export interface StochasticResult {
  /** %K(smooth > 1이면 slow %K) */
  k: Series;
  /** %D = %K의 d일 이동평균 */
  d: Series;
}

/**
 * 스토캐스틱(강동진 4.6). raw %K = (종가 - k일 최저가) / (k일 최고가 - k일 최저가) × 100,
 * %K = raw의 smooth일 평균(slow), %D = %K의 d일 평균. 고가=저가인 구간은 50으로 둔다.
 */
export function stochastic(candles: Candle[], k = 14, d = 3, smooth = 3): StochasticResult {
  const raw: Series = candles.map((c, i) => {
    if (i < k - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - k + 1; j <= i; j++) {
      hh = Math.max(hh, candles[j]!.high);
      ll = Math.min(ll, candles[j]!.low);
    }
    return hh > ll ? ((c.close - ll) / (hh - ll)) * 100 : 50;
  });
  const kLine = smooth > 1 ? smaSeries(raw, smooth) : raw;
  return { k: kLine, d: smaSeries(kLine, d) };
}

/** 이격도 = 값 ÷ period일 단순이동평균 × 100 */
export function disparity(values: number[], period: number): Series {
  const m = sma(values, period);
  return values.map((v, i) => {
    const x = m[i];
    return x != null && x > 0 ? (v / x) * 100 : null;
  });
}

/** values[from..to] 평균(양 끝 포함). 범위가 비거나 음수 인덱스면 null */
export function meanOf(values: number[], from: number, to: number): number | null {
  if (from < 0 || to >= values.length || from > to) return null;
  let s = 0;
  for (let j = from; j <= to; j++) s += values[j]!;
  return s / (to - from + 1);
}

/** values[from..to]에서 최댓값의 인덱스(같으면 뒤쪽). 범위가 잘못되면 -1 */
export function argMax(values: number[], from: number, to: number): number {
  let best = -1;
  for (let j = Math.max(0, from); j <= Math.min(to, values.length - 1); j++) if (best < 0 || values[j]! >= values[best]!) best = j;
  return best;
}

/** values[from..to]에서 최솟값의 인덱스(같으면 뒤쪽). 범위가 잘못되면 -1 */
export function argMin(values: number[], from: number, to: number): number {
  let best = -1;
  for (let j = Math.max(0, from); j <= Math.min(to, values.length - 1); j++) if (best < 0 || values[j]! <= values[best]!) best = j;
  return best;
}

/**
 * to 시점까지 확정된 스윙 저점의 인덱스(오름차순). 좌우 window봉보다 낮은 봉을 저점으로 본다
 * (왼쪽은 엄격히 낮고, 오른쪽은 같거나 낮음 — 같은 값이 이어질 때 한 번만 잡기 위해).
 * 오른쪽 window봉이 있어야 확정되므로 j ≤ to - window만 후보다. to 이후 데이터는 쓰지 않는다.
 */
export function swingLows(values: number[], window: number, from: number, to: number): number[] {
  return swings(values, window, from, to, (a, b) => a < b, (a, b) => a <= b);
}

/** to 시점까지 확정된 스윙 고점의 인덱스(오름차순). swingLows의 반대 */
export function swingHighs(values: number[], window: number, from: number, to: number): number[] {
  return swings(values, window, from, to, (a, b) => a > b, (a, b) => a >= b);
}

function swings(
  values: number[],
  w: number,
  from: number,
  to: number,
  leftOk: (x: number, other: number) => boolean,
  rightOk: (x: number, other: number) => boolean,
): number[] {
  const out: number[] = [];
  const last = Math.min(to, values.length - 1);
  for (let j = Math.max(from, w); j <= last - w; j++) {
    const x = values[j]!;
    let ok = true;
    for (let m = j - w; m < j && ok; m++) ok = leftOk(x, values[m]!);
    for (let m = j + 1; m <= j + w && ok; m++) ok = rightOk(x, values[m]!);
    if (ok) out.push(j);
  }
  return out;
}
