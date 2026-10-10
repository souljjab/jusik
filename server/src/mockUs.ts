import type { Disclosure } from "@jusik/shared";
import { classifySecFiling, type UsHolders } from "../../shared/src/usFlows";
import type { SecFinancials, SecPeriodFinancials, SecSource } from "./sec";

/*
 * 샘플 모드(PROVIDER=mock)용 미국 종목 지분·수급, SEC 공시, SEC 실적. 실제 값이 아니다.
 * 티커 문자열 해시로 시드를 정해 같은 티커·같은 날짜면 항상 같은 값이 나온다.
 * 기관·임원 이름과 공시 설명에는 '샘플'을 붙이고, 실제 SEC 문서처럼 보이지 않도록 원문 링크는 넣지 않는다.
 */

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

const DAY = 86_400_000;
const isUs = (code: string) => !/^\d{6}$/.test(code);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const r2 = (x: number) => Math.round(x * 100) / 100;
/** y년 m월(1~12) 말일 */
const monthEnd = (y: number, m: number) => iso(Date.UTC(y, m, 0));
const addDays = (d: string, n: number) => iso(Date.parse(d) + n * DAY);
const today = (now: Date) => now.toISOString().slice(0, 10);

/** 샘플 제출 지연 일수(분기 40일, 연간 60일 — 실제 마감은 회사 규모별로 다르다) */
export const MOCK_US_PARAMS = { quarterFileLag: 40, annualFileLag: 60, annualKeep: 5, quarterKeep: 12 } as const;

interface Q {
  fy: number;
  q: 1 | 2 | 3 | 4;
  end: string;
  revenue: number;
  opIncome: number;
  netIncome: number;
  eps: number;
}

/** 회계연도 말 월(대부분 12월, 일부 9·6·3월)과 분기 실적 시계열 */
function sampleQuarters(code: string, now: Date): { fyEnd: number; quarters: Q[] } {
  const r = rng(hash(code + "secfin"));
  const fyEnd = [12, 12, 12, 9, 6, 3][Math.floor(r() * 6)]!;
  const base = 200 + r() * 20_000; // 분기 매출(백만 달러)
  const growth = -0.05 + r() * 0.3; // 연 성장률
  const margin = 0.04 + r() * 0.26;
  const shares = 50 + r() * 2_000; // 백만 주
  const nowY = now.getUTCFullYear();
  const quarters: Q[] = [];
  // 7개 회계연도(앞쪽은 잘려 나간다)
  for (let fy = nowY - 6; fy <= nowY + 1; fy++) {
    for (const q of [1, 2, 3, 4] as const) {
      const m0 = fyEnd - 12 + q * 3; // 회계연도 fy의 q분기 말 월(fyEnd 기준으로 거꾸로)
      const y = m0 <= 0 ? fy - 1 : fy, m = m0 <= 0 ? m0 + 12 : m0;
      const k = fy - (nowY - 6) + q / 4;
      const revenue = r2(base * (1 + growth) ** k * (1 + (r() - 0.5) * 0.08));
      const opIncome = r2(revenue * (margin + (r() - 0.5) * 0.04));
      const netIncome = r2(opIncome * 0.8);
      quarters.push({ fy, q, end: monthEnd(y, m), revenue, opIncome, netIncome, eps: r2(netIncome / shares) });
    }
  }
  return { fyEnd, quarters };
}

/** 샘플 SEC 실적(백만 달러). now 이전에 '제출'된 기간만 남긴다(미래 실적 없음). 4분기는 연간 − 1~3분기로 표시(derived) */
export function sampleSecFinancials(code: string, now: Date = new Date()): SecFinancials {
  if (!isUs(code)) return { annual: [], quarterly: [] };
  const P = MOCK_US_PARAMS;
  const t = today(now);
  const { quarters } = sampleQuarters(code, now);
  const annual: SecPeriodFinancials[] = [];
  const quarterly: SecPeriodFinancials[] = [];
  const label = (end: string) => `${end.slice(0, 4)}.${end.slice(5, 7)}`;
  for (const q of quarters) {
    if (q.q === 4) {
      const fyQs = quarters.filter((x) => x.fy === q.fy);
      const filed = addDays(q.end, P.annualFileLag);
      if (filed > t || fyQs.length !== 4) continue;
      const sum = (f: (x: Q) => number) => r2(fyQs.reduce((s, x) => s + f(x), 0));
      annual.push({ period: label(q.end), filed, estimate: false, revenue: sum((x) => x.revenue), opIncome: sum((x) => x.opIncome), netIncome: sum((x) => x.netIncome), eps: sum((x) => x.eps) });
      quarterly.push({ period: label(q.end), filed, estimate: false, revenue: q.revenue, opIncome: q.opIncome, netIncome: q.netIncome, eps: q.eps, derived: true });
    } else {
      const filed = addDays(q.end, P.quarterFileLag);
      if (filed > t) continue;
      quarterly.push({ period: label(q.end), filed, estimate: false, revenue: q.revenue, opIncome: q.opIncome, netIncome: q.netIncome, eps: q.eps });
    }
  }
  return { annual: annual.slice(-P.annualKeep), quarterly: quarterly.slice(-P.quarterKeep) };
}

