import { describe, expect, it } from "vitest";
import { isValidCode, type Candle, type Market, type StockInfo } from "@jusik/shared";
import {
  BREADTH_SOURCE_DEFAULTS,
  BreadthSource,
  fallbackCodesFrom,
  isLikelyCommonStock,
  NAVER_BREADTH,
  parseNaverBreadthToday,
  parseNaverMarketSum,
  sampleBreadthToday,
  tradingDayKey,
  US_BREADTH_BASKET,
} from "../src/breadthSource";
import type { Http } from "../src/http";
import { STOCKS } from "../src/stocks";

// ⚠ 아래 HTML은 네이버 금융 페이지 형식을 기억대로 흉내 낸 것이다. 실제 응답과 대조하지 못했고(미검증), 숫자·종목은 테스트용으로 만든 값이다.

const BLOCKED = "<html><body><h1>일시적으로 서비스를 이용할 수 없습니다</h1></body></html>";

/** sise_market_sum.naver 흉내: 위쪽 인기 검색 표(종목 링크 있음), 본 표(type_2) 머리글·빈 줄·토론실 링크 */
function marketSumPage(rows: { code: string; name: string }[], startRank = 1): string {
  const body = rows
    .map(
      (r, k) => `<tr onMouseOver="mouseOver(this)" onMouseOut="mouseOut(this)">
        <td class="no">${startRank + k}</td>
        <td><a href="/item/main.naver?code=${r.code}" class="tltle">${r.name}</a></td>
        <td class="number">71,000</td>
        <td class="number"><img src="ico_up.gif" alt="상승"><span class="tah p11 red02">500</span></td>
        <td class="number"><span class="tah p11 red01">+0.71%</span></td>
        <td class="number">100</td>
        <td class="number">4,238,000</td>
        <td class="number">5,969,783</td>
        <td class="number">54.20</td>
        <td class="number">12,345,678</td>
        <td class="number">15.20</td>
        <td class="number">8.50</td>
        <td class="center"><a href="/item/board.naver?code=${r.code}"><img src="ico_board.gif" alt="토론실"></a></td>
      </tr>${k % 5 === 4 ? '<tr><td colspan="13" class="division_line"></td></tr>' : ""}`,
    )
    .join("");
  return `<html><body>
    <div id="menu"><a href="/sise/sise_rise.naver">상승</a></div>
    <table class="tbl_search"><tr><th>인기 검색 종목</th></tr><tr><td><a href="/item/main.naver?code=035720">카카오</a></td></tr></table>
    <div class="box_type_m">
      <table class="type_2" summary="코스피 시가총액 리스트">
        <caption>코스피</caption>
        <thead><tr>
          <th scope="col">N</th><th scope="col">종목명</th><th scope="col">현재가</th><th scope="col">전일비</th><th scope="col">등락률</th>
          <th scope="col">액면가</th><th scope="col">시가총액</th><th scope="col">상장주식수</th><th scope="col">외국인비율</th>
          <th scope="col">거래량</th><th scope="col">PER</th><th scope="col">ROE</th><th scope="col">토론실</th>
        </tr></thead>
        <tbody><tr><td colspan="13" class="blank_08"></td></tr>${body}<tr><td colspan="13" class="blank_08"></td></tr></tbody>
      </table>
    </div></body></html>`;
}

/** sise_index.naver 흉내(링크 글자가 숫자). 왼쪽 메뉴의 같은 주소 링크는 글자가 라벨 */
function indexPageLinks(sosok: string, v: { upper: number; rise: number; steady: number; fall: number; lower: number }) {
  return `<html><body>
    <ul class="lnb"><li><a href="/sise/sise_upper.naver">상한가</a></li><li><a href="/sise/sise_rise.naver">상승</a></li>
      <li><a href="/sise/sise_steady.naver">보합</a></li><li><a href="/sise/sise_fall.naver">하락</a></li><li><a href="/sise/sise_lower.naver">하한가</a></li></ul>
    <div id="quotient" class="quot"><em id="now_value">2,650.12</em></div>
    <dl class="lst_kos_info">
      <dt class="dt1">상한</dt><dd><a href="/sise/sise_upper.naver?sosok=${sosok}">${v.upper}</a></dd>
      <dt class="dt2">상승</dt><dd><a href="/sise/sise_rise.naver?sosok=${sosok}">${v.rise.toLocaleString("en-US")}</a></dd>
      <dt class="dt3">보합</dt><dd><a href="/sise/sise_steady.naver?sosok=${sosok}">${v.steady}</a></dd>
      <dt class="dt4">하락</dt><dd><a href="/sise/sise_fall.naver?sosok=${sosok}">${v.fall.toLocaleString("en-US")}</a></dd>
      <dt class="dt5">하한</dt><dd><a href="/sise/sise_lower.naver?sosok=${sosok}">${v.lower}</a></dd>
    </dl></body></html>`;
}

