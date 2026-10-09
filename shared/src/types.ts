export interface Candle {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Market = "KOSPI" | "KOSDAQ" | "US";
export type Region = "KR" | "US";
export type Currency = "KRW" | "USD";

export const regionOf = (m: Market): Region => (m === "US" ? "US" : "KR");
export const currencyOfRegion = (r: Region): Currency => (r === "US" ? "USD" : "KRW");
/** 종목코드 형식으로 지역 판별: 한국은 6자리 숫자, 그 외는 미국 티커 */
export const regionOfCode = (code: string): Region => (/^\d{6}$/.test(code) ? "KR" : "US");
export const isValidCode = (code: string) => /^\d{6}$/.test(code) || /^[A-Z][A-Z0-9.\-]{0,9}$/.test(code);

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
  /** 유동비율 % */
  currentRatio?: number;
  /** 유보율 % */
  reserveRatio?: number;
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

/** 화면에 근거를 보여주기 위한 한 줄 설명 */
export interface Note {
  tone: "good" | "bad" | "warn" | "info";
  text: string;
}
