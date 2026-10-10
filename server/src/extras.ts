import {
  buildMacroSnapshot, disclosureNotes, flowSignals, regionOfCode, secDisclosureNotes, sectorStrength, usFlowSignals,
  type Candle, type Disclosure, type InvestorFlow, type MacroSeriesId, type MacroSeriesPoint, type MacroSnapshot, type SectorRow, type StockExtras,
  type IsmReading, type UsHolders,
} from "@jusik/shared";
import { periodicReports, type DartSource } from "./dart";
import type { MacroSnapshotOverride } from "./fred";
import type { Http } from "./http";
import { manualIsm, MockIsmSource, sampleIsmProxySeries } from "./ism";
import { fetchDisclosures, fetchInvestorFlows, fetchItemSector, fetchSectors } from "./naverExtra";
import type { SecSource } from "./sec";

/** 매크로 스냅숏 공급자(FRED 또는 샘플). override.ism은 사용자가 직접 입력한 ISM */
export interface MacroSource {
  readonly sample: boolean;
  getSnapshot(override?: MacroSnapshotOverride): Promise<{ snapshot: MacroSnapshot; errors: string[]; fetchedAt: string }>;
}

/** 종목 보조 데이터 공급자. 국내: 수급·공시·업종(+DART), 미국: SEC 공시·야후 보유 현황 */
export interface ExtrasSource {
  readonly sample: boolean;
  investorFlows(code: string): Promise<InvestorFlow[]>;
  disclosures(code: string): Promise<Disclosure[]>;
  itemSector(code: string): Promise<{ no: string; name: string } | null>;
  sectors(): Promise<SectorRow[]>;
  /** DART 오픈API(국내 공시·정기보고서). 키가 있을 때만 */
  readonly dart?: DartSource | null;
  /** SEC EDGAR(미국 공시) */
  readonly sec?: SecSource | null;
  /** 미국 종목의 기관·내부자·공매도 현황(공급자가 있을 때만) */
  readonly usHolders?: ((code: string) => Promise<UsHolders>) | undefined;
}

