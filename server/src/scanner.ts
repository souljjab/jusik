import {
  DAYTRADE_BY_REGION, currencyOfRegion, marketClock, marketRegime, newPaperAccount, PAPER_COSTS, paperCheckExits, paperOpen, planWithCash, regionOf, scoreDayTrade,
  type Currency, type DayTradeCandidate, type DayTradeParams, type JournalEntry, type Market, type PaperAccount, type Region,
} from "@jusik/shared";
import type { MarketDataProvider, UniverseRow } from "./provider";
import { HISTORY_LIMIT, type ScanResult, type Settings, type Store } from "./state";

export interface Deps {
  provider: MarketDataProvider;
  store: Store;
  now?: () => Date;
}

const nowOf = (d: Deps) => (d.now ?? (() => new Date()))();
const MARKETS: Market[] = ["KOSPI", "KOSDAQ", "US"];

export function paramsFor(region: Region, s: Settings): DayTradeParams {
  return { ...DAYTRADE_BY_REGION[region], minScore: s.minScore, minTradeValue: region === "KR" ? s.minTradeValueKRW : s.minTradeValueUSD };
}

const REGIONS: Region[] = ["KR", "US"];

/** 이번 계획의 기준이 되는 현금: 모의매매를 켰으면 모의계좌 현금, 아니면 설정한 예수금 */
export function availableCash(s: Settings, paper: Record<Currency, PaperAccount>, cur: Currency): number {
  if (s.paperEnabled) return paper[cur].cash;
  return cur === "KRW" ? s.depositKRW : s.depositUSD;
}

function buildPlans(store: Store, candidates: DayTradeCandidate[]) {
  const { settings: s, paper } = store.state;
  const plans: ScanResult["plans"] = {};
  for (const region of REGIONS) {
    const cur = currencyOfRegion(region);
    const acct = paper[cur];
    plans[cur] = planWithCash(
      candidates.filter((c) => regionOf(c.market) === region),
      {
        cash: availableCash(s, paper, cur),
        riskPct: s.riskPct, maxWeightPct: s.maxWeightPct, maxPositions: s.maxPositions, reservePct: s.reservePct,
        feeRate: PAPER_COSTS[region].feeRate,
        heldCodes: acct.positions.map((p) => p.code),
        heldCount: acct.positions.length,
      },
    );
  }
  return plans;
}

/** 시장별 후보 풀을 읽어 규칙에 맞는 단타 후보를 찾고, 예수금으로 살 수 있는 계획을 만든다. */
export async function runScan(deps: Deps): Promise<ScanResult> {
  const { provider, store } = deps;
  const s = store.state.settings;
  const at = nowOf(deps);
  const markets = MARKETS.filter((m) => s.markets[m]);
  const result: ScanResult = {
    id: globalThis.crypto.randomUUID(), at: at.toISOString(), markets, universeCount: 0, scannedCount: 0, rejected: {}, regimes: {},
    candidates: [], plans: {}, executed: [], errors: [],
  };
  const reject = (r: string) => (result.rejected[r] = (result.rejected[r] ?? 0) + 1);

  for (const market of markets) {
    const region = regionOf(market);
    const params = paramsFor(region, s);
    try {
      const idx = await provider.getIndexCandles(market, 250);
      result.regimes[market] = marketRegime(idx)?.regime ?? null;
    } catch (e) {
      result.regimes[market] = null;
      result.errors.push(`${market} 지수: ${msg(e)}`);
    }

    let rows: UniverseRow[] = [];
    try {
      rows = await provider.getUniverse(market);
    } catch (e) {
      result.errors.push(`${market} 후보 목록: ${msg(e)}`);
      continue;
    }
    result.universeCount += rows.length;
    const pool = rows
      .filter((r) => {
        const ok = r.price >= params.minPrice && r.changePct >= params.minChangePct && r.changePct <= params.maxChangePct && r.tradeValue >= params.minTradeValue;
        if (!ok) reject("사전 필터(가격·등락률·거래대금)");
        return ok;
      })
      .sort((a, b) => b.tradeValue - a.tradeValue)
      .slice(0, s.maxScanPerMarket);

    for (const row of pool) {
      try {
        const candles = await provider.getCandles(row.code, 120);
        result.scannedCount++;
        const last = candles.at(-1);
        if (!last || Date.parse(at.toISOString().slice(0, 10)) - Date.parse(last.date) > 7 * 86_400_000) {
          reject("오래된 데이터");
          continue;
        }
        const r = scoreDayTrade({ code: row.code, name: row.name, market }, candles, result.regimes[market] ?? null, params);
        if (r.ok) result.candidates.push(r.candidate);
        else reject(r.reason.replace(/\(\d+\)$/, ""));
      } catch (e) {
        result.errors.push(`${row.code}: ${msg(e)}`);
      }
    }
  }

  result.candidates.sort((a, b) => b.score - a.score);
  result.plans = buildPlans(store, result.candidates);

  if (s.paperEnabled) await autoTrade(deps, result, at);

  store.state.latestScan = result;
  for (const c of result.candidates.slice(0, 10))
    store.state.history.push({ at: result.at, market: c.market, code: c.code, name: c.name, score: c.score, price: c.price, entry: c.entry, stop: c.stop, target: c.target });
  if (store.state.history.length > HISTORY_LIMIT) store.state.history.splice(0, store.state.history.length - HISTORY_LIMIT);
  store.save();
  return result;
}

