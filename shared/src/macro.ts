import type { Note, Region } from "./types";

/*
 * 매크로 지표(자료집 2.3절, 규칙 M1-06·M1-07, 금리 상승기 판정은 M2-10이 쓴다).
 * 원자료는 미국 FRED 시리즈를 쓴다(수집은 server/src/fred.ts). ISM 제조업지수는 라이선스 문제로 FRED에서 빠져
 * ISM 사이트에서 따로 읽거나(server/src/ism.ts) 직접 넣고, 둘 다 없으면 지역 연준 제조업 지수 두 개를 대용으로 쓴다.
 * 여기서는 받아 온 시계열로 스냅샷을 만들고 국면 점수에 쓸 경고 노트와 부정 신호 개수를 계산한다.
 */

export interface MacroSeriesPoint {
  /** YYYY-MM-DD(FRED 관측일. 월간·분기 시리즈는 기간 첫날) */
  date: string;
  value: number;
}

/**
 * T10Y2Y 미 10년물-2년물 금리차(%p, 일간) · VIXCLS VIX 종가(일간) · DGS10 미 10년물 금리(%, 일간)
 * M2SL M2 통화량(월간, 계절조정) · GDP 미국 명목 GDP(분기, 연율) · DEXKOUS 원/달러 환율(일간)
 * GACDFSA066MSFRBPHI 필라델피아 연준 제조업 현재 활동 확산지수(월간, 계절조정, 0 위면 확장)
 * GACDINA066MSFRBNY 뉴욕 연준 엠파이어스테이트 제조업 현재 경기 확산지수(월간, 계절조정, 0 위면 확장)
 * 마지막 두 개는 ISM을 모를 때만 판단에 쓰는 대용 지표다.
 */
export type MacroSeriesId = "T10Y2Y" | "VIXCLS" | "DGS10" | "M2SL" | "GDP" | "DEXKOUS" | "GACDFSA066MSFRBPHI" | "GACDINA066MSFRBNY";

export const MACRO_SERIES_IDS: MacroSeriesId[] = ["T10Y2Y", "VIXCLS", "DGS10", "M2SL", "GDP", "DEXKOUS", "GACDFSA066MSFRBPHI", "GACDINA066MSFRBNY"];

export const MACRO_SERIES_LABEL: Record<MacroSeriesId, string> = {
  T10Y2Y: "미 장단기 금리차(10년-2년)",
  VIXCLS: "VIX 변동성지수",
  DGS10: "미 10년물 국채 금리",
  M2SL: "미 M2 통화량",
  GDP: "미 명목 GDP",
  DEXKOUS: "원/달러 환율",
  GACDFSA066MSFRBPHI: "필라델피아 연준 제조업 지수(ISM 대용)",
  GACDINA066MSFRBNY: "뉴욕 연준 엠파이어스테이트 제조업 지수(ISM 대용)",
};

export interface MacroValue {
  value: number;
  /** 그 값의 관측일 */
  date: string;
}

/** ISM 제조업 PMI 한 달치 */
export interface IsmReading {
  value: number;
  /** PMI가 가리키는 달(YYYY-MM) */
  month: string;
  /** 발표일(YYYY-MM-DD). 과거 시점 재현 때는 이 날짜를 기준으로 알 수 있었는지 따진다 */
  date: string;
  /** ISM: 사이트에서 읽은 값, 수동: 사용자가 직접 넣은 값 */
  source: "ISM" | "수동";
}

export interface MacroSnapshot {
  /** 쓰인 시리즈 중 가장 최근 관측일(ISM은 발표일). 자료가 하나도 없으면 null */
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
  /** ISM 제조업 PMI(2.3 강영현·강동진). 50 이상이면 확장, 아래면 수축 */
  ism?: IsmReading;
  /** ISM 대용 지역 연준 제조업 확산지수(0 위면 확장). 판단에는 ISM이 없을 때만 쓴다 */
  ismProxy?: { philly?: MacroValue; empire?: MacroValue };
  /** 미 10년물 금리의 rateLookback개 관측치(약 6개월) 전 대비 변화(%p) */
  us10yChange6m?: number;
  /** 금리 상승기 여부(us10yChange6m ≥ rateRisingPp). M2-10(PSR 과열 경고)의 조건 */
  rateRising?: boolean;
}

