import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "./app/prefs";

/**
 * 차트 색. 디자인 토큰(styles/tokens.css)에서 읽어 테마(라이트·다크)와 색 관례(한국식·미국식)를 따른다.
 * up·down은 상승·하락에만, accent는 강조(선택·신호 표식)에만 쓴다. 이동평균선은 상태 색과 겹치지 않는 차트 전용 색.
 */
export interface ChartColors {
  text: string;
  grid: string;
  up: string;
  down: string;
  ma5: string;
  ma20: string;
  ma60: string;
  accent: string;
  muted: string;
  /** 경고(손절선 등) */
  warn: string;
  /** 차트 바탕 */
  bg: string;
  /**
   * 차트 전용 계열 색(이동평균선·보조 지표·비교선 등). 상태 색(상승·하락·경고)·강조색과 겹치지 않는 중립 계열.
   * 강조색(accent)은 고른 신호 표식에만 쓴다
   */
  line1: string;
  line2: string;
  line3: string;
}

const FALLBACK: ChartColors = {
  text: "#556274", grid: "#D9DFE7", up: "#E0383E", down: "#2B6DE8", ma5: "#9A7B00", ma20: "#3F6B7A", ma60: "#1F8A9E", accent: "#5B47D6", muted: "#556274", warn: "#C26A00", bg: "#FFFFFF",
  line1: "#3F6B7A", line2: "#9A7B00", line3: "#7A6A58",
};

function read(dark: boolean): ChartColors {
  if (typeof document === "undefined") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    text: v("--color-text-2", FALLBACK.text),
    grid: v("--color-border", FALLBACK.grid),
    up: v("--color-up", FALLBACK.up),
    down: v("--color-down", FALLBACK.down),
    // 이동평균선: 상태 색(상승·하락·경고)과 겹치지 않게 고른 차트 전용 색
    ma5: dark ? "#D9B84A" : "#9A7B00",
    // 20일선은 강조색 대신 차트 계열 색(강조색은 선택·근거에만)
    ma20: dark ? "#8FB3C0" : "#3F6B7A",
    ma60: dark ? "#4CC3D6" : "#1F8A9E",
    accent: v("--color-accent", FALLBACK.accent),
    muted: v("--color-text-2", FALLBACK.muted),
    warn: v("--color-warn", FALLBACK.warn),
    bg: v("--color-surface", FALLBACK.bg),
    line1: dark ? "#8FB3C0" : "#3F6B7A",
    line2: dark ? "#D9B84A" : "#9A7B00",
    line3: dark ? "#C2B29E" : "#7A6A58",
  };
}

const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

export function useChartColors(): ChartColors {
  const prefs = usePrefs();
  const [sys, setSys] = useState(systemDark);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const q = matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setSys(e.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  const dark = prefs.theme === "dark" || (prefs.theme === "system" && sys);
  // 속성이 바뀐 뒤 계산하도록 테마·관례를 의존성으로 둔다
  return useMemo(() => read(dark), [dark, prefs.convention]);
}

/**
 * 차트 날짜 눈금 언어. 정하지 않으면 lightweight-charts가 브라우저 언어(navigator.language)를 쓰는데,
 * "en-US@posix"처럼 Intl이 받지 않는 값이면 눈금을 그리다 예외가 나 차트가 비어 버린다
 */
export const CHART_LOCALE = "ko-KR";

/** 차트 공통 글꼴(본문 글꼴과 같게) */
export const CHART_FONT = '"IBM Plex Sans KR", "Pretendard", system-ui, sans-serif';
