import { analyze, type Analysis, type Candle, type Fundamentals, type Market, type Quote, type StockInfo } from "@jusik/shared";

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
  /** 종목이 속한 시장 지수 일봉(없으면 null) */
  indexCandles: Candle[] | null;
  analysis: Analysis | null;
}

const TTL = 60_000;
const cache = new Map<string, { at: number; p: Promise<StockData> }>();
const indexCache = new Map<Market, { at: number; p: Promise<Candle[] | null> }>();

function loadIndex(market: Market): Promise<Candle[] | null> {
  const hit = indexCache.get(market);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  // 지수를 못 받아도 종목 분석은 계속한다(시장 국면·상대강도만 빠진다)
  const p = getJson<{ candles: Candle[] }>(`/api/index/${market}/candles?count=${CANDLE_COUNT}`)
    .then((r) => r.candles)
    .catch(() => null);
  indexCache.set(market, { at: Date.now(), p });
  return p;
}

export function loadStock(code: string): Promise<StockData> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = Promise.all([
    getJson<{ info: StockInfo; quote: Quote; fundamentals: Fundamentals }>(`/api/stocks/${code}/overview`),
    getJson<{ candles: Candle[] }>(`/api/stocks/${code}/candles?count=${CANDLE_COUNT}`),
  ]).then(async ([o, c]) => {
    const indexCandles = await loadIndex(o.info.market);
    return {
      ...o,
      candles: c.candles,
      indexCandles,
      analysis: analyze({ candles: c.candles, fundamentals: o.fundamentals, indexCandles: indexCandles ?? undefined }),
    };
  });
  cache.set(code, { at: Date.now(), p });
  p.catch(() => cache.delete(code));
  return p;
}
