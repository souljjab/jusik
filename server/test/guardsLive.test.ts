import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { JournalEntry, PaperPosition } from "@jusik/shared";
import { buildApp } from "../src/app";
import { Exporter } from "../src/exporter";
import { MockExtras, MockMacro } from "../src/extras";
import { minuteFor } from "../src/intradayCheck";
import { MockMinuteSource } from "../src/minute";
import { monitorPositions, runScan, syncPaperWithDeposit } from "../src/scanner";
import { Scheduler } from "../src/scheduler";
import { migrateAlert, sanitizeSettings, Store } from "../src/state";
import { buildTables } from "../src/tables";
import { MON_1030_KST, StubProvider, tmp } from "./helpers";

/*
 * 리스크 가드를 GET /api/state마다 지금 설정·오늘 날짜로 다시 계산하는지(리뷰 R029·R043·R073·R124·R126),
 * 매매일지 점검이 사용자 설정을 쓰는지(R044·R045·R125·R138), 내보내기(R137), 스케줄러 상태(R015·R072·R132)
 */

/** 화 07:00 KST(국내 장 시작 전) */
const TUE_0700_KST = new Date("2024-03-18T22:00:00Z");

function setup(over: Record<string, unknown> = {}) {
  const dir = tmp();
  const store = new Store(join(dir, "state.json"));
  store.state.settings = sanitizeSettings({ minTradeValueKRW: 1, minTradeValueUSD: 1, paperEnabled: true, ...over }, store.state.settings);
  syncPaperWithDeposit(store, true);
  const provider = new StubProvider();
  let t = MON_1030_KST;
  const now = () => t;
  const deps = { provider, store, macro: new MockMacro(now), extras: new MockExtras(now), now };
  const exporter = new Exporter({ excelPath: join(dir, "j.xlsx"), sheets: null, debounceMs: 1, build: () => [] });
  const scheduler = new Scheduler(deps);
  const app = buildApp({ ...deps, exporter, scheduler });
  return { store, provider, deps, app, scheduler, setNow: (d: Date) => (t = d) };
}

const pos = (code: string, entry: number, qty: number, last: number, stop: number): PaperPosition => ({
  code, name: `종목${code}`, openedAt: "2024-03-14T01:00:00Z", entryDate: "2024-03-14", entryPrice: entry, qty, stop, target: entry * 1.2, maxHoldDays: 5, cost: entry * qty, lastPrice: last, reason: "",
});

/** 자동(모의) 손실 거래 한 쌍 */
function autoLoss(code: string, sellDate: string): JournalEntry[] {
  return [
    {
      id: `${code}-b`, code, name: code, date: "2024-03-11", side: "BUY", price: 10_000, qty: 10, stop: 9_700, reason: "단타", source: "자동(모의)",
      meta: { score: 60, volumeRatio: 3, changePct: 5, stopPct: 3, market: "KOSPI", regime: "BULL" },
    },
    { id: `${code}-s`, code, name: code, date: sellDate, side: "SELL", price: 9_700, qty: 10, reason: "손절(9700)", source: "자동(모의)", netPnl: -3_000, netPct: -3 },
  ];
}

/** 하루 시작 자산 1,000만 원에서 오늘 50만 원(5%) 잃은 계좌 */
function loseToday(store: Store, date = "2024-03-18") {
  store.state.dayStart.KRW = { date, equity: 10_000_000 };
  store.state.paper.KRW.cash = 9_500_000;
}

