import { ema } from "./indicators";
import type { Candle, Note } from "./types";

/*
 * 시장 폭(자료집 2.2 시장 내부 지표: M1-04 A/D선, M1-05 시장 탄력지수 MI, 고점-저점 수치).
 * 거래소 전체 등락 종목 수 대신 표본 종목(시가총액 상위 등)의 일봉으로 근사한다.
 * 2장 구현 메모대로 국면 점수(regimeScore)의 보조 신호(-1~+1점)로만 쓴다.
 * 맥클렐런 오실레이터는 책 밖의 널리 쓰이는 보조 지표라 값만 내고 점수에는 넣지 않는다.
 */

/** 하루치 시장 폭 집계 */
export interface BreadthDay {
  /** YYYY-MM-DD */
  date: string;
  /** 전일 종가보다 오른 / 내린 / 같은 종목 수 */
  adv: number;
  dec: number;
  unch: number;
  /** 종가가 직전 hiLoLookback봉(52주)의 최고가 위 / 최저가 아래인 종목 수 */
  newHigh: number;
  newLow: number;
  /** 그날 집계에 들어간 종목 수(= adv + dec + unch) */
  total: number;
  /** 신고가·신저가를 판정할 수 있었던(직전 봉이 충분한) 종목 수. 없으면 total로 본다 */
  hiLoBase?: number;
}

export interface BreadthParams {
  hiLoLookback: number;
  minReportRatio: number;
  miPeriod: number;
  miDeepPct: number;
  miMinDeepDays: number;
  miCrossRecent: number;
  divRecent: number;
  divPrior: number;
  divMinGapPct: number;
  hiLoAvgDays: number;
  hiLoRatio: number;
  hiLoMinPct: number;
  mcFast: number;
  mcSlow: number;
  mcScale: number;
}

/** 시장 폭 계산·판정 기준. 책에서 온 값과 앱 기본값(조정·백테스트 대상)을 주석에 구분했다 */
export const BREADTH_PARAMS: Readonly<BreadthParams> = {
  /** 신고가·신저가 비교 봉 수. 2.2 와인스타인 '52주'를 거래일 약 250일로 옮긴 값 */
  hiLoLookback: 250,
  /** 그날 일봉이 있는 종목이 표본의 이 비율 미만이면 그 날짜는 버린다(앱 기본값) */
  minReportRatio: 0.5,
  /** MI 이동 합계 기간(M1-05 와인스타인: 200일) */
  miPeriod: 200,
  /**
   * MI '깊은 영역': |MI| ≥ 200일 평균 집계 종목 수의 이 %(앱 기본값. 책은 '깊숙이'라고만 함).
   * 1000% = 200일 동안 하루 평균 순상승(순하락)이 표본의 5%였던 정도
   */
  miDeepPct: 1000,
  /** 0선 교차 전 같은 쪽 구간에서 깊은 영역에 머문 최소 일수(앱 기본값. 책은 '오래'라고만 함) */
  miMinDeepDays: 40,
  /** 0선 교차가 최근 이 집계일 안에 있어야 신호로 본다(앱 기본값) */
  miCrossRecent: 5,
  /** M1-04 괴리: 최근 구간 일수와 그 앞 비교 구간 일수(앱 기본값) */
  divRecent: 20,
  divPrior: 80,
  /** A/D선 고점(저점) 차이가 평균 집계 종목 수의 이 % 이상일 때만 괴리로 본다(잡음 거르기, 앱 기본값) */
  divMinGapPct: 5,
  /** 고점-저점 수치는 최근 이 일수 평균으로 비교(앱 기본값. 2.2 와인스타인: 트레이더는 일간 추적) */
  hiLoAvgDays: 10,
  /** 한쪽 평균이 다른 쪽의 이 배 이상이고(앱 기본값) */
  hiLoRatio: 2,
  /** 그 평균이 판정 가능 종목 수의 이 % 이상일 때만 좋음·나쁨으로 본다(앱 기본값) */
  hiLoMinPct: 3,
  /** 맥클렐런 오실레이터 EMA 기간·비율 조정 배수(책 밖의 널리 쓰이는 관례값 19·39·1000) */
  mcFast: 19,
  mcSlow: 39,
  mcScale: 1000,
};

