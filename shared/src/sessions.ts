import type { Region } from "./types";

export interface MarketClock {
  /** 그 시장 현지 날짜(YYYY-MM-DD) */
  date: string;
  /** 현지 시각의 자정 이후 분 */
  minutes: number;
  weekday: number; // 0=일 … 6=토
  /** 정규장 시간(공휴일은 반영하지 않음) */
  isOpen: boolean;
  /** 신규 진입을 허용하는 시간대(개장 직후 변동성·마감 직전 제외) */
  inEntryWindow: boolean;
  /** 마감 임박 시간대(보유기간 청산 판단에 사용) */
  nearClose: boolean;
  /** 장 마감 후 30분(마감 가격으로 마지막 점검을 하는 시간대) */
  justClosed: boolean;
}

const CFG: Record<Region, { tz: string; open: number; close: number; entryFrom: number; entryTo: number; nearClose: number }> = {
  KR: { tz: "Asia/Seoul", open: 9 * 60, close: 15 * 60 + 30, entryFrom: 9 * 60 + 10, entryTo: 14 * 60 + 30, nearClose: 15 * 60 },
  US: { tz: "America/New_York", open: 9 * 60 + 30, close: 16 * 60, entryFrom: 9 * 60 + 40, entryTo: 15 * 60, nearClose: 15 * 60 + 30 },
};

export function marketClock(region: Region, now: Date): MarketClock {
  const c = CFG[region];
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: c.tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.weekday));
  const weekdayOk = weekday >= 1 && weekday <= 5;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes,
    weekday,
    isOpen: weekdayOk && minutes >= c.open && minutes < c.close,
    inEntryWindow: weekdayOk && minutes >= c.entryFrom && minutes <= c.entryTo,
    nearClose: weekdayOk && minutes >= c.nearClose && minutes < c.close,
    justClosed: weekdayOk && minutes >= c.close && minutes < c.close + 30,
  };
}