describe("NAVER_BREADTH urls", () => {
  it("builds market-cap ranking and index page urls", () => {
    expect(NAVER_BREADTH.marketSum("KOSPI", 2)).toBe("https://finance.naver.com/sise/sise_market_sum.naver?sosok=0&page=2");
    expect(NAVER_BREADTH.marketSum("KOSDAQ")).toBe("https://finance.naver.com/sise/sise_market_sum.naver?sosok=1&page=1");
    expect(NAVER_BREADTH.index("KOSPI")).toBe("https://finance.naver.com/sise/sise_index.naver?code=KOSPI");
    expect(NAVER_BREADTH.index("KOSDAQ")).toBe("https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ");
  });
});

describe("parseNaverMarketSum (미검증 형식)", () => {
  it("reads codes and names in rank order from the table with 종목명·시가총액 headers", () => {
    const rows = [
      { code: "005930", name: "삼성전자" },
      { code: "000660", name: "SK하이닉스" },
      { code: "005935", name: "삼성전자우" },
      { code: "373220", name: "LG에너지솔루션" },
      { code: "207940", name: "삼성바이오로직스" },
      { code: "005380", name: "현대차" },
    ];
    // 위쪽 인기 검색 표의 카카오(035720)는 들어가지 않는다
    expect(parseNaverMarketSum(marketSumPage(rows))).toEqual(rows);
  });

  it("returns [] when the table is not recognized", () => {
    expect(parseNaverMarketSum(BLOCKED)).toEqual([]);
    expect(parseNaverMarketSum("")).toEqual([]);
    // 머리글은 있는데 종목 링크가 없으면 빈 배열
    expect(parseNaverMarketSum(marketSumPage([]))).toEqual([]);
    // 시가총액 머리글이 없는 다른 표
    expect(parseNaverMarketSum('<table><tr><th>종목명</th><th>현재가</th></tr><tr><td><a href="/item/main.naver?code=005930">삼성전자</a></td></tr></table>')).toEqual([]);
  });

  it("ignores malformed codes and duplicate rows", () => {
    const html = marketSumPage([{ code: "005930", name: "삼성전자" }, { code: "005930", name: "삼성전자" }])
      .replace("</tbody>", '<tr><td>9</td><td><a href="/item/main.naver?code=12345">이상한코드</a></td><td>1</td></tr></tbody>');
    expect(parseNaverMarketSum(html)).toEqual([{ code: "005930", name: "삼성전자" }]);
  });
});

describe("isLikelyCommonStock / fallbackCodesFrom", () => {
  it("filters preferred shares, ETFs/ETNs, SPACs and REIT/infra funds by name", () => {
    for (const n of ["삼성전자", "SK하이닉스", "BNK금융지주", "파워로직스", "LG에너지솔루션", "HD현대중공업", "KB금융", "SOLUM"]) expect(isLikelyCommonStock(n), n).toBe(true);
    for (const n of ["삼성전자우", "현대차2우B", "LG화학우", "한화3우B", "KODEX 200", "TIGER 미국S&P500", "ACE 미국빅테크TOP7 Plus", "RISE 200", "SOL 미국배당다우존스", "신한 레버리지 WTI원유 선물 ETN", "미래에셋비전스팩1호", "SK리츠", "맥쿼리인프라", ""])
      expect(isLikelyCommonStock(n), n).toBe(false);
  });

  it("groups the built-in list by market and keeps only common stocks", () => {
    const list: StockInfo[] = [
      { code: "005930", name: "삼성전자", market: "KOSPI" },
      { code: "005935", name: "삼성전자우", market: "KOSPI" },
      { code: "247540", name: "에코프로비엠", market: "KOSDAQ" },
      { code: "AAPL", name: "Apple", market: "US" },
    ];
    expect(fallbackCodesFrom(list)).toEqual({ KOSPI: ["005930"], KOSDAQ: ["247540"], US: ["AAPL"] });
    const all = fallbackCodesFrom(STOCKS);
    expect(all.KOSPI).toContain("005930");
    expect(all.KOSPI).not.toContain("005935");
    expect(all.KOSPI!.length).toBeGreaterThan(10);
  });
});