/** 화면 표시용 시리즈 이름. 맥클렐런은 책의 MI가 아니라는 점을 이름에 밝힌다 */
export const BREADTH_SERIES_LABEL = {
  adLine: "A/D선(M1-04, 상승−하락 누적)",
  mi: "시장 탄력지수 MI(M1-05, 순상승 200일 합계)",
  mcclellan: "맥클렐런 오실레이터(책 밖 보조 지표, 비율 조정 순상승 EMA19−EMA39)",
  mcclellanSum: "맥클렐런 합산지수(책 밖 보조 지표, 오실레이터 누적)",
} as const;

export interface BreadthFromCandlesOptions {
  hiLoLookback?: number;
  minReportRatio?: number;
}

/**
 * 표본 종목들의 일봉 → 날짜별 등락·신고저 종목 수(날짜 오름차순).
 * - 표본 크기는 series 길이(빈 배열 포함). 그날 일봉이 있는 종목이 절반(minReportRatio) 미만인 날짜는 거래일 달력에서 뺀다
 * - 한 종목은 그날과 직전 거래일(달력의 앞 날짜) 모두 봉이 있을 때만 센다. 등락은 종가 대 전일 종가.
 *   거래정지 뒤 첫날처럼 직전 거래일 봉이 없으면 하루 등락이 아니므로 뺀다. 이렇게 센 종목도 절반 미만이면 그 날짜를 버린다
 * - 신고가·신저가: 종가가 자기 직전 hiLoLookback봉의 최고가 위 / 최저가 아래. 직전 봉이 그보다 적으면 판정하지 않는다
 * 각 날짜의 값은 그날까지의 봉만 쓰므로, 뒤쪽 봉을 잘라 계산해도 앞 날짜 결과는 같다(미래 참조 없음).
 */
export function breadthFromCandles(series: Candle[][], opts: BreadthFromCandlesOptions = {}): BreadthDay[] {
  const lookback = Math.max(1, opts.hiLoLookback ?? BREADTH_PARAMS.hiLoLookback);
  const need = series.length * (opts.minReportRatio ?? BREADTH_PARAMS.minReportRatio);
  const list = series.map(sortedBars);
  const reported = new Map<string, number>();
  for (const bars of list) for (const c of bars) reported.set(c.date, (reported.get(c.date) ?? 0) + 1);
  const calendar = [...reported].filter(([, k]) => k > 0 && k >= need).map(([d]) => d).sort();
  const pos = list.map((bars) => new Map(bars.map((c, i) => [c.date, i])));

  const out: BreadthDay[] = [];
  for (let k = 1; k < calendar.length; k++) {
    const date = calendar[k]!, prev = calendar[k - 1]!;
    let adv = 0, dec = 0, unch = 0, newHigh = 0, newLow = 0, hiLoBase = 0;
    for (let s = 0; s < list.length; s++) {
      const i = pos[s]!.get(date), j = pos[s]!.get(prev);
      if (i == null || j == null) continue;
      const bars = list[s]!;
      const close = bars[i]!.close, prevClose = bars[j]!.close;
      if (close > prevClose) adv++;
      else if (close < prevClose) dec++;
      else unch++;
      if (i < lookback) continue;
      hiLoBase++;
      let hi = -Infinity, lo = Infinity;
      for (let t = i - lookback; t < i; t++) {
        const b = bars[t]!;
        if (b.high > hi) hi = b.high;
        if (b.low < lo) lo = b.low;
      }
      if (close > hi) newHigh++;
      else if (close < lo) newLow++;
    }
    const total = adv + dec + unch;
    if (total === 0 || total < need) continue;
    out.push({ date, adv, dec, unch, newHigh, newLow, total, hiLoBase });
  }
  return out;
}

export interface BreadthPoint {
  date: string;
  value: number;
}

