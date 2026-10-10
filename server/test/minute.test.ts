import { describe, expect, it } from "vitest";
import type { Candle } from "@jusik/shared";
import { assessIntraday, barMinutes, INTRADAY_SESSIONS, type IntradayBar } from "@jusik/shared";
import type { GetOptions, Http } from "../src/http";
import {
  decumulateVolume, latestSessions, MINUTE_PARAMS, MINUTE_URLS, MockMinuteSource, parseNaverMinute, parseYahooMinute, sessionBars,
  synthMinuteSession, WebMinuteSource,
} from "../src/minute";

// ⚠ 아래 샘플은 사이트 응답 형식을 기억대로 흉내 낸 것이다(실제 응답과 대조하지 못함, 미검증).

const naverXml = (items: string[]) => `<?xml version="1.0" encoding="EUC-KR" ?>
<protocol><chartdata symbol="005930" name="삼성전자" count="${items.length}" timeframe="minute" precision="0" origintime="19900103">
${items.map((d) => `<item data="${d}" />`).join("\n")}
</chartdata></protocol>`;

describe("parseNaverMinute", () => {
  it("fills null open/high/low from close and keeps per-minute volume", () => {
    const bars = parseNaverMinute(naverXml([
      "202403180900|null|null|null|72000|15000",
      "202403180901|null|null|null|72100|9000",
      "202403180902|72100|72300|71900|72200|11000",
      "202403180903|72200|72100|72250|72300|4000", // 고가<종가, 저가>시가: 일관되게 보정
    ]));
    expect(bars).toEqual([
      { t: "2024-03-18T09:00", open: 72000, high: 72000, low: 72000, close: 72000, volume: 15000 },
      { t: "2024-03-18T09:01", open: 72100, high: 72100, low: 72100, close: 72100, volume: 9000 },
      { t: "2024-03-18T09:02", open: 72100, high: 72300, low: 71900, close: 72200, volume: 11000 },
      { t: "2024-03-18T09:03", open: 72200, high: 72300, low: 72200, close: 72300, volume: 4000 },
    ]);
  });

  it("detects cumulative daily volume and differences it, per day", () => {
    const bars = parseNaverMinute(naverXml([
      "202403150929|null|null|null|100|500",
      "202403151519|null|null|null|101|800",
      "202403151530|null|null|null|102|800",
      "202403151518|null|null|null|101|700",
      "202403151517|null|null|null|100|600",
      "202403180900|null|null|null|100|1000",
      "202403180901|null|null|null|101|1500",
      "202403180902|null|null|null|102|1500",
      "202403180903|null|null|null|101|2600",
      "202403180904|null|null|null|103|3000",
      "202403180905|null|null|null|104|3400",
    ]));
    expect(bars.map((b) => b.t.slice(5))).toEqual([
      "03-15T09:29", "03-15T15:17", "03-15T15:18", "03-15T15:19", "03-15T15:30",
      "03-18T09:00", "03-18T09:01", "03-18T09:02", "03-18T09:03", "03-18T09:04", "03-18T09:05",
    ]);
    expect(bars.map((b) => b.volume)).toEqual([500, 100, 100, 100, 0, 1000, 500, 0, 1100, 400, 400]);
  });

  it("leaves volume alone when it ever decreases, or when there are too few bars to tell", () => {
    expect(parseNaverMinute(naverXml(["202403180900|null|null|null|1|100", "202403180901|null|null|null|1|200", "202403180902|null|null|null|1|50", "202403180903|null|null|null|1|300", "202403180904|null|null|null|1|400"])).map((b) => b.volume)).toEqual([100, 200, 50, 300, 400]);
    expect(parseNaverMinute(naverXml(["202403180900|null|null|null|1|100", "202403180901|null|null|null|1|200"])).map((b) => b.volume)).toEqual([100, 200]);
    // 같은 값만 이어지면(늘어난 적 없음) 누적으로 보지 않는다
    expect(decumulateVolume(parseNaverMinute(naverXml(Array.from({ length: 6 }, (_, i) => `20240318090${i}|null|null|null|1|100`)))).map((b) => b.volume)).toEqual([100, 100, 100, 100, 100, 100]);
  });

  it("skips junk: zero/null close, impossible times, and dedupes repeated minutes (last wins)", () => {
    const bars = parseNaverMinute(naverXml([
      "202403180900|null|null|null|0|100",
      "202403180901|null|null|null|null|100",
      "202403182461|null|null|null|10|100",
      "202403180902|null|null|null|10|100",
      "202403180902|null|null|null|11|120",
      "2024031809|1|1|1|1|1",
    ]));
    expect(bars).toEqual([{ t: "2024-03-18T09:02", open: 11, high: 11, low: 11, close: 11, volume: 120 }]);
    expect(parseNaverMinute("<html>점검 중</html>")).toEqual([]);
    expect(parseNaverMinute("")).toEqual([]);
  });
});

