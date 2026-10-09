import type { Candle, Fundamentals, StockInfo } from "@jusik/shared";
import type { UniverseRow } from "./provider";

/*
 * 야후 파이낸스(미국) 수집 — 공식 API가 아니라 웹사이트가 쓰는 비공식 엔드포인트를 읽는다.
 * 약관상 개인 용도·저빈도로만 쓰고, 구조가 바뀌면 깨질 수 있으니 `npm run check:sources -w server`로 확인하세요.
 */

export const YAHOO = {
  chart: (symbol: string, range: string) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`,
  screener: (id: "day_gainers" | "most_actives", count: number) => `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${id}&count=${count}`,
  search: (q: string) => `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
  summary: (symbol: string) => `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail,defaultKeyStatistics,financialData`,
  cookie: "https://fc.yahoo.com",
  crumb: "https://query1.finance.yahoo.com/v1/test/getcrumb",
};

/** 지수 심볼: 미국 시장 국면은 S&P 500 기준 */
export const YAHOO_INDEX = "^GSPC";

export interface ChartParsed {
  candles: Candle[];
  meta: { price?: number; previousClose?: number; name?: string; exchange?: string };
}

export function parseYahooChart(text: string): ChartParsed {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return { candles: [], meta: {} };
  }
  const r = json?.chart?.result?.[0];
  if (!r) return { candles: [], meta: {} };
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const offset: number = r.meta?.gmtoffset ?? 0;
  const candles: Candle[] = [];
  ts.forEach((t, i) => {
    const close = q.close?.[i];
    if (close == null || !(close > 0)) return; // 휴장일/결측은 null로 온다
    candles.push({
      date: new Date((t + offset) * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] ?? close, high: q.high?.[i] ?? close, low: q.low?.[i] ?? close, close, volume: q.volume?.[i] ?? 0,
    });
  });
  return {
    candles,
    meta: { price: r.meta?.regularMarketPrice, previousClose: r.meta?.chartPreviousClose ?? r.meta?.previousClose, name: r.meta?.shortName ?? r.meta?.longName, exchange: r.meta?.fullExchangeName ?? r.meta?.exchangeName },
  };
}

export function parseYahooScreener(text: string): UniverseRow[] {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const quotes: any[] = json?.finance?.result?.[0]?.quotes ?? [];
  const out: UniverseRow[] = [];
  for (const q of quotes) {
    const price = Number(q.regularMarketPrice), volume = Number(q.regularMarketVolume);
    if (!q.symbol || !(price > 0) || !Number.isFinite(volume)) continue;
    if (q.quoteType && q.quoteType !== "EQUITY") continue;
    out.push({ code: String(q.symbol), name: String(q.shortName ?? q.longName ?? q.symbol), market: "US", price, changePct: Number(q.regularMarketChangePercent ?? 0), volume, tradeValue: price * volume });
  }
  return out;
}

export function parseYahooSearch(text: string): StockInfo[] {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  return ((json?.quotes ?? []) as any[])
    .filter((q) => q.quoteType === "EQUITY" && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(q.symbol ?? "") && /NASDAQ|NYSE|NMS|NYQ|NGM|NCM|ASE|AMEX/i.test(`${q.exchDisp ?? ""} ${q.exchange ?? ""}`))
    .map((q) => ({ code: q.symbol as string, name: String(q.shortname ?? q.longname ?? q.symbol), market: "US" as const }));
}

export function parseYahooFundamentals(text: string): Fundamentals {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  const r = json?.quoteSummary?.result?.[0];
  if (!r) return {};
  const raw = (x: any): number | undefined => (typeof x === "number" ? x : typeof x?.raw === "number" ? x.raw : undefined);
  const pct = (x: any) => {
    const v = raw(x);
    return v == null ? undefined : v * 100;
  };
  const f: Fundamentals = {
    per: raw(r.summaryDetail?.trailingPE), pbr: raw(r.defaultKeyStatistics?.priceToBook), eps: raw(r.defaultKeyStatistics?.trailingEps),
    bps: raw(r.defaultKeyStatistics?.bookValue), roe: pct(r.financialData?.returnOnEquity), revenueGrowth: pct(r.financialData?.revenueGrowth),
    opIncomeGrowth: pct(r.financialData?.earningsGrowth), debtRatio: raw(r.financialData?.debtToEquity),
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Fundamentals;
}
