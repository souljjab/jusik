import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MockProvider } from "../src/mock";
import { TtlCache } from "../src/cache";
import { analyze } from "@jusik/shared";

describe("api (mock provider)", () => {
  const app = buildApp(new MockProvider());

  it("health reports sample data", async () => {
    const res = await app.inject("/api/health");
    expect(res.json()).toEqual({ ok: true, provider: "mock", sample: true });
  });

  it("searches by name and code", async () => {
    const byName = (await app.inject("/api/search?q=삼성")).json().results;
    expect(byName.map((s: { code: string }) => s.code)).toContain("005930");
    const byCode = (await app.inject("/api/search?q=0287")).json().results;
    expect(byCode).toEqual([]);
    const byCode2 = (await app.inject("/api/search?q=02830")).json().results;
    expect(byCode2[0].name).toBe("HLB");
  });

  it("rejects bad codes", async () => {
    expect((await app.inject("/api/stocks/abc/candles")).statusCode).toBe(400);
  });

  it("returns sorted, valid candles and a full analysis can be computed", async () => {
    const { candles } = (await app.inject("/api/stocks/005930/candles?count=750")).json();
    expect(candles).toHaveLength(750);
    for (let i = 1; i < candles.length; i++) expect(candles[i].date > candles[i - 1].date).toBe(true);
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
    const { fundamentals } = (await app.inject("/api/stocks/005930/overview")).json();
    const { candles: indexCandles } = (await app.inject("/api/index/KOSPI/candles?count=750")).json();
    const a = analyze({ candles, fundamentals, indexCandles });
    expect(a).not.toBeNull();
    expect(a!.regime).not.toBeNull();
    expect(a!.screening.known).toBeGreaterThanOrEqual(6);
  });

  it("serves index candles and rejects unknown markets", async () => {
    const ok = (await app.inject("/api/index/KOSDAQ/candles?count=100")).json();
    expect(ok.candles).toHaveLength(100);
    expect((await app.inject("/api/index/NASDAQ/candles")).statusCode).toBe(400);
  });

  it("mock data is deterministic per code", async () => {
    const a = (await new MockProvider().getCandles("000660", 50)).map((c) => c.close);
    const b = (await new MockProvider().getCandles("000660", 50)).map((c) => c.close);
    expect(a).toEqual(b);
  });
});

describe("TtlCache", () => {
  it("shares in-flight loads and does not cache failures", async () => {
    const cache = new TtlCache(1000);
    let calls = 0;
    const load = async () => (++calls, "x");
    await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect(calls).toBe(1);
    let n = 0;
    const flaky = async () => {
      if (++n === 1) throw new Error("boom");
      return "ok";
    };
    await expect(cache.get("f", flaky)).rejects.toThrow("boom");
    await expect(cache.get("f", flaky)).resolves.toBe("ok");
  });
});
