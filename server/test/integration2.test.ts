import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { IntradayBar } from "@jusik/shared";
import { buildApp } from "../src/app";
import { BreadthSource } from "../src/breadthSource";
import { SampleDart } from "../src/dart";
import { Exporter } from "../src/exporter";
import { MockExtras, MockMacro } from "../src/extras";
import { minuteDecision } from "../src/intradayCheck";
import { MockMinuteSource, type MinuteSource } from "../src/minute";
import { MockUsSource } from "../src/mockUs";
import { logBreadthToday, runScan, syncPaperWithDeposit } from "../src/scanner";
import { Scheduler } from "../src/scheduler";
import { sanitizeSettings, Store } from "../src/state";
import { buildTables } from "../src/tables";
import { mergeDartAnnual } from "../src/webProvider";
import { END, MON_1030_KST, StubProvider, tmp } from "./helpers";

const now = () => MON_1030_KST;

function setup(over: Record<string, unknown> = {}, minute: MinuteSource | null = null) {
  const dir = tmp();
  const store = new Store(join(dir, "state.json"));
  store.state.settings = sanitizeSettings({ minTradeValueKRW: 1, minTradeValueUSD: 1, paperEnabled: true, ...over }, store.state.settings);
  syncPaperWithDeposit(store, true);
  const provider = new StubProvider();
  const breadth = new BreadthSource(provider, null, { fallbackCodes: { KOSPI: ["000001", "000002", "000003"], US: ["AAPL"] }, now });
  const us = new MockUsSource(now);
  const extras = new MockExtras(now, undefined, { dart: new SampleDart(now), sec: us, usHolders: (c) => us.holders(c) });
  const deps = { provider, store, macro: new MockMacro(now), extras, breadth, minute: minute ?? new MockMinuteSource((c) => provider.getCandles(c, 5), now), now };
  const exporter = new Exporter({ excelPath: join(dir, "j.xlsx"), sheets: null, debounceMs: 1, build: () => buildTables(store.state, { provider: "stub", sample: true, now: now() }) });
  const app = buildApp({ ...deps, exporter, scheduler: new Scheduler(deps) });
  return { dir, store, provider, deps, app };
}

