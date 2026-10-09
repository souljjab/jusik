import * as cheerio from "cheerio";
import type { Candle, Fundamentals, Market, Quote } from "@jusik/shared";
import type { UniverseRow } from "./provider";

/*
 * 네이버 금융(국내) 수집 — 공식 API가 아니라 웹페이지/비공식 엔드포인트를 읽는다.
 * 사이트 구조가 바뀌면 깨질 수 있으니 `npm run check:sources -w server`로 주기적으로 확인하세요.
 */

export const NAVER = {
  chart: (code: string, count: number) => `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=${count}&requestType=0`,
  ranking: (kind: "quant" | "rise", market: Market) => `https://finance.naver.com/sise/sise_${kind}.naver?sosok=${market === "KOSDAQ" ? 1 : 0}`,
  realtime: (codes: string[]) => `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${codes.join(",")}`,
  main: (code: string) => `https://finance.naver.com/item/main.naver?code=${code}`,
};

const toNum = (s: string | undefined | null): number | undefined => {
  if (s == null) return undefined;
  const t = s.replace(/[,\s%원배]/g, "");
  if (t === "" || t === "-" || t === "N/A") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/** fchart XML: <item data="YYYYMMDD|시가|고가|저가|종가|거래량" /> */
export function parseFchart(xml: string): Candle[] {
  const out: Candle[] = [];
  for (const m of xml.matchAll(/<item\s+data="(\d{8})\|([\d.]+)\|([\d.]+)\|([\d.]+)\|([\d.]+)\|(\d+)"/g)) {
    const [, d, o, h, l, c, v] = m;
    const close = Number(c);
    if (!(close > 0)) continue;
    out.push({ date: `${d!.slice(0, 4)}-${d!.slice(4, 6)}-${d!.slice(6, 8)}`, open: Number(o) || close, high: Number(h) || close, low: Number(l) || close, close, volume: Number(v) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 거래량 상위 / 상승률 상위 표. 헤더 이름으로 열을 찾으므로 열 순서가 바뀌어도 견딘다. */
export function parseRankingTable(html: string, market: Market): UniverseRow[] {
  const $ = cheerio.load(html);
  const table = $("table.type_2").first();
  const heads = table.find("tr").first().find("th").map((_, e) => $(e).text().replace(/\s+/g, "")).get();
  const col = (name: string) => heads.findIndex((h) => h.startsWith(name));
  const iPrice = col("현재가"), iPct = col("등락률"), iVol = col("거래량"), iVal = col("거래대금");
  if (iPrice < 0 || iPct < 0 || iVol < 0) return [];
  const rows: UniverseRow[] = [];
  table.find("tr").each((_, tr) => {
    const a = $(tr).find('a[href*="code="]').first();
    const code = /code=(\d{6})/.exec(a.attr("href") ?? "")?.[1];
    const tds = $(tr).find("td");
    if (!code || tds.length <= Math.max(iPrice, iPct, iVol)) return;
    const price = toNum($(tds[iPrice]).text());
    let pct = toNum($(tds[iPct]).text());
    const volume = toNum($(tds[iVol]).text());
    if (price == null || pct == null || volume == null) return;
    // 부호가 없는 값은 하락(파랑) 클래스로 방향을 판단
    const cell = $(tds[iPct]);
    if (pct > 0 && !/\+/.test(cell.text()) && (cell.find('[class*="nv"]').length > 0 || /nv0/.test(cell.attr("class") ?? ""))) pct = -pct;
    const value = iVal >= 0 ? toNum($(tds[iVal]).text()) : undefined; // 백만원 단위
    rows.push({ code, name: a.text().trim(), market, price, changePct: pct, volume, tradeValue: value != null ? value * 1_000_000 : price * volume });
  });
  return rows;
}

/** polling.finance.naver.com 실시간 JSON → { 종목코드: 현재가 } 와 상세 */
export interface RealtimeItem {
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
}

export function parseRealtime(text: string): RealtimeItem[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const areas = (json as { result?: { areas?: { datas?: Record<string, unknown>[] }[] } })?.result?.areas ?? [];
  const out: RealtimeItem[] = [];
  for (const area of areas)
    for (const d of area.datas ?? []) {
      const price = Number(d.nv);
      if (!(price > 0)) continue;
      out.push({ code: String(d.cd), name: String(d.nm ?? ""), price, change: Number(d.cv ?? 0), changePct: Number(d.cr ?? 0), volume: Number(d.aq ?? 0) });
    }
  return out;
}

export function realtimeToQuote(r: RealtimeItem): Quote {
  return { code: r.code, price: r.price, change: r.change, changePct: r.changePct, volume: r.volume };
}

/** 종목 메인 페이지 '기업실적분석' 표에서 가장 최근 확정(비추정) 연간 값을 읽는다. */
export function parseNaverFundamentals(html: string): Fundamentals {
  const $ = cheerio.load(html);
  const table = $("div.cop_analysis table").first();
  if (!table.length) return {};
  const headRows = table.find("thead tr");
  const annualCount = Number(headRows.first().find("th[colspan]").first().attr("colspan")) || 4;
  const periods = headRows.last().find("th").map((_, e) => $(e).text().trim()).get();
  const rows = new Map<string, (number | undefined)[]>();
  table.find("tbody tr").each((_, tr) => {
    const label = $(tr).find("th").first().text().replace(/\s+/g, "");
    // cheerio의 map()은 undefined를 버려서 '-' 칸이 있으면 열이 밀린다 → toArray()로 위치를 유지한다
    if (label) rows.set(label, $(tr).find("td").toArray().map((td) => toNum($(td).text())));
  });
  const confirmed = periods.slice(0, annualCount).map((p, i) => ({ i, ok: !/\(E\)/.test(p) })).filter((x) => x.ok).map((x) => x.i);
  const row = (prefix: string) => [...rows.entries()].find(([k]) => k.startsWith(prefix))?.[1];
  const latest = (prefix: string): number | undefined => {
    const r = row(prefix);
    if (!r) return undefined;
    for (let k = confirmed.length - 1; k >= 0; k--) {
      const v = r[confirmed[k]!];
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const growth = (prefix: string): number | undefined => {
    const r = row(prefix);
    if (!r) return undefined;
    const vals = confirmed.map((i) => r[i]).filter((v): v is number => v !== undefined);
    if (vals.length < 2) return undefined;
    const prev = vals[vals.length - 2]!, cur = vals[vals.length - 1]!;
    return prev > 0 ? ((cur - prev) / prev) * 100 : undefined;
  };
  const f: Fundamentals = {
    per: latest("PER"), pbr: latest("PBR"), eps: latest("EPS"), bps: latest("BPS"), roe: latest("ROE"),
    debtRatio: latest("부채비율"), reserveRatio: latest("유보율"), revenueGrowth: growth("매출액"), opIncomeGrowth: growth("영업이익"),
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Fundamentals;
}
