import { regionOfCode, sampleMarketFields, type Candle, type Fundamentals, type Market, type PeriodFinancials, type Quote, type StockInfo } from "@jusik/shared";
import { sampleSecFinancials } from "./mockUs";
import type { MarketDataProvider, UniverseRow } from "./provider";
import { findStock, searchStocks, STOCKS } from "./stocks";

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

  async getPrices(codes: string[]): Promise<Record<string, number>> {
    return Object.fromEntries(codes.map((c) => [c, this.build(c).at(-1)!.close]));
  }

  async getUniverse(market: Market): Promise<UniverseRow[]> {
    return STOCKS.filter((s) => s.market === market).map((s) => {
      const cs = this.build(s.code);
      const last = cs[cs.length - 1]!;
      const prev = cs[cs.length - 2]!;
      return { code: s.code, name: s.name, market, price: last.close, changePct: (last.close / prev.close - 1) * 100, volume: last.volume, tradeValue: last.close * last.volume };
    });
  }

  async getIndexCandles(market: Market, count: number): Promise<Candle[]> {
    return this.build(`INDEX:${market}`, 2000).slice(-count);
  }

  async getFundamentals(code: string): Promise<Fundamentals> {
    const r = rng(hash(code + "f"));
    const eps = Math.round(1000 + r() * 9000);
    const bps = Math.round(eps * (3 + r() * 12));
    const price = this.build(code).at(-1)!.close;
    const base: Fundamentals = {
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
      sectorPer: round1(6 + r() * 20),
      ...this.periods(code, eps),
    };
    if (regionOfCode(code) !== "US") return { ...base, ...sampleMarketFields(base, price, "억원") };
    // 미국: SEC 형식의 샘플 실적(백만 달러, 제출일 포함)과 그에 맞춘 EPS·PER. 업종 PER·유보율은 미국 자료에 없다
    const sec = sampleSecFinancials(code, new Date());
    const lastEps = [...sec.annual].reverse().find((p) => !p.estimate && p.eps != null && p.eps > 0)?.eps;
    const usEps = lastEps ?? round1(price / (8 + r() * 20));
    const usBps = round1(usEps * (3 + r() * 12));
    const us: Fundamentals = {
      ...base, eps: usEps, bps: usBps, per: round1(price / usEps), pbr: round1(price / usBps), roe: round1((usEps / usBps) * 100),
      sectorPer: undefined, reserveRatio: undefined, annual: sec.annual, quarterly: sec.quarterly,
    };
    return { ...us, ...sampleMarketFields(us, price, "백만달러") };
  }

  /** 가짜 연간(최근 3년 + 추정 1년)·분기(최근 5분기 + 추정 1분기) 실적. 단위: 억 원 */
  private periods(code: string, eps: number): { annual: PeriodFinancials[]; quarterly: PeriodFinancials[] } {
    const r = rng(hash(code + "p"));
    const growth = -0.08 + r() * 0.3;
    const y = new Date().getUTCFullYear() - 1;
    const row = (period: string, k: number, estimate: boolean): PeriodFinancials => {
      const scale = (1 + growth) ** k * (1 + (r() - 0.5) * 0.04);
      const revenue = Math.round(10_000 * scale);
      const opIncome = Math.round(revenue * (0.06 + r() * 0.08));
      return { period, estimate, revenue, opIncome, netIncome: Math.round(opIncome * 0.75), eps: Math.round(eps * scale) };
    };
    const annual = [0, 1, 2, 3].map((k) => row(`${y - 2 + k}.12${k === 3 ? "(E)" : ""}`, k, k === 3));
    const qs = ["03", "06", "09", "12"];
    const quarterly = [0, 1, 2, 3, 4, 5].map((k) => {
      const yy = y + Math.floor((k + 1) / 4), q = qs[(k + 1) % 4]!;
      const it = row(`${yy}.${q}${k === 5 ? "(E)" : ""}`, k / 4, k === 5);
      return { ...it, revenue: Math.round(it.revenue! / 4), opIncome: Math.round(it.opIncome! / 4), netIncome: Math.round(it.netIncome! / 4), eps: Math.round(it.eps! / 4) };
    });
    return { annual, quarterly };
  }

  private build(code: string, startPrice?: number): Candle[] {
    const hit = this.cache.get(code);
    if (hit) return hit;
    const r = rng(hash(code));
    const days = businessDays(new Date(), 750);
    const us = regionOfCode(code) === "US" && !code.startsWith("INDEX:");
    const dec = us ? 2 : 0;
    const rd = (x: number) => Number(x.toFixed(dec));
    let price = startPrice ?? (us ? 20 + r() * 480 : 5000 + Math.floor(r() * 150) * 1000);
    // 장기 추세와 사이클을 섞어 신호가 다양하게 나오도록 한다
    const drift = (r() - 0.45) * 0.0012;
    const cycleLen = 60 + Math.floor(r() * 80);
    const out: Candle[] = days.map((date, i) => {
      const cycle = Math.sin((2 * Math.PI * i) / cycleLen) * 0.004;
      const ret = drift + cycle + (r() - 0.5) * 0.035;
      const open = rd(price * (1 + (r() - 0.5) * 0.008));
      const close = Math.max(us ? 1 : 100, rd(price * (1 + ret)));
      const high = rd(Math.max(open, close) * (1 + r() * 0.012));
      const low = rd(Math.min(open, close) * (1 - r() * 0.012));
      price = close;
      return { date, open, high, low, close, volume: Math.round(200_000 + r() * 1_800_000 * (1 + Math.abs(ret) * 25)) };
    });
    // 데모용: 일부 종목은 오늘 거래량을 동반해 오른 것으로 만들어 스캔 화면이 비지 않게 한다(샘플 모드 전용)
    if (!code.startsWith("INDEX:") && hash(code) % 4 === 0) {
      const prev = out[out.length - 2]!;
      const last = out[out.length - 1]!;
      const avg = out.slice(-21, -1).reduce((a, c) => a + c.volume, 0) / 20;
      const close = rd(prev.close * (1.035 + (hash(code + "u") % 30) / 1000));
      const open = rd(prev.close * 1.004);
      Object.assign(last, { open, close, high: rd(close * 1.003), low: rd(open * 0.997), volume: Math.round(avg * (3 + (hash(code + "v") % 30) / 10)) });
    }
    this.cache.set(code, out);
    return out;
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