export interface BreadthAnalysis {
  /** 마지막 집계일 */
  asOf: string;
  /** 무엇으로 계산했는지(예: "KOSPI 시가총액 상위 60종목 기준 근사") */
  basis: string;
  /** 마지막 집계일의 집계 종목 수 */
  sampleSize: number;
  /** A/D선: (상승 − 하락) 누적(M1-04). 첫 집계일부터 0에서 시작하므로 수준이 아니라 모양(고점·저점)을 본다 */
  adLine: BreadthPoint[];
  /** 시장 탄력지수: (상승 − 하락)의 200일 이동 합계(M1-05). 집계일이 200일 미만이면 [] */
  mi: BreadthPoint[];
  /** 맥클렐런 오실레이터 = EMA19 − EMA39 of (상승−하락)/(상승+하락)×1000. 책 밖의 널리 쓰이는 보조 지표(책의 MI 아님) */
  mcclellan: BreadthPoint[];
  /** 맥클렐런 합산지수 = 오실레이터 누적(첫 값부터, 기준값 0). 책 밖 보조 지표 */
  mcclellanSum: BreadthPoint[];
  /** 고점-저점 수치(2.2 와인스타인). avg10*는 최근 hiLoAvgDays(기본 10)일 평균 */
  hiLo: { newHigh: number; newLow: number; avg10High: number; avg10Low: number };
  /** M1-04 괴리: 약세(지수 고점↑·A/D 고점↓), 강세(지수 저점↓·A/D 저점↑). 지수가 없거나 모자라면 null */
  divergence: "BEARISH" | "BULLISH" | null;
  /** M1-05 신호: 깊은 영역에 오래 있다가 최근 0선 교차 */
  miSignal: { dir: "UP" | "DOWN"; date: string; deepDays: number } | null;
  /** 고점-저점 판정. 52주 판정이 가능한 종목이 없으면 null */
  hiLoState: "GOOD" | "BAD" | "NEUTRAL" | null;
  /** 화면용 근거(첫 줄은 기준 설명). 모두 rule 태그가 붙는다 */
  signals: Note[];
  /** 보조 점수 = clamp(괴리 + MI + 고점-저점, -1, 1). 강세 괴리는 참고만 하므로 0점 */
  score: -1 | 0 | 1;
}

export type AnalyzeBreadthOptions = Partial<BreadthParams> & {
  /** 기준 설명. 없으면 "표본 N종목 기준 근사" */
  basis?: string;
};

/**
 * 시장 폭 분석. days의 마지막 날 기준이며 넘겨준 자료 끝까지 쓴다(과거 시점 재현은 analyzeBreadthAt).
 * indexCandles는 days와 같은 날짜끼리만 맞춰 쓰므로(M1-04 괴리), days 마지막 날보다 뒤의 지수 봉은 결과에 영향이 없다.
 * days가 비면 null.
 */
