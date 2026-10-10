import { sma, type Series } from "./indicators";
import type { Note, Region } from "./types";

/*
 * 분봉 장중 매매 타점(자료집 4.7 장중·단기 매매 타점, 부록 A M3-18 — 강창권).
 * - 'N분선'은 그 분봉 차트의 N봉 단순이동평균으로 해석한다. HTS 분봉 이평선의 N은 봉 개수라서
 *   1분봉 20분선 = 1분봉 20봉 SMA, 3분봉 10분선 = 3분봉 10봉 SMA(30분 평균), 3분봉 20분선 = 3분봉 20봉 SMA(60분 평균)이다.
 * - 미래 참조 없음: '지금'(nowMinutes) 이전에 끝난 1분봉만 쓰고, 3분봉 종가 기준 판정은 완성된 3분봉만 쓴다.
 * - 앱 해석(책에 수치가 없는 부분): 시간외 급등 여부를 모르는 +7~10% 갭은 +10% 갭처럼 20분 대기 + 지지 확인,
 *   '갭 없이 출발' = ±2% 이내, '급등' = 전일 대비 +5% 이상이고 3분봉 20분선보다 3% 이상 위, '지지' = 위에 있던 가격이
 *   선까지 내려와 닿은 뒤 종가로 깨지 않고 다시 위에서 마감. 값은 모두 INTRADAY_PARAMS에서 바꿀 수 있다.
 * - 판정 우선순위: 시간외 급등 갭(패스) → 큰 갭(M3-18 절차) → 전일 상한가 갭 없는 출발(10~30분) → 3분봉 첫 눌림 → 전일 고가 돌파.
 * - 경험칙을 옮긴 것이며 수익이 검증된 규칙이 아니다(모의매매로 확인 필요).
 */