describe("parseNaverBreadthToday (미검증 형식)", () => {
  it("reads 상한·상승·보합·하락·하한 counts from numeric links, skipping menu links", () => {
    const html = indexPageLinks("0", { upper: 3, rise: 1234, steady: 61, fall: 512, lower: 1 });
    expect(parseNaverBreadthToday(html)).toEqual({ upperLimit: 3, up: 1234, unchanged: 61, down: 512, lowerLimit: 1 });
  });

  it("picks the requested market when both are on the page", () => {
    const html = indexPageLinks("0", { upper: 3, rise: 400, steady: 60, fall: 480, lower: 0 }) + indexPageLinks("1", { upper: 7, rise: 900, steady: 120, fall: 650, lower: 2 });
    expect(parseNaverBreadthToday(html, "KOSDAQ")).toEqual({ upperLimit: 7, up: 900, unchanged: 120, down: 650, lowerLimit: 2 });
    expect(parseNaverBreadthToday(html, "KOSPI")).toEqual({ upperLimit: 3, up: 400, unchanged: 60, down: 480, lowerLimit: 0 });
  });

  it("falls back to 'label number' text in a small block", () => {
    const html = `<html><body><div class="news">코스피 상승 마감</div>
      <div class="updown"><span>상한 2</span> <span>상승 389</span> <span>보합 57</span> <span>하락 501</span> <span>하한 0</span></div></body></html>`;
    expect(parseNaverBreadthToday(html)).toEqual({ upperLimit: 2, up: 389, unchanged: 57, down: 501, lowerLimit: 0 });
    const dl = "<dl><dt>상승종목수</dt><dd>1,020</dd><dt>상한가</dt><dd>4</dd><dt>보합</dt><dd>88</dd><dt>하락종목수</dt><dd>590</dd><dt>하한가</dt><dd>1</dd></dl>";
    expect(parseNaverBreadthToday(dl)).toEqual({ up: 1020, upperLimit: 4, unchanged: 88, down: 590, lowerLimit: 1 });
  });

  it("returns null instead of guessing when a value is missing or the page is unknown", () => {
    expect(parseNaverBreadthToday(BLOCKED)).toBeNull();
    expect(parseNaverBreadthToday("")).toBeNull();
    // 하한이 빠짐
    expect(parseNaverBreadthToday('<div><span>상한 2</span><span>상승 389</span><span>보합 57</span><span>하락 501</span></div>')).toBeNull();
    // 라벨이 흩어진 긴 본문(기사 등)에서는 줍지 않는다
    const article = `<div>${"시장 동향 ".repeat(30)}상한 1 그리고 상승 2,500선 회복, 보합 3 하락 4 하한 5</div>`;
    expect(parseNaverBreadthToday(article)).toBeNull();
    // 모두 0이면 읽은 것으로 보지 않는다
    expect(parseNaverBreadthToday(indexPageLinks("0", { upper: 0, rise: 0, steady: 0, fall: 0, lower: 0 }))).toBeNull();
  });
});

describe("US_BREADTH_BASKET", () => {
  it("has about 100 unique, valid large-cap tickers", () => {
    expect(US_BREADTH_BASKET.length).toBeGreaterThanOrEqual(90);
    expect(US_BREADTH_BASKET.length).toBeLessThanOrEqual(110);
    expect(new Set(US_BREADTH_BASKET).size).toBe(US_BREADTH_BASKET.length);
    for (const t of US_BREADTH_BASKET) expect(isValidCode(t), t).toBe(true);
    expect(US_BREADTH_BASKET.slice(0, 3)).toEqual(["AAPL", "MSFT", "NVDA"]);
  });
});