/**
 * 판단 기준값. 책에 수치가 있는 것은 0(금리차·초과 유동성)뿐이고, ISM 50·지역 연준 0은 지수 정의상의 기준선이다.
 * VIX 30/40/13과 원화 3%는 책에 수치가 없어 흔히 쓰는 관행값을, 금리 상승기 0.5%p/126개와 ISM 신선도는 앱 기본값을 넣은 것이다
 * (백테스트로 조정할 대상).
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
  /** ISM 제조업 PMI 확장·수축 기준선. 책(2.3 강영현·강동진)은 확장·수축 판단만 말하고, 50은 ISM 지수 정의상의 기준선 */
  ismLine: 50,
  /** 지역 연준 제조업 확산지수의 확장·수축 기준선. 지수 정의상 0(대용으로 쓰는 것 자체는 앱의 선택) */
  ismProxyLine: 0,
  /** 기준일보다 발표일이 이만큼(일) 넘게 오래된 ISM은 쓰지 않고 대용 지표로 넘어간다(앱 기본값: 다음 발표 약 30일 + 한 달 여유) */
  ismMaxAgeDays: 75,
  /**
   * asOf 재현 때 ISM 발표일 뒤 며칠부터 쓸지(앱 기본값 0 = 발표일 ≤ asOf). 다른 시리즈처럼 날짜 단위로만 따진다.
   * 미 동부 오전 10시 발표라 국내 장 마감(같은 날 15:30 KST) 뒤에 나오므로, 국내 종가 시점을 엄격히 재현하려면 1을 넘긴다
   */
  ismReleaseLagDays: 0,
  /** 10년물 금리가 rateLookback개 관측치 전보다 이만큼(%p) 이상 오르면 금리 상승기(앱 기본값. 2.3·M2-10 강영현에 수치 없음) */
  rateRisingPp: 0.5,
  /** 금리 추세를 볼 관측치 수(일간 약 6개월, 앱 기본값) */
  rateLookback: 126,
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
  // 필라델피아 연준 조사는 그 달 셋째 목요일(늦어도 21일) 공표(관측일은 그 달 1일)
  GACDFSA066MSFRBPHI: 21,
  // 엠파이어스테이트 조사는 그 달 15일 전후 공표(관측일은 그 달 1일)
  GACDINA066MSFRBNY: 20,
};

export interface MacroBuildOptions {
  /** 이 날짜(YYYY-MM-DD)에 알 수 있었던 값만 쓴다(백테스트·재현용). 없으면 받은 자료 전부 */
  asOf?: string;
  /** asOf와 함께 쓰는 공표 지연(일). 기본은 MACRO_RELEASE_LAG_DAYS */
  releaseLagDays?: Partial<Record<MacroSeriesId, number>>;
  /**
   * ISM 제조업 PMI(사이트에서 읽은 값 또는 수동 입력). 여러 달 이력을 넘기면 쓸 수 있는 것 중 발표일이 가장 늦은 것을 쓴다.
   * asOf가 있으면 발표일 + ismReleaseLagDays(기본 0) ≤ asOf인 값만 쓴다(미래 참조 없음).
   * 기준일(asOf, 없으면 FRED 최신 관측일)보다 발표일이 ismMaxAgeDays 넘게 오래된 값도 쓰지 않는다
   */
  ism?: IsmReading | IsmReading[] | null;
  /** ISM 발표 지연(일). 기본은 MACRO_PARAMS.ismReleaseLagDays */
  ismReleaseLagDays?: number;
}

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD에서 n개월 전의 YYYY-MM */
function monthsBack(date: string, n: number): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1 - n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

/** 기준일(ref) 대비 ISM 발표일(date)이 ismMaxAgeDays 이내인지. 기준일보다 늦은 발표일도 신선한 것으로 본다 */
export function ismIsFresh(date: string, ref: string, maxAgeDays: number = MACRO_PARAMS.ismMaxAgeDays): boolean {
  const age = (Date.parse(ref) - Date.parse(date)) / DAY;
  return Number.isFinite(age) && age <= maxAgeDays;
}

