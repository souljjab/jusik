import type { Disclosure, PeriodFinancials } from "@jusik/shared";
import { classifySecFiling, normalizeSecItems } from "@jusik/shared";
import type { Http } from "./http";

/*
 * 미국 SEC EDGAR — 티커→CIK, 공시 목록(submissions), XBRL 재무 사실(companyfacts).
 * 국내 DART(공시·사업보고서 주요계정)에 대응하는 미국 쪽 원천이다. 인증키는 없지만 SEC는 연락처가 들어간
 * User-Agent를 요구하므로 생성자에서 받는다(호출하는 쪽이 SEC_USER_AGENT 환경 변수에서 읽어 넘긴다).
 *
 * 응답 형식(company_tickers.json의 {"0":{cik_str,ticker,title}}, submissions의 filings.recent 열 배열,
 * companyfacts의 facts.us-gaap.<태그>.units)은 SEC 문서에 적힌 형식을 기준으로 짰다.
 * 이 개발 환경에서는 외부 접속이 막혀 실제 응답과 대조하지 못했다(미검증). 운영 전에 실제 응답으로 확인하세요.
 * 형식을 알아보지 못하면 틀린 값 대신 빈 결과를 돌려준다.
 */

const DAY = 86_400_000;

/** SEC 관련 기준값 */
export const SEC_PARAMS = {
  /** 티커→CIK 목록 캐시(앱 기본값 7일. 상장·티커 변경이 드물다) */
  tickersTtlMs: 7 * DAY,
  /** 공시 목록·재무 사실 캐시 기본값(앱 기본값 3시간) */
  ttlMs: 3 * 3_600_000,
  /** 공시 목록 기본 조회 기간(일, 앱 기본값) */
  filingDays: 90,
  /** 연간으로 볼 기간 길이(일). 52/53주 회계연도(364·371일)를 포함(앱 기본값) */
  annualDays: [350, 380] as const,
  /** 분기로 볼 기간 길이(일). 13/14주 분기(91·98일)를 포함(앱 기본값) */
  quarterDays: [80, 100] as const,
  /** 기간 끝이 달의 처음 며칠 안이면 전달 결산으로 본다(52/53주 회계연도: 2025-01-03 → 2024.12, 앱 기본값) */
  monthSnapDays: 7,
  /** 남길 연간 실적 수(최근 5년, 앱 기본값) */
  annualKeep: 5,
  /** 남길 분기 실적 수(최근 12분기, 앱 기본값) */
  quarterKeep: 12,
} as const;

const pad10 = (cik: number) => String(cik).padStart(10, "0");

export const SEC = {
  /** 전체 티커 → CIK 목록 */
  tickers: "https://www.sec.gov/files/company_tickers.json",
  /** 회사별 공시 목록(최근 약 1000건은 filings.recent) */
  submissions: (cik: number) => `https://data.sec.gov/submissions/CIK${pad10(cik)}.json`,
  /** 회사별 XBRL 재무 사실 전체 */
  companyFacts: (cik: number) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${pad10(cik)}.json`,
  /** 공시 원문 주소 */
  document: (cik: number, accession: string, primaryDocument?: string) =>
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${primaryDocument ?? ""}`,
};

const asJson = (input: unknown): any => {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
};

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s));

// ───────────────────────── 티커 → CIK ─────────────────────────

/**
 * company_tickers.json → Map<대문자 티커, { cik, title }>.
 * {"0":{"cik_str":320193,"ticker":"AAPL","title":"Apple Inc."}, …} 형식과
 * company_tickers_exchange.json의 {"fields":["cik","name","ticker",…],"data":[[…]]} 형식을 모두 읽는다(미검증).
 */
export function parseCompanyTickers(input: unknown): Map<string, { cik: number; title: string }> {
  const json = asJson(input);
  const out = new Map<string, { cik: number; title: string }>();
  if (!json || typeof json !== "object") return out;
  const add = (ticker: unknown, cik: unknown, title: unknown) => {
    const t = typeof ticker === "string" ? ticker.trim().toUpperCase() : "";
    const c = Number(cik);
    if (!t || !Number.isInteger(c) || c <= 0 || out.has(t)) return;
    out.set(t, { cik: c, title: typeof title === "string" ? title : t });
  };
  if (Array.isArray(json.fields) && Array.isArray(json.data)) {
    const f: string[] = json.fields;
    const iC = f.indexOf("cik"), iT = f.indexOf("ticker"), iN = f.indexOf("name");
    if (iC < 0 || iT < 0) return out;
    for (const row of json.data) if (Array.isArray(row)) add(row[iT], row[iC], iN >= 0 ? row[iN] : undefined);
    return out;
  }
  for (const v of Object.values(json)) if (v && typeof v === "object") add((v as any).ticker, (v as any).cik_str ?? (v as any).cik, (v as any).title);
  return out;
}

