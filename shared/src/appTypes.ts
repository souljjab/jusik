import type { DayTradeCandidate, Plan } from "./daytrade";
import type { PaperAccount } from "./paper";
import type { Regime } from "./regime";
import type { Market } from "./types";

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
  counts: { journal: number; history: number };
}
