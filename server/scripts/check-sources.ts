/**
 * 수집 대상 사이트(네이버 금융·야후 파이낸스)에 실제로 접속해서 각 파서가 값을 읽어내는지 확인한다.
 *   npm run check:sources -w server
 * 사이트 구조가 바뀌었거나 접속이 차단됐을 때 어떤 항목이 깨졌는지 바로 알 수 있다.
 */
import { MACRO_SERIES_IDS } from "@jusik/shared";
import { MacroProvider } from "../src/fred";
import { createHttp } from "../src/http";
import { fetchDisclosures, fetchInvestorFlows, fetchItemSector, fetchSectors } from "../src/naverExtra";
import { WebProvider } from "../src/webProvider";

const http = createHttp({ minIntervalMs: Number(process.env.HTTP_MIN_INTERVAL_MS ?? 700), userAgent: process.env.HTTP_USER_AGENT || undefined });
const p = new WebProvider(http);

let failed = 0;
async function check(label: string, fn: () => Promise<string>) {
  try {
    console.log(`  ✔ ${label}: ${await fn()}`);
  } catch (e) {
    failed++;
    console.log(`  ✖ ${label}: ${e instanceof Error ? e.message : e}`);
  }
}
const need = <T>(v: T[], what: string) => {
  if (!v.length) throw new Error(`${what}이(가) 비어 있어요`);
  return v;
};

console.log("[국내 — 네이버 금융]");
await check("일봉(삼성전자)", async () => {
  const c = need(await p.getCandles("005930", 60), "일봉");
  return `${c.length}개, 마지막 ${c.at(-1)!.date} 종가 ${c.at(-1)!.close.toLocaleString()}`;
});
await check("현재가(삼성전자)", async () => `${(await p.getQuote("005930")).price.toLocaleString()}원`);
await check("현재가 묶음 조회", async () => {
  const r = await p.getPrices(["005930", "000660"]);
  if (Object.keys(r).length < 2) throw new Error(`2개 중 ${Object.keys(r).length}개만 읽힘`);
  return JSON.stringify(r);
});
await check("재무(삼성전자)", async () => {
  const f = await p.getFundamentals("005930");
  if (Object.keys(f).length < 3) throw new Error(`읽힌 항목이 ${Object.keys(f).length}개뿐 — 페이지 구조 확인 필요: ${JSON.stringify(f)}`);
  return JSON.stringify(f);
});
for (const m of ["KOSPI", "KOSDAQ"] as const) {
  await check(`${m} 지수 일봉`, async () => `${need(await p.getIndexCandles(m, 100), "지수 일봉").length}개`);
  await check(`${m} 후보 순위표`, async () => {
    const u = need(await p.getUniverse(m), "순위표");
    return `${u.length}종목, 예: ${u.slice(0, 3).map((r) => `${r.name}(${r.changePct}%)`).join(", ")}`;
  });
}

await check("재무 연간·분기 실적(삼성전자)", async () => {
  const f = await p.getFundamentals("005930");
  const a = f.annual ?? [], q = f.quarterly ?? [];
  if (!a.length && !q.length) throw new Error("연간·분기 실적 표를 읽지 못했어요(3년 연속 증가·분기 EPS 점검이 빠져요)");
  return `연간 ${a.length}개(${a.map((x) => x.period).join(", ")}), 분기 ${q.length}개, 업종 PER ${f.sectorPer ?? "-"}`;
});
await check("외국인·기관 순매매(삼성전자)", async () => {
  const f = need(await fetchInvestorFlows(http, "005930", 1), "수급 표");
  const last = f.at(-1)!;
  return `${f.length}일, 마지막 ${last.date} 외국인 ${last.foreignNet.toLocaleString()} / 기관 ${last.institutionNet.toLocaleString()}`;
});
await check("공시 목록(삼성전자)", async () => {
  const d = need(await fetchDisclosures(http, "005930"), "공시 목록");
  return `${d.length}건, 최근: ${d[0]!.date} ${d[0]!.title}`;
});
await check("종목 업종(삼성전자)", async () => {
  const s = await fetchItemSector(http, "005930");
  if (!s) throw new Error("종목 페이지에서 업종 링크를 찾지 못했어요");
  return `${s.name}(no=${s.no})`;
});
await check("업종별 시세", async () => {
  const rows = need(await fetchSectors(http), "업종 표");
  return `${rows.length}개 업종, 예: ${rows.slice(0, 3).map((r) => `${r.name}(${r.changePct}%)`).join(", ")}`;
});

console.log("[해외(미국) — 야후 파이낸스]");
await check("일봉(AAPL)", async () => {
  const c = need(await p.getCandles("AAPL", 60), "일봉");
  return `${c.length}개, 마지막 ${c.at(-1)!.date} 종가 ${c.at(-1)!.close}`;
});
await check("현재가(AAPL)", async () => `$${(await p.getQuote("AAPL")).price}`);
await check("S&P500 지수 일봉", async () => `${need(await p.getIndexCandles("US", 100), "지수 일봉").length}개`);
await check("후보 순위표(상승률/거래량 상위)", async () => {
  const u = need(await p.getUniverse("US"), "순위표");
  return `${u.length}종목, 예: ${u.slice(0, 3).map((r) => `${r.code}(${r.changePct.toFixed(1)}%)`).join(", ")}`;
});
await check("종목 검색(snowflake — 내장 목록에 없는 이름)", async () => need((await p.search("snowflake")).filter((s) => s.code === "SNOW"), "검색 결과").map((s) => `${s.code}:${s.name}`).slice(0, 3).join(", "));
await check("재무(AAPL)", async () => {
  const f = await p.getFundamentals("AAPL");
  if (!Object.keys(f).length) throw new Error("재무가 비어 있어요(crumb 인증 실패일 수 있음 — 재무는 없어도 분석은 동작해요)");
  return JSON.stringify(f);
});

console.log("[매크로 — 미국 FRED]");
await check(`FRED 시계열 ${MACRO_SERIES_IDS.length}개`, async () => {
  const m = await new MacroProvider(http).getSnapshot();
  if (m.errors.length) throw new Error(m.errors.join(" / "));
  const s = m.snapshot;
  return `기준일 ${s.asOf}, 금리차 ${s.yieldSpread?.value ?? "-"}, VIX ${s.vix?.value ?? "-"}, 10년물 ${s.us10y?.value ?? "-"}, 초과유동성 ${s.excessLiquidity?.toFixed(2) ?? "-"}, 원/달러 ${s.krwPerUsd?.value ?? "-"}`;
});

console.log(failed ? `\n${failed}개 항목 실패 — 해당 사이트의 접속 가능 여부와 파서(server/src/naver.ts, naverExtra.ts, yahoo.ts, fred.ts)를 확인하세요.` : "\n모든 항목이 정상이에요.");
process.exit(failed ? 1 : 0);
