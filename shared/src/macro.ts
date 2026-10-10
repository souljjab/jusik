import type { Note, Region } from "./types";

/*
 * 매크로 지표(자료집 2.3절, 규칙 M1-06·M1-07).
 * 원자료는 미국 FRED 시리즈를 쓴다(수집은 server/src/fred.ts). 여기서는 받아 온 시계열로 스냅샷을 만들고
 * 국면 점수에 쓸 경고 노트와 부정 신호 개수를 계산한다.
 */

export interface MacroSeriesPoint {
  /** YYYY-MM-DD(FRED 관측일. 월간·분기 시리즈는 기간 첫날) */
  date: string;
  value: number;
}

/**
 * T10Y2Y 미 10년물-2년물 금리차(%p, 일간) · VIXCLS VIX 종가(일간) · DGS10 미 10년물 금리(%, 일간)
 * M2SL M2 통화량(월간, 계절조정) · GDP 미국 명목 GDP(분기, 연율) · DEXKOUS 원/달러 환율(일간)
 */
export type MacroSeriesId = "T10Y2Y" | "VIXCLS" | "DGS10" | "M2SL" | "GDP" | "DEXKOUS";

export const MACRO_SERIES_IDS: MacroSeriesId[] = ["T10Y2Y", "VIXCLS", "DGS10", "M2SL", "GDP", "DEXKOUS"];

export const MACRO_SERIES_LABEL: Record<MacroSeriesId, string> = {
  T10Y2Y: "미 장단기 금리차(10년-2년)",
  VIXCLS: "VIX 변동성지수",
  DGS10: "미 10년물 국채 금리",
  M2SL: "미 M2 통화량",
  GDP: "미 명목 GDP",
  DEXKOUS: "원/달러 환율",
};

export interface MacroValue {
  value: number;
  /** 그 값의 관측일 */
  date: string;
}

export interface MacroSnapshot {
  /** 쓰인 시리즈 중 가장 최근 관측일. 자료가 하나도 없으면 null */
  asOf: string | null;
  /** 미 10년물 - 2년물(%p) */
  yieldSpread?: MacroValue;
  vix?: MacroValue;
  /** 미 10년물 금리(%) */
  us10y?: MacroValue;
  /** M2 전년 동월 대비 증가율(%) */
  m2YoY?: MacroValue;
  /** 명목 GDP 4분기 전 대비 증가율(%) */
  gdpYoY?: MacroValue;
  /** 초과 유동성 = M2 증가율 - GDP 증가율(%p). 각자 최신 관측치끼리 비교한다 */
  excessLiquidity?: number;
  /** 1달러당 원화 */
  krwPerUsd?: MacroValue;
  /** 20개 관측치(약 4주) 전 대비 원/달러 변화율(%). +면 원화 약세 */
  krwChange20dPct?: number;
}

/**
 * 판단 기준값. 책에 수치가 있는 것은 0(금리차·초과 유동성)뿐이고,
 * VIX 30/40/13과 원화 3%는 책에 수치가 없어 흔히 쓰는 관행값을 넣은 것이다(백테스트로 조정할 대상).
 */
export const MACRO_PARAMS = {
  /** 이 아래면 수익률곡선 역전(M1-06 강영현) */
  yieldSpreadInverted: 0,
  /** 이 아래면 유동성 축소(M1-07 강영현) */
  excessLiquidityNegative: 0,
  /** VIX 경계·공포·안일 기준(2.4 강영현은 VIX를 과열·침체 판단에 쓰지만 수치는 없음) */
  vixHigh: 30,
  vixPanic: 40,
  vixComplacent: 13,
  /** 원화가 이만큼(%) 이상 약해지면 외국인 매도 압력 경고(2.3 박병창, 수치는 관행값) */
  krwWeakPct: 3,
  /** 원/달러 변화율을 볼 관측치 수 */
  krwLookback: 20,
} as const;

/**
 * 과거 시점(asOf)으로 재현할 때 관측일 뒤 실제로 공표되기까지 걸리는 대략의 일수.
 * 공표 일정을 대충 반영한 보수적 추정치이며 실제 공표일과 대조하지 않았다.
 */
