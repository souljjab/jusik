import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Disclosure, PeriodFinancials } from "@jusik/shared";
import type { Http } from "./http";
import { looksLikeZip, unzipFirst } from "./zip";

/*
 * 금융감독원 DART 오픈API(opendart.fss.or.kr) — 국내 공시 목록·정기보고서·연간 주요 계정.
 * 기초 자료집 7장 데이터 표 '공시 (DART) — 호재성 공시 6종, 정기보고서 시점'과 '국내 공시는 금융감독원 DART 오픈API'(정리자 보충).
 * 인증키(crtfc_key)가 필요하다. 키는 호출하는 쪽(DART_API_KEY 환경 변수)에서 받아 생성자로 넘긴다.
 *
 * 응답 형식(list.json·fnlttSinglAcnt.json의 status/list 필드, corpCode.xml ZIP 안의 <list> 블록)은 OpenDART 개발 가이드에
 * 적힌 형식을 기준으로 짰고, 이 개발 환경에서는 외부 접속이 막혀 실제 응답과 대조하지 못했다(미검증).
 * 처음 연결할 때 꼭 실제 응답으로 확인하세요. 형식을 알아보지 못하면 틀린 값 대신 빈 결과를 돌려준다.
 */

const DAY = 86_400_000;

/** DART 관련 기준값 */
export const DART_PARAMS = {
  /** corpCode 목록 캐시 기간(앱 기본값 7일. 고유번호는 거의 바뀌지 않는다) */
  corpCodeTtlMs: 7 * DAY,
  /** 내려받기 실패로 오래된 목록을 쓸 때 다시 시도하기까지(앱 기본값 1시간) */
  staleRetryMs: 3_600_000,
  /** 목록에 없는 종목을 만났을 때 다시 내려받는 최소 간격(신규 상장 대응, 앱 기본값 1일) */
  missRefreshMs: DAY,
  /** list.json 한 쪽 건수(OpenDART 최대값 100) */
  pageCount: 100,
  /** 공시 목록 최대 쪽 수(앱 기본값) */
  maxPages: 5,
  /** 공시 목록 기본 조회 기간(일, 앱 기본값) */
  disclosureDays: 90,
  /** 공시 목록 메모리 캐시(앱 기본값 10분) */
  listTtlMs: 10 * 60_000,
  /** 연간 주요 계정 메모리 캐시(앱 기본값 12시간) */
  annualTtlMs: 12 * 3_600_000,
  /** 정기보고서 제출 기한(일). 3.6·부록 '정기보고서 기한' 설춘환·강동진: 분기·반기 45일, 사업보고서 90일 이내 */
  reportDeadlineDays: { 사업보고서: 90, 반기보고서: 45, 분기보고서: 45 },
} as const;

/** 보고서 코드(OpenDART reprt_code) */
export const DART_REPORT_CODES = { 사업보고서: "11011", 반기보고서: "11012", "1분기보고서": "11013", "3분기보고서": "11014" } as const;

const API = "https://opendart.fss.or.kr/api";
const q = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

