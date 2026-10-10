import {
  buildDailyReview, marketClock, POSTURE_LABEL,
  type Candle, type DailyReview, type Market, type MarketRowLike, type Posture, type Region, type SectorRow,
} from "@jusik/shared";
import type { ExtrasSource } from "./extras";
import type { Deps } from "./scanner";
import { REVIEW_LIMIT } from "./state";

export interface ReviewDeps extends Deps {
  /** 국내 업종 등락률(섹터 흐름). 없으면 섹터는 '직접 확인'으로 남는다 */
  extras?: ExtrasSource | null;
}

const INDEX_NAME: Record<Market, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "S&P 500" };
export const MARKETS_OF: Record<Region, Market[]> = { KR: ["KOSPI", "KOSDAQ"], US: ["US"] };
/** 52주 신고가를 판정할 상승률 상위 종목 수(종목마다 일봉 요청이 하나씩 나가서 적게 둔다) */
const NEW_HIGH_CHECK = 8;
/** 보수적인 순서(앞이 더 보수적) */
const POSTURE_ORDER: Posture[] = ["DEFENSE", "NEUTRAL", "ATTACK"];

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 지금 시각 기준 그 지역의 일일 복기(M5-01)를 만들어 저장한다. 같은 날짜·지역 복기가 있으면 새로 만들되 사용자 메모는 남긴다.
 * 장 마감 직후에 부르면 그날 마감 순위표·지수로 채워진다.
 */
export async function buildReviewNow(deps: ReviewDeps, region: Region): Promise<{ review: DailyReview; errors: string[] }> {
  const { provider, store } = deps;
  const at = (deps.now ?? (() => new Date()))();
  const date = marketClock(region, at).date;
  const markets = MARKETS_OF[region].filter((m) => store.state.settings.markets[m]);
  const errors: string[] = [];

  const indices: { name: string; candles: Candle[] }[] = [];
  for (const m of markets) {
    try {
      indices.push({ name: INDEX_NAME[m], candles: await provider.getIndexCandles(m, 40) });
    } catch (e) {
      errors.push(`${INDEX_NAME[m]} 지수: ${msg(e)}`);
    }
  }

  const universe: MarketRowLike[] = [];
  for (const m of markets) {
    try {
      const rows = await provider.getUniverse(m);
      store.state.lastUniverse[m] = { at: at.toISOString(), rows };
      universe.push(...rows);
    } catch (e) {
      // 새로 받지 못하면 같은 날 스캔 때 받아 둔 순위표를 쓴다
      const last = store.state.lastUniverse[m];
      if (last && marketClock(region, new Date(last.at)).date === date) universe.push(...last.rows);
      errors.push(`${m} 순위표: ${msg(e)}`);
    }
  }

  const candlesByCode: Record<string, Candle[]> = {};
  const gainers = universe.filter((r) => r.changePct > 0).sort((a, b) => b.changePct - a.changePct);
  const seen = new Set<string>();
  for (const r of gainers) {
    if (seen.size >= NEW_HIGH_CHECK) break;
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    try {
      candlesByCode[r.code] = await provider.getCandles(r.code, 260);
    } catch {
      /* 그 종목만 신고가 판정에서 빠진다 */
    }
  }

  let sectors: SectorRow[] | undefined;
  if (region === "KR" && deps.extras) {
    try {
      sectors = await deps.extras.sectors();
    } catch (e) {
      errors.push(`업종 시세: ${msg(e)}`);
    }
  }

  const scan = store.state.latestScan;
  const postures = markets.map((m) => scan?.postures?.[m]?.posture).filter((p): p is Posture => p != null);
  const worst = POSTURE_ORDER.find((p) => postures.includes(p));
  const review = buildDailyReview({
    date, region, indices, universe,
    candidates: scan?.candidates ?? [],
    journal: store.state.journal,
    posture: worst ? POSTURE_LABEL[worst] : null,
    regime: markets.map((m) => scan?.regimes[m]).find((r) => r != null) ?? null,
    candlesByCode,
    sectors,
  });

  const list = store.state.reviews;
  const i = list.findIndex((r) => r.date === date && r.region === region);
  if (i >= 0) {
    const prev = list[i]!;
    if (prev.userComment) review.userComment = prev.userComment;
    list[i] = review;
  } else list.push(review);
  list.sort((a, b) => a.date.localeCompare(b.date) || a.region.localeCompare(b.region));
  if (list.length > REVIEW_LIMIT) list.splice(0, list.length - REVIEW_LIMIT);
  store.save();
  return { review, errors };
}
