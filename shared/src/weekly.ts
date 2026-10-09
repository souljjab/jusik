import type { Candle } from "./types";

export interface WeeklyBar {
  /** 그 주 월요일(YYYY-MM-DD). 종목과 지수의 주봉을 맞출 때 쓴다 */
  weekKey: string;
  /** 그 주의 마지막 거래일 */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 일봉 배열에서 이 주의 첫/마지막 인덱스 */
  startIndex: number;
  endIndex: number;
}

export function weekKeyOf(date: string): string {
  const t = Date.parse(date);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 월=0
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

export function toWeekly(candles: Candle[]): WeeklyBar[] {
  const out: WeeklyBar[] = [];
  candles.forEach((c, i) => {
    const key = weekKeyOf(c.date);
    const last = out[out.length - 1];
    if (last && last.weekKey === key) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
      last.date = c.date;
      last.endIndex = i;
    } else {
      out.push({ weekKey: key, date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, startIndex: i, endIndex: i });
    }
  });
  return out;
}

/**
 * 아직 끝나지 않은 마지막 주를 제외한다.
 * 마지막 일봉이 금요일 이전이면 그 주는 진행 중으로 본다(주봉 신호는 주 마감 기준).
 */
export function completedWeeks(weekly: WeeklyBar[]): WeeklyBar[] {
  const last = weekly[weekly.length - 1];
  if (!last) return weekly;
  const dow = (new Date(Date.parse(last.date)).getUTCDay() + 6) % 7;
  return dow < 4 ? weekly.slice(0, -1) : weekly;
}
