import type { Settings } from "./appTypes";
import { GUARD_DEFAULTS } from "./guards";
import { DEFAULT_POSTURE_CAPS } from "./regimeScore";

/** 앱 설정 기본값(서버가 처음 만들 때와 화면의 '기본값으로'가 같이 쓴다) */
export const DEFAULT_SETTINGS: Settings = {
  depositKRW: 10_000_000,
  depositUSD: 7_000,
  riskPct: 1,
  maxWeightPct: 30,
  maxPositions: 3,
  reservePct: 10,
  minScore: 55,
  minTradeValueKRW: 1_000_000_000,
  minTradeValueUSD: 5_000_000,
  scanIntervalMin: 10,
  monitorIntervalSec: 60,
  paperEnabled: false,
  markets: { KOSPI: true, KOSDAQ: true, US: true },
  maxScanPerMarket: 40,
  postureCaps: { ...DEFAULT_POSTURE_CAPS },
  dailyLossLimitPct: GUARD_DEFAULTS.dailyLossLimitPct,
  maxConsecutiveLosses: GUARD_DEFAULTS.maxConsecutiveLosses,
  ismManual: null,
  minuteMode: "filter",
};
