const KEY = "jusik.watchlist.v1";

export function loadWatchlist(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^\d{6}$/.test(x)) : [];
  } catch {
    return [];
  }
}

export function saveWatchlist(codes: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(codes));
  } catch {
    /* 저장 공간이 없거나 막혀 있으면 이번 세션에서만 유지 */
  }
}

import type { JournalEntry } from "@jusik/shared";

const JOURNAL_KEY = "jusik.journal.v1";
const SETTINGS_KEY = "jusik.settings.v1";

export interface Settings {
  capital: number;
  /** 손절 시 잃어도 되는 자본 비율(%) */
  riskPct: number;
  /** 한 종목 최대 비중(%) */
  maxWeightPct: number;
}

export const DEFAULT_SETTINGS: Settings = { capital: 10_000_000, riskPct: 1, maxWeightPct: 25 };

function isEntry(x: unknown): x is JournalEntry {
  const e = x as JournalEntry;
  return !!e && typeof e.id === "string" && /^\d{6}$/.test(e.code) && (e.side === "BUY" || e.side === "SELL") && Number.isFinite(e.price) && Number.isFinite(e.qty) && typeof e.date === "string";
}

export function loadJournal(): JournalEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function saveJournal(entries: JournalEntry[]) {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries));
  } catch {
    /* 저장 실패 시 이번 세션에서만 유지 */
  }
}

export function loadSettings(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
    const ok = (n: unknown, min: number, max: number, d: number) => (typeof n === "number" && n >= min && n <= max ? n : d);
    return {
      capital: ok(v.capital, 100_000, 1e13, DEFAULT_SETTINGS.capital),
      riskPct: ok(v.riskPct, 0.1, 10, DEFAULT_SETTINGS.riskPct),
      maxWeightPct: ok(v.maxWeightPct, 1, 100, DEFAULT_SETTINGS.maxWeightPct),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 무시 */
  }
}
