import { marketClock, regionOf, type Market, type SchedulerStatus } from "@jusik/shared";
import { monitorPositions, runScan, type Deps } from "./scanner";

/**
 * 장이 열려 있는 동안 정해진 주기로 스캔하고(기본 10분), 보유 모의 포지션은 더 자주(기본 60초) 점검한다.
 * 공휴일은 알지 못해 휴장일에도 '장중'으로 보일 수 있다(그 경우 사이트의 데이터가 갱신되지 않아 후보가 걸러진다).
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastScanMs = 0;
  private lastMonitorMs = 0;
  private lastError: string | null = null;
  private lastScanAt: string | null = null;

  constructor(private deps: Deps, private onChange: () => void = () => {}) {}

  start(tickMs = 15_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), tickMs);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): SchedulerStatus {
    const s = this.deps.store.state.settings;
    const now = this.now();
    return {
      running: this.timer != null,
      scanning: this.busy,
      lastScanAt: this.lastScanAt ?? this.deps.store.state.latestScan?.at ?? null,
      nextScanAt: this.lastScanMs ? new Date(this.lastScanMs + s.scanIntervalMin * 60_000).toISOString() : null,
      lastError: this.lastError,
      marketOpen: { KR: marketClock("KR", now).isOpen, US: marketClock("US", now).isOpen },
    };
  }

  /** 수동 스캔(장이 닫혀 있어도 마지막 종가 기준으로 실행). 이미 실행 중이면 false */
  async scanNow(): Promise<boolean> {
    if (this.busy) return false;
    await this.runExclusive(async () => {
      await runScan(this.deps);
      this.lastScanMs = this.now().getTime();
      this.lastScanAt = new Date(this.lastScanMs).toISOString();
    });
    return true;
  }

  /** 백그라운드로 스캔을 시작한다. 이미 실행 중이면 false */
  startScan(): boolean {
    if (this.busy) return false;
    void this.scanNow();
    return true;
  }

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }

  private async tick() {
    if (this.busy) return;
    const s = this.deps.store.state.settings;
    const now = this.now();
    const open = (m: Market) => s.markets[m] && marketClock(regionOf(m), now).isOpen;
    const anyOpen = (["KOSPI", "KOSDAQ", "US"] as Market[]).some(open);
    const t = now.getTime();

    if (anyOpen && t - this.lastScanMs >= s.scanIntervalMin * 60_000) {
      await this.runExclusive(async () => {
        await runScan(this.deps);
        this.lastScanMs = this.now().getTime();
        this.lastScanAt = new Date(this.lastScanMs).toISOString();
      });
      this.lastMonitorMs = this.lastScanMs;
      return;
    }
    if (t - this.lastMonitorMs >= s.monitorIntervalSec * 1000) {
      this.lastMonitorMs = t;
      await this.runExclusive(async () => {
        await monitorPositions(this.deps);
      });
    }
  }

  private async runExclusive(fn: () => Promise<void>) {
    this.busy = true;
    try {
      await fn();
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.error(`[jusik] 스캔/점검 실패: ${this.lastError}`);
    } finally {
      this.busy = false;
      this.onChange();
    }
  }
}
