import { isValidCode, STRATEGIES, type StockInfo } from "@jusik/shared";
import { navigate } from "../app/router";
import { MARKET_LABEL } from "../ui/format";
import { SCREENS } from "./nav";

/** 명령 검색 항목 */
export interface PaletteItem {
  key: string;
  group: "종목" | "전략" | "화면";
  label: string;
  sub?: string;
  go: () => void;
}

/** 관심종목을 명령 검색에 몇 개까지 보여 줄지 */
export const WATCH_MAX = 5;

/**
 * 명령 검색 항목 만들기(순수 함수, 시험용으로 따로 둔다).
 * - 검색 결과는 지금 입력과 같은 검색어로 받은 것만 쓴다(빠르게 고쳐 친 뒤 Enter가 이전 결과를 열지 않게).
 * - 입력이 올바른 종목코드면 '코드로 열기'를 맨 앞에 둔다.
 * - 입력이 비어 있으면 관심종목을 '이름 · 코드'로 보여 준다(이름을 모르면 코드만).
 */
export function paletteItems({ q, results, watchlist, names, openStock }: {
  q: string;
  results: { q: string; list: StockInfo[] } | null;
  watchlist: string[];
  names: Record<string, string>;
  openStock: (code: string) => void;
}): PaletteItem[] {
  const query = q.trim();
  const t = query.toLowerCase();
  const match = (s: string) => !t || s.toLowerCase().includes(t);
  const out: PaletteItem[] = [];
  const stocks = results && results.q === query ? results.list : [];
  const up = query.toUpperCase();
  if (up && isValidCode(up) && !stocks.some((s) => s.code === up)) {
    const nm = names[up];
    out.push({ key: `s:${up}`, group: "종목", label: nm ?? up, sub: nm ? `${up} · 코드로 열기` : "코드로 열기", go: () => openStock(up) });
  }
  for (const s of stocks) out.push({ key: `s:${s.code}`, group: "종목", label: s.name, sub: `${s.code} · ${MARKET_LABEL[s.market] ?? s.market}`, go: () => openStock(s.code) });
  if (!t)
    for (const c of watchlist.slice(0, WATCH_MAX)) {
      const nm = names[c];
      out.push({ key: `w:${c}`, group: "종목", label: nm ?? c, sub: nm ? `${c} · 관심종목` : "관심종목", go: () => openStock(c) });
    }
  for (const s of STRATEGIES) if (match(`${s.name} ${s.source} ${s.description}`)) out.push({ key: `t:${s.id}`, group: "전략", label: s.name, sub: s.source, go: () => navigate(`/discover/strategy?id=${s.id}`) });
  for (const s of SCREENS) if (match(`${s.label} ${s.keywords}`)) out.push({ key: `p:${s.path}`, group: "화면", label: s.label, go: () => navigate(s.path) });
  return out;
}
