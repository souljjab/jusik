import type { BreadthToday } from "./breadthSource";
import type { Disclosure, Fundamentals, InvestorFlow, Market, PeriodFinancials, SectorRow } from "@jusik/shared";
import type { UniverseRow } from "./provider";

/*
 * 네이버페이 증권 모바일 JSON API(m.stock.naver.com/api). 2026년 기준 예전 PC 페이지(finance.naver.com의 종목 메인·순위표·
 * 시가총액·업종·외국인·공시)는 새 사이트(stock.naver.com)로 넘어가 HTML 표를 더 이상 주지 않는다(302, 공시는 410).
 * 아래 형식은 2026-10-30 실제 응답과 대조했다(test/fixtures/naver). 공식 API가 아니라 바뀔 수 있으니
 * `npm run check:sources -w server`로 확인하세요.
 */

const BASE = "https://m.stock.naver.com/api";
const sosok = (market: Market) => (market === "KOSDAQ" ? "KOSDAQ" : "KOSPI");

export const NAVER_API = {
  /** 종목 목록: quantTop 거래량 상위, up 상승률 상위, marketValue 시가총액 순위 */
  stockList: (kind: "quantTop" | "up" | "marketValue", market: Market, page = 1, pageSize = 100) =>
    `${BASE}/stocks/${kind}/${sosok(market)}?page=${page}&pageSize=${pageSize}`,
  /** 종목 요약(PER·EPS·PBR·BPS·시가총액·업종 번호·최근 수급) */
  integration: (code: string) => `${BASE}/stock/${code}/integration`,
  /** 연간·분기 실적(최근 확정 + 컨센서스 추정 한 칸) */
  finance: (code: string, period: "annual" | "quarter") => `${BASE}/stock/${code}/finance/${period}`,
  /** 일별 외국인·기관·개인 순매매 수량(최신순) */
  trend: (code: string, pageSize = 40) => `${BASE}/stock/${code}/trend?pageSize=${pageSize}`,
  /** 공시 목록(최신순) */
  disclosure: (code: string, pageSize = 20) => `${BASE}/stock/${code}/disclosure?page=1&pageSize=${pageSize}`,
  /** 업종 목록(등락률) */
  industries: () => `${BASE}/stocks/industry?page=1&pageSize=100`,
  /** 한 업종(groupInfo에 업종 이름) */
  industry: (no: string, pageSize = 1) => `${BASE}/stocks/industry/${no}?page=1&pageSize=${pageSize}`,
  /** 지수 요약(오늘 상한·상승·보합·하락·하한 종목 수) */
  index: (market: Market) => `${BASE}/index/${sosok(market)}/integration`,
};

/** 요청 머리글: 모바일 사이트에서 부른 것처럼 */
export const NAVER_API_OPTS = { encoding: "utf-8" as const, headers: { referer: "https://m.stock.naver.com/" } };

// ───────────────────────── 숫자·날짜 ─────────────────────────

