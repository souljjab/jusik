import * as cheerio from "cheerio";
import type { Candle, Market, StockInfo } from "@jusik/shared";
import { analyzeBreadth, breadthFromCandles, type BreadthAnalysis, type BreadthDay } from "../../shared/src/breadth";
import type { GetOptions, Http } from "./http";

/*
 * 시장 폭(2.2 시장 내부 지표) 수집: 표본 종목 일봉으로 등락·신고저 종목 수를 근사한다.
 * - 국내 표본: 네이버 시가총액 순위(보통주만) 상위 N종목. 순위를 못 읽거나 샘플 모드면 fallbackCodes
 * - 미국 표본: US_BREADTH_BASKET(S&P 100 구성 종목 중 대형주)
 * - 국내 오늘 거래소 전체 등락 종목 수(상한·상승·보합·하락·하한)는 지수 페이지에서 참고용으로 읽는다
 *
 * ⚠ 실제 응답과 대조하지 못함(미검증): 아래 두 파서는 네이버 금융 페이지 구조를 기억에 기대어 짰다.
 * 이 개발 환경은 외부 접속이 막혀 있어 테스트 샘플도 형식을 흉내 낸 것일 뿐이다.
 * 그래서 머리글 이름·링크 주소·라벨로 값을 찾고, 알아보지 못하면 틀린 값 대신 빈 배열·null을 돌려준다.
 * 운영 전에 실제 페이지로 한 번 확인하세요.
 */

export const NAVER_BREADTH = {
  /** 시가총액 순위(한 페이지 50종목, 시가총액 내림차순). sosok 0 = 코스피, 1 = 코스닥 */
  marketSum: (market: Market, page = 1) => `https://finance.naver.com/sise/sise_market_sum.naver?sosok=${market === "KOSDAQ" ? 1 : 0}&page=${page}`,
  /** 지수 페이지(오늘 상승·하락 종목 수가 함께 나온다) */
  index: (market: Market) => `https://finance.naver.com/sise/sise_index.naver?code=${market === "KOSDAQ" ? "KOSDAQ" : "KOSPI"}`,
};

/** 시장 폭 수집 기본값(모두 앱 기본값) */
export const BREADTH_SOURCE_DEFAULTS = {
  /** 표본 종목 수 */
  basketSize: 60,
  /** 종목별 일봉 수: MI 200일 + 52주 고저 250봉 ≈ 460 */
  candleCount: 460,
  /** 같은 거래일 안에서 다시 계산하기까지(ms) */
  ttlMs: 6 * 3_600_000,
  /** 네이버 시가총액 순위 한 페이지 종목 수 */
  pageSize: 50,
} as const;

const naverOpts: GetOptions = { encoding: "auto", headers: { referer: "https://finance.naver.com/sise/" } };

const squash = (s: string) => s.replace(/\s+/g, "");

/** 이 표에 직접 속한 요소만(안쪽에 끼인 다른 표 제외) */
function own($: cheerio.CheerioAPI, table: ReturnType<cheerio.CheerioAPI>, sel: string) {
  const el = table.get(0);
  return table.find(sel).toArray().filter((e) => $(e).closest("table").get(0) === el);
}

/**
 * 네이버 시가총액 순위 페이지 → 순위대로 {code, name}. 실제 응답과 대조하지 못함(미검증).
 * 머리글에 '종목명'과 '시가총액'이 함께 있는 표를 찾고, 행의 code=XXXXXX 링크에서 종목코드를 읽는다. 못 찾으면 [].
 */
export function parseNaverMarketSum(html: string): { code: string; name: string }[] {
  const $ = cheerio.load(html);
  for (const t of $("table").toArray()) {
    const table = $(t);
    const heads = own($, table, "th").map((e) => squash($(e).text()));
    if (!heads.includes("종목명") || !heads.some((h) => h.startsWith("시가총액"))) continue;
    const out: { code: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const tr of own($, table, "tr")) {
      const a = $(tr).find('a[href*="code="]').first();
      const code = /code=(\d{6})(?!\d)/.exec(a.attr("href") ?? "")?.[1];
      const name = a.text().trim();
      if (!code || !name || seen.has(code)) continue;
      seen.add(code);
      out.push({ code, name });
    }
    if (out.length) return out;
  }
  return [];
}

