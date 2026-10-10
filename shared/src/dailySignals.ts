import { macd, rsi, sma, type MacdResult, type Series } from "./indicators";
import { argMax, argMin, disparity, meanOf, stochastic, swingHighs, swingLows, type StochasticResult } from "./indicatorsExtra";
import type { Regime } from "./regime";
import type { Candle, Note } from "./types";

/**
 * 일봉 매매 신호 모음(기초 자료집 3.7, 4.3, 4.4, 4.6, 4.7 / 규칙 M2-13, M3-05~M3-11, M3-14~M3-18).
 * 책의 수치는 저자 경험칙이라 아래 기준값은 모두 파라미터로 열어 둔다. 수익이 검증된 신호가 아니다.
 */
export interface DailySignal {
  /** 규칙 ID(부록 A). 규칙 ID가 없는 항목은 자료집 절 번호(예: "4.4") */
  id: string;
  /** 출처 약칭(예: "설춘환", "강영현·강동진") */
  source: string;
  side: "buy" | "sell" | "warn" | "info";
  text: string;
  /** 신호 종류를 구분하는 고정 키(같은 규칙 ID 안에서도 매수/매도 등을 나눈다). 신호별 백테스트·필터용 */
  key: string;
}

export interface DailySignalParams {
  /** M3-05 설춘환: 이평선 교차를 인정하는 최근 봉 수(오늘 포함) */
  crossLookback: number;
  /** M3-07·M3-10·3.7: '평소 거래량' = 직전 N일 평균(오늘 제외) */
  volAvgPeriod: number;
  /** M3-07 설춘환: 평소의 10배 이상 거래되며 상승 → 단기 매수 */
  surgeUpMult: number;
  /** M3-07: 거래량이 터지며 하락 → 매수 금지. 책에 배수가 없어 5배로 둔 구현 기준값 */
  surgeDownMult: number;
  /** M3-08 설춘환 눌림목: 5일선과 20일선이 '만나는 자리'로 보는 간격(%). 책에 수치 없음(구현 기준값) */
  pullbackGapPct: number;
  /** M3-09·M3-10 박병창: 장대 봉으로 보는 몸통 크기(시가 대비 %). 책에 수치 없음(구현 기준값) */
  bigBodyPct: number;
  /** M3-09·4.4 박병창: 직전 하락폭(음봉 몸통) 대비 회복 비율 */
  recoverRatio: number;
  /** M3-10 박병창 매도 1원칙: '거래량 급증' 배수. 책에 수치 없음(구현 기준값) */
  sellSurgeMult: number;
  /** 4.4 박병창 매수 2원칙·매도 2원칙: 직전 고점을 찾는 범위(봉). 책에 수치 없음(구현 기준값) */
  swingLookback: number;
  /** 4.4 매도 2원칙: '거래량이 실린' 음봉 = 평소 거래량의 이 배수 이상(구현 기준값) */
  sell2VolMult: number;
  /** 4.4 박병창 매수 3원칙: 급락을 찾는 범위(봉)와 하락률(%). 책: "빠르게 10% 이상 급락" */
  crashLookback: number;
  crashPct: number;
  /** 매수 3원칙: 반등일 거래량 ≥ 직전 5일 평균 × 이 배수(책에 수치 없음, 구현 기준값) */
  crashVolMult: number;
  crashVolPeriod: number;
  /** 도지로 보는 몸통/전체 범위 비율(구현 기준값) */
  dojiBodyRatio: number;
  /** M3-11 강창권 이격도 과열: 기준 이평선 기간 */
  disparityShort: number;
  disparityLong: number;
  /** 상승장(국면이 약세가 아닐 때) 기준 %: 25일 106, 75일 110 */
  overheatShort: number;
  overheatLong: number;
  /** 하락장(국면 BEAR) 기준 %: 25일 102, 75일 104 */
  overheatShortBear: number;
  overheatLongBear: number;
  /** M3-14 강영현·강동진 / 4.6: RSI 기준선 */
  rsiOversold: number;
  rsiOverbought: number;
  /** M3-14: 30 아래에 머물렀는지 보는 최근 봉 수(구현 기준값) */
  rsiLookback: number;
  /** M3-15 강영현 파운딩: 전고점을 찾는 범위, 최소 필요 봉 수, RSI 기준 */
  foundingWindow: number;
  foundingMinBars: number;
  foundingRsi: number;
  /** M3-16 강동진: MACD 교차를 인정하는 최근 봉 수 */
  macdCrossLookback: number;
  /** M3-16 괴리: 스윙을 찾는 범위, 스윙 판정 창(좌우 봉 수), 최근 스윙의 최대 경과 봉 수(책에 수치 없음, 구현 기준값) */
  divergenceWindow: number;
  swingWindow: number;
  divergenceMaxAge: number;
  /** M3-17 강동진 스토캐스틱 */
  stochK: number;
  stochD: number;
  stochSmooth: number;
  stochLow: number;
  stochHigh: number;
  /** M2-13 김연수·박용선: 52주 = 250봉, 근접 기준(%) */
  high52Window: number;
  nearHighPct: number;
  /** 4.3 설춘환: '지나치게 벌어진' 정배열 = 종가/20일선 비율. 책에 수치 없음(구현 기준값) */
  overheatAlignedRatio: number;
  /** 3.7 강창권·설춘환: 장기선 아래에 있던 기간(봉)과 돌파일 거래량 배수(책에 수치 없음, 구현 기준값) */
  longMaBelowBars: number;
  longMaVolMult: number;
  /** 3.7 와인스타인 위쪽 매물대: 보는 범위(봉), 최소 봉 수, 현재가 위 구간(%), 경고 비율. 책은 "두꺼우면 회피"만 말해 수치는 구현 기준값 */
  supplyWindow: number;
  supplyMinBars: number;
  supplyRangePct: number;
  supplyRatio: number;
  /** M3-18 강창권: 시초가 갭(%) — 10% 이상 추격 금지, 7% 이상 원칙적으로 패스 */
  gapChasePct: number;
  gapPassPct: number;
}

