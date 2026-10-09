import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { newPaperAccount, type HistoryRow, type JournalEntry, type PaperAccount, type ScanResult, type Settings } from "@jusik/shared";

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
};

const RANGES: Record<string, [number, number]> = {
  depositKRW: [0, 1e13], depositUSD: [0, 1e10], riskPct: [0.1, 10], maxWeightPct: [1, 100], maxPositions: [1, 10], reservePct: [0, 90],
  minScore: [0, 100], minTradeValueKRW: [0, 1e14], minTradeValueUSD: [0, 1e11], scanIntervalMin: [1, 240], monitorIntervalSec: [15, 3600], maxScanPerMarket: [5, 100],
};

/** 입력값을 검증하고 범위 안으로 맞춘다. 알 수 없는 키·잘못된 타입은 무시한다. */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...base, markets: { ...base.markets } };
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = src[k];
    if (typeof v === "number" && Number.isFinite(v)) (out as unknown as Record<string, number>)[k] = Math.min(hi, Math.max(lo, v));
  }
  if (typeof src.paperEnabled === "boolean") out.paperEnabled = src.paperEnabled;
  const m = src.markets as Record<string, unknown> | undefined;
  if (m && typeof m === "object") for (const k of ["KOSPI", "KOSDAQ", "US"] as const) if (typeof m[k] === "boolean") out.markets[k] = m[k] as boolean;
  out.maxPositions = Math.round(out.maxPositions);
  out.maxScanPerMarket = Math.round(out.maxScanPerMarket);
  return out;
}

export interface AppState {
  settings: Settings;
  paper: { KRW: PaperAccount; USD: PaperAccount };
  latestScan: ScanResult | null;
  history: HistoryRow[];
  journal: JournalEntry[];
}

export const HISTORY_LIMIT = 3000;

function fresh(): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS, markets: { ...DEFAULT_SETTINGS.markets } },
    paper: { KRW: newPaperAccount(DEFAULT_SETTINGS.depositKRW), USD: newPaperAccount(DEFAULT_SETTINGS.depositUSD) },
    latestScan: null,
    history: [],
    journal: [],
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