describe("live risk guards in GET /api/state", () => {
  it("does not count unrealized loss carried from earlier days as today's loss outside the session (R124)", async () => {
    const { store, app, deps, setNow } = setup({ dailyLossLimitPct: 4 });
    setNow(TUE_0700_KST);
    // 평가손실 −51만 원(−5.1%)을 들고 장 시작 전, 하루 시작 자산은 어제 것
    const acct = store.state.paper.KRW;
    acct.positions = [pos("000005", 70_000, 20, 69_000, 68_000), pos("000006", 200_000, 5, 100_000, 180_000)];
    acct.cash = 10_000_000 - 70_000 * 20 - 200_000 * 5;
    store.state.dayStart.KRW = { date: "2024-03-18", equity: 9_600_000 };
    const st = (await app.inject("/api/state")).json();
    expect(st.guards.KRW).toMatchObject({ blocked: false, date: "2024-03-19" });
    expect(st.todayPnl.KRW).toBeUndefined();

    // 장 시작 전 수동 스캔도 잠그지 않고, 그날 가드 알림 자리를 쓰지 않는다
    const scan = await runScan(deps);
    expect(scan.guards?.KRW?.blocked).toBe(false);
    expect(store.state.alerts.some((a) => a.key.startsWith("guard:KR:"))).toBe(false);
  });

  it("blocks on today's loss from today's day-start snapshot, and agrees with todayPnl", async () => {
    const { store, app } = setup({ dailyLossLimitPct: 4 });
    loseToday(store);
    const st = (await app.inject("/api/state")).json();
    expect(st.guards.KRW).toMatchObject({ blocked: true, reasons: ["dailyLoss"], date: "2024-03-18" });
    expect(st.guards.KRW.notes[0].text).toContain("5%");
    expect(st.todayPnl.KRW.pct).toBeCloseTo(-5, 9);
    // 스캔 결과에 저장된 가드가 없어도(스캔 전) 지금 값으로 계산한다
    expect(st.latestScan).toBeNull();
  });

  it("releases yesterday's lock on the next trading day without waiting for a scan (R073)", async () => {
    const { store, app, setNow } = setup({ dailyLossLimitPct: 4 });
    loseToday(store);
    expect((await app.inject("/api/state")).json().guards.KRW.blocked).toBe(true);
    setNow(TUE_0700_KST);
    expect((await app.inject("/api/state")).json().guards.KRW.blocked).toBe(false);
  });

  it("re-evaluates right after the limits change or the paper account is reset (R126)", async () => {
    const { store, app } = setup({ dailyLossLimitPct: 4 });
    loseToday(store);
    expect((await app.inject("/api/state")).json().guards.KRW.blocked).toBe(true);
    await app.inject({ method: "PUT", url: "/api/settings", payload: { dailyLossLimitPct: 10 } });
    expect((await app.inject("/api/state")).json().guards.KRW.blocked).toBe(false);
    await app.inject({ method: "PUT", url: "/api/settings", payload: { dailyLossLimitPct: 4 } });
    expect((await app.inject("/api/state")).json().guards.KRW.blocked).toBe(true);

    // 오늘 실현 손실이 있어도 초기화한 새 계좌의 오늘 손익은 0에서 시작한다
    store.state.journal.push(...autoLoss("000009", "2024-03-18"));
    await app.inject({ method: "POST", url: "/api/paper/reset" });
    const st = (await app.inject("/api/state")).json();
    expect(st.guards.KRW.blocked).toBe(false);
    expect(st.todayPnl.KRW).toMatchObject({ pnl: 0, pct: 0 });
  });

  it("rests through the next trading day after a losing streak, says until when, then only warns (R030·R031·R074)", async () => {
    const { store, app, setNow } = setup({ maxConsecutiveLosses: 3 });
    store.state.journal.push(...autoLoss("000101", "2024-03-14"), ...autoLoss("000102", "2024-03-15"), ...autoLoss("000103", "2024-03-15"));
    // 금요일(03-15)에 세 번째 손실 → 월요일(03-18)까지 쉰다
    const mon = (await app.inject("/api/state")).json().guards.KRW;
    expect(mon).toMatchObject({ blocked: true, reasons: ["streak"], restUntil: "2024-03-18" });
    const info = mon.notes.find((n: { tone: string }) => n.tone === "info");
    expect(info.text).toBe("마지막 손실이 난 날(3.15(금))과 그다음 거래일(3.18(월))까지 쉬어요.");
    setNow(TUE_0700_KST);
    const tue = (await app.inject("/api/state")).json().guards.KRW;
    expect(tue.blocked).toBe(false);
    expect(tue.restUntil).toBeUndefined();
    expect(tue.notes).toEqual([expect.objectContaining({ tone: "warn", text: expect.stringContaining("규모를 줄이세요") })]);
  });
});

