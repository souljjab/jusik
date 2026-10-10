// 새로 추가된 매크로 타입·상수라 상대 경로로 가져온다(통합 때 "@jusik/shared"로 바꾼다)
import { MACRO_RELEASE_LAG_DAYS, type IsmReading, type MacroSeriesId, type MacroSeriesPoint } from "../../shared/src/macro";
import type { Http } from "./http";

/*
 * ISM 제조업 PMI(자료집 2.3 매크로 지표, 강영현·강동진: 매월 초 발표, 확장·수축 판단).
 * ISM 자료는 라이선스 문제로 FRED에서 빠져 ISM 사이트의 최신 보고서 페이지를 읽는다.
 * 페이지 문구("Manufacturing PMI® at 48.7%", "registered 48.7 percent in September",
 * "September 2024 Manufacturing ISM® Report On Business®")는 알려진 형식을 기준으로 짰고,
 * 이 개발 환경에서는 외부 접속이 막혀 실제 응답과 대조하지 못했다(미검증). 처음 연결할 때 꼭 실제 페이지로 확인하세요.
 */

/** 최신 제조업 보고서 페이지(주소와 페이지 형식은 실제 응답과 대조하지 못함(미검증)) */
export const ISM_URL = "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/pmi/";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] as const;
const MONTH_ALT = MONTHS.join("|");

/** 달별 보고서 페이지(예: …/pmi/september/). 주소 형식은 실제와 대조하지 못함(미검증). 올바른 YYYY-MM이 아니면 null */
export function ismMonthUrl(month: string): string | null {
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.exec(month);
  return m ? `${ISM_URL}${MONTHS[Number(m[1]) - 1]}/` : null;
}

export const ISM_PARAMS = {
  /** 이 범위 밖의 값은 잘못 읽은 것으로 보고 버린다(앱 기본값. 실제 역대 범위는 대략 29~77) */
  minValue: 20,
  maxValue: 80,
  /** 성공한 값을 다시 읽기까지(ms, 앱 기본값. 한 달에 한 번 나오는 지표라 길게 둔다) */
  ttlMs: 6 * 3_600_000,
  /** 실패했을 때 다시 시도하기까지(ms, 앱 기본값) */
  failTtlMs: 30 * 60_000,
} as const;

/** 사이트에서 읽은 ISM 값 */
export type IsmScraped = IsmReading & { source: "ISM" };

/** HTML → 비교하기 쉬운 평문. ®·(R) 표시와 태그를 지운다 */
function plain(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&reg;|&#0*174;|&#x0*ae;|®|\(R\)/gi, "")
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, " ")
    .replace(/&#0*37;|&percnt;/gi, "%")
    .replace(/&amp;/gi, "&")
    .replace(/&ndash;|&mdash;|&#821[12];/gi, "-")
    .replace(/\s+/g, " ");
}

const monthNo = (name: string) => MONTHS.indexOf(name.toLowerCase() as (typeof MONTHS)[number]) + 1;
const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// "Manufacturing PMI at 48.7%; September 2024 Manufacturing ISM Report On Business" — 값과 달이 한 줄에
const HEADLINE = new RegExp(
  `(?<!non[-\\s]?)\\bManufacturing PMI\\s*(?:at|:)?\\s*(\\d{2}(?:\\.\\d{1,2})?)\\s*(?:%|percent\\b)\\s*[;:,.|-]?\\s*(${MONTH_ALT})\\s+(\\d{4})\\s+(?:ISM\\s+)?Manufacturing\\s+(?:ISM\\s+)?Report\\s+On\\s+Business`,
  "i",
);
// "September 2024 Manufacturing ISM Report On Business" / "Manufacturing ISM Report On Business - September 2024"
const TITLE = new RegExp(
  `\\b(${MONTH_ALT})\\s+(\\d{4})\\s+(?:ISM\\s+)?Manufacturing\\s+(?:ISM\\s+)?Report\\s+On\\s+Business` +
    `|Manufacturing\\s+(?:ISM\\s+)?Report\\s+On\\s+Business\\s*[-:|,]?\\s*(${MONTH_ALT})\\s+(\\d{4})\\b`,
  "gi",
);
// "The September Manufacturing PMI registered 47.2 percent", "Manufacturing PMI registered 48.7 percent in September"
// 이름과 값 사이에는 숫자·마침표·세미콜론 없는 짧은 문구만 허용한다("fell 0.5 percentage point to …" 같은 문장은 건너뜀)
const SENTENCE = new RegExp(
  `(?:\\b(${MONTH_ALT})\\s+)?(?<!non[-\\s]?)\\bManufacturing PMI\\b([^0-9.;%]{0,40}?)(\\d{2}(?:\\.\\d{1,2})?)\\s*(?:%|percent\\b)(?:\\s+(?:in|for)\\s+(${MONTH_ALT})\\b)?`,
  "gi",
);
// 발표일 후보 "October 1, 2024"
const LONG_DATE = new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2}),\\s*(\\d{4})\\b`, "gi");

const inRange = (v: number) => Number.isFinite(v) && v >= ISM_PARAMS.minValue && v <= ISM_PARAMS.maxValue;

/**
 * 연도가 없는 달 이름(문장 속 "in September")의 연도를 페이지 안에서 찾는다.
 * 같은 달 이름 + 연도, 또는 그다음 달의 날짜(발표일)에서 고르고, 여럿이면 가장 늦은 해(과거 비교 문구보다 최신 보고서가 늦다)
 */
function yearFor(text: string, month: number): number | null {
  const years: number[] = [];
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{4})\\b`, "gi"))) if (monthNo(m[1]!) === month) years.push(Number(m[2]));
  for (const m of text.matchAll(LONG_DATE)) {
    const rel = monthNo(m[1]!);
    if (rel === (month % 12) + 1) years.push(Number(m[3]) - (month === 12 ? 1 : 0));
  }
  return years.length ? Math.max(...years) : null;
}