export const DAILY_SIGNAL_PARAMS: DailySignalParams = {
  crossLookback: 3,
  volAvgPeriod: 20,
  surgeUpMult: 10,
  surgeDownMult: 5,
  pullbackGapPct: 1.5,
  bigBodyPct: 3,
  recoverRatio: 0.5,
  sellSurgeMult: 2,
  swingLookback: 10,
  sell2VolMult: 1,
  crashLookback: 10,
  crashPct: 10,
  crashVolMult: 2,
  crashVolPeriod: 5,
  dojiBodyRatio: 0.1,
  disparityShort: 25,
  disparityLong: 75,
  overheatShort: 106,
  overheatLong: 110,
  overheatShortBear: 102,
  overheatLongBear: 104,
  rsiOversold: 30,
  rsiOverbought: 70,
  rsiLookback: 10,
  foundingWindow: 250,
  foundingMinBars: 120,
  foundingRsi: 70,
  macdCrossLookback: 2,
  divergenceWindow: 40,
  swingWindow: 3,
  divergenceMaxAge: 10,
  stochK: 14,
  stochD: 3,
  stochSmooth: 3,
  stochLow: 20,
  stochHigh: 80,
  high52Window: 250,
  nearHighPct: 5,
  overheatAlignedRatio: 1.15,
  longMaBelowBars: 60,
  longMaVolMult: 3,
  supplyWindow: 250,
  supplyMinBars: 120,
  supplyRangePct: 15,
  supplyRatio: 0.25,
  gapChasePct: 10,
  gapPassPct: 7,
};

export interface DailySignalContext {
  /** 시장 국면(M3-11 이격도 기준, M3-15 파운딩에 쓴다). 없으면 상승장 기준·파운딩 보류 */
  regime?: Regime | null;
}