describe("guard alerts", () => {
  it("alerts when a stop-out between scans hits the daily limit, routed to 비중·한도", async () => {
    const { store, provider, deps } = setup({ dailyLossLimitPct: 4 });
    const acct = store.state.paper.KRW;
    acct.positions = [pos("000001", 10_000, 600, 10_000, 9_200)];
    acct.cash = 10_000_000 - 6_000_000;
    store.state.dayStart.KRW = { date: "2024-03-18", equity: 10_000_000 };
    provider.prices["000001"] = 9_000; // 손절가 아래 → 청산, 하루 손실 약 6%
    expect(await monitorPositions(deps)).toBe(1);
    const a = store.state.alerts.find((x) => x.key.startsWith("guard:KR:2024-03-18"));
    expect(a).toMatchObject({ category: "risk", route: "/trade/limits", key: "guard:KR:2024-03-18:dailyLoss" });
    expect(a!.text).toMatch(/^국내 신규 매수를 멈췄어요\. 오늘 손실이/);
    expect(store.state.paper.KRW.pricedAt).toBe(MON_1030_KST.toISOString());
  });
});

describe("journal check with the user's settings", () => {
  const buy = { code: "000001", side: "BUY", price: 10_000, qty: 400, date: "2024-03-18", stop: 9_800, reason: "돌파" };

  it("uses the saved weight cap instead of a fixed 30% (R044·R125)", async () => {
    const { app } = setup({ maxWeightPct: 50 });
    const r = (await app.inject({ method: "POST", url: "/api/journal/check", payload: { ...buy, target: 11_000, weightPct: 40 } })).json();
    expect(r.check.violations).toEqual([]);
    await app.inject({ method: "PUT", url: "/api/settings", payload: { maxWeightPct: 10 } });
    const strict = (await app.inject({ method: "POST", url: "/api/journal/check", payload: { ...buy, target: 11_000, weightPct: 20 } })).json();
    expect(strict.check.violations).toEqual([expect.stringContaining("10% 넘게")]);
  });

  it("treats a missing target as a warning, not a violation (R045)", async () => {
    const { app } = setup();
    const saved = (await app.inject({ method: "POST", url: "/api/journal", payload: { ...buy, qty: 10, weightPct: 1 } })).json();
    expect(saved.check.violations).toEqual([]);
    expect(saved.check.notes).toEqual([expect.objectContaining({ tone: "warn", text: expect.stringContaining("목표가") })]);
    expect(saved.entry.violations).toBeUndefined();
  });

  it("warns when the loss at the stop is over the user's per-trade risk", async () => {
    const { app } = setup({ riskPct: 1 });
    // 계좌 1,000만 원, 손절 시 200원 × 1,000주 = 20만 원(2%)
    const r = (await app.inject({ method: "POST", url: "/api/journal/check", payload: { ...buy, qty: 1_000, target: 11_000, weightPct: 10 } })).json();
    expect(r.check.violations).toEqual([]);
    expect(r.check.notes).toEqual([expect.objectContaining({ tone: "warn", text: expect.stringContaining("계좌의 2%") })]);
  });

  it("stores plannedAdd on a confirmed planned averaging-down buy only (R138), and exports the rule checks (R137)", async () => {
    const { app, store } = setup();
    const base = { ...buy, qty: 1, target: 11_000, weightPct: 5 };
    await app.inject({ method: "POST", url: "/api/journal", payload: { ...base, date: "2024-03-14" } });
    const planned = (
      await app.inject({ method: "POST", url: "/api/journal", payload: { ...base, price: 9_000, stop: 8_500, plannedAdd: true, selfCheck: { stopSet: true, weightOk: true, unplanned: false } } })
    ).json();
    expect(planned.entry.plannedAdd).toBe(true);
    const notLoss = (await app.inject({ method: "POST", url: "/api/journal", payload: { ...base, price: 12_000, stop: 11_000, target: 13_000, plannedAdd: true } })).json();
    expect(notLoss.entry.plannedAdd).toBeUndefined();

    const t = buildTables(store.state, { provider: "stub", sample: true, now: MON_1030_KST }).find((x) => x.name === "매매일지")!;
    const col = (h: string) => t.headers.indexOf(h);
    expect(["손절가 미리 정함", "비중 상한 지킴", "계획에 없던 매수", "계획한 분할 매수"].every((h) => col(h) >= 0)).toBe(true);
    const row = t.rows.find((r) => r[col("가격")] === 9_000)!;
    expect([row[col("손절가 미리 정함")], row[col("비중 상한 지킴")], row[col("계획에 없던 매수")], row[col("계획한 분할 매수")]]).toEqual(["예", "예", "아니요", "예"]);
    const first = t.rows.find((r) => r[col("가격")] === 10_000)!;
    expect(first[col("손절가 미리 정함")]).toBe("");
  });
});