/** END 10:30 KST까지의 1분봉: 전일 종가 대비 +12% 갭으로 시작해 계속 밀리는 장(1분봉 20분선 지지 없음) */
function gapFadeBars(prevClose: number, date = END): IntradayBar[] {
  const out: IntradayBar[] = [];
  let px = prevClose * 1.12;
  for (let m = 0; m < 90; m++) {
    const h = 9 + Math.floor(m / 60), mm = m % 60;
    const open = px;
    px = px * 0.998;
    out.push({ t: `${date}T${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, open, high: open * 1.001, low: px * 0.999, close: px, volume: 1000 });
  }
  return out;
}

describe("market breadth and minute endpoints", () => {
  it("serves breadth for a market and logs nothing extra in sample mode", async () => {
    const { app } = setup({ paperEnabled: false });
    const r = (await app.inject("/api/breadth/KOSPI")).json();
    expect(r).toMatchObject({ market: "KOSPI", pending: false, sample: true });
    expect(r.basketSize).toBe(3);
    expect(r.analysis?.adLine.length).toBeGreaterThan(10);
    expect((await app.inject("/api/breadth/XX")).statusCode).toBe(400);
  });

  it("serves 1-minute bars with the intraday assessment", async () => {
    const { app } = setup({ paperEnabled: false });
    const r = (await app.inject("/api/stocks/000001/minute")).json();
    expect(r.sessionDate).toBe(END);
    expect(r.bars.length).toBeGreaterThan(30);
    expect(r.assessment?.entry.verdict).toMatch(/^(buy|wait|avoid)$/);
    expect(r.sample).toBe(true);
  });

  it("feeds breadth into the market posture during a scan", async () => {
    const { deps, store } = setup({ paperEnabled: false });
    const scan = await runScan(deps);
    expect(scan.breadth?.KOSPI).not.toBeUndefined();
    expect(scan.postures?.KOSPI?.breakdown).toHaveProperty("breadth");
    expect(scan.macroSummary?.ism?.value).toBeGreaterThan(0);
    // 샘플 모드에서도 거래소 전체 상승·하락 기록이 쌓인다(국내만)
    expect(Object.keys(store.state.breadthLog)).toEqual(expect.arrayContaining(["KOSPI"]));
  });
});

describe("minute check before paper entries (4.7·M3-18)", () => {
  it("skips a +12% gap that has not found 1-minute support, and records why", async () => {
    const fake: MinuteSource = {
      sample: true,
      async getMinuteBars() {
        const daily = await new StubProvider().getCandles("000001", 80);
        return gapFadeBars(daily.at(-2)!.close);
      },
    };
    const { deps, store } = setup({ minuteMode: "filter" }, fake);
    const scan = await runScan(deps);
    expect(scan.minuteSkips!.length).toBeGreaterThan(0);
    expect(scan.minuteSkips![0]).toMatchObject({ verdict: "wait" });
    expect(scan.minuteSkips![0]!.reason).toMatch(/갭|추격|시초가|저점/);
    expect(store.state.paper.KRW.positions).toHaveLength(0);

    const off = setup({ minuteMode: "off" }, fake);
    await runScan(off.deps);
    expect(off.store.state.paper.KRW.positions.length).toBeGreaterThan(0);
  });

  it("decides per mode", () => {
    const a = (verdict: "buy" | "wait" | "avoid", gapPct: number) => ({ entry: { verdict, notes: [{ tone: "warn" as const, text: "이유" }], splitPrices: [], stop: null }, gapPct }) as never;
    expect(minuteDecision("off", a("avoid", 20)).enter).toBe(true);
    expect(minuteDecision("filter", a("avoid", 0)).enter).toBe(false);
    expect(minuteDecision("filter", a("wait", 12)).enter).toBe(false);
    expect(minuteDecision("filter", a("wait", 1)).enter).toBe(true);
    expect(minuteDecision("strict", a("wait", 1)).enter).toBe(false);
    expect(minuteDecision("strict", a("buy", 1)).enter).toBe(true);
    expect(minuteDecision("filter", null).enter).toBe(true);
    expect(minuteDecision("strict", null).enter).toBe(false);
  });
});

describe("ISM manual value, DART and US extras", () => {
  it("stores a manual ISM value and uses it in the macro snapshot", async () => {
    const { app } = setup({ paperEnabled: false });
    const bad = (await app.inject({ method: "PUT", url: "/api/settings", payload: { ismManual: { value: 99, month: "2024-02" } } })).json();
    expect(bad.settings.ismManual).toBeNull();
    const ok = (await app.inject({ method: "PUT", url: "/api/settings", payload: { ismManual: { value: 47.8, month: "2024-02" }, minuteMode: "strict" } })).json();
    expect(ok.settings).toMatchObject({ ismManual: { value: 47.8, month: "2024-02" }, minuteMode: "strict" });
    const m = (await app.inject("/api/macro")).json();
    expect(m.snapshot.ism).toMatchObject({ value: 47.8, month: "2024-02", source: "수동" });
    expect(m.notes.KR.some((n: { text: string }) => n.text.includes("반도체"))).toBe(true);
    const cleared = (await app.inject({ method: "PUT", url: "/api/settings", payload: { ismManual: null } })).json();
    expect(cleared.settings.ismManual).toBeNull();
  });

  it("uses DART for Korean disclosures and SEC + holders for US stocks", async () => {
    const { app } = setup({ paperEnabled: false });
    const kr = (await app.inject("/api/stocks/005930/extras")).json();
    expect(kr.disclosureSource).toBe("DART");
    expect(Array.isArray(kr.reports)).toBe(true);
    const us = (await app.inject("/api/stocks/AAPL/extras")).json();
    expect(us).toMatchObject({ supported: true, region: "US", disclosureSource: "SEC" });
    expect(us.us.holders).toBeTruthy();
    expect(us.notes.length).toBeGreaterThan(0);
  });

  it("merges DART filing dates and older years into Naver annual figures", () => {
    const naver = { annual: [{ period: "2023.12", estimate: false, revenue: 100 }, { period: "2024.12(E)", estimate: true, revenue: 120 }], amountUnit: "억원" as const };
    const dart = [{ period: "2021.12", estimate: false, revenue: 80, filed: "2022-03-15" }, { period: "2023.12", estimate: false, revenue: 99, filed: "2024-03-12" }];
    const m = mergeDartAnnual(naver, dart, []);
    expect(m.annual!.map((p) => p.period)).toEqual(["2021.12", "2023.12", "2024.12(E)"]);
    expect(m.annual!.find((p) => p.period === "2023.12")).toMatchObject({ revenue: 100, filed: "2024-03-12" });
    expect(m.annual!.find((p) => p.estimate)!.filed).toBeUndefined();
  });

  it("exports the breadth log and the minute-check column", async () => {
    const { store, deps } = setup({ paperEnabled: false });
    await runScan(deps);
    const t = buildTables(store.state, { provider: "stub", sample: true, now: now() });
    expect(t.find((x) => x.name === "시장폭")!.rows.length).toBeGreaterThan(0);
    expect(t.find((x) => x.name === "추천(최신)")!.headers).toContain("분봉 확인(진입 보류)");
    expect(t.find((x) => x.name === "요약")!.rows.some((r) => r[0] === "ISM 제조업지수")).toBe(true);
  });
});

describe("round-2 review fixes", () => {
  it("only uses today's 1-minute session for the entry check (a previous session counts as no data)", async () => {
    const stale: MinuteSource = {
      sample: true,
      async getMinuteBars() {
        const daily = await new StubProvider().getCandles("000001", 80);
        return gapFadeBars(daily.at(-3)!.close, daily.at(-2)!.date); // 직전 거래일 분봉만 있다
      },
    };
    const filter = setup({ minuteMode: "filter" }, stale);
    const a = await runScan(filter.deps);
    expect(a.minuteSkips).toEqual([]);
    expect(filter.store.state.paper.KRW.positions.length).toBeGreaterThan(0);

    const strict = setup({ minuteMode: "strict" }, stale);
    const b = await runScan(strict.deps);
    expect(b.minuteSkips!.length).toBeGreaterThan(0);
    expect(b.minuteSkips![0]!.reason).toContain("분봉 자료가 없어");
  });

  it("logs exchange-wide breadth only when the basket's last day is the market date", () => {
    const { store } = setup({ paperEnabled: false });
    const today = { up: 500, upperLimit: 3, unchanged: 50, down: 300, lowerLimit: 1 };
    logBreadthToday(store, "KOSPI", "2024-03-18", { today, days: [{ date: "2024-03-15" }] as never });
    expect(store.state.breadthLog.KOSPI ?? []).toHaveLength(0);
    logBreadthToday(store, "KOSPI", "2024-03-18", { today, days: [{ date: "2024-03-18" }] as never });
    expect(store.state.breadthLog.KOSPI).toEqual([{ date: "2024-03-18", ...today }]);
  });

  it("uses the sample ISM when the manual value is too old, and says so", async () => {
    const r = await new MockMacro(now).getSnapshot({ ism: { value: 47, month: "2023-06" } });
    expect(r.snapshot.ism).toBeTruthy();
    expect(r.snapshot.ism!.source).not.toBe("수동");
    expect(r.errors.some((e) => e.includes("수동 입력(2023-06)") && e.includes("오래돼"))).toBe(true);
  });

  it("shows a missing SEC_USER_AGENT as an info note, not an error", async () => {
    const us = new MockUsSource(now);
    const extras = new MockExtras(now, undefined, { usHolders: (c) => us.holders(c) });
    const { store, provider } = setup({ paperEnabled: false });
    const deps = { provider, store, macro: new MockMacro(now), extras, now };
    const app = buildApp({ ...deps, exporter: new Exporter({ excelPath: join(tmp(), "j.xlsx"), sheets: null, debounceMs: 1, build: () => [] }), scheduler: new Scheduler(deps) });
    const r = (await app.inject("/api/stocks/AAPL/extras")).json();
    expect(r.errors).toEqual([]);
    expect(r.notes.some((n: { tone: string; text: string }) => n.tone === "info" && n.text.includes("SEC_USER_AGENT"))).toBe(true);
  });

  it("labels a manual ISM that the last scan could not use", async () => {
    const { store, deps } = setup({ paperEnabled: false });
    const ismRow = () => buildTables(store.state, { provider: "stub", sample: true, now: now() }).find((x) => x.name === "요약")!.rows.find((r) => r[0] === "ISM 제조업지수")![1];
    store.state.settings.ismManual = { value: 47, month: "2024-02" };
    expect(ismRow()).toContain("다음 스캔부터 적용");
    await runScan(deps);
    store.state.latestScan!.macroSummary!.ism = null;
    expect(ismRow()).toContain("미적용");
  });
});
