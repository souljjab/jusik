import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_POSTURE_CAPS, GUARD_DEFAULTS, newPaperAccount,
  type Currency, type DailyReview, type HistoryRow, type JournalEntry, type Market, type MarketRowLike, type PaperAccount, type ReplayRun, type ScanResult, type Settings,
} from "@jusik/shared";

export type { HistoryRow, ScanResult, Settings };

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

const RANGES: Record<string, [number, number]> = {
  depositKRW: [0, 1e13], depositUSD: [0, 1e10], riskPct: [0.1, 10], maxWeightPct: [1, 100], maxPositions: [1, 10], reservePct: [0, 90],
  minScore: [0, 100], minTradeValueKRW: [0, 1e14], minTradeValueUSD: [0, 1e11], scanIntervalMin: [1, 240], monitorIntervalSec: [15, 3600], maxScanPerMarket: [5, 100],
  dailyLossLimitPct: [0, 50], maxConsecutiveLosses: [0, 20],
};

/** 입력값을 검증하고 범위 안으로 맞춘다. 알 수 없는 키·잘못된 타입은 무시한다. */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...base, markets: { ...base.markets }, postureCaps: { ...DEFAULT_POSTURE_CAPS, ...base.postureCaps } };
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = src[k];
    if (typeof v === "number" && Number.isFinite(v)) (out as unknown as Record<string, number>)[k] = Math.min(hi, Math.max(lo, v));
  }
  if (typeof src.paperEnabled === "boolean") out.paperEnabled = src.paperEnabled;
  const m = src.markets as Record<string, unknown> | undefined;
  if (m && typeof m === "object") for (const k of ["KOSPI", "KOSDAQ", "US"] as const) if (typeof m[k] === "boolean") out.markets[k] = m[k] as boolean;
  const caps = src.postureCaps as Record<string, unknown> | undefined;
  if (caps && typeof caps === "object")
    for (const k of ["ATTACK", "NEUTRAL", "DEFENSE"] as const) {
      const v = caps[k];
      if (typeof v === "number" && Number.isFinite(v)) out.postureCaps[k] = Math.min(100, Math.max(0, v));
    }
  out.maxPositions = Math.round(out.maxPositions);
  out.maxScanPerMarket = Math.round(out.maxScanPerMarket);
  out.maxConsecutiveLosses = Math.round(out.maxConsecutiveLosses);
  if (src.ismManual === null) out.ismManual = null;
  else if (src.ismManual && typeof src.ismManual === "object") {
    const m = src.ismManual as Record<string, unknown>;
    // 형식만 본다(20~80, YYYY-MM). 아직 끝나지 않은 달인지는 쓸 때 ism.ts manualIsm이 다시 확인한다
    if (typeof m.value === "number" && Number.isFinite(m.value) && m.value >= 20 && m.value <= 80 && typeof m.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m.month))
      out.ismManual = { value: Math.round(m.value * 10) / 10, month: m.month };
  }
  if (src.minuteMode === "off" || src.minuteMode === "filter" || src.minuteMode === "strict") out.minuteMode = src.minuteMode;
  return out;
}

export interface AppState {
  settings: Settings;
  paper: { KRW: PaperAccount; USD: PaperAccount };
  latestScan: ScanResult | null;
  history: HistoryRow[];
  journal: JournalEntry[];
  /** 마지막 과거 재현(규칙 점검) 결과 */
  lastReplay: ReplayRun | null;
  /** 일일 복기(M5-01). 날짜·지역마다 하나, 오래된 순 */
  reviews: DailyReview[];
  /** 시장별 마지막 순위표(일일 복기의 특징주 재료). 스캔할 때마다 덮어쓴다 */
  lastUniverse: Partial<Record<Market, { at: string; rows: MarketRowLike[] }>>;
  /** 통화별 '하루 시작 자산'(그 시장 날짜의 첫 점검 때 가격을 반영하기 전 모의계좌 자산). 일일 손실 한도 계산용 */
  dayStart: Partial<Record<Currency, { date: string; equity: number }>>;
  /** 거래소 전체 상승·하락 종목 수 일별 기록(네이버, 국내). 쌓이면 바스켓 근사 대신 실제 A/D선을 그릴 수 있다 */
  breadthLog: Partial<Record<Market, BreadthLogRow[]>>;
}

export interface BreadthLogRow {
  date: string;
  up: number;
  upperLimit: number;
  unchanged: number;
  down: number;
  lowerLimit: number;
}

export const BREADTH_LOG_LIMIT = 600;

export const HISTORY_LIMIT = 3000;
export const REVIEW_LIMIT = 500;

function fresh(): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS, markets: { ...DEFAULT_SETTINGS.markets } },
    paper: { KRW: newPaperAccount(DEFAULT_SETTINGS.depositKRW), USD: newPaperAccount(DEFAULT_SETTINGS.depositUSD) },
    latestScan: null,
    history: [],
    journal: [],
    lastReplay: null,
    reviews: [],
    lastUniverse: {},
    dayStart: {},
    breadthLog: {},
  };
}

/** JSON 파일 하나에 상태를 저장한다. 쓰는 도중 꺼져도 깨지지 않게 임시 파일에 쓴 뒤 교체한다. */
export class Store {
  state: AppState;

  constructor(private file: string) {
    this.state = fresh();
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AppState>;
        this.state = {
          settings: sanitizeSettings(raw.settings),
          paper: { KRW: raw.paper?.KRW ?? this.state.paper.KRW, USD: raw.paper?.USD ?? this.state.paper.USD },
          latestScan: raw.latestScan ?? null,
          history: Array.isArray(raw.history) ? raw.history : [],
          journal: Array.isArray(raw.journal) ? raw.journal : [],
          lastReplay: raw.lastReplay ?? null,
          reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
          lastUniverse: raw.lastUniverse && typeof raw.lastUniverse === "object" ? raw.lastUniverse : {},
          dayStart: raw.dayStart && typeof raw.dayStart === "object" ? raw.dayStart : {},
          breadthLog: raw.breadthLog && typeof raw.breadthLog === "object" ? raw.breadthLog : {},
        };
      } catch (e) {
        // 파일이 깨졌으면 덮어쓰지 않고 백업해 둔다
        try {
          renameSync(file, `${file}.corrupt-${Date.now()}`);
        } catch {
          /* 무시 */
        }
        console.error(`[jusik] 상태 파일을 읽지 못해 새로 시작해요(백업됨): ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.file);
  }
}
