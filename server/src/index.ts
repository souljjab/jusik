import { appendFileSync, mkdirSync } from "node:fs";
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
/** .env에 'DATA_DIR='처럼 비워 둔 값은 없는 것으로 본다(.env.example을 그대로 복사해도 기본값을 쓰게) */
const envOr = (name: string, fallback: string) => env[name]?.trim() || fallback;
const dataDir = resolve(envOr("DATA_DIR", resolve(process.cwd(), "../data")));

// 처리하지 못한 오류로 서버 전체가 꺼지지 않게 남기고 계속 동작한다(꺼지면 화면은 '서버에 연결하지 못했어요'만 보인다).
// 터미널 글이 금방 밀려 올라가므로 데이터 폴더의 server-errors.log에도 남긴다. 여기 찍힌 오류 문장과 위치가 원인을 고치는 단서다
const errorLog = resolve(dataDir, "server-errors.log");
function logFatal(kind: string, e: unknown, keepsRunning = true) {
  const text = e instanceof Error ? (e.stack ?? e.message) : String(e);
  console.error(`[jusik] ${kind}${keepsRunning ? "(서버는 계속 동작해요)" : ""}:`, text);
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(errorLog, `${new Date().toISOString()} ${kind}\n${text}\n\n`);
  } catch {
    /* 기록하지 못해도 계속 */
  }
}
process.on("unhandledRejection", (e) => logFatal("처리하지 못한 비동기 오류", e));
process.on("uncaughtException", (e) => logFatal("처리하지 못한 오류", e));
process.on("exit", (code) => {
  const line = `${new Date().toISOString()} 서버가 꺼졌어요(종료 코드 ${code})\n\n`;
  console.error(`[jusik] 서버가 꺼졌어요(종료 코드 ${code}). 원인은 ${errorLog}와 바로 위 [server] 줄에 있어요`);
  try {
    appendFileSync(errorLog, line);
  } catch {
    /* 기록하지 못해도 계속 */
  }
});

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
  const http = createHttp({ minIntervalMs: Number(envOr("HTTP_MIN_INTERVAL_MS", "500")), userAgent: env.HTTP_USER_AGENT || undefined });
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

const port = Number(envOr("PORT", "8787"));
// 다시 시작할 때(tsx watch) 앞 프로세스가 포트를 아직 놓지 않았으면 잠깐 기다렸다 다시 연다(Windows에서 느릴 수 있다)
for (let attempt = 1; ; attempt++) {
  try {
    await app.listen({ port, host: "127.0.0.1" });
    break;
  } catch (e) {
    const inUse = (e as NodeJS.ErrnoException)?.code === "EADDRINUSE";
    if (!inUse || attempt >= 10) {
      logFatal(inUse ? `포트 ${port}을 이미 다른 프로그램이 쓰고 있어요(서버가 이미 켜져 있는지 확인하세요)` : "서버를 열지 못했어요", e, false);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if ((env.SCHEDULER ?? "on") !== "off") scheduler.start();
console.log(`[jusik] API 서버 http://localhost:${port}  (provider=${provider.name}${provider.sample ? ", 샘플 데이터" : ""})`);
console.log(`[jusik] 데이터 폴더: ${dataDir}  (엑셀: jusik.xlsx${sheets ? " + 구글 시트 동기화" : ""})`);
console.log(`[jusik] 선택 데이터: ${optional.length ? optional.join(", ") : "없음"} (DART_API_KEY·SEC_USER_AGENT로 켜요)`);