/** 지표를 한 번만 계산해 두는 준비물. 모든 지표가 i까지의 값만으로 계산되므로(인과적) 백테스트에서 재사용해도 미래 참조가 없다 */
export interface DailyPrep {
  candles: Candle[];
  params: DailySignalParams;
  closes: number[];
  lows: number[];
  highs: number[];
  volumes: number[];
  sma5: Series;
  sma20: Series;
  sma60: Series;
  sma120: Series;
  sma240: Series;
  sma480: Series;
  dispShort: Series;
  dispLong: Series;
  /** 거래량 N일 평균(오늘 포함). 직전 평균은 [i-1]을 읽는다 */
  volAvg: Series;
  volAvgShort: Series;
  rsi14: Series;
  macd: MacdResult;
  stoch: StochasticResult;
}

export function prepareDailySignals(candles: Candle[], params: Partial<DailySignalParams> = {}): DailyPrep {
  const P = { ...DAILY_SIGNAL_PARAMS, ...params };
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  return {
    candles,
    params: P,
    closes,
    lows: candles.map((c) => c.low),
    highs: candles.map((c) => c.high),
    volumes,
    sma5: sma(closes, 5),
    sma20: sma(closes, 20),
    sma60: sma(closes, 60),
    sma120: sma(closes, 120),
    sma240: sma(closes, 240),
    sma480: sma(closes, 480),
    dispShort: disparity(closes, P.disparityShort),
    dispLong: disparity(closes, P.disparityLong),
    volAvg: sma(volumes, P.volAvgPeriod),
    volAvgShort: sma(volumes, P.crashVolPeriod),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    stoch: stochastic(candles, P.stochK, P.stochD, P.stochSmooth),
  };
}

const at = (s: Series, k: number): number | null => (k >= 0 ? (s[k] ?? null) : null);
const f1 = (n: number) => n.toFixed(1);
const f0 = (n: number) => n.toFixed(0);

/** 부동소수 오차로 같은 값이 미세하게 엇갈려 교차로 잡히지 않도록 상대 오차를 허용한다 */
const tol = (a: number, b: number) => 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const crossUp = (a0: number, b0: number, a1: number, b1: number) => a0 <= b0 + tol(a0, b0) && a1 > b1 + tol(a1, b1);
const crossDown = (a0: number, b0: number, a1: number, b1: number) => a0 >= b0 - tol(a0, b0) && a1 < b1 - tol(a1, b1);

/** 최근 lookback봉(오늘 포함) 안에서 a가 b를 가장 최근에 교차한 방향 */
function lastCross(a: Series, b: Series, i: number, lookback: number): "up" | "down" | null {
  for (let k = 0; k < lookback; k++) {
    const t = i - k;
    if (t < 1) return null;
    const a0 = a[t - 1], b0 = b[t - 1], a1 = a[t], b1 = b[t];
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
    if (crossUp(a0, b0, a1, b1)) return "up";
    if (crossDown(a0, b0, a1, b1)) return "down";
  }
  return null;
}

/** 오늘 종가 위치: 5·20일선 둘 다 위 / 사이 / 둘 다 아래(박병창 4.4의 세 구간) */
export type DailyZone = "above" | "between" | "below";

function zoneOf(close: number, s5: number, s20: number): DailyZone {
  if (close > Math.max(s5, s20)) return "above";
  if (close < Math.min(s5, s20)) return "below";
  return "between";
}

/**
 * 준비물(prep)의 i번째 봉 종가 시점 신호. prep의 i 이후 값은 읽지 않는다.
 * 백테스트처럼 같은 종목을 여러 시점에서 볼 때 prepareDailySignals를 한 번만 부르고 이 함수를 반복 호출한다.
 */
