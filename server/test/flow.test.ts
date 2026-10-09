import { existsSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { Exporter } from "../src/exporter";
import { monitorPositions, runScan, syncPaperWithDeposit } from "../src/scanner";
import { evaluatePaper, runReplay } from "../src/evaluate";
import { Scheduler } from "../src/scheduler";
import { syncSheets } from "../src/sheets";
import { sanitizeSettings, Store } from "../src/state";
import { buildTables } from "../src/tables";
import { writeExcel } from "../src/excel";
import { MON_1030_KST, StubProvider, tmp } from "./helpers";

function setup(over: Record<string, unknown> = {}) {
  const dir = tmp();
  const store = new Store(join(dir, "state.json"));
  store.state.settings = sanitizeSettings({ minTradeValueKRW: 1, minTradeValueUSD: 1, paperEnabled: true, ...over }, store.state.settings);
  syncPaperWithDeposit(store, true);
  const provider = new StubProvider();
  let now = MON_1030_KST;
  const deps = { provider, store, now: () => now };
  return { dir, store, provider, deps, setNow: (d: Date) => (now = d) };
}

describe("scan → plan → paper trade → auto journal", () => {
  it("finds candidates, plans within cash, opens paper positions during the entry window, and journals", async () => {
    const { store, deps } = setup();
    const scan = await runScan(deps);

    expect(scan.errors).toEqual([]);
    expect(scan.markets).toEqual(["KOSPI", "KOSDAQ", "US"]);
    const codes = scan.candidates.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["000001", "000002", "AAPL"]));
    expect(codes).not.toContain("000003"); // 등락률 0.5% → 사전 필터 탈락
    expect(scan.rejected["사전 필터(가격·등락률·거래대금)"]).toBeGreaterThanOrEqual(1);
    expect(scan.regimes.KOSPI).toBe("BULL");

    // 예수금 기반 계획: 한국은 원화, 미국은 달러로 따로
    const krw = scan.plans.KRW!;
    expect(krw.items.length).toBeGreaterThan(0);
    expect(krw.used).toBeLessThanOrEqual(krw.spendable + 1e-6);
    expect(krw.items.every((i) => i.candidate.market !== "US")).toBe(true);
    expect(scan.plans.USD!.items.every((i) => i.candidate.code === "AAPL")).toBe(true);

    // 한국장은 열려 있으므로(월 10:30 KST) 모의 진입, 미국장은 닫혀 있어 진입 없음
    const krPos = store.state.paper.KRW.positions;
    expect(krPos.length).toBe(krw.items.length);
    expect(store.state.paper.USD.positions).toHaveLength(0);
    expect(scan.executed.sort()).toEqual(krPos.map((p) => p.code).sort());
    const buys = store.state.journal.filter((e) => e.side === "BUY");
    expect(buys).toHaveLength(krPos.length);
    expect(buys.every((e) => e.source === "자동(모의)" && e.reason.includes("단타 점수") && e.stop! > 0)).toBe(true);
    expect(store.state.paper.KRW.cash).toBeLessThan(10_000_000);
    expect(store.state.history.length).toBeGreaterThan(0);
  });

  it("does not open positions when paper trading is off, or outside the entry window", async () => {
    const off = setup({ paperEnabled: false });
    await runScan(off.deps);
    expect(off.store.state.paper.KRW.positions).toHaveLength(0);
    expect(off.store.state.journal).toHaveLength(0);

    const closed = setup();
    closed.setNow(new Date("2024-03-18T00:03:00Z")); // 09:03 KST, 진입 허용 시간 전
    await runScan(closed.deps);
    expect(closed.store.state.paper.KRW.positions).toHaveLength(0);
    closed.setNow(new Date("2024-03-17T01:30:00Z")); // 일요일
    await runScan(closed.deps);
    expect(closed.store.state.paper.KRW.positions).toHaveLength(0);
  });

  it("limits the plan to the cash set by the user", async () => {
    const small = setup({ depositKRW: 5_000, paperEnabled: false });
    const scan = await runScan(small.deps);
    expect(scan.plans.KRW!.items).toHaveLength(0);
    expect(scan.plans.KRW!.skipped.length).toBeGreaterThan(0);
    const mid = setup({ depositKRW: 3_000_000, reservePct: 0, maxWeightPct: 100, riskPct: 5, paperEnabled: false });
    const p = (await runScan(mid.deps)).plans.KRW!;
    expect(p.used).toBeLessThanOrEqual(3_000_000);
    expect(p.remainingCash).toBeCloseTo(3_000_000 - p.used);
  });

  it("monitor closes positions on stop/target and writes SELL entries with net P&L", async () => {
    const { store, provider, deps, setNow } = setup();
    await runScan(deps);
    const held = store.state.paper.KRW.positions.map((p) => ({ code: p.code, stop: p.stop, target: p.target }));
    expect(held.length).toBeGreaterThan(1);
    provider.prices[held[0]!.code] = held[0]!.stop - 1; // 손절
    provider.prices[held[1]!.code] = held[1]!.target + 1; // 목표
    setNow(new Date("2024-03-18T02:00:00Z"));
    const closed = await monitorPositions(deps);
    expect(closed).toBe(2);
    const sells = store.state.journal.filter((e) => e.side === "SELL");
    expect(sells.map((e) => e.reason.split("(")[0]).sort()).toEqual(["목표 도달", "손절"]);
    expect(sells.every((e) => /순손익/.test(e.review ?? ""))).toBe(true);
    const acct = store.state.paper.KRW;
    expect(acct.closed).toBe(2);
    expect(acct.wins).toBe(1);
    expect(acct.positions.length).toBe(held.length - 2);
  });

  it("monitor does nothing while the market is closed for that region", async () => {
    const { store, provider, deps, setNow } = setup();
    await runScan(deps);
    const p0 = store.state.paper.KRW.positions[0]!;
    provider.prices[p0.code] = 1;
    setNow(new Date("2024-03-18T09:00:00Z")); // 18:00 KST, 마감 30분 이후
    expect(await monitorPositions(deps)).toBe(0);
  });

  it("keeps working when one market's list fails and reports it", async () => {
    const { provider, deps } = setup();
    provider.failUniverse.add("US");
    const scan = await runScan(deps);
    expect(scan.errors.join()).toContain("US 후보 목록");
    expect(scan.candidates.some((c) => c.market === "KOSPI")).toBe(true);
  });

  it("rejects stale candle data", async () => {
    const { deps, setNow } = setup({ paperEnabled: false });
    setNow(new Date("2024-04-30T01:30:00Z"));
    const scan = await runScan(deps);
    expect(scan.candidates).toHaveLength(0);
    expect(scan.rejected["오래된 데이터"]).toBeGreaterThan(0);
  });

  it("persists state to disk and reloads it", async () => {
    const { dir, store, deps } = setup();
    await runScan(deps);
    const again = new Store(join(dir, "state.json"));
    expect(again.state.journal.length).toBe(store.state.journal.length);
    expect(again.state.paper.KRW.positions.length).toBe(store.state.paper.KRW.positions.length);
    expect(again.state.settings.paperEnabled).toBe(true);
  });
});

