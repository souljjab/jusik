import { resolve } from "node:path";
import { buildApp } from "./app";
import { KisProvider } from "./kis";
import { MockProvider } from "./mock";
import type { MarketDataProvider } from "./provider";

function makeProvider(): MarketDataProvider {
  const kind = (process.env.PROVIDER ?? "mock").toLowerCase();
  if (kind === "kis") {
    const appKey = process.env.KIS_APP_KEY;
    const appSecret = process.env.KIS_APP_SECRET;
    if (!appKey || !appSecret) {
      throw new Error("PROVIDER=kis 이면 KIS_APP_KEY, KIS_APP_SECRET 환경변수가 필요해요. server/.env.example 을 참고하세요.");
    }
    return new KisProvider({
      appKey,
      appSecret,
      baseUrl: process.env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443",
      minIntervalMs: Number(process.env.KIS_MIN_INTERVAL_MS ?? 120),
      tokenFile: resolve(process.cwd(), ".kis-token.json"),
    });
  }
  return new MockProvider();
}

const provider = makeProvider();
const app = buildApp(provider);
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
console.log(`[jusik] API 서버 http://localhost:${port}  (provider=${provider.name}${provider.sample ? ", 샘플 데이터" : ""})`);
