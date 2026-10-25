import {
  analyze, regionOf,
  type AlertItem, type Analysis, type BreadthResponse, type Candle, type DailyReview, type MinuteResponse, type Evaluation, type Fundamentals, type JournalCheck, type JournalEntry, type MacroResponse, type Market, type Posture,
  type Quote, type Region, type ReplayRun, type ServerState, type Settings, type StockExtras, type StockInfo,
} from "@jusik/shared";
import { errorText } from "./ui/format";

/** 배포(APK 등)에서는 VITE_API_BASE 로 서버 주소를 지정한다. 개발 중에는 vite 프록시를 쓴다. */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (e) {
    // 브라우저의 영어 메시지('Failed to fetch')가 화면 문장에 섞이지 않게 무엇이 일어났고 어떻게 고치는지로 바꾼다
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error(errorText(e));
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `요청 실패 (${res.status})`);
  return body as T;
}

export interface Health {
  provider: string;
  sample: boolean;
}

export const fetchHealth = () => getJson<Health>("/api/health");
export const searchStocks = (q: string) => getJson<{ results: StockInfo[] }>(`/api/search?q=${encodeURIComponent(q)}`).then((r) => rememberNames(r.results));

// ---- 종목 이름(코드 → 이름) ----
// 검색·개요·분석을 받을 때마다 채워 두고, 명령 검색의 관심종목·창 제목처럼 코드만 아는 곳에서 이름을 보여 준다.
const NAME_MAX = 500;
const names = new Map<string, string>();
/** 받은 종목 이름을 기억한다(오래된 것부터 지워 NAME_MAX개까지만) */
export function rememberNames<T extends { code: string; name?: string | null }>(list: T[]): T[] {
  for (const s of list) {
    if (!s.name || s.name === s.code) continue;
    names.delete(s.code);
    names.set(s.code, s.name);
  }
  while (names.size > NAME_MAX) names.delete(names.keys().next().value!);
  return list;
}
/** 이미 아는 종목 이름(없으면 undefined) */
export const knownName = (code: string): string | undefined => names.get(code);
/** 코드들의 이름. 모르는 코드는 검색으로 찾아 본다(찾지 못하면 빠진다) */
export async function stockNames(codes: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    codes.map(async (c) => {
      const hit = names.get(c) ?? (await searchStocks(c).then((r) => r.find((s) => s.code === c)?.name).catch(() => undefined));
      if (hit && hit !== c) out[c] = hit;
    }),
  );
  return out;
}

export const CANDLE_COUNT = 750;

export interface StockData {
  info: StockInfo;
  quote: Quote;
  fundamentals: Fundamentals;
  candles: Candle[];
  /** 종목이 속한 시장 지수 일봉(없으면 null) */
  indexCandles: Candle[] | null;
  analysis: Analysis | null;
  /** 시장 폭(국면 점수에 반영됐는지 화면에서 알려 주려고 같이 둔다) */
  breadth: BreadthResponse | null;
}

const TTL = 60_000;
/** 종목 분석 캐시에 남겨 둘 최대 종목 수(오래 쓰면 메모리가 계속 늘지 않게) */
const STOCK_CACHE_MAX = 30;
const cache = new Map<string, { at: number; p: Promise<StockData> }>();

/** 만료된 항목을 지우고, 넘치면 가장 오래 쓰지 않은 것부터 지운다(Map은 넣은 순서를 지킨다) */
function prune<K, V extends { at: number }>(m: Map<K, V>, ttl: number, max: number) {
  const now = Date.now();
  for (const [k, v] of m) if (now - v.at >= ttl) m.delete(k);
  while (m.size > max) m.delete(m.keys().next().value!);
}
const indexCache = new Map<Market, { at: number; p: Promise<Candle[] | null> }>();

function loadIndex(market: Market): Promise<Candle[] | null> {
  const hit = indexCache.get(market);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  // 지수를 못 받아도 종목 분석은 계속한다(시장 국면·상대강도만 빠진다)
  const p = getJson<{ candles: Candle[] }>(`/api/index/${market}/candles?count=${CANDLE_COUNT}`)
    .then((r) => r.candles)
    .catch(() => null);
  const entry = { at: Date.now(), p };
  indexCache.set(market, entry);
  // 실패(null)는 기억하지 않는다 — 다음 요청에서 다시 받는다
  void p.then((r) => r == null && indexCache.get(market) === entry && indexCache.delete(market));
  return p;
}

let macroCache: { at: number; p: Promise<MacroResponse | null> } | null = null;
/** 매크로 스냅숏(서버가 6시간 캐시). 못 받으면 null — 국면 점수에서 매크로만 빠진다 */
export function getMacro(): Promise<MacroResponse | null> {
  if (macroCache && Date.now() - macroCache.at < 10 * TTL) return macroCache.p;
  const p = getJson<MacroResponse>("/api/macro").catch(() => null);
  const entry = { at: Date.now(), p };
  macroCache = entry;
  // 한 번 실패한 결과를 10분 동안 붙잡지 않는다(연결이 돌아오면 다음 요청에서 다시 받는다)
  void p.then((r) => {
    if (r == null && macroCache === entry) macroCache = null;
  });
  return p;
}

