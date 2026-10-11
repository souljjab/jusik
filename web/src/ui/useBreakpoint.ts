import { useSyncExternalStore } from "react";

/**
 * 창 너비 구간(UI 지도서 4장, Material 3 창 크기 등급).
 * compact < 600 ≤ medium < 840 ≤ expanded < 1200 ≤ large
 */
export type Breakpoint = "compact" | "medium" | "expanded" | "large";

const QUERIES: [Breakpoint, string][] = [
  ["large", "(min-width: 1200px)"],
  ["expanded", "(min-width: 840px)"],
  ["medium", "(min-width: 600px)"],
];

function current(): Breakpoint {
  if (typeof matchMedia !== "function") return "large";
  for (const [bp, q] of QUERIES) if (matchMedia(q).matches) return bp;
  return "compact";
}

function subscribe(cb: () => void) {
  if (typeof matchMedia !== "function") return () => {};
  const lists = QUERIES.map(([, q]) => matchMedia(q));
  lists.forEach((l) => l.addEventListener("change", cb));
  return () => lists.forEach((l) => l.removeEventListener("change", cb));
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, current, () => "large");
}

/** 이 너비 이상인가(예: atLeast(bp, "expanded")) */
export function atLeast(bp: Breakpoint, min: Breakpoint): boolean {
  const order: Breakpoint[] = ["compact", "medium", "expanded", "large"];
  return order.indexOf(bp) >= order.indexOf(min);
}

/** 동작 줄이기 설정 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