describe("settings", () => {
  it("clamps out-of-range values and ignores junk", () => {
    const s = sanitizeSettings({ riskPct: 99, maxPositions: 0, depositKRW: -5, scanIntervalMin: "abc", paperEnabled: "yes", markets: { US: false, FOO: true }, evil: 1 });
    expect(s.riskPct).toBe(10);
    expect(s.maxPositions).toBe(1);
    expect(s.depositKRW).toBe(0);
    expect(s.scanIntervalMin).toBe(10);
    expect(s.paperEnabled).toBe(false);
    expect(s.markets).toEqual({ KOSPI: true, KOSDAQ: true, US: false });
    expect((s as unknown as Record<string, unknown>).evil).toBeUndefined();
  });
  it("backs up a corrupt state file instead of overwriting it", () => {
    const dir = tmp();
    require("node:fs").writeFileSync(join(dir, "state.json"), "{not json");
    const store = new Store(join(dir, "state.json"));
    expect(store.state.journal).toEqual([]);
    expect(require("node:fs").readdirSync(dir).some((f: string) => f.includes("corrupt"))).toBe(true);
  });
});

describe("export", () => {
  it("writes an Excel workbook with every tab and the right rows", async () => {
    const { dir, store, deps } = setup();
    await runScan(deps);
    const tables = buildTables(store.state, { provider: "stub", sample: true, now: MON_1030_KST });
    const file = join(dir, "out", "jusik.xlsx");
    await writeExcel(tables, file);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["요약", "추천(최신)", "추천이력", "모의포지션", "매매일지", "성과", "규칙점검"]);
    const rec = wb.getWorksheet("추천(최신)")!;
    expect(rec.rowCount).toBe(1 + store.state.latestScan!.candidates.length);
    expect(rec.getRow(1).getCell(4).value).toBe("종목명");
    expect(typeof rec.getRow(2).getCell(6).value).toBe("number"); // 현재가는 숫자로 저장
    expect(wb.getWorksheet("모의포지션")!.rowCount).toBe(1 + store.state.paper.KRW.positions.length);
    expect(wb.getWorksheet("매매일지")!.rowCount).toBe(1 + store.state.journal.length);
    expect(wb.getWorksheet("요약")!.getRow(3).getCell(2).value).toContain("샘플 데이터");
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("exporter writes Excel first and still reports Sheets failure separately", async () => {
    const { dir, store } = setup();
    const excelPath = join(dir, "x.xlsx");
    const ex = new Exporter({
      excelPath, debounceMs: 1,
      build: () => buildTables(store.state, { provider: "stub", sample: true, now: new Date() }),
      sheets: { spreadsheetId: "S", getToken: async () => "T", fetchImpl: async () => new Response(JSON.stringify({ error: { message: "The caller does not have permission" } }), { status: 403 }) },
    });
    await ex.flush();
    expect(ex.status.excel.ok).toBe(true);
    expect(existsSync(excelPath)).toBe(true);
    expect(ex.status.sheets).toMatchObject({ configured: true, ok: false });
    expect(ex.status.sheets.error).toContain("permission");
  });

  it("exporter reports an Excel failure (e.g. file open) without throwing", async () => {
    const { dir, store } = setup();
    const ex = new Exporter({ excelPath: join(dir, "is-a-dir.xlsx", "x.xlsx"), sheets: null, debounceMs: 1, build: () => buildTables(store.state, { provider: "s", sample: false, now: new Date() }) });
    require("node:fs").writeFileSync(join(dir, "is-a-dir.xlsx"), "a file where a folder is needed");
    await ex.flush();
    expect(ex.status.excel.ok).toBe(false);
    expect(ex.status.excel.error).toBeTruthy();
  });

  it("syncs Google Sheets: creates missing tabs, clears, and writes RAW values", async () => {
    const { store, deps } = setup();
    await runScan(deps);
    const tables = buildTables(store.state, { provider: "stub", sample: true, now: MON_1030_KST });
    const calls: { url: string; method: string; body?: any }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer TOKEN");
      if (url.includes("fields=sheets.properties.title")) return new Response(JSON.stringify({ sheets: [{ properties: { title: "요약" } }, { properties: { title: "Sheet1" } }] }));
      return new Response("{}");
    }) as typeof fetch;
    const r = await syncSheets(tables, { spreadsheetId: "SID", getToken: async () => "TOKEN", fetchImpl });
    const add = calls.find((c) => c.url.endsWith(":batchUpdate"))!;
    expect(add.body.requests.map((x: any) => x.addSheet.properties.title)).toEqual(["추천(최신)", "추천이력", "모의포지션", "매매일지", "성과", "규칙점검"]);
    expect(calls.filter((c) => c.url.includes(":clear"))).toHaveLength(tables.length);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(tables.length);
    expect(puts.every((p) => p.url.includes("valueInputOption=RAW"))).toBe(true);
    expect(puts[1]!.body.values[0]).toEqual(tables[1]!.headers);
    expect(r.rows).toBe(tables.reduce((a, t) => a + t.rows.length + 1, 0));
  });
});