export function analyzeBreadth(input: BreadthDay[], indexCandles?: Candle[] | null, opts: AnalyzeBreadthOptions = {}): BreadthAnalysis | null {
  const { basis: basisOpt, ...over } = opts;
  const P: BreadthParams = { ...BREADTH_PARAMS, ...over };
  const days = sortedDays(input);
  const n = days.length;
  const last = days[n - 1];
  if (!last) return null;
  const net = days.map((d) => d.adv - d.dec);
  const avgTotal = mean(days.slice(-P.miPeriod).map((d) => d.total));

  // A/D선(M1-04)
  let acc = 0;
  const adLine = days.map((d, k) => ({ date: d.date, value: (acc += net[k]!) }));

  // MI(M1-05): 새 값을 더하고 200일 전 값을 뺀다. 깊은 영역 기준도 같은 창의 평균 종목 수로
  const mi: BreadthPoint[] = [];
  const miDeep: number[] = [];
  let sNet = 0, sTot = 0;
  for (let k = 0; k < n; k++) {
    sNet += net[k]!;
    sTot += days[k]!.total;
    if (k >= P.miPeriod) {
      sNet -= net[k - P.miPeriod]!;
      sTot -= days[k - P.miPeriod]!.total;
    }
    if (k >= P.miPeriod - 1) {
      mi.push({ date: days[k]!.date, value: sNet });
      miDeep.push((P.miDeepPct / 100) * (sTot / P.miPeriod));
    }
  }

  // 맥클렐런(책 밖 보조 지표): 비율 조정 순상승의 EMA19 − EMA39
  const rana = days.map((d) => (d.adv + d.dec > 0 ? ((d.adv - d.dec) / (d.adv + d.dec)) * P.mcScale : 0));
  const fast = ema(rana, P.mcFast), slow = ema(rana, P.mcSlow);
  const mcclellan: BreadthPoint[] = [];
  const mcclellanSum: BreadthPoint[] = [];
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const f = fast[k], s = slow[k];
    if (f == null || s == null) continue;
    const v = f - s;
    sum += v;
    mcclellan.push({ date: days[k]!.date, value: v });
    mcclellanSum.push({ date: days[k]!.date, value: sum });
  }

  const signals: Note[] = [];
  const basis = basisOpt ?? `표본 ${Math.round(avgTotal)}종목 기준 근사`;
  signals.push({ tone: "info", text: `시장 폭 기준: ${basis}. 거래소 전체 집계가 아닌 근사치라 보조 신호로만 써요`, rule: "2.2 와인스타인" });

  // 1) M1-04 지수와 A/D선의 괴리
  let divergence: BreadthAnalysis["divergence"] = null;
  let divScore = 0;
  if (indexCandles?.length) {
    const d = findDivergence(days, adLine, indexCandles, P, avgTotal);
    if (!d) {
      signals.push({ tone: "info", text: `지수와 날짜가 맞는 집계일이 ${P.divRecent + P.divPrior}일보다 적어 A/D선 괴리는 따지지 않았어요`, rule: "M1-04 와인스타인" });
    } else if (d.kind === "BEARISH") {
      divergence = "BEARISH";
      divScore = -1;
      signals.push({ tone: "bad", text: `지수는 최근 ${P.divRecent}일에 고점을 높였는데 A/D선은 고점을 낮췄어요(${fmtInt(d.adPrior)} → ${fmtInt(d.adRecent)}). 하락장 선행 경고예요`, rule: "M1-04 와인스타인" });
    } else if (d.kind === "BULLISH") {
      divergence = "BULLISH";
      signals.push({ tone: "info", text: `지수는 최근 ${P.divRecent}일에 저점을 낮췄는데 A/D선은 저점을 높였어요(${fmtInt(d.adPrior)} → ${fmtInt(d.adRecent)}). 시장 내부가 버티는 모습이지만 확인 전까지는 참고만 해요`, rule: "M1-04 와인스타인" });
    }
  }

  // 2) M1-05 MI: 깊은 영역에 오래 있다가 0선 교차
  let miSignal: BreadthAnalysis["miSignal"] = null;
  let miScore = 0;
  const lastMi = mi.at(-1);
  if (!lastMi) {
    signals.push({ tone: "info", text: `시장 탄력지수(MI)는 ${P.miPeriod}거래일 합계라 집계일이 더 필요해요(지금 ${n}일)`, rule: "M1-05 와인스타인" });
  } else {
    const cross = findMiCross(mi, miDeep, P.miCrossRecent);
    if (cross && cross.deepDays >= P.miMinDeepDays) {
      miSignal = cross;
      if (cross.dir === "DOWN") {
        miScore = -1;
        signals.push({ tone: "bad", text: `시장 탄력지수(MI)가 0선 위 깊은 곳에 ${cross.deepDays}일 머물다 ${cross.date}에 0선 아래로 내려왔어요. 고점에서 지수보다 먼저 나오는 매도 신호예요`, rule: "M1-05 와인스타인" });
      } else {
        miScore = 1;
        signals.push({ tone: "good", text: `시장 탄력지수(MI)가 0선 아래 깊은 곳에 ${cross.deepDays}일 머물다 ${cross.date}에 0선 위로 올라왔어요. 바닥에서는 늦게 나오지만 상승을 확인해 주는 신호예요`, rule: "M1-05 와인스타인" });
      }
    } else if (cross) {
      signals.push({ tone: "info", text: `시장 탄력지수(MI)가 ${cross.date}에 0선 ${cross.dir === "UP" ? "위" : "아래"}로 넘어왔지만 그 전에 깊은 영역에 머문 날이 ${cross.deepDays}일이라(기준 ${P.miMinDeepDays}일) 추세 전환 신호로 보지 않아요`, rule: "M1-05 와인스타인" });
    } else {
      const deep = lastMi.value !== 0 && Math.abs(lastMi.value) >= miDeep.at(-1)!;
      const where = lastMi.value === 0 ? "0선이에요" : `${lastMi.value > 0 ? "0선 위" : "0선 아래"}${deep ? " 깊은 영역이에요" : "예요"}`;
      signals.push({ tone: "info", text: `시장 탄력지수(MI) ${fmtInt(lastMi.value, true)}: ${where}(최근 ${P.miPeriod}거래일 순상승 합계)`, rule: "M1-05 와인스타인" });
    }
  }

  // 3) 고점-저점 수치(2.2 와인스타인, 단독 판단 금지)
  const tail = days.slice(-Math.max(1, P.hiLoAvgDays));
  const avgH = mean(tail.map((d) => d.newHigh)), avgL = mean(tail.map((d) => d.newLow));
  const base = mean(tail.map((d) => d.hiLoBase ?? d.total));
  const hiLo = { newHigh: last.newHigh, newLow: last.newLow, avg10High: avgH, avg10Low: avgL };
  let hiLoState: BreadthAnalysis["hiLoState"] = null;
  let hiLoScore = 0;
  const pair = `최근 ${tail.length}일 평균 신고가 ${avgH.toFixed(1)} 대 신저가 ${avgL.toFixed(1)}종목`;
  if (!(base > 0)) {
    signals.push({ tone: "info", text: "52주 신고가·신저가를 따지려면 종목마다 1년치(약 250봉) 일봉이 필요해 이번엔 빠졌어요", rule: "2.2 와인스타인" });
  } else {
    const min = (P.hiLoMinPct / 100) * base;
    if (avgH >= min && avgH >= P.hiLoRatio * avgL) {
      hiLoState = "GOOD";
      hiLoScore = 1;
      signals.push({ tone: "good", text: `52주 신고가 종목이 신저가보다 많아요(${pair}). 시장 건강도는 좋지만 이것만으로 판단하지 않아요`, rule: "2.2 와인스타인" });
    } else if (avgL >= min && avgL >= P.hiLoRatio * avgH) {
      hiLoState = "BAD";
      hiLoScore = -1;
      signals.push({ tone: "bad", text: `52주 신저가 종목이 신고가보다 많아요(${pair}). 시장 건강도가 나쁘지만 이것만으로 판단하지 않아요`, rule: "2.2 와인스타인" });
    } else {
      hiLoState = "NEUTRAL";
      signals.push({ tone: "info", text: `${pair}: 어느 쪽도 뚜렷하지 않아요`, rule: "2.2 와인스타인" });
    }
  }

  const score = Math.max(-1, Math.min(1, divScore + miScore + hiLoScore)) as -1 | 0 | 1;
  return { asOf: last.date, basis, sampleSize: last.total, adLine, mi, mcclellan, mcclellanSum, hiLo, divergence, miSignal, hiLoState, signals, score };
}

