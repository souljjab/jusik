import { describe, expect, it } from "vitest";
import { macroNotes, macroPressure, type IsmReading } from "@jusik/shared";
import { FRED, MacroProvider, parseFredCsv, type IsmLatestSource } from "../src/fred";
import { HttpError, type Http } from "../src/http";
import { ISM_URL, IsmSource } from "../src/ism";

/*
 * 아래 CSV는 FRED 그래프 다운로드 형식을 흉내 낸 가짜 샘플이다(숫자도 지어낸 값).
 * 외부 접속이 막힌 환경이라 실제 응답과 대조하지 못했다.
 */
const OLD_STYLE = "DATE,T10Y2Y\n2024-01-02,-0.38\n2024-01-03,.\n2024-01-04,-0.35\n";
const NEW_STYLE = "﻿observation_date,T10Y2Y\r\n2024-01-04,-0.35\r\n2024-01-02,-0.38\r\n2024-01-03,\r\n";

describe("parseFredCsv", () => {
  it("reads both header styles, skips missing values and sorts by date", () => {
    const expected = [{ date: "2024-01-02", value: -0.38 }, { date: "2024-01-04", value: -0.35 }];
    expect(parseFredCsv(OLD_STYLE)).toEqual(expected);
    expect(parseFredCsv(NEW_STYLE)).toEqual(expected);
  });
  it("returns [] for HTML or error bodies", () => {
    expect(parseFredCsv("<!DOCTYPE html><html><body>Error</body></html>")).toEqual([]);
    expect(parseFredCsv("")).toEqual([]);
    expect(parseFredCsv("Bad Request. The series does not exist.")).toEqual([]);
    expect(parseFredCsv("DATE,T10Y2Y\n")).toEqual([]);
  });
  it("ignores malformed rows", () => {
    expect(parseFredCsv("DATE,VIXCLS\nfoo,1\n2024-01-02,abc\n2024-01-03,13.2\n")).toEqual([{ date: "2024-01-03", value: 13.2 }]);
  });
  it("builds the download URL with an optional start date", () => {
    expect(FRED.csv("DGS10")).toBe("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10");
    expect(FRED.csv("GDP", "2021-01-01")).toBe("https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDP&cosd=2021-01-01");
  });
});

/** 시리즈 ID(FRED) 또는 전체 URL(그 밖) → 응답 본문(또는 상태 코드). 없으면 404 */
function fakeHttp(routes: Record<string, string | number>): Http & { calls: string[] } {
  const calls: string[] = [];
  const getResponse = async (url: string) => {
    calls.push(url);
    const id = new URL(url).searchParams.get("id");
    const r = id ? routes[id] : routes[url];
    if (r == null) return { status: 404, headers: new Headers(), text: "" };
    if (typeof r === "number") return { status: r, headers: new Headers(), text: "<html>error</html>" };
    return { status: 200, headers: new Headers(), text: r };
  };
  return {
    calls,
    getResponse,
    async get(url) {
      const r = await getResponse(url);
      if (r.status < 200 || r.status >= 300) throw new HttpError(r.status, url);
      return r.text;
    },
  };
}

const csv = (id: string, rows: [string, number | "."][]) => `observation_date,${id}\n${rows.map(([d, v]) => `${d},${v}`).join("\n")}\n`;
const months = (y: number, n: number, f: (k: number) => number): [string, number][] =>
  Array.from({ length: n }, (_, k) => [new Date(Date.UTC(y, k, 1)).toISOString().slice(0, 10), f(k)]);

const ALL: Record<string, string> = {
  T10Y2Y: csv("T10Y2Y", [["2024-03-14", 0.1], ["2024-03-15", -0.2]]),
  VIXCLS: csv("VIXCLS", [["2024-03-15", 14.5]]),
  DGS10: csv("DGS10", [["2024-03-15", 4.3]]),
  M2SL: csv("M2SL", months(2023, 14, (k) => 100 + k * 0.1)),
  GDP: csv("GDP", [["2023-01-01", 100], ["2023-04-01", 101], ["2023-07-01", 102], ["2023-10-01", 103], ["2024-01-01", 106]]),
  DEXKOUS: csv("DEXKOUS", Array.from({ length: 21 }, (_, k): [string, number | "."] => [new Date(Date.UTC(2024, 1, 1 + k)).toISOString().slice(0, 10), k === 20 ? 1340 : k === 5 ? "." : 1300])),
  // 지역 연준 제조업 지수(ISM 대용): 2월분까지 둘 다 0 아래
  GACDFSA066MSFRBPHI: csv("GACDFSA066MSFRBPHI", [["2024-01-01", -10.6], ["2024-02-01", -5.2]]),
  GACDINA066MSFRBNY: csv("GACDINA066MSFRBNY", [["2024-01-01", -43.7], ["2024-02-01", -2.4]]),
};