/** 모의매매 자동 실행: 보유 종목 청산 조건을 먼저 확인하고, 진입 가능 시간이면 계획대로 진입한다. 실제 주문은 하지 않는다. */
async function autoTrade(deps: Deps, scan: ScanResult, at: Date) {
  const { provider, store } = deps;
  for (const region of REGIONS) {
    const cur = currencyOfRegion(region);
    const clock = marketClock(region, at);
    if (!clock.isOpen) continue;
    let acct = store.state.paper[cur];
    const entries: JournalEntry[] = [];

    if (acct.positions.length) {
      const prices = await provider.getPrices(acct.positions.map((p) => p.code)).catch(() => ({}));
      const r = paperCheckExits(acct, prices, clock, PAPER_COSTS[region]);
      acct = r.acct;
      entries.push(...r.entries);
    }
    if (clock.inEntryWindow) {
      store.state.paper[cur] = acct;
      const plan = buildPlans(store, scan.candidates)[cur]!;
      scan.plans[cur] = plan; // 진입 시점의 계획을 그대로 남긴다(실행된 종목은 executed로 표시)
      for (const item of plan.items) {
        const o = paperOpen(acct, item, at, clock, PAPER_COSTS[region]);
        if (o) {
          acct = o.acct;
          entries.push(o.entry);
          scan.executed.push(item.candidate.code);
        }
      }
    }
    store.state.paper[cur] = acct;
    store.state.journal.push(...entries);
  }
}

/** 보유 중인 모의 포지션의 손절·목표·보유기간을 현재가로 점검한다(장중·마감 직후). 청산된 건수를 돌려준다. */
export async function monitorPositions(deps: Deps): Promise<number> {
  const { provider, store } = deps;
  const at = nowOf(deps);
  let closed = 0;
  for (const region of REGIONS) {
    const cur = currencyOfRegion(region);
    const acct = store.state.paper[cur];
    const clock = marketClock(region, at);
    if (!acct.positions.length || !(clock.isOpen || clock.justClosed)) continue;
    const prices = await provider.getPrices(acct.positions.map((p) => p.code));
    const r = paperCheckExits(acct, prices, clock, PAPER_COSTS[region]);
    store.state.paper[cur] = r.acct;
    store.state.journal.push(...r.entries);
    closed += r.entries.length;
  }
  if (closed || store.state.paper.KRW.positions.length || store.state.paper.USD.positions.length) store.save();
  return closed;
}

/** 설정이 바뀌었을 때 모의계좌를 예수금에 맞춘다(보유 포지션이 없을 때만). */
export function syncPaperWithDeposit(store: Store, force = false) {
  const { settings: s, paper } = store.state;
  if (force || paper.KRW.positions.length === 0) store.state.paper.KRW = newPaperAccount(s.depositKRW);
  if (force || paper.USD.positions.length === 0) store.state.paper.USD = newPaperAccount(s.depositUSD);
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
