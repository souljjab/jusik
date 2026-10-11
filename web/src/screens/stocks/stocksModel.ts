import {
  BUY_ACTIONS, SELL_ACTIONS, STAGE_LABEL, assessRegimeAt, candleMasterAt, candleMasterSignals, completedWeeks, dailyRegimeLookup,
  dailySignalsFromPrep, macd, prepareDailySignals, prepareStage, relativeStrength, rsi, shortDateKo, sma, stageAt, toWeekly,
  type Analysis, type Candle, type CandleMasterResult, type DailySignal, type DayTradeCandidate, type Posture, type Region,
  type RegimeAssessment, type StageResult,
} from "@jusik/shared";

/*
 * 종목 화면(UI 지도서 5.2·6.1·6.2·7.1)의 순수 계산: 주소 해석, 기간별 봉, 신호 기록과 차트 표식, 포지션 미리 계산,
 * 관심종목 순서 바꾸기, 종목 메모 저장. 화면 컴포넌트는 여기서 계산한 값을 그리기만 한다.
 */

// ───────────────────────── 주소 ─────────────────────────

/** 상세 탭: 신호 근거·재무·공시·메모 */
export type DetailTab = "evidence" | "fin" | "disclosure" | "memo";
export const DETAIL_TABS: DetailTab[] = ["evidence", "fin", "disclosure", "memo"];
export const TAB_LABEL: Record<DetailTab, string> = { evidence: "신호 근거", fin: "재무", disclosure: "공시", memo: "메모" };
/** 핸드폰·태블릿 세로는 짧게(지도서 6.2 '근거 재무 공시 메모') */
export const TAB_LABEL_SHORT: Record<DetailTab, string> = { evidence: "근거", fin: "재무", disclosure: "공시", memo: "메모" };

export interface StockRoute {
  code: string | null;
  tab: DetailTab;
  /** /stocks/:code/minute — 차트를 분봉으로 연다 */
  minute: boolean;
}

/** /stocks[/:code[/:tab]] → 종목 코드·탭. 모르는 탭은 신호 근거로 */
export function parseStockRoute(segments: string[]): StockRoute {
  const code = segments[1] ? segments[1].trim().toUpperCase() : null;
  const t = segments[2] ?? "";
  if (t === "minute") return { code, tab: "evidence", minute: true };
  return { code: code || null, tab: (DETAIL_TABS as string[]).includes(t) ? (t as DetailTab) : "evidence", minute: false };
}

export const stockPath = (code: string, tab?: DetailTab | "minute") => `/stocks/${encodeURIComponent(code)}${tab && tab !== "evidence" ? `/${tab}` : ""}`;

// ───────────────────────── 기간별 봉 ─────────────────────────

/** 차트 기간: 분(분봉)·일·주·월 */
export type Period = "m" | "D" | "W" | "M";
export type BarPeriod = Exclude<Period, "m">;
export const PERIOD_LABEL: Record<Period, string> = { m: "분", D: "일", W: "주", M: "월" };
export const PERIOD_NAME: Record<BarPeriod, string> = { D: "일봉", W: "주봉", M: "월봉" };