export function dailySignalsFromPrep(prep: DailyPrep, i: number, ctx: DailySignalContext = {}): DailySignal[] {
  const { candles: cs, closes, lows, highs, volumes: vol, params: P } = prep;
  if (i < 1 || i >= cs.length) return [];
  const out: DailySignal[] = [];
  const push = (key: string, id: string, source: string, side: DailySignal["side"], text: string) => out.push({ id, source, side, text, key });

  const c = cs[i]!;
  const p = cs[i - 1]!;
  const s5 = at(prep.sma5, i), s5p = at(prep.sma5, i - 1);
  const s20 = at(prep.sma20, i), s20p = at(prep.sma20, i - 1);
  const s60 = at(prep.sma60, i), s120 = at(prep.sma120, i);
  // 평소 거래량 = 직전 N일 평균(오늘 제외)
  const avgVol = at(prep.volAvg, i - 1);
  const volRatio = avgVol != null && avgVol > 0 ? c.volume / avgVol : null;

  // ---- M3-05 설춘환·강동진: 골든·데드크로스 ----
  const x520 = lastCross(prep.sma5, prep.sma20, i, P.crossLookback);
  if (x520 === "up") push("ma5-20-golden", "M3-05", "설춘환", "buy", "단기 골든크로스: 5일선이 20일선을 위로 뚫었어요.");
  else if (x520 === "down") push("ma5-20-dead", "M3-05", "설춘환", "sell", "단기 데드크로스: 5일선이 20일선 아래로 내려갔어요.");
  const x2060 = lastCross(prep.sma20, prep.sma60, i, P.crossLookback);
  if (x2060 === "up") push("ma20-60-golden", "M3-05", "설춘환", "buy", "중기 골든크로스: 20일선이 60일선을 위로 뚫었어요.");
  else if (x2060 === "down") push("ma20-60-dead", "M3-05", "설춘환", "sell", "중기 데드크로스: 20일선이 60일선 아래로 내려갔어요.");

  // ---- M3-06 설춘환: 5일선 추종 ----
  if (s5 != null && s5p != null && c.close < s5 && p.close >= s5p)
    push("below-sma5", "M3-06", "설춘환", "sell", "5일선 이탈(단기 매도): 종가가 5일선 아래로 내려왔어요.");
  if (s20 != null && s20p != null && c.close < s20 && p.close >= s20p)
    push("below-sma20", "M3-06", "설춘환", "sell", "20일선 이탈(매도): 5일선에서 못 팔았다면 여기서 정리해요.");

  // ---- M3-07 설춘환: 거래량 급증 ----
  if (volRatio != null) {
    if (volRatio >= P.surgeUpMult && c.close > p.close)
      push("volume-surge-up", "M3-07", "설춘환", "buy", `거래량 폭증 상승: 평소의 ${f1(volRatio)}배가 터지며 올랐어요(단기 매수).`);
    else if (volRatio >= P.surgeDownMult && c.close < p.close)
      push("volume-surge-down", "M3-07", "설춘환", "warn", `거래량 터진 하락—매수 금지: 평소의 ${f1(volRatio)}배 거래량에 내렸어요.`);
  }

  // ---- M3-08 설춘환: 눌림목 ----
  if (s5 != null && s5p != null && s20 != null && s20p != null && s20 > 0) {
    const gap = (Math.abs(s5 - s20) / s20) * 100;
    if (gap <= P.pullbackGapPct && c.volume > p.volume && c.close > p.close && s5 > s5p && s20 > s20p)
      push("pullback-buy", "M3-08", "설춘환", "buy", "눌림목 매수: 5일선과 20일선이 만나는 자리에서 거래량·주가·5일선이 함께 올랐어요.");
  }

  // ---- M3-09 박병창: 전일 장대 음봉 50% 회복 ----
  const pBody = p.open - p.close;
  if (pBody > 0 && pBody >= (p.open * P.bigBodyPct) / 100 && c.close > c.open && c.close >= p.close + pBody * P.recoverRatio && c.volume > p.volume)
    push("recover-half", "M3-09", "박병창", "buy", `전일 장대 음봉의 ${f0(P.recoverRatio * 100)}% 이상을 거래량이 늘어난 양봉으로 되찾았어요(매수 신호).`);

  // ---- M3-10 박병창 매도 1원칙: 5일선 위 구간의 거래량 급증 장대 음봉 ----
  // '5일선 위 구간' = 오늘 종가가 5일선 위이거나, 음봉이 나오기 전(전일) 종가가 5일선 위
  const body = c.open - c.close;
  const inAbove5 = (s5 != null && c.close > s5) || (s5p != null && p.close > s5p);
  if (body > 0 && body >= (c.open * P.bigBodyPct) / 100 && volRatio != null && volRatio >= P.sellSurgeMult && inAbove5)
    push("sell-rule1", "M3-10", "박병창", "sell", `5일선 위에서 거래량 ${f1(volRatio)}배 장대 음봉이 나왔어요. 30~50% 분할 매도를 검토해요.`);

  // ---- 4.4 박병창: 매수 2원칙·매수 3원칙·매도 2원칙, 위치 분류 ----
  if (s5 != null && s20 != null && s5p != null && s20p != null) {
    const prevZone = zoneOf(p.close, s5p, s20p);
    const lb = i - P.swingLookback;
    if (lb >= 0 && prevZone === "between") {
      const h = argMax(closes, lb, i - 1);
      if (h >= 0 && h <= i - 2) {
        const t = argMin(closes, h + 1, i - 1);
        const peak = closes[h]!, trough = closes[t]!;
        const drop = peak - trough;
        if (drop > 0) {
          // 매수 2원칙: 상승 추세(20일선 상승) 눌림이 거래량 감소로 진행된 뒤, 거래량 증가 양봉이 하락폭의 50%를 넘게 반등
          const pullVol = meanOf(vol, h + 1, i - 1);
          const baseVol = meanOf(vol, Math.max(0, h - P.volAvgPeriod + 1), h);
          if (s20 > s20p && pullVol != null && baseVol != null && pullVol < baseVol && c.close > c.open && c.volume > p.volume && c.close - trough > drop * P.recoverRatio)
            push("buy-rule2", "4.4", "박병창", "buy", "매수 2원칙: 5~20일선 사이에서 거래량 줄며 쉰 뒤, 거래량 실린 양봉이 직전 하락폭의 절반 넘게 되돌렸어요.");
          // 매도 2원칙: 거래량 실린 음봉, 오늘 고가도 하락폭 50% 회복선에 못 미침
          if (c.close < c.open && volRatio != null && volRatio >= P.sell2VolMult && c.high < trough + drop * P.recoverRatio)
            push("sell-rule2", "4.4", "박병창", "sell", "매도 2원칙: 5~20일선 사이에서 거래량 실린 음봉으로 하락폭 절반 회복에 실패했어요. 20일선이 깨지면 남은 물량도 정리해요.");
        }
      }
    }

    // 매수 3원칙: 20일선 아래, 최근 N봉 안에 거래량 줄며 10% 이상 급락 → 오늘 거래량 급증 양봉/도지
    const lb3 = i - P.crashLookback;
    if (lb3 >= 0 && p.close < s20p) {
      const h = argMax(closes, lb3, i - 1);
      if (h >= 0 && h <= i - 2) {
        const t = argMin(closes, h + 1, i - 1);
        const dropPct = (1 - closes[t]! / closes[h]!) * 100;
        const fallVol = meanOf(vol, h + 1, t);
        const baseVol = meanOf(vol, Math.max(0, h - P.volAvgPeriod + 1), h);
        const shortAvg = at(prep.volAvgShort, i - 1);
        const range = c.high - c.low;
        const doji = range > 0 && Math.abs(c.close - c.open) <= range * P.dojiBodyRatio;
        const bull = c.close > c.open;
        if (dropPct >= P.crashPct && fallVol != null && baseVol != null && fallVol < baseVol && shortAvg != null && shortAvg > 0 && c.volume >= shortAvg * P.crashVolMult && (bull || doji))
          push("buy-rule3", "4.4", "박병창", "buy", `매수 3원칙: 거래량 줄며 ${f0(dropPct)}% 급락한 뒤 거래량 급증 ${doji ? "도지가" : "양봉이"} 나왔어요.`);
      }
    }

    const zone = zoneOf(c.close, s5, s20);
    const zoneText: Record<DailyZone, string> = {
      above: "위치: 5일선 위(급등 구간)예요. 매수 1원칙·매도 1원칙을 봐요.",
      between: "위치: 5~20일선 사이(눌림 구간)예요. 매수 2원칙·매도 2원칙을 봐요.",
      below: "위치: 20일선 아래(급락 구간)예요. 매수 3원칙만 봐요.",
    };
    push(`zone-${zone}`, "4.4", "박병창", "info", zoneText[zone]);
  }

  // ---- M3-11 강창권: 이격도 과열 ----
  const d25 = at(prep.dispShort, i), d75 = at(prep.dispLong, i);
  const bear = ctx.regime === "BEAR";
  const tS = bear ? P.overheatShortBear : P.overheatShort;
  const tL = bear ? P.overheatLongBear : P.overheatLong;
  const hot: string[] = [];
  if (d25 != null && d25 >= tS) hot.push(`${P.disparityShort}일선 대비 ${f1(d25)}%(기준 ${tS}%)`);
  if (d75 != null && d75 >= tL) hot.push(`${P.disparityLong}일선 대비 ${f1(d75)}%(기준 ${tL}%)`);
  if (hot.length)
    push("disparity-overheat", "M3-11", "강창권", "warn", `이격도 과열이에요(${hot.join(", ")}). ${bear ? "하락장" : "상승장"} 기준 매도 신호예요.`);

  // ---- M3-14 강영현·강동진 / 4.6 강동진: RSI ----
  const r = at(prep.rsi14, i), rp = at(prep.rsi14, i - 1);
  if (r != null && rp != null) {
    let recentMin = Infinity;
    for (let j = Math.max(0, i - P.rsiLookback); j <= i - 1; j++) {
      const v = prep.rsi14[j];
      if (v != null) recentMin = Math.min(recentMin, v);
    }
    if (rp <= P.rsiOversold && r > P.rsiOversold && recentMin < P.rsiOversold)
      push("rsi-reclaim-30", "M3-14", "강영현·강동진", "buy", `RSI ${P.rsiOversold} 회복(분할 매수 구간): 과매도에서 ${f0(r)}로 올라왔어요.`);
    else if (r < P.rsiOversold)
      push("rsi-below-30", "M3-14", "강영현", "info", `RSI ${f0(r)}로 ${P.rsiOversold} 아래예요. 머무는 동안은 사지 말고 ${P.rsiOversold} 회복을 기다려요.`);
    if (rp >= P.rsiOverbought && r < P.rsiOverbought)
      push("rsi-lose-70", "4.6", "강동진", "warn", `RSI가 ${P.rsiOverbought} 아래로 내려왔어요(매도세 강화).`);
  }

  // ---- M3-15 강영현 파운딩: 전고점 돌파 + RSI 70, 강세장 한정 ----
  const fStart = Math.max(0, i - P.foundingWindow);
  if (i - fStart >= P.foundingMinBars && r != null) {
    const prevHigh = closes[argMax(closes, fStart, i - 1)]!;
    if (c.close > prevHigh && r >= P.foundingRsi) {
      if (ctx.regime === "BULL")
        push("founding", "M3-15", "강영현", "buy", `파운딩: 직전 ${i - fStart}봉 최고 종가를 넘고 RSI ${f0(r)}예요. 강세장 단기 추종 구간이에요.`);
      else push("founding-off", "M3-15", "강영현", "info", "전고점 돌파와 RSI 70이 겹쳤지만 강세장이 아니라 파운딩 매매는 쉬어요.");
    }
  }

  // ---- M3-16 강동진: MACD 교차·괴리 ----
  const xm = lastCross(prep.macd.macd, prep.macd.signal, i, P.macdCrossLookback);
  if (xm === "up") push("macd-golden", "M3-16", "강동진", "buy", "MACD 골든크로스: MACD선이 시그널선을 위로 뚫었어요.");
  else if (xm === "down") push("macd-dead", "M3-16", "강동진", "sell", "MACD 데드크로스: MACD선이 시그널선 아래로 내려갔어요.");
  const dFrom = Math.max(0, i - P.divergenceWindow + 1);
  const ml = prep.macd.macd;
  const sl = swingLows(lows, P.swingWindow, dFrom, i).filter((j) => ml[j] != null);
  if (sl.length >= 2) {
    const a = sl[sl.length - 2]!, b = sl[sl.length - 1]!;
    if (b >= i - P.divergenceMaxAge && lows[b]! < lows[a]! && ml[b]! > ml[a]!)
      push("macd-bull-div", "M3-16", "강동진", "buy", "강세 괴리: 가격 저점은 낮아졌는데 MACD 저점은 높아졌어요.");
  }
  const sh = swingHighs(highs, P.swingWindow, dFrom, i).filter((j) => ml[j] != null);
  if (sh.length >= 2) {
    const a = sh[sh.length - 2]!, b = sh[sh.length - 1]!;
    if (b >= i - P.divergenceMaxAge && highs[b]! > highs[a]! && ml[b]! < ml[a]!)
      push("macd-bear-div", "M3-16", "강동진", "sell", "약세 괴리: 가격 고점은 높아졌는데 MACD 고점은 낮아졌어요.");
  }

  // ---- M3-17 강동진: 스토캐스틱 ----
  const k0 = at(prep.stoch.k, i - 1), k1 = at(prep.stoch.k, i);
  const d0 = at(prep.stoch.d, i - 1), d1 = at(prep.stoch.d, i);
  if (k0 != null && k1 != null && d0 != null && d1 != null) {
    if (crossUp(k0, d0, k1, d1) && Math.min(k0, k1) <= P.stochLow)
      push("stoch-buy", "M3-17", "강동진", "buy", `스토캐스틱 매수: %K가 ${P.stochLow} 이하에서 %D를 위로 뚫었어요.`);
    else if (crossDown(k0, d0, k1, d1) && Math.max(k0, k1) >= P.stochHigh)
      push("stoch-sell", "M3-17", "강동진", "sell", `스토캐스틱 매도: %K가 ${P.stochHigh} 이상에서 %D 아래로 내려갔어요.`);
  }

  // ---- M2-13 김연수·박용선: 52주 신고가 ----
  if (i >= P.high52Window) {
    const hi = closes[argMax(closes, i - P.high52Window, i - 1)]!;
    if (c.close > hi) push("high52-new", "M2-13", "김연수·박용선", "info", "52주 신고가: 최근 1년 최고 종가를 새로 썼어요.");
    else if (c.close >= hi * (1 - P.nearHighPct / 100))
      push("high52-near", "M2-13", "김연수·박용선", "info", `신고가 근접: 52주 최고 종가까지 ${f1((hi / c.close - 1) * 100)}% 남았어요.`);
  }

  // ---- 4.3 설춘환: 정배열 ----
  if (s5 != null && s20 != null && s60 != null && s120 != null && s5 > s20 && s20 > s60 && s60 > s120) {
    if (c.close / s20 > P.overheatAlignedRatio)
      push("aligned-overheat", "4.3", "설춘환", "warn", `과열된 정배열(매도 고려): 종가가 20일선보다 ${f0((c.close / s20 - 1) * 100)}% 위예요.`);
    else push("aligned", "4.3", "설춘환", "info", "정배열: 5>20>60>120일선 순으로 늘어서 있어요.");
  }

  // ---- 3.7 강창권·설춘환: 오래 눌린 240·480일선 대량 돌파 ----
  const longMas: [number, Series][] = [
    [240, prep.sma240],
    [480, prep.sma480],
  ];
  for (const [period, ma] of longMas) {
    const m = at(ma, i), mp = at(ma, i - 1);
    if (m == null || mp == null || volRatio == null) continue;
    if (!(c.close > m && p.close <= mp && volRatio >= P.longMaVolMult)) continue;
    const from = i - P.longMaBelowBars;
    let below = from >= 0;
    for (let j = from; j <= i - 1 && below; j++) {
      const v = ma[j];
      if (v == null || closes[j]! >= v) below = false;
    }
    if (below)
      push(`long-ma${period}-break`, "3.7", "강창권·설춘환", "buy", `장기선 대량 돌파: ${P.longMaBelowBars}봉 넘게 눌려 있던 ${period}일선을 평소 ${f1(volRatio)}배 거래량으로 뚫었어요.`);
  }

  // ---- 3.7 와인스타인: 위쪽 매물대 ----
  const sStart = Math.max(0, i - P.supplyWindow + 1);
  if (i - sStart + 1 >= P.supplyMinBars) {
    const cap = c.close * (1 + P.supplyRangePct / 100);
    let total = 0;
    let upper = 0;
    for (let j = sStart; j <= i; j++) {
      total += vol[j]!;
      if (closes[j]! > c.close && closes[j]! <= cap) upper += vol[j]!;
    }
    if (total > 0 && upper / total >= P.supplyRatio)
      push("overhead-supply", "3.7", "와인스타인", "warn", `위쪽 매물대 두꺼움: 최근 ${i - sStart + 1}봉 거래량의 ${f0((upper / total) * 100)}%가 현재가 위 ${P.supplyRangePct}% 안에 있어요.`);
  }

  // ---- M3-18 강창권(일봉 근사): 시초가 갭 추격 금지 ----
  if (p.close > 0) {
    const gapPct = (c.open / p.close - 1) * 100;
    if (gapPct >= P.gapChasePct)
      push("gap-10", "M3-18", "강창권", "warn", `시초가 갭 ${P.gapChasePct}%↑ 추격 금지: 전일 종가보다 ${f1(gapPct)}% 높게 시작했어요.`);
    else if (gapPct >= P.gapPassPct)
      push("gap-7", "M3-18", "강창권", "warn", `갭 ${P.gapPassPct}%↑ 원칙적으로 패스: 전일 종가보다 ${f1(gapPct)}% 높게 시작했어요.`);
  }

  return out;
}

export interface DailySignalOptions extends DailySignalContext {
  params?: Partial<DailySignalParams>;
}

/** i번째 봉 종가 시점의 일봉 신호. candles[0..i]만 잘라서 쓴다(미래 참조 없음) */
export function dailySignalsAt(candles: Candle[], i: number, ctx: DailySignalOptions = {}): DailySignal[] {
  if (i < 1 || i >= candles.length) return [];
  return dailySignalsFromPrep(prepareDailySignals(candles.slice(0, i + 1), ctx.params), i, ctx);
}

/** 마지막 봉 기준 일봉 신호 */
export function dailySignals(candles: Candle[], ctx: DailySignalOptions = {}): DailySignal[] {
  return dailySignalsAt(candles, candles.length - 1, ctx);
}

const TONE: Record<DailySignal["side"], Note["tone"]> = { buy: "good", sell: "bad", warn: "warn", info: "info" };

/** 화면 근거(Note)로 바꾼다. rule = "규칙ID 출처" */
export function toNotes(signals: DailySignal[]): Note[] {
  return signals.map((s) => ({ tone: TONE[s.side], text: s.text, rule: `${s.id} ${s.source}` }));
}