// 이름으로 거르는 ETF·ETN 브랜드(시가총액 순위에 섞일 수 있음). 'KODEX 200'처럼 브랜드 뒤가 띄어쓰기일 때만 본다
// (그래야 'BNK금융지주' 같은 보통주를 거르지 않는다)
const FUND_BRANDS = /^(KODEX|TIGER|KBSTAR|RISE|ARIRANG|HANARO|KOSEF|ACE|SOL|PLUS|KIWOOM|TIMEFOLIO|TREX|FOCUS|BNK|WOORI|마이다스|에셋플러스|파워|히어로즈|1Q|UNICORN|VITA|DAISHIN343|KoAct|TRUSTON)(?=\s|$)/i;

/**
 * 보통주로 보이는 이름인가(2.2 와인스타인 '보통주 기준 권장'). 우선주(…우, …우B, …2우B), ETF·ETN, 스팩,
 * 금리에 민감한 리츠·인프라 펀드를 뺀다. 이름만 보는 근사라 드물게 틀릴 수 있다.
 */
export function isLikelyCommonStock(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (/\d?우[A-C]?(\(전환\))?$/.test(n)) return false;
  if (/스팩|ETN|ETF/i.test(n)) return false;
  if (/(리츠|인프라)$/.test(n)) return false;
  return !FUND_BRANDS.test(n);
}

/** 내장 종목 목록 → 시장별 표본 대체 목록(보통주만, 목록 순서 유지). BreadthSource의 fallbackCodes에 넘긴다 */
export function fallbackCodesFrom(stocks: StockInfo[]): Partial<Record<Market, string[]>> {
  const out: Partial<Record<Market, string[]>> = {};
  for (const s of stocks) {
    if (!isLikelyCommonStock(s.name)) continue;
    (out[s.market] ??= []).push(s.code);
  }
  return out;
}

/** 오늘 거래소 전체 등락 종목 수 */
export interface BreadthToday {
  up: number;
  upperLimit: number;
  unchanged: number;
  down: number;
  lowerLimit: number;
}

const TODAY_KEYS = [
  ["upperLimit", "sise_upper", "상한"],
  ["up", "sise_rise", "상승"],
  ["unchanged", "sise_steady", "보합"],
  ["down", "sise_fall", "하락"],
  ["lowerLimit", "sise_lower", "하한"],
] as const;

/** 숫자만 있는 글자("1,234")면 정수, 아니면 null */
const pureInt = (s: string): number | null => (/^\s*\d[\d,]*\s*$/.test(s) ? Number(s.replace(/[,\s]/g, "")) : null);

/**
 * 네이버 지수 페이지 → 오늘 상한·상승·보합·하락·하한 종목 수(거래소 전체). 실제 응답과 대조하지 못함(미검증).
 * 1) sise_upper/rise/steady/fall/lower 링크 글자가 숫자인 것, 2) 다섯 라벨이 모두 든 가장 작은 요소의 '라벨 숫자'.
 * 다섯 값을 모두 못 읽으면 null(빠진 값을 0으로 채우지 않는다). up에 상한이 포함되는지는 확인하지 못했다.
 * market을 주면 sosok가 붙은 링크 중 그 시장 것만 본다(라벨 방식은 시장을 가리지 못하므로 한 시장 페이지에만 쓴다).
 */
