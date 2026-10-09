export interface Candle {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Market = "KOSPI" | "KOSDAQ";

export interface StockInfo {
  code: string;
  name: string;
  market: Market;
}

export interface Quote {
  code: string;
  price: number;
  change: number;
  changePct: number;
  volume?: number;
  /** 시가총액(억 원) */
  marketCap?: number;
}

export interface Fundamentals {
  per?: number;
  pbr?: number;
  eps?: number;
  bps?: number;
  /** % */
  roe?: number;
  /** 매출액 증가율 % */
  revenueGrowth?: number;
  /** 영업이익 증가율 % */
  opIncomeGrowth?: number;
  /** 부채비율 % */
  debtRatio?: number;
}

export type Action = "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";

export interface Reason {
  /** 점수에 더해진 값(+면 매수 쪽, -면 매도 쪽) */
  points: number;
  text: string;
}

export interface ScoreResult {
  /** -100 ~ 100 */
  score: number;
  reasons: Reason[];
}