/**
 * ISM 제조업 보고서 페이지 → { value, month: "YYYY-MM" }. 실제 응답과 대조하지 못함(미검증).
 * 값이 20~80 밖이거나 어느 달 값인지 확실하지 않으면 null(틀린 값보다 빈 값).
 */
export function parseIsmPmi(html: string): { value: number; month: string } | null {
  if (!html) return null;
  const t = plain(html);

  // 1) 제목 한 줄에 값과 달이 같이 있는 형식
  const h = HEADLINE.exec(t);
  if (h) {
    const value = Number(h[1]);
    return inRange(value) ? { value, month: ym(Number(h[3]), monthNo(h[2]!)) } : null;
  }

  // 2) 보고서 제목의 달 + 본문 문장의 값
  const titles = [...t.matchAll(TITLE)].map((m) => ({ at: m.index ?? 0, month: ym(Number(m[2] ?? m[4]), monthNo((m[1] ?? m[3])!)) }));
  for (const m of t.matchAll(SENTENCE)) {
    const at = m.index ?? 0;
    const value = Number(m[3]);
    const namedRaw = m[1] ?? new RegExp(`\\b(${MONTH_ALT})\\b`, "i").exec(m[2] ?? "")?.[1] ?? m[4];
    const named = namedRaw ? monthNo(namedRaw) : null;
    // 문장 바로 앞의 제목(없으면 바로 뒤)을 그 문장의 보고서로 본다
    const before = titles.filter((x) => x.at <= at).at(-1);
    const title = before ?? titles.find((x) => x.at > at);
    if (title) {
      if (named && named !== Number(title.month.slice(5))) continue; // 다른 달(전월 비교 등) 이야기
      return inRange(value) ? { value, month: title.month } : null;
    }
    if (named) {
      const year = yearFor(t, named);
      if (year == null) return null;
      return inRange(value) ? { value, month: ym(year, named) } : null;
    }
    return null; // 어느 달 값인지 모름
  }
  return null;
}

/** 미국 영업일인지. 매월 초에 걸리는 공휴일(새해 첫날과 대체 휴일, 9월 노동절)만 본다 */
function usBusinessDay(t: Date): boolean {
  const dow = t.getUTCDay(), mo = t.getUTCMonth(), d = t.getUTCDate();
  if (dow === 0 || dow === 6) return false;
  if (mo === 0 && (d === 1 || (d === 2 && dow === 1))) return false; // 1월 1일, 일요일이면 2일(월) 대체
  if (mo === 8 && dow === 1 && d <= 7) return false; // 9월 첫째 월요일 노동절
  return true;
}

