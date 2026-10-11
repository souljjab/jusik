import { useEffect, useState } from "react";

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
}

const LIGHT: ChartColors = { text: "#334155", grid: "#e2e8f0", up: "#e5484d", down: "#2f6fed", ma5: "#f59e0b", ma20: "#16a34a", ma60: "#9333ea", accent: "#0f766e", muted: "#94a3b8" };
const DARK: ChartColors = { text: "#cbd5e1", grid: "#2a3548", up: "#ff6369", down: "#5b9bff", ma5: "#fbbf24", ma20: "#4ade80", ma60: "#c084fc", accent: "#2dd4bf", muted: "#64748b" };

const prefersDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

export function useChartColors(): ChartColors {
  const [dark, setDark] = useState(prefersDark);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const q = matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return dark ? DARK : LIGHT;
}

/**
 * 차트 날짜 눈금 언어. 정하지 않으면 lightweight-charts가 브라우저 언어(navigator.language)를 쓰는데,
 * "en-US@posix"처럼 Intl이 받지 않는 값이면 눈금을 그리다 예외가 나 차트가 비어 버린다
 */
export const CHART_LOCALE = "ko-KR";
