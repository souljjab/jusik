/**
 * 수집 대상 사이트(네이버 금융·야후 파이낸스)에 실제로 접속해서 각 파서가 값을 읽어내는지 확인한다.
 *   npm run check:sources -w server
 * 사이트 구조가 바뀌었거나 접속이 차단됐을 때 어떤 항목이 깨졌는지 바로 알 수 있다.
 */
import { MACRO_SERIES_IDS } from "@jusik/shared";
import { BreadthSource, NAVER_BREADTH, parseNaverBreadthToday, parseNaverMarketSum } from "../src/breadthSource";
import { DartClient } from "../src/dart";
import { MacroProvider } from "../src/fred";
import { IsmSource } from "../src/ism";
import { WebMinuteSource } from "../src/minute";
import { SecClient } from "../src/sec";
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
  // ISM은 아래에서 따로 확인한다
  if (m.errors.length) throw new Error(m.errors.join(" / "));
  const s = m.snapshot;
  return `기준일 ${s.asOf}, 금리차 ${s.yieldSpread?.value ?? "-"}, VIX ${s.vix?.value ?? "-"}, 10년물 ${s.us10y?.value ?? "-"}, 초과유동성 ${s.excessLiquidity?.toFixed(2) ?? "-"}, 원/달러 ${s.krwPerUsd?.value ?? "-"}`;
});

await check("ISM 제조업지수(ismworld.org)", async () => {
  const src = new IsmSource(http);
  const r = await src.getLatest();
  if (!r) throw new Error(src.lastError ?? "값을 찾지 못했어요(사이트가 자바스크립트로 그리거나 봇을 막을 수 있어요 — 설정에서 직접 입력하세요)");
  return `${r.month} ${r.value} (발표 ${r.date})`;
});

console.log("[시장 폭 — 네이버 금융]");
await check("시가총액 순위(코스피)", async () => {
  const rows = need(parseNaverMarketSum(await http.get(NAVER_BREADTH.marketSum("KOSPI", 1), { encoding: "auto" })), "시가총액 순위");
  return `${rows.length}종목, 예: ${rows.slice(0, 3).map((r) => r.name).join(", ")}`;
});
await check("거래소 전체 상승·하락 종목 수(코스피)", async () => {
  const t = parseNaverBreadthToday(await http.get(NAVER_BREADTH.index("KOSPI"), { encoding: "auto" }), "KOSPI");
  if (!t) throw new Error("상승·보합·하락 종목 수를 찾지 못했어요");
  return `상한 ${t.upperLimit} · 상승 ${t.up} · 보합 ${t.unchanged} · 하락 ${t.down} · 하한 ${t.lowerLimit}`;
});
await check("A/D선·MI 계산(코스피 상위 20종목, 시간이 걸려요)", async () => {
  const r = await new BreadthSource(p, http, { basketSize: 20 }).getBreadth("KOSPI");
  if (!r.analysis) throw new Error(r.errors.join(" / ") || "분석 결과가 없어요");
  return `${r.basket.length}종목 기준, ${r.analysis.asOf}, 점수 ${r.analysis.score}, MI ${r.analysis.mi.at(-1)?.value ?? "-(200일 부족)"}`;
});

console.log("[분봉]");
const minute = new WebMinuteSource(http);
await check("1분봉(삼성전자, 네이버)", async () => `${need(await minute.getMinuteBars("005930", 1), "분봉").length}개`);
await check("1분봉(AAPL, 야후)", async () => `${need(await minute.getMinuteBars("AAPL", 1), "분봉").length}개`);

console.log("[미국 보유 현황·공시·실적]");
await check("기관·내부자·공매도(AAPL, 야후)", async () => {
  const h = await p.getUsHolders("AAPL");
  if (!Object.keys(h).length) throw new Error("보유 현황이 비어 있어요(crumb 인증 실패일 수 있어요)");
  return `기관 ${h.institutionsPct ?? "-"}% · 내부자 ${h.insidersPct ?? "-"}% · 공매도 ${h.shortPctFloat ?? "-"}%`;
});
if (process.env.SEC_USER_AGENT) {
  const sec = new SecClient(http, { userAgent: process.env.SEC_USER_AGENT });
  await check("SEC 공시(AAPL)", async () => {
    const f = need(await sec.filings("AAPL", 120), "공시 목록");
    return `${f.length}건, 최근: ${f[0]!.date} ${f[0]!.title}`;
  });
  await check("SEC 실적(AAPL, XBRL)", async () => {
    const f = await sec.financials("AAPL");
    if (!f.annual.length) throw new Error("연간 실적이 비어 있어요");
    return `연간 ${f.annual.length}개(${f.annual.at(-1)!.period} 매출 ${f.annual.at(-1)!.revenue ?? "-"}백만 달러), 분기 ${f.quarterly.length}개`;
  });
} else console.log("  - SEC: SEC_USER_AGENT가 없어 건너뛰었어요(server/.env.example 참고)");

console.log("[DART 오픈API]");
if (process.env.DART_API_KEY) {
  const dart = new DartClient(http, process.env.DART_API_KEY);
  await check("회사 고유번호(삼성전자)", async () => (await dart.corpCodeOf("005930")) ?? "못 찾음");
  await check("DART 공시 목록(삼성전자)", async () => {
    const d = need(await dart.disclosures("005930", 30), "공시 목록");
    return `${d.length}건, 최근: ${d[0]!.date} ${d[0]!.title}`;
  });
  await check("DART 연간 주요 계정(삼성전자)", async () => {
    const a = need(await dart.annual("005930", 3), "연간 실적");
    return a.map((x) => `${x.period} 매출 ${x.revenue ?? "-"}억`).join(", ");
  });
} else console.log("  - DART: DART_API_KEY가 없어 건너뛰었어요(server/.env.example 참고)");

console.log(failed ? `\n${failed}개 항목 실패 — 해당 사이트의 접속 가능 여부와 파서(server/src/naver.ts, naverExtra.ts, yahoo.ts, fred.ts, ism.ts, breadthSource.ts, minute.ts, sec.ts, dart.ts)를 확인하세요.` : "\n모든 항목이 정상이에요.");
process.exit(failed ? 1 : 0);
