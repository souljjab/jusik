import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { Exporter } from "../src/exporter";
import { MockExtras, MockMacro, type MacroSource } from "../src/extras";
import { buildReviewNow } from "../src/reviewJob";
import { exposureCapFor, runScan, syncPaperWithDeposit } from "../src/scanner";
import { Scheduler } from "../src/scheduler";
import { sanitizeSettings, Store } from "../src/state";
import { buildTables } from "../src/tables";
import { END, MON_1030_KST, StubProvider, tmp } from "./helpers";
import { todayPnl, type Candle, type JournalEntry, type MacroSnapshot } from "@jusik/shared";

const DAY = 86_400_000;

/** 30주선 아래로 꾸준히 내려가는 지수(약세 국면) */
function downtrend(end: string, n = 300): Candle[] {
  const dates: string[] = [];
  for (let t = Date.parse(end); dates.length < n; t -= DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) dates.unshift(new Date(t).toISOString().slice(0, 10));
  }
  return dates.map((date, i) => {
    const close = 1000 * 0.9985 ** i * (1 + 0.003 * Math.sin(i / 4));
    return { date, open: close, high: close * 1.004, low: close * 0.996, close, volume: 1e6 };
  });
}

function setup(over: Record<string, unknown> = {}, macro: MacroSource | null = null) {
  const dir = tmp();
  const store = new Store(join(dir, "state.json"));
  store.state.settings = sanitizeSettings({ minTradeValueKRW: 1, minTradeValueUSD: 1, paperEnabled: true, ...over }, store.state.settings);
  syncPaperWithDeposit(store, true);
  const provider = new StubProvider();
  let now = MON_1030_KST;
  const deps = { provider, store, macro, extras: new MockExtras(() => now), now: () => now };
  return { dir, store, provider, deps, setNow: (d: Date) => (now = d) };
}

function api(over: Record<string, unknown> = {}) {
  const s = setup({ paperEnabled: false, ...over });
  const exporter = new Exporter({ excelPath: join(s.dir, "jusik.xlsx"), sheets: null, debounceMs: 1, build: () => buildTables(s.store.state, { provider: "stub", sample: true, now: new Date() }) });
  const scheduler = new Scheduler(s.deps, () => exporter.request());
  const app = buildApp({ provider: s.provider, store: s.store, exporter, scheduler, macro: new MockMacro(), extras: new MockExtras(() => MON_1030_KST), now: () => MON_1030_KST });
  return { ...s, exporter, scheduler, app };
}

/** 그날 자동(모의) 청산 기록 — paperCheckExits와 같은 복기 형식 */
function autoTrade(code: string, buyDate: string, sellDate: string, pnl: number, pct: number): JournalEntry[] {
  const meta = { score: 60, volumeRatio: 3, changePct: 5, stopPct: 3, market: "KOSPI", regime: "BULL" };
  return [
    { id: `${code}-b-${buyDate}`, code, name: code, date: buyDate, side: "BUY", price: 10_000, qty: 10, stop: 9_700, reason: "단타", source: "자동(모의)", meta },
    { id: `${code}-s-${sellDate}`, code, name: code, date: sellDate, side: "SELL", price: 9_700, qty: 10, reason: "손절(9700)", review: `수수료·세금·슬리피지 반영 순손익 ${pnl} (${pct.toFixed(2)}%)`, source: "자동(모의)" },
  ];
}