const title = (form: string, items: string[] = []) =>
  `${classifySecFiling(form, items).type} · ${form}${items.length ? ` (Item ${items.join(", ")})` : ""} — 샘플 공시`;

/** 샘플 SEC 공시(최신순). 실적 제출일(10-Q·10-K + 8-K 2.02)과 무작위 내부자 거래·기타 공시를 섞는다. 원문 링크 없음 */
export function sampleSecFilings(code: string, now: Date = new Date(), days = 90): Disclosure[] {
  if (!isUs(code)) return [];
  const t = today(now);
  const from = addDays(t, -days);
  const r = rng(hash(code + "secdis" + t));
  const out: Disclosure[] = [];
  const push = (date: string, form: string, items?: string[]) => {
    if (date >= from && date <= t) out.push({ date, title: title(form, items), source: "SEC", form });
  };
  const fin = sampleSecFinancials(code, now);
  for (const p of fin.quarterly) {
    if (!p.filed) continue;
    push(p.filed, p.derived ? "10-K" : "10-Q");
    push(p.filed, "8-K", ["2.02", "9.01"]);
  }
  const extras: [string, string[]?][] = [["4"], ["4"], ["4"], ["8-K", ["5.02"]], ["8-K", ["1.01", "9.01"]], ["8-K", ["8.01"]], ["SC 13G/A"], ["SC 13G"], ["S-3"], ["DEF 14A"], ["144"]];
  const n = 3 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const [form, items] = extras[Math.floor(r() * extras.length)]!;
    push(addDays(t, -Math.floor(r() * days)), form, items);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** 샘플 지분·수급. 비율은 %, 날짜는 now 이전 */
export function sampleUsHolders(code: string, now: Date = new Date()): UsHolders {
  if (!isUs(code)) return {};
  const r = rng(hash(code + "holders"));
  const t = today(now);
  const buyCount = Math.floor(r() * 6), sellCount = Math.floor(r() * 12);
  const buyShares = buyCount * Math.round(1_000 + r() * 50_000), sellShares = sellCount * Math.round(1_000 + r() * 80_000);
  const sharesShortPrior = Math.round(1e6 + r() * 5e7);
  const relations = ["최고경영자(샘플)", "최고재무책임자(샘플)", "이사(샘플)", "10% 대주주(샘플)"];
  const recentInsider = Array.from({ length: 3 + Math.floor(r() * 4) }, (_, i) => {
    const buy = r() < buyCount / Math.max(1, buyCount + sellCount);
    const shares = Math.round(1_000 + r() * 60_000);
    const price = r2(10 + r() * 400);
    return {
      name: `샘플 임원 ${String.fromCharCode(65 + i)}`,
      text: `${relations[Math.floor(r() * relations.length)]} · ${buy ? "장내 매수" : "장내 매도"}`,
      shares,
      value: Math.round(shares * price),
      date: addDays(t, -Math.floor(r() * 170) - 1),
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
  // 상위 기관 보고 기준일: 직전 분기 말
  const qm = Math.floor(now.getUTCMonth() / 3) * 3;
  const instDate = qm === 0 ? monthEnd(now.getUTCFullYear() - 1, 12) : monthEnd(now.getUTCFullYear(), qm);
  const tilt = r() - 0.5;
  const topInstitutions = Array.from({ length: 6 + Math.floor(r() * 5) }, (_, i) => ({
    name: `샘플 기관 ${i + 1}`,
    pctHeld: r2(Math.max(0.3, 9 - i * 0.8 + (r() - 0.5))),
    pctChange: r2((r() - 0.5 + tilt) * 10),
    date: instDate,
  }));
  return {
    insidersPct: r2(0.1 + r() * 15),
    institutionsPct: r2(20 + r() * 70),
    institutionsCount: Math.round(100 + r() * 4_900),
    insiderNet6m: { buyShares, sellShares, netShares: buyShares - sellShares, buyCount, sellCount },
    recentInsider,
    shortPctFloat: r2(0.5 + r() * 29.5),
    shortRatio: r2(0.5 + r() * 7.5),
    sharesShort: Math.round(sharesShortPrior * (0.7 + r() * 0.7)),
    sharesShortPrior,
    topInstitutions,
  };
}

/** 샘플 모드용 미국 원천(SecSource 모양 + 지분·수급). 실제 값이 아니다 */
export class MockUsSource implements SecSource {
  readonly sample = true;
  constructor(private now: () => Date = () => new Date()) {}

  async holders(code: string): Promise<UsHolders> {
    return sampleUsHolders(code, this.now());
  }

  async filings(ticker: string, days = 90): Promise<Disclosure[]> {
    return sampleSecFilings(ticker, this.now(), days);
  }

  async financials(ticker: string): Promise<SecFinancials> {
    return sampleSecFinancials(ticker, this.now());
  }
}
