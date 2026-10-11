import {
  currencyOfRegion, dayTradeEvidence, DAYTRADE_CELLS, macd, MACRO_PARAMS, regionOf, sma, toWeekly,
  type BreadthSummary, type Candle, type Currency, type DayTradeCandidate, type Evidence, type MacroSnapshot, type Market, type PaperPosition,
  type RegimeAssessment, type Region, type ScanResult, type Settings,
} from "@jusik/shared";

/*
 * 홈(UI 지도서 5.1·7.1)과 시장 국면 상세(부록 A)가 쓰는 순수 계산. 화면 없이 시험할 수 있게 여기에 모았다.
 */

export const MARKET_ORDER: Market[] = ["KOSPI", "KOSDAQ", "US"];
export const MARKET_LABEL: Record<Market, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "미국" };
/** 지수 이름(미국은 S&P 500 지수를 쓴다) */
export const INDEX_LABEL: Record<Market, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "S&P 500" };

export const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

/** 화면 낭독용 지수 문장: "코스피 2,731.52, 0.84% 상승" */
export function srIndex(name: string, close: number, pct: number | null | undefined): string {
  const v = close.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (pct == null || !Number.isFinite(pct)) return `${name} ${v}`;
  return `${name} ${v}, ${Math.abs(pct).toFixed(2)}% ${pct > 0 ? "상승" : pct < 0 ? "하락" : "보합"}`;
}

/** 설정에서 켠 시장(순서 고정). 하나도 없으면 마지막 스캔 시장, 그것도 없으면 코스피 */
export function enabledMarkets(settings: Pick<Settings, "markets"> | null | undefined, scan?: Pick<ScanResult, "markets"> | null): Market[] {
  const on = MARKET_ORDER.filter((m) => settings?.markets?.[m]);
  if (on.length) return on;
  const scanned = MARKET_ORDER.filter((m) => scan?.markets.includes(m));
  return scanned.length ? scanned : ["KOSPI"];
}

/** 고른 시장이 목록에 없으면 첫 시장 */
export const pickMarket = (preferred: Market | null | undefined, markets: Market[]): Market =>
  preferred && markets.includes(preferred) ? preferred : (markets[0] ?? "KOSPI");

/** 켠 시장이 쓰는 통화(국내 시장이 하나라도 있으면 원화, 미국이 있으면 달러) */
export function currenciesOf(markets: Market[]): Currency[] {
  const out: Currency[] = [];
  if (markets.some((m) => regionOf(m) === "KR")) out.push("KRW");
  if (markets.includes("US")) out.push("USD");
  return out.length ? out : ["KRW"];
}

// ───────────────────────── 국면 근거 문장 ─────────────────────────

export interface MacdCross {
  dir: "up" | "down";
  /** 마지막 봉 기준 몇 봉 전에 교차했는지(0 = 마지막 봉) */
  barsAgo: number;
}

/** 최근 lookback봉 안의 마지막 MACD(12,26,9)-시그널 교차. 없으면 null */
export function lastMacdCross(closes: number[], lookback = 60): MacdCross | null {
  const m = macd(closes, 12, 26, 9);
  const n = closes.length;
  for (let i = n - 1; i >= Math.max(1, n - lookback); i--) {
    const a = m.macd[i], s = m.signal[i], pa = m.macd[i - 1], ps = m.signal[i - 1];
    if (a == null || s == null || pa == null || ps == null) break;
    const now = a > s, before = pa > ps;
    if (now !== before) return { dir: now ? "up" : "down", barsAgo: n - 1 - i };
  }
  return null;
}

export interface Reason {
  /** 컴퓨터·태블릿: 한 줄 문장 */
  long: string;
  /** 핸드폰: 짧게(쉼표로 이어 붙인다) */
  short: string;
}

/**
 * 국면 근거 두 줄(지도서 그림 4 D: "지수는 30주선 위에서 상승 중", "MACD는 3일 전 하락 교차").
 * 주봉 30주선 단계(M1-01·02)와 지수 MACD(M1-03)를 쓴다. cross는 지수 일봉에서 찾은 마지막 교차(마지막 봉이 판정 기준일과 같을 때만 넘긴다)
 */
