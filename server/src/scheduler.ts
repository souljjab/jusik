import { marketClock, regionOf, type Market, type Region, type SchedulerStatus } from "@jusik/shared";
import { buildReviewNow, isPostClose, MARKETS_OF, type ReviewDeps } from "./reviewJob";
import { monitorPositions, runScan } from "./scanner";

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
  /** 이미 시도한 일일 복기(지역:날짜). 실패해도 같은 날 다시 시도하지 않는다(수동으로는 다시 만들 수 있다) */
  private reviewTried = new Set<string>();

  constructor(private deps: ReviewDeps, private onChange: () => void = () => {}) {}

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

  /** 일일 복기를 지금 만든다(수동). 스캔·점검 중이면 "busy" */
  async buildReview(region: Region): Promise<Awaited<ReturnType<typeof buildReviewNow>> | "busy"> {
    if (this.busy) return "busy";
    this.busy = true;
    try {
      return await buildReviewNow(this.deps, region);
    } finally {
      this.busy = false;
      this.onChange();
    }
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
    // 장 마감 직후(30분 안) 그날 일일 복기를 한 번 자동 작성한다(M5-01)
    for (const region of ["KR", "US"] as Region[]) {
      const clock = marketClock(region, now);
      const key = `${region}:${clock.date}`;
      if (!clock.justClosed || this.reviewTried.has(key) || !MARKETS_OF[region].some((m) => s.markets[m])) continue;
      if (this.deps.store.state.reviews.some((r) => r.region === region && r.date === clock.date && isPostClose(r))) continue;
      this.reviewTried.add(key);
      await this.runExclusive(async () => {
        // 마감가로 손절·목표·시간 청산을 먼저 확인해 그날 모의매매 결과가 복기에 들어가게 한다
        await monitorPositions(this.deps);
        this.lastMonitorMs = this.now().getTime();
        const r = await buildReviewNow(this.deps, region);
        if (r.errors.length) console.error(`[jusik] 일일 복기(${key}) 일부 실패: ${r.errors.join(" / ")}`);
      });
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