export function parseNaverBreadthToday(html: string, market?: Market): BreadthToday | null {
  const $ = cheerio.load(html);
  const sosok = market === "KOSDAQ" ? "1" : market ? "0" : null;
  const byLink: Partial<BreadthToday> = {};
  for (const [key, href] of TODAY_KEYS) {
    for (const a of $(`a[href*="${href}"]`).toArray()) {
      const h = $(a).attr("href") ?? "";
      const s = /sosok=(\d)/.exec(h)?.[1];
      if (sosok && s && s !== sosok) continue;
      const v = pureInt($(a).text());
      if (v != null) {
        byLink[key] = v;
        break;
      }
    }
  }
  const done = (o: Partial<BreadthToday>): o is BreadthToday => TODAY_KEYS.every(([k]) => o[k] != null) && TODAY_KEYS.some(([k]) => o[k]! > 0);
  if (done(byLink)) return byLink;

  // 라벨 방식: 짧은 후보부터 '라벨(가)(종목)(수)(:)숫자'를 모두 읽을 수 있는 첫 요소.
  // 기사 제목 같은 엉뚱한 글자에서 숫자를 줍지 않도록 다섯 라벨이 모인 짧은 요소(공백 빼고 100자 이하)만 본다
  const labels = TODAY_KEYS.map(([, , l]) => l);
  const candidates = $("body *")
    .toArray()
    .map((e) => squash($(e).text()))
    .filter((t) => t.length <= 100 && labels.every((l) => t.includes(l)))
    .sort((a, b) => a.length - b.length);
  for (const text of candidates) {
    const o: Partial<BreadthToday> = {};
    for (const [key, , label] of TODAY_KEYS) {
      const m = new RegExp(`${label}가?(?:종목)?수?[:：]?(\\d[\\d,]*)`).exec(text);
      if (m) o[key] = Number(m[1]!.replace(/,/g, ""));
    }
    if (done(o)) return o;
  }
  return null;
}

/** 시장 폭 표본(미국): S&P 100 구성 종목 중 대형주(야후 티커 형식). 2.2의 '보통주 기준'에 맞춰 같은 회사 중복 클래스(GOOG)는 뺐다 */
export const US_BREADTH_BASKET: string[] = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "BRK-B", "AVGO", "TSLA", "LLY",
  "JPM", "V", "UNH", "XOM", "MA", "JNJ", "PG", "HD", "COST", "ABBV",
  "WMT", "NFLX", "MRK", "KO", "BAC", "CVX", "CRM", "ORCL", "AMD", "PEP",
  "TMO", "ADBE", "LIN", "ACN", "MCD", "CSCO", "ABT", "WFC", "DHR", "INTU",
  "IBM", "TXN", "QCOM", "GE", "CAT", "AMGN", "VZ", "PM", "DIS", "NOW",
  "ISRG", "PFE", "CMCSA", "UNP", "GS", "SPG", "RTX", "T", "LOW", "HON",
  "NEE", "BKNG", "AXP", "MS", "UBER", "BLK", "COP", "LMT", "SCHW", "PLTR",
  "C", "DE", "MDT", "BMY", "SBUX", "TMUS", "GILD", "MO", "ADP", "MDLZ",
  "SO", "DUK", "CL", "BA", "INTC", "UPS", "CVS", "AMT", "USB", "GD",
  "EMR", "MMM", "COF", "TGT", "FDX", "MET", "AIG", "BK", "F", "GM",
  "NKE", "PYPL", "CHTR",
];

export interface BreadthDeps {
  /** 오래된 순 일봉(최대 count개). 실패하면 throw — 그 종목은 건너뛴다 */
  getCandles(code: string, count: number): Promise<Candle[]>;
  /** 지수 일봉(M1-04 괴리 판단용) */
  getIndexCandles(market: Market, count: number): Promise<Candle[]>;
}

export interface BreadthSourceOptions {
  /** 표본 종목 수(기본 60) */
  basketSize?: number;
  /** 순위표를 못 읽을 때·샘플 모드(http 없음)에 쓸 종목. 샘플 모드의 US는 있으면 이걸, 없으면 US_BREADTH_BASKET */
  fallbackCodes?: Partial<Record<Market, string[]>>;
  /** 같은 거래일 안에서 다시 계산하기까지(ms, 기본 6시간) */
  ttlMs?: number;
  /** 종목별 일봉 수(기본 460) */
  candleCount?: number;
  /** 테스트용 시계 */
  now?: () => Date;
}