describe("regime posture → exposure cap", () => {
  it("stores a posture per market and keeps total exposure under the cap", async () => {
    const { deps, store } = setup({ reservePct: 0, maxWeightPct: 100, riskPct: 10, maxPositions: 10 });
    const scan = await runScan(deps);
    expect(scan.postures?.KOSPI?.posture).toBeDefined();
    const cap = scan.exposureCaps!.KRW!;
    expect(cap).toBe(exposureCapFor(store.state.settings, scan, "KR"));
    const p = scan.plans.KRW!;
    // 계획 시점(진입 전)에는 보유가 없으므로 예수금 × 상한까지만
    expect(p.used).toBeLessThanOrEqual((10_000_000 * cap) / 100 + 1e-6);
  });

  it("cuts new buys to the defense cap when the index is in a downtrend", async () => {
    const { deps, provider } = setup({ reservePct: 0, maxWeightPct: 100, riskPct: 10, maxPositions: 10, postureCaps: { ATTACK: 80, NEUTRAL: 50, DEFENSE: 5 } });
    provider.getIndexCandles = async (_m, count) => downtrend(END).slice(-count);
    const scan = await runScan(deps);
    expect(scan.postures?.KOSPI?.posture).toBe("DEFENSE");
    expect(scan.exposureCaps?.KRW).toBe(5);
    expect(scan.plans.KRW!.used).toBeLessThanOrEqual(500_000 + 1e-6);
  });

  it("treats an unknown regime as neutral rather than attack", async () => {
    const { deps, provider } = setup({ paperEnabled: false });
    provider.getIndexCandles = async () => {
      throw new Error("지수 차단");
    };
    const scan = await runScan(deps);
    expect(scan.postures?.KOSPI).toBeNull();
    expect(scan.exposureCaps?.KRW).toBe(50);
  });

  it("passes the macro snapshot into the posture and records its date", async () => {
    const macro: MacroSource = {
      sample: true,
      getSnapshot: async () => ({
        snapshot: { asOf: "2024-03-15", yieldSpread: { value: -0.5, date: "2024-03-15" }, vix: { value: 35, date: "2024-03-15" } } as MacroSnapshot,
        errors: ["GDP: 차단"], fetchedAt: "2024-03-18T00:00:00Z",
      }),
    };
    const { deps } = setup({ paperEnabled: false }, macro);
    const scan = await runScan(deps);
    expect(scan.macroAsOf).toBe("2024-03-15");
    expect(scan.postures?.KOSPI?.breakdown.macro).toBeLessThan(0);
    expect(scan.errors.join()).toContain("매크로(FRED) 1개 시리즈 실패");
  });
});

describe("risk guards", () => {
  it("blocks automatic entries after hitting the daily loss limit", async () => {
    const { deps, store } = setup({ dailyLossLimitPct: 2 });
    // 하루 시작 자산 1,030만 원 → 오늘 손절로 30만 원 잃어 지금 1,000만 원(−2.9%)
    store.state.dayStart.KRW = { date: END, equity: 10_300_000 };
    store.state.journal.push(...autoTrade("000009", "2024-03-15", END, -300_000, -3));
    const scan = await runScan(deps);
    expect(scan.guards?.KRW?.blocked).toBe(true);
    expect(scan.guards?.KRW?.notes.some((n) => n.rule === "M4-04 슈웨거")).toBe(true);
    expect(store.state.paper.KRW.positions).toHaveLength(0);
    expect(scan.executed).toHaveLength(0);
    // 계획은 참고용으로 남는다
    expect(scan.plans.KRW!.items.length).toBeGreaterThan(0);
  });

  it("rests on the day of the N-th straight loss and the next trading day, then only warns", async () => {
    const losses = (date: string) => [1, 2, 3].flatMap((k) => autoTrade(`00010${k}`, "2024-03-13", date, -1_000, -1));
    const today = setup();
    today.store.state.journal.push(...losses(END));
    expect((await runScan(today.deps)).guards?.KRW?.blocked).toBe(true);

    // 금요일 마감 무렵 시간 청산으로 채워진 연속 손실 → 월요일(다음 거래일)도 쉰다
    const nextDay = setup();
    nextDay.store.state.journal.push(...losses("2024-03-15"));
    const rest = await runScan(nextDay.deps);
    expect(rest.guards?.KRW?.blocked).toBe(true);
    expect(nextDay.store.state.paper.KRW.positions).toHaveLength(0);

    const later = setup();
    later.store.state.journal.push(...losses("2024-03-14"));
    const scan = await runScan(later.deps);
    expect(scan.guards?.KRW?.blocked).toBe(false);
    expect(scan.guards?.KRW?.notes.some((n) => n.text.includes("규모를 줄이세요"))).toBe(true);
    expect(later.store.state.paper.KRW.positions.length).toBeGreaterThan(0);
  });

  it("measures today's loss from the day-start equity so earlier gains cannot hide it", async () => {
    const { deps, store } = setup({ dailyLossLimitPct: 3 });
    const acct = store.state.paper.KRW;
    // 전날까지 +70만 원 평가이익인 보유 종목(최근가 10,700)
    acct.positions.push({ code: "000077", name: "보유", openedAt: "2024-03-14T01:00:00Z", entryDate: "2024-03-14", entryPrice: 10_000, qty: 1_000, stop: 9_000, target: 12_000, maxHoldDays: 5, cost: 10_001_500, lastPrice: 10_700, reason: "x" });
    acct.cash = 9_000_000 - 10_001_500 + 10_000_000;
    // 오늘 첫 점검 전 자산을 하루 시작 자산으로 남긴 뒤, 오늘 30만 원씩 두 번 손절
    store.state.dayStart.KRW = { date: END, equity: 10_000_000 + 9_000_000 - 10_001_500 + 10_700_000 };
    store.state.journal.push(...autoTrade("000081", "2024-03-15", END, -300_000, -3), ...autoTrade("000082", "2024-03-15", END, -300_000, -3));
    acct.cash -= 600_000;
    const scan = await runScan(deps);
    // 하루 시작 대비 −60만 원 ≈ −3.1% → 한도 3%에 걸린다(평가이익 70만 원으로 상쇄되면 안 된다)
    expect(scan.guards?.KRW?.blocked).toBe(true);
    expect(scan.executed).toHaveLength(0);
  });

  it("re-anchors the day-start equity when the paper account is reset", () => {
    const { store } = setup();
    store.state.dayStart.KRW = { date: END, equity: 1 };
    syncPaperWithDeposit(store, true);
    expect(store.state.dayStart.KRW).toBeUndefined();
  });

  it("records the account weight on automatic buys", async () => {
    const { deps, store } = setup();
    await runScan(deps);
    const buys = store.state.journal.filter((e) => e.side === "BUY");
    expect(buys.length).toBeGreaterThan(0);
    expect(buys.every((e) => e.weightPct != null && e.weightPct > 0 && e.weightPct <= 100)).toBe(true);
  });
});

