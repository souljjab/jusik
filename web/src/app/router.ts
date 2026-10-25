import { useSyncExternalStore, type AnchorHTMLAttributes, createElement } from "react";

/*
 * 해시 라우터: #/stocks/005930?tab=fin. 앱(Capacitor)·정적 배포에서도 서버 설정 없이 동작한다.
 * 경로 목록(UI 지도서 2장 다섯 영역 + 전역):
 *   /                      홈
 *   /discover[/screener|/strategy]       발굴(추천·스크리너·전략과 백테스트)
 *   /stocks[/:code[/:tab]]               종목(관심종목·종목 상세)
 *   /trade[/:tab]                        매매(보유·비중과 한도·오늘의 계획)
 *   /records[/:tab]                      기록(매매일지·복기·규칙 점검)
 *   /alerts                              알림 센터
 *   /settings[/:tab]                     설정
 */

export interface Route {
  /** "/stocks/005930" */
  path: string;
  /** ["stocks", "005930"] */
  segments: string[];
  query: URLSearchParams;
}

function read(): string {
  const h = typeof location === "undefined" ? "" : location.hash.replace(/^#/, "");
  return h.startsWith("/") ? h : `/${h}`;
}

/** 경로 조각 풀기. 잘못된 % 표기(손으로 친 링크 등)는 예외로 앱 전체를 비우지 않고 원래 글자를 그대로 쓴다 */
function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** "/stocks/005930?tab=fin" → Route */
export function parseRoute(raw: string): Route {
  const [p = "/", q = ""] = raw.split("?");
  const segments = p.split("/").filter(Boolean).map(decodeSegment);
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(q);
  } catch {
    query = new URLSearchParams();
  }
  return { path: `/${segments.map(encodeURIComponent).join("/")}`, segments, query };
}

let cache: { raw: string; route: Route } | null = null;
function snapshot(): Route {
  const raw = read();
  if (cache?.raw === raw) return cache.route;
  const route = parseRoute(raw);
  cache = { raw, route };
  return route;
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 화면 이동. replace면 기록을 남기지 않는다(탭 전환 등) */
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const target = to.startsWith("/") ? to : `/${to}`;
  if (read() === target) return;
  if (opts.replace) {
    const url = new URL(location.href);
    url.hash = target;
    history.replaceState(history.state, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else location.hash = target;
}

export const href = (to: string) => `#${to.startsWith("/") ? to : `/${to}`}`;

/** 링크(가운데 클릭·새 탭 열기도 그대로 된다) */
export function Link({ to, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return createElement("a", { href: href(to), ...rest });
}

/** 영역 이름(첫 경로 조각) */
export type Area = "home" | "discover" | "stocks" | "trade" | "records" | "alerts" | "settings";
export function areaOf(r: Route): Area {
  const s = r.segments[0];
  if (s === "discover" || s === "stocks" || s === "trade" || s === "records" || s === "alerts" || s === "settings") return s;
  return "home";
}