export interface BreadthResult {
  market: Market;
  /** 집계일이 없으면 null */
  analysis: BreadthAnalysis | null;
  days: BreadthDay[];
  /** 오늘 거래소 전체 등락 종목 수(국내만, 참고용). 샘플 모드면 해시로 만든 샘플 값 */
  today: BreadthToday | null;
  /** 실제 계산에 들어간 종목(일봉을 못 받은 종목 제외) */
  basket: string[];
  errors: string[];
  /** 샘플 데이터(http 없음)로 만든 결과인가. 화면에 '샘플' 표시용 */
  sample: boolean;
  /** 계산 시각(ISO) */
  fetchedAt: string;
}

/** 시장별 시장 폭 수집·계산. 시장·거래일마다 한 번 계산해 캐시하고, 동시에 부르면 진행 중인 계산을 함께 쓴다 */
export class BreadthSource {
  private cache = new Map<Market, { day: string; at: number; ttl: number; value: Promise<BreadthResult> }>();
  private readonly now: () => Date;

  constructor(
    private deps: BreadthDeps,
    private http: Http | null,
    private opts: BreadthSourceOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /** http가 없으면 샘플 모드 */
  get sample(): boolean {
    return this.http == null;
  }

  getBreadth(market: Market): Promise<BreadthResult> {
    const now = this.now();
    const day = tradingDayKey(market, now);
    const hit = this.cache.get(market);
    if (hit && hit.day === day && now.getTime() - hit.at < hit.ttl) return hit.value;
    // 결과가 나오기 전에는 진행 중인 계산을 함께 쓴다
    const entry = { day, at: now.getTime(), ttl: Infinity, value: this.load(market, day) };
    this.cache.set(market, entry);
    entry.value.then(
      // 집계가 하나도 안 되면 캐시하지 않는다(다음 요청에서 다시 시도)
      (r) => (entry.ttl = r.analysis ? (this.opts.ttlMs ?? BREADTH_SOURCE_DEFAULTS.ttlMs) : 0),
      () => (entry.ttl = 0),
    );
    return entry.value;
  }

  /** 캐시 비우기(다음 요청에서 새로 계산) */
  clear(market?: Market) {
    if (market) this.cache.delete(market);
    else this.cache.clear();
  }

  private async load(market: Market, day: string): Promise<BreadthResult> {
    const errors: string[] = [];
    const count = this.opts.candleCount ?? BREADTH_SOURCE_DEFAULTS.candleCount;
    const picked = await this.pickBasket(market, errors);

    // 사이트 부담을 줄이려 한 종목씩 차례로 받는다. 실패한 종목은 건너뛴다
    const series: Candle[][] = [];
    const basket: string[] = [];
    for (const code of picked.codes) {
      try {
        const cs = await this.deps.getCandles(code, count);
        if (cs.length) {
          series.push(cs);
          basket.push(code);
        } else errors.push(`${code}: 일봉이 비어 있어요`);
      } catch (e) {
        errors.push(`${code}: ${msg(e)}`);
      }
    }
    let index: Candle[] = [];
    try {
      index = await this.deps.getIndexCandles(market, count);
    } catch (e) {
      errors.push(`지수 일봉: ${msg(e)} — A/D선 괴리 판단은 빠져요`);
    }
    const today = await this.loadToday(market, day, errors);

    const days = breadthFromCandles(series);
    const basis = basisText(market, picked.how, basket.length);
    const analysis = analyzeBreadth(days, index, { basis });
    if (!analysis) errors.push("시장 폭을 집계할 날짜가 없어요(표본 일봉 부족)");
    return { market, analysis, days, today, basket, errors, sample: this.sample, fetchedAt: this.now().toISOString() };
  }

  private async pickBasket(market: Market, errors: string[]): Promise<{ codes: string[]; how: BasketHow }> {
    const size = Math.max(1, this.opts.basketSize ?? BREADTH_SOURCE_DEFAULTS.basketSize);
    const fallback = this.opts.fallbackCodes?.[market];
    if (market === "US") {
      if (!this.http && fallback?.length) return { codes: fallback.slice(0, size), how: "sample" };
      return { codes: US_BREADTH_BASKET.slice(0, size), how: this.http ? "us" : "sample" };
    }
    if (this.http) {
      const codes: string[] = [];
      const seen = new Set<string>();
      // 우선주·ETF를 거르고도 size를 채우도록 한 페이지 더
      const pages = Math.ceil(size / BREADTH_SOURCE_DEFAULTS.pageSize) + 1;
      for (let p = 1; p <= pages && codes.length < size; p++) {
        let rows: { code: string; name: string }[];
        try {
          rows = parseNaverMarketSum(await this.http.get(NAVER_BREADTH.marketSum(market, p), naverOpts));
        } catch (e) {
          errors.push(`시가총액 순위 ${p}쪽: ${msg(e)}`);
          break;
        }
        if (!rows.length) {
          if (p === 1) errors.push("시가총액 순위표를 알아보지 못했어요(형식이 바뀌었을 수 있어요)");
          break;
        }
        for (const r of rows) {
          if (seen.has(r.code) || !isLikelyCommonStock(r.name)) continue;
          seen.add(r.code);
          codes.push(r.code);
        }
      }
      if (codes.length) return { codes: codes.slice(0, size), how: "ranking" };
    }
    if (fallback?.length) {
      if (this.http) errors.push("시가총액 순위 대신 기본 종목 목록으로 계산했어요");
      return { codes: fallback.slice(0, size), how: this.http ? "fallback" : "sample" };
    }
    errors.push(`${market} 표본 종목 목록이 없어요`);
    return { codes: [], how: this.http ? "fallback" : "sample" };
  }

  private async loadToday(market: Market, day: string, errors: string[]): Promise<BreadthToday | null> {
    if (market === "US") return null; // 미국은 거래소 전체 등락 수 출처를 두지 않았다
    if (!this.http) return sampleBreadthToday(market, day);
    try {
      const t = parseNaverBreadthToday(await this.http.get(NAVER_BREADTH.index(market), naverOpts), market);
      if (!t) errors.push("오늘 등락 종목 수를 지수 페이지에서 찾지 못했어요(형식이 바뀌었을 수 있어요)");
      return t;
    } catch (e) {
      errors.push(`오늘 등락 종목 수: ${msg(e)}`);
      return null;
    }
  }
}

type BasketHow = "ranking" | "fallback" | "us" | "sample";

function basisText(market: Market, how: BasketHow, n: number): string {
  switch (how) {
    case "ranking":
      return `${market} 시가총액 상위 ${n}종목(보통주) 기준 근사`;
    case "fallback":
      return `${market} 기본 목록 ${n}종목 기준 근사(시가총액 순위를 못 읽어 대신 썼어요)`;
    case "us":
      return `미국 대형주 ${n}종목(S&P 100 구성 종목) 기준 근사`;
    case "sample":
      return `샘플 데이터 ${n}종목 기준(실제 시장 아님)`;
  }
}

/** 시장의 현지 날짜(YYYY-MM-DD). 캐시를 거래일 단위로 나눈다 */
export function tradingDayKey(market: Market, d: Date): string {
  const timeZone = market === "US" ? "America/New_York" : "Asia/Seoul";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * 샘플 모드용 '오늘 등락 종목 수'(시장·날짜 해시로 정해지는 가짜 값). 실제 시장 자료가 아니다.
 * 상장 종목 수는 대략치(코스피 약 950, 코스닥 약 1,700)로 고정했다.
 */
export function sampleBreadthToday(market: Market, date: string): BreadthToday {
  const h = hash(`${market}:${date}:breadth`);
  const listed = market === "KOSDAQ" ? 1700 : 950;
  const upShare = 0.25 + ((h % 1000) / 1000) * 0.45; // 25~70%
  const unchanged = Math.round(listed * (0.04 + ((h >>> 10) % 50) / 1000)); // 4~9%
  const upperLimit = (h >>> 16) % 6;
  const lowerLimit = (h >>> 20) % 3;
  const up = Math.round((listed - unchanged) * upShare) - upperLimit;
  const down = listed - unchanged - up - upperLimit - lowerLimit;
  return { up, upperLimit, unchanged, down, lowerLimit };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
