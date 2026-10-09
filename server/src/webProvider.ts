import { regionOfCode, type Candle, type Fundamentals, type Market, type Quote, type StockInfo } from "@jusik/shared";
import type { Http } from "./http";
import { HttpError } from "./http";
import { NAVER, parseFchart, parseNaverFundamentals, parseRankingTable, parseRealtime, realtimeToQuote } from "./naver";
import type { MarketDataProvider, UniverseRow } from "./provider";
import { findStock, searchStocks } from "./stocks";
import { parseYahooChart, parseYahooFundamentals, parseYahooScreener, parseYahooSearch, YAHOO, YAHOO_INDEX } from "./yahoo";

const rangeFor = (count: number) => (count <= 60 ? "3mo" : count <= 130 ? "6mo" : count <= 250 ? "1y" : count <= 500 ? "2y" : "5y");
const AUTO = { encoding: "auto" } as const;

/** 국내=네이버 금융, 미국=야후 파이낸스 웹사이트에서 읽어오는 제공자(증권사 API 아님) */
export class WebProvider implements MarketDataProvider {
  readonly name = "web (네이버 금융 + 야후 파이낸스)";
  readonly sample = false;
  private known = new Map<string, StockInfo>();
  private crumb: { value: string; cookie: string } | null = null;

  constructor(private http: Http) {}

  async search(q: string): Promise<StockInfo[]> {
    const local = searchStocks(q);
    let live: StockInfo[] = [];
    if (q.trim().length >= 2 && !/^\d+$/.test(q.trim())) {
      try {
        live = parseYahooSearch(await this.http.get(YAHOO.search(q.trim())));
      } catch {
        /* 로컬 목록만 사용 */
      }
    }
    const seen = new Set<string>();
    return [...local, ...live].filter((s) => (seen.has(s.code) ? false : (seen.add(s.code), true))).slice(0, 10);
  }

  async getInfo(code: string): Promise<StockInfo | undefined> {
    const hit = findStock(code) ?? this.known.get(code);
    if (hit) return hit;
    try {
      if (regionOfCode(code) === "KR") {
        const r = parseRealtime(await this.http.get(NAVER.realtime([code]), AUTO))[0];
        if (r) return this.remember({ code, name: r.name || code, market: "KOSPI" }); // 시장 구분 정보가 없어 코스피로 가정
      } else {
        const { meta } = parseYahooChart(await this.http.get(YAHOO.chart(code, "5d")));
        if (meta.name) return this.remember({ code, name: meta.name, market: "US" });
      }
    } catch {
      /* 이름을 못 찾으면 undefined */
    }
    return undefined;
  }

  async getQuote(code: string): Promise<Quote> {
    if (regionOfCode(code) === "KR") {
      const r = parseRealtime(await this.http.get(NAVER.realtime([code]), AUTO))[0];
      if (!r) throw new Error(`현재가를 읽지 못했어요(${code}). 종목코드를 확인하거나 사이트 응답 형식이 바뀌었는지 확인해 주세요.`);
      return realtimeToQuote(r);
    }
    const { candles, meta } = parseYahooChart(await this.http.get(YAHOO.chart(code, "5d")));
    const price = meta.price ?? candles.at(-1)?.close;
    const prev = meta.previousClose ?? candles.at(-2)?.close;
    if (!price) throw new Error(`현재가를 읽지 못했어요(${code}).`);
    const change = prev ? price - prev : 0;
    return { code, price, change, changePct: prev ? (change / prev) * 100 : 0, volume: candles.at(-1)?.volume };
  }

  async getPrices(codes: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const kr = codes.filter((c) => regionOfCode(c) === "KR");
    for (let i = 0; i < kr.length; i += 20) {
      try {
        for (const r of parseRealtime(await this.http.get(NAVER.realtime(kr.slice(i, i + 20)), AUTO))) out[r.code] = r.price;
      } catch {
        /* 실패한 묶음은 건너뛴다 */
      }
    }
    for (const c of codes.filter((x) => regionOfCode(x) === "US")) {
      try {
        const { meta, candles } = parseYahooChart(await this.http.get(YAHOO.chart(c, "5d")));
        const p = meta.price ?? candles.at(-1)?.close;
        if (p) out[c] = p;
      } catch {
        /* 건너뛴다 */
      }
    }
    return out;
  }

