import { isValidCode } from "@jusik/shared";

const KEY = "jusik.watchlist.v1";

export function loadWatchlist(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && isValidCode(x)) : [];
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