/**
 * month(YYYY-MM) PMI의 대략적 발표일(YYYY-MM-DD) = 다음 달 첫 미국 영업일.
 * 1월(12월분)은 새해 연휴 뒤 둘째 영업일에 나온 해가 많아 보수적으로(늦게) 둘째 영업일로 잡는다.
 * ISM 공식 일정과 대조하지 못한 추정치다. 형식이 틀리면 null
 */
export function ismReleaseDate(month: string): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]); // mo는 1~12, 다음 달의 0-기준 월 = mo % 12
  const ny = mo === 12 ? y + 1 : y, nm = mo % 12;
  let need = nm === 0 ? 2 : 1;
  for (let d = 1; d <= 10; d++) {
    const t = new Date(Date.UTC(ny, nm, d));
    if (usBusinessDay(t) && --need === 0) return t.toISOString().slice(0, 10);
  }
  return null;
}

/** YYYY-MM에서 n개월 이동 */
export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1 + n;
  return ym(y + Math.floor(m / 12), (((m % 12) + 12) % 12) + 1);
}

/** today(YYYY-MM-DD)까지 발표됐을 가장 최근 PMI의 달 */
export function latestReleasedIsmMonth(today: string): string {
  const prev = shiftMonth(today.slice(0, 7), -1);
  const rel = ismReleaseDate(prev);
  return rel && rel <= today ? prev : shiftMonth(prev, -1);
}

/**
 * 사이트에서 읽은 달로 발표일을 정한다. 추정 발표일이 오늘보다 늦으면(일정 추정이 하루 어긋난 경우) 오늘로 둔다.
 * 이번 달 이후의 값은 있을 수 없으므로 null
 */
function datedReading(value: number, month: string, today: string): { value: number; month: string; date: string } | null {
  if (month >= today.slice(0, 7)) return null;
  const rel = ismReleaseDate(month);
  if (!rel) return null;
  return { value, month, date: rel > today ? today : rel };
}

/**
 * 수동 입력 ISM을 확인해 IsmReading으로 바꾼다(발표일 = ismReleaseDate(month), 오늘보다 늦으면 오늘).
 * today는 YYYY-MM-DD. 형식·범위가 틀리거나 아직 끝나지 않은 달이면 error
 */
export function manualIsm(input: { value: number; month: string }, today: string): { reading: IsmReading } | { error: string } {
  const value = Number(input?.value);
  const month = String(input?.month ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: `달은 YYYY-MM 형식으로 넣어 주세요(받은 값: ${month || "없음"})` };
  if (!inRange(value)) return { error: `PMI 값은 ${ISM_PARAMS.minValue}~${ISM_PARAMS.maxValue} 사이여야 해요(받은 값: ${input?.value})` };
  const r = datedReading(value, month, today);
  if (!r) return { error: `${month}은(는) 아직 발표되지 않은 달이에요` };
  return { reading: { ...r, source: "수동" } };
}

export interface IsmSourceOptions {
  /** 성공한 값의 캐시 시간(ms). 기본 ISM_PARAMS.ttlMs */
  ttlMs?: number;
  /** 실패했을 때 다시 시도하기까지(ms). 기본 ISM_PARAMS.failTtlMs */
  failTtlMs?: number;
  /** 테스트용 시계 */
  now?: () => number;
}

/**
 * ISM 최신 제조업 PMI. 최신 보고서 페이지를 읽고, 실패하거나 기대한 달보다 오래된 값이면 그 달의 달별 페이지를 한 번 더 본다.
 * 오류는 던지지 않고 lastError에 남기며, 전에 받은 값이 있으면 그 값을 돌려준다(오래된 값은 buildMacroSnapshot이 거른다).
 */
export class IsmSource {
  readonly sample = false;
  /** 마지막 시도가 실패했으면 그 이유, 성공했으면 null */
  lastError: string | null = null;
  private cached: { at: number; ttl: number; value: Promise<IsmScraped | null> } | null = null;
  private lastGood: IsmScraped | null = null;
  private readonly now: () => number;