export function regimeReasons(p: Pick<RegimeAssessment, "stageRegime" | "macdBullish" | "choppy">, cross?: MacdCross | null): Reason[] {
  const out: Reason[] = [];
  if (p.stageRegime === "BULL") out.push({ long: "지수는 30주선 위에서 상승 중이에요", short: "지수 30주선 위" });
  else if (p.stageRegime === "BEAR") out.push({ long: "지수가 30주선 아래로 내려가 있어요", short: "지수 30주선 아래" });
  else if (p.stageRegime === "NEUTRAL") out.push({ long: "지수 30주선 방향이 뚜렷하지 않아요", short: "30주선 방향 불분명" });
  else out.push({ long: "지수 주봉이 모자라 30주선 판정은 빠졌어요", short: "30주선 판정 없음" });

  if (p.macdBullish != null) {
    const word = p.macdBullish ? "상승" : "하락";
    const fits = cross && (cross.dir === "up") === p.macdBullish;
    if (fits) {
      const when = cross.barsAgo === 0 ? "오늘" : `${cross.barsAgo}일 전`;
      out.push({ long: `MACD는 ${when} ${word} 교차했어요`, short: `MACD ${word} 교차` });
    } else {
      out.push({ long: `MACD가 시그널 ${p.macdBullish ? "위" : "아래"}에 있어요`, short: `MACD 시그널 ${p.macdBullish ? "위" : "아래"}` });
    }
    if (p.choppy) out[out.length - 1]!.long += "(교차가 잦아 횡보장일 수 있어요)";
  }
  return out;
}

// ───────────────────────── 지수 차트 ─────────────────────────

export type ChartPeriod = "D" | "W" | "M";
export const PERIOD_LABEL: Record<ChartPeriod, string> = { D: "일", W: "주", M: "월" };
export const PERIOD_NAME: Record<ChartPeriod, string> = { D: "일봉", W: "주봉", M: "월봉" };

export interface LinePoint {
  time: string;
  value: number;
}

export interface IndexSeries {
  close: LinePoint[];
  ma: LinePoint[];
  /** 기준선 이름(30주선과 같은 기간) */
  maLabel: string;
}

/** 월봉: 달마다 마지막 거래일 종가 */
function toMonthly(candles: Candle[]): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = [];
  for (const c of candles) {
    const last = out.at(-1);
    if (last && last.date.slice(0, 7) === c.date.slice(0, 7)) {
      last.date = c.date;
      last.close = c.close;
    } else out.push({ date: c.date, close: c.close });
  }
  return out;
}

/** 기간별로 보여 줄 봉 수와 기준선(와인스타인 30주선과 같은 기간: 150일선·30주선·7개월선) */
const PERIOD_CFG: Record<ChartPeriod, { show: number; ma: number; label: string }> = {
  D: { show: 250, ma: 150, label: "150일선" },
  W: { show: 104, ma: 30, label: "30주선" },
  M: { show: 48, ma: 7, label: "7개월선" },
};

/** 지수 종가와 30주선(같은 기간 이동평균). 이동평균은 잘라 내기 전 전체로 계산한다 */
export function indexSeries(candles: Candle[], period: ChartPeriod): IndexSeries {
  const cfg = PERIOD_CFG[period];
  const bars = period === "D" ? candles.map((c) => ({ date: c.date, close: c.close })) : period === "W" ? toWeekly(candles).map((w) => ({ date: w.date, close: w.close })) : toMonthly(candles);
  const avg = sma(bars.map((b) => b.close), cfg.ma);
  const from = Math.max(0, bars.length - cfg.show);
  const close: LinePoint[] = [];
  const ma: LinePoint[] = [];
  for (let i = from; i < bars.length; i++) {
    close.push({ time: bars[i]!.date, value: bars[i]!.close });
    const v = avg[i];
    if (v != null) ma.push({ time: bars[i]!.date, value: v });
  }
  return { close, ma, maLabel: cfg.label };
}

/** 차트 요약 문장(화면 낭독용) */
export function seriesSummary(name: string, s: IndexSeries, period: ChartPeriod): string {
  const a = s.close[0], z = s.close.at(-1), m = s.ma.at(-1);
  if (!a || !z) return `${name} ${PERIOD_NAME[period]} 자료가 없어요`;
  const ch = ((z.value / a.value - 1) * 100).toFixed(1);
  const pos = m ? (z.value >= m.value ? `${s.maLabel} 위` : `${s.maLabel} 아래`) : "";
  return `${name} ${PERIOD_NAME[period]}, 기간 중 ${Number(ch) > 0 ? "+" : ""}${ch}%, 마지막 종가는 ${pos}`.replace(/, $/, "");
}

// ───────────────────────── 후보 필터 칩 ─────────────────────────

export interface CandidateFilter {
  id: string;
  label: string;
  count: number;
}

/**
 * 근거 칸으로 만든 필터 칩(전체 / 20일 고점 돌파 / 거래량 2배 …).
 * 후보를 실제로 가르는 칸(충족한 후보가 있고 전부는 아닌 칸)만, 칸 순서대로 max개까지
 */
