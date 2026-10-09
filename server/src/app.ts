import Fastify from "fastify";
import cors from "@fastify/cors";
import type { MarketDataProvider } from "./provider";
import { TtlCache } from "./cache";

const CODE = /^\d{6}$/;

export function buildApp(provider: MarketDataProvider) {
  const app = Fastify({ logger: false });
  const cache = new TtlCache(60_000);
  const slowCache = new TtlCache(30 * 60_000);

  app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ ok: true, provider: provider.name, sample: provider.sample }));

  app.get<{ Querystring: { q?: string } }>("/api/search", async (req) => {
    return { results: await provider.search(req.query.q ?? "") };
  });

  app.get<{ Params: { code: string } }>("/api/stocks/:code/overview", async (req, reply) => {
    const { code } = req.params;
    if (!CODE.test(code)) return reply.code(400).send({ error: "종목코드는 6자리 숫자여야 해요." });
    const info = await provider.getInfo(code);
    const [quote, fundamentals] = await Promise.all([
      cache.get(`q:${code}`, () => provider.getQuote(code)),
      slowCache.get(`f:${code}`, () => provider.getFundamentals(code)),
    ]);
    return { info: info ?? { code, name: code, market: "KOSPI" }, quote, fundamentals };
  });

  app.get<{ Params: { code: string }; Querystring: { count?: string } }>("/api/stocks/:code/candles", async (req, reply) => {
    const { code } = req.params;
    if (!CODE.test(code)) return reply.code(400).send({ error: "종목코드는 6자리 숫자여야 해요." });
    const count = Math.min(Math.max(Number(req.query.count) || 500, 30), 1500);
    const candles = await slowCache.get(`c:${code}:${count}`, () => provider.getCandles(code, count));
    return { candles };
  });

  app.get<{ Params: { market: string }; Querystring: { count?: string } }>("/api/index/:market/candles", async (req, reply) => {
    const market = req.params.market.toUpperCase();
    if (market !== "KOSPI" && market !== "KOSDAQ") return reply.code(400).send({ error: "시장은 KOSPI 또는 KOSDAQ 이어야 해요." });
    const count = Math.min(Math.max(Number(req.query.count) || 500, 60), 1500);
    const candles = await slowCache.get(`i:${market}:${count}`, () => provider.getIndexCandles(market, count));
    return { candles };
  });

  app.setErrorHandler((err, _req, reply) => {
    const message = err instanceof Error ? err.message : String(err);
    reply.code(502).send({ error: message });
  });

  return app;
}
