import type { Candle, Fundamentals, StockInfo } from "@jusik/shared";
import type { UsHolders } from "@jusik/shared";
import type { UniverseRow } from "./provider";

/*
 * 야후 파이낸스(미국) 수집 — 공식 API가 아니라 웹사이트가 쓰는 비공식 엔드포인트를 읽는다.
 * 약관상 개인 용도·저빈도로만 쓰고, 구조가 바뀌면 깨질 수 있으니 `npm run check:sources -w server`로 확인하세요.
 */

export const YAHOO = {
  chart: (symbol: string, range: string) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`,
  screener: (id: "day_gainers" | "most_actives", count: number) => `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${id}&count=${count}`,
  search: (q: string) => `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
  summary: (symbol: string) => `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryDetail,defaultKeyStatistics,financialData`,
  /** 지분·수급: 주요 보유자 비율, 상위 기관, 6개월 내부자 순매수, 내부자 거래, 공매도 잔고 */
  holders: (symbol: string) =>
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=majorHoldersBreakdown,institutionOwnership,netSharePurchaseActivity,insiderTransactions,defaultKeyStatistics`,
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
  // 시가총액은 실적 금액(SEC, 백만 달러)과 같은 단위로 맞춘다. price·summaryDetail의 marketCap 위치는 실제 응답과 대조하지 못함(미검증)
  const cap = raw(r.price?.marketCap) ?? raw(r.summaryDetail?.marketCap);
  const shares = raw(r.defaultKeyStatistics?.sharesOutstanding) ?? raw(r.price?.sharesOutstanding);
  const f: Fundamentals = {
    per: raw(r.summaryDetail?.trailingPE), pbr: raw(r.defaultKeyStatistics?.priceToBook), eps: raw(r.defaultKeyStatistics?.trailingEps),
    bps: raw(r.defaultKeyStatistics?.bookValue), roe: pct(r.financialData?.returnOnEquity), revenueGrowth: pct(r.financialData?.revenueGrowth),
    opIncomeGrowth: pct(r.financialData?.earningsGrowth), debtRatio: raw(r.financialData?.debtToEquity),
    marketCap: cap != null && cap > 0 ? Math.round(cap / 1e4) / 100 : undefined,
    sharesOutstanding: shares != null && shares > 0 ? shares : undefined,
    amountUnit: "백만달러",
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Fundamentals;
}

/**
 * quoteSummary(majorHoldersBreakdown·institutionOwnership·netSharePurchaseActivity·insiderTransactions·defaultKeyStatistics)
 * → UsHolders. 숫자는 {raw, fmt}의 raw를 쓰고(맨 숫자도 허용), 비율(0~1)은 %로 바꾼다. 없는 모듈·필드는 건너뛴다.
 * 실제 응답과 대조하지 못함(미검증) — 모듈 구조는 야후 웹사이트가 쓰는 비공식 형식을 기억에 기대어 짰다.
 */
export function parseYahooHolders(text: string): UsHolders {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  const r = json?.quoteSummary?.result?.[0];
  if (!r || typeof r !== "object") return {};
  const raw = (x: any): number | undefined => {
    const v = typeof x === "number" ? x : typeof x?.raw === "number" ? x.raw : undefined;
    return v != null && Number.isFinite(v) ? v : undefined;
  };
  const pct = (x: any) => {
    const v = raw(x);
    return v == null ? undefined : Math.round(v * 10000) / 100;
  };
  const date = (x: any): string | undefined => {
    const v = raw(x);
    if (v != null && v > 0) return new Date(v * 1000).toISOString().slice(0, 10);
    const s = typeof x?.fmt === "string" ? x.fmt : typeof x === "string" ? x : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
  };
  const mh = r.majorHoldersBreakdown, ks = r.defaultKeyStatistics, ns = r.netSharePurchaseActivity;
  const h: UsHolders = {
    insidersPct: pct(mh?.insidersPercentHeld) ?? pct(ks?.heldPercentInsiders),
    institutionsPct: pct(mh?.institutionsPercentHeld) ?? pct(ks?.heldPercentInstitutions),
    institutionsCount: raw(mh?.institutionsCount),
    shortPctFloat: pct(ks?.shortPercentOfFloat),
    shortRatio: raw(ks?.shortRatio),
    sharesShort: raw(ks?.sharesShort),
    sharesShortPrior: raw(ks?.sharesShortPriorMonth),
  };
  if (ns && typeof ns === "object") {
    const buyShares = raw(ns.buyInfoShares), sellShares = raw(ns.sellInfoShares);
    if (buyShares != null || sellShares != null) {
      const b = buyShares ?? 0, s = sellShares ?? 0;
      h.insiderNet6m = { buyShares: b, sellShares: s, netShares: raw(ns.netInfoShares) ?? b - s, buyCount: raw(ns.buyInfoCount) ?? 0, sellCount: raw(ns.sellInfoCount) ?? 0 };
    }
  }
  const tx: any[] = Array.isArray(r.insiderTransactions?.transactions) ? r.insiderTransactions.transactions : [];
  const recent = tx
    .map((t) => {
      const d = date(t?.startDate), shares = raw(t?.shares);
      const name = typeof t?.filerName === "string" ? t.filerName.trim() : "";
      if (!d || shares == null || !name) return undefined;
      const text = [t.filerRelation, t.transactionText].filter((s) => typeof s === "string" && s.trim()).map((s: string) => s.trim()).join(" · ");
      const it: NonNullable<UsHolders["recentInsider"]>[number] = { name, text, shares, date: d };
      const value = raw(t.value);
      if (value != null) it.value = value;
      return it;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
  if (recent.length) h.recentInsider = recent;
  const own: any[] = Array.isArray(r.institutionOwnership?.ownershipList) ? r.institutionOwnership.ownershipList : [];
  const top = own
    .map((o) => {
      const name = typeof o?.organization === "string" ? o.organization.trim() : "";
      const pctHeld = pct(o?.pctHeld), d = date(o?.reportDate);
      if (!name || pctHeld == null || !d) return undefined;
      const it: NonNullable<UsHolders["topInstitutions"]>[number] = { name, pctHeld, date: d };
      const chg = pct(o.pctChange);
      if (chg != null) it.pctChange = chg;
      return it;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (top.length) h.topInstitutions = top;
  return Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as UsHolders;
}
