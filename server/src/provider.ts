import type { Candle, Fundamentals, Market, Quote, StockInfo } from "@jusik/shared";

/** 시장 순위표 한 줄(스캔 대상 후보). 당일 기준 */
export interface UniverseRow {
  code: string;
  name: string;
  market: Market;
  price: number;
  changePct: number;
  volume: number;
  /** 거래대금(현지 통화). 사이트가 주지 않으면 price×volume으로 근사 */
  tradeValue: number;
}

export interface MarketDataProvider {
  readonly name: string;
  /** 샘플(가짜) 데이터인지. UI에서 경고 표시에 쓴다 */
  readonly sample: boolean;
  search(q: string): Promise<StockInfo[]>;
  getInfo(code: string): Promise<StockInfo | undefined>;
  getQuote(code: string): Promise<Quote>;
  /** 여러 종목의 현재가 {code: price}. 조회에 실패한 종목은 빠진다 */
  getPrices(codes: string[]): Promise<Record<string, number>>;
  /** 오래된 순으로 정렬된 일봉. 최대 count개. 마지막 봉은 당일(진행 중일 수 있음) */
  getCandles(code: string, count: number): Promise<Candle[]>;
  getFundamentals(code: string): Promise<Fundamentals>;
  /** 시장 지수 일봉(KOSPI/KOSDAQ/US=S&P500). 시장 국면과 상대강도 계산에 쓴다 */
  getIndexCandles(market: Market, count: number): Promise<Candle[]>;
  /** 당일 거래량·상승률 상위 종목(스캔 후보 풀) */
  getUniverse(market: Market): Promise<UniverseRow[]>;
}
