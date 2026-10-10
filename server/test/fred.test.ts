import { describe, expect, it } from "vitest";
import { FRED, MacroProvider, parseFredCsv } from "../src/fred";
import { HttpError, type Http } from "../src/http";

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

/** 시리즈 ID → 응답 본문(또는 상태 코드). 없으면 404 */
function fakeHttp(routes: Record<string, string | number>): Http & { calls: string[] } {
  const calls: string[] = [];
  const getResponse = async (url: string) => {
    calls.push(url);
    const id = new URL(url).searchParams.get("id") ?? "";
    const r = routes[id];
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
};

describe("MacroProvider", () => {
  it("fetches all six series sequentially and builds a snapshot", async () => {
    const http = fakeHttp(ALL);
    const now = Date.parse("2024-03-18T00:00:00Z");
    const p = new MacroProvider(http, 6 * 3_600_000, { now: () => now });
    const { snapshot, errors, fetchedAt } = await p.getSnapshot();
    expect(errors).toEqual([]);
    expect(fetchedAt).toBe("2024-03-18T00:00:00.000Z");
    expect(http.calls.map((u) => new URL(u).searchParams.get("id"))).toEqual(["T10Y2Y", "VIXCLS", "DGS10", "M2SL", "GDP", "DEXKOUS"]);
    expect(http.calls[0]).toContain("cosd=2021-");
    expect(snapshot.yieldSpread).toEqual({ value: -0.2, date: "2024-03-15" });
    expect(snapshot.us10y?.value).toBe(4.3);
    expect(snapshot.gdpYoY?.value).toBeCloseTo(6, 9);
    expect(snapshot.m2YoY?.value).toBeCloseTo((101.3 / 100.1 - 1) * 100, 9);
    expect(snapshot.excessLiquidity).toBeDefined();
    // "." 하나가 빠져 20개 관측치 → 20개 전 비교에 필요한 21개가 안 됨
    expect(snapshot.krwPerUsd?.value).toBe(1340);
    expect(snapshot.krwChange20dPct).toBeUndefined();
  });

  it("keeps going when a series fails and reports it", async () => {
    const http = fakeHttp({ ...ALL, VIXCLS: 500, GDP: "<!DOCTYPE html><html></html>" });
    const p = new MacroProvider(http, 6 * 3_600_000, { lookbackDays: null });
    const { snapshot, errors } = await p.getSnapshot();
    expect(http.calls).toHaveLength(6);
    expect(http.calls.every((u) => !u.includes("cosd"))).toBe(true);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^VIXCLS: /);
    expect(errors[1]).toMatch(/^GDP: .*값을 찾지 못했어요/);
    expect(snapshot.vix).toBeUndefined();
    expect(snapshot.gdpYoY).toBeUndefined();
    expect(snapshot.yieldSpread?.value).toBe(-0.2);
  });

  it("caches results for the TTL and retries sooner after failures", async () => {
    let now = 0;
    const http = fakeHttp(ALL);
    const p = new MacroProvider(http, 1000, { now: () => now });
    await Promise.all([p.getSnapshot(), p.getSnapshot()]); // 동시 요청은 한 번만 수집
    expect(http.calls).toHaveLength(6);
    now = 999;
    await p.getSnapshot();
    expect(http.calls).toHaveLength(6);
    now = 1000;
    await p.getSnapshot();
    expect(http.calls).toHaveLength(12);

    // 전부 실패하면 캐시하지 않는다
    const down = fakeHttp({});
    const q = new MacroProvider(down, 1000, { now: () => now });
    expect((await q.getSnapshot()).errors).toHaveLength(6);
    await q.getSnapshot();
    expect(down.calls).toHaveLength(12);

    // 일부 실패면 partialTtlMs만큼만 둔다
    const partial = fakeHttp({ ...ALL, DGS10: 503 });
    const r = new MacroProvider(partial, 10_000, { now: () => now, partialTtlMs: 100 });
    await r.getSnapshot();
    now += 50;
    await r.getSnapshot();
    expect(partial.calls).toHaveLength(6);
    now += 100;
    await r.getSnapshot();
    expect(partial.calls).toHaveLength(12);
  });

  it("exposes raw series for point-in-time rebuilds", async () => {
    const p = new MacroProvider(fakeHttp(ALL));
    const { series } = await p.getSeries();
    expect(Object.keys(series).sort()).toEqual(["DEXKOUS", "DGS10", "GDP", "M2SL", "T10Y2Y", "VIXCLS"]);
    expect(series.DEXKOUS).toHaveLength(20);
  });
});