// ───────────────────────── 공시 목록 ─────────────────────────

/**
 * submissions JSON → 공시 목록(최신순). filings.recent의 열 배열(accessionNumber·filingDate·form·items·
 * primaryDocument·primaryDocDescription)을 줄 단위로 묶는다. 제목은 '한국어 유형 · 서식 (Item …) — 설명'.
 * 열 배열이 없거나 길이가 안 맞는 줄은 버린다(미검증).
 */
export function parseSubmissions(input: unknown, cik: number): Disclosure[] {
  const r = asJson(input)?.filings?.recent;
  if (!r || typeof r !== "object") return [];
  const acc: unknown[] = Array.isArray(r.accessionNumber) ? r.accessionNumber : [];
  const dates: unknown[] = Array.isArray(r.filingDate) ? r.filingDate : [];
  const forms: unknown[] = Array.isArray(r.form) ? r.form : [];
  const items: unknown[] = Array.isArray(r.items) ? r.items : [];
  const docs: unknown[] = Array.isArray(r.primaryDocument) ? r.primaryDocument : [];
  const descs: unknown[] = Array.isArray(r.primaryDocDescription) ? r.primaryDocDescription : [];
  const out: Disclosure[] = [];
  for (let i = 0; i < acc.length; i++) {
    const a = acc[i], date = dates[i], form = forms[i];
    if (typeof a !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(a) || !isDate(date) || typeof form !== "string" || !form.trim()) continue;
    const its = normalizeSecItems(typeof items[i] === "string" ? (items[i] as string) : "");
    const c = classifySecFiling(form, its);
    const desc = typeof descs[i] === "string" ? (descs[i] as string).trim() : "";
    const itemText = its.length ? ` (Item ${its.join(", ")})` : "";
    const descText = desc && desc.toUpperCase() !== form.trim().toUpperCase() ? ` — ${desc}` : "";
    const doc = typeof docs[i] === "string" && docs[i] ? (docs[i] as string) : undefined;
    out.push({
      date,
      title: `${c.type} · ${form.trim()}${itemText}${descText}`,
      url: SEC.document(cik, a, doc),
      source: "SEC",
      form: form.trim(),
    });
  }
  // 같은 날짜 안에서는 원래 순서(최신 먼저)를 유지(안정 정렬)
  return out.sort((x, y) => y.date.localeCompare(x.date));
}

// ───────────────────────── 재무 사실 ─────────────────────────

export interface SecPeriodFinancials extends PeriodFinancials {
  /** 4분기를 연간 − (1~3분기)로 계산했으면 true(SEC는 4분기 단독 값을 따로 내지 않는다) */
  derived?: boolean;
}

export interface SecFinancials {
  annual: SecPeriodFinancials[];
  quarterly: SecPeriodFinancials[];
}

type Metric = "revenue" | "opIncome" | "netIncome" | "eps";

/** 항목별 us-gaap 태그(앞쪽이 우선). EPS는 희석 → 기본 순 */
export const SEC_TAGS: Record<Metric, { unit: string; tags: readonly string[] }> = {
  revenue: {
    unit: "USD",
    tags: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
  },
  opIncome: { unit: "USD", tags: ["OperatingIncomeLoss"] },
  netIncome: { unit: "USD", tags: ["NetIncomeLoss"] },
  eps: { unit: "USD/shares", tags: ["EarningsPerShareDiluted", "EarningsPerShareBasic"] },
};

const METRICS = Object.keys(SEC_TAGS) as Metric[];

interface Fact {
  start: string;
  end: string;
  val: number;
  filed: string;
  /** 태그 우선순위(작을수록 앞) */
  rank: number;
}

interface Row {
  start: string;
  end: string;
  filed: string;
  vals: Partial<Record<Metric, number>>;
  derived?: boolean;
}

const days = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / DAY);

/** 기간 라벨 "YYYY.MM". 끝이 달 초 며칠 안이면(52/53주 결산) 전달로 본다 */
export function secPeriodLabel(end: string): string {
  const y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7)), d = Number(end.slice(8, 10));
  if (d <= SEC_PARAMS.monthSnapDays) {
    const pm = m === 1 ? 12 : m - 1;
    return `${m === 1 ? y - 1 : y}.${String(pm).padStart(2, "0")}`;
  }
  return `${y}.${String(m).padStart(2, "0")}`;
}