export const MACRO_RELEASE_LAG_DAYS: Record<MacroSeriesId, number> = {
  T10Y2Y: 1,
  VIXCLS: 1,
  DGS10: 1,
  // H.10 환율은 주 단위로 묶어 공표된다
  DEXKOUS: 10,
  // M2는 다음 달 말께 공표(관측일은 그 달 1일)
  M2SL: 60,
  // GDP 속보치는 분기 종료 약 한 달 뒤(관측일은 분기 첫날)
  GDP: 120,
};

export interface MacroBuildOptions {
  /** 이 날짜(YYYY-MM-DD)에 알 수 있었던 값만 쓴다(백테스트·재현용). 없으면 받은 자료 전부 */
  asOf?: string;
  /** asOf와 함께 쓰는 공표 지연(일). 기본은 MACRO_RELEASE_LAG_DAYS */
  releaseLagDays?: Partial<Record<MacroSeriesId, number>>;
}

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);

/** YYYY-MM-DD에서 n개월 전의 YYYY-MM */
function monthsBack(date: string, n: number): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1 - n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

/** 날짜 오름차순으로 정리하고 값이 없는 점은 버린다 */
function clean(points: MacroSeriesPoint[] | undefined): MacroSeriesPoint[] {
  if (!points?.length) return [];
  return points.filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 최신 관측치와 12개월 전 같은 달 관측치의 변화율(%). 월간·분기 시리즈 공용 */
function yoy(points: MacroSeriesPoint[]): MacroValue | undefined {
  const last = points.at(-1);
  if (!last) return undefined;
  const key = monthsBack(last.date, 12);
  const base = points.find((p) => p.date.startsWith(key));
  if (!base || !(base.value > 0)) return undefined;
  return { value: (last.value / base.value - 1) * 100, date: last.date };
}

export function buildMacroSnapshot(series: Partial<Record<MacroSeriesId, MacroSeriesPoint[]>>, opts: MacroBuildOptions = {}): MacroSnapshot {
  const lag = { ...MACRO_RELEASE_LAG_DAYS, ...opts.releaseLagDays };
  const get = (id: MacroSeriesId) => {
    const pts = clean(series[id]);
    if (!opts.asOf) return pts;
    // 관측일 + 공표 지연이 asOf를 넘는 값은 그 시점엔 몰랐던 값
    return pts.filter((p) => addDays(p.date, lag[id]) <= opts.asOf!);
  };
  const latest = (pts: MacroSeriesPoint[]): MacroValue | undefined => {
    const p = pts.at(-1);
    return p ? { value: p.value, date: p.date } : undefined;
  };

  const s: MacroSnapshot = { asOf: null };
  const spread = latest(get("T10Y2Y"));
  if (spread) s.yieldSpread = spread;
  const vix = latest(get("VIXCLS"));
  if (vix) s.vix = vix;
  const us10y = latest(get("DGS10"));
  if (us10y) s.us10y = us10y;
  const m2 = yoy(get("M2SL"));
  if (m2) s.m2YoY = m2;
  const gdp = yoy(get("GDP"));
  if (gdp) s.gdpYoY = gdp;
  if (m2 && gdp) s.excessLiquidity = m2.value - gdp.value;

  const krw = get("DEXKOUS");
  const krwLast = latest(krw);
  if (krwLast) {
    s.krwPerUsd = krwLast;
    const base = krw[krw.length - 1 - MACRO_PARAMS.krwLookback];
    if (base && base.value > 0) s.krwChange20dPct = (krwLast.value / base.value - 1) * 100;
  }

  const dates = [s.yieldSpread, s.vix, s.us10y, s.m2YoY, s.gdpYoY, s.krwPerUsd].filter((v): v is MacroValue => !!v).map((v) => v.date).sort();
  s.asOf = dates.at(-1) ?? null;
  return s;
}

const sign = (x: number) => (x > 0 ? "+" : "");
const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/** 원화 약세 신호는 한국 시장에만 의미가 있다(region이 US면 뺀다) */
const krwApplies = (region?: Region) => region !== "US";

/** 화면용 매크로 노트. 데이터가 없는 항목은 생략한다 */
export function macroNotes(s: MacroSnapshot, region?: Region): Note[] {
  const P = MACRO_PARAMS;
  const notes: Note[] = [];

  if (s.yieldSpread) {
    const v = s.yieldSpread.value;
    notes.push(
      v < P.yieldSpreadInverted
        ? { tone: "bad", text: `장단기 금리차 ${v.toFixed(2)}%p: 수익률곡선이 역전됐어요. 신용 사이클 후반 경고예요`, rule: "M1-06 강영현" }
        : { tone: "info", text: `장단기 금리차 ${sign(v)}${v.toFixed(2)}%p: 역전은 아니에요`, rule: "M1-06 강영현" },
    );
  }

  if (s.excessLiquidity != null && s.m2YoY && s.gdpYoY) {
    const ex = s.excessLiquidity;
    const detail = `M2 ${s.m2YoY.value.toFixed(1)}%(${s.m2YoY.date.slice(0, 7)}) − GDP ${s.gdpYoY.value.toFixed(1)}%(${quarterOf(s.gdpYoY.date)})`;
    notes.push(
      ex < P.excessLiquidityNegative
        ? { tone: "warn", text: `초과 유동성 ${ex.toFixed(1)}%p(${detail}): 유동성이 줄고 있어요. 지수가 뒤따라 약해진 경향이 있어요`, rule: "M1-07 강영현" }
        : { tone: "info", text: `초과 유동성 ${sign(ex)}${ex.toFixed(1)}%p(${detail}): 돈이 경제 성장보다 더 풀리고 있어요`, rule: "M1-07 강영현" },
    );
  }

  if (s.vix) {
    const v = s.vix.value;
    const t = v.toFixed(1);
    if (v >= P.vixPanic) notes.push({ tone: "bad", text: `VIX ${t}: 공포가 극단적이에요. 변동성이 매우 커요`, rule: "2.4 강영현" });
    else if (v >= P.vixHigh) notes.push({ tone: "warn", text: `VIX ${t}: 변동성이 커졌어요. 비중을 조심하세요`, rule: "2.4 강영현" });
    else if (v <= P.vixComplacent) notes.push({ tone: "info", text: `VIX ${t}: 시장이 안일해요. 과열을 경계하세요`, rule: "2.4 강영현" });
    else notes.push({ tone: "info", text: `VIX ${t}: 보통 수준이에요`, rule: "2.4 강영현" });
  }

  if (krwApplies(region) && s.krwPerUsd) {
    const rate = Math.round(s.krwPerUsd.value).toLocaleString("ko-KR");
    const ch = s.krwChange20dPct;
    if (ch != null && ch >= P.krwWeakPct)
      notes.push({ tone: "warn", text: `원/달러 ${rate}원, ${P.krwLookback}거래일 ${ch.toFixed(1)}% 원화 약세: 외국인 매도 압력이 커질 수 있어요`, rule: "2.3 박병창" });
    else notes.push({ tone: "info", text: `원/달러 ${rate}원${ch != null ? `(${P.krwLookback}거래일 ${sign(ch)}${ch.toFixed(1)}%)` : ""}`, rule: "2.3 박병창" });
  }

  if (s.us10y) {
    notes.push({ tone: "info", text: `미 10년물 금리 ${s.us10y.value.toFixed(2)}%: 금리가 높을수록 같은 지수도 비싸게 평가돼요`, rule: "2.3 강영현" });
  }
  return notes;
}

/** 국면 점수 감점용 부정 신호 개수(금리차 역전, 초과 유동성 마이너스, VIX 경계 이상, 원화 급약세) */
export function macroPressure(s: MacroSnapshot, region?: Region): number {
  const P = MACRO_PARAMS;
  let n = 0;
  if (s.yieldSpread && s.yieldSpread.value < P.yieldSpreadInverted) n++;
  if (s.excessLiquidity != null && s.excessLiquidity < P.excessLiquidityNegative) n++;
  if (s.vix && s.vix.value >= P.vixHigh) n++;
  if (krwApplies(region) && s.krwChange20dPct != null && s.krwChange20dPct >= P.krwWeakPct) n++;
  return n;
}
