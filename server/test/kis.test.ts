import { afterEach, describe, expect, it, vi } from "vitest";
import { KisProvider } from "../src/kis";

const cfg = { appKey: "K", appSecret: "S", baseUrl: "https://kis.test", minIntervalMs: 0 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

function row(date: string, close: number) {
  return { stck_bsop_date: date, stck_oprc: String(close - 10), stck_hgpr: String(close + 20), stck_lwpr: String(close - 20), stck_clpr: String(close), acml_vol: "1,000" };
}

describe("KisProvider", () => {
  it("issues one token, pages backwards through candles, sorts and dedupes", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.endsWith("/oauth2/tokenP")) return json({ access_token: "T1", expires_in: 86400 });
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer T1");
      expect((init!.headers as Record<string, string>).tr_id).toBe("FHKST03010100");
      const q = new URL(url).searchParams;
      // 첫 호출은 최신 구간, 두 번째 호출은 과거 구간, 세 번째는 빈 응답
      const page = calls.filter((c) => c.includes("daily-itemchartprice")).length;
      if (page === 1) return json({ rt_cd: "0", output2: [row("20240110", 300), row("20240109", 290), row("20240108", 280)] });
      if (page === 2) {
        // 두 번째 구간의 종료일은 첫 구간의 가장 오래된 날 전날이어야 한다
        expect(q.get("FID_INPUT_DATE_2")).toBe("20240107");
        return json({ rt_cd: "0", output2: [row("20240108", 280), row("20240105", 270), row("20240104", 260)] });
      }
      return json({ rt_cd: "0", output2: [] });
    });
    const kis = new KisProvider(cfg);
    const cs = await kis.getCandles("005930", 100);
    expect(cs.map((c) => c.date)).toEqual(["2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09", "2024-01-10"]);
    expect(cs[0]).toMatchObject({ open: 250, high: 280, low: 240, close: 260, volume: 1000 });
    expect(calls.filter((c) => c.endsWith("/oauth2/tokenP"))).toHaveLength(1);
  });

  it("re-issues the token once when it has expired", async () => {
    let tokens = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/oauth2/tokenP")) return json({ access_token: `T${++tokens}`, expires_in: 86400 });
      const auth = (init!.headers as Record<string, string>).authorization;
      if (auth === "Bearer T1") return json({ rt_cd: "1", msg_cd: "EGW00123", msg1: "기간이 만료된 token 입니다." }, 500);
      return json({ rt_cd: "0", output: { stck_prpr: "70,000", prdy_vrss: "1,000", prdy_vrss_sign: "5", prdy_ctrt: "1.41", acml_vol: "123", hts_avls: "4,000,000" } });
    });
    const q = await new KisProvider(cfg).getQuote("005930");
    expect(tokens).toBe(2);
    expect(q).toMatchObject({ price: 70000, change: -1000, changePct: -1.41, volume: 123, marketCap: 4000000 });
  });

  it("surfaces API errors", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("/oauth2/tokenP") ? json({ access_token: "T", expires_in: 100000 }) : json({ rt_cd: "1", msg_cd: "OPSQ0002", msg1: "없는 서비스 코드" }),
    );
    await expect(new KisProvider(cfg).getQuote("005930")).rejects.toThrow(/OPSQ0002/);
  });

  it("builds fundamentals even if the ratio endpoint fails", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/oauth2/tokenP")) return json({ access_token: "T", expires_in: 100000 });
      if (url.includes("financial-ratio")) return json({ rt_cd: "1", msg_cd: "X", msg1: "fail" }, 500);
      return json({ rt_cd: "0", output: { per: "12.5", pbr: "1.2", eps: "5,000", bps: "50,000" } });
    });
    const f = await new KisProvider(cfg).getFundamentals("005930");
    expect(f).toMatchObject({ per: 12.5, pbr: 1.2, eps: 5000, bps: 50000, roe: 10 });
  });
});
