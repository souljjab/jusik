import type { Candle, Fundamentals, Quote, StockInfo } from "@jusik/shared";

export interface MarketDataProvider {
  readonly name: string;
  /** 샘플(가짜) 데이터인지. UI에서 경고 표시에 쓴다 */
  readonly sample: boolean;
  search(q: string): Promise<StockInfo[]>;
  getInfo(code: string): Promise<StockInfo | undefined>;
  getQuote(code: string): Promise<Quote>;
  /** 오래된 순으로 정렬된 일봉. 최대 count개 */
  getCandles(code: string, count: number): Promise<Candle[]>;
  getFundamentals(code: string): Promise<Fundamentals>;
}