describe("parseYahooMinute", () => {
  const t0 = Date.UTC(2024, 2, 18, 13, 30) / 1000; // 09:30 EDT
  const json = (meta: Record<string, unknown>) => JSON.stringify({
    chart: {
      result: [{
        meta: { symbol: "AAPL", exchangeTimezoneName: "America/New_York", ...meta },
        timestamp: [t0, t0 + 60, t0 + 120, t0 + 180, t0 + 180 + 47],
        indicators: { quote: [{ open: [172.1, null, null, 172.6, 172.7], high: [172.5, null, 172.7, 172.9, 172.95], low: [172.0, null, 172.3, 172.5, 172.4], close: [172.3, null, 172.6, 172.8, 172.75], volume: [120000, null, 80000, null, 5000] }] },
      }],
      error: null,
    },
  });

  it("converts UTC timestamps to exchange-local minutes with gmtoffset and skips null closes", () => {
    const bars = parseYahooMinute(json({ gmtoffset: -14400 }));
    expect(bars).toEqual([
      { t: "2024-03-18T09:30", open: 172.1, high: 172.5, low: 172, close: 172.3, volume: 120000 },
      { t: "2024-03-18T09:32", open: 172.6, high: 172.7, low: 172.3, close: 172.6, volume: 80000 },
      // 09:33:47의 진행 중 스냅숏이 09:33 봉을 대신한다
      { t: "2024-03-18T09:33", open: 172.7, high: 172.95, low: 172.4, close: 172.75, volume: 5000 },
    ]);
  });

  it("returns [] when the local offset or the structure is missing", () => {
    expect(parseYahooMinute(json({}))).toEqual([]);
    expect(parseYahooMinute(json({ gmtoffset: "x" }))).toEqual([]);
    expect(parseYahooMinute("not json")).toEqual([]);
    expect(parseYahooMinute(JSON.stringify({ chart: { result: null, error: { code: "Not Found" } } }))).toEqual([]);
    expect(parseYahooMinute(JSON.stringify({ chart: { result: [{ meta: { gmtoffset: 0 }, indicators: { quote: [{}] } }] } }))).toEqual([]);
  });
});

