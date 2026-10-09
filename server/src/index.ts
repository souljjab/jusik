import { resolve } from "node:path";
import { buildApp } from "./app";
import { createHttp } from "./http";
import { Exporter } from "./exporter";
import { MockProvider } from "./mock";
import type { MarketDataProvider } from "./provider";
import { Scheduler } from "./scheduler";
import { sheetsConfigFromEnv } from "./sheets";
import { Store } from "./state";
import { buildTables } from "./tables";
import { WebProvider } from "./webProvider";

const env = process.env;
const dataDir = resolve(env.DATA_DIR ?? resolve(process.cwd(), "../data"));

function makeProvider(): MarketDataProvider {
  if ((env.PROVIDER ?? "web").toLowerCase() === "mock") return new MockProvider();
  return new WebProvider(createHttp({ minIntervalMs: Number(env.HTTP_MIN_INTERVAL_MS ?? 500), userAgent: env.HTTP_USER_AGENT || undefined }));
}

const provider = makeProvider();
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
const scheduler = new Scheduler({ provider, store }, () => exporter.request());
const app = buildApp({ provider, store, exporter, scheduler });

const port = Number(env.PORT ?? 8787);
await app.listen({ port, host: "127.0.0.1" });
if ((env.SCHEDULER ?? "on") !== "off") scheduler.start();
console.log(`[jusik] API 서버 http://localhost:${port}  (provider=${provider.name}${provider.sample ? ", 샘플 데이터" : ""})`);
console.log(`[jusik] 데이터 폴더: ${dataDir}  (엑셀: jusik.xlsx${sheets ? " + 구글 시트 동기화" : ""})`);