describe("MacroProvider", () => {
  it("fetches all eight series sequentially and builds a snapshot", async () => {
    const http = fakeHttp(ALL);
    const now = Date.parse("2024-03-18T00:00:00Z");
    const p = new MacroProvider(http, 6 * 3_600_000, { now: () => now });
    const { snapshot, errors, fetchedAt } = await p.getSnapshot();
    expect(errors).toEqual([]);
    expect(fetchedAt).toBe("2024-03-18T00:00:00.000Z");
    expect(http.calls.map((u) => new URL(u).searchParams.get("id"))).toEqual(["T10Y2Y", "VIXCLS", "DGS10", "M2SL", "GDP", "DEXKOUS", "GACDFSA066MSFRBPHI", "GACDINA066MSFRBNY"]);
    expect(http.calls[0]).toContain("cosd=2021-");
    expect(snapshot.yieldSpread).toEqual({ value: -0.2, date: "2024-03-15" });
    expect(snapshot.us10y?.value).toBe(4.3);
    expect(snapshot.gdpYoY?.value).toBeCloseTo(6, 9);
    expect(snapshot.m2YoY?.value).toBeCloseTo((101.3 / 100.1 - 1) * 100, 9);
    expect(snapshot.excessLiquidity).toBeDefined();
    // "." 하나가 빠져 20개 관측치 → 20개 전 비교에 필요한 21개가 안 됨
    expect(snapshot.krwPerUsd?.value).toBe(1340);
    expect(snapshot.krwChange20dPct).toBeUndefined();
    expect(snapshot.ismProxy).toEqual({ philly: { value: -5.2, date: "2024-02-01" }, empire: { value: -2.4, date: "2024-02-01" } });
    expect(snapshot.ism).toBeUndefined(); // ISM 공급자를 주지 않았다
  });

  it("keeps going when a series fails and reports it", async () => {
    const http = fakeHttp({ ...ALL, VIXCLS: 500, GDP: "<!DOCTYPE html><html></html>" });
    const p = new MacroProvider(http, 6 * 3_600_000, { lookbackDays: null });
    const { snapshot, errors } = await p.getSnapshot();
    expect(http.calls).toHaveLength(8);
    expect(http.calls.every((u) => !u.includes("cosd"))).toBe(true);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^VIXCLS: /);
    expect(errors[1]).toMatch(/^GDP: .*값을 찾지 못했어요/);
    expect(snapshot.vix).toBeUndefined();
    expect(snapshot.gdpYoY).toBeUndefined();
    expect(snapshot.yieldSpread?.value).toBe(-0.2);
  });

  it("serves the last good series during an outage instead of dropping the macro penalty", async () => {
    let now = 0;
    const routes: Record<string, string | number> = { ...ALL };
    const p = new MacroProvider(fakeHttp(routes), 1000, { now: () => now });
    expect((await p.getSnapshot()).snapshot.yieldSpread?.value).toBe(-0.2);
    for (const k of Object.keys(routes)) routes[k] = 503;
    now = 5000;
    const out = await p.getSnapshot();
    expect(out.errors).toHaveLength(8);
    expect(out.errors.every((e) => e.includes("지난번에 받은 값"))).toBe(true);
    expect(out.snapshot.yieldSpread).toEqual({ value: -0.2, date: "2024-03-15" });
    expect(out.snapshot.vix?.value).toBe(14.5);
  });

  it("caches results for the TTL and retries sooner after failures", async () => {
    let now = 0;
    const http = fakeHttp(ALL);
    const p = new MacroProvider(http, 1000, { now: () => now });
    await Promise.all([p.getSnapshot(), p.getSnapshot()]); // 동시 요청은 한 번만 수집
    expect(http.calls).toHaveLength(8);
    now = 999;
    await p.getSnapshot();
    expect(http.calls).toHaveLength(8);
    now = 1000;
    await p.getSnapshot();
    expect(http.calls).toHaveLength(16);

    // 전부 실패하면 캐시하지 않는다
    const down = fakeHttp({});
    const q = new MacroProvider(down, 1000, { now: () => now });
    expect((await q.getSnapshot()).errors).toHaveLength(8);
    await q.getSnapshot();
    expect(down.calls).toHaveLength(16);

    // 일부 실패면 partialTtlMs만큼만 둔다
    const partial = fakeHttp({ ...ALL, DGS10: 503 });
    const r = new MacroProvider(partial, 10_000, { now: () => now, partialTtlMs: 100 });
    await r.getSnapshot();
    now += 50;
    await r.getSnapshot();
    expect(partial.calls).toHaveLength(8);
    now += 100;
    await r.getSnapshot();
    expect(partial.calls).toHaveLength(16);
  });

  it("exposes raw series for point-in-time rebuilds", async () => {
    const p = new MacroProvider(fakeHttp(ALL));
    const { series } = await p.getSeries();
    expect(Object.keys(series).sort()).toEqual(["DEXKOUS", "DGS10", "GACDFSA066MSFRBPHI", "GACDINA066MSFRBNY", "GDP", "M2SL", "T10Y2Y", "VIXCLS"]);
    expect(series.DEXKOUS).toHaveLength(20);
  });
});