  async getCandles(code: string, count: number): Promise<Candle[]> {
    if (regionOfCode(code) === "KR") return parseFchart(await this.http.get(NAVER.chart(code, count), AUTO)).slice(-count);
    return parseYahooChart(await this.http.get(YAHOO.chart(code, rangeFor(count)))).candles.slice(-count);
  }

  async getIndexCandles(market: Market, count: number): Promise<Candle[]> {
    if (market === "US") return parseYahooChart(await this.http.get(YAHOO.chart(YAHOO_INDEX, rangeFor(count)))).candles.slice(-count);
    return parseFchart(await this.http.get(NAVER.chart(market, count), AUTO)).slice(-count);
  }

  async getFundamentals(code: string): Promise<Fundamentals> {
    try {
      if (regionOfCode(code) === "KR") return parseNaverFundamentals(await this.http.get(NAVER.main(code), AUTO));
      return parseYahooFundamentals(await this.yahooWithCrumb(YAHOO.summary(code)));
    } catch {
      return {}; // 재무는 없어도 분석은 계속한다(스크리닝에서 '데이터 없음')
    }
  }

  async getUniverse(market: Market): Promise<UniverseRow[]> {
    const rows: UniverseRow[] = [];
    if (market === "US") {
      for (const id of ["day_gainers", "most_actives"] as const) {
        try {
          rows.push(...parseYahooScreener(await this.yahooWithCrumb(YAHOO.screener(id, 50))));
        } catch {
          /* 한쪽 목록이 실패해도 다른 목록으로 계속 */
        }
      }
    } else {
      for (const kind of ["quant", "rise"] as const) {
        try {
          rows.push(...parseRankingTable(await this.http.get(NAVER.ranking(kind, market), AUTO), market));
        } catch {
          /* 한쪽 목록이 실패해도 다른 목록으로 계속 */
        }
      }
    }
    const seen = new Set<string>();
    const unique = rows.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)));
    for (const r of unique) this.remember({ code: r.code, name: r.name, market: r.market });
    if (unique.length === 0) throw new Error(`${market} 종목 순위표를 읽지 못했어요. 접속이 차단됐거나 사이트 구조가 바뀌었을 수 있어요.`);
    return unique;
  }

  private remember(info: StockInfo): StockInfo {
    this.known.set(info.code, info);
    return info;
  }

  /** 야후는 일부 엔드포인트가 쿠키+crumb을 요구한다. 먼저 그냥 시도하고, 401/403이면 crumb을 받아 한 번 재시도한다. */
  private async yahooWithCrumb(url: string): Promise<string> {
    const first = await this.http.getResponse(url);
    if (first.status >= 200 && first.status < 300) return first.text;
    if (first.status !== 401 && first.status !== 403) throw new HttpError(first.status, url);
    if (!this.crumb) {
      const c = await this.http.getResponse(YAHOO.cookie);
      const cookie = (c.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).join("; ");
      const r = await this.http.getResponse(YAHOO.crumb, { headers: { cookie } });
      if (r.status !== 200 || !r.text || r.text.includes("<")) throw new HttpError(r.status, YAHOO.crumb, "야후 crumb 발급 실패");
      this.crumb = { value: r.text.trim(), cookie };
    }
    const second = await this.http.getResponse(`${url}&crumb=${encodeURIComponent(this.crumb.value)}`, { headers: { cookie: this.crumb.cookie } });
    if (second.status < 200 || second.status >= 300) {
      this.crumb = null; // 다음 호출에서 다시 발급
      throw new HttpError(second.status, url);
    }
    return second.text;
  }
}
