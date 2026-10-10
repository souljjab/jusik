import { existsSync, readFileSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  averagingDownCheck, isValidCode, macroNotes, marketClock, netOf, paperTrackingStatus, preTradeChecklist, regionOf, regionOfCode,
  type BreadthResponse, type JournalCheck, type JournalEntry, type MacroResponse, type Market, type MinuteResponse, type Note, type Region, type ServerState, type StockExtras,
} from "@jusik/shared";
import { TtlCache } from "./cache";
import type { Exporter } from "./exporter";
import type { BreadthSource } from "./breadthSource";
import { loadStockExtras, type ExtrasSource, type MacroSource } from "./extras";
import { minuteFor } from "./intradayCheck";
import type { MinuteSource } from "./minute";
import type { MarketDataProvider } from "./provider";
import { evaluatePaper, runReplay } from "./evaluate";
import { BREADTH_WAIT_MS, logBreadthToday, syncPaperWithDeposit, withTimeout } from "./scanner";
import type { Scheduler } from "./scheduler";
import { sanitizeSettings, type Store } from "./state";

export interface AppDeps {
  provider: MarketDataProvider;
  store: Store;
  exporter: Exporter;
  scheduler: Scheduler;
  macro: MacroSource;
  /** 시장 폭(A/D선·MI). 없으면 /api/breadth가 빈 값 */
  breadth?: BreadthSource | null;
  /** 분봉 */
  minute?: MinuteSource | null;
  extras: ExtrasSource;
  now?: () => Date;
}

const BAD_CODE = { error: "종목코드는 6자리 숫자(국내) 또는 영문 티커(미국, 예: AAPL)여야 해요." };
const MARKETS = ["KOSPI", "KOSDAQ", "US"] as const;

