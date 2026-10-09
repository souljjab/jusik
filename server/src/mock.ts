import type { Candle, Fundamentals, Market, Quote, StockInfo } from "@jusik/shared";
import type { MarketDataProvider } from "./provider";
import { findStock, searchStocks } from "./stocks";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 영업일(월~금)만 end에서 거슬러 올라가 count개의 날짜를 만든다 */
function businessDays(end: Date, count: number): string[] {
  const out: string[] = [];
  const d = new Date(end);
  while (out.length < count) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

/** 종목 코드로 항상 같은 값이 나오는 가짜 데이터. 실제 시세가 아니다. */
export class MockProvider implements MarketDataProvider {
  readonly name = "mock";
  readonly sample = true;
  private cache = new Map<string, Candle[]>();

  async search(q: string) {
    return searchStocks(q);
  }

  async getInfo(code: string): Promise<StockInfo | undefined> {
    return findStock(code);
  }

  async getCandles(code: string, count: number): Promise<Candle[]> {
    const all = this.build(code);
    return all.slice(-count);
  }

  async getQuote(code: string): Promise<Quote> {
    const cs = this.build(code);
    const last = cs[cs.length - 1]!;
    const prev = cs[cs.length - 2]!;
    return {
      code,
      price: last.close,
      change: last.close - prev.close,
      changePct: (last.close / prev.close - 1) * 100,
      volume: last.volume,
      marketCap: Math.round((last.close * (hash(code) % 900_000_000 + 100_000_000)) / 1e8),
    };
  }

  async getIndexCandles(market: Market, count: number): Promise<Candle[]> {
    return this.build(`INDEX:${market}`, 2000).slice(-count);
  }

  async getFundamentals(code: string): Promise<Fundamentals> {
    const r = rng(hash(code + "f"));
    const eps = Math.round(1000 + r() * 9000);
    const bps = Math.round(eps * (3 + r() * 12));
    const price = this.build(code).at(-1)!.close;
    return {
      per: round1(price / eps),
      pbr: round1(price / bps),
      eps,
      bps,
      roe: round1((eps / bps) * 100),
      revenueGrowth: round1(-10 + r() * 45),
      opIncomeGrowth: round1(-25 + r() * 80),
      debtRatio: round1(30 + r() * 220),
      currentRatio: round1(60 + r() * 220),
      reserveRatio: round1(80 + r() * 1500),
    };
  }

  private build(code: string, startPrice?: number): Candle[] {
    const hit = this.cache.get(code);
    if (hit) return hit;
    const r = rng(hash(code));
    const days = businessDays(new Date(), 750);
    let price = startPrice ?? 5000 + Math.floor(r() * 150) * 1000;
    // 장기 추세와 사이클을 섞어 신호가 다양하게 나오도록 한다
    const drift = (r() - 0.45) * 0.0012;
    const cycleLen = 60 + Math.floor(r() * 80);
    const out: Candle[] = days.map((date, i) => {
      const cycle = Math.sin((2 * Math.PI * i) / cycleLen) * 0.004;
      const ret = drift + cycle + (r() - 0.5) * 0.035;
      const open = Math.round(price * (1 + (r() - 0.5) * 0.008));
      const close = Math.max(100, Math.round(price * (1 + ret)));
      const high = Math.round(Math.max(open, close) * (1 + r() * 0.012));
      const low = Math.round(Math.min(open, close) * (1 - r() * 0.012));
      price = close;
      return { date, open, high, low, close, volume: Math.round(200_000 + r() * 1_800_000 * (1 + Math.abs(ret) * 25)) };
    });
    this.cache.set(code, out);
    return out;
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