/**
 * 백테스트·재현용: date(YYYY-MM-DD) 종가 시점의 분석. date 이후의 집계일과 지수 봉은 쓰지 않는다(미래 참조 없음).
 * assessRegimeAt에 넘길 때는 같은 날짜로 맞추세요. date 이전 집계일이 없으면 null.
 */
export function analyzeBreadthAt(days: BreadthDay[], indexCandles: Candle[] | null | undefined, date: string, opts: AnalyzeBreadthOptions = {}): BreadthAnalysis | null {
  return analyzeBreadth(
    days.filter((d) => d.date <= date),
    indexCandles?.filter((c) => c.date <= date),
    opts,
  );
}

/**
 * 지수와 A/D선을 같은 날짜끼리 맞춰 최근 divRecent일과 그 앞 divPrior일의 고점·저점을 비교(M1-04).
 * 맞는 날짜가 모자라면 null, 괴리가 없으면 kind null.
 */
function findDivergence(days: BreadthDay[], adLine: BreadthPoint[], indexCandles: Candle[], P: BreadthParams, avgTotal: number) {
  const close = new Map<string, number>();
  for (const c of indexCandles) if (c.close > 0) close.set(c.date, c.close);
  const ix: number[] = [], av: number[] = [];
  days.forEach((d, k) => {
    const c = close.get(d.date);
    if (c != null) {
      ix.push(c);
      av.push(adLine[k]!.value);
    }
  });
  const need = P.divRecent + P.divPrior;
  if (P.divRecent < 1 || P.divPrior < 1 || ix.length < need) return null;
  const split = ix.length - P.divRecent, from = ix.length - need;
  const rI = ix.slice(split), pI = ix.slice(from, split), rA = av.slice(split), pA = av.slice(from, split);
  const gap = (P.divMinGapPct / 100) * avgTotal;
  const rAHi = Math.max(...rA), pAHi = Math.max(...pA), rALo = Math.min(...rA), pALo = Math.min(...pA);
  if (Math.max(...rI) > Math.max(...pI) && rAHi < pAHi - gap) return { kind: "BEARISH" as const, adPrior: pAHi, adRecent: rAHi };
  if (Math.min(...rI) < Math.min(...pI) && rALo > pALo + gap) return { kind: "BULLISH" as const, adPrior: pALo, adRecent: rALo };
  return { kind: null, adPrior: 0, adRecent: 0 };
}

