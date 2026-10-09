import { recommend, type Candle, type Fundamentals, type Quote, type Recommendation, type StockInfo } from "@jusik/shared";

/** 배포(APK 등)에서는 VITE_API_BASE 로 서버 주소를 지정한다. 개발 중에는 vite 프록시를 쓴다. */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `요청 실패 (${res.status})`);
  return body as T;
}

export interface Health {
  provider: string;
  sample: boolean;
}

export const fetchHealth = () => getJson<Health>("/api/health");
export const searchStocks = (q: string) => getJson<{ results: StockInfo[] }>(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.results);

export const CANDLE_COUNT = 750;

export interface StockData {
  info: StockInfo;
  quote: Quote;
  fundamentals: Fundamentals;
  candles: Candle[];
  rec: Recommendation | null;
}

const cache = new Map<string, { at: number; p: Promise<StockData> }>();
const TTL = 60_000;

export function loadStock(code: string): Promise<StockData> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = Promise.all([
    getJson<{ info: StockInfo; quote: Quote; fundamentals: Fundamentals }>(`/api/stocks/${code}/overview`),
    getJson<{ candles: Candle[] }>(`/api/stocks/${code}/candles?count=${CANDLE_COUNT}`),
  ]).then(([o, c]) => ({ ...o, candles: c.candles, rec: recommend(c.candles, o.fundamentals) }));
  cache.set(code, { at: Date.now(), p });
  p.catch(() => cache.delete(code));
  return p;
}