/** 형식이 맞고 asOf까지 발표된 ISM 중 발표일이 가장 늦은 것 */
function pickIsm(ism: MacroBuildOptions["ism"], asOf: string | undefined, lagDays: number): IsmReading | undefined {
  const list = ism == null ? [] : Array.isArray(ism) ? ism : [ism];
  let best: IsmReading | undefined;
  for (const r of list) {
    if (!r || !Number.isFinite(r.value) || !MONTH_RE.test(r.month) || !DATE_RE.test(r.date)) continue;
    if (asOf && addDays(r.date, lagDays) > asOf) continue; // 그 시점엔 아직 발표 전
    if (!best || r.date > best.date || (r.date === best.date && r.month > best.month)) best = r;
  }
  return best && { value: best.value, month: best.month, date: best.date, source: best.source === "수동" ? "수동" : "ISM" };
}

/** 날짜 오름차순으로 정리하고 값이 없는 점은 버린다 */
function clean(points: MacroSeriesPoint[] | undefined): MacroSeriesPoint[] {
  if (!points?.length) return [];
  return points.filter((p) => DATE_RE.test(p.date) && Number.isFinite(p.value)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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

/**
 * 시계열 → 스냅샷. opts.asOf를 주면 그날 알 수 있었던 값(관측일 + 공표 지연 ≤ asOf)만 쓴다.
 * 10년물 6개월 변화도 asOf로 거른 관측치 안에서만 세고, ISM도 asOf까지 발표된 것만 쓴다(미래 참조 없음).
 */
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
  const t10 = get("DGS10");
  const us10y = latest(t10);
  if (us10y) {
    s.us10y = us10y;
    const base = t10[t10.length - 1 - MACRO_PARAMS.rateLookback];
    if (base) {
      s.us10yChange6m = us10y.value - base.value;
      s.rateRising = s.us10yChange6m >= MACRO_PARAMS.rateRisingPp;
    }
  }
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

  const philly = latest(get("GACDFSA066MSFRBPHI"));
  const empire = latest(get("GACDINA066MSFRBNY"));
  if (philly || empire) s.ismProxy = { ...(philly && { philly }), ...(empire && { empire }) };

  const dates = [s.yieldSpread, s.vix, s.us10y, s.m2YoY, s.gdpYoY, s.krwPerUsd, philly, empire].filter((v): v is MacroValue => !!v).map((v) => v.date).sort();
  s.asOf = dates.at(-1) ?? null;

  // ISM: 기준일(asOf, 없으면 FRED 최신 관측일)보다 너무 오래된 값은 버리고 대용 지표에 맡긴다
  const ism = pickIsm(opts.ism, opts.asOf, opts.ismReleaseLagDays ?? MACRO_PARAMS.ismReleaseLagDays);
  const ref = opts.asOf ?? s.asOf;
  if (ism && (!ref || ismIsFresh(ism.date, ref))) {
    s.ism = ism;
    if (!s.asOf || ism.date > s.asOf) s.asOf = ism.date;
  }
  return s;
}

const sign = (x: number) => (x > 0 ? "+" : "");
const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/** 원화 약세 신호는 한국 시장에만 의미가 있다(region이 US면 뺀다) */
const krwApplies = (region?: Region) => region !== "US";

const ISM_RULE = "2.3 강영현·강동진";
const KR_SEMI_TEXT = "책에서는 ISM 지표가 나쁠 때 국내 반도체 대형주 흐름도 약했다고 봤어요. 반도체 대형주 비중을 살펴보세요";

/** 제조업 수축 신호: ISM이 있으면 ISM < 50, 없으면 대용 지표 두 개가 모두 0 아래 */
function manufacturingContracting(s: MacroSnapshot): boolean {
  const P = MACRO_PARAMS;
  if (s.ism) return s.ism.value < P.ismLine;
  const p = s.ismProxy;
  return !!p?.philly && !!p.empire && p.philly.value < P.ismProxyLine && p.empire.value < P.ismProxyLine;
}

/** ISM 노트. ISM이 없으면 지역 연준 대용 지표로 대신하고 그렇다고 밝힌다 */
function ismNotes(s: MacroSnapshot, region?: Region): Note[] {
  const P = MACRO_PARAMS;
  const out: Note[] = [];
  if (s.ism) {
    const v = s.ism.value;
    const head = `ISM 제조업지수 ${v.toFixed(1)}(${s.ism.month}${s.ism.source === "수동" ? ", 수동 입력" : ""})`;
    out.push(
      v < P.ismLine
        ? { tone: "warn", text: `${head}: ${P.ismLine} 아래라 미국 제조업 경기가 수축 중이에요`, rule: ISM_RULE }
        : { tone: "info", text: `${head}: ${P.ismLine} 이상이라 미국 제조업 경기가 확장 중이에요`, rule: ISM_RULE },
    );
  } else if (s.ismProxy) {
    const { philly, empire } = s.ismProxy;
    const fmt = (name: string, x: MacroValue) => `${name} ${sign(x.value)}${x.value.toFixed(1)}(${x.date.slice(0, 7)})`;
    const detail = [philly && fmt("필라델피아", philly), empire && fmt("뉴욕", empire)].filter(Boolean).join(" · ");
    const below = (x: MacroValue) => x.value < P.ismProxyLine;
    if (!philly || !empire) out.push({ tone: "info", text: `지역 연준 제조업 지수(ISM 대용): ${detail}. 하나만 있어 판단은 보류해요`, rule: ISM_RULE });
    else if (below(philly) && below(empire)) out.push({ tone: "warn", text: `지역 연준 제조업 지수 수축(ISM 대용): ${detail}. 둘 다 0 아래예요`, rule: ISM_RULE });
    else if (!below(philly) && !below(empire)) out.push({ tone: "info", text: `지역 연준 제조업 지수 확장(ISM 대용): ${detail}. 둘 다 0 이상이에요`, rule: ISM_RULE });
    else out.push({ tone: "info", text: `지역 연준 제조업 지수(ISM 대용): ${detail}. 방향이 엇갈려요`, rule: ISM_RULE });
  }
  if (region === "KR" && manufacturingContracting(s)) out.push({ tone: "info", text: s.ism ? KR_SEMI_TEXT : `ISM 대용 지표 기준이에요. ${KR_SEMI_TEXT}`, rule: ISM_RULE });
  return out;
}

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
    const ch = s.us10yChange6m != null ? `(약 6개월 ${sign(s.us10yChange6m)}${s.us10yChange6m.toFixed(2)}%p)` : "";
    notes.push({ tone: "info", text: `미 10년물 금리 ${s.us10y.value.toFixed(2)}%${ch}: 금리가 높을수록 같은 지수도 비싸게 평가돼요`, rule: "2.3 강영현" });
  }
  if (s.rateRising && s.us10yChange6m != null) {
    notes.push({
      tone: "info",
      text: `금리 상승기: 같은 지수 레벨도 비싸게 평가돼요. 미 10년물 금리가 ${P.rateLookback}개 관측치(약 6개월) 동안 ${sign(s.us10yChange6m)}${s.us10yChange6m.toFixed(2)}%p 올랐어요`,
      rule: "2.3 강영현",
    });
  }

  notes.push(...ismNotes(s, region));
  return notes;
}

/**
 * 국면 점수 감점용 부정 신호 개수(금리차 역전, 초과 유동성 마이너스, VIX 경계 이상, 원화 급약세,
 * ISM 50 아래 — ISM이 없으면 지역 연준 대용 지표 두 개가 모두 0 아래일 때)
 */
export function macroPressure(s: MacroSnapshot, region?: Region): number {
  const P = MACRO_PARAMS;
  let n = 0;
  if (s.yieldSpread && s.yieldSpread.value < P.yieldSpreadInverted) n++;
  if (s.excessLiquidity != null && s.excessLiquidity < P.excessLiquidityNegative) n++;
  if (s.vix && s.vix.value >= P.vixHigh) n++;
  if (krwApplies(region) && s.krwChange20dPct != null && s.krwChange20dPct >= P.krwWeakPct) n++;
  if (manufacturingContracting(s)) n++;
  return n;
}