export interface IntradayBar {
  /** 거래소 현지 시각 'YYYY-MM-DDTHH:mm'. 그 봉 구간이 시작하는 분 */
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 정규장(현지 시각). sessions.ts의 장 시간과 같은 값. 시간외·동시호가 세부는 반영하지 않는다 */
export const INTRADAY_SESSIONS: Record<Region, { tz: string; open: string; close: string }> = {
  KR: { tz: "Asia/Seoul", open: "09:00", close: "15:30" },
  US: { tz: "America/New_York", open: "09:30", close: "16:00" },
};

export interface IntradayParams {
  gapNoChasePct: number;
  gapCautionPct: number;
  cautionGapWaits: boolean;
  gapWaitMinutes: number;
  ma1mHold: number;
  ma3mHold: number;
  ma3mPullback: number;
  ma3mFast: number;
  ma3mSlow: number;
  limitUpFlatGapPct: number;
  limitUpDigestFrom: number;
  limitUpDigestTo: number;
  supportTolPct: number;
  supportLookback: number;
  surgeDayPct: number;
  surgeAboveMaPct: number;
  breakoutTolPct: number;
  breakoutMinBarsAfter: number;
  splitFractions: readonly number[];
  dailyMas: readonly [number, number, number];
  dailyRisingLookback: number;
}

/** 분봉 판정 기준. 책에서 온 값과 앱 기본값(조정·모의매매 검증 대상)을 주석에 구분했다 */
export const INTRADAY_PARAMS: Readonly<IntradayParams> = {
  /** 시초가가 전일 종가보다 이 % 이상 높으면 시초가 매수 금지(M3-18·4.7 강창권: +10%) */
  gapNoChasePct: 10,
  /** 전일 시간외 급등 종목은 이 % 이상 갭도 원칙적으로 패스(4.7 강창권: +7%) */
  gapCautionPct: 7,
  /**
   * 시간외 급등 여부를 모르거나 아닐 때 gapCautionPct~gapNoChasePct 갭도 M3-18 절차(20분 대기 + 1분봉 20분선 지지 확인)를
   * 따른다(앱 기본값: 보수적 해석. 책의 +7% 기준은 시간외 급등 종목에만 적용된다)
   */
  cautionGapWaits: true,
  /** 큰 갭 뒤 기다리는 시간(분)(M3-18·4.7 강창권: 약 20분) */
  gapWaitMinutes: 20,
  /** 1분봉 지지·보유 기준선 = 1분봉 20봉 SMA(4.7 강창권 '1분봉 20분선') */
  ma1mHold: 20,
  /** 3분봉 보유 기준선 = 3분봉 10봉 SMA(4.7 강창권 '3분봉 10분선') */
  ma3mHold: 10,
  /** 3분봉 눌림 매수 기준선 = 3분봉 20봉 SMA(4.7 강창권 '20분선') */
  ma3mPullback: 20,
  /** 3분봉 동반 이탈 손절선 = 3분봉 5봉·20봉 SMA(4.7 강창권 '5분선과 20분선') */
  ma3mFast: 5,
  ma3mSlow: 20,
  /** 전일 상한가 종목의 '갭 없이 출발' = 시초가가 전일 종가 ±이 % 이내(앱 기본값. 책은 '갭 상승 없이'라고만 함) */
  limitUpFlatGapPct: 2,
  /** 전일 상한가 종목이 성급한 매도 물량을 소화하는 시간(분)(4.7 강창권: 10~30분) */
  limitUpDigestFrom: 10,
  limitUpDigestTo: 30,
  /** 이평선에 '닿음'·'지지' 판정 허용 오차(%)(앱 기본값) */
  supportTolPct: 0.3,
  /** 1분봉 20분선 지지 확인에서 되돌아보는 1분봉 수(앱 기본값) */
  supportLookback: 10,
  /** '급등' 판정 ①: 오늘 고가가 전일 종가보다 이 % 이상(앱 기본값. 책은 '급등'이라고만 함) */
  surgeDayPct: 5,
  /** '급등' 판정 ②: 3분봉 고가가 3분봉 20분선보다 이 % 이상 위로 벌어짐(앱 기본값) */
  surgeAboveMaPct: 3,
  /** 전일 고가 돌파 뒤 되돌림(지지 시험)·이탈 판정 허용 오차(%)(앱 기본값) */
  breakoutTolPct: 0.5,
  /** 돌파 봉 뒤 이만큼의 1분봉이 지나야 '그 위에서 지지'로 인정(앱 기본값: 돌파 직후 한두 봉의 흔들림은 판단 보류) */
  breakoutMinBarsAfter: 3,
  /** 분할 매수가: 3분봉 첫 캔들 종가에서 몸통의 이 비율만큼 내려온 선(4.7 강창권: 종가 기준 1/3선, 몸통 중심선 = 1/2) */
  splitFractions: [1 / 3, 1 / 2],
  /** 일봉 정배열 판정 이평선(4.7 강창권: 5·20·60일선) */
  dailyMas: [5, 20, 60],
  /** 일봉 '우상향' = 세 이평선이 모두 이 거래일 전보다 높음(앱 기본값) */
  dailyRisingLookback: 5,
};

const R18 = "M3-18 강창권";
const R47 = "4.7 강창권";

/** 'HH:mm' → 자정 이후 분. 형식이 다르면 NaN */
export function hmToMinutes(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return NaN;
  const h = Number(m[1]), mm = Number(m[2]);
  return h <= 23 && mm <= 59 ? h * 60 + mm : NaN;
}

/** 봉 시각('YYYY-MM-DDTHH:mm')의 자정 이후 분. 형식이 다르면 NaN */
export function barMinutes(t: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export const barDate = (t: string) => t.slice(0, 10);

const pad2 = (n: number) => String(n).padStart(2, "0");
export const minutesToHm = (min: number) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

const byTime = (bars: IntradayBar[]) => [...bars].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

/**
 * 1분봉을 N분봉으로 합친다. 구간은 장 시작(sessionOpen)부터 N분 단위로 나눈다(09:00 시작 3분봉 = 09:00, 09:03, …).
 * 날짜가 바뀌면 새 구간. 봉 시각은 구간 시작 시각. 입력 순서와 무관하게 시간순으로 정렬해 합친다.
 * 마지막 구간은 진행 중(미완성)일 수 있으니 종가 기준 판정에는 완성 여부를 따로 확인할 것.
 */
export function aggregateBars(bars1m: IntradayBar[], minutes: number, sessionOpen: string): IntradayBar[] {
  const open = hmToMinutes(sessionOpen);
  if (!(minutes >= 1) || !Number.isInteger(minutes) || !Number.isFinite(open)) return [];
  const out: IntradayBar[] = [];
  let key = "";
  for (const b of byTime(bars1m)) {
    const m = barMinutes(b.t);
    if (!Number.isFinite(m)) continue;
    const start = Math.max(0, open + Math.floor((m - open) / minutes) * minutes);
    const k = `${barDate(b.t)}T${minutesToHm(start)}`;
    const cur = out[out.length - 1];
    if (cur && k === key) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    } else {
      out.push({ t: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
      key = k;
    }
  }
  return out;
}

/** values[end-period, end)의 단순평균. 값이 모자라면 null */
export function smaOf(values: number[], period: number, end = values.length): number | null {
  if (!(period >= 1) || end > values.length || end < period) return null;
  let s = 0;
  for (let i = end - period; i < end; i++) s += values[i]!;
  return s / period;
}

/**
 * 일봉 5·20·60일선 정배열(5 > 20 > 60)이면서 세 선이 모두 dailyRisingLookback일 전보다 높은지(4.7 강창권 돌파 조건).
 * closes는 판정 시점까지의 일봉 종가만 넘길 것(미래 참조 금지). 봉이 모자라면 null.
 */
export function isDailyAligned(closes: number[], partial: Partial<IntradayParams> = {}): boolean | null {
  const P = { ...INTRADAY_PARAMS, ...partial };
  const [f, m, s] = P.dailyMas;
  const lb = P.dailyRisingLookback;
  const n = closes.length;
  if (n < s + lb) return null;
  const now = [smaOf(closes, f), smaOf(closes, m), smaOf(closes, s)];
  const then = [smaOf(closes, f, n - lb), smaOf(closes, m, n - lb), smaOf(closes, s, n - lb)];
  if (now.some((x) => x == null) || then.some((x) => x == null)) return null;
  const [a, b, c] = now as number[];
  return a! > b! && b! > c! && now.every((x, i) => x! > then[i]!);
}

export interface IntradayInput {
  /** 오늘 1분봉(오래된 순). 마지막 봉의 날짜를 오늘로 보고, 장 시작 전 봉과 nowMinutes 이후 봉은 버린다 */
  bars1m: IntradayBar[];
  /** 이전 거래일 1분봉(선택). HTS 분봉처럼 이평선을 전일부터 이어 계산할 때만 쓴다(갭·저점 판정에는 안 씀) */
  prevBars1m?: IntradayBar[];
  /** 전 거래일 종가·고가(오늘 진행 중인 일봉 말고 확정된 전일 봉) */
  prevClose: number;
  prevHigh: number;
  /** 일봉 5·20·60일선 정배열 우상향 여부(isDailyAligned). 모르면 null */
  dailyAligned: boolean | null;
  /** 전일 상한가 마감 여부 */
  prevLimitUp?: boolean;
  /** 전일 시간외단일가 급등 여부. 모르면 비워 둔다 */
  afterHoursSurge?: boolean;
  /** 정규장 시작 'HH:mm'(INTRADAY_SESSIONS) */
  sessionOpen: string;
  /** 평가 시각(현지, 자정 이후 분). 이 시각 전에 끝난 1분봉(시작 분 < nowMinutes)만 쓴다. 없으면 마지막 봉이 끝난 시각 */
  nowMinutes?: number;
}

export type IntradayVerdict = "buy" | "wait" | "avoid";

export interface IntradayAssessment {
  /** 판정에 쓴 마지막 1분봉 시각 */
  asOf: string | null;
  /** 시초가 갭(%) = 오늘 첫 1분봉 시가 ÷ 전일 종가 − 1 */
  gapPct: number | null;
  minutesSinceOpen: number;
  sessionLow: number | null;
  /** 마지막 1분봉 종가 */
  last: number | null;
  entry: {
    verdict: IntradayVerdict;
    notes: Note[];
    /**
     * 분할 매수가(높은 값부터): 3분봉 첫 캔들의 종가 기준 1/3선(종가에서 몸통의 1/3만큼 시가 쪽), 몸통 중심선.
     * 음봉이면 두 선이 종가 위쪽 몸통 안에 생긴다. 첫 3분봉이 완성되기 전엔 빈 배열
     */
    splitPrices: number[];
    /** verdict가 buy일 때의 손절 기준가 */
    stop: number | null;
  };
  hold: { ma20on1m: number | null; ma10on3m: number | null; below1m20: boolean; below3m10: boolean; note: Note };
  /** 3분봉 첫 눌림 매수(하루 1회). firstTouchAt = 급등 후 3분봉이 20분선에 처음 닿은 봉 시각 */
  pullback3m: { signal: boolean; firstTouchAt: string | null; note: Note };
  /** 3분봉 종가가 5분선·20분선을 함께 이탈(즉시 손절 기준) */
  stop3m: { signal: boolean; note: Note };
  breakout: { prevHighBroken: boolean; supportConfirmed: boolean; note: Note };
  /** entry.notes + 보유·눌림·손절·돌파 메모(중복 제거) */
  notes: Note[];
}

/**
 * 이평선 지지: 최근 lookback봉 안(from 이후)에서 이평선 위에 있던 가격(직전 봉 종가 > 이평선)이 저가로 이평선(+오차)까지
 * 내려와 닿았고, 그 뒤로 종가가 이평선(−오차) 아래로 마감한 적이 없으며, 마지막 종가가 이평선 위에 있으면 지지로 본다.
 * 아래에서 위로 뚫고 올라온 봉은 지지가 아니라 돌파라서 닿음으로 치지 않는다.
 */
function maSupport(bars: IntradayBar[], ma: Series, from: number, lookback: number, tolPct: number) {
  const n = bars.length;
  const t = tolPct / 100;
  let touchIndex: number | null = null;
  for (let j = n - 1; j >= Math.max(from, 1, n - lookback); j--) {
    const m = ma[j];
    const b = bars[j]!;
    if (m == null || b.close < m * (1 - t)) break;
    const pm = ma[j - 1];
    if (b.low <= m * (1 + t) && pm != null && bars[j - 1]!.close > pm) touchIndex = j;
  }
  const lastMa = n > 0 ? (ma[n - 1] ?? null) : null;
  const lastClose = bars[n - 1]?.close;
  const above = lastMa != null && lastClose != null && lastClose > lastMa;
  return { ma: lastMa, touched: touchIndex != null, above, supported: touchIndex != null && above };
}

/**
 * 전일 고가 돌파 상태(오늘 1분봉 종가 기준). 가장 최근 돌파 이후 종가가 (돌파가 −오차) 아래로 내려가면 실패.
 * 지지 확인 = 돌파 봉 뒤 minBarsAfter봉 이상 지났고, 그 사이 저가가 (돌파가 +오차)까지 되돌아왔으며(지지 시험) 마지막 종가가 돌파가 위.
 */
function breakoutState(bars: IntradayBar[], level: number, tolPct: number, minBarsAfter: number) {
  const t = tolPct / 100;
  let b = -1;
  let below = true;
  for (let j = 0; j < bars.length; j++) {
    const c = bars[j]!.close;
    if (below && c > level) {
      b = j;
      below = false;
    } else if (!below && c < level * (1 - t)) below = true;
  }
  if (b < 0) return { broken: false, failed: false, retested: false, supported: false, retestLow: null as number | null };
  if (below) return { broken: true, failed: true, retested: false, supported: false, retestLow: null as number | null };
  let retested = false;
  let low = Infinity;
  for (let j = b + 1; j < bars.length; j++) {
    low = Math.min(low, bars[j]!.low);
    if (bars[j]!.low <= level * (1 + t)) retested = true;
  }
  const lastClose = bars[bars.length - 1]!.close;
  const enough = bars.length - 1 - b >= minBarsAfter;
  return { broken: true, failed: false, retested, supported: enough && retested && lastClose > level, retestLow: retested ? low : null };
}

/** 오늘 분봉으로 장중 매매 타점을 판정한다. nowMinutes 전에 끝난 봉만 쓴다(미래 참조 없음) */
export function assessIntraday(input: IntradayInput, partial: Partial<IntradayParams> = {}): IntradayAssessment {
  const P = { ...INTRADAY_PARAMS, ...partial };
  const open = hmToMinutes(input.sessionOpen);
  const sorted = byTime(input.bars1m);
  const lastRaw = sorted[sorted.length - 1];
  const date = lastRaw ? barDate(lastRaw.t) : null;
  const nowIn = input.nowMinutes;
  const today = sorted.filter((b) => {
    const m = barMinutes(b.t);
    return barDate(b.t) === date && m >= open && (nowIn == null || m < nowIn);
  });
  const lastBar = today[today.length - 1];
  const now = nowIn ?? (lastBar ? barMinutes(lastBar.t) + 1 : open);
  const minutesSinceOpen = Number.isFinite(open) ? Math.max(0, now - open) : 0;

  const warm = date ? byTime(input.prevBars1m ?? []).filter((b) => barDate(b.t) < date) : [];
  const all = [...warm, ...today];
  const from = warm.length;
  const decimals = all.every((b) => [b.open, b.high, b.low, b.close].every(Number.isInteger)) ? 0 : 2;
  const rp = (x: number) => Number(x.toFixed(decimals));
  const px = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const info = (text: string, rule = R47): Note => ({ tone: "info", text, rule });

  if (!lastBar || !Number.isFinite(open)) {
    const none = info("아직 오늘 분봉이 없어요. 장이 시작되면 다시 확인해 주세요.");
    return {
      asOf: null, gapPct: null, minutesSinceOpen, sessionLow: null, last: null,
      entry: { verdict: "wait", notes: [none], splitPrices: [], stop: null },
      hold: { ma20on1m: null, ma10on3m: null, below1m20: false, below3m10: false, note: none },
      pullback3m: { signal: false, firstTouchAt: null, note: none },
      stop3m: { signal: false, note: none },
      breakout: { prevHighBroken: false, supportConfirmed: false, note: none },
      notes: [none],
    };
  }

  const first = today[0]!;
  const gapRaw = input.prevClose > 0 ? (first.open / input.prevClose - 1) * 100 : null;
  const gapPct = gapRaw == null ? null : Math.round(gapRaw * 100) / 100;
  const sessionLow = Math.min(...today.map((b) => b.low));
  const last = lastBar.close;
  // 마지막 봉이 당일 저점을 새로 깼는지(직전까지의 저점 아래)
  const priorLow = today.length >= 2 ? Math.min(...today.slice(0, -1).map((b) => b.low)) : Infinity;
  const brokeLow = lastBar.low < priorLow;

  // ── 1분봉 20분선
  const ma1 = sma(all.map((b) => b.close), P.ma1mHold);
  const sup1 = maSupport(all, ma1, from, P.supportLookback, P.supportTolPct);

  // ── 3분봉(완성봉만): 진행 중인 마지막 구간은 now가 구간 끝에 닿아야 완성
  const agg3 = aggregateBars(all, 3, input.sessionOpen);
  const c3 = agg3.filter((b) => barDate(b.t) < date! || barMinutes(b.t) + 3 <= now);
  const fromC = c3.findIndex((b) => barDate(b.t) === date);
  const has3 = fromC >= 0;
  const closes3 = c3.map((b) => b.close);
  const s3hold = sma(closes3, P.ma3mHold);
  const s3fast = sma(closes3, P.ma3mFast);
  const s3slow = sma(closes3, P.ma3mSlow);
  const s3pull = P.ma3mPullback === P.ma3mSlow ? s3slow : sma(closes3, P.ma3mPullback);
  const lastC = c3.length - 1;

  // ── 분할 매수가: 오늘 첫 3분봉(장 시작 구간)이 완성됐을 때만
  const first3 = has3 ? c3[fromC]! : null;
  const splitPrices =
    first3 && barMinutes(first3.t) === open
      ? [...new Set(P.splitFractions.map((f) => rp(first3.close - f * (first3.close - first3.open))))].sort((a, b) => b - a)
      : [];

  // ── 보유 기준(4.7): 1분봉 20분선, 3분봉 10분선
  const ma20on1m = sup1.ma;
  const ma10on3m = has3 ? (s3hold[lastC] ?? null) : null;
  const below1m20 = ma20on1m != null && last < ma20on1m;
  const below3m10 = ma10on3m != null && c3[lastC]!.close < ma10on3m;
  let holdNote: Note;
  if (ma20on1m == null && ma10on3m == null)
    holdNote = info(`보유 기준선을 계산할 봉이 아직 부족해요(1분봉 ${P.ma1mHold}개, 3분봉 ${P.ma3mHold}개 필요).`);
  else if (below1m20 && below3m10)
    holdNote = { tone: "bad", text: `1분봉 20분선(${px(ma20on1m!)})과 3분봉 10분선(${px(ma10on3m!)})을 모두 이탈했어요. 보유 기준상 매도 구간이에요.`, rule: R47 };
  else if (below1m20)
    holdNote = { tone: "warn", text: `1분봉 20분선(${px(ma20on1m!)})을 이탈했어요. 1분봉을 보고 있다면 매도 기준이에요${ma10on3m != null ? "(3분봉 10분선은 아직 유지)" : ""}.`, rule: R47 };
  else if (below3m10)
    holdNote = { tone: "warn", text: `3분봉 종가가 10분선(${px(ma10on3m!)})을 이탈했어요. 3분봉을 보고 있다면 매도 기준이에요${ma20on1m != null ? "(1분봉 20분선은 아직 유지)" : ""}.`, rule: R47 };
  else {
    const parts = [ma20on1m != null ? `1분봉 20분선(${px(ma20on1m)})` : null, ma10on3m != null ? `3분봉 10분선(${px(ma10on3m)})` : null].filter(Boolean);
    holdNote = { tone: "good", text: `${parts.join("과 ")} 위에 있어요. 이탈하기 전까지는 보유 기준을 지키고 있어요.`, rule: R47 };
  }

  // ── 3분봉 동반 이탈 손절(4.7): 마지막 완성 3분봉 종가 < 5분선 && < 20분선
  const f5 = has3 ? (s3fast[lastC] ?? null) : null;
  const s20 = has3 ? (s3slow[lastC] ?? null) : null;
  const stopSignal = f5 != null && s20 != null && c3[lastC]!.close < f5 && c3[lastC]!.close < s20;
  const stopNote: Note = stopSignal
    ? { tone: "bad", text: `3분봉 종가가 5분선(${px(f5!)})과 20분선(${px(s20!)})을 함께 이탈했어요. 눌림 매수 물량은 즉시 손절 기준이에요.`, rule: R47 }
    : f5 == null || s20 == null
      ? info(`3분봉 5·20분선을 계산할 완성 3분봉이 아직 부족해요(${P.ma3mSlow}개 필요).`)
      : info("3분봉 종가가 5분선·20분선을 함께 이탈하지는 않았어요.");

  // ── 3분봉 첫 눌림(4.7): 급등 뒤 3분봉이 20분선에 처음 닿는 봉에서 1회만
  const tol = P.supportTolPct / 100;
  const ref = input.prevClose > 0 ? input.prevClose : first.open;
  let armed = false;
  let maReady = false;
  let touch = -1;
  let dayHigh = -Infinity;
  for (let j = has3 ? fromC : c3.length; j < c3.length; j++) {
    const b = c3[j]!;
    dayHigh = Math.max(dayHigh, b.high);
    const m = s3pull[j];
    if (m == null) continue;
    maReady = true;
    if (!armed) {
      armed = b.high >= m * (1 + P.surgeAboveMaPct / 100) && dayHigh >= ref * (1 + P.surgeDayPct / 100);
      continue; // 급등 봉 자체는 눌림이 아니다
    }
    if (b.low <= m * (1 + tol)) {
      touch = j;
      break;
    }
  }
  let pullSignal = false;
  let pullNote: Note;
  const firstTouchAt = touch >= 0 ? c3[touch]!.t : null;
  if (touch >= 0) {
    const b = c3[touch]!;
    const m = s3pull[touch]!;
    const fast = s3fast[touch];
    const broke = b.close < m * (1 - tol) || (fast != null && b.close < fast && b.close < (s3slow[touch] ?? Infinity));
    if (touch === lastC && !broke) {
      pullSignal = true;
      pullNote = { tone: "good", text: `급등 뒤 첫 눌림에서 3분봉이 20분선(${px(m)})에 처음 닿았어요. 오늘 한 번만 쓰는 매수 타점이에요. 5분선과 20분선을 종가로 함께 이탈하면 즉시 손절하세요.`, rule: R47 };
    } else if (touch === lastC)
      pullNote = { tone: "warn", text: `첫 눌림에서 3분봉 종가가 20분선(${px(m)}) 아래로 마감했어요. 지지가 아니라 이탈이라 매수하지 않아요.`, rule: R47 };
    else pullNote = info(`첫 눌림(${b.t.slice(11)} 3분봉)은 이미 지났어요. 3분봉 눌림 매수는 하루 1회만이에요.`);
  } else if (!maReady) pullNote = info(`3분봉 20분선을 계산할 완성 3분봉이 아직 부족해요(${P.ma3mPullback}개 필요).`);
  else if (!armed) pullNote = info(`급등(전일 대비 +${P.surgeDayPct}% 이상, 3분봉 20분선 위 +${P.surgeAboveMaPct}% 이상)이 없어 3분봉 눌림 매수 대상이 아니에요.`);
  else pullNote = info(`급등 뒤 3분봉 20분선(${px(s3pull[lastC] ?? 0)})까지의 첫 눌림을 기다려요.`);

  // ── 전일 고가 돌파(4.7): 뚫은 뒤 그 위에서 지지 확인 + 일봉 정배열 우상향
  const level = input.prevHigh;
  const bo = level > 0 ? breakoutState(today, level, P.breakoutTolPct, P.breakoutMinBarsAfter) : { broken: false, failed: false, retested: false, supported: false, retestLow: null };
  let boNote: Note;
  if (!(level > 0)) boNote = info("전일 고가 정보가 없어 돌파를 판정하지 않았어요.");
  else if (!bo.broken) boNote = info(`전일 고가(${px(level)})를 아직 종가로 넘지 못했어요. 첫 돌파 지점은 전일 고가예요.`);
  else if (bo.failed) boNote = { tone: "warn", text: `전일 고가(${px(level)})를 넘었다가 다시 아래로 밀렸어요(돌파 실패). 지지가 확인될 때까지 사지 않아요.`, rule: R47 };
  else if (!bo.supported) boNote = info(`전일 고가(${px(level)}) 돌파 뒤 그 위에서 지지(되돌림 후 유지)가 확인될 때까지 기다려요.`);
  else if (input.dailyAligned === true)
    boNote = { tone: "good", text: `전일 고가(${px(level)})를 뚫고 그 위에서 지지를 확인했어요. 일봉도 5·20·60일선 정배열 우상향이라 돌파 매수 조건을 갖췄어요.`, rule: R47 };
  else if (input.dailyAligned === false)
    boNote = { tone: "bad", text: "전일 고가 돌파 뒤 지지는 확인됐지만 일봉 5·20·60일선 정배열 우상향 종목이 아니라 돌파 매수 대상이 아니에요.", rule: R47 };
  else boNote = { tone: "warn", text: "전일 고가 돌파 뒤 지지는 확인됐지만 일봉 정배열 여부를 몰라 돌파 매수는 보류해요.", rule: R47 };

  // ── 진입 판정
  const notes: Note[] = [];
  let verdict: IntradayVerdict = "wait";
  let stop: number | null = null;
  const waitUntil = minutesToHm(open + P.gapWaitMinutes);
  const gap = gapRaw ?? 0;
  const gapTxt = `${gapPct != null && gapPct >= 0 ? "+" : ""}${gapPct ?? 0}%`;
  const supportReason = () =>
    sup1.ma == null
      ? `1분봉 20분선을 계산할 봉이 아직 부족해요(${P.ma1mHold}개 필요)`
      : !sup1.above
        ? `가격이 1분봉 20분선(${px(sup1.ma)}) 아래예요`
        : `1분봉 20분선(${px(sup1.ma)})까지 눌렸다가 지지받는 모습이 아직 없어요(추격 금지)`;
  let handled = false;

  if (gapRaw != null && input.afterHoursSurge === true && gap >= P.gapCautionPct) {
    // 시간외 급등 종목: +10% 이상 추격 금지, +7% 이상도 원칙적으로 패스
    handled = true;
    verdict = "avoid";
    notes.push({
      tone: "bad",
      text: gap >= P.gapNoChasePct
        ? `전일 시간외단일가 급등 종목이 ${gapTxt} 갭으로 시작했어요. 추격 매수 금지예요.`
        : `전일 시간외단일가 급등 종목의 ${gapTxt} 갭(+${P.gapCautionPct}% 이상)은 원칙적으로 패스해요.`,
      rule: R47,
    });
  } else if (gapRaw != null && (gap >= P.gapNoChasePct || (P.cautionGapWaits && gap >= P.gapCautionPct))) {
    // 큰 갭: 시초가 매수 금지 → 약 20분 뒤 1분봉 20분선 지지 확인 후 분할 매수, 당일 저점 이탈 시 손절
    handled = true;
    if (gap < P.gapNoChasePct)
      notes.push({
        tone: "warn",
        text: input.afterHoursSurge === undefined
          ? `${gapTxt} 갭이에요. 전일 시간외 급등 종목이라면 원칙적으로 패스하고, 아니어도 +${P.gapNoChasePct}% 갭처럼 보수적으로 기다려요(앱 기본 해석).`
          : `${gapTxt} 갭이에요. +${P.gapNoChasePct}% 갭처럼 보수적으로 기다려요(앱 기본 해석).`,
        rule: R47,
      });
    if (minutesSinceOpen < P.gapWaitMinutes) {
      notes.push({ tone: "warn", text: `시초가가 ${gapTxt} 갭으로 시작했어요. 시초가 매수는 금지예요. 약 ${P.gapWaitMinutes}분(${waitUntil} 이후) 기다려 1분봉 20분선 지지를 확인하세요.`, rule: R18 });
    } else if (brokeLow) {
      notes.push({ tone: "bad", text: `당일 저점을 새로 깼어요(${px(sessionLow)}). 손절 기준이 무너지는 자리라 매수하지 않아요.`, rule: R18 });
    } else if (sup1.supported) {
      verdict = "buy";
      stop = rp(sessionLow);
      notes.push({ tone: "good", text: `1분봉 20분선(${px(sup1.ma!)}) 지지를 확인했어요. 시장가 일괄 매수 대신 2~3회 나눠 사고, 당일 저점(${px(sessionLow)})을 이탈하면 손절하세요.`, rule: R18 });
    } else {
      notes.push({ tone: "warn", text: `${gapTxt} 갭 종목이에요. ${supportReason()}. 기다려요.`, rule: R18 });
    }
  } else if (gapRaw != null && input.prevLimitUp === true && Math.abs(gap) <= P.limitUpFlatGapPct) {
    // 전일 상한가 + 갭 없이 출발: 10~30분 매물 소화 뒤 한 번 더 시세가 나오는 경향
    if (minutesSinceOpen < P.limitUpDigestFrom) {
      handled = true;
      notes.push(info(`전일 상한가 종목이 갭 없이(${gapTxt}) 출발했어요. 성급한 매도 물량을 ${P.limitUpDigestFrom}~${P.limitUpDigestTo}분 소화한 뒤 한 번 더 시세가 나오는 경향이 있어요. 아직 소화 중이에요.`));
    } else if (minutesSinceOpen <= P.limitUpDigestTo) {
      handled = true;
      if (!brokeLow && sup1.supported) {
        verdict = "buy";
        stop = rp(sessionLow);
        notes.push({ tone: "good", text: `전일 상한가 종목이 매물을 소화한 뒤 1분봉 20분선(${px(sup1.ma!)})에서 지지받고 있어요. 한 번 더 시세가 나오는 경향 구간이에요. 당일 저점(${px(sessionLow)}) 이탈 시 손절하세요.`, rule: R47 });
      } else notes.push(info(`전일 상한가 종목의 매물 소화 구간(${P.limitUpDigestFrom}~${P.limitUpDigestTo}분)이에요. ${brokeLow ? "당일 저점을 새로 깨고 있어요" : supportReason()}.`));
    } else notes.push(info(`전일 상한가 종목의 매물 소화 구간(${P.limitUpDigestFrom}~${P.limitUpDigestTo}분)이 지나 일반 분봉 타점으로 판단해요.`));
  }

  if (!handled) {
    if (stopSignal) notes.push({ tone: "bad", text: "3분봉 종가가 5분선·20분선을 함께 이탈한 상태라 신규 매수를 보류해요.", rule: R47 });
    else if (pullSignal) {
      verdict = "buy";
      stop = rp(Math.min(s3fast[touch] ?? s3pull[touch]!, s3pull[touch]!));
      notes.push(pullNote);
    } else if (bo.supported && input.dailyAligned === true) {
      verdict = "buy";
      stop = bo.retestLow != null ? rp(bo.retestLow) : null;
      notes.push(boNote);
    } else {
      if (bo.supported) notes.push(boNote);
      notes.push(info("분봉 매수 타점(3분봉 첫 눌림, 전일 고가 돌파 후 지지)이 아직 없어요."));
    }
  }

  if (verdict === "buy") {
    if (splitPrices.length)
      notes.push({ tone: "info", text: `3분봉 첫 캔들 기준 분할 매수가는 ${splitPrices.map(px).join(" / ")}예요(종가 기준 1/3선·몸통 중심선).`, rule: R47 });
    else notes.push(info("첫 3분봉이 아직 완성되지 않아 분할 매수가를 계산하지 못했어요."));
  }

  const seen = new Set<string>();
  const allNotes = [...notes, holdNote, pullNote, stopNote, boNote].filter((n) => (seen.has(n.text) ? false : (seen.add(n.text), true)));

  return {
    asOf: lastBar.t,
    gapPct,
    minutesSinceOpen,
    sessionLow,
    last,
    entry: { verdict, notes, splitPrices, stop },
    hold: { ma20on1m, ma10on3m, below1m20, below3m10, note: holdNote },
    pullback3m: { signal: pullSignal, firstTouchAt, note: pullNote },
    stop3m: { signal: stopSignal, note: stopNote },
    breakout: { prevHighBroken: bo.broken, supportConfirmed: bo.supported, note: boNote },
    notes: allNotes,
  };
}

/**
 * bars1m[index]가 끝난 시점 기준 판정(백테스트용). bars1m[0..index]만 쓰고 이후 봉은 보지 않는다.
 * input.bars1m은 오늘 1분봉을 시간순으로 넘길 것.
 */
export function assessIntradayAt(input: IntradayInput, index: number, partial: Partial<IntradayParams> = {}): IntradayAssessment {
  const bars = byTime(input.bars1m).slice(0, Math.max(0, index + 1));
  const lastBar = bars[bars.length - 1];
  return assessIntraday({ ...input, bars1m: bars, nowMinutes: lastBar ? barMinutes(lastBar.t) + 1 : input.nowMinutes }, partial);
}
