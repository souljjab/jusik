import {
  analyze, regionOf,
  type Analysis, type Candle, type DailyReview, type Evaluation, type Fundamentals, type JournalCheck, type JournalEntry, type MacroResponse, type Market, type Posture,
  type Quote, type Region, type ReplayRun, type ServerState, type Settings, type StockExtras, type StockInfo,
} from "@jusik/shared";

/** 배포(APK 등)에서는 VITE_API_BASE 로 서버 주소를 지정한다. 개발 중에는 vite 프록시를 쓴다. */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
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

let macroCache: { at: number; p: Promise<MacroResponse | null> } | null = null;
/** 매크로 스냅숏(서버가 6시간 캐시). 못 받으면 null — 국면 점수에서 매크로만 빠진다 */
export function getMacro(): Promise<MacroResponse | null> {
  if (macroCache && Date.now() - macroCache.at < 10 * TTL) return macroCache.p;
  const p = getJson<MacroResponse>("/api/macro").catch(() => null);
  macroCache = { at: Date.now(), p };
  return p;
}

let capsCache: { at: number; p: Promise<Record<Posture, number> | undefined> } | null = null;
/** 설정의 국면별 투자 상한(분석 카드의 상한 표시를 설정과 맞춘다) */
function loadCaps(): Promise<Record<Posture, number> | undefined> {
  if (capsCache && Date.now() - capsCache.at < TTL) return capsCache.p;
  const p = getJson<ServerState>("/api/state").then((s) => s.settings.postureCaps).catch(() => undefined);
  capsCache = { at: Date.now(), p };
  return p;
}

export function loadStock(code: string): Promise<StockData> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = Promise.all([
    getJson<{ info: StockInfo; quote: Quote; fundamentals: Fundamentals }>(`/api/stocks/${code}/overview`),
    getJson<{ candles: Candle[] }>(`/api/stocks/${code}/candles?count=${CANDLE_COUNT}`),
  ]).then(async ([o, c]) => {
    const [indexCandles, macro, postureCaps] = await Promise.all([loadIndex(o.info.market), getMacro(), loadCaps()]);
    return {
      ...o,
      candles: c.candles,
      indexCandles,
      analysis: analyze({
        candles: c.candles, fundamentals: o.fundamentals, indexCandles: indexCandles ?? undefined,
        macro: macro?.snapshot ?? null, region: regionOf(o.info.market), postureCaps,
      }),
    };
  });
  cache.set(code, { at: Date.now(), p });
  p.catch(() => cache.delete(code));
  return p;
}

// ---- 서버(스캔·설정·모의계좌·일지·내보내기) ----
// 본문이 없을 때 content-type: application/json을 붙이면 서버(Fastify)가 빈 JSON 본문으로 거절한다
const send = (method: string, body?: unknown): RequestInit =>
  body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };

export const getState = () => getJson<ServerState>("/api/state");
export const saveSettings = (s: Partial<Settings>) => {
  capsCache = null;
  cache.clear(); // 상한이 바뀌면 분석 카드도 새로 계산한다
  return getJson<{ settings: Settings }>("/api/settings", send("PUT", s));
};
export const startScan = () => getJson<{ started: boolean; message: string }>("/api/scan", send("POST")).catch((e: Error) => ({ started: false, message: e.message }));
export const resetPaper = () => getJson<unknown>("/api/paper/reset", send("POST"));
export const syncExport = () => getJson<unknown>("/api/export/sync", send("POST"));
export const excelUrl = `${BASE}/api/export/excel`;
export const getJournal = () => getJson<{ entries: JournalEntry[] }>("/api/journal").then((r) => r.entries);
export const addJournal = (e: Pick<JournalEntry, "code" | "side" | "price" | "qty" | "date"> & Partial<JournalEntry>) =>
  getJson<{ entry: JournalEntry; check: JournalCheck }>("/api/journal", send("POST", e));
export const patchJournal = (id: string, patch: Partial<Pick<JournalEntry, "review" | "emotion" | "exitReason" | "strategy">>) =>
  getJson<{ entry: JournalEntry }>(`/api/journal/${id}`, send("PATCH", patch));
export const deleteJournal = (id: string) => getJson<unknown>(`/api/journal/${id}`, send("DELETE"));

// ---- 종목 보조 데이터(국내: 수급·공시·업종) ----
export const getExtras = (code: string) => getJson<StockExtras>(`/api/stocks/${code}/extras`);

// ---- 일일 복기 ----
export const getReviews = () => getJson<{ reviews: DailyReview[] }>("/api/reviews").then((r) => r.reviews);
export const buildReview = (region: Region) => getJson<{ review: DailyReview; errors: string[] }>("/api/reviews", send("POST", { region }));
export const saveReviewComment = (region: Region, date: string, comment: string) =>
  getJson<{ review: DailyReview }>(`/api/reviews/${region}/${date}`, send("PUT", { comment }));

// ---- 규칙 점검 ----
export const getPaperEval = () => getJson<{ evaluation: Evaluation; tradeCount: number }>("/api/evaluate/paper");
export const getReplay = () => getJson<{ run: ReplayRun | null; running: boolean }>("/api/evaluate/replay");
export const runReplay = (body: { markets: Market[]; count: number }) => getJson<{ run: ReplayRun }>("/api/evaluate/replay", send("POST", body));