export interface ExtrasOptions {
  dart?: DartSource | null;
  sec?: SecSource | null;
  usHolders?: (code: string) => Promise<UsHolders>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class NaverExtras implements ExtrasSource {
  readonly sample = false;
  readonly dart: DartSource | null;
  readonly sec: SecSource | null;
  readonly usHolders: ((code: string) => Promise<UsHolders>) | undefined;
  constructor(private http: Http, opts: ExtrasOptions = {}) {
    this.dart = opts.dart ?? null;
    this.sec = opts.sec ?? null;
    this.usHolders = opts.usHolders;
  }
  investorFlows(code: string) {
    return fetchInvestorFlows(this.http, code, 2);
  }
  disclosures(code: string) {
    return fetchDisclosures(this.http, code);
  }
  itemSector(code: string) {
    return fetchItemSector(this.http, code);
  }
  sectors() {
    return fetchSectors(this.http);
  }
}

/** 공시 근거로 볼 최근 일수와, 정기보고서 현황을 찾을 때 받는 기간(일) */
const DART_REPORT_DAYS = 400;

/** 수급·공시·업종을 모아 근거로 만든다. 하나가 실패해도 나머지는 돌려준다. today는 그 시장 현지 날짜 */
export async function loadStockExtras(src: ExtrasSource, code: string, today: string): Promise<StockExtras> {
  const region = regionOfCode(code);
  const out: StockExtras = { code, region, supported: false, flows: [], flowScore: 0, disclosures: [], sector: null, notes: [], errors: [], disclosureSource: null };
  if (region === "US") return loadUsExtras(src, code, today, out);
  out.supported = /^\d{6}$/.test(code);
  if (!out.supported) return out;

  try {
    out.flows = await src.investorFlows(code);
    const f = flowSignals(out.flows);
    out.flowScore = f.score;
    out.notes.push(...f.notes);
  } catch (e) {
    out.errors.push(`수급: ${msg(e)}`);
  }

  // 공시: DART 키가 있으면 DART(정기보고서 현황 포함), 실패하거나 없으면 네이버 공시 목록
  let gotDisclosures = false;
  if (src.dart) {
    try {
      const all = await src.dart.disclosures(code, DART_REPORT_DAYS);
      out.reports = periodicReports(all).map(({ period, kind, filed, deadline, late }) => ({ period, kind, filed, deadline, late }));
      const from = new Date(Date.parse(today) - 90 * 86_400_000).toISOString().slice(0, 10);
      out.disclosures = all.filter((d) => d.date >= from);
      out.disclosureSource = "DART";
      gotDisclosures = true;
    } catch (e) {
      out.errors.push(`DART: ${msg(e)} — 네이버 공시 목록으로 대신해요`);
    }
  }
  if (!gotDisclosures) {
    try {
      out.disclosures = await src.disclosures(code);
      out.disclosureSource = "네이버";
      gotDisclosures = true;
    } catch (e) {
      out.errors.push(`공시: ${msg(e)}`);
    }
  }
  if (gotDisclosures) out.notes.push(...disclosureNotes(out.disclosures, today));
  const late = (out.reports ?? []).filter((r) => r.late);
  if (late.length)
    out.notes.push({ tone: "warn", text: `정기보고서 기한을 넘겨 낸 적이 있어요(${late.map((r) => `${r.period} ${r.kind}`).join(", ")}).`, rule: "3.6 설춘환" });

  try {
    const mine = await src.itemSector(code);
    if (mine) {
      const rows = await src.sectors();
      const s = sectorStrength(rows, mine.no);
      out.sector = { ...mine, changePct: rows.find((r) => r.no === mine.no)?.changePct ?? null, rank: s.rank, total: s.total };
      out.notes.push(...s.notes);
    }
  } catch (e) {
    out.errors.push(`업종: ${msg(e)}`);
  }
  return out;
}

/** 미국 종목: SEC 공시 + 야후 보유 현황(기관·내부자·공매도). 수급은 점수를 깎지 않는 가점으로만 쓴다 */
async function loadUsExtras(src: ExtrasSource, code: string, today: string, out: StockExtras): Promise<StockExtras> {
  out.supported = !!(src.sec || src.usHolders);
  out.us = { holders: null };
  if (src.usHolders) {
    try {
      const h = await src.usHolders(code);
      out.us.holders = h;
      const f = usFlowSignals(h);
      out.flowScore = f.score;
      out.notes.push(...f.notes);
    } catch (e) {
      out.errors.push(`보유 현황: ${msg(e)}`);
    }
  }
  if (src.sec) {
    try {
      out.disclosures = await src.sec.filings(code, 90);
      out.disclosureSource = "SEC";
      out.notes.push(...secDisclosureNotes(out.disclosures, today));
    } catch (e) {
      out.errors.push(`SEC 공시: ${msg(e)}`);
    }
  } else if (out.supported) out.errors.push("SEC 공시: SEC_USER_AGENT가 없어 받지 않았어요(server/.env 참고)");
  return out;
}

// ───────────────────────── 샘플 모드 ─────────────────────────

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const day = (base: Date, back: number) => new Date(base.getTime() - back * 86_400_000).toISOString().slice(0, 10);

const SAMPLE_SECTORS = ["반도체", "자동차", "은행", "제약", "화학", "철강", "조선", "통신서비스", "게임엔터테인먼트", "건설", "음식료품", "소프트웨어"];
const SAMPLE_TITLES = ["단일판매ㆍ공급계약체결", "주식등의대량보유상황보고서", "현금ㆍ현물배당결정", "자기주식취득결정", "기업설명회(IR)개최", "유상증자결정"];

/** 종목 코드로 항상 같은 값이 나오는 가짜 수급·공시·업종(샘플 모드 전용, 실제 값이 아니다) */
export class MockExtras implements ExtrasSource {
  readonly sample = true;
  readonly dart: DartSource | null;
  readonly sec: SecSource | null;
  readonly usHolders: ((code: string) => Promise<UsHolders>) | undefined;
  /** candles를 주면 수급 표의 날짜·종가·거래량을 샘플 일봉과 맞춘다. opts로 샘플 DART·SEC·미국 보유 현황을 붙인다 */
  constructor(private now: () => Date = () => new Date(), private candles?: (code: string, count: number) => Promise<Candle[]>, opts: ExtrasOptions = {}) {
    this.dart = opts.dart ?? null;
    this.sec = opts.sec ?? null;
    this.usHolders = opts.usHolders;
  }