export const DART = {
  /** 전체 회사 고유번호 목록(ZIP 안에 CORPCODE.xml) */
  corpCode: (key: string) => `${API}/corpCode.xml?${q({ crtfc_key: key })}`,
  /** 공시 검색. 날짜는 YYYYMMDD, page_count 최대 100 */
  list: (key: string, o: { corpCode: string; bgnDe: string; endDe: string; pageNo?: number; pageCount?: number }) =>
    `${API}/list.json?${q({ crtfc_key: key, corp_code: o.corpCode, bgn_de: o.bgnDe, end_de: o.endDe, page_no: o.pageNo ?? 1, page_count: o.pageCount ?? DART_PARAMS.pageCount })}`,
  /** 단일회사 주요계정. 기본 사업보고서(11011) */
  singleAcnt: (key: string, o: { corpCode: string; year: number | string; reprtCode?: string }) =>
    `${API}/fnlttSinglAcnt.json?${q({ crtfc_key: key, corp_code: o.corpCode, bsns_year: o.year, reprt_code: o.reprtCode ?? DART_REPORT_CODES.사업보고서 })}`,
  /** 공시 원문 보기 */
  viewer: (rceptNo: string) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}`,
};

// ───────────────────────── 상태 코드 ─────────────────────────

/** OpenDART status → 안내 문구 */
export const DART_STATUS_MESSAGES: Record<string, string> = {
  "000": "정상이에요",
  "010": "등록되지 않은 키예요. DART_API_KEY를 확인해 주세요",
  "011": "사용할 수 없는 키예요(일시 중지된 키일 수 있어요)",
  "012": "접근할 수 없는 IP예요. OpenDART에 등록한 IP에서만 쓸 수 있어요",
  "013": "조회된 데이터가 없어요",
  "014": "파일이 존재하지 않아요",
  "020": "요청 제한을 초과했어요(하루 약 2만 건). 내일 다시 시도해 주세요",
  "021": "조회 가능한 회사 수를 초과했어요",
  "100": "필드 값이 잘못됐어요",
  "101": "부적절한 접근이에요",
  "800": "시스템 점검 중이에요. 잠시 뒤 다시 시도해 주세요",
  "900": "정의되지 않은 오류예요",
  "901": "개인정보 보유기간이 끝난 키예요. 키를 새로 발급받아 주세요",
};

export class DartError extends Error {
  /** status: OpenDART 상태 코드, 또는 응답을 해석하지 못하면 "parse" */
  constructor(readonly status: string, message: string) {
    super(message);
  }
}

const dartError = (status: string, apiMessage?: unknown) =>
  new DartError(status, `DART ${status}: ${DART_STATUS_MESSAGES[status] ?? (typeof apiMessage === "string" && apiMessage.trim() ? apiMessage.trim() : "알 수 없는 오류예요")}`);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

function asObj(json: unknown): Obj | null {
  if (typeof json === "string") {
    try {
      json = JSON.parse(json);
    } catch {
      return null;
    }
  }
  return isObj(json) ? json : null;
}

/** 000 → "ok", 013(데이터 없음) → "empty", status가 없으면 "unknown", 그 밖의 코드는 DartError */
export function checkDartStatus(o: Obj): "ok" | "empty" | "unknown" {
  const s = typeof o.status === "string" ? o.status.trim() : typeof o.status === "number" ? String(o.status).padStart(3, "0") : null;
  if (s == null) return "unknown";
  if (s === "000") return "ok";
  if (s === "013") return "empty";
  throw dartError(s, o.message);
}

/** XML 오류 응답(<result><status>010</status><message>…</message></result>) → 상태. 아니면 null */
export function parseDartXmlStatus(xml: string): { status: string; message: string } | null {
  const status = /<status>\s*(\d{3})\s*<\/status>/.exec(xml)?.[1];
  if (!status) return null;
  return { status, message: xmlText(/<message>([\s\S]*?)<\/message>/.exec(xml)?.[1] ?? "") };
}

// ───────────────────────── 고유번호(corpCode.xml) ─────────────────────────

export interface CorpInfo {
  /** DART 고유번호 8자리 */
  corpCode: string;
  name: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function xmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

const TAG_RE = new Map<string, [RegExp, RegExp]>();
/** 블록 안 태그 글자. 빈 태그(<x/>)는 "", 없으면 undefined */
const tagOf = (block: string, name: string) => {
  let re = TAG_RE.get(name);
  if (!re) TAG_RE.set(name, (re = [new RegExp(`<${name}>([\\s\\S]*?)</${name}>`), new RegExp(`<${name}\\s*/>`)]));
  const m = re[0].exec(block);
  if (m) return xmlText(m[1] ?? "");
  return re[1].test(block) ? "" : undefined;
};

/**
 * CORPCODE.xml → 종목 코드(6자리 숫자) → { 고유번호, 회사명 }. 비상장사(stock_code 빈칸)는 뺀다.
 * 같은 종목 코드가 겹치면 modify_date가 최신인 쪽. 형식을 알아보지 못하면 빈 Map. 실제 응답과 대조하지 못함(미검증).
 */
export function parseCorpCodeXml(xml: string): Map<string, CorpInfo> {
  const out = new Map<string, CorpInfo & { modified: string }>();
  for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const block = m[1] ?? "";
    const stock = tagOf(block, "stock_code") ?? "";
    const corpCode = tagOf(block, "corp_code") ?? "";
    const name = tagOf(block, "corp_name") ?? "";
    if (!/^\d{6}$/.test(stock) || !/^\d{8}$/.test(corpCode) || !name) continue;
    const modified = tagOf(block, "modify_date") ?? "";
    const prev = out.get(stock);
    if (!prev || modified > prev.modified) out.set(stock, { corpCode, name, modified });
  }
  return new Map([...out].map(([k, v]) => [k, { corpCode: v.corpCode, name: v.name }]));
}

// ───────────────────────── 공시 목록(list.json) ─────────────────────────

const ymd = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const validYmd = (s: string) => /^\d{8}$/.test(s) && !Number.isNaN(Date.parse(ymd(s))) && new Date(ymd(s)).toISOString().slice(0, 10) === ymd(s);

/** 앞의 [기재정정] 같은 꼬리표를 떼고 공백을 지운 보고서명 */
const bareName = (s: string) => s.replace(/\s+/g, "").replace(/^(\[[^\]]*\])+/, "");

/**
 * 보고서명(·비고)으로 보고서 구분을 짐작한다. 모르면 undefined.
 * rm(비고)의 유·코·넥은 한국거래소 소관 공시, 공은 공정위 신고 공시라는 뜻이다(OpenDART 가이드, 미검증).
 */
export function dartReportKind(reportName: string, rm = ""): string | undefined {
  const n = bareName(reportName);
  const periodic = /^(사업|반기|분기)보고서/.exec(n)?.[0];
  if (periodic) return periodic;
  if (n.startsWith("주요사항보고서")) return "주요사항보고서";
  if (/대량보유상황보고서/.test(n)) return "대량보유상황보고서";
  if (/특정증권등소유상황보고서/.test(n)) return "소유상황보고서";
  if (/^(연결)?감사보고서/.test(n)) return "감사보고서";
  if (n.startsWith("증권신고서")) return "증권신고서";
  if (n.startsWith("투자설명서")) return "투자설명서";
  if (/증권발행실적보고서/.test(n)) return "증권발행실적보고서";
  if (/[유코넥]/.test(rm)) return "거래소공시";
  if (rm.includes("공")) return "공정위공시";
  return undefined;
}

/** list.json의 한 쪽 → 공시와 전체 쪽 수. 데이터 없음(013)은 빈 목록, 형식 불명은 recognized=false */
function listPage(json: unknown): { items: (Disclosure & { rceptNo: string })[]; totalPage: number; recognized: boolean } {
  const o = asObj(json);
  if (!o) return { items: [], totalPage: 0, recognized: false };
  const s = checkDartStatus(o);
  if (s === "empty") return { items: [], totalPage: 0, recognized: true };
  if (s !== "ok" || !Array.isArray(o.list)) return { items: [], totalPage: 0, recognized: false };
  const items: (Disclosure & { rceptNo: string })[] = [];
  for (const r of o.list) {
    if (!isObj(r)) continue;
    const dt = typeof r.rcept_dt === "string" ? r.rcept_dt.trim() : "";
    const name = typeof r.report_nm === "string" ? r.report_nm.replace(/\s+/g, " ").trim() : "";
    const no = typeof r.rcept_no === "string" ? r.rcept_no.trim() : "";
    const rm = typeof r.rm === "string" ? r.rm : "";
    if (!validYmd(dt) || !name) continue;
    const form = dartReportKind(name, rm);
    items.push({
      date: ymd(dt),
      // 비고 '철'은 철회(간주)된 보고서다. 제목에 남겨 공시 분류가 되돌림(철회)으로 보게 한다
      title: rm.includes("철") ? `${name} (철회)` : name,
      ...(/^\d{14}$/.test(no) ? { url: DART.viewer(no) } : {}),
      source: "DART",
      ...(form ? { form } : {}),
      rceptNo: no,
    });
  }
  const tp = Number(o.total_page);
  return { items, totalPage: Number.isFinite(tp) && tp > 0 ? Math.floor(tp) : 1, recognized: true };
}

const newestFirst = <T extends Disclosure & { rceptNo?: string }>(a: T, b: T) =>
  b.date.localeCompare(a.date) || (b.rceptNo ?? "").localeCompare(a.rceptNo ?? "");

/**
 * list.json 응답(문자열 또는 파싱된 객체) → 공시(최신순). status 000은 정상, 013(데이터 없음)은 [],
 * 그 밖의 status는 DartError. 형식을 알아보지 못하면 []. 실제 응답과 대조하지 못함(미검증).
 */
export function parseDartList(json: unknown): Disclosure[] {
  return listPage(json)
    .items.sort(newestFirst)
    .map(({ rceptNo: _r, ...d }) => d);
}

// ───────────────────────── 정기보고서 시점 ─────────────────────────

export type PeriodicKind = "사업보고서" | "반기보고서" | "분기보고서";

export interface PeriodicReport {
  /** 결산 기간 "YYYY.MM" */
  period: string;
  kind: PeriodicKind;
  /** 제출일 YYYY-MM-DD */
  filed: string;
  /** 제출 기한(기간 말일 + 45·90일, 3.6 설춘환·강동진). 주말이면 다음 월요일, 공휴일은 반영하지 못한다 */
  deadline: string;
  /** 기한을 넘겨 제출했는지 */
  late: boolean;
  /** 원본 없이 정정·첨부 보고서만 있었을 때 true(제출일이 원본보다 늦을 수 있다) */
  amended?: true;
}

/** "YYYY.MM" 기간의 말일 */
function periodEnd(period: string): string | null {
  const m = /^(\d{4})\.(\d{2})$/.exec(period);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);

/** 기한이 토·일요일이면 다음 월요일로 민다(공휴일은 모른다) */
function rollWeekend(date: string): string {
  const dow = new Date(date).getUTCDay();
  return dow === 6 ? addDays(date, 2) : dow === 0 ? addDays(date, 1) : date;
}

/**
 * 공시 목록 제목('사업보고서 (2023.12)', '[기재정정]반기보고서 (2024.06)' 등)에서 정기보고서 제출 시점을 뽑는다(3.6 '정기보고서 시점').
 * 같은 기간·종류는 원본(꼬리표 없음)의 가장 이른 제출일을 쓴다. 철회된 보고서는 뺀다. 기간 오름차순.
 */
export function periodicReports(list: Disclosure[]): PeriodicReport[] {
  const best = new Map<string, PeriodicReport>();
  for (const d of list) {
    const t = d.title.replace(/\s+/g, "");
    const m = /^((?:\[[^\]]*\])*)(사업|반기|분기)보고서\((\d{4}\.\d{2})\)/.exec(t);
    if (!m || /철회/.test(t) || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
    const kind = `${m[2]}보고서` as PeriodicKind;
    const period = m[3]!;
    const end = periodEnd(period);
    if (!end) continue;
    const deadline = rollWeekend(addDays(end, DART_PARAMS.reportDeadlineDays[kind]));
    const r: PeriodicReport = { period, kind, filed: d.date, deadline, late: d.date > deadline, ...(m[1] ? { amended: true as const } : {}) };
    const key = `${kind}|${period}`;
    const prev = best.get(key);
    const better = !prev || (prev.amended && !r.amended) || (!!prev.amended === !!r.amended && r.filed < prev.filed);
    if (better) best.set(key, r);
  }
  const order: Record<PeriodicKind, number> = { 분기보고서: 0, 반기보고서: 1, 사업보고서: 2 };
  return [...best.values()].sort((a, b) => a.period.localeCompare(b.period) || order[a.kind] - order[b.kind]);
}

/**
 * 연간 실적 중 제출일이 없는 기간을 사업보고서 제출일로 채운다(원본을 바꾸지 않고 새 배열).
 * 이미 filed가 있으면 그대로 둔다.
 */
export function attachFiledDates(periods: PeriodFinancials[], reports: PeriodicReport[]): PeriodFinancials[] {
  const filed = new Map(reports.filter((r) => r.kind === "사업보고서").map((r) => [r.period, r.filed]));
  return periods.map((p) => (p.filed || !filed.has(p.period) ? p : { ...p, filed: filed.get(p.period)! }));
}

// ───────────────────────── 단일회사 주요계정(fnlttSinglAcnt.json) ─────────────────────────

/** 계정명 변형(공백 제거 후 정확히 일치). 앞에 있을수록 우선(앱 기본값, 미검증) */
export const DART_ACCOUNTS = {
  revenue: ["매출액", "수익(매출액)", "매출액(수익)", "매출", "영업수익", "수익"],
  opIncome: ["영업이익", "영업이익(손실)", "영업손익"],
  netIncome: ["당기순이익", "당기순이익(손실)", "당기순손익", "연결당기순이익", "연결당기순이익(손실)"],
} as const;

/** "1,234,000" · "-1,234" · "(1,234)" → 원. "-"·빈칸·숫자 아님 → undefined */
function wonOf(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let s = v.replace(/[,\s]/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return neg ? -n : n;
}

/** 원 → 억 원(소수 둘째 자리) */
const eok = (won: number) => Math.round(won / 1e6) / 100;

/** "2023.01.01 ~ 2023.12.31" · "2023.12.31 현재" → 마지막 날짜의 "YYYY.MM" */
function periodOfDt(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const all = [...v.matchAll(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})/g)];
  const last = all.at(-1);
  if (!last) return null;
  const mo = Number(last[2]);
  return mo >= 1 && mo <= 12 ? `${last[1]}.${last[2]}` : null;
}

type Fs = "CFS" | "OFS";
const fsOf = (r: Obj): Fs | null => {
  if (r.fs_div === "CFS" || r.fs_div === "OFS") return r.fs_div;
  const nm = typeof r.fs_nm === "string" ? r.fs_nm.replace(/\s+/g, "") : "";
  return nm === "연결재무제표" ? "CFS" : nm === "재무제표" ? "OFS" : null;
};

/**
 * fnlttSinglAcnt.json(사업보고서) → 연간 실적(억 원, 기간 오름차순, 최대 3개: 당기·전기·전전기).
 * 연결재무제표(CFS)가 있으면 그것만, 없으면 별도(OFS). 손익계산서 계정(매출액·영업이익·당기순이익)만 본다.
 * 기간 라벨은 각 열의 기간(thstrm_dt 등) 끝 날짜로 정하고, 없으면 사업연도 + 당기 결산월(모르면 12월).
 * filed(제출일)는 접수번호 앞 8자리이며 당기에만 단다. 전기·전전기는 더 늦은 보고서에 다시 실린 값이라
 * 원래 제출일을 알 수 없고(재작성됐을 수도 있다) 그 날짜를 달면 과거 재현이 틀어진다.
 * 사업보고서가 아니거나(reprt_code ≠ 11011) 원화가 아니거나 형식을 알아보지 못하면 []. 실제 응답과 대조하지 못함(미검증).
 */
export function parseSingleAcnt(json: unknown): PeriodFinancials[] {
  const o = asObj(json);
  if (!o || checkDartStatus(o) !== "ok" || !Array.isArray(o.list)) return [];
  const rows = o.list.filter(isObj).filter((r) => {
    if (r.reprt_code != null && String(r.reprt_code) !== DART_REPORT_CODES.사업보고서) return false;
    if (typeof r.currency === "string" && r.currency.trim() && r.currency.trim().toUpperCase() !== "KRW") return false;
    // 재무상태표(BS) 계정은 쓰지 않는다
    return !(typeof r.sj_div === "string" && r.sj_div.trim() && !/^C?IS$/.test(r.sj_div.trim()));
  });
  const nm = (r: Obj) => (typeof r.account_nm === "string" ? r.account_nm.replace(/\s+/g, "") : "");
  const isPl = (r: Obj) => Object.values(DART_ACCOUNTS).some((names) => (names as readonly string[]).includes(nm(r)));
  const fs: Fs = rows.some((r) => fsOf(r) === "CFS" && isPl(r)) ? "CFS" : "OFS";
  const use = rows.filter((r) => fsOf(r) === fs || (fsOf(r) == null && fs === "OFS"));
  if (!use.some(isPl)) return [];

  const pick = (names: readonly string[]) => {
    for (const n of names) {
      const r = use.find((x) => nm(x) === n);
      if (r) return r;
    }
    return undefined;
  };
  const acc = { revenue: pick(DART_ACCOUNTS.revenue), opIncome: pick(DART_ACCOUNTS.opIncome), netIncome: pick(DART_ACCOUNTS.netIncome) };
  const ref = acc.revenue ?? acc.opIncome ?? acc.netIncome!;
  const year = Number(typeof ref.bsns_year === "string" || typeof ref.bsns_year === "number" ? ref.bsns_year : NaN);
  const rcept = typeof ref.rcept_no === "string" ? ref.rcept_no.trim() : "";
  const filed = /^\d{14}$/.test(rcept) && validYmd(rcept.slice(0, 8)) ? ymd(rcept.slice(0, 8)) : undefined;
  const curPeriod = periodOfDt(ref.thstrm_dt);
  const fiscalMonth = curPeriod?.slice(5) ?? "12";
  const curYear = curPeriod ? Number(curPeriod.slice(0, 4)) : year;

  const out: PeriodFinancials[] = [];
  (["thstrm", "frmtrm", "bfefrmtrm"] as const).forEach((col, k) => {
    const val = (r: Obj | undefined) => {
      const w = r ? wonOf(r[`${col}_amount`]) : undefined;
      return w == null ? undefined : eok(w);
    };
    const p: PeriodFinancials = { period: "", estimate: false };
    const revenue = val(acc.revenue), opIncome = val(acc.opIncome), netIncome = val(acc.netIncome);
    if (revenue == null && opIncome == null && netIncome == null) return;
    const period = periodOfDt(ref[`${col}_dt`]) ?? (Number.isFinite(curYear) ? `${curYear - k}.${fiscalMonth}` : null);
    if (!period) return;
    p.period = period;
    if (k === 0 && filed) p.filed = filed;
    if (revenue != null) p.revenue = revenue;
    if (opIncome != null) p.opIncome = opIncome;
    if (netIncome != null) p.netIncome = netIncome;
    out.push(p);
  });
  // 기간 라벨이 겹치면(형식 이상) 틀린 값을 내지 않도록 버린다
  if (new Set(out.map((p) => p.period)).size !== out.length) return [];
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

// ───────────────────────── 클라이언트 ─────────────────────────

/** DART 공급자(실제 또는 샘플) */
export interface DartSource {
  readonly sample: boolean;
  corpCodeOf(stockCode: string): Promise<string | null>;
  disclosures(stockCode: string, days?: number): Promise<Disclosure[]>;
  annual(stockCode: string, years?: number): Promise<PeriodFinancials[]>;
}

export interface DartClientOptions {
  /** 고유번호 목록 캐시 파일(JSON). 없으면 메모리에만 둔다 */
  cacheFile?: string;
  /** 고유번호 목록 캐시 기간(ms). 기본 DART_PARAMS.corpCodeTtlMs(7일) */
  ttlMs?: number;
  /** 테스트용 시계 */
  now?: () => Date;
}

/** 한국 시간 날짜 YYYYMMDD */
const kstYmd = (t: number) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, "");

interface CorpCache {
  version: 1;
  savedAt: string;
  /** 종목 코드 → [고유번호, 회사명] */
  entries: Record<string, [string, string]>;
}

/** 응답 본문 → JSON 객체. JSON이 아니면 XML 오류 상태를 보고, 그것도 아니면 DartError("parse") */
function jsonOrThrow(text: string, what: string): Obj {
  const o = asObj(text);
  if (o) return o;
  const x = parseDartXmlStatus(text);
  if (x && x.status !== "000") throw dartError(x.status, x.message);
  throw new DartError("parse", `DART ${what} 응답을 해석하지 못했어요(형식이 바뀌었을 수 있어요)`);
}

/**
 * OpenDART 클라이언트. 고유번호 목록(corpCode.xml ZIP)은 한 번 받아 메모리와 cacheFile(JSON)에 7일 둔다.
 * 요청은 주어진 Http의 직렬 큐·최소 간격을 따른다. 결과는 호출 시점(now) 기준이다.
 */
export class DartClient implements DartSource {
  readonly sample = false;
  private corp: { at: number; map: Map<string, CorpInfo> } | null = null;
  private loading: Promise<Map<string, CorpInfo>> | null = null;
  private lastMissRefresh = -Infinity;
  private memo = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();
  private readonly now: () => Date;
  private readonly ttl: number;

  constructor(private http: Http, private apiKey: string, private opts: DartClientOptions = {}) {
    if (!apiKey.trim()) throw new Error("DART API 키(DART_API_KEY)가 비어 있어요");
    this.now = opts.now ?? (() => new Date());
    this.ttl = opts.ttlMs ?? DART_PARAMS.corpCodeTtlMs;
  }

  /** 종목 코드(6자리) → { 고유번호, 회사명 }. 목록에 없으면(ETF·비상장 등) null */
  async corpOf(stockCode: string): Promise<CorpInfo | null> {
    if (!/^\d{6}$/.test(stockCode)) return null;
    let map = await this.corpMap(false);
    let hit = map.get(stockCode);
    const t = this.now().getTime();
    // 신규 상장일 수 있으니 목록이 하루 넘게 묵었으면 한 번 새로 받는다
    if (!hit && this.corp && t - this.corp.at >= DART_PARAMS.missRefreshMs && t - this.lastMissRefresh >= DART_PARAMS.missRefreshMs) {
      this.lastMissRefresh = t;
      map = await this.corpMap(true);
      hit = map.get(stockCode);
    }
    return hit ?? null;
  }

  async corpCodeOf(stockCode: string): Promise<string | null> {
    return (await this.corpOf(stockCode))?.corpCode ?? null;
  }

  /** 최근 days일(한국 날짜, 오늘 포함) 공시, 최신순. 6자리 종목 코드가 아니거나 고유번호가 없으면 [] */
  async disclosures(stockCode: string, days: number = DART_PARAMS.disclosureDays): Promise<Disclosure[]> {
    const corp = await this.corpCodeOf(stockCode);
    if (!corp) return [];
    const t = this.now().getTime();
    const endDe = kstYmd(t), bgnDe = kstYmd(t - Math.max(0, Math.floor(days)) * DAY);
    return this.cached(`list|${corp}|${bgnDe}|${endDe}`, DART_PARAMS.listTtlMs, async () => {
      const all: (Disclosure & { rceptNo: string })[] = [];
      for (let page = 1; page <= DART_PARAMS.maxPages; page++) {
        const text = await this.http.get(DART.list(this.apiKey, { corpCode: corp, bgnDe, endDe, pageNo: page }));
        const r = listPage(jsonOrThrow(text, "공시 목록"));
        if (!r.recognized) throw new DartError("parse", "DART 공시 목록 응답 형식을 알아보지 못했어요(형식이 바뀌었을 수 있어요)");
        all.push(...r.items);
        if (page >= r.totalPage) break;
      }
      const seen = new Set<string>();
      return all
        .filter((d) => {
          const k = d.rceptNo || `${d.date}|${d.title}`;
          return seen.has(k) ? false : (seen.add(k), true);
        })
        .sort(newestFirst)
        .map(({ rceptNo: _r, ...d }) => d);
    });
  }

  /**
   * 사업보고서 주요계정으로 최근 years개 연도 실적(억 원, 오래된 → 최신).
   * 지난해 사업보고서가 아직 없으면(013) 한 해 전 보고서부터 본다. 보고서 하나에 3개 연도가 실리므로 3년씩 거슬러 올라간다.
   * filed는 각 보고서의 당기에만 있다(attachFiledDates + periodicReports로 채울 수 있다).
   */
  async annual(stockCode: string, years = 3): Promise<PeriodFinancials[]> {
    const corp = await this.corpCodeOf(stockCode);
    if (!corp || years <= 0) return [];
    const thisYear = Number(kstYmd(this.now().getTime()).slice(0, 4));
    return this.cached(`annual|${corp}|${thisYear}|${years}`, DART_PARAMS.annualTtlMs, async () => {
      const got = new Map<string, PeriodFinancials>();
      let y = thisYear - 1;
      let first = true;
      const maxCalls = Math.ceil(years / 3) + 1;
      for (let calls = 0; calls < maxCalls && got.size < years; calls++) {
        const text = await this.http.get(DART.singleAcnt(this.apiKey, { corpCode: corp, year: y }));
        const rows = parseSingleAcnt(jsonOrThrow(text, "주요계정"));
        if (!rows.length) {
          if (!first) break;
          first = false;
          y -= 1;
          continue;
        }
        first = false;
        for (const p of rows) {
          const prev = got.get(p.period);
          // 같은 기간이면 그 해 보고서의 값(제출일 있음)을 우선한다
          if (!prev || (!prev.filed && p.filed)) got.set(p.period, p);
        }
        y -= 3;
      }
      return [...got.values()].sort((a, b) => a.period.localeCompare(b.period)).slice(-years);
    });
  }

  // ── 내부 ──

  private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const t = this.now().getTime();
    const hit = this.memo.get(key);
    if (hit && t - hit.at < hit.ttl) return hit.value as Promise<T>;
    // 날짜가 바뀌면 키도 바뀌므로 만료된 항목을 가끔 치운다
    if (this.memo.size >= 500) for (const [k, v] of this.memo) if (t - v.at >= v.ttl) this.memo.delete(k);
    const value = load();
    this.memo.set(key, { at: t, ttl, value });
    // 실패는 캐시하지 않는다
    value.catch(() => {
      if (this.memo.get(key)?.value === value) this.memo.delete(key);
    });
    return value;
  }

  private corpMap(force: boolean): Promise<Map<string, CorpInfo>> {
    const t = this.now().getTime();
    if (!force && this.corp && t - this.corp.at < this.ttl) return Promise.resolve(this.corp.map);
    // 동시에 여러 종목을 물어도 한 번만 받는다
    this.loading ??= this.loadCorp(force).finally(() => (this.loading = null));
    return this.loading;
  }

  private async loadCorp(force: boolean): Promise<Map<string, CorpInfo>> {
    const t = this.now().getTime();
    const file = await this.readCacheFile();
    if (!force && file && t - file.at < this.ttl && t >= file.at) {
      this.corp = file;
      return file.map;
    }
    try {
      const map = await this.downloadCorpCodes();
      this.corp = { at: t, map };
      await this.writeCacheFile(t, map);
      return map;
    } catch (e) {
      // 받기에 실패하면 묵은 목록이라도 쓰고(고유번호는 거의 바뀌지 않는다) 한 시간 뒤 다시 시도한다
      const stale = this.corp?.map ?? file?.map;
      if (!stale) throw e;
      this.corp = { at: t - this.ttl + DART_PARAMS.staleRetryMs, map: stale };
      return stale;
    }
  }

  private async downloadCorpCodes(): Promise<Map<string, CorpInfo>> {
    if (!this.http.getBytes) throw new Error("이 HTTP 클라이언트는 파일 내려받기(getBytes)를 지원하지 않아요");
    const bytes = await this.http.getBytes(DART.corpCode(this.apiKey));
    if (!looksLikeZip(bytes)) {
      // 키 오류 등은 ZIP 대신 XML(또는 JSON) 오류 본문이 온다
      const text = new TextDecoder("utf-8").decode(bytes);
      const x = parseDartXmlStatus(text);
      if (x && x.status !== "000") throw dartError(x.status, x.message);
      const o = asObj(text);
      if (o) checkDartStatus(o);
      throw new DartError("parse", "DART 고유번호 목록 응답이 ZIP이 아니에요(형식이 바뀌었을 수 있어요)");
    }
    const xml = unzipFirst(bytes, /\.xml$/i);
    if (!xml) throw new DartError("parse", "DART 고유번호 ZIP 안에 XML 파일이 없어요");
    const map = parseCorpCodeXml(xml.data.toString("utf8"));
    if (!map.size) throw new DartError("parse", "DART 고유번호 목록에서 상장 종목을 찾지 못했어요(형식이 바뀌었을 수 있어요)");
    return map;
  }

  private async readCacheFile(): Promise<{ at: number; map: Map<string, CorpInfo> } | null> {
    if (!this.opts.cacheFile) return null;
    try {
      const raw = JSON.parse(await readFile(this.opts.cacheFile, "utf8")) as Partial<CorpCache>;
      const at = Date.parse(String(raw.savedAt));
      if (raw.version !== 1 || !Number.isFinite(at) || !isObj(raw.entries)) return null;
      const map = new Map<string, CorpInfo>();
      for (const [stock, v] of Object.entries(raw.entries)) {
        if (!/^\d{6}$/.test(stock) || !Array.isArray(v)) continue;
        const [corpCode, name] = v as unknown[];
        if (typeof corpCode === "string" && /^\d{8}$/.test(corpCode) && typeof name === "string") map.set(stock, { corpCode, name });
      }
      return map.size ? { at, map } : null;
    } catch {
      return null; // 없거나 깨진 캐시는 새로 받는다
    }
  }

  private async writeCacheFile(at: number, map: Map<string, CorpInfo>): Promise<void> {
    const file = this.opts.cacheFile;
    if (!file) return;
    const body: CorpCache = { version: 1, savedAt: new Date(at).toISOString(), entries: Object.fromEntries([...map].map(([k, v]) => [k, [v.corpCode, v.name]])) };
    try {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(body));
      await rename(tmp, file);
    } catch {
      // 캐시 파일은 선택 사항이다(쓰기 실패해도 메모리 목록으로 계속)
    }
  }
}

// ───────────────────────── 샘플(PROVIDER=mock) ─────────────────────────

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

/** 샘플 공시 제목(DART 보고서명 형식을 흉내 낸 것) */
const SAMPLE_DART_TITLES = [
  "단일판매ㆍ공급계약체결",
  "[기재정정]단일판매ㆍ공급계약체결",
  "주요사항보고서(자기주식취득결정)",
  "주요사항보고서(유상증자결정)",
  "현금ㆍ현물배당결정",
  "주식등의대량보유상황보고서(일반)",
  "임원ㆍ주요주주특정증권등소유상황보고서",
  "기업설명회(IR)개최(안내공시)",
  "매출액또는손익구조30%(대규모법인은15%)이상변경",
  "주요사항보고서(전환사채권발행결정)",
  "투자판단관련주요경영사항(자율공시)",
] as const;

const SAMPLE_RM = ["유", "코", "", "유", "코"] as const;

/**
 * 샘플 DART(PROVIDER=mock). 종목 코드 해시로 항상 같은 가짜 공시·실적을 만든다. 실제 공시가 아니다.
 * 원문 링크(url)는 가짜 접수번호가 되므로 달지 않는다. now 이후 날짜의 공시·실적은 만들지 않는다.
 */
export class SampleDart implements DartSource {
  readonly sample = true;
  constructor(private now: () => Date = () => new Date()) {}

  async corpCodeOf(stockCode: string): Promise<string | null> {
    return /^\d{6}$/.test(stockCode) ? String(hash(`${stockCode}corp`) % 100_000_000).padStart(8, "0") : null;
  }

  async disclosures(stockCode: string, days: number = DART_PARAMS.disclosureDays): Promise<Disclosure[]> {
    if (!/^\d{6}$/.test(stockCode)) return [];
    const r = rng(hash(`${stockCode}dart`));
    const t = this.now().getTime();
    const today = ymd(kstYmd(t));
    const from = ymd(kstYmd(t - Math.max(0, Math.floor(days)) * DAY));
    const span = Math.max(1, Math.floor(days));
    const rm = SAMPLE_RM[hash(stockCode) % SAMPLE_RM.length]!;
    const out: Disclosure[] = [];
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const date = ymd(kstYmd(t - Math.floor(r() * span) * DAY));
      const title = SAMPLE_DART_TITLES[Math.floor(r() * SAMPLE_DART_TITLES.length)]!;
      const form = dartReportKind(title, rm);
      out.push({ date, title, source: "DART", ...(form ? { form } : {}) });
    }
    // 정기보고서: 분기 말 + (기한 - 며칠)에 제출했다고 둔다(12월 결산 가정)
    const y = Number(today.slice(0, 4));
    for (let yy = y - 1; yy <= y; yy++) {
      for (const mo of [3, 6, 9, 12]) {
        const kind: PeriodicKind = mo === 12 ? "사업보고서" : mo === 6 ? "반기보고서" : "분기보고서";
        const period = `${yy}.${String(mo).padStart(2, "0")}`;
        const filed = addDays(periodEnd(period)!, DART_PARAMS.reportDeadlineDays[kind] - 1 - (hash(stockCode + period) % 10));
        if (filed >= from && filed <= today) out.push({ date: filed, title: `${kind} (${period})`, source: "DART", form: kind });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  async annual(stockCode: string, years = 3): Promise<PeriodFinancials[]> {
    if (!/^\d{6}$/.test(stockCode) || years <= 0) return [];
    const today = ymd(kstYmd(this.now().getTime()));
    const r = rng(hash(`${stockCode}annual`));
    const base = 500 + Math.floor(r() * 50_000); // 억 원
    const margin = 0.03 + r() * 0.15;
    const growth = -0.05 + r() * 0.25;
    const lastYear = Number(today.slice(0, 4)) - 1;
    const rows: PeriodFinancials[] = [];
    for (let yy = lastYear - years; yy <= lastYear; yy++) {
      const period = `${yy}.12`;
      const filed = addDays(periodEnd(period)!, 75 + (hash(stockCode + yy) % 14));
      if (filed > today) continue; // 아직 제출되지 않은 해는 만들지 않는다
      const k = yy - (lastYear - years);
      const revenue = Math.round(base * (1 + growth) ** k * (0.95 + r() * 0.1));
      const opIncome = Math.round(revenue * (margin + (r() - 0.5) * 0.04));
      const netIncome = Math.round(opIncome * (0.6 + r() * 0.3));
      rows.push({ period, filed, estimate: false, revenue, opIncome, netIncome });
    }
    return rows.slice(-years);
  }
}
