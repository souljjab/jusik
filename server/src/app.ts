import { existsSync, readFileSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { isValidCode, type JournalEntry, type Market } from "@jusik/shared";
import { TtlCache } from "./cache";
import type { Exporter } from "./exporter";
import type { MarketDataProvider } from "./provider";
import { evaluatePaper, runReplay } from "./evaluate";
import { syncPaperWithDeposit } from "./scanner";
import type { Scheduler } from "./scheduler";
import { sanitizeSettings, type Store } from "./state";

export interface AppDeps {
  provider: MarketDataProvider;
  store: Store;
  exporter: Exporter;
  scheduler: Scheduler;
}

const BAD_CODE = { error: "종목코드는 6자리 숫자(국내) 또는 영문 티커(미국, 예: AAPL)여야 해요." };
const MARKETS = ["KOSPI", "KOSDAQ", "US"] as const;

const normCode = (c: string) => (/^\d{6}$/.test(c) ? c : c.toUpperCase());

export function buildApp({ provider, store, exporter, scheduler }: AppDeps) {
  const app = Fastify({ logger: false });
  const cache = new TtlCache(60_000);
  const slowCache = new TtlCache(30 * 60_000);

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

  // ---- 단타 스캔 / 설정 / 모의계좌 ----
  app.get("/api/state", async () => ({
    settings: store.state.settings,
    status: { provider: provider.name, sample: provider.sample, scheduler: scheduler.status(), export: exporter.status },
    latestScan: store.state.latestScan,
    paper: store.state.paper,
    counts: { journal: store.state.journal.length, history: store.state.history.length },
  }));

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
    const entry: JournalEntry = {
      id: globalThis.crypto.randomUUID(), code, name: info?.name ?? String(b.name ?? code), date: String(b.date), side: b.side, price, qty,
      stop: b.stop && Number(b.stop) > 0 ? Number(b.stop) : undefined, reason: String(b.reason ?? "").slice(0, 500),
      review: b.review ? String(b.review).slice(0, 1000) : undefined, source: "수동",
    };
    store.state.journal.push(entry);
    store.save();
    exporter.request();
    return reply.code(201).send({ entry });
  });

  app.delete<{ Params: { id: string } }>("/api/journal/:id", async (req, reply) => {
    const i = store.state.journal.findIndex((e) => e.id === req.params.id);
    if (i < 0) return reply.code(404).send({ error: "기록을 찾을 수 없어요." });
    store.state.journal.splice(i, 1);
    store.save();
    exporter.request();
    return { ok: true };
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
    reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
  });

  return app;
}
