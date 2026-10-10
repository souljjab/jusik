import { resolve } from "node:path";
import { buildApp } from "./app";
import { createHttp } from "./http";
import { Exporter } from "./exporter";
import { MockExtras, MockMacro, NaverExtras, type ExtrasSource, type MacroSource } from "./extras";
import { MacroProvider } from "./fred";
import { MockProvider } from "./mock";
import type { MarketDataProvider } from "./provider";
import { Scheduler } from "./scheduler";
import { sheetsConfigFromEnv } from "./sheets";
import { Store } from "./state";
import { buildTables } from "./tables";
import { WebProvider } from "./webProvider";

const env = process.env;
const dataDir = resolve(env.DATA_DIR ?? resolve(process.cwd(), "../data"));

function makeSources(): { provider: MarketDataProvider; macro: MacroSource; extras: ExtrasSource } {
  if ((env.PROVIDER ?? "web").toLowerCase() === "mock") return { provider: new MockProvider(), macro: new MockMacro(), extras: new MockExtras() };
  // 모든 사이트 요청이 같은 직렬 큐를 지나가게 HTTP 클라이언트 하나를 같이 쓴다
  const http = createHttp({ minIntervalMs: Number(env.HTTP_MIN_INTERVAL_MS ?? 500), userAgent: env.HTTP_USER_AGENT || undefined });
  return { provider: new WebProvider(http), macro: new MacroProvider(http), extras: new NaverExtras(http) };
}

const { provider, macro, extras } = makeSources();
const store = new Store(resolve(dataDir, "state.json"));
let sheets = null;
try {
  sheets = sheetsConfigFromEnv(env);
} catch (e) {
  console.error(`[jusik] 구글 시트 설정을 읽지 못했어요(엑셀만 저장해요): ${e instanceof Error ? e.message : e}`);
}
const exporter = new Exporter({
  excelPath: resolve(dataDir, "jusik.xlsx"),
  sheets,
  build: () => buildTables(store.state, { provider: provider.name, sample: provider.sample, now: new Date() }),
});
const scheduler = new Scheduler({ provider, store, macro, extras }, () => exporter.request());
const app = buildApp({ provider, store, exporter, scheduler, macro, extras });

const port = Number(env.PORT ?? 8787);
await app.listen({ port, host: "127.0.0.1" });
if ((env.SCHEDULER ?? "on") !== "off") scheduler.start();
console.log(`[jusik] API 서버 http://localhost:${port}  (provider=${provider.name}${provider.sample ? ", 샘플 데이터" : ""})`);
console.log(`[jusik] 데이터 폴더: ${dataDir}  (엑셀: jusik.xlsx${sheets ? " + 구글 시트 동기화" : ""})`);