describe("session helpers", () => {
  const bar = (t: string): IntradayBar => ({ t, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  const bars = ["2024-03-15T08:30", "2024-03-15T09:00", "2024-03-15T15:30", "2024-03-15T16:00", "2024-03-18T08:59", "2024-03-18T09:00", "2024-03-18T10:00", "2024-03-18T19:00"].map(bar);
  it("sessionBars keeps one date and, with a window, the regular session including the closing print", () => {
    expect(sessionBars(bars, "2024-03-18").map((b) => b.t.slice(11))).toEqual(["08:59", "09:00", "10:00", "19:00"]);
    expect(sessionBars(bars, "2024-03-15", INTRADAY_SESSIONS.KR).map((b) => b.t.slice(11))).toEqual(["09:00", "15:30"]);
  });
  it("latestSessions keeps the most recent n dates", () => {
    expect(latestSessions(bars, 1, INTRADAY_SESSIONS.KR).map((b) => b.t)).toEqual(["2024-03-18T09:00", "2024-03-18T10:00"]);
    expect(latestSessions(bars, 2, INTRADAY_SESSIONS.KR)).toHaveLength(4);
    expect(latestSessions([], 1)).toEqual([]);
    // 장 시작 전 장외 봉만 있는 날은 세션으로 세지 않는다
    expect(latestSessions([...bars, bar("2024-03-19T08:00")], 1, INTRADAY_SESSIONS.KR).map((b) => b.t)).toEqual(["2024-03-18T09:00", "2024-03-18T10:00"]);
  });
});

class FakeHttp implements Http {
  calls: { url: string; opt?: GetOptions }[] = [];
  constructor(private body: (url: string) => string) {}
  async get(url: string, opt?: GetOptions) {
    this.calls.push({ url, opt });
    return this.body(url);
  }
  async getResponse(url: string, opt?: GetOptions) {
    return { status: 200, headers: new Headers(), text: await this.get(url, opt) };
  }
}

describe("WebMinuteSource", () => {
  it("routes KR codes to Naver (EUC-KR auto), clips to the regular session and keeps the latest session", async () => {
    const xml = naverXml(["202403150900|null|null|null|10|1", "202403151530|null|null|null|11|1", "202403180830|null|null|null|9|1", "202403180900|null|null|null|12|1", "202403180901|null|null|null|13|1", "202403181600|null|null|null|14|1"]);
    const http = new FakeHttp(() => xml);
    const src = new WebMinuteSource(http);
    expect(src.sample).toBe(false);
    const bars = await src.getMinuteBars("005930");
    expect(http.calls[0]).toEqual({ url: MINUTE_URLS.naver("005930", MINUTE_PARAMS.naverBarsPerSession), opt: { encoding: "auto" } });
    expect(http.calls[0]!.url).toBe("https://fchart.stock.naver.com/sise.nhn?symbol=005930&timeframe=minute&count=800&requestType=0");
    expect(bars.map((b) => b.t)).toEqual(["2024-03-18T09:00", "2024-03-18T09:01"]);
    const two = await src.getMinuteBars("005930", 2);
    expect(http.calls[1]!.url).toContain("count=1600");
    expect(two.map((b) => b.t)).toEqual(["2024-03-15T09:00", "2024-03-15T15:30", "2024-03-18T09:00", "2024-03-18T09:01"]);
  });

  it("routes tickers to Yahoo 1-minute chart (1d, or 5d for several sessions)", async () => {
    const t0 = Date.UTC(2024, 2, 18, 13, 29) / 1000; // 09:29 EDT(장 전) → 잘린다
    const body = JSON.stringify({ chart: { result: [{ meta: { gmtoffset: -14400 }, timestamp: [t0, t0 + 60, t0 + 120], indicators: { quote: [{ open: [1, 2, 3], high: [1, 2, 3], low: [1, 2, 3], close: [1, 2, 3], volume: [1, 2, 3] }] } }] } });
    const http = new FakeHttp(() => body);
    const src = new WebMinuteSource(http);
    const bars = await src.getMinuteBars("AAPL");
    expect(http.calls[0]!.url).toBe("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1m&range=1d");
    expect(bars.map((b) => b.t.slice(11))).toEqual(["09:30", "09:31"]);
    await src.getMinuteBars("BRK.B", 3);
    expect(http.calls[1]!.url).toBe("https://query1.finance.yahoo.com/v8/finance/chart/BRK.B?interval=1m&range=5d");
  });
});

describe("MockMinuteSource (sample)", () => {
  const kr: Candle[] = [
    { date: "2024-03-14", open: 9_900, high: 10_100, low: 9_800, close: 10_000, volume: 900_000 },
    { date: "2024-03-15", open: 10_000, high: 10_400, low: 9_700, close: 9_900, volume: 1_000_000 },
    { date: "2024-03-18", open: 10_200, high: 10_600, low: 10_100, close: 10_500, volume: 2_000_000 },
  ];
  const daily = (cs: Candle[]) => async () => cs;
  const at = (iso: string) => () => new Date(iso);
  const valid = (bars: IntradayBar[]) => bars.every((b) => b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close) && b.volume >= 0);

  it("full past session matches the daily candle (open, close, high, low, volume)", async () => {
    const src = new MockMinuteSource(daily(kr), at("2024-03-18T07:00:00Z")); // 16:00 KST, 장 마감 뒤
    expect(src.sample).toBe(true);
    const bars = await src.getMinuteBars("005930");
    expect(bars).toHaveLength(381); // 09:00~15:19 연속 380봉 + 15:30 종가 단일가
    expect(bars[0]!.t).toBe("2024-03-18T09:00");
    expect(bars.at(-1)!.t).toBe("2024-03-18T15:30");
    expect(bars.some((b) => { const m = barMinutes(b.t); return m >= 920 && m < 930; })).toBe(false);
    expect(bars[0]!.open).toBe(10_200);
    expect(bars.at(-1)!.close).toBe(10_500);
    expect(Math.max(...bars.map((b) => b.high))).toBe(10_600);
    expect(Math.min(...bars.map((b) => b.low))).toBe(10_100);
    expect(bars.reduce((s, b) => s + b.volume, 0)).toBe(2_000_000);
    expect(bars.every((b) => Number.isInteger(b.close) && Number.isInteger(b.high) && Number.isInteger(b.low))).toBe(true);
    expect(valid(bars)).toBe(true);
  });

  it("is deterministic per code and date, and differs between codes", async () => {
    const a = await new MockMinuteSource(daily(kr), at("2024-03-18T07:00:00Z")).getMinuteBars("005930");
    const b = await new MockMinuteSource(daily(kr), at("2024-03-18T07:00:00Z")).getMinuteBars("005930");
    const c = await new MockMinuteSource(daily(kr), at("2024-03-18T07:00:00Z")).getMinuteBars("000660");
    expect(a).toEqual(b);
    expect(c.map((x) => x.close)).not.toEqual(a.map((x) => x.close));
    expect(c[0]!.open).toBe(10_200);
    expect(c.at(-1)!.close).toBe(10_500);
  });

  it("clips today's session to bars finished before the current local time", async () => {
    const src = new MockMinuteSource(daily(kr), at("2024-03-18T01:00:00Z")); // 10:00 KST
    const bars = await src.getMinuteBars("005930");
    expect(bars).toHaveLength(60);
    expect(bars.at(-1)!.t).toBe("2024-03-18T09:59");
    expect(bars.every((b) => b.high <= 10_600 && b.low >= 10_100)).toBe(true);
    // 같은 날 늦은 시각의 결과와 앞부분이 같다(시각만 잘라낸 것)
    const full = await new MockMinuteSource(daily(kr), at("2024-03-18T07:00:00Z")).getMinuteBars("005930");
    expect(full.slice(0, 60)).toEqual(bars);
    const two = await src.getMinuteBars("005930", 2);
    expect(two.filter((b) => b.t.startsWith("2024-03-15"))).toHaveLength(381);
    expect(two.filter((b) => b.t.startsWith("2024-03-18"))).toHaveLength(60);
  });

  it("before the open returns the previous session; future-dated daily candles are skipped", async () => {
    const pre = await new MockMinuteSource(daily(kr), at("2024-03-17T23:00:00Z")).getMinuteBars("005930"); // 3/18 08:00 KST
    expect(pre[0]!.t).toBe("2024-03-15T09:00");
    expect(pre.at(-1)!.close).toBe(9_900);
    // 음봉(시가 10,000 > 종가 9,900)은 고가를 먼저, 저가를 나중에 찍는다
    const hiAt = pre.findIndex((b) => b.high === 10_400), loAt = pre.findIndex((b) => b.low === 9_700);
    expect(hiAt).toBeGreaterThanOrEqual(0);
    expect(loAt).toBeGreaterThan(hiAt);
    const us: Candle[] = [
      { date: "2024-03-15", open: 171.2, high: 173.05, low: 170.5, close: 172.62, volume: 50_000_000 },
      { date: "2024-03-18", open: 173, high: 174.5, low: 172.1, close: 173.72, volume: 60_000_000 },
    ];
    // 3/18 02:00Z = 3/17 22:00 EDT(일요일) → 3/18 일봉은 아직 시작 전 세션
    const sun = await new MockMinuteSource(daily(us), at("2024-03-18T02:00:00Z")).getMinuteBars("AAPL");
    expect(sun[0]!.t).toBe("2024-03-15T09:30");
    expect(sun).toHaveLength(390);
    expect(sun.at(-1)!.t).toBe("2024-03-15T15:59");
    expect(sun.at(-1)!.close).toBe(172.62);
    expect(Math.max(...sun.map((b) => b.high))).toBe(173.05);
    expect(Math.min(...sun.map((b) => b.low))).toBe(170.5);
    expect(valid(sun)).toBe(true);
    // 3/18 15:00Z = 11:00 EDT → 09:30~10:59
    const mid = await new MockMinuteSource(daily(us), at("2024-03-18T15:00:00Z")).getMinuteBars("AAPL");
    expect(mid).toHaveLength(90);
    expect(mid[0]).toMatchObject({ t: "2024-03-18T09:30", open: 173 });
    expect(mid.at(-1)!.t).toBe("2024-03-18T10:59");
  });

  it("returns [] when there is no daily data, and feeds assessIntraday end to end", async () => {
    expect(await new MockMinuteSource(daily([]), at("2024-03-18T01:00:00Z")).getMinuteBars("005930")).toEqual([]);
    const src = new MockMinuteSource(daily(kr), at("2024-03-18T02:00:00Z")); // 11:00 KST
    const bars = await src.getMinuteBars("005930", 2);
    const today = sessionBars(bars, "2024-03-18");
    const prev = sessionBars(bars, "2024-03-15");
    const a = assessIntraday({ bars1m: today, prevBars1m: prev, prevClose: 9_900, prevHigh: 10_400, dailyAligned: null, sessionOpen: INTRADAY_SESSIONS.KR.open });
    expect(a.minutesSinceOpen).toBe(120);
    expect(a.gapPct).toBeCloseTo((10_200 / 9_900 - 1) * 100, 1);
    expect(a.hold.ma20on1m).not.toBeNull();
    expect(["buy", "wait", "avoid"]).toContain(a.entry.verdict);
  });

  it("synthMinuteSession tolerates a flat candle", () => {
    const flat = synthMinuteSession("X", { date: "2024-03-18", open: 100, high: 100, low: 100, close: 100, volume: 7 }, "US");
    expect(flat.every((b) => b.open === 100 && b.high === 100 && b.low === 100 && b.close === 100)).toBe(true);
    expect(flat.reduce((s, b) => s + b.volume, 0)).toBe(7);
  });
});