export function candidateFilters(cands: DayTradeCandidate[], max = 4, evidence: (c: DayTradeCandidate) => Evidence = dayTradeEvidence): CandidateFilter[] {
  if (!cands.length) return [];
  const evs = cands.map(evidence);
  const out: CandidateFilter[] = [];
  for (const { id, label } of DAYTRADE_CELLS) {
    const count = evs.filter((e) => e.cells.some((c) => c.id === id && c.state === "met")).length;
    if (count > 0 && count < cands.length) out.push({ id, label, count });
  }
  return out.slice(0, max);
}

/** 그 칸을 충족한 후보만 */
export function filterCandidates(cands: DayTradeCandidate[], cellId: string | null, evidence: (c: DayTradeCandidate) => Evidence = dayTradeEvidence): DayTradeCandidate[] {
  if (!cellId) return cands;
  return cands.filter((c) => evidence(c).cells.some((x) => x.id === cellId && x.state === "met"));
}

// ───────────────────────── 국면 점수 구성 ─────────────────────────

export interface ScorePart {
  key: keyof RegimeAssessment["breakdown"];
  label: string;
  value: number;
  /** 이 항목이 낼 수 있는 점수 범위 */
  min: number;
  max: number;
  rule: string;
  /** 어떻게 매기는지 한 줄 */
  how: string;
}