/** "1,289" "+1,742,739" "-4.96" "9.89배" "22,292원" "46.15%" → 숫자. "-"·"N/A"·빈칸은 undefined */
export function naverNum(s: unknown): number | undefined {
  if (typeof s === "number") return Number.isFinite(s) ? s : undefined;
  if (typeof s !== "string") return undefined;
  const t = s.replace(/[,\s%원배]/g, "");
  if (t === "" || t === "-" || t === "+" || /^N\/?A$/i.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * "397조 5,616억원" → 3975616, "5,616억원" → 5616, "1조" → 10000(억 원).
 * 조·억 단위가 없으면 단위를 알 수 없어 undefined — plainIsEok면 맨 숫자를 억 원으로 받는다
 */
export function parseEok(text: string, plainIsEok = false): number | undefined {
  const t = text.replace(/\([^)]*\)/g, "").replace(/\s+/g, "");
  const jo = /(\d[\d,]*)조(\d[\d,]*)?/.exec(t); // 조 뒤 나머지는 억 단위
  const eok = /(\d[\d,]*)억/.exec(t);
  const plain = plainIsEok ? /^(\d[\d,]*)(?:원)?$/.exec(t) : null;
  const n = jo ? (naverNum(jo[1]) ?? NaN) * 10_000 + (jo[2] ? (naverNum(jo[2]) ?? NaN) : 0) : eok ? naverNum(eok[1]) : plain ? naverNum(plain[1]) : undefined;
  return n != null && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "20261030" · "2026-10-29T06:52:29" → "YYYY-MM-DD" */
export function naverDate(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

// ───────────────────────── 종목 목록(순위표·시가총액) ─────────────────────────

interface StockListItem {
  itemCode: string;
  stockName: string;
  stockEndType?: string;
  closePrice?: string;
  fluctuationsRatio?: string;
  accumulatedTradingVolume?: string;
  /** 백만 원 */
  accumulatedTradingValue?: string;
}

/** 응답의 전체 줄(raw, 영숫자 코드 ETF 등 포함)과 그중 6자리 숫자 코드 줄 */
function stockItems(text: string): { items: StockListItem[]; raw: number } {
  const d = json(text);
  const list: unknown[] = isObj(d) && Array.isArray(d.stocks) ? d.stocks : [];
  return { items: list.filter((s): s is StockListItem => isObj(s) && /^\d{6}$/.test(str(s.itemCode)) && !!str(s.stockName)), raw: list.length };
}

/**
 * 거래량·상승률 상위 목록 → 후보 줄. 주식만 남긴다(ETF·ETN은 단타 규칙의 대상이 아니다).
 * 등락률은 부호가 붙어 오고(하락 "-4.96"), 거래대금은 백만 원 단위
 */
export function parseNaverStockList(text: string, market: Market): UniverseRow[] {
  return parseNaverStockListPage(text, market).rows;
}

/** parseNaverStockList와 같고, 응답에 든 전체 줄 수(ETF 포함, 다음 쪽이 있는지 판단용)를 함께 준다 */
export function parseNaverStockListPage(text: string, market: Market): { rows: UniverseRow[]; raw: number } {
  const rows: UniverseRow[] = [];
  const { items, raw } = stockItems(text);
  for (const s of items) {
    if (s.stockEndType && s.stockEndType !== "stock") continue;
    const price = naverNum(s.closePrice), changePct = naverNum(s.fluctuationsRatio), volume = naverNum(s.accumulatedTradingVolume);
    if (price == null || !(price > 0) || changePct == null || volume == null) continue;
    const value = naverNum(s.accumulatedTradingValue);
    rows.push({ code: s.itemCode, name: s.stockName.trim(), market, price, changePct, volume, tradeValue: value != null ? value * 1_000_000 : price * volume });
  }
  return { rows, raw };
}

/** 후보 목록 한 종류에서 모을 주식 수와 최대 쪽 수. 코스피 목록은 ETF·ETN이 많아 한 쪽(100줄)에 주식이 20~50개뿐이다 */
export const NAVER_UNIVERSE = { pageSize: 100, wantStocks: 100, maxPages: 3 } as const;

/** 시가총액 순위 → 순위대로 {code, name}(주식만. 우선주 등은 부르는 쪽에서 이름으로 거른다) */
export function parseNaverMarketValue(text: string): { code: string; name: string }[] {
  const seen = new Set<string>();
  const out: { code: string; name: string }[] = [];
  for (const s of stockItems(text).items) {
    if ((s.stockEndType && s.stockEndType !== "stock") || seen.has(s.itemCode)) continue;
    seen.add(s.itemCode);
    out.push({ code: s.itemCode, name: s.stockName.trim() });
  }
  return out;
}

// ───────────────────────── 재무 ─────────────────────────

/** 종목 요약 → 현재 주가 기준 PER·PBR(최근 4분기 EPS·BPS), 시가총액(억 원), 업종 번호 */
export function parseNaverIntegration(text: string): { per?: number; pbr?: number; eps?: number; bps?: number; marketCap?: number; industryCode?: string } {
  const d = json(text);
  if (!isObj(d)) return {};
  const infos = Array.isArray(d.totalInfos) ? d.totalInfos.filter(isObj) : [];
  const val = (code: string) => str(infos.find((x) => x.code === code)?.value);
  const industry = str(d.industryCode);
  const out = {
    per: naverNum(val("per")), pbr: naverNum(val("pbr")), eps: naverNum(val("eps")), bps: naverNum(val("bps")),
    marketCap: parseEok(val("marketValue")), industryCode: /^\d+$/.test(industry) ? industry : undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

interface FinanceTable {
  periods: { key: string; label: string; estimate: boolean }[];
  rows: Map<string, Record<string, number | undefined>>;
}

/** 실적 표(finance/annual·quarter) → 기간(오래된 → 최신)과 항목별 값. 형식이 다르면 null */
export function parseNaverFinanceTable(text: string): FinanceTable | null {
  const d = json(text);
  const info = isObj(d) && isObj(d.financeInfo) ? d.financeInfo : null;
  if (!info || !Array.isArray(info.trTitleList) || !Array.isArray(info.rowList)) return null;
  const periods = info.trTitleList
    .filter(isObj)
    .map((t) => ({ key: str(t.key), label: str(t.title).replace(/\.$/, ""), estimate: t.isConsensus === "Y" }))
    .filter((p) => /^\d{6}$/.test(p.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  const rows = new Map<string, Record<string, number | undefined>>();
  for (const r of info.rowList.filter(isObj)) {
    const title = str(r.title).replace(/\s+/g, "");
    if (!title || rows.has(title) || !isObj(r.columns)) continue;
    const cols: Record<string, number | undefined> = {};
    for (const p of periods) {
      const c = (r.columns as Record<string, unknown>)[p.key];
      cols[p.key] = isObj(c) ? naverNum(c.value) : undefined;
    }
    rows.set(title, cols);
  }
  return periods.length && rows.size ? { periods, rows } : null;
}

const ITEMS = [["revenue", "매출액"], ["opIncome", "영업이익"], ["netIncome", "당기순이익"], ["eps", "EPS"]] as const;

/** 기간별 매출액·영업이익·당기순이익(억 원)·EPS(원). 값이 하나도 없는 기간은 뺀다 */
function periodsOf(t: FinanceTable | null): PeriodFinancials[] {
  if (!t) return [];
  const out: PeriodFinancials[] = [];
  for (const p of t.periods) {
    const f: PeriodFinancials = { period: p.label, estimate: p.estimate };
    for (const [k, label] of ITEMS) {
      const v = t.rows.get(label)?.[p.key];
      if (v !== undefined) f[k] = v;
    }
    if (ITEMS.some(([k]) => f[k] !== undefined)) out.push(f);
  }
  return out;
}

/**
 * 종목 요약 + 연간·분기 실적 → Fundamentals(금액 억 원).
 * PER·PBR·EPS·BPS는 요약의 현재가 기준 값(최근 4분기), 없으면 마지막 확정 연간 값.
 * ROE·부채비율·당좌비율·유보율과 매출·영업이익 증가율은 확정 연간 값. 동일업종 PER은 이 API에 없어 비워 둔다
 */
export function naverFundamentals(integrationText: string | null, annualText: string | null, quarterText: string | null): Fundamentals {
  const now = integrationText ? parseNaverIntegration(integrationText) : {};
  const a = annualText ? parseNaverFinanceTable(annualText) : null;
  const q = quarterText ? parseNaverFinanceTable(quarterText) : null;
  const confirmed = (a?.periods ?? []).filter((p) => !p.estimate);
  const latest = (label: string): number | undefined => {
    const r = a?.rows.get(label);
    for (let i = confirmed.length - 1; r && i >= 0; i--) {
      const v = r[confirmed[i]!.key];
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const growth = (label: string): number | undefined => {
    const r = a?.rows.get(label);
    const vals = r ? confirmed.map((p) => r[p.key]).filter((v): v is number => v !== undefined) : [];
    if (vals.length < 2) return undefined;
    const prev = vals[vals.length - 2]!, cur = vals[vals.length - 1]!;
    return prev > 0 ? ((cur - prev) / prev) * 100 : undefined;
  };
  const annual = periodsOf(a), quarterly = periodsOf(q);
  const f: Fundamentals = {
    per: now.per ?? latest("PER"), pbr: now.pbr ?? latest("PBR"), eps: now.eps ?? latest("EPS"), bps: now.bps ?? latest("BPS"),
    roe: latest("ROE"), debtRatio: latest("부채비율"), quickRatio: latest("당좌비율"), reserveRatio: latest("유보율"),
    revenueGrowth: growth("매출액"), opIncomeGrowth: growth("영업이익"),
    annual: annual.length ? annual : undefined, quarterly: quarterly.length ? quarterly : undefined,
    marketCap: now.marketCap,
  };
  const hasAmount = f.marketCap !== undefined || [...annual, ...quarterly].some((p) => p.revenue !== undefined || p.opIncome !== undefined || p.netIncome !== undefined);
  if (hasAmount) f.amountUnit = "억원";
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Fundamentals;
}

// ───────────────────────── 수급·공시·업종 ─────────────────────────

/** 일별 순매매 수량(최신순 응답) → 날짜 오름차순 InvestorFlow */
export function parseNaverTrend(text: string): InvestorFlow[] {
  const d = json(text);
  const byDate = new Map<string, InvestorFlow>();
  for (const r of Array.isArray(d) ? d.filter(isObj) : []) {
    const date = naverDate(r.bizdate);
    const close = naverNum(r.closePrice), foreignNet = naverNum(r.foreignerPureBuyQuant), institutionNet = naverNum(r.organPureBuyQuant);
    if (!date || close == null || foreignNet == null || institutionNet == null || byDate.has(date)) continue;
    const hold = naverNum(r.foreignerHoldRatio);
    byDate.set(date, { date, close, volume: naverNum(r.accumulatedTradingVolume) ?? 0, institutionNet, foreignNet, ...(hold != null ? { foreignHoldPct: hold } : {}) });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 공시 목록 → 최신순 [{ date, title }] */
export function parseNaverDisclosures(text: string): Disclosure[] {
  const d = json(text);
  const out: Disclosure[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(d) ? d.filter(isObj) : []) {
    const date = naverDate(r.datetime), title = str(r.title).replace(/\s+/g, " ").trim();
    if (!date || !title) continue;
    const k = `${date}|${title}|${str(r.disclosureId)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ date, title, source: "네이버" });
  }
  // 같은 날짜 안에서는 응답 순서를 유지(안정 정렬)
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** 업종 목록 → { no, name, changePct } (응답 순서) */
export function parseNaverIndustries(text: string): SectorRow[] {
  const d = json(text);
  const groups = isObj(d) && Array.isArray(d.groups) ? d.groups.filter(isObj) : [];
  const out: SectorRow[] = [];
  for (const g of groups) {
    const no = str(g.no), name = str(g.name).trim(), changePct = naverNum(g.changeRate);
    if (/^\d+$/.test(no) && name && changePct != null) out.push({ no, name, changePct });
  }
  return out;
}

/** 한 업종 응답의 groupInfo → { no, name } */
export function parseNaverIndustryGroup(text: string): { no: string; name: string } | null {
  const d = json(text);
  const g = isObj(d) && isObj(d.groupInfo) ? d.groupInfo : null;
  const no = str(g?.no), name = str(g?.name).trim();
  return /^\d+$/.test(no) && name ? { no, name } : null;
}

/**
 * 지수 요약의 upDownStockInfo → 오늘 거래소 전체 상한·상승·보합·하락·하한 종목 수.
 * 다섯 값이 다 있어야 돌려준다(빠진 값을 0으로 채우지 않는다). 상승 수에 상한이 들어 있는지는 응답만으로는 알 수 없어 그대로 둔다
 */
export function parseNaverUpDown(text: string): BreadthToday | null {
  const d = json(text);
  const u = isObj(d) && isObj(d.upDownStockInfo) ? d.upDownStockInfo : null;
  if (!u) return null;
  const t = { upperLimit: naverNum(u.upperCount), up: naverNum(u.riseCount), unchanged: naverNum(u.steadyCount), down: naverNum(u.fallCount), lowerLimit: naverNum(u.lowerCount) };
  if (Object.values(t).some((v) => v == null || v < 0) || Object.values(t).every((v) => v === 0)) return null;
  return t as BreadthToday;
}
