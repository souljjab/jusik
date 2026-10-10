import { resolve } from "node:path";
import { buildApp } from "./app";
import { BreadthSource, fallbackCodesFrom } from "./breadthSource";
import { createHttp } from "./http";
import { DartClient, SampleDart } from "./dart";
import { Exporter } from "./exporter";
import { MockExtras, MockMacro, NaverExtras, type ExtrasSource, type MacroSource } from "./extras";
import { MacroProvider } from "./fred";
import { IsmSource } from "./ism";
import { MockMinuteSource, WebMinuteSource, type MinuteSource } from "./minute";
import { MockProvider } from "./mock";
import { MockUsSource } from "./mockUs";
import type { MarketDataProvider } from "./provider";
import { Scheduler } from "./scheduler";
import { SecClient } from "./sec";
import { sheetsConfigFromEnv } from "./sheets";
import { Store } from "./state";
import { STOCKS } from "./stocks";
import { buildTables } from "./tables";
import { WebProvider } from "./webProvider";

const env = process.env;
const dataDir = resolve(env.DATA_DIR ?? resolve(process.cwd(), "../data"));

interface Sources {
  provider: MarketDataProvider;
  macro: MacroSource;
  extras: ExtrasSource;
  breadth: BreadthSource;
  minute: MinuteSource;
  /** 켜진 선택 데이터(로그 안내용) */
  optional: string[];
}

function makeSources(): Sources {
  if ((env.PROVIDER ?? "web").toLowerCase() === "mock") {
    const provider = new MockProvider();
    const us = new MockUsSource();
    return {
      provider,
      macro: new MockMacro(),
      extras: new MockExtras(undefined, (code, n) => provider.getCandles(code, n), { dart: new SampleDart(), sec: us, usHolders: (c) => us.holders(c) }),
      breadth: new BreadthSource(provider, null, { fallbackCodes: fallbackCodesFrom(STOCKS) }),
      minute: new MockMinuteSource((c) => provider.getCandles(c, 5)),
      optional: ["샘플 DART", "샘플 SEC"],
    };
  }
  // 모든 사이트 요청이 같은 직렬 큐를 지나가게 HTTP 클라이언트 하나를 같이 쓴다
  const http = createHttp({ minIntervalMs: Number(env.HTTP_MIN_INTERVAL_MS ?? 500), userAgent: env.HTTP_USER_AGENT || undefined });
  const optional: string[] = [];
  const dart = env.DART_API_KEY ? new DartClient(http, env.DART_API_KEY, { cacheFile: resolve(dataDir, "dart-corpcode.json") }) : null;
  if (dart) optional.push("DART");
  const sec = env.SEC_USER_AGENT ? new SecClient(http, { userAgent: env.SEC_USER_AGENT }) : null;
  if (sec) optional.push("SEC");
  const provider = new WebProvider(http, sec ?? undefined, dart ?? undefined);
  return {
    provider,
    macro: new MacroProvider(http, undefined, { ism: new IsmSource(http) }),
    extras: new NaverExtras(http, { dart, sec, usHolders: (c) => provider.getUsHolders(c) }),
    breadth: new BreadthSource(provider, http, { fallbackCodes: fallbackCodesFrom(STOCKS) }),
    minute: new WebMinuteSource(http),
    optional,
  };
}

const { provider, macro, extras, breadth, minute, optional } = makeSources();
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
const scheduler = new Scheduler({ provider, store, macro, extras, breadth, minute }, () => exporter.request());
const app = buildApp({ provider, store, exporter, scheduler, macro, extras, breadth, minute });

const port = Number(env.PORT ?? 8787);
await app.listen({ port, host: "127.0.0.1" });
if ((env.SCHEDULER ?? "on") !== "off") scheduler.start();
console.log(`[jusik] API 서버 http://localhost:${port}  (provider=${provider.name}${provider.sample ? ", 샘플 데이터" : ""})`);
console.log(`[jusik] 데이터 폴더: ${dataDir}  (엑셀: jusik.xlsx${sheets ? " + 구글 시트 동기화" : ""})`);
console.log(`[jusik] 선택 데이터: ${optional.length ? optional.join(", ") : "없음"} (DART_API_KEY·SEC_USER_AGENT로 켜요)`);