const toMillions = (v: number) => Math.round(v / 1e4) / 100;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * companyfacts JSON → 연간·분기 실적(오래된 → 최신). 금액은 백만 달러, EPS는 달러(희석, 없으면 기본).
 *  - 기간(start~end)이 있는 사실만 쓴다. 연간 = 약 1년 & 10-K 계열, 분기 = 약 1분기 & 10-Q 계열
 *  - 같은 기간 끝(end)은 가장 먼저 제출된 값(처음 보고된 값)을 남기고 filed = 그 제출일(이후 정정·재작성 값을 미리 보지 않는다)
 *    여러 태그에 같은 기간 값이 있으면 먼저 제출된 쪽, 같은 날이면 태그 우선순위로 고른다
 *  - 한 기간의 filed는 그 기간 항목들의 제출일 중 가장 늦은 날(모든 값이 공개된 뒤에만 보이게)
 *  - 4분기 = 연간 − 1·2·3분기(셋 다 있을 때만, 항목별로). derived: true, filed = 연간 제출일
 * USD 단위가 없거나 형식을 모르면 빈 배열(미검증).
 */
export function parseCompanyFacts(input: unknown): SecFinancials {
  const gaap = asJson(input)?.facts?.["us-gaap"];
  if (!gaap || typeof gaap !== "object") return { annual: [], quarterly: [] };
  const P = SEC_PARAMS;

  // 항목별·종류별로 기간 끝 → 처음 제출된 사실
  const pick: Record<"A" | "Q", Map<string, Partial<Record<Metric, Fact>>>> = { A: new Map(), Q: new Map() };
  for (const m of METRICS) {
    const spec = SEC_TAGS[m];
    spec.tags.forEach((tag, rank) => {
      const list = gaap?.[tag]?.units?.[spec.unit];
      if (!Array.isArray(list)) return;
      for (const x of list) {
        if (!x || !isDate(x.start) || !isDate(x.end) || !isDate(x.filed) || typeof x.val !== "number" || !Number.isFinite(x.val)) continue;
        const form = typeof x.form === "string" ? x.form.toUpperCase() : "";
        const len = days(x.start, x.end);
        const kind = len >= P.annualDays[0] && len <= P.annualDays[1] && /^10-K/.test(form) ? "A" : len >= P.quarterDays[0] && len <= P.quarterDays[1] && /^10-Q/.test(form) ? "Q" : null;
        if (!kind) continue;
        const f: Fact = { start: x.start, end: x.end, val: x.val, filed: x.filed, rank };
        const slot = pick[kind].get(x.end) ?? {};
        const cur = slot[m];
        if (!cur || f.filed < cur.filed || (f.filed === cur.filed && f.rank < cur.rank)) slot[m] = f;
        pick[kind].set(x.end, slot);
      }
    });
  }

  const rows = (kind: "A" | "Q"): Row[] =>
    [...pick[kind].entries()]
      .map(([end, slot]) => {
        const facts = METRICS.map((m) => slot[m]).filter((f): f is Fact => !!f);
        const vals: Partial<Record<Metric, number>> = {};
        for (const m of METRICS) if (slot[m]) vals[m] = slot[m]!.val;
        // 기간 시작은 매출(없으면 첫 항목) 사실 기준
        const start = (slot.revenue ?? facts[0]!).start;
        return { start, end, filed: facts.map((f) => f.filed).sort().at(-1)!, vals };
      })
      .sort((a, b) => a.end.localeCompare(b.end));

  const annualRows = rows("A");
  const quarterRows = rows("Q");

  // 4분기 산출: 연간 기간 안에 끝나는 분기 셋(1~3분기)이 모두 있을 때만
  const q4s: Row[] = [];
  for (const a of annualRows) {
    if (quarterRows.some((q) => q.end === a.end)) continue;
    const inside = quarterRows.filter((q) => q.start >= shiftDate(a.start, -10) && q.end > a.start && days(q.end, a.end) >= 60);
    if (inside.length !== 3) continue;
    const vals: Partial<Record<Metric, number>> = {};
    for (const m of METRICS) {
      const fy = a.vals[m];
      const qs = inside.map((q) => q.vals[m]);
      if (fy == null || qs.some((v) => v == null)) continue;
      vals[m] = fy - qs.reduce<number>((s, v) => s + v!, 0);
    }
    if (!Object.keys(vals).length) continue;
    const last = inside.map((q) => q.end).sort().at(-1)!;
    const filed = [a.filed, ...inside.map((q) => q.filed)].sort().at(-1)!;
    q4s.push({ start: shiftDate(last, 1), end: a.end, filed, vals, derived: true });
  }

  const toPeriod = (r: Row): SecPeriodFinancials => {
    const p: SecPeriodFinancials = { period: secPeriodLabel(r.end), filed: r.filed, estimate: false };
    if (r.vals.revenue != null) p.revenue = toMillions(r.vals.revenue);
    if (r.vals.opIncome != null) p.opIncome = toMillions(r.vals.opIncome);
    if (r.vals.netIncome != null) p.netIncome = toMillions(r.vals.netIncome);
    if (r.vals.eps != null) p.eps = round2(r.vals.eps);
    if (r.derived) p.derived = true;
    return p;
  };

  const quarterly = [...quarterRows, ...q4s].sort((a, b) => a.end.localeCompare(b.end)).map(toPeriod);
  return { annual: annualRows.map(toPeriod).slice(-P.annualKeep), quarterly: quarterly.slice(-P.quarterKeep) };
}