describe("tradingDayKey / sampleBreadthToday", () => {
  it("keys the cache by the market's local date", () => {
    const t = new Date("2024-03-17T15:30:00Z"); // 서울 3/18 00:30, 뉴욕 3/17 11:30
    expect(tradingDayKey("KOSPI", t)).toBe("2024-03-18");
    expect(tradingDayKey("US", t)).toBe("2024-03-17");
  });

  it("sample counts are deterministic, sum to the listed count and vary by date", () => {
    const a = sampleBreadthToday("KOSPI", "2024-03-18");
    expect(sampleBreadthToday("KOSPI", "2024-03-18")).toEqual(a);
    expect(a.up + a.upperLimit + a.unchanged + a.down + a.lowerLimit).toBe(950);
    for (const v of Object.values(a)) expect(v).toBeGreaterThanOrEqual(0);
    const k = sampleBreadthToday("KOSDAQ", "2024-03-18");
    expect(k.up + k.upperLimit + k.unchanged + k.down + k.lowerLimit).toBe(1700);
    const days = ["2024-03-18", "2024-03-19", "2024-03-20", "2024-03-21"].map((d) => sampleBreadthToday("KOSPI", d).up);
    expect(new Set(days).size).toBeGreaterThan(1);
  });
});

// ───────────────────────── BreadthSource ─────────────────────────

const DAY = 86_400_000;
const END = "2024-03-15"; // 금요일

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 종목 코드로 정해지는 평일 일봉 n개(END로 끝남) */
function walk(code: string, n: number): Candle[] {
  const dates: string[] = [];
  for (let t = Date.parse(END); dates.length < n; t -= DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) dates.unshift(new Date(t).toISOString().slice(0, 10));
  }
  let s = hash(code), px = 100;
  return dates.map((date) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    px *= 1 + (s / 4294967296 - 0.49) * 0.04;
    return { date, open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 1000 };
  });
}

const krCodes = (n: number, from = 100) => Array.from({ length: n }, (_, k) => String(from + k).padStart(6, "0"));

function stubDeps(o: { failing?: string[]; empty?: string[]; indexFails?: boolean } = {}) {
  const candleCalls: { code: string; count: number }[] = [];
  const indexCalls: Market[] = [];
  return {
    candleCalls,
    indexCalls,
    async getCandles(code: string, count: number) {
      candleCalls.push({ code, count });
      if (o.failing?.includes(code)) throw new Error("일봉 조회 실패");
      if (o.empty?.includes(code)) return [];
      return walk(code, count);
    },
    async getIndexCandles(market: Market, count: number) {
      indexCalls.push(market);
      if (o.indexFails) throw new Error("지수 조회 실패");
      return walk(`INDEX:${market}`, count);
    },
  };
}

function stubHttp(route: (url: string) => string | Error): Http & { calls: string[] } {
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    const r = route(url);
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, get, getResponse: async (url: string) => ({ status: 200, headers: new Headers(), text: await get(url) }) };
}

