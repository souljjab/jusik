import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { disclosureAlerts, positionAlerts, pushAlert, scanAlerts } from "../src/alerts";
import { Exporter } from "../src/exporter";
import { MockMacro } from "../src/extras";
import { runScan, syncPaperWithDeposit } from "../src/scanner";
import { Scheduler } from "../src/scheduler";
import { ALERT_LIMIT, sanitizeSettings, Store } from "../src/state";
import { MON_1030_KST, StubProvider, tmp } from "./helpers";

const now = () => MON_1030_KST;

function setup(over: Record<string, unknown> = {}) {
  const dir = tmp();
  const store = new Store(join(dir, "state.json"));
  store.state.settings = sanitizeSettings({ minTradeValueKRW: 1, minTradeValueUSD: 1, paperEnabled: false, ...over }, store.state.settings);
  syncPaperWithDeposit(store, true);
  const provider = new StubProvider();
  const deps = { provider, store, macro: new MockMacro(now), now };
  const app = buildApp({ ...deps, exporter: new Exporter({ excelPath: join(dir, "j.xlsx"), sheets: null, debounceMs: 1, build: () => [] }), scheduler: new Scheduler(deps) });
  return { store, deps, app };
}

const pos = (code: string, lastPrice: number, stop: number) => ({
  code, name: `종목${code}`, openedAt: MON_1030_KST.toISOString(), entryDate: "2024-03-18", entryPrice: 100, qty: 1, stop, target: 120, maxHoldDays: 3, cost: 100, lastPrice, reason: "",
});

describe("alerts", () => {
  it("records signal alerts once per stock per day and serves them newest first", async () => {
    const { store, deps, app } = setup();
    const scan = await runScan(deps);
    const signals = store.state.alerts.filter((a) => a.category === "signal");
    expect(signals.length).toBe(Math.min(5, scan.candidates.length));
    expect(signals[0]!.text).toMatch(/근거 6개 중 \d개 충족/);
    expect(signals[0]!.route).toBe(`/stocks/${scan.candidates[0]!.code}`);
    // 같은 날 다시 스캔해도 같은 신호 알림은 늘지 않는다
    await runScan(deps);
    expect(store.state.alerts.filter((a) => a.category === "signal")).toHaveLength(signals.length);
    const r = (await app.inject("/api/alerts")).json();
    expect(r.alerts[0].at >= r.alerts.at(-1).at).toBe(true);
  });

  it("reports a regime change between scans with the new exposure cap", async () => {
    const { store, deps } = setup();
    const scan = await runScan(deps);
    const m = scan.markets.find((x) => scan.postures?.[x])!;
    const prev = structuredClone(scan);
    prev.postures![m] = { ...prev.postures![m]!, posture: scan.postures![m]!.posture === "ATTACK" ? "DEFENSE" : "ATTACK" };
    expect(scanAlerts(store, prev, scan, MON_1030_KST)).toBeGreaterThan(0);
    const a = store.state.alerts.find((x) => x.category === "regime")!;
    expect(a.text).toMatch(/국면이 .+에서 .+(으)?로 바뀌었어요\. 주식 비중 상한 \d+%/);
  });

  it("warns when a paper position is within 2% of its stop", () => {
    const { store } = setup();
    store.state.paper.KRW.positions = [pos("000001", 101.5, 100), pos("000002", 110, 100), pos("000003", 99, 100)];
    expect(positionAlerts(store, MON_1030_KST)).toBe(1);
    expect(store.state.alerts[0]).toMatchObject({ category: "risk", code: "000001", text: "종목000001 손절가까지 1.5% 남았어요" });
    expect(positionAlerts(store, MON_1030_KST)).toBe(0);
  });

  it("adds today's disclosures of held stocks and caps the log", async () => {
    const { store } = setup();
    store.state.paper.KRW.positions = [pos("000001", 110, 100)];
    const n = await disclosureAlerts(store, MON_1030_KST, async () => [{ date: "2024-03-18", title: "단일판매ㆍ공급계약체결" }, { date: "2024-03-15", title: "지난 공시" }]);
    expect(n).toBe(1);
    expect(store.state.alerts[0]).toMatchObject({ category: "disclosure", text: "종목000001 단일판매ㆍ공급계약체결" });
    for (let i = 0; i < ALERT_LIMIT + 10; i++) pushAlert(store, { at: "2024-03-18T00:00:00Z", category: "signal", text: String(i), key: `k${i}` });
    expect(store.state.alerts).toHaveLength(ALERT_LIMIT);
  });
});

describe("journal check and self check", () => {
  it("previews the pre-trade checks without saving", async () => {
    const { app, store } = setup();
    const r = await app.inject({ method: "POST", url: "/api/journal/check", payload: { code: "000001", side: "BUY", price: 100, qty: 1, date: "2024-03-18" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().check.violations.length).toBeGreaterThan(0); // 손절가가 없다
    expect(store.state.journal).toHaveLength(0);
    expect((await app.inject({ method: "POST", url: "/api/journal/check", payload: { code: "000001", side: "HOLD", price: 1, qty: 1, date: "2024-03-18" } })).statusCode).toBe(400);
  });

  it("downgrades a planned averaging-down buy and stores the self check", async () => {
    const { app } = setup();
    const base = { code: "000001", side: "BUY", qty: 1, stop: 80, target: 130, reason: "계획", weightPct: 5 };
    await app.inject({ method: "POST", url: "/api/journal", payload: { ...base, price: 100, date: "2024-03-14" } });
    const unplanned = (await app.inject({ method: "POST", url: "/api/journal/check", payload: { ...base, price: 90, date: "2024-03-15" } })).json();
    expect(unplanned.check.notes.some((n: { text: string }) => n.text.includes("손실 중 추가 매수"))).toBe(true);
    const planned = (await app.inject({ method: "POST", url: "/api/journal/check", payload: { ...base, price: 90, date: "2024-03-15", plannedAdd: true } })).json();
    expect(planned.check.notes.some((n: { tone: string; text: string }) => n.tone === "info" && n.text.includes("계획한 분할 매수"))).toBe(true);

    const saved = (await app.inject({ method: "POST", url: "/api/journal", payload: { ...base, price: 101, date: "2024-03-18", selfCheck: { stopSet: true, weightOk: true, unplanned: false } } })).json();
    expect(saved.entry.selfCheck).toEqual({ stopSet: true, weightOk: true, unplanned: false });
    const patched = (await app.inject({ method: "PATCH", url: `/api/journal/${saved.entry.id}`, payload: { selfCheck: { stopSet: true, weightOk: false, unplanned: false } } })).json();
    expect(patched.entry.selfCheck.weightOk).toBe(false);
    const cleared = (await app.inject({ method: "PATCH", url: `/api/journal/${saved.entry.id}`, payload: { selfCheck: null } })).json();
    expect(cleared.entry.selfCheck).toBeUndefined();
  });
});