/**
 * 최근 recent개 MI 값 안의 가장 최근 0선 교차와, 교차 직전 같은 쪽 구간에서 깊은 영역(|MI| ≥ deep)에 있던 날 수(연속이 아니어도 합산).
 * 정확히 0인 값은 어느 쪽도 아닌 것으로 보고 건너뛴다(0을 찍고 되돌아가면 교차 아님).
 */
function findMiCross(mi: BreadthPoint[], deep: number[], recent: number): { dir: "UP" | "DOWN"; date: string; deepDays: number } | null {
  const v = mi.map((p) => p.value);
  for (let c = v.length - 1; c >= 1 && c >= v.length - recent; c--) {
    const b = v[c]!;
    if (b === 0) continue;
    let t = c - 1;
    while (t >= 0 && v[t] === 0) t--;
    if (t < 0 || Math.sign(v[t]!) === Math.sign(b)) continue;
    const side = Math.sign(v[t]!);
    let deepDays = 0;
    for (let k = t; k >= 0 && (v[k] === 0 || Math.sign(v[k]!) === side); k--) if (Math.abs(v[k]!) >= deep[k]!) deepDays++;
    return { dir: b < 0 ? "DOWN" : "UP", date: mi[c]!.date, deepDays };
  }
  return null;
}

/** 날짜 오름차순·중복 없는 봉(이미 그렇다면 그대로). 같은 날짜가 여럿이면 뒤의 것을 쓴다 */
function sortedBars(bars: Candle[]): Candle[] {
  for (let i = 1; i < bars.length; i++) {
    if (!(bars[i - 1]!.date < bars[i]!.date)) {
      const byDate = new Map<string, Candle>();
      for (const c of bars) byDate.set(c.date, c);
      return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    }
  }
  return bars;
}

function sortedDays(days: BreadthDay[]): BreadthDay[] {
  for (let i = 1; i < days.length; i++) {
    if (!(days[i - 1]!.date < days[i]!.date)) return [...new Map(days.map((d) => [d.date, d])).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return days;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 천 단위 쉼표 정수(signed면 양수에 +) */
function fmtInt(v: number, signed = false): string {
  const r = Math.round(v);
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${r < 0 ? "-" : signed && r > 0 ? "+" : ""}${s}`;
}
