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
  /** 당좌비율 % (당좌자산 ⊂ 유동자산이라 항상 유동비율 이하) */
  quickRatio?: number;
  /** 동일업종 PER(배) */
  sectorPer?: number;
  /** 연간 실적(오래된 → 최신). 추정치(estimate)가 섞일 수 있다 */
  annual?: PeriodFinancials[];
  /** 분기 실적(오래된 → 최신). 추정치(estimate)가 섞일 수 있다 */
  quarterly?: PeriodFinancials[];
}

/** 한 결산 기간의 실적. 금액 단위는 출처를 따른다(네이버: 억 원). EPS는 주당 금액(원·달러) */
export interface PeriodFinancials {
  /** 결산 기간 라벨(예: "2024.12") */
  period: string;
  /** 컨센서스 추정치(E)면 true. 스크리닝 판단에는 확정값만 쓴다 */
  estimate: boolean;
  /** 매출액 */
  revenue?: number;
  /** 영업이익 */
  opIncome?: number;
  /** 당기순이익 */
  netIncome?: number;
  /** 주당순이익 */
  eps?: number;
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
  /** 근거가 된 규칙 ID와 출처(예: "M3-01 와인스타인"). 기초 자료집 부록 A의 규칙 카탈로그 기준 */
  rule?: string;
}
