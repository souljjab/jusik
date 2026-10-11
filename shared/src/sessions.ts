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

// ───────────────────────── 화면용 시장 상태(UI 지도서 9.1) ─────────────────────────

export type SessionState = "pre" | "open" | "closed" | "after" | "holiday";

export const SESSION_LABEL: Record<SessionState, string> = { pre: "장 시작 전", open: "장중", closed: "장 마감", after: "시간외", holiday: "휴장" };

export interface MarketSession {
  region: Region;
  state: SessionState;
  /** "장 시작 전" 등 */
  label: string;
  /** 보조 문구: "전일 종가 기준", "15:30 종가", "다음 거래일 10.12(월)", "애프터마켓" */
  sub: string;
  /** 그 시장 현지 날짜 */
  date: string;
  /** 휴장(주말)일 때 다음 거래일(공휴일은 반영하지 않음) */
  nextOpen: string | null;
}

/** 시간외 거래 구간(현지 시각 분). 한국: 장 마감 뒤 시간외 단일가 15:40~18:00, 미국: 프리마켓 04:00~09:30·애프터마켓 16:00~20:00 */
const EXTENDED: Record<Region, { pre: [number, number] | null; after: [number, number] }> = {
  KR: { pre: null, after: [15 * 60 + 40, 18 * 60] },
  US: { pre: [4 * 60, 9 * 60 + 30], after: [16 * 60, 20 * 60] },
};

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
/** "YYYY-MM-DD" → "10.12(월)" */
export function shortDateKo(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return ymd;
  return `${d.getUTCMonth() + 1}.${String(d.getUTCDate()).padStart(2, "0")}(${WEEKDAY_KO[d.getUTCDay()]})`;
}

function addDaysYmd(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 시장 상태(장 시작 전·장중·장 마감·시간외·휴장). 주말만 휴장으로 보고 공휴일은 반영하지 않는다(공휴일 달력이 없음).
 * 한국 장 마감 뒤 15:30~15:40은 '장 마감', 15:40~18:00은 '시간외'다.
 */
export function marketSession(region: Region, now: Date): MarketSession {
  const c = CFG[region];
  const k = marketClock(region, now);
  const x = EXTENDED[region];
  const closeText = `${String(Math.floor(c.close / 60)).padStart(2, "0")}:${String(c.close % 60).padStart(2, "0")} 종가`;
  const base = { region, date: k.date, nextOpen: null as string | null };
  if (k.weekday === 0 || k.weekday === 6) {
    const next = addDaysYmd(k.date, k.weekday === 6 ? 2 : 1);
    return { ...base, state: "holiday", label: SESSION_LABEL.holiday, sub: `다음 거래일 ${shortDateKo(next)}`, nextOpen: next };
  }
  const m = k.minutes;
  if (m >= c.open && m < c.close) return { ...base, state: "open", label: SESSION_LABEL.open, sub: "" };
  if (x.pre && m >= x.pre[0] && m < x.pre[1]) return { ...base, state: "after", label: SESSION_LABEL.after, sub: "프리마켓" };
  if (m >= x.after[0] && m < x.after[1]) return { ...base, state: "after", label: SESSION_LABEL.after, sub: region === "US" ? "애프터마켓" : "시간외 단일가" };
  if (m < c.open) return { ...base, state: "pre", label: SESSION_LABEL.pre, sub: "전일 종가 기준" };
  return { ...base, state: "closed", label: SESSION_LABEL.closed, sub: closeText };
}