  constructor(private http: Http, private opts: IsmSourceOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  getLatest(): Promise<IsmScraped | null> {
    const c = this.cached;
    if (c && this.now() - c.at < c.ttl) return c.value;
    // 결과가 나오기 전에는 진행 중인 요청을 함께 쓴다
    const value = this.load().catch((e: unknown) => {
      this.lastError = e instanceof Error ? e.message : String(e);
      return this.lastGood;
    });
    const entry = { at: this.now(), ttl: Infinity, value };
    this.cached = entry;
    void value.then(() => (entry.ttl = this.lastError ? (this.opts.failTtlMs ?? ISM_PARAMS.failTtlMs) : (this.opts.ttlMs ?? ISM_PARAMS.ttlMs)));
    return value;
  }

  private async load(): Promise<IsmScraped | null> {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const expected = latestReleasedIsmMonth(today);
    const why: string[] = [];
    const read = async (url: string, label: string): Promise<IsmScraped | null> => {
      try {
        const p = parseIsmPmi(await this.http.get(url));
        if (!p) {
          why.push(`${label}에서 PMI 값을 찾지 못했어요(형식이 바뀌었을 수 있어요)`);
          return null;
        }
        const r = datedReading(p.value, p.month, today);
        if (!r) {
          why.push(`${label}에서 아직 끝나지 않은 달(${p.month})이 읽혔어요`);
          return null;
        }
        return { ...r, source: "ISM" };
      } catch (e) {
        why.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    };

    let best = await read(ISM_URL, "최신 보고서");
    if (!best || best.month < expected) {
      // 달별 페이지 주소에는 연도가 없어 작년 보고서가 남아 있을 수 있다 → 요청한 달과 같을 때만 쓴다
      const url = ismMonthUrl(expected);
      const alt = url ? await read(url, `${expected} 보고서`) : null;
      if (alt && alt.month === expected) best = alt;
      else if (alt) why.push(`${expected} 보고서 페이지에 ${alt.month} 값이 있었어요(아직 갱신 전일 수 있어요)`);
    }
    if (best) {
      // 사이트가 잠깐 이전 달 페이지를 보여 줘도 이미 아는 더 새 값을 돌려준다
      if (!this.lastGood || best.month >= this.lastGood.month) this.lastGood = best;
      this.lastError = null;
      return this.lastGood;
    }
    this.lastError = why.join(" / ") || "ISM 페이지를 읽지 못했어요";
    return this.lastGood;
  }
}

/* ───────── 샘플 모드(PROVIDER=mock) 전용: 진짜 ISM·지역 연준 지수가 아닌 지어낸 값 ───────── */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 샘플 ISM 값(44.0~56.0). 달 문자열 해시로 정해져 늘 같은 값이 나온다 */
export function sampleIsmValue(month: string): number {
  return Math.round((44 + (hash(`ism:${month}`) % 1201) / 100) * 10) / 10;
}

/** 샘플 모드용 가짜 ISM 공급자(진짜 지표 아님). 오늘까지 발표됐을 달의 샘플 값을 돌려준다 */
export class MockIsmSource {
  readonly sample = true;
  readonly lastError: string | null = null;
  constructor(private now: () => number = Date.now) {}

  async getLatest(): Promise<IsmScraped> {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const month = latestReleasedIsmMonth(today);
    return { value: sampleIsmValue(month), month, date: ismReleaseDate(month)!, source: "ISM" };
  }
}

const PROXY_IDS = ["GACDFSA066MSFRBPHI", "GACDINA066MSFRBNY"] as const satisfies readonly MacroSeriesId[];

/**
 * 샘플 모드용 가짜 지역 연준 제조업 지수 두 개(진짜 지표 아님). MockMacro의 시계열에 합쳐 쓰라고 둔 것.
 * 샘플 ISM과 같은 방향으로 움직이게 만들고, 오늘 기준 공표 지연이 지난 달만 넣는다
 */
export function sampleIsmProxySeries(now: number = Date.now(), months = 30): Partial<Record<MacroSeriesId, MacroSeriesPoint[]>> {
  const today = new Date(now).toISOString().slice(0, 10);
  const out: Partial<Record<MacroSeriesId, MacroSeriesPoint[]>> = {};
  for (const id of PROXY_IDS) {
    const pts: MacroSeriesPoint[] = [];
    for (let k = months; k >= 0; k--) {
      const month = shiftMonth(today.slice(0, 7), -k);
      const date = `${month}-01`;
      if (Date.parse(date) + MACRO_RELEASE_LAG_DAYS[id] * 86_400_000 > Date.parse(today)) continue;
      const noise = (hash(`${id}:${month}`) % 1201) / 100 - 6;
      pts.push({ date, value: Math.round(((sampleIsmValue(month) - 50) * 2.5 + noise) * 10) / 10 });
    }
    out[id] = pts;
  }
  return out;
}