describe("HTTP API — new endpoints", () => {
  it("serves macro notes per region and the stock extras", async () => {
    const { app } = api();
    const m = (await app.inject("/api/macro")).json();
    expect(m.snapshot.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.sample).toBe(true);
    expect(Array.isArray(m.notes.KR) && Array.isArray(m.notes.US)).toBe(true);

    const kr = (await app.inject("/api/stocks/005930/extras")).json();
    expect(kr.supported).toBe(true);
    expect(kr.flows.length).toBeGreaterThan(10);
    expect(kr.sector?.name).toBeTruthy();
    expect(kr.notes.length).toBeGreaterThan(0);
    const us = (await app.inject("/api/stocks/aapl/extras")).json();
    expect(us).toMatchObject({ code: "AAPL", supported: false, flows: [], notes: [] });
    expect((await app.inject("/api/stocks/x!/extras")).statusCode).toBe(400);
  });

  it("checks manual buys (stop/target/reason, averaging down) and stores the new fields", async () => {
    const { app, store } = api();
    const bare = await app.inject({ method: "POST", url: "/api/journal", payload: { code: "000001", side: "BUY", price: 10_000, qty: 1, date: "2024-03-11" } });
    expect(bare.statusCode).toBe(201);
    const b = bare.json();
    expect(b.check.violations.length).toBeGreaterThanOrEqual(3); // 손절가·목표가·근거
    expect(b.entry.violations).toEqual(b.check.violations);

    const ok = (
      await app.inject({
        method: "POST", url: "/api/journal",
        payload: { code: "000001", side: "BUY", price: 9_000, qty: 1, date: "2024-03-12", stop: 8_500, target: 10_500, reason: "눌림목", strategy: "설춘환 스윙", weightPct: 10, emotion: "차분" },
      })
    ).json();
    expect(ok.entry).toMatchObject({ strategy: "설춘환 스윙", target: 10_500, weightPct: 10, emotion: "차분" });
    expect(ok.check.violations).toEqual([]);
    expect(ok.check.notes.some((n: { rule?: string }) => n.rule === "M4-02 캔들마스터")).toBe(true); // 1회째 손실 중 추가 매수 경고

    const again = (
      await app.inject({ method: "POST", url: "/api/journal", payload: { code: "000001", side: "BUY", price: 8_000, qty: 1, date: "2024-03-13", stop: 7_500, target: 9_500, reason: "또" } })
    ).json();
    expect(again.check.violations.some((v: string) => v.includes("손실 중 추가 매수는 1회까지만"))).toBe(true);

    const sell = (
      await app.inject({ method: "POST", url: "/api/journal", payload: { code: "000001", side: "SELL", price: 9_000, qty: 3, date: "2024-03-14", exitReason: "목표 미달 재량", reason: "정리" } })
    ).json();
    expect(sell.entry.exitReason).toBe("목표 미달 재량");
    expect(sell.check.notes).toEqual([]);

    const patched = (await app.inject({ method: "PATCH", url: `/api/journal/${sell.entry.id}`, payload: { review: "계획보다 일찍 팔았다", emotion: "조급함" } })).json();
    expect(patched.entry).toMatchObject({ review: "계획보다 일찍 팔았다", emotion: "조급함" });
    expect(store.state.journal.find((e) => e.id === sell.entry.id)?.emotion).toBe("조급함");
    expect((await app.inject({ method: "PATCH", url: "/api/journal/none", payload: {} })).statusCode).toBe(404);
  });

  it("keeps paper (자동) lots out of the manual averaging-down check and tags the regime only on same-day entries", async () => {
    const { app, store, deps } = api();
    store.state.journal.push(...autoTrade("000001", "2024-03-11", "2024-03-20", 0, 0).slice(0, 1)); // 모의 보유 10,000원
    await runScan(deps);
    store.state.latestScan!.regimes = { KOSPI: "BULL" };
    const plan = { stop: 8_000, target: 11_000, reason: "계획", weightPct: 10 };
    const first = (await app.inject({ method: "POST", url: "/api/journal", payload: { code: "000001", side: "BUY", price: 9_000, qty: 1, date: END, ...plan } })).json();
    expect(first.check.notes).toEqual([]); // 내 첫 매수 — 모의 보유분 때문에 물타기로 보지 않는다
    expect(first.entry.regime).toBe("BULL");
    const old = (await app.inject({ method: "POST", url: "/api/journal", payload: { code: "000002", side: "BUY", price: 9_000, qty: 1, date: "2024-03-01", ...plan } })).json();
    expect(old.entry.regime).toBeUndefined();
  });

  it("moves the net P&L into numeric fields before a review edit so the guards still see the loss", async () => {
    const { app, store } = api();
    const [, sell] = autoTrade("000009", "2024-03-15", END, -450_000, -4.5);
    store.state.journal.push(sell!);
    expect(todayPnl(store.state.journal, END)).toBe(-450_000);
    const r = await app.inject({ method: "PATCH", url: `/api/journal/${sell!.id}`, payload: { review: "손절 원칙 지킴" } });
    expect(r.json().entry).toMatchObject({ review: "손절 원칙 지킴", netPnl: -450_000, netPct: -4.5 });
    expect(todayPnl(store.state.journal, END)).toBe(-450_000);
  });

  it("builds, lists and annotates daily reviews and keeps the memo on rebuild", async () => {
    const { app, store } = api();
    const built = await app.inject({ method: "POST", url: "/api/reviews", payload: { region: "KR" } });
    expect(built.statusCode).toBe(201);
    const r = built.json().review;
    expect(r).toMatchObject({ region: "KR", date: END, rule: "M5-01 김연수" });
    expect(r.sectorMoves.top.length).toBeGreaterThan(0);
    expect(r.missing).not.toContain("섹터");
    expect(r.indexMoves.map((m: { name: string }) => m.name)).toEqual(["코스피", "코스닥"]);

    const put = await app.inject({ method: "PUT", url: `/api/reviews/KR/${END}`, payload: { comment: "반도체 강세" } });
    expect(put.json().review.userComment).toBe("반도체 강세");
    await app.inject({ method: "POST", url: "/api/reviews", payload: { region: "KR" } });
    expect(store.state.reviews).toHaveLength(1);
    expect(store.state.reviews[0]!.userComment).toBe("반도체 강세");

    await app.inject({ method: "POST", url: "/api/reviews", payload: { region: "US" } });
    const list = (await app.inject("/api/reviews")).json().reviews;
    expect(list).toHaveLength(2);
    expect((await app.inject({ method: "POST", url: "/api/reviews", payload: { region: "JP" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/reviews/KR/2000-01-01", payload: { comment: "x" } })).statusCode).toBe(404);

    const tabs = buildTables(store.state, { provider: "stub", sample: true, now: new Date() });
    const rv = tabs.find((t) => t.name === "일일복기")!;
    expect(rv.rows.some((x) => x[2] === "메모" && x[3] === "반도체 강세")).toBe(true);
  });

  it("reports paper-tracking status and review counts in /api/state", async () => {
    const { app, store } = api();
    store.state.journal.push(...autoTrade("000009", "2024-01-02", "2024-01-03", -100, -1));
    const st = (await app.inject("/api/state")).json();
    expect(st.counts.reviews).toBe(0);
    expect(st.paperTracking.KR).toMatchObject({ startedAt: "2024-01-02", closedTrades: 1, ready: false });
    expect(st.paperTracking.US.startedAt).toBeNull();
  });

  it("answers malformed requests with 4xx instead of a data-site 502", async () => {
    const { app } = api();
    const r = await app.inject({ method: "POST", url: "/api/paper/reset", headers: { "content-type": "application/json" }, payload: "" });
    expect(r.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/paper/reset" })).statusCode).toBe(200);
  });

  it("clamps posture caps and guard settings", async () => {
    const { app } = api();
    const s = (
      await app.inject({ method: "PUT", url: "/api/settings", payload: { postureCaps: { ATTACK: 150, NEUTRAL: -5, DEFENSE: "x" }, dailyLossLimitPct: 99, maxConsecutiveLosses: 2.6 } })
    ).json().settings;
    expect(s.postureCaps).toEqual({ ATTACK: 100, NEUTRAL: 0, DEFENSE: 20 });
    expect(s.dailyLossLimitPct).toBe(50);
    expect(s.maxConsecutiveLosses).toBe(3);
  });
});

describe("daily review job — timing", () => {
  it("books the closing-price exits before writing the automatic review, and replaces a review made during the session", async () => {
    const s = setup();
    await runScan(s.deps); // 10:30 KST 모의 진입
    const pos = s.store.state.paper.KRW.positions[0]!;
    const manual = await buildReviewNow(s.deps, "KR"); // 장중에 수동으로 만든 복기
    expect(manual.review.paper.sells).toBe(0);
    s.store.state.reviews[0]!.userComment = "장중 메모";
    s.provider.prices[pos.code] = pos.stop - 1; // 마감가가 손절가 아래
    s.setNow(new Date("2024-03-18T06:35:00Z")); // 15:35 KST
    const scheduler = new Scheduler(s.deps);
    await (scheduler as unknown as { tick: () => Promise<void> }).tick();
    const r = s.store.state.reviews.find((x) => x.region === "KR" && x.date === END)!;
    expect(s.store.state.reviews.filter((x) => x.region === "KR")).toHaveLength(1);
    expect(r.paper.sells).toBe(1);
    expect(r.userComment).toBe("장중 메모");
    expect(r.builtAt).toBe("2024-03-18T06:35:00.000Z");
  });
});

describe("HTTP API — extras cache", () => {
  it("does not keep a partly failed result in the cache", async () => {
    const s = setup({ paperEnabled: false });
    let down = true;
    const base = new MockExtras(() => MON_1030_KST);
    const flaky = {
      sample: true,
      investorFlows: (c: string) => (down ? Promise.reject(new Error("HTTP 503")) : base.investorFlows(c)),
      disclosures: (c: string) => base.disclosures(c),
      itemSector: (c: string) => base.itemSector(c),
      sectors: () => base.sectors(),
    };
    const exporter = new Exporter({ excelPath: join(s.dir, "x.xlsx"), sheets: null, debounceMs: 1, build: () => [] });
    const app = buildApp({ provider: s.provider, store: s.store, exporter, scheduler: new Scheduler(s.deps), macro: new MockMacro(), extras: flaky, now: () => MON_1030_KST });
    expect((await app.inject("/api/stocks/005930/extras")).json().errors).toHaveLength(1);
    down = false;
    const again = (await app.inject("/api/stocks/005930/extras")).json();
    expect(again.errors).toEqual([]);
    expect(again.flows.length).toBeGreaterThan(0);
  });
});

describe("daily review job", () => {
  it("writes the review once right after the close", async () => {
    const s = setup({ paperEnabled: false });
    s.setNow(new Date("2024-03-18T06:40:00Z")); // 15:40 KST, 마감 직후
    const scheduler = new Scheduler(s.deps);
    await (scheduler as unknown as { tick: () => Promise<void> }).tick();
    expect(s.store.state.reviews.map((r) => `${r.region}:${r.date}`)).toEqual([`KR:${END}`]);
    await (scheduler as unknown as { tick: () => Promise<void> }).tick();
    expect(s.store.state.reviews).toHaveLength(1);
  });

  it("dates a review made on a weekend to the last trading day so that day's candidates count", async () => {
    const s = setup({ paperEnabled: false });
    await runScan(s.deps);
    s.setNow(new Date("2024-03-23T03:00:00Z")); // 토요일 12:00 KST
    const { review } = await buildReviewNow(s.deps, "KR");
    expect(review.date).toBe(END);
    expect(review.candidatesTop.length).toBeGreaterThan(0);
  });

  it("falls back to the universe saved by today's scan when the live list fails", async () => {
    const s = setup({ paperEnabled: false });
    await runScan(s.deps);
    s.provider.failUniverse.add("KOSPI");
    const { review, errors } = await buildReviewNow(s.deps, "KR");
    expect(errors.join()).toContain("KOSPI 순위표");
    expect(review.topGainers.length).toBeGreaterThan(0);
    expect(review.candidatesTop.length).toBeGreaterThan(0);
  });
});