describe("HTTP API", () => {
  function api() {
    const s = setup({ paperEnabled: false });
    const exporter = new Exporter({ excelPath: join(s.dir, "jusik.xlsx"), sheets: null, debounceMs: 1, build: () => buildTables(s.store.state, { provider: "stub", sample: true, now: new Date() }) });
    const scheduler = new Scheduler(s.deps, () => exporter.request());
    return { ...s, exporter, scheduler, app: buildApp({ provider: s.provider, store: s.store, exporter, scheduler }) };
  }

  it("serves state, updates settings with clamping, and syncs the paper account to the deposit", async () => {
    const { app, store } = api();
    let st = (await app.inject("/api/state")).json();
    expect(st.status.provider).toBe("stub");
    expect(st.settings.depositKRW).toBe(10_000_000);
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: { depositKRW: 5_000_000, riskPct: 50 } });
    expect(put.json().settings).toMatchObject({ depositKRW: 5_000_000, riskPct: 10 });
    expect(store.state.paper.KRW.cash).toBe(5_000_000);
    st = (await app.inject("/api/state")).json();
    expect(st.paper.KRW.cash).toBe(5_000_000);
  });

  it("runs a scan in the background and rejects a second concurrent one", async () => {
    const { app, scheduler, provider } = api();
    let release!: () => void;
    provider.gate = new Promise<void>((r) => (release = r)); // 첫 스캔을 붙잡아 둔다
    const a = await app.inject({ method: "POST", url: "/api/scan" });
    const b = await app.inject({ method: "POST", url: "/api/scan" });
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(409);
    expect(scheduler.status().scanning).toBe(true);
    release();
    for (let i = 0; i < 100 && scheduler.status().scanning; i++) await new Promise((r) => setTimeout(r, 20));
    const st = (await app.inject("/api/state")).json();
    expect(st.latestScan.candidates.length).toBeGreaterThan(0);
    expect(st.status.scheduler.lastScanAt).toBeTruthy();
  });

  it("journal CRUD with validation, US tickers, and name lookup", async () => {
    const { app } = api();
    const bad = await app.inject({ method: "POST", url: "/api/journal", payload: { code: "zz!", side: "BUY", price: 1, qty: 1, date: "2024-01-01" } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/journal", payload: { code: "AAPL", side: "BUY", price: -1, qty: 1, date: "2024-01-01" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/journal", payload: { code: "AAPL", side: "BUY", price: 10, qty: 1.5, date: "2024-01-01" } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/api/journal", payload: { code: "aapl", side: "BUY", price: 190.5, qty: 3, date: "2024-03-18", reason: "테스트", stop: 185 } });
    expect(ok.statusCode).toBe(201);
    const e = ok.json().entry;
    expect(e).toMatchObject({ code: "AAPL", name: "Apple", source: "수동", stop: 185 });
    expect((await app.inject("/api/journal")).json().entries).toHaveLength(1);
    expect((await app.inject({ method: "DELETE", url: `/api/journal/${e.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/journal/${e.id}` })).statusCode).toBe(404);
  });

  it("downloads the Excel file", async () => {
    const { app } = api();
    await app.inject({ method: "POST", url: "/api/journal", payload: { code: "005930", side: "BUY", price: 70000, qty: 1, date: "2024-03-18" } });
    const res = await app.inject("/api/export/excel");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });

  it("validates stock codes (domestic digits or US tickers) and index markets", async () => {
    const { app } = api();
    expect((await app.inject("/api/stocks/12345/candles")).statusCode).toBe(400);
    expect((await app.inject("/api/stocks/000001/candles?count=60")).json().candles).toHaveLength(60);
    expect((await app.inject("/api/stocks/aapl/candles?count=60")).statusCode).toBe(200);
    expect((await app.inject("/api/index/US/candles?count=100")).json().candles).toHaveLength(100);
    expect((await app.inject("/api/index/NASDAQ/candles")).statusCode).toBe(400);
  });

  it("only allows local origins for CORS", async () => {
    const { app } = api();
    const ok = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "http://localhost:5173" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const evil = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://evil.example" } });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("Scheduler", () => {
  it("scans on the interval only while some enabled market is open, and monitors positions in between", async () => {
    const { deps, setNow, store, provider } = setup();
    const sch = new Scheduler(deps);
    // 한국장 열림 → 첫 tick에서 스캔
    // @ts-expect-error private
    await sch.tick();
    expect(provider.universeCalls).toBe(3);
    const calls = provider.universeCalls;
    // 같은 시각(간격 미경과) → 재스캔하지 않음
    // @ts-expect-error private
    await sch.tick();
    expect(provider.universeCalls).toBe(calls);
    // 간격(10분) 경과 → 재스캔
    setNow(new Date(MON_1030_KST.getTime() + 11 * 60_000));
    // @ts-expect-error private
    await sch.tick();
    expect(provider.universeCalls).toBe(calls + 3);
    // 주말(양쪽 휴장) → 스캔하지 않음
    setNow(new Date("2024-03-17T05:00:00Z"));
    // @ts-expect-error private
    await sch.tick();
    expect(provider.universeCalls).toBe(calls + 3);
    expect(sch.status().marketOpen).toEqual({ KR: false, US: false });
    expect(store.state.latestScan).not.toBeNull();
  });
});

describe("rule check (2단계)", () => {
  it("auto paper buys carry signal features, and closed paper trades feed the evaluation", async () => {
    const { store, provider, deps, setNow } = setup();
    await runScan(deps);
    const buy = store.state.journal.find((e) => e.side === "BUY")!;
    expect(buy.meta).toMatchObject({ market: "KOSPI", regime: "BULL" });
    expect(buy.meta!.score).toBeGreaterThanOrEqual(55);
    const pos = store.state.paper.KRW.positions[0]!;
    provider.prices[pos.code] = pos.target + 1;
    setNow(new Date("2024-03-18T02:00:00Z"));
    await monitorPositions(deps);
    const r = evaluatePaper({ store });
    expect(r.tradeCount).toBe(1);
    expect(r.evaluation.overall.n).toBe(1);
    expect(r.evaluation.overall.expectancyPct!).toBeGreaterThan(0);
    expect(r.evaluation.suggestion.minScore).toBeNull(); // 1건으로는 제안하지 않는다
  });

  it("replays the rules over past candles per market, stores the run, and reports errors per stock", async () => {
    const { store, provider, deps } = setup();
    const orig = provider.getCandles.bind(provider);
    provider.getCandles = async (code: string, count: number) => {
      if (code === "005930") throw new Error("차단됨");
      // 돌파 후 다음 날부터 상승 → 목표 도달
      const cs = await orig(code, count);
      const last = cs[cs.length - 1]!;
      const ext = [1.0, 1.04, 1.09, 1.1].map((m, k) => ({ ...last, date: `2024-03-${String(19 + k).padStart(2, "0")}`, open: last.close * (k ? m - 0.02 : 1), high: last.close * m * 1.002, low: last.close * (k ? m - 0.03 : 0.999), close: last.close * m, volume: 1500 }));
      return [...cs, ...ext];
    };
    const run = await runReplay(deps, { markets: ["KOSPI"] });
    expect(run.markets).toEqual(["KOSPI"]);
    expect(run.codesTested).toBeGreaterThan(10);
    expect(run.tradeCount).toBeGreaterThan(0);
    expect(run.errors.join()).toContain("005930");
    expect(run.evaluation.overall.n).toBe(run.tradeCount);
    expect(store.state.lastReplay?.at).toBe(run.at);
    const tables = buildTables(store.state, { provider: "stub", sample: true, now: new Date() });
    const rc = tables.find((t) => t.name === "규칙점검")!;
    expect(rc.rows.some((r) => String(r[0]).startsWith("과거 재현"))).toBe(true);
    expect(rc.rows.some((r) => r[1] === "제안")).toBe(true);
  });

  it("serves evaluation endpoints and blocks concurrent replays", async () => {
    const s = setup({ paperEnabled: false });
    const exporter = new Exporter({ excelPath: join(s.dir, "j.xlsx"), sheets: null, debounceMs: 1, build: () => buildTables(s.store.state, { provider: "stub", sample: true, now: new Date() }) });
    const app = buildApp({ provider: s.provider, store: s.store, exporter, scheduler: new Scheduler(s.deps) });
    expect((await app.inject("/api/evaluate/paper")).json()).toMatchObject({ tradeCount: 0 });
    let release!: () => void;
    s.provider.gate = new Promise<void>((r) => (release = r));
    const orig = s.provider.getIndexCandles.bind(s.provider);
    s.provider.getIndexCandles = async (m, c) => { await s.provider.gate; return orig(m, c); };
    const first = app.inject({ method: "POST", url: "/api/evaluate/replay", payload: { markets: ["US"] } });
    await new Promise((r) => setTimeout(r, 10));
    expect((await app.inject({ method: "POST", url: "/api/evaluate/replay", payload: {} })).statusCode).toBe(409);
    release();
    const done = (await first).json();
    expect(done.run.markets).toEqual(["US"]);
    expect((await app.inject("/api/evaluate/replay")).json().run.at).toBe(done.run.at);
  });
});