/** 국면 점수 구성(합이 국면 점수). 이전 버전 스캔에는 breadth가 없을 수 있다 */
export function scoreParts(b: Partial<RegimeAssessment["breakdown"]>): ScorePart[] {
  const v = (x: number | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return [
    { key: "stage", label: "주봉 30주선 단계", value: v(b.stage), min: -2, max: 2, rule: "M1-01·02 와인스타인", how: "지수가 상승하는 30주선 위면 +2, 30주선 아래 하락이면 −2" },
    { key: "macd", label: "지수 MACD", value: v(b.macd), min: -1, max: 1, rule: "M1-03 강동진", how: "MACD가 시그널 위면 +1, 아래면 −1" },
    { key: "rsi", label: "지수 RSI", value: v(b.rsi), min: -1, max: 1, rule: "M1-08·2.4 강영현", how: "과매도(30 아래)에서 회복하면 +1, 과열(75 위)이면 −1" },
    { key: "macro", label: "매크로", value: v(b.macro), min: -2, max: 0, rule: "2.3 강영현", how: "부정 신호 1개당 −1, 최대 −2" },
    { key: "breadth", label: "시장 폭", value: v(b.breadth), min: -1, max: 1, rule: "2.2 와인스타인", how: "A/D선 괴리·MI 교차·신고가-신저가를 더해 −1~+1" },
  ];
}

// ───────────────────────── 시장 폭·매크로 요약 ─────────────────────────

/** 거래소 전체 기록이 이 일수 이상 쌓이면 기록으로 만든 A/D선을 차트에 더한다(앱 기본값) */
export const BREADTH_LOG_MIN_DAYS = 20;

/** 스캔에 남은 시장 폭 상태: old(이전 버전 스캔) · none(시장 폭 공급자 없음) · pending(계산 중이거나 못 함) · 요약 */
export type BreadthState = "old" | "none" | "pending" | BreadthSummary;

export function breadthStateOf(scan: Pick<ScanResult, "breadth">, m: Market): BreadthState {
  if (scan.breadth === undefined) return "old";
  const b = scan.breadth[m];
  return b === undefined ? "none" : b === null ? "pending" : b;
}

/** 통화별로 실제 적용한 상한이 어떤 시장에서 왔는지 */
export function capSource(cur: Currency, markets: Market[]): string {
  const mine = markets.filter((m) => currencyOfRegion(regionOf(m)) === cur);
  if (mine.length === 0) return "이 지역은 스캔하지 않아 중립 상한";
  if (mine.length === 1) return `${MARKET_LABEL[mine[0]!]} 기준`;
  return `${mine.map((m) => MARKET_LABEL[m]).join("·")} 중 낮은 쪽`;
}

export interface MacroItem {
  label: string;
  value: string;
  /** 관측일 문구 */
  when: string;
  warn: boolean;
  /** 판단 기준 한 줄 */
  basis: string;
  tag?: string;
}

const sgn = (n: number, d: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;
const quarterOf = (date: string) => `${date.slice(0, 4)}년 ${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}분기`;
const obs = (d: string | undefined) => (d ? `관측 ${d}` : "데이터 없음");

/** 매크로 스냅숏 → 화면 칸(값이 없으면 '-'). warn은 경고 기준을 넘었다는 뜻 */
export function macroItems(s: MacroSnapshot, region?: Region): MacroItem[] {
  const P = MACRO_PARAMS;
  const out: MacroItem[] = [];
  const sp = s.yieldSpread;
  out.push({
    label: "장단기 금리차(10년−2년)", value: sp ? `${sgn(sp.value, 2)}%p${sp.value < P.yieldSpreadInverted ? " 역전" : ""}` : "-",
    when: obs(sp?.date), warn: !!sp && sp.value < P.yieldSpreadInverted, basis: "0 아래면 수익률곡선 역전(M1-06)",
  });
  const vix = s.vix;
  out.push({
    label: "VIX", value: vix ? vix.value.toFixed(1) : "-", when: obs(vix?.date), warn: !!vix && vix.value >= P.vixHigh,
    basis: `${P.vixHigh} 이상 경계, ${P.vixPanic} 이상 공포(관행값)`,
  });
  const t10 = s.us10y;
  out.push({ label: "미 10년물 금리", value: t10 ? `${t10.value.toFixed(2)}%` : "-", when: obs(t10?.date), warn: false, basis: "금리 추세 판단에 써요" });
  const ch6 = s.us10yChange6m;
  out.push({
    label: "금리 추세(10년물 약 6개월 변화)", value: ch6 != null ? `${sgn(ch6, 2)}%p` : "-", when: ch6 != null ? obs(t10?.date) : "데이터 없음",
    warn: !!s.rateRising, tag: s.rateRising ? "금리 상승기" : undefined,
    basis: `+${P.rateRisingPp}%p 이상이면 금리 상승기(앱 기본값) — PSR 과열 경고(M2-10) 조건`,
  });
  const ex = s.excessLiquidity;
  out.push({
    label: "초과 유동성(M2−GDP 증가율)", value: ex != null ? `${sgn(ex, 1)}%p` : "-",
    when: s.m2YoY && s.gdpYoY ? `M2 ${s.m2YoY.date.slice(0, 7)} · GDP ${quarterOf(s.gdpYoY.date)}` : "데이터 없음",
    warn: ex != null && ex < P.excessLiquidityNegative, basis: "0 아래면 유동성 축소(M1-07)",
  });
  const krw = s.krwPerUsd, ch = s.krwChange20dPct;
  out.push({
    label: "원/달러 환율", value: krw ? `${Math.round(krw.value).toLocaleString("ko-KR")}원${ch != null ? ` (${sgn(ch, 1)}%)` : ""}` : "-",
    when: obs(krw?.date), warn: region !== "US" && ch != null && ch >= P.krwWeakPct,
    basis: `${P.krwLookback}개 관측 전 대비 +${P.krwWeakPct}% 이상이면 원화 약세 경고(관행값, 국내에만 반영)`,
  });
  const ism = s.ism, proxy = s.ismProxy;
  if (ism) {
    out.push({
      label: "ISM 제조업지수", value: `${ism.value.toFixed(1)} ${ism.value < P.ismLine ? "수축" : "확장"}`, when: `${ism.month}분 · 발표 ${ism.date}`,
      warn: ism.value < P.ismLine, tag: ism.source === "수동" ? "직접 입력" : "ISM 발표", basis: `${P.ismLine} 아래면 미국 제조업 수축(2.3 강영현·강동진)`,
    });
  } else if (proxy?.philly || proxy?.empire) {
    for (const [label, x] of [["필라델피아 연준 제조업", proxy.philly], ["뉴욕 연준 제조업", proxy.empire]] as const) {
      out.push({
        label, value: x ? `${sgn(x.value, 1)} ${x.value < P.ismProxyLine ? "수축" : "확장"}` : "-", when: obs(x?.date),
        warn: !!x && x.value < P.ismProxyLine, tag: "ISM 대용", basis: `ISM 값이 없어 대신 봐요. ${P.ismProxyLine} 아래면 수축(둘 다 수축일 때만 감점)`,
      });
    }
  } else {
    out.push({ label: "ISM 제조업지수", value: "-", when: "데이터 없음", warn: false, basis: `${P.ismLine} 아래면 미국 제조업 수축(2.3 강영현·강동진)` });
  }
  return out;
}

// ───────────────────────── 내 포지션 ─────────────────────────

/** 보유 평가 손익(현재가 기준, 수수료 포함 원가 대비) */
export function unrealized(positions: PaperPosition[]): { pnl: number; pct: number | null; value: number } {
  let value = 0, cost = 0;
  for (const p of positions) {
    const px = p.lastPrice ?? p.entryPrice;
    value += px * p.qty;
    cost += p.cost > 0 ? p.cost : p.entryPrice * p.qty;
  }
  return { pnl: value - cost, pct: cost > 0 ? (value / cost - 1) * 100 : null, value };
}
