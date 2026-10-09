import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Candle, Fundamentals, Market, Quote, StockInfo } from "@jusik/shared";
import type { MarketDataProvider, UniverseRow } from "../src/provider";

export const tmp = () => mkdtempSync(join(tmpdir(), "jusik-"));

const DAY = 86_400_000;

/** end(평일)로 끝나는 평일 일봉 n개. 횡보(RSI≈50) 후 마지막 날 거래량 폭증 돌파. */
export function breakout(end: string, n = 80, { base = 10_000, lastClose = 1.05, lastVol = 5000, decimals = 0 } = {}): Candle[] {
  const dates: string[] = [];
  for (let t = Date.parse(end); dates.length < n; t -= DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) dates.unshift(new Date(t).toISOString().slice(0, 10));
  }
  const rd = (x: number) => Number(x.toFixed(decimals));
  let px = base;
  return dates.map((date, i) => {
    const last = i === n - 1;
    const close = rd(last ? px * lastClose : px * (1 + 0.004 * (i % 2 ? 1 : -1)));
    const open = rd(last ? px * 1.005 : px);
    const c: Candle = { date, open, high: rd(Math.max(open, close) * (last ? 1.003 : 1.004)), low: rd(Math.min(open, close) * 0.996), close, volume: last ? lastVol : 1000 };
    px = close;
    return c;
  });
}

/** 우상향 지수(강세 국면) */
export function uptrend(end: string, n = 300): Candle[] {
  const dates: string[] = [];
  for (let t = Date.parse(end); dates.length < n; t -= DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) dates.unshift(new Date(t).toISOString().slice(0, 10));
  }
  return dates.map((date, i) => {
    const close = 1000 * 1.0015 ** i * (1 + 0.003 * Math.sin(i / 4));
    return { date, open: close, high: close * 1.004, low: close * 0.996, close, volume: 1e6 };
  });
}

export const END = "2024-03-18"; // 월요일
export const MON_1030_KST = new Date("2024-03-18T01:30:00Z");

/** 통제 가능한 제공자: 순위표·일봉·현재가를 테스트가 직접 정한다. */
export class StubProvider implements MarketDataProvider {
  readonly name = "stub";
  readonly sample = true;
  prices: Record<string, number> = {};
  universeCalls = 0;
  failUniverse = new Set<Market>();
  /** 설정하면 순위표 조회가 이 약속이 풀릴 때까지 대기한다(동시 실행 테스트용) */
  gate: Promise<void> | null = null;
  rows: Record<Market, UniverseRow[]> = {
    KOSPI: [
      { code: "000001", name: "가나다", market: "KOSPI", price: 10_500, changePct: 5, volume: 5000, tradeValue: 5e9 },
      { code: "000002", name: "라마바", market: "KOSPI", price: 10_500, changePct: 5, volume: 5000, tradeValue: 4e9 },
      { code: "000003", name: "약한종목", market: "KOSPI", price: 10_500, changePct: 0.5, volume: 5000, tradeValue: 9e9 },
    ],
    KOSDAQ: [],
    US: [{ code: "AAPL", name: "Apple", market: "US", price: 50, changePct: 5, volume: 500_000, tradeValue: 25e6 }],
  };

  async search(): Promise<StockInfo[]> {
    return [];
  }
  async getInfo(code: string) {
    const all = [...this.rows.KOSPI, ...this.rows.KOSDAQ, ...this.rows.US].find((r) => r.code === code);
    return all ? { code, name: all.name, market: all.market } : undefined;
  }
  async getQuote(code: string): Promise<Quote> {
    const c = (await this.getCandles(code, 5)).at(-1)!;
    return { code, price: this.prices[code] ?? c.close, change: 0, changePct: 0 };
  }
  async getPrices(codes: string[]) {
    return Object.fromEntries(codes.filter((c) => this.prices[c] != null).map((c) => [c, this.prices[c]!]));
  }
  async getCandles(code: string, count: number) {
    const us = !/^\d{6}$/.test(code);
    return breakout(END, 80, us ? { base: 47.5, decimals: 2, lastVol: 500_000 } : {}).slice(-count);
  }
  async getFundamentals(): Promise<Fundamentals> {
    return { per: 8, pbr: 0.9 };
  }
  async getIndexCandles(_m: Market, count: number) {
    return uptrend(END).slice(-count);
  }
  async getUniverse(m: Market) {
    this.universeCalls++;
    if (this.gate) await this.gate;
    if (this.failUniverse.has(m)) throw new Error(`${m} 접속 차단`);
    return this.rows[m];
  }
}
