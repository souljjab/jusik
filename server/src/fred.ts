// ISM·지역 연준 시리즈가 추가된 macro 모듈이라 상대 경로로 가져온다(통합 때 "@jusik/shared"로 바꾼다)
import { buildMacroSnapshot, MACRO_SERIES_IDS, type IsmReading, type MacroSeriesId, type MacroSeriesPoint, type MacroSnapshot } from "@jusik/shared";
import type { Http } from "./http";
import { manualIsm } from "./ism";

/*
 * 미국 FRED 매크로 시계열 수집 — API 키가 필요 없는 그래프 CSV 다운로드 주소를 읽는다.
 * ISM 제조업지수는 FRED에 없어 server/src/ism.ts(사이트) 또는 수동 입력으로 받고, 둘 다 없으면 지역 연준 지수 두 개를 대용으로 쓴다.
 * 응답 형식(헤더 "DATE,ID" 또는 "observation_date,ID", 결측값 "." 또는 빈칸)은 알려진 형식을 기준으로 짰고,
 * 이 개발 환경에서는 외부 접속이 막혀 실제 응답과 대조하지 못했다. 처음 연결할 때 꼭 실제 응답으로 확인하세요.
 */

export const FRED = {
  /** cosd: 시작일(YYYY-MM-DD). 받는 양을 줄이려는 용도이며, 무시되더라도 전체 기간이 올 뿐이다 */
  csv: (id: MacroSeriesId, cosd?: string) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}${cosd ? `&cosd=${cosd}` : ""}`,
};

/** FRED 그래프 CSV → 날짜 오름차순 관측치. 형식이 다르거나 HTML·오류 응답이면 []. 실제 응답과 대조하지 못함(미검증) */
export function parseFredCsv(text: string): MacroSeriesPoint[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const header = lines[0]?.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  if (!header || header.length < 2 || !/^(DATE|observation_date)$/i.test(header[0]!)) return [];
  const byDate = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const [d, v] = line.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (v == null || v === "" || v === ".") continue; // 휴일·결측
    const value = Number(v);
    if (!Number.isFinite(value)) continue;
    byDate.set(d, value);
  }
  return [...byDate].map(([date, value]) => ({ date, value })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** ISM 최신 값 공급자(ism.ts의 IsmSource·MockIsmSource). lastError가 있으면 errors에 싣는다 */
export interface IsmLatestSource {
  getLatest(): Promise<IsmReading | null>;
  readonly lastError?: string | null;
}

/** getSnapshot 호출마다 줄 수 있는 덮어쓰기 값 */
export interface MacroSnapshotOverride {
  /** 수동 ISM 입력(발표일은 ismReleaseDate(month)). 사이트에서 읽은 값보다 우선한다. null·없음이면 사이트 값을 쓴다 */
  ism?: { value: number; month: string } | null;
}

export interface MacroProviderOptions {
  /** 몇 일 전부터 받을지(cosd). null이면 전체 기간. 기본 약 3년(M2·GDP 전년 대비와 재현에 충분한 양) */
  lookbackDays?: number | null;
  /** 일부 시리즈가 실패했을 때 다시 시도하기까지의 캐시 시간(ms) */
  partialTtlMs?: number;
  /** 테스트용 시계 */
  now?: () => number;
  /** ISM 사이트 공급자. 없으면 수동 입력과 지역 연준 대용 지표만 쓴다 */
  ism?: IsmLatestSource;
}

export interface MacroFetchResult {
  series: Partial<Record<MacroSeriesId, MacroSeriesPoint[]>>;
  errors: string[];
  /** 수집 시각(ISO) */
  fetchedAt: string;
}

/**
 * FRED 8개 시리즈(지역 연준 ISM 대용 2개 포함)를 순차로 받고 ISM 값을 붙여 매크로 스냅샷을 만든다.
 * 시리즈별 실패와 ISM 실패는 errors에 담고 계속한다(ISM 때문에 스냅샷이 실패하지 않는다)
 */
export class MacroProvider {
  readonly sample = false;
  private cached: { at: number; ttl: number; value: Promise<MacroFetchResult> } | null = null;
  /** 시리즈별 마지막으로 받은 값. 새로 받기가 실패하면 이걸로 채운다(일시 장애로 매크로 감점이 사라져 투자 상한이 올라가지 않게) */
  private lastGood: Partial<Record<MacroSeriesId, MacroSeriesPoint[]>> = {};
  private readonly now: () => number;

  constructor(private http: Http, private ttlMs = 6 * 3_600_000, private opts: MacroProviderOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  /** 받아 온 원자료(과거 시점 재현은 buildMacroSnapshot(series, { asOf })로) */
  getSeries(): Promise<MacroFetchResult> {
    const c = this.cached;
    if (c && this.now() - c.at < c.ttl) return c.value;
    const at = this.now();
    // 결과가 나오기 전에는 진행 중인 요청을 함께 쓴다
    const entry = { at, ttl: Infinity, value: this.load() };
    this.cached = entry;
    entry.value.then(
      (r) => {
        const ok = Object.keys(r.series).length;
        // 전부 실패면 캐시하지 않고, 일부 실패면 짧게만 둔다
        entry.ttl = ok === 0 ? 0 : r.errors.length ? Math.min(this.ttlMs, this.opts.partialTtlMs ?? 10 * 60_000) : this.ttlMs;
      },
      () => (entry.ttl = 0),
    );
    return entry.value;
  }

  /** override.ism(수동 입력)이 있으면 사이트에서 읽은 ISM보다 우선한다 */
  async getSnapshot(override?: MacroSnapshotOverride): Promise<{ snapshot: MacroSnapshot; errors: string[]; fetchedAt: string }> {
    const [r, scraped] = await Promise.all([this.getSeries(), this.scrapedIsm()]);
    const errors = [...r.errors];
    let ism: IsmReading | null = null;
    if (override?.ism) {
      const m = manualIsm(override.ism, new Date(this.now()).toISOString().slice(0, 10));
      if ("error" in m) errors.push(`ISM 수동 입력: ${m.error} — 사이트 값으로 대신해요`);
      else {
        ism = m.reading;
        // 수동 값을 쓰는 동안 사이트 오류는 알리지 않고, 더 새 값이 보이면 알려 준다
        const s = scraped.reading;
        if (s && s.month > ism.month) errors.push(`ISM: 사이트에 더 새 값(${s.month} ${s.value})이 있어요. 수동 입력(${ism.month})을 지우면 사이트 값을 써요`);
      }
    }
    if (!ism) {
      ism = scraped.reading;
      if (scraped.error) errors.push(`ISM: ${scraped.error}${ism ? ` — 지난번에 받은 값(${ism.month})으로 대신해요` : ""}`);
    }
    const snapshot = buildMacroSnapshot(r.series, { ism });
    if (ism && !snapshot.ism) errors.push(`ISM ${ism.month}(${ism.source}) 값이 오래돼 쓰지 않았어요 — 지역 연준 지수로 대신 판단해요`);
    return { snapshot, errors, fetchedAt: r.fetchedAt };
  }

  /** 사이트 ISM. 던지는 공급자도 받아 오류 문자열로 바꾼다 */
  private async scrapedIsm(): Promise<{ reading: IsmReading | null; error: string | null }> {
    const src = this.opts.ism;
    if (!src) return { reading: null, error: null };
    try {
      const reading = await src.getLatest();
      return { reading, error: src.lastError ?? (reading ? null : "값을 받지 못했어요") };
    } catch (e) {
      return { reading: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async load(): Promise<MacroFetchResult> {
    const lb = this.opts.lookbackDays === undefined ? 1100 : this.opts.lookbackDays;
    const cosd = lb == null ? undefined : new Date(this.now() - lb * 86_400_000).toISOString().slice(0, 10);
    const series: Partial<Record<MacroSeriesId, MacroSeriesPoint[]>> = {};
    const errors: string[] = [];
    for (const id of MACRO_SERIES_IDS) {
      const stale = this.lastGood[id] ? " — 지난번에 받은 값으로 대신해요" : "";
      try {
        const points = parseFredCsv(await this.http.get(FRED.csv(id, cosd)));
        if (points.length) {
          series[id] = points;
          this.lastGood[id] = points;
        } else errors.push(`${id}: 응답에서 값을 찾지 못했어요(형식이 바뀌었을 수 있어요)${stale}`);
      } catch (e) {
        errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}${stale}`);
      }
      if (!series[id] && this.lastGood[id]) series[id] = this.lastGood[id];
    }
    return { series, errors, fetchedAt: new Date(this.now()).toISOString() };
  }
}