describe("excel performance table", () => {
  it("shows the expectancy when every closed trade lost (R042), like the records screen", () => {
    const { store } = setup();
    store.state.journal = [...autoLoss("000001", "2024-03-12"), ...autoLoss("000002", "2024-03-13")];
    const t = buildTables(store.state, { provider: "stub", sample: true, now: MON_1030_KST }).find((x) => x.name === "성과")!;
    const krw = t.rows.find((r) => r[0] === "KRW")!;
    expect(krw[t.headers.indexOf("거래당 기대값(%)")]).toBeLessThan(0);
  });
});

describe("scheduler status", () => {
  it("reports no next automatic scan when the scheduler is off or every enabled market is closed (R015·R132)", async () => {
    const { scheduler, setNow } = setup();
    await scheduler.scanNow();
    expect(scheduler.status().nextScanAt).toBeNull(); // 자동 스캔이 꺼진 서버
    // @ts-expect-error private: 켠 것처럼
    scheduler.timer = 1 as unknown as NodeJS.Timeout;
    expect(scheduler.status().nextScanAt).toBe(new Date(MON_1030_KST.getTime() + 10 * 60_000).toISOString());
    setNow(new Date("2024-03-17T05:00:00Z")); // 일요일
    expect(scheduler.status().nextScanAt).toBeNull();
    // @ts-expect-error private
    scheduler.timer = null;
  });

  it("marks a failed scan attempt so the screen can stop waiting (R072)", async () => {
    const { scheduler, store } = setup();
    store.save = () => {
      throw new Error("EROFS: read-only file system");
    };
    expect(scheduler.status().lastAttemptAt).toBeNull();
    await scheduler.scanNow();
    const after = scheduler.status();
    expect(after.lastError).toContain("EROFS");
    expect(after.lastAttemptAt).toBe(MON_1030_KST.toISOString());
  });
});

describe("minute view after the close (R013)", () => {
  it("counts the elapsed session time only up to the close", async () => {
    const provider = new StubProvider();
    const at = new Date("2024-03-18T10:50:00Z"); // 19:50 KST
    const minute = new MockMinuteSource((c) => provider.getCandles(c, 5), () => at);
    const r = await minuteFor({ provider, minute }, "000001", at);
    expect(r.sessionDate).toBe("2024-03-18");
    expect(r.assessment!.minutesSinceOpen).toBe(390); // 09:00~15:30
  });
});

describe("stored alerts from earlier versions (R050·R116·R131)", () => {
  it("fixes the '(으)로' placeholder and the route of regime alerts when loading", () => {
    const old = { id: "1", at: "2024-03-18T00:00:00Z", category: "regime" as const, key: "regime:KOSDAQ:2024-03-18:NEUTRAL", route: "/", text: "코스닥 국면이 방어에서 중립(으)로 바뀌었어요. 주식 비중 상한 50%" };
    expect(migrateAlert(old)).toMatchObject({ text: "코스닥 국면이 방어에서 중립으로 바뀌었어요. 주식 비중 상한 50%", route: "/?view=regime&market=KOSDAQ" });
    expect(migrateAlert({ ...old, text: "코스피 국면이 공격에서 방어(으)로 바뀌었어요." }).text).toBe("코스피 국면이 공격에서 방어로 바뀌었어요.");
    const signal = { ...old, category: "signal" as const };
    expect(migrateAlert(signal)).toBe(signal);
    const guard = { ...old, category: "risk" as const, key: "guard:KRW:2024-03-18", route: "/trade", text: "오늘 손실 한도에 닿았어요." };
    expect(migrateAlert(guard).route).toBe("/trade/limits");
  });
});
