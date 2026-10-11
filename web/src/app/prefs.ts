import { useSyncExternalStore } from "react";

/*
 * 이 기기에서만 쓰는 화면 설정(브라우저 저장소). 서버 설정(예수금·한도·스캔 조건)과 달리 기기마다 다를 수 있다.
 * 저장소를 쓸 수 없으면(사생활 보호 창 등) 이번 실행 동안만 기억한다.
 */
export interface Prefs {
  /** 테마: 기기 설정을 따름(기본)·라이트·다크 */
  theme: "system" | "light" | "dark";
  /** 색 관례: 한국식(상승 빨강·하락 파랑, 기본)·미국식(상승 초록·하락 빨강) */
  convention: "KR" | "US";
  /** 방해 금지(알림 센터): 이 시간에는 브라우저 알림을 띄우지 않는다. allowRisk면 리스크 알림만 예외 */
  dnd: { enabled: boolean; start: string; end: string; allowRisk: boolean };
  /** 새 알림을 브라우저 알림으로도 띄울지(브라우저 권한이 필요) */
  notify: boolean;
  /** 사이드바 접기(컴퓨터) */
  sidebarCollapsed: boolean;
  /** 첫 실행 안내(투자 성향·고지)를 마쳤는지 */
  onboarded: boolean;
  /** 투자 성향(첫 실행 안내에서 고름). 기본 화면 강조에만 쓴다 */
  style: "daytrade" | "swing" | "long" | null;
  /** 알림 센터를 마지막으로 본 시각(ISO). 그 뒤 알림이 '새 알림' */
  alertsSeenAt: string | null;
  /** 크기를 조절한 패널 폭(px). 다음 실행에도 유지 */
  panes: Record<string, number>;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  convention: "KR",
  dnd: { enabled: true, start: "22:00", end: "07:00", allowRisk: false },
  notify: false,
  sidebarCollapsed: false,
  onboarded: false,
  style: null,
  alertsSeenAt: null,
  panes: {},
};

const KEY = "jusik.prefs.v1";

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
    if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
    return {
      ...DEFAULT_PREFS,
      ...raw,
      dnd: { ...DEFAULT_PREFS.dnd, ...(raw.dnd ?? {}) },
      panes: raw.panes && typeof raw.panes === "object" ? raw.panes : {},
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

let state: Prefs = typeof window === "undefined" ? DEFAULT_PREFS : load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return state;
}

export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 저장 공간이 막혀 있으면 이번 실행에서만 유지 */
  }
  applyPrefs(state);
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => state,
    () => state,
  );
}

/** <html>에 테마·색 관례를 반영하고 브라우저 테마 색(theme-color)을 맞춘다 */
export function applyPrefs(p: Prefs = state) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (p.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", p.theme);
  if (p.convention === "US") root.setAttribute("data-convention", "US");
  else root.removeAttribute("data-convention");
  const dark = p.theme === "dark" || (p.theme === "system" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0E1A2B" : "#F3F5F8");
}

/** 지금(한국 시간)이 방해 금지 시간인가. start > end면 자정을 넘는 구간(22:00~07:00) */
export function inDnd(p: Prefs["dnd"], now: Date = new Date()): boolean {
  if (!p.enabled) return false;
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const cur = Number(parts.find((x) => x.type === "hour")?.value) * 60 + Number(parts.find((x) => x.type === "minute")?.value);
  const a = toMin(p.start), b = toMin(p.end);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}