let capsCache: { at: number; p: Promise<Record<Posture, number> | undefined> } | null = null;
/** 설정의 국면별 투자 상한(분석 카드의 상한 표시를 설정과 맞춘다) */
function loadCaps(): Promise<Record<Posture, number> | undefined> {
  if (capsCache && Date.now() - capsCache.at < TTL) return capsCache.p;
  const p = getJson<ServerState>("/api/state").then((s) => s.settings.postureCaps).catch(() => undefined);
  const entry = { at: Date.now(), p };
  capsCache = entry;
  void p.then((r) => {
    if (r == null && capsCache === entry) capsCache = null;
  });
  return p;
}

const breadthCache = new Map<Market, { at: number; p: Promise<BreadthResponse | null> }>();
/** 시장 폭(A/D선·MI). 서버가 아직 계산 중이면 pending=true — 잠시 뒤 다시 부르면 채워진다 */
export function getBreadth(market: Market, fresh = false): Promise<BreadthResponse | null> {
  const hit = breadthCache.get(market);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.p;
  const p = getJson<BreadthResponse>(`/api/breadth/${market}`).catch(() => null);
  breadthCache.set(market, { at: Date.now(), p });
  // 계산 중 응답과 실패(null)는 오래 두지 않는다
  void p.then((r) => (!r || r.pending) && breadthCache.get(market)?.p === p && breadthCache.delete(market));
  return p;
}

/** 분봉(1분봉)과 분봉 규칙 판단 */
export const getMinute = (code: string) => getJson<MinuteResponse>(`/api/stocks/${code}/minute`);

export function loadStock(code: string): Promise<StockData> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL) {
    // 최근에 쓴 것으로 옮긴다
    cache.delete(code);
    cache.set(code, hit);
    return hit.p;
  }
  const p = Promise.all([
    getJson<{ info: StockInfo; quote: Quote; fundamentals: Fundamentals }>(`/api/stocks/${code}/overview`),
    getJson<{ candles: Candle[] }>(`/api/stocks/${code}/candles?count=${CANDLE_COUNT}`),
  ]).then(async ([o, c]) => {
    rememberNames([o.info]);
    const [indexCandles, macro, postureCaps, breadth] = await Promise.all([loadIndex(o.info.market), getMacro(), loadCaps(), getBreadth(o.info.market)]);
    return {
      ...o,
      candles: c.candles,
      indexCandles,
      analysis: analyze({
        candles: c.candles, fundamentals: o.fundamentals, indexCandles: indexCandles ?? undefined,
        macro: macro?.snapshot ?? null, region: regionOf(o.info.market), postureCaps, breadth: breadth?.analysis ?? null,
      }),
      breadth,
    };
  });
  cache.delete(code);
  cache.set(code, { at: Date.now(), p });
  prune(cache, TTL, STOCK_CACHE_MAX);
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
/** 일지 입력. plannedAdd: 손실 중 추가 매수를 사전에 계획한 분할 매수라고 확인했을 때 */
export type JournalInput = Pick<JournalEntry, "code" | "side" | "price" | "qty" | "date"> & Partial<JournalEntry> & { plannedAdd?: boolean };
export const addJournal = (e: JournalInput) => getJson<{ entry: JournalEntry; check: JournalCheck }>("/api/journal", send("POST", e));
/** 저장하지 않고 주문 전 점검(체크리스트·손실 중 추가 매수)만 본다 */
export const checkJournal = (e: JournalInput) => getJson<{ check: JournalCheck }>("/api/journal/check", send("POST", e)).then((r) => r.check);
export const patchJournal = (id: string, patch: Partial<Pick<JournalEntry, "review" | "emotion" | "exitReason" | "strategy">> & { selfCheck?: JournalEntry["selfCheck"] | null }) =>
  getJson<{ entry: JournalEntry }>(`/api/journal/${id}`, send("PATCH", patch));

// ---- 알림 ----
export const getAlerts = () => getJson<{ alerts: AlertItem[] }>("/api/alerts").then((r) => r.alerts);

// ---- 지수(상단 바) ----
export interface IndexQuote {
  market: Market;
  close: number;
  change: number;
  changePct: number;
  date: string;
}
/** 시장 지수의 마지막 종가와 전일 대비(일봉 마지막 두 개) */
export function getIndexQuote(market: Market): Promise<IndexQuote | null> {
  return getJson<{ candles: Candle[] }>(`/api/index/${market}/candles?count=5`)
    .then(({ candles }) => {
      const a = candles.at(-1), b = candles.at(-2);
      if (!a || !b) return null;
      return { market, close: a.close, change: a.close - b.close, changePct: (a.close / b.close - 1) * 100, date: a.date };
    })
    .catch(() => null);
}
/** 일봉(작은 추세선·차트용) */
export const getCandles = (code: string, count: number) => getJson<{ candles: Candle[] }>(`/api/stocks/${code}/candles?count=${count}`).then((r) => r.candles);
/** 종목 개요(이름·현재가·재무) */
export const getOverview = (code: string) =>
  getJson<{ info: StockInfo; quote: Quote; fundamentals: Fundamentals }>(`/api/stocks/${code}/overview`).then((r) => (rememberNames([r.info]), r));
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
