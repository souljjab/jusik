import type { Candle, Quote } from "@jusik/shared";

/*
 * 네이버 금융(국내) 일봉·현재가 — 공식 API가 아니라 비공식 엔드포인트를 읽는다.
 * 순위표·재무·수급·공시·업종·시장 폭은 naverApi.ts(모바일 JSON API)로 옮겼다(예전 PC 페이지는 새 사이트로 넘어갔다).
 * 사이트 구조가 바뀌면 깨질 수 있으니 `npm run check:sources -w server`로 주기적으로 확인하세요.
 */

export const NAVER = {
  chart: (code: string, count: number) => `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=${count}&requestType=0`,
  realtime: (codes: string[]) => `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${codes.join(",")}`,
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
