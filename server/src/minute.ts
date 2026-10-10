import { marketClock, regionOfCode, type Candle, type Region } from "@jusik/shared";
import { barDate, barMinutes, hmToMinutes, INTRADAY_SESSIONS, minutesToHm, type IntradayBar } from "@jusik/shared";
import type { Http } from "./http";

/*
 * 1분봉 수집 — 네이버 fchart(국내), 야후 chart(미국)의 비공식 엔드포인트.
 * ⚠ 실제 응답과 대조하지 못함(미검증): 이 개발 환경은 외부 접속이 막혀 있어 기억하는 형식대로 짰다.
 *   형식을 못 알아보면 빈 배열을 돌려준다. `npm run check:sources -w server`류의 점검으로 실제 응답을 확인할 것.
 */

export const MINUTE_URLS = {
  naver: (code: string, count: number) => `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=minute&count=${count}&requestType=0`,
  yahoo: (symbol: string, range: "1d" | "5d") => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=${range}`,
};

export interface MinuteSourceParams {
  naverBarsPerSession: number;
  cumulativeMinBars: number;
  maxSessions: number;
}

export const MINUTE_PARAMS: Readonly<MinuteSourceParams> = {
  /** 네이버 분봉 요청 개수 ÷ 세션(앱 기본값: 정규장 약 381봉 + 넥스트레이드 등 장외 봉이 섞여 와도 하루치가 들어가게 넉넉히) */
  naverBarsPerSession: 800,
  /** 하루 거래량이 이 봉 수 이상 내내 줄지 않으면 '누적 거래량'으로 보고 차분한다(앱 기본값) */
  cumulativeMinBars: 5,
  /** 한 번에 돌려주는 최대 세션 수(앱 기본값. 야후 1분봉은 최근 며칠만 제공) */
  maxSessions: 5,
};

const numOrNull = (s: string | undefined): number | null => {
  const t = (s ?? "").trim();
  if (t === "" || /^null$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** 시가·고가·저가가 비면 종가로 채우고, 고가 ≥ max(시가, 종가) ≥ min(시가, 종가) ≥ 저가가 되게 맞춘다 */
function fillBar(t: string, o: number | null, h: number | null, l: number | null, close: number, v: number | null): IntradayBar {
  const open = o != null && o > 0 ? o : close;
  const high = Math.max(h != null && h > 0 ? h : close, open, close);
  const low = Math.min(l != null && l > 0 ? l : close, open, close);
  return { t, open, high, low, close, volume: v != null && v > 0 ? v : 0 };
}

/** 같은 시각이 여러 번 오면 나중 것으로 바꾸고 시간순 정렬 */
function dedupeSort(bars: IntradayBar[]): IntradayBar[] {
  const m = new Map<string, IntradayBar>();
  for (const b of bars) m.set(b.t, b);
  return [...m.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

/**
 * 하루 안에서 거래량이 minBars봉 이상 한 번도 줄지 않고 적어도 한 번 늘었으면 누적 거래량으로 보고 직전 봉과의 차이로 바꾼다.
 * ⚠ 미검증 추정: 네이버 분봉 거래량이 봉별인지 당일 누적인지 확인하지 못했다. 봉별 거래량이 우연히 계속 늘어난 날을 누적으로
 *   오판할 수 있고(봉 수가 적을 때), 누적값이 중간에 정정돼 줄어드는 경우엔 봉별로 남긴다.
 */
export function decumulateVolume(bars: IntradayBar[], minBars = MINUTE_PARAMS.cumulativeMinBars): IntradayBar[] {
  const out: IntradayBar[] = [];
  let i = 0;
  while (i < bars.length) {
    const d = barDate(bars[i]!.t);
    let j = i;
    while (j < bars.length && barDate(bars[j]!.t) === d) j++;
    const day = bars.slice(i, j);
    let mono = day.length >= minBars;
    let rose = false;
    for (let k = 1; k < day.length && mono; k++) {
      if (day[k]!.volume < day[k - 1]!.volume) mono = false;
      else if (day[k]!.volume > day[k - 1]!.volume) rose = true;
    }
    if (mono && rose) day.forEach((b, k) => out.push({ ...b, volume: k === 0 ? b.volume : b.volume - day[k - 1]!.volume }));
    else out.push(...day);
    i = j;
  }
  return out;
}

/**
 * 네이버 fchart 분봉 XML: <item data="YYYYMMDDHHmm|시가|고가|저가|종가|거래량" />. 시가·고가·저가는 "null"일 수 있어 종가로 채운다.
 * 시각은 봉 시작 시각으로 그대로 쓴다(봉 끝 시각 표기일 가능성도 있음 — 미검증). 거래량이 당일 누적이면 차분한다.
 * ⚠ 실제 응답과 대조하지 못함(미검증)
 */
export function parseNaverMinute(xml: string, minBars = MINUTE_PARAMS.cumulativeMinBars): IntradayBar[] {
  const bars: IntradayBar[] = [];
  for (const m of xml.matchAll(/<item\s+data="(\d{12})\|([^|"]*)\|([^|"]*)\|([^|"]*)\|([^|"]*)\|([^|"]*)"/g)) {
    const [, d, o, h, l, c, v] = m;
    const close = numOrNull(c);
    if (close == null || !(close > 0)) continue;
    const hh = Number(d!.slice(8, 10)), mm = Number(d!.slice(10, 12));
    const mo = Number(d!.slice(4, 6)), dd = Number(d!.slice(6, 8));
    if (hh > 23 || mm > 59 || mo < 1 || mo > 12 || dd < 1 || dd > 31) continue;
    const t = `${d!.slice(0, 4)}-${d!.slice(4, 6)}-${d!.slice(6, 8)}T${d!.slice(8, 10)}:${d!.slice(10, 12)}`;
    bars.push(fillBar(t, numOrNull(o), numOrNull(h), numOrNull(l), close, numOrNull(v)));
  }
  return decumulateVolume(dedupeSort(bars), minBars);
}

/**
 * 야후 chart 1분봉 JSON: timestamp(UTC 초) + meta.gmtoffset(초)로 거래소 현지 시각을 만든다. 시세 배열의 null은 건너뛴다.
 * gmtoffset이 없으면 현지 시각을 알 수 없어 빈 배열. 같은 분이 두 번 오면(마지막 진행 중 봉 등) 나중 것을 쓴다.
 * ⚠ 실제 응답과 대조하지 못함(미검증)
 */
export function parseYahooMinute(text: string): IntradayBar[] {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const r = json?.chart?.result?.[0];
  const ts: unknown = r?.timestamp;
  const off: unknown = r?.meta?.gmtoffset;
  const q = r?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || typeof off !== "number" || !Number.isFinite(off) || !q) return [];
  const at = (arr: unknown, i: number): number | null => {
    const x = Array.isArray(arr) ? arr[i] : null;
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  const bars: IntradayBar[] = [];
  ts.forEach((sec, i) => {
    const close = at(q.close, i);
    if (typeof sec !== "number" || close == null || !(close > 0)) return;
    const t = new Date((sec + off) * 1000).toISOString().slice(0, 16);
    bars.push(fillBar(t, at(q.open, i), at(q.high, i), at(q.low, i), close, at(q.volume, i)));
  });
  return dedupeSort(bars);
}

export interface SessionWindow {
  open: string;
  close: string;
}

/** date(YYYY-MM-DD) 하루치만. window를 주면 정규장 [open, close] 안의 봉만(종가 단일가 봉 포함) */
export function sessionBars(bars: IntradayBar[], date: string, window?: SessionWindow): IntradayBar[] {
  const o = window ? hmToMinutes(window.open) : -Infinity;
  const c = window ? hmToMinutes(window.close) : Infinity;
  return bars.filter((b) => {
    if (barDate(b.t) !== date) return false;
    const m = barMinutes(b.t);
    return m >= o && m <= c;
  });
}

/** 정규장 봉만 남긴 뒤 가장 최근 n개 날짜(세션)의 봉. 장외 봉만 있는 날(장 시작 전 넥스트레이드 등)은 세지 않는다 */
export function latestSessions(bars: IntradayBar[], n: number, window?: SessionWindow): IntradayBar[] {
  const dates = [...new Set(bars.map((b) => barDate(b.t)))].sort();
  const per = dates.map((d) => sessionBars(bars, d, window)).filter((x) => x.length > 0);
  return per.slice(-Math.max(1, n)).flat();
}

export interface MinuteSource {
  /** 샘플(가짜) 데이터인지 */
  readonly sample: boolean;
  /**
   * 정규장 1분봉(오래된 순). 가장 최근 sessions개 세션(기본 1). 장 시작 전이면 전 거래일 세션일 수 있으니 날짜를 확인할 것.
   * 오늘 세션은 sessionBars(bars, 오늘), 이평선 예열용 전일 세션은 sessions=2로 받아 나눠 쓴다.
   */
  getMinuteBars(code: string, sessions?: number): Promise<IntradayBar[]>;
}

/** 국내 6자리 코드는 네이버, 그 외(미국 티커)는 야후 */
export class WebMinuteSource implements MinuteSource {
  readonly sample = false;
  private readonly P: MinuteSourceParams;
  constructor(private http: Http, params: Partial<MinuteSourceParams> = {}) {
    this.P = { ...MINUTE_PARAMS, ...params };
  }

  async getMinuteBars(code: string, sessions = 1): Promise<IntradayBar[]> {
    const n = Math.min(this.P.maxSessions, Math.max(1, Math.floor(sessions)));
    const region = regionOfCode(code);
    const bars =
      region === "KR"
        ? parseNaverMinute(await this.http.get(MINUTE_URLS.naver(code, this.P.naverBarsPerSession * n), { encoding: "auto" }), this.P.cumulativeMinBars)
        : parseYahooMinute(await this.http.get(MINUTE_URLS.yahoo(code, n === 1 ? "1d" : "5d")));
    return latestSessions(bars, n, INTRADAY_SESSIONS[region]);
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 샘플 분봉의 시각 격자. 국내는 15:20~15:30 종가 단일가(동시호가)라 15:19까지 연속 봉 + 15:30 한 봉 */
const MOCK_GRID: Record<Region, { from: string; to: string; auction?: string }> = {
  KR: { from: "09:00", to: "15:20", auction: "15:30" },
  US: { from: "09:30", to: "16:00" },
};

/**
 * 일봉 하나와 맞는 가짜 1분봉 하루치: 첫 봉 시가 = 일봉 시가, 마지막 봉 종가 = 일봉 종가, 최고·최저가 = 일봉 고가·저가,
 * 거래량 합 = 일봉 거래량. 양봉이면 저가를 먼저, 음봉이면 고가를 먼저 찍는다. (code, 날짜)로 시드를 정해 항상 같은 값.
 */
export function synthMinuteSession(code: string, c: Candle, region: Region): IntradayBar[] {
  const g = MOCK_GRID[region];
  const from = hmToMinutes(g.from), to = hmToMinutes(g.to);
  const times: number[] = [];
  for (let m = from; m < to; m++) times.push(m);
  const auction = g.auction ? hmToMinutes(g.auction) : null;
  const N = times.length;
  const r = rng(hash(`${code}|${c.date}|minute`));
  const dec = [c.open, c.high, c.low, c.close].every(Number.isInteger) ? 0 : 2;
  const rd = (x: number) => Number(x.toFixed(dec));
  const H = Math.max(c.high, c.open, c.close), L = Math.min(c.low, c.open, c.close);
  const range = H - L;
  const clamp = (x: number) => Math.min(H, Math.max(L, x));

  // 연속 구간 종가 경로: 시작(시가) → 첫 극값 → 둘째 극값 → 끝(종가, 단일가가 있으면 그 직전 봉은 종가 근처)
  const up = c.close >= c.open;
  const t1 = 1 + Math.floor(r() * Math.max(1, Math.floor(N * 0.4) - 1));
  const t2 = Math.floor(N * 0.5) + Math.floor(r() * Math.max(1, N - 2 - Math.floor(N * 0.5)));
  const endIdx = N - 1;
  const endVal = auction != null ? clamp(c.close + (r() - 0.5) * range * 0.1) : c.close;
  const anchors: [number, number][] = [[-1, c.open], [Math.min(t1, endIdx - 1), up ? L : H], [Math.min(t2, endIdx - 1), up ? H : L], [endIdx, endVal]]
    .filter((a, i, arr) => i === 0 || a[0]! > arr[i - 1]![0]!) as [number, number][];
  const path = new Array<number>(N).fill(c.close);
  const sigma = range * 0.012;
  for (let a = 0; a + 1 < anchors.length; a++) {
    const [i0, v0] = anchors[a]!;
    const [i1, v1] = anchors[a + 1]!;
    // 브라운 다리: 무작위 걸음의 끝을 0으로 맞춰 두 극값 사이를 잇는다
    const walk: number[] = [0];
    for (let k = i0 + 1; k <= i1; k++) walk.push(walk[walk.length - 1]! + (r() - 0.5) * 2 * sigma);
    const span = i1 - i0;
    for (let k = i0 + 1; k <= i1; k++) {
      const f = (k - i0) / span;
      const w = walk[k - i0]! - f * walk[span]!;
      path[k] = k === i1 ? v1 : clamp(v0 + (v1 - v0) * f + w);
    }
  }

  // 거래량: 장 초반·막판이 많은 U자 분포 × 잡음, 단일가 봉은 크게
  const weights = times.map((_, k) => (1 + 1.5 * Math.exp(-k / 20) + Math.exp(-(N - 1 - k) / 15)) * (0.6 + 0.8 * r()));
  if (auction != null) weights.push(6 * (0.8 + 0.4 * r()));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const vols = weights.map((w) => Math.floor((c.volume * w) / wsum));
  vols[vols.length - 1]! += c.volume - vols.reduce((a, b) => a + b, 0);

  const out: IntradayBar[] = [];
  let prev = c.open;
  for (let k = 0; k < N; k++) {
    const o = rd(prev);
    const cl = rd(path[k]!);
    const hi = Math.max(o, cl, rd(Math.min(H, Math.max(o, cl) + r() * range * 0.004)));
    const lo = Math.min(o, cl, rd(Math.max(L, Math.min(o, cl) - r() * range * 0.004)));
    out.push({ t: `${c.date}T${minutesToHm(times[k]!)}`, open: o, high: hi, low: lo, close: cl, volume: vols[k]! });
    prev = cl;
  }
  if (auction != null) {
    const cl = rd(c.close);
    out.push({ t: `${c.date}T${minutesToHm(auction)}`, open: cl, high: cl, low: cl, close: cl, volume: vols[N]! });
  }
  // 소수 자릿수가 많은 일봉도 반올림 뒤 극값을 정확히 찍도록 보정(극값 봉의 종가가 곧 극값)
  for (const [i, v] of anchors) {
    if (i < 0 || i >= N) continue;
    if (v === H) out[i]!.high = rd(H);
    if (v === L) out[i]!.low = rd(L);
  }
  return out;
}

/**
 * 샘플 모드(PROVIDER=mock) 분봉: 일봉 샘플(getDaily)의 최근 봉들과 맞는 가짜 1분봉. 실제 시세가 아니다.
 * 오늘(현지 날짜) 세션은 지금 시각 전에 끝난 봉까지만 돌려준다(KR 09:00~15:30 Asia/Seoul, US 09:30~16:00 America/New_York).
 * 현지 날짜보다 뒤 날짜의 일봉은 아직 시작 안 한 세션이라 건너뛰고, 아직 봉이 없는 오늘 세션은 빼고 전 거래일을 쓴다.
 */
export class MockMinuteSource implements MinuteSource {
  readonly sample = true;
  constructor(private getDaily: (code: string) => Promise<Candle[]>, private now: () => Date = () => new Date()) {}

  async getMinuteBars(code: string, sessions = 1): Promise<IntradayBar[]> {
    const n = Math.min(MINUTE_PARAMS.maxSessions, Math.max(1, Math.floor(sessions)));
    const region = regionOfCode(code);
    const clock = marketClock(region, this.now());
    const daily = [...(await this.getDaily(code))].sort((a, b) => a.date.localeCompare(b.date)).filter((c) => c.date <= clock.date);
    const picked: IntradayBar[][] = [];
    for (let i = daily.length - 1; i >= 0 && picked.length < n; i--) {
      const c = daily[i]!;
      let bars = synthMinuteSession(code, c, region);
      if (c.date === clock.date) bars = bars.filter((b) => barMinutes(b.t) < clock.minutes);
      if (bars.length) picked.unshift(bars);
    }
    return picked.flat();
  }
}