function clock(iso: string) {
  let t = Date.parse(iso);
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

describe("BreadthSource (sample mode, http = null)", () => {
  it("works purely from fallbackCodes and the given getCandles, labeled as sample", async () => {
    const deps = stubDeps();
    const c = clock("2024-03-15T07:00:00Z");
    const src = new BreadthSource(deps, null, { fallbackCodes: { KOSPI: krCodes(12) }, now: c.now });
    expect(src.sample).toBe(true);
    const r = await src.getBreadth("KOSPI");
    expect(r.sample).toBe(true);
    expect(r.basket).toEqual(krCodes(12));
    expect(r.errors).toEqual([]);
    expect(deps.candleCalls.every((x) => x.count === BREADTH_SOURCE_DEFAULTS.candleCount)).toBe(true);
    expect(BREADTH_SOURCE_DEFAULTS.candleCount).toBeGreaterThanOrEqual(450);
    expect(r.days.length).toBe(BREADTH_SOURCE_DEFAULTS.candleCount - 1);
    expect(r.analysis!.asOf).toBe(END);
    expect(r.analysis!.basis).toContain("샘플");
    expect(r.analysis!.mi.length).toBeGreaterThan(200);
    expect(r.analysis!.signals[0]!.text).toContain("샘플 데이터 12종목");
    expect(r.today).toEqual(sampleBreadthToday("KOSPI", "2024-03-15"));
    expect(r.fetchedAt).toBe("2024-03-15T07:00:00.000Z");
    // 같은 입력이면 같은 결과
    const again = await new BreadthSource(stubDeps(), null, { fallbackCodes: { KOSPI: krCodes(12) }, now: c.now }).getBreadth("KOSPI");
    expect(again).toEqual(r);
  });

  it("limits the basket to basketSize and uses fallback (or the built-in basket) for US", async () => {
    const deps = stubDeps();
    const src = new BreadthSource(deps, null, { basketSize: 5, fallbackCodes: { KOSPI: krCodes(12), US: ["AAPL", "MSFT"] } });
    expect((await src.getBreadth("KOSPI")).basket).toEqual(krCodes(5));
    const us = await src.getBreadth("US");
    expect(us.basket).toEqual(["AAPL", "MSFT"]);
    expect(us.today).toBeNull();
    const noFallback = await new BreadthSource(stubDeps(), null, { basketSize: 4 }).getBreadth("US");
    expect(noFallback.basket).toEqual(US_BREADTH_BASKET.slice(0, 4));
    expect(noFallback.analysis!.basis).toContain("샘플");
  });

  it("caches per market per day, shares one in-flight load, and reloads after ttl or a new day", async () => {
    const deps = stubDeps();
    const c = clock("2024-03-15T01:00:00Z"); // 서울 10:00
    const src = new BreadthSource(deps, null, { fallbackCodes: { KOSPI: krCodes(6), KOSDAQ: krCodes(4, 900) }, ttlMs: 3_600_000, now: c.now });
    const [a, b] = await Promise.all([src.getBreadth("KOSPI"), src.getBreadth("KOSPI")]);
    expect(a).toBe(b);
    expect(deps.candleCalls).toHaveLength(6);
    expect(await src.getBreadth("KOSPI")).toBe(a);
    expect(deps.candleCalls).toHaveLength(6);
    // 시장마다 따로
    await src.getBreadth("KOSDAQ");
    expect(deps.candleCalls).toHaveLength(10);
    // ttl 지나면 다시
    c.advance(3_600_001);
    const fresh = await src.getBreadth("KOSPI");
    expect(fresh).not.toBe(a);
    expect(deps.candleCalls).toHaveLength(16);
    // 서울 날짜가 바뀌면 ttl 안이어도 다시
    c.advance(14 * 3_600_000 - 1); // 3/16 01:00 KST
    await src.getBreadth("KOSPI");
    expect(deps.candleCalls).toHaveLength(22);
    // clear
    src.clear("KOSPI");
    await src.getBreadth("KOSPI");
    expect(deps.candleCalls).toHaveLength(28);
  });

  it("uses the default 6h ttl", async () => {
    const deps = stubDeps();
    const c = clock("2024-03-15T00:00:00Z");
    const src = new BreadthSource(deps, null, { fallbackCodes: { KOSPI: krCodes(3) }, now: c.now });
    await src.getBreadth("KOSPI");
    c.advance(6 * 3_600_000 - 1);
    await src.getBreadth("KOSPI");
    expect(deps.candleCalls).toHaveLength(3);
    c.advance(2);
    await src.getBreadth("KOSPI");
    expect(deps.candleCalls).toHaveLength(6);
  });

  it("skips codes that fail, reports errors, and does not cache an empty result", async () => {
    const deps = stubDeps({ failing: ["000101"], empty: ["000102"] });
    const src = new BreadthSource(deps, null, { fallbackCodes: { KOSPI: krCodes(6) } });
    const r = await src.getBreadth("KOSPI");
    expect(r.basket).toEqual(["000100", "000103", "000104", "000105"]);
    expect(r.errors.some((e) => e.startsWith("000101") && e.includes("일봉 조회 실패"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("000102"))).toBe(true);
    expect(r.analysis).not.toBeNull();

    // 표본 목록이 없으면 analysis null → 캐시하지 않고 다음에 다시 시도
    const none = await src.getBreadth("KOSDAQ");
    expect(none.analysis).toBeNull();
    expect(none.errors.some((e) => e.includes("표본 종목 목록이 없어요"))).toBe(true);
    const before = deps.indexCalls.length;
    await src.getBreadth("KOSDAQ");
    expect(deps.indexCalls.length).toBe(before + 1);
  });

  it("still analyzes when index candles fail (no divergence check)", async () => {
    const src = new BreadthSource(stubDeps({ indexFails: true }), null, { fallbackCodes: { KOSPI: krCodes(5) } });
    const r = await src.getBreadth("KOSPI");
    expect(r.errors.some((e) => e.includes("지수 일봉"))).toBe(true);
    expect(r.analysis).not.toBeNull();
    expect(r.analysis!.divergence).toBeNull();
  });
});

describe("BreadthSource (web mode)", () => {
  // 1쪽: 50종목 중 2개가 우선주, 2쪽: 50종목 → 보통주 상위 60개는 2쪽에서 채워진다
  const page1 = Array.from({ length: 50 }, (_, k) => (k === 3 || k === 10 ? { code: String(500 + k).padStart(6, "0"), name: `종목${k}우` } : { code: String(100 + k).padStart(6, "0"), name: `종목${k}` }));
  const page2 = Array.from({ length: 50 }, (_, k) => ({ code: String(200 + k).padStart(6, "0"), name: `둘째${k}` }));
  const todayHtml = indexPageLinks("0", { upper: 3, rise: 420, steady: 55, fall: 470, lower: 2 });

  it("takes the top common stocks from the market-cap ranking, paging as needed, and reads today's counts", async () => {
    const http = stubHttp((url) => {
      if (url === NAVER_BREADTH.marketSum("KOSPI", 1)) return marketSumPage(page1);
      if (url === NAVER_BREADTH.marketSum("KOSPI", 2)) return marketSumPage(page2, 51);
      if (url === NAVER_BREADTH.index("KOSPI")) return todayHtml;
      return new Error(`unexpected ${url}`);
    });
    const deps = stubDeps();
    const src = new BreadthSource(deps, http, { fallbackCodes: { KOSPI: krCodes(3, 900) } });
    expect(src.sample).toBe(false);
    const r = await src.getBreadth("KOSPI");
    const expected = [...page1.filter((x) => !x.name.endsWith("우")), ...page2].slice(0, 60).map((x) => x.code);
    expect(r.basket).toEqual(expected);
    expect(http.calls.filter((u) => u.includes("sise_market_sum"))).toEqual([NAVER_BREADTH.marketSum("KOSPI", 1), NAVER_BREADTH.marketSum("KOSPI", 2)]);
    // 한 종목씩 차례로
    expect(deps.candleCalls.map((x) => x.code)).toEqual(expected);
    expect(r.today).toEqual({ upperLimit: 3, up: 420, unchanged: 55, down: 470, lowerLimit: 2 });
    expect(r.sample).toBe(false);
    expect(r.analysis!.basis).toBe("KOSPI 시가총액 상위 60종목(보통주) 기준 근사");
    expect(r.errors).toEqual([]);
  });

  it("falls back to fallbackCodes when the ranking cannot be read", async () => {
    const unknown = stubHttp((url) => (url.includes("sise_market_sum") ? BLOCKED : todayHtml));
    const r = await new BreadthSource(stubDeps(), unknown, { fallbackCodes: { KOSPI: krCodes(4, 900) } }).getBreadth("KOSPI");
    expect(r.basket).toEqual(krCodes(4, 900));
    expect(r.errors.some((e) => e.includes("알아보지 못했어요"))).toBe(true);
    expect(r.errors.some((e) => e.includes("기본 종목 목록"))).toBe(true);
    expect(r.analysis!.basis).toContain("기본 목록 4종목");

    const down = stubHttp((url) => (url.includes("sise_market_sum") ? new Error("접속 실패") : BLOCKED));
    const d = await new BreadthSource(stubDeps(), down, { fallbackCodes: { KOSDAQ: krCodes(4, 900) } }).getBreadth("KOSDAQ");
    expect(down.calls[0]).toBe(NAVER_BREADTH.marketSum("KOSDAQ", 1));
    expect(d.basket).toEqual(krCodes(4, 900));
    expect(d.errors.some((e) => e.includes("시가총액 순위 1쪽") && e.includes("접속 실패"))).toBe(true);
    // 지수 페이지를 못 읽으면 today는 null(지어내지 않는다)
    expect(d.today).toBeNull();
    expect(d.errors.some((e) => e.includes("오늘 등락 종목 수"))).toBe(true);
  });

  it("uses the built-in US basket without any http calls", async () => {
    const http = stubHttp(() => new Error("should not be called"));
    const r = await new BreadthSource(stubDeps(), http, { basketSize: 8 }).getBreadth("US");
    expect(r.basket).toEqual(US_BREADTH_BASKET.slice(0, 8));
    expect(r.today).toBeNull();
    expect(http.calls).toEqual([]);
    expect(r.analysis!.basis).toBe("미국 대형주 8종목(S&P 100 구성 종목) 기준 근사");
  });
});