/** 테스트가 정하는 ISM 공급자 */
function fakeIsm(reading: IsmReading | null | Error, lastError: string | null = null): IsmLatestSource & { calls: number } {
  return {
    calls: 0,
    lastError,
    async getLatest() {
      this.calls++;
      if (reading instanceof Error) throw reading;
      return reading;
    },
  };
}

const NOW = Date.parse("2024-03-18T00:00:00Z");
const FEB: IsmReading = { value: 47.8, month: "2024-02", date: "2024-03-01", source: "ISM" };
const provider = (ism?: IsmLatestSource, routes: Record<string, string | number> = ALL) => new MacroProvider(fakeHttp(routes), 6 * 3_600_000, { now: () => NOW, ...(ism && { ism }) });

describe("MacroProvider + ISM", () => {
  it("attaches the scraped ISM and counts it in the macro pressure", async () => {
    const { snapshot, errors } = await provider(fakeIsm(FEB)).getSnapshot();
    expect(errors).toEqual([]);
    expect(snapshot.ism).toEqual(FEB);
    expect(snapshot.ismProxy?.philly?.value).toBe(-5.2); // 대용 지표도 자료로는 남긴다
    // 금리차 역전 + 초과 유동성 마이너스 + ISM 47.8
    expect(macroPressure(snapshot)).toBe(3);
    expect(macroNotes(snapshot, "KR").some((n) => n.text.includes("반도체 대형주"))).toBe(true);
  });

  it("a manual override takes precedence over the scraped value (source 수동, date = estimated release)", async () => {
    const p = provider(fakeIsm(FEB));
    const out = await p.getSnapshot({ ism: { value: 52.1, month: "2024-02" } });
    expect(out.errors).toEqual([]);
    expect(out.snapshot.ism).toEqual({ value: 52.1, month: "2024-02", date: "2024-03-01", source: "수동" });
    expect(macroPressure(out.snapshot)).toBe(2);
    // 덮어쓰기는 그 호출에만 적용된다(캐시되지 않음)
    expect((await p.getSnapshot()).snapshot.ism).toEqual(FEB);
    expect((await p.getSnapshot({ ism: null })).snapshot.ism).toEqual(FEB);
  });

  it("keeps the manual value even when the site has a newer month, but says so", async () => {
    const out = await provider(fakeIsm(FEB)).getSnapshot({ ism: { value: 49.1, month: "2024-01" } });
    expect(out.snapshot.ism).toEqual({ value: 49.1, month: "2024-01", date: "2024-02-01", source: "수동" });
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain("더 새 값(2024-02 47.8)");
  });

  it("works with a manual value and no ISM source at all", async () => {
    const out = await provider().getSnapshot({ ism: { value: 50.3, month: "2024-02" } });
    expect(out.errors).toEqual([]);
    expect(out.snapshot.ism?.source).toBe("수동");
  });

  it("an invalid manual value is reported and the scraped value is used", async () => {
    const bad = await provider(fakeIsm(FEB)).getSnapshot({ ism: { value: 47, month: "2024-03" } }); // 아직 안 끝난 달
    expect(bad.snapshot.ism).toEqual(FEB);
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toMatch(/^ISM 수동 입력: .*발표되지 않은 달/);
    const range = await provider(fakeIsm(FEB)).getSnapshot({ ism: { value: 147, month: "2024-02" } });
    expect(range.snapshot.ism).toEqual(FEB);
    expect(range.errors[0]).toContain("20~80");
  });

  it("ISM failures go into errors but never fail the snapshot (proxies take over)", async () => {
    const thrown = await provider(fakeIsm(new Error("boom"))).getSnapshot();
    expect(thrown.errors).toEqual(["ISM: boom"]);
    expect(thrown.snapshot.ism).toBeUndefined();
    expect(thrown.snapshot.yieldSpread?.value).toBe(-0.2);
    // ISM이 없으니 대용 지표 두 개(둘 다 0 아래)가 감점 1개
    expect(macroPressure(thrown.snapshot)).toBe(3);
    expect(macroNotes(thrown.snapshot).some((n) => n.text.includes("지역 연준 제조업 지수 수축(ISM 대용)"))).toBe(true);

    const empty = await provider(fakeIsm(null, "최신 보고서에서 PMI 값을 찾지 못했어요")).getSnapshot();
    expect(empty.errors).toEqual(["ISM: 최신 보고서에서 PMI 값을 찾지 못했어요"]);
    expect((await provider(fakeIsm(null)).getSnapshot()).errors).toEqual(["ISM: 값을 받지 못했어요"]);

    const stale = await provider(fakeIsm(FEB, "HTTP 503")).getSnapshot();
    expect(stale.snapshot.ism).toEqual(FEB);
    expect(stale.errors).toEqual(["ISM: HTTP 503 — 지난번에 받은 값(2024-02)으로 대신해요"]);
  });

  it("does not repeat scraper errors while a manual value is in use", async () => {
    const out = await provider(fakeIsm(new Error("blocked"))).getSnapshot({ ism: { value: 48.2, month: "2024-02" } });
    expect(out.errors).toEqual([]);
    expect(out.snapshot.ism?.value).toBe(48.2);
  });

  it("drops a stale ISM, reports it and falls back to the proxies", async () => {
    const old: IsmReading = { value: 46.7, month: "2023-10", date: "2023-11-01", source: "ISM" };
    const out = await provider(fakeIsm(old)).getSnapshot();
    expect(out.snapshot.ism).toBeUndefined();
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain("2023-10(ISM) 값이 오래돼");
    expect(macroPressure(out.snapshot)).toBe(3);
  });

  it("end to end with IsmSource over the same Http", async () => {
    const page = "<h1>Manufacturing PMI&reg; at 47.8%; February 2024 Manufacturing ISM&reg; Report On Business&reg;</h1>";
    const http = fakeHttp({ ...ALL, [ISM_URL]: page });
    const p = new MacroProvider(http, 6 * 3_600_000, { now: () => NOW, ism: new IsmSource(http, { now: () => NOW }) });
    const out = await p.getSnapshot();
    expect(out.errors).toEqual([]);
    expect(out.snapshot.ism).toEqual(FEB);
    expect(http.calls).toHaveLength(9);
    expect(http.calls).toContain(ISM_URL);

    // ISM 사이트가 막혀도(두 페이지 모두 404) 스냅샷은 나온다
    const down = fakeHttp(ALL);
    const q = new MacroProvider(down, 6 * 3_600_000, { now: () => NOW, ism: new IsmSource(down, { now: () => NOW }) });
    const r = await q.getSnapshot();
    expect(r.snapshot.ism).toBeUndefined();
    expect(r.snapshot.ismProxy?.empire?.value).toBe(-2.4);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^ISM: 최신 보고서: HTTP 404/);
    expect(down.calls).toContain(`${ISM_URL}february/`);
  });
});
