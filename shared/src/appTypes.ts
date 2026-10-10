import type { DayTradeCandidate, Plan } from "./daytrade";
import type { Evaluation } from "./dayEval";
import type { BreadthAnalysis } from "./breadth";
import type { Disclosure, InvestorFlow } from "./flows";
import type { IntradayAssessment, IntradayBar } from "./intraday";
import type { UsHolders } from "./usFlows";
import type { GuardResult } from "./guards";
import type { MacroSnapshot } from "./macro";
import type { PaperAccount } from "./paper";
import type { Regime } from "./regime";
import type { Posture, RegimeAssessment } from "./regimeScore";
import type { DailyReview, PaperTrackingStatus } from "./review";
import type { Currency, Market, Note, Region } from "./types";

/** 서버가 저장하고 화면이 편집하는 설정 */
export interface Settings {
  /** 예수금(원). 매매 계획의 기준 현금 */
  depositKRW: number;
  /** 예수금(달러) */
  depositUSD: number;
  /** 1회 손절 시 잃어도 되는 예수금 비율(%) */
  riskPct: number;
  maxWeightPct: number;
  maxPositions: number;
  /** 항상 남겨 둘 현금 비율(%) */
  reservePct: number;
  minScore: number;
  /** 최소 당일 거래대금(현지 통화) */
  minTradeValueKRW: number;
  minTradeValueUSD: number;
  scanIntervalMin: number;
  monitorIntervalSec: number;
  /** 규칙대로 모의매매를 자동 실행하고 매매일지를 자동 작성할지 */
  paperEnabled: boolean;
  markets: Record<Market, boolean>;
  /** 시장별로 스캔할 최대 종목 수(거래대금 상위) */
  maxScanPerMarket: number;
  /** 국면별 주식 투자 상한(예수금 대비 %). 공격·중립·방어 */
  postureCaps: Record<Posture, number>;
  /** 하루 손실 한도(하루 시작 자산 대비 %). 0이면 끈다(M4-04) */
  dailyLossLimitPct: number;
  /** 이 횟수만큼 연속 손실이면 신규 진입을 멈춘다. 0이면 끈다(5.5) */
  maxConsecutiveLosses: number;
  /** 직접 입력한 ISM 제조업지수(사이트에서 못 읽을 때). null이면 사이트 값·대용 지표를 쓴다 */
  ismManual: { value: number; month: string } | null;
  /**
   * 모의 자동매매 진입 전 분봉 확인(4.7·M3-18 강창권).
   * off: 확인 안 함, filter: 갭 추격 금지·회피 신호면 건너뜀, strict: 분봉 매수 신호가 있을 때만 진입
   */
  minuteMode: "off" | "filter" | "strict";
}

export interface ScanResult {
  id: string;
  /** ISO 시각 */
  at: string;
  markets: Market[];
  universeCount: number;
  scannedCount: number;
  /** 탈락 사유별 개수 */
  rejected: Record<string, number>;
  regimes: Partial<Record<Market, Regime | null>>;
  /** 시장별 국면 점수(공격·중립·방어)와 투자 상한. 이전 버전 저장분에는 없다 */
  postures?: Partial<Record<Market, RegimeAssessment | null>>;
  /** 통화별로 실제 적용한 투자 상한(%). 국내는 코스피·코스닥 중 낮은 쪽 */
  exposureCaps?: Partial<Record<Currency, number>>;
  /** 통화별 리스크 가드 결과(일일 손실 한도·연속 손실). blocked면 자동 진입을 하지 않았다 */
  guards?: Partial<Record<Currency, GuardResult>>;
  /** 국면 점수에 쓴 매크로 자료의 기준일(없으면 null) */
  macroAsOf?: string | null;
  /** 매크로 요약(ISM·금리 추세). 이전 버전 저장분에는 없다 */
  macroSummary?: { ism: { value: number; month: string; source: string } | null; rateRising: boolean | null; us10yChange6m: number | null };
  /** 시장별 시장 폭 요약(A/D선·MI·신고가-신저가). 아직 계산 중이면 null */
  breadth?: Partial<Record<Market, BreadthSummary | null>>;
  /** 분봉 확인으로 진입을 미룬 종목(모의 자동매매) */
  minuteSkips?: { code: string; name: string; verdict: "buy" | "wait" | "avoid"; reason: string }[];
  candidates: DayTradeCandidate[];
  plans: { KRW?: Plan; USD?: Plan };
  /** 이번 스캔에서 모의매매로 실제 진입한 종목코드 */
  executed: string[];
  errors: string[];
}

export interface HistoryRow {
  at: string;
  market: Market;
  code: string;
  name: string;
  score: number;
  price: number;
  entry: number;
  stop: number;
  target: number;
}