export interface Bar {
  /** 봉의 마지막 거래일(YYYY-MM-DD). 차트 시각으로 쓴다 */
  time: string;
  /** 봉의 첫 거래일 */
  from: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 일봉 → 일·주·월봉. 주봉은 진행 중인 주도 포함한다(차트는 지금까지의 움직임을 보여 준다) */
export function toBars(candles: Candle[], period: BarPeriod): Bar[] {
  if (period === "D") return candles.map((c) => ({ time: c.date, from: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
  if (period === "W")
    return toWeekly(candles).map((w) => ({ time: w.date, from: candles[w.startIndex]!.date, open: w.open, high: w.high, low: w.low, close: w.close, volume: w.volume }));
  const out: Bar[] = [];
  for (const c of candles) {
    const last = out.at(-1);
    if (last && last.time.slice(0, 7) === c.date.slice(0, 7)) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
      last.time = c.date;
    } else out.push({ time: c.date, from: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
  }
  return out;
}

/** 기간별 이동평균(색 이름은 theme.ts의 ChartColors 키). 주봉의 30주선은 와인스타인의 기준선이라 강조색 */
export const MA_SETS: Record<BarPeriod, { n: number; label: string; color: "ma5" | "ma20" | "ma60" }[]> = {
  D: [
    { n: 5, label: "5일", color: "ma5" },
    { n: 20, label: "20일", color: "ma20" },
    { n: 60, label: "60일", color: "ma60" },
  ],
  W: [
    { n: 10, label: "10주", color: "ma5" },
    { n: 30, label: "30주", color: "ma20" },
  ],
  M: [
    { n: 6, label: "6개월", color: "ma5" },
    { n: 12, label: "12개월", color: "ma20" },
  ],
};

export interface Point {
  time: string;
  value: number;
}
const points = (bars: Bar[], s: (number | null)[]): Point[] => bars.flatMap((b, i) => (s[i] != null ? [{ time: b.time, value: s[i] as number }] : []));
export const maPoints = (bars: Bar[], n: number) => points(bars, sma(bars.map((b) => b.close), n));
export const rsiPoints = (bars: Bar[]) => points(bars, rsi(bars.map((b) => b.close), 14));
export function macdPoints(bars: Bar[]) {
  const m = macd(bars.map((b) => b.close));
  return { macd: points(bars, m.macd), signal: points(bars, m.signal), hist: points(bars, m.hist) };
}

/** 봉 이름(크로스헤어 범례): 일봉 "10.12(월)", 주봉 "8월 4주", 월봉 "2024.08" */
export function barLabel(time: string, period: BarPeriod): string {
  const y = time.slice(0, 4), m = Number(time.slice(5, 7)), d = Number(time.slice(8, 10));
  if (period === "M") return `${y}.${String(m).padStart(2, "0")}`;
  if (period === "W") return `${m}월 ${Math.ceil(d / 7)}주`;
  return shortDateKo(time);
}

/** 처음 보여 줄 봉 수(나머지는 끌어서 본다) */
export const INITIAL_BARS: Record<BarPeriod, number> = { D: 130, W: 104, M: 60 };

/** 차트 요약 문장(화면 낭독): "한빛반도체 주봉, 최근 104주 동안 78,900에서 84,300으로 6.84% 상승" */
export function chartSummary(name: string, bars: Bar[], period: BarPeriod, fmt: (n: number) => string): string {
  const shown = bars.slice(-INITIAL_BARS[period]);
  const a = shown[0], b = shown.at(-1);
  if (!a || !b || shown.length < 2) return `${name} ${PERIOD_NAME[period]}, 자료가 모자라요`;
  const pct = (b.close / a.close - 1) * 100;
  const unit = period === "D" ? "거래일" : period === "W" ? "주" : "개월";
  const dir = pct > 0 ? "상승" : pct < 0 ? "하락" : "보합";
  return `${name} ${PERIOD_NAME[period]}, 최근 ${shown.length}${unit} 동안 ${fmt(a.close)}에서 ${fmt(b.close)}으로 ${Math.abs(pct).toFixed(2)}% ${dir}`;
}

// ───────────────────────── 신호 기록(차트 표식 D) ─────────────────────────

export type SignalKind = "weinstein" | "candle" | "daily";
export const SIGNAL_KIND_LABEL: Record<SignalKind, string> = { weinstein: "와인스타인 주봉", candle: "캔들마스터 주봉", daily: "일봉 보조" };

export interface SignalMark {
  /** `${kind}:${date}:${side}` */
  id: string;
  kind: SignalKind;
  /** 신호가 난 봉의 마지막 거래일(주봉 신호는 그 주의 마지막 거래일) */
  date: string;
  side: "buy" | "sell";
  /** 목록 이름(예: "2단계 돌파") */
  label: string;
  /** 차트 표식 이름표(짧게) */
  short: string;
  /** 마감된 마지막 주(또는 마지막 일봉)의 신호 */
  latest: boolean;
  stage?: StageResult;
  candle?: CandleMasterResult;
  daily?: DailySignal[];
}

const markId = (kind: SignalKind, date: string, side: "buy" | "sell") => `${kind}:${date}:${side}`;

/**
 * 와인스타인 주봉 단계 신호(백테스트 전략 weinstein의 진입·청산과 같은 판정):
 * 매수 의견이 시작된 주(2단계 진입·바닥권 돌파), 그 안에서 거래량을 동반한 돌파 주, 돌파 후 첫 풀백, 매도 의견이 시작된 주.
 * 이어지는 주는 첫 주만 표시한다.
 */
export function weinsteinMarks(candles: Candle[], indexCandles?: Candle[] | null): SignalMark[] {
  const weekly = completedWeeks(toWeekly(candles));
  if (!weekly.length) return [];
  const ctx = prepareStage(weekly);
  const rs = indexCandles?.length ? relativeStrength(weekly, toWeekly(indexCandles)) : undefined;
  const out: SignalMark[] = [];
  let prevBuy = false, prevStrong = false, prevSell = false;
  const last = weekly.length - 1;
  for (let k = 0; k < weekly.length; k++) {
    const r = stageAt(ctx, k, rs);
    if (!r) {
      prevBuy = prevStrong = prevSell = false;
      continue;
    }
    const date = weekly[k]!.date;
    const buy = BUY_ACTIONS.includes(r.action);
    const strong = r.action === "STRONG_BUY" && r.breakout && r.volumeBasis != null;
    const pull = !buy && r.pullbackBuy && r.stage !== 4 && !(r.rs != null && r.rs <= 0);
    const sell = SELL_ACTIONS.includes(r.action);
    const mark = (side: "buy" | "sell", label: string, short: string) =>
      out.push({ id: markId("weinstein", date, side), kind: "weinstein", date, side, label, short, latest: k === last, stage: r });
    if (strong && !prevStrong) mark("buy", "2단계 돌파", "돌파");
    else if (buy && !prevBuy) mark("buy", r.stage === 1 ? "바닥권 돌파" : "2단계 진입", r.stage === 1 ? "돌파" : "진입");
    else if (pull) mark("buy", "돌파 후 첫 풀백", "풀백");
    if (sell && !prevSell) mark("sell", r.stage === 4 ? "4단계 진입" : "30주선 아래로 이탈", "이탈");
    prevBuy = buy;
    prevStrong = strong;
    prevSell = sell;
  }
  return out;
}

/** 주(weekKey)별 와인스타인 단계 판정(일봉 보조 신호를 그 주 주봉 근거와 함께 보여 줄 때) */
export function stagesByWeek(candles: Candle[], indexCandles?: Candle[] | null): Map<string, StageResult> {
  const weekly = completedWeeks(toWeekly(candles));
  const ctx = prepareStage(weekly);
  const rs = indexCandles?.length ? relativeStrength(weekly, toWeekly(indexCandles)) : undefined;
  const out = new Map<string, StageResult>();
  weekly.forEach((w, k) => {
    const r = stageAt(ctx, k, rs);
    if (r) out.set(w.weekKey, r);
  });
  return out;
}

/** 캔들마스터 주봉 매수 신호(파동이 해석 대상인 주만 — 그렇지 않으면 진입 근거가 아니다) */
export function candleMarks(candles: Candle[]): SignalMark[] {
  const weekly = completedWeeks(toWeekly(candles));
  const out: SignalMark[] = [];
  const last = weekly.length - 1;
  for (let k = 0; k < weekly.length; k++) {
    if (!candleMasterSignals(weekly, k).length) continue;
    const r = candleMasterAt(weekly, k);
    if (!r || !r.wave.ok || !r.signals.length) continue;
    out.push({ id: markId("candle", r.date, "buy"), kind: "candle", date: r.date, side: "buy", label: r.signals.map((s) => s.name).join(" · "), short: "캔들", latest: k === last, candle: r });
  }
  return out;
}

/** 일봉 보조 신호(매수·매도 쪽만, 최근 lookback봉). 같은 날 같은 쪽 신호는 하나로 묶는다 */
export function dailyMarks(candles: Candle[], indexCandles?: Candle[] | null, lookback = 250): SignalMark[] {
  if (candles.length < 2) return [];
  const prep = prepareDailySignals(candles);
  const regimeOf = indexCandles?.length ? dailyRegimeLookup(indexCandles) : null;
  const out: SignalMark[] = [];
  const last = candles.length - 1;
  for (let i = Math.max(1, candles.length - lookback); i < candles.length; i++) {
    const date = candles[i]!.date;
    const sigs = dailySignalsFromPrep(prep, i, { regime: regimeOf?.(date) ?? null });
    for (const side of ["buy", "sell"] as const) {
      const list = sigs.filter((s) => s.side === side);
      if (!list.length) continue;
      const word = side === "buy" ? "매수" : "매도";
      out.push({
        id: markId("daily", date, side), kind: "daily", date, side, daily: list, latest: i === last, short: "",
        label: list.length > 1 ? `일봉 ${word} 신호 ${list.length}개` : `일봉 ${word} · ${list[0]!.id}`,
      });
    }
  }
  return out;
}

/** 이 기간 차트에 그릴 신호(일봉 보조 신호는 일봉에서만) */
export function marksForPeriod(marks: SignalMark[], period: BarPeriod): SignalMark[] {
  return marks.filter((m) => period === "D" || m.kind !== "daily");
}

/** 신호 날짜가 들어 있는 봉의 시각(봉 범위 밖이면 null) */
export function barTimeOf(bars: Bar[], date: string): string | null {
  let lo = 0, hi = bars.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time >= date) (hit = mid), (hi = mid - 1);
    else lo = mid + 1;
  }
  if (hit < 0) return null;
  const b = bars[hit]!;
  return b.from <= date ? b.time : null;
}

export interface ChartMarker {
  id: string;
  time: string;
  side: "buy" | "sell";
  kind: SignalKind;
  text: string;
}

/** 신호 → 차트 표식(시각 오름차순). 같은 봉에 같은 종류가 여럿이면 하나만 */
export function chartMarkers(marks: SignalMark[], bars: Bar[], period: BarPeriod): ChartMarker[] {
  const seen = new Set<string>();
  const out: ChartMarker[] = [];
  for (const m of marksForPeriod(marks, period)) {
    const time = barTimeOf(bars, m.date);
    if (!time) continue;
    const key = `${time}|${m.kind}|${m.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: m.id, time, side: m.side, kind: m.kind, text: m.short });
  }
  return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/** 그 주 지수로 다시 계산한 시장 국면(과거 신호의 '시장 국면' 칸용. 매크로·시장 폭은 빼고 계산한다) */
export function postureAt(indexCandles: Candle[] | null | undefined, date: string, caps?: Record<Posture, number>, region?: Region): RegimeAssessment | null {
  if (!indexCandles?.length) return null;
  let i = -1;
  for (let j = indexCandles.length - 1; j >= 0; j--) if (indexCandles[j]!.date <= date) {
    i = j;
    break;
  }
  return i < 0 ? null : assessRegimeAt(indexCandles, i, null, caps, { region });
}

/** 과거 신호 시점의 분석: 단계·국면은 그 주 기준, 실적(스크리닝)은 지금 공시 기준 */
export function analysisAt(a: Analysis, stage: StageResult, posture: RegimeAssessment | null): Analysis {
  return { ...a, timing: stage, posture };
}

export const stageTitle = (r: StageResult) => STAGE_LABEL[r.stage];

// ───────────────────────── 포지션 미리 계산(G·E) ─────────────────────────

export interface OrderPreviewInput {
  side: "BUY" | "SELL";
  price: number;
  stop: number;
  /** 예수금(그 시장 통화) */
  capital: number;
  riskPct: number;
  maxWeightPct: number;
  /** 직접 기록한 보유 수량 */
  held: number;
}

export interface OrderPreview {
  qty: number;
  /** 주당 손절폭(가격 − 손절가). 손절가가 없거나 가격 이상이면 0 */
  perShare: number;
  /** 손절 시 예상 손실(양수) */
  loss: number;
  /** 계좌 대비 손실 비율(%) */
  lossPct: number | null;
  /** 손절가의 가격 대비 거리(%, 음수) */
  stopPct: number | null;
  /** 주문 후 종목 비중(%) */
  weightAfter: number | null;
  stopOk: boolean;
}

/**
 * 주문 검토 시트(features/OrderReviewSheet)와 같은 식으로 기본 수량을 낸다:
 * 1회 손실 한도(예수금 × riskPct) ÷ 주당 손절폭, 종목 비중 상한(maxWeightPct) 이내. 매도는 보유 수량.
 * 미리 보기와 시트의 수량이 같아야 사용자가 헷갈리지 않는다.
 */
export function orderPreview(i: OrderPreviewInput): OrderPreview {
  const price = i.price > 0 ? i.price : 0;
  const stopOk = i.side === "SELL" || (i.stop > 0 && price > 0 && i.stop < price);
  const perShare = i.side === "BUY" && stopOk ? price - i.stop : 0;
  let qty: number;
  if (i.side === "SELL") qty = Math.max(0, i.held);
  else {
    const risk = i.capital > 0 ? (i.capital * i.riskPct) / 100 : 0;
    const byRisk = perShare > 0 ? Math.floor(risk / perShare) : 0;
    const byWeight = i.capital > 0 && price > 0 ? Math.floor((i.capital * i.maxWeightPct) / 100 / price) : 0;
    qty = Math.max(perShare > 0 ? 1 : 0, Math.min(byRisk || byWeight, byWeight || byRisk));
  }
  const loss = perShare * qty;
  const after = i.side === "BUY" ? i.held + qty : Math.max(0, i.held - qty);
  return {
    qty,
    perShare,
    loss,
    lossPct: i.capital > 0 ? (loss / i.capital) * 100 : null,
    stopPct: i.stop > 0 && price > 0 ? (i.stop / price - 1) * 100 : null,
    weightAfter: i.capital > 0 && price > 0 ? ((after * price) / i.capital) * 100 : null,
    stopOk,
  };
}

/** 한국거래소 호가 단위(2023년 개편 기준) */
export function krTick(price: number): number {
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

/** 손절 비율(%, 음수) → 손절가. 손실이 커지지 않게 호가 단위(미국은 센트)로 내림 */
export function stopFromPct(price: number, pct: number, region: Region): number {
  const raw = price * (1 + pct / 100);
  if (!(raw > 0)) return 0;
  if (region === "US") return Math.floor(raw * 100) / 100;
  const t = krTick(raw);
  return Math.floor(raw / t) * t;
}

/** 가격 입력칸 표시: 국내는 정수에 천 단위 쉼표, 미국은 소수 둘째 자리까지 */
export function fmtInputPrice(raw: string, region: Region): string {
  if (region === "US") {
    const [a = "", ...rest] = raw.replace(/[^\d.]/g, "").split(".");
    return rest.length ? `${a}.${rest.join("").slice(0, 2)}` : a;
  }
  const digits = raw.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
}
/** 입력칸 글자 → 숫자(쉼표 등은 무시). 비었거나 읽을 수 없으면 0 */
export const parseInputPrice = (s: string) => {
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** 손절 슬라이더 범위(지도서 6.1 E): −15%~−1% */
export const STOP_SLIDER = { min: -15, max: -1, step: 0.1 } as const;
export const clampStopPct = (pct: number) => Math.max(STOP_SLIDER.min, Math.min(STOP_SLIDER.max, Math.round(pct * 10) / 10));

// ───────────────────────── 주문 계획(어느 전략의 손절·목표를 쓸까) ─────────────────────────

export type PlanSource = "weinstein" | "candle" | "daytrade";

export interface OrderPlan {
  source: PlanSource;
  stop: number;
  target: number | null;
}

/** 와인스타인: 참고 손절가, 목표는 스윙 목표가(현재가 위일 때) 또는 손익비 2:1 목표 */
export function weinsteinPlan(a: Analysis): OrderPlan {
  const swing = a.timing.swingTarget;
  return { source: "weinstein", stop: a.timing.stopLoss, target: swing != null && swing > a.price ? swing : a.target };
}
export function candlePlan(r: CandleMasterResult): OrderPlan | null {
  if (!r.valid || r.stop == null) return null;
  return { source: "candle", stop: r.stop, target: r.target };
}
export const dayTradePlan = (c: DayTradeCandidate): OrderPlan => ({ source: "daytrade", stop: c.stop, target: c.target });

// ───────────────────────── 관심종목 ─────────────────────────

/** index 자리의 항목을 delta만큼 옮긴다(범위를 넘으면 그대로) */
export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(index, 1);
  next.splice(to, 0, x!);
  return next;
}

/** 지운 자리에 되돌린다(되돌리기) */
export function restoreAt(list: string[], code: string, index: number): string[] {
  if (list.includes(code)) return list;
  const next = [...list];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, code);
  return next;
}

/** ↑↓로 다음·이전 종목(끝에서 멈춘다). 지금 종목이 목록에 없으면 첫 종목 */
export function stepCode(list: string[], current: string | null, dir: 1 | -1): string | null {
  if (!list.length) return null;
  const i = current ? list.indexOf(current) : -1;
  if (i < 0) return list[0]!;
  return list[Math.max(0, Math.min(list.length - 1, i + dir))]!;
}

/** 목록 행 보조 문구(지도서 그림 7: 2단계 돌파·캔들 신호·보유 중·관찰) */
export function stateLabel(x: { held: boolean; candidate: boolean; analysis: Analysis | null }): string {
  if (x.held) return "보유 중";
  if (x.candidate) return "단타 돌파";
  const a = x.analysis;
  if (!a) return "관찰";
  if (a.candleMaster?.valid) return "캔들 신호";
  const t = a.timing;
  if (t.stage === 2 && t.breakout && t.volumeBasis) return "2단계 돌파";
  if (t.stage === 2) return "2단계 상승";
  return `${t.stage}단계 · 관찰`;
}

/** 기본 차트 기간(지도서 5.2 C): 단타 후보면 일봉, 그 밖(와인스타인)은 주봉 */
export const defaultPeriod = (isCandidate: boolean): BarPeriod => (isCandidate ? "D" : "W");

// ───────────────────────── 종목 메모(이 기기) ─────────────────────────

export const MEMO_KEY = "jusik.stocks.memo.v1";

export function loadMemo(code: string): string {
  try {
    const all = JSON.parse(localStorage.getItem(MEMO_KEY) ?? "{}") as Record<string, unknown>;
    const v = all && typeof all === "object" ? all[code] : "";
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

/** 저장했으면 true(저장소가 막혀 있으면 false) */
export function saveMemo(code: string, text: string): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(MEMO_KEY) ?? "{}") as Record<string, string>;
    const all = raw && typeof raw === "object" ? raw : {};
    if (text.trim()) all[code] = text;
    else delete all[code];
    localStorage.setItem(MEMO_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── 문장 ─────────────────────────

/** 목적격 조사: 받침이 있으면 '을', 없으면 '를'. 한글이 아니면 '을(를)' */
export function objParticle(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  if (!(c >= 0 && c < 11172)) return "을(를)";
  return c % 28 === 0 ? "를" : "을";
}