function shiftDate(d: string, n: number): string {
  return new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
}

// ───────────────────────── 클라이언트 ─────────────────────────

/** WebProvider·샘플 모드가 함께 쓰는 SEC 원천 모양 */
export interface SecSource {
  filings(ticker: string, days?: number): Promise<Disclosure[]>;
  financials(ticker: string): Promise<SecFinancials>;
}

export interface SecClientOptions {
  /** SEC가 요구하는 User-Agent(앱 이름과 연락처 이메일, 예: "jusik-personal you@example.com") */
  userAgent: string;
  /** 공시 목록·재무 사실 캐시 기간(ms). 기본 SEC_PARAMS.ttlMs */
  ttlMs?: number;
  /** 현재 시각(ms). 테스트용 */
  now?: () => number;
}

/** SEC EDGAR 클라이언트. 티커 목록은 7일, 공시 목록·재무 사실은 ttlMs 동안 메모리에 둔다(실패한 결과는 두지 않음) */
export class SecClient implements SecSource {
  private readonly ua: string;
  private readonly ttl: number;
  private readonly now: () => number;
  private cache = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();

  constructor(private http: Http, opts: SecClientOptions) {
    const ua = (opts?.userAgent ?? "").trim();
    if (!ua) throw new Error("SEC 접속에는 연락처가 들어간 User-Agent가 필요해요(SEC_USER_AGENT 환경 변수, 예: 앱이름 you@example.com).");
    this.ua = ua;
    this.ttl = opts.ttlMs ?? SEC_PARAMS.ttlMs;
    this.now = opts.now ?? Date.now;
  }

  /** 티커 → CIK. 목록에 없으면 undefined. 'BRK.B'와 'BRK-B'를 같은 종목으로 본다 */
  async cikOf(ticker: string): Promise<number | undefined> {
    const map = await this.cached("tickers", SEC_PARAMS.tickersTtlMs, async () => parseCompanyTickers(await this.get(SEC.tickers)));
    const t = ticker.trim().toUpperCase();
    return (map.get(t) ?? map.get(t.replace(/\./g, "-")) ?? map.get(t.replace(/-/g, ".")))?.cik;
  }

  /** 최근 days일(달력 기준, 오늘 포함) 공시(최신순). 모르는 티커면 [] */
  async filings(ticker: string, days: number = SEC_PARAMS.filingDays): Promise<Disclosure[]> {
    const cik = await this.cikOf(ticker);
    if (cik == null) return [];
    const all = await this.cached(`sub:${cik}`, this.ttl, async () => parseSubmissions(await this.get(SEC.submissions(cik)), cik));
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const from = new Date(Date.parse(today) - days * DAY).toISOString().slice(0, 10);
    return all.filter((d) => d.date >= from && d.date <= today);
  }

  /** 연간·분기 실적(백만 달러). 모르는 티커면 빈 배열 */
  async financials(ticker: string): Promise<SecFinancials> {
    const cik = await this.cikOf(ticker);
    if (cik == null) return { annual: [], quarterly: [] };
    return this.cached(`facts:${cik}`, this.ttl, async () => parseCompanyFacts(await this.get(SEC.companyFacts(cik))));
  }

  private get(url: string): Promise<string> {
    return this.http.get(url, { headers: { "user-agent": this.ua, accept: "application/json" } });
  }

  private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < hit.ttl) return hit.value as Promise<T>;
    const value = load();
    this.cache.set(key, { at: this.now(), ttl, value });
    value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return value;
  }
}