export interface ExportStatus {
  excel: { path: string; at: string | null; ok: boolean | null; error: string | null };
  sheets: { configured: boolean; at: string | null; ok: boolean | null; error: string | null; rows: number | null };
}

export interface SchedulerStatus {
  running: boolean;
  scanning: boolean;
  lastScanAt: string | null;
  nextScanAt: string | null;
  lastError: string | null;
  marketOpen: { KR: boolean; US: boolean };
}

/** GET /api/state 응답 */
export interface ServerState {
  settings: Settings;
  status: { provider: string; sample: boolean; scheduler: SchedulerStatus; export: ExportStatus };
  latestScan: ScanResult | null;
  paper: { KRW: PaperAccount; USD: PaperAccount };
  counts: { journal: number; history: number; reviews: number };
  /** 모의투자 기간 추적(M5-02) */
  paperTracking: Record<Region, PaperTrackingStatus>;
}

/** GET /api/macro 응답 */
export interface MacroResponse {
  snapshot: MacroSnapshot | null;
  /** 지역별 매크로 근거 */
  notes: Record<Region, Note[]>;
  errors: string[];
  fetchedAt: string | null;
  /** 샘플(가짜) 매크로 자료인지 */
  sample: boolean;
}

/** GET /api/reviews 응답 */
export interface ReviewsResponse {
  reviews: DailyReview[];
}

/** POST /api/journal 응답의 점검 결과(주문 전 체크리스트·물타기) */
export interface JournalCheck {
  /** 고쳐야 할 항목(bad)과 다시 생각할 항목(warn) */
  notes: Note[];
  /** 기록에 남긴 위반 항목 */
  violations: string[];
}

/** 과거 일봉 재현 결과(규칙 점검) */
export interface ReplayRun {
  at: string;
  markets: Market[];
  /** 재현한 종목 수 */
  codesTested: number;
  tradeCount: number;
  /** 일봉 몇 개(약 몇 거래일)로 재현했는지 */
  candleCount: number;
  evaluation: Evaluation;
  errors: string[];
}

/** GET /api/stocks/:code/extras 응답 */
export interface StockExtras {
  code: string;
  /** 보조 데이터를 받을 수 있는 종목인지(국내: 네이버·DART, 미국: SEC·야후) */
  supported: boolean;
  region?: Region;
  /** 공시 목록 출처 */
  disclosureSource?: "네이버" | "DART" | "SEC" | null;
  /** DART 정기보고서 제출 현황(국내, DART 키가 있을 때) */
  reports?: { period: string; kind: string; filed: string; deadline: string; late: boolean }[];
  /** 미국: 기관·내부자·공매도 현황(야후) */
  us?: { holders: UsHolders | null } | null;
  flows: InvestorFlow[];
  /** 수급 가점(0~2). 점수를 깎지 않는 가점으로만 쓴다(자료집 8장 상충 지점) */
  flowScore: number;
  disclosures: Disclosure[];
  sector: { no: string; name: string; changePct: number | null; rank: number | null; total: number } | null;
  /** 수급·공시·업종 근거 */
  notes: Note[];
  /** 부분 실패(예: 공시 페이지 접속 실패) */
  errors: string[];
}

/** GET /api/stocks/:code/minute 응답 */
export interface MinuteResponse {
  code: string;
  region: Region;
  /** 분봉 날짜(현지). 장 시작 전이면 직전 거래일 */
  sessionDate: string | null;
  /** 오늘(또는 직전) 정규장 1분봉 */
  bars: IntradayBar[];
  assessment: IntradayAssessment | null;
  /** 장 시작 전·자료 없음 등 안내 */
  message: string | null;
  sample: boolean;
}

/** 스캔 결과에 남기는 시장 폭 요약(시계열은 GET /api/breadth/:market) */
export type BreadthSummary = Pick<BreadthAnalysis, "asOf" | "basis" | "sampleSize" | "score" | "divergence" | "miSignal" | "hiLoState" | "hiLo"> & { mi: number | null; adLine: number | null };

/** GET /api/breadth/:market 응답 */
export interface BreadthResponse {
  market: Market;
  /** 아직 계산 중이면 true(처음 계산은 바스켓 종목 일봉을 모두 받아야 해서 오래 걸린다) */
  pending: boolean;
  analysis: BreadthAnalysis | null;
  /** 오늘 거래소 전체 상승·하락 종목 수(국내, 네이버) */
  today: { up: number; upperLimit: number; unchanged: number; down: number; lowerLimit: number } | null;
  /** 쌓아 둔 거래소 전체 일별 기록 */
  log: { date: string; up: number; upperLimit: number; unchanged: number; down: number; lowerLimit: number }[];
  basketSize: number;
  errors: string[];
  sample: boolean;
}
