import type { Candle, Fundamentals, Market, Quote, StockInfo } from "@jusik/shared";

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
  /** 시장 지수 일봉(KOSPI/KOSDAQ). 시장 국면과 상대강도 계산에 쓴다 */
  getIndexCandles(market: Market, count: number): Promise<Candle[]>;
}