  async investorFlows(code: string): Promise<InvestorFlow[]> {
    if (!/^\d{6}$/.test(code)) return [];
    const r = rng(hash(code + "flow"));
    const bias = r() - 0.4;
    let bars: { date: string; close: number; volume: number }[] = (await this.candles?.(code, 30).catch(() => [])) ?? [];
    if (!bars.length) {
      let close = 10_000 + Math.floor(r() * 90) * 1000;
      for (let i = 39; i >= 0; i--) {
        const d = new Date(this.now().getTime() - i * 86_400_000);
        if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
        close = Math.max(100, Math.round(close * (1 + (r() - 0.5) * 0.04)));
        bars.push({ date: d.toISOString().slice(0, 10), close, volume: Math.round(100_000 + r() * 900_000) });
      }
    }
    let hold = 10 + r() * 40;
    return bars.map((b) => {
      hold = Math.min(90, Math.max(1, hold + (r() - 0.5 + bias) * 0.4));
      return {
        ...b, institutionNet: Math.round((r() - 0.5 + bias) * b.volume * 0.1), foreignNet: Math.round((r() - 0.5 + bias) * b.volume * 0.15), foreignHoldPct: Math.round(hold * 100) / 100,
      };
    });
  }

  async disclosures(code: string): Promise<Disclosure[]> {
    if (!/^\d{6}$/.test(code)) return [];
    const r = rng(hash(code + "dis"));
    return Array.from({ length: 4 }, (_, i) => ({ date: day(this.now(), Math.floor(r() * 25) + i), title: SAMPLE_TITLES[Math.floor(r() * SAMPLE_TITLES.length)]! })).sort((a, b) =>
      b.date.localeCompare(a.date),
    );
  }

  async itemSector(code: string) {
    if (!/^\d{6}$/.test(code)) return null;
    const i = hash(code + "sec") % SAMPLE_SECTORS.length;
    return { no: String(100 + i), name: SAMPLE_SECTORS[i]! };
  }

  async sectors(): Promise<SectorRow[]> {
    const r = rng(hash(this.now().toISOString().slice(0, 10)));
    return SAMPLE_SECTORS.map((name, i) => ({ no: String(100 + i), name, changePct: Math.round((r() - 0.45) * 600) / 100 }));
  }
}

/** 그럴듯한 범위의 가짜 FRED 시계열로 만든 매크로 스냅숏(샘플 모드 전용) */
export class MockMacro implements MacroSource {
  readonly sample = true;
  constructor(private now: () => Date = () => new Date()) {}

  async getSnapshot(override?: MacroSnapshotOverride) {
    const now = this.now();
    const errors: string[] = [];
    const r = rng(hash("macro"));
    const series: Partial<Record<MacroSeriesId, MacroSeriesPoint[]>> = {};
    const daily = (start: number, vol: number, floor = -Infinity) => {
      let v = start;
      const pts: MacroSeriesPoint[] = [];
      for (let i = 400; i >= 0; i--) {
        v = Math.max(floor, v + (r() - 0.5) * vol);
        pts.push({ date: day(now, i), value: Math.round(v * 100) / 100 });
      }
      return pts;
    };
    series.T10Y2Y = daily(0.3, 0.06);
    series.VIXCLS = daily(17, 1.2, 9);
    series.DGS10 = daily(4.2, 0.05, 0.5);
    series.DEXKOUS = daily(1350, 6, 1000);
    const monthly = (start: number, growth: number, months: number, everyMonths: number) => {
      const pts: MacroSeriesPoint[] = [];
      const y = now.getUTCFullYear(), m = now.getUTCMonth();
      for (let k = months; k >= 2; k -= everyMonths) {
        const d = new Date(Date.UTC(y, m - k, 1)).toISOString().slice(0, 10);
        pts.push({ date: d, value: Math.round(start * (1 + growth) ** ((months - k) / 12) * 10) / 10 });
      }
      return pts;
    };
    series.M2SL = monthly(21_000, 0.045, 30, 1);
    series.GDP = monthly(28_000, 0.05, 30, 3);
    Object.assign(series, sampleIsmProxySeries(now.getTime()));
    // ISM: 직접 입력이 있으면 그 값, 없으면 샘플 ISM
    let ism = await new MockIsmSource(() => now.getTime()).getLatest().then((r): IsmReading => r);
    if (override?.ism) {
      const m = manualIsm(override.ism, now.toISOString().slice(0, 10));
      if ("error" in m) errors.push(`ISM 수동 입력: ${m.error} — 샘플 값으로 대신해요`);
      else ism = m.reading;
    }
    return { snapshot: buildMacroSnapshot(series, { ism }), errors, fetchedAt: now.toISOString() };
  }
}