const normCode = (c: string) => (/^\d{6}$/.test(c) ? c : c.toUpperCase());
const REGIONS: Region[] = ["KR", "US"];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const optNum = (v: unknown) => (v != null && v !== "" && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
const optText = (v: unknown, max: number) => (v != null && String(v).trim() ? String(v).trim().slice(0, max) : undefined);

export function buildApp({ provider, store, exporter, scheduler, macro, extras, breadth, minute, now = () => new Date() }: AppDeps) {
  const app = Fastify({ logger: false });
  const cache = new TtlCache(60_000);
  const slowCache = new TtlCache(30 * 60_000);
  const extrasCache = new TtlCache(10 * 60_000);
  const minuteCache = new TtlCache(30_000);

  // 같은 PC의 화면(5173)과 로컬 서버만 쓰는 도구라 localhost 계열만 허용한다. 배포할 때는 허용 도메인을 직접 지정하세요.
  app.register(cors, { origin: [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /^capacitor:\/\/localhost$/, /^https?:\/\/localhost$/] });

  app.get("/api/health", async () => ({ ok: true, provider: provider.name, sample: provider.sample }));

  app.get<{ Querystring: { q?: string } }>("/api/search", async (req) => ({ results: await provider.search(req.query.q ?? "") }));

  app.get<{ Params: { code: string } }>("/api/stocks/:code/overview", async (req, reply) => {
    const code = normCode(req.params.code);
    if (!isValidCode(code)) return reply.code(400).send(BAD_CODE);
    const info = await provider.getInfo(code);
    const [quote, fundamentals] = await Promise.all([
      cache.get(`q:${code}`, () => provider.getQuote(code)),
      slowCache.get(`f:${code}`, () => provider.getFundamentals(code)),
    ]);
    return { info: info ?? { code, name: code, market: /^\d{6}$/.test(code) ? "KOSPI" : "US" }, quote, fundamentals };
  });

  app.get<{ Params: { code: string }; Querystring: { count?: string } }>("/api/stocks/:code/candles", async (req, reply) => {
    const code = normCode(req.params.code);
    if (!isValidCode(code)) return reply.code(400).send(BAD_CODE);
    const count = Math.min(Math.max(Number(req.query.count) || 500, 30), 1500);
    return { candles: await slowCache.get(`c:${code}:${count}`, () => provider.getCandles(code, count)) };
  });

  app.get<{ Params: { market: string }; Querystring: { count?: string } }>("/api/index/:market/candles", async (req, reply) => {
    const market = req.params.market.toUpperCase() as Market;
    if (!MARKETS.includes(market)) return reply.code(400).send({ error: "시장은 KOSPI, KOSDAQ, US 중 하나여야 해요." });
    const count = Math.min(Math.max(Number(req.query.count) || 500, 60), 1500);
    return { candles: await slowCache.get(`i:${market}:${count}`, () => provider.getIndexCandles(market, count)) };
  });

  // 국내 종목 수급·공시·업종(미국 종목은 supported=false)
  app.get<{ Params: { code: string } }>("/api/stocks/:code/extras", async (req, reply) => {
    const code = normCode(req.params.code);
    if (!isValidCode(code)) return reply.code(400).send(BAD_CODE);
    const today = marketClock(regionOfCode(code), now()).date;
    const key = `x:${code}:${today}`;
    const r = await extrasCache.get<StockExtras>(key, () => loadStockExtras(extras, code, today));
    // 일부라도 실패한 결과는 캐시하지 않는다(사이트가 잠깐 막혔을 때 10분 동안 빈 값이 남지 않게)
    if (r.errors.length) extrasCache.delete(key);
    return r;
  });

  // 매크로(FRED·ISM): 금리차·VIX·10년물·초과 유동성·원/달러·ISM(직접 입력값이 있으면 그 값)
  app.get("/api/macro", async (): Promise<MacroResponse> => {
    try {
      const m = await macro.getSnapshot({ ism: store.state.settings.ismManual });
      const ok = m.snapshot.asOf != null;
      return {
        snapshot: ok ? m.snapshot : null,
        notes: { KR: ok ? macroNotes(m.snapshot, "KR") : [], US: ok ? macroNotes(m.snapshot, "US") : [] },
        errors: m.errors, fetchedAt: m.fetchedAt, sample: macro.sample,
      };
    } catch (e) {
      return { snapshot: null, notes: { KR: [], US: [] }, errors: [errText(e)], fetchedAt: null, sample: macro.sample };
    }
  });

  // 시장 폭(A/D선·시장 탄력지수 MI·신고가-신저가). 처음 계산은 오래 걸려 기다리지 않고 pending을 돌려준다
  app.get<{ Params: { market: string } }>("/api/breadth/:market", async (req, reply) => {
    const market = req.params.market.toUpperCase() as Market;
    if (!MARKETS.includes(market)) return reply.code(400).send({ error: "시장은 KOSPI, KOSDAQ, US 중 하나여야 해요." });
    const log = (store.state.breadthLog[market] ?? []).slice(-250);
    const empty: BreadthResponse = { market, pending: false, analysis: null, today: null, log, basketSize: 0, errors: [], sample: provider.sample };
    if (!breadth) return { ...empty, errors: ["시장 폭 공급자가 없어요"] };
    const r = await withTimeout(breadth.getBreadth(market), BREADTH_WAIT_MS);
    if (!r) return { ...empty, pending: true };
    logBreadthToday(store, market, marketClock(regionOf(market), now()).date, r.today);
    const out: BreadthResponse = {
      market, pending: false, analysis: r.analysis, today: r.today, log: (store.state.breadthLog[market] ?? []).slice(-250), basketSize: r.basket.length, errors: r.errors, sample: r.sample,
    };
    return out;
  });

  // 분봉(1분봉)과 강창권 분봉 규칙 판단(4.7·M3-18)
  app.get<{ Params: { code: string } }>("/api/stocks/:code/minute", async (req, reply) => {
    const code = normCode(req.params.code);
    if (!isValidCode(code)) return reply.code(400).send(BAD_CODE);
    if (!minute) return reply.code(503).send({ error: "분봉 공급자가 없어요." });
    return minuteCache.get<MinuteResponse>(`m:${code}`, () => minuteFor({ provider, minute }, code, now()));
  });

  // ---- 단타 스캔 / 설정 / 모의계좌 ----
  app.get("/api/state", async (): Promise<ServerState> => {
    const t = now();
    const tracking = (r: Region) => paperTrackingStatus(store.state.journal, marketClock(r, t).date, { region: r });
    return {
      settings: store.state.settings,
      status: { provider: provider.name, sample: provider.sample, scheduler: scheduler.status(), export: exporter.status },
      latestScan: store.state.latestScan,
      paper: store.state.paper,
      counts: { journal: store.state.journal.length, history: store.state.history.length, reviews: store.state.reviews.length },
      paperTracking: { KR: tracking("KR"), US: tracking("US") },
    };
  });

  app.put("/api/settings", async (req) => {
    const before = store.state.settings;
    store.state.settings = sanitizeSettings(req.body, before);
    const after = store.state.settings;
    if (after.depositKRW !== before.depositKRW || after.depositUSD !== before.depositUSD) syncPaperWithDeposit(store);
    store.save();
    exporter.request();
    return { settings: store.state.settings, paper: store.state.paper };
  });

  app.post("/api/scan", async (_req, reply) => {
    const started = scheduler.startScan();
    return reply.code(started ? 202 : 409).send({ started, message: started ? "스캔을 시작했어요." : "이미 스캔 중이에요." });
  });

  app.post("/api/paper/reset", async () => {
    syncPaperWithDeposit(store, true);
    store.save();
    exporter.request();
    return { paper: store.state.paper };
  });

  // ---- 규칙 점검 ----
  let replaying = false;
  app.get("/api/evaluate/paper", async () => evaluatePaper({ store }));
  app.get("/api/evaluate/replay", async () => ({ run: store.state.lastReplay, running: replaying }));
  app.post<{ Body: { markets?: Market[]; count?: number } }>("/api/evaluate/replay", async (req, reply) => {
    if (replaying) return reply.code(409).send({ error: "이미 재현 중이에요." });
    const markets = (req.body?.markets ?? []).filter((m) => MARKETS.includes(m));
    replaying = true;
    try {
      const run = await runReplay({ provider, store }, { markets, count: Number(req.body?.count) || undefined });
      exporter.request();
      return { run };
    } finally {
      replaying = false;
    }
  });

  // ---- 매매일지 ----
  app.get("/api/journal", async () => ({ entries: store.state.journal }));

  app.post<{ Body: Partial<JournalEntry> }>("/api/journal", async (req, reply) => {
    const b = req.body ?? {};
    const code = normCode(String(b.code ?? ""));
    const price = Number(b.price), qty = Number(b.qty);
    if (!isValidCode(code)) return reply.code(400).send(BAD_CODE);
    if (b.side !== "BUY" && b.side !== "SELL") return reply.code(400).send({ error: "구분은 BUY 또는 SELL 이어야 해요." });
    if (!(price > 0) || !(qty > 0) || !Number.isInteger(qty)) return reply.code(400).send({ error: "가격은 0보다 크고 수량은 1 이상의 정수여야 해요." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date ?? ""))) return reply.code(400).send({ error: "날짜 형식은 YYYY-MM-DD 예요." });
    const info = await provider.getInfo(code).catch(() => undefined);
    const date = String(b.date);
    const stop = optNum(b.stop), target = optNum(b.target), reason = String(b.reason ?? "").slice(0, 500);
    const weightPct = optNum(b.weightPct) != null ? Math.min(100, optNum(b.weightPct)!) : undefined;

    // 매수는 주문 전 체크리스트(손절가·목표가·근거·비중)와 손실 중 추가 매수를 점검한다(5.5, M4-02). 막지는 않고 기록에 남긴다
    const notes: Note[] = [];
    if (b.side === "BUY") {
      notes.push(...preTradeChecklist({ stop, target, reason, price, weightPct }));
      // 모의계좌(자동) 보유분은 내 실제 보유가 아니라서 직접 쓴 기록끼리만 본다
      const manual = store.state.journal.filter((e) => (e.source ?? "수동") === "수동");
      notes.push(...averagingDownCheck(manual, { code, side: "BUY", price, date }).notes);
    }
    const violations = notes.filter((n) => n.tone === "bad").map((n) => n.text);
    // 국면은 오늘(그 시장 날짜) 기록일 때만 지금 스캔의 국면을 붙인다. 지난 날짜로 쓴 기록에는 붙이지 않는다
    const sameDay = date === marketClock(regionOfCode(code), now()).date;
    const regime = info && sameDay ? (store.state.latestScan?.regimes[info.market] ?? null) : null;
    const entry: JournalEntry = {
      id: globalThis.crypto.randomUUID(), code, name: info?.name ?? String(b.name ?? code), date, side: b.side, price, qty,
      stop, reason, review: optText(b.review, 1000), source: "수동",
      ...(optText(b.strategy, 60) ? { strategy: optText(b.strategy, 60) } : {}),
      ...(target != null ? { target } : {}),
      ...(weightPct != null ? { weightPct } : {}),
      ...(b.side === "BUY" && regime ? { regime } : {}),
      ...(b.side === "SELL" && optText(b.exitReason, 60) ? { exitReason: optText(b.exitReason, 60) } : {}),
      ...(optText(b.emotion, 200) ? { emotion: optText(b.emotion, 200) } : {}),
      ...(violations.length ? { violations } : {}),
    };
    store.state.journal.push(entry);
    store.save();
    exporter.request();
    const check: JournalCheck = { notes, violations };
    return reply.code(201).send({ entry, check });
  });

  // 복기 메모·감정·청산 사유 고치기(매매 뒤에 채우는 칸)
  app.patch<{ Params: { id: string }; Body: Partial<JournalEntry> }>("/api/journal/:id", async (req, reply) => {
    const e = store.state.journal.find((x) => x.id === req.params.id);
    if (!e) return reply.code(404).send({ error: "기록을 찾을 수 없어요." });
    const b = req.body ?? {};
    // 자동(모의) 매도의 순손익은 복기 문구에서 읽던 값이라, 문구를 고치기 전에 숫자 필드로 옮겨 둔다
    if (e.source === "자동(모의)" && e.side === "SELL") {
      const n = netOf(e);
      if (e.netPnl == null && n.pnl != null) e.netPnl = n.pnl;
      if (e.netPct == null && n.pct != null) e.netPct = n.pct;
    }
    if ("review" in b) e.review = optText(b.review, 1000);
    if ("emotion" in b) e.emotion = optText(b.emotion, 200);
    if ("exitReason" in b && e.side === "SELL") e.exitReason = optText(b.exitReason, 60);
    if ("strategy" in b) e.strategy = optText(b.strategy, 60);
    store.save();
    exporter.request();
    return { entry: e };
  });

  app.delete<{ Params: { id: string } }>("/api/journal/:id", async (req, reply) => {
    const i = store.state.journal.findIndex((e) => e.id === req.params.id);
    if (i < 0) return reply.code(404).send({ error: "기록을 찾을 수 없어요." });
    store.state.journal.splice(i, 1);
    store.save();
    exporter.request();
    return { ok: true };
  });

  // ---- 일일 복기(M5-01) ----
  app.get("/api/reviews", async () => ({ reviews: [...store.state.reviews].reverse() }));

  app.post<{ Body: { region?: string } }>("/api/reviews", async (req, reply) => {
    const region = String(req.body?.region ?? "").toUpperCase() as Region;
    if (!REGIONS.includes(region)) return reply.code(400).send({ error: "지역은 KR 또는 US 여야 해요." });
    const r = await scheduler.buildReview(region);
    if (r === "busy") return reply.code(409).send({ error: "스캔·점검 중이에요. 잠시 뒤에 다시 시도하세요." });
    exporter.request();
    return reply.code(201).send(r);
  });

  app.put<{ Params: { region: string; date: string }; Body: { comment?: string } }>("/api/reviews/:region/:date", async (req, reply) => {
    const r = store.state.reviews.find((x) => x.region === req.params.region && x.date === req.params.date);
    if (!r) return reply.code(404).send({ error: "복기를 찾을 수 없어요." });
    r.userComment = optText(req.body?.comment, 2000);
    store.save();
    exporter.request();
    return { review: r };
  });

  // ---- 내보내기 ----
  app.get("/api/export/excel", async (_req, reply) => {
    await exporter.flush();
    const { path, ok, error } = exporter.status.excel;
    if (!ok || !existsSync(path)) return reply.code(500).send({ error: error ?? "엑셀 파일이 아직 없어요." });
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="jusik.xlsx"`)
      .send(readFileSync(path));
  });

  app.post("/api/export/sync", async () => {
    await exporter.flush();
    return { status: exporter.status };
  });

  app.setErrorHandler((err, _req, reply) => {
    // 잘못된 요청(본문 형식 등)은 그대로 4xx, 그 밖의 실패는 데이터 사이트 문제로 보고 502
    const status = (err as { statusCode?: number }).statusCode;
    reply.code(status && status >= 400 && status < 500 ? status : 502).send({ error: err instanceof Error ? err.message : String(err) });
  });

  return app;
}
