import {
  assessRegime, consecutiveLosses, currencyOfRegion, DAYTRADE_BY_REGION, marketClock, marketRegime, newPaperAccount, PAPER_COSTS, paperCheckExits, paperEquity, paperOpen,
  paperTradesFromJournal, paperUnrealizedPnl, planWithCash, regionOf, regionOfCode, scoreDayTrade, todayPnl, tradingGuards,
  type Currency, type DayTradeParams, type GuardResult, type JournalEntry, type MacroSnapshot, type Market, type PaperAccount, type Region,
} from "@jusik/shared";
import type { MacroSource } from "./extras";
import type { MarketDataProvider, UniverseRow } from "./provider";
import { HISTORY_LIMIT, type ScanResult, type Settings, type Store } from "./state";

export interface Deps {
  provider: MarketDataProvider;
  store: Store;
  /** 매크로(FRED) 스냅숏. 없으면 국면 점수에서 매크로를 뺀다 */
  macro?: MacroSource | null;
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

/**
 * 지역의 국면별 투자 상한(%): 그 지역에서 스캔한 시장 중 가장 보수적인(낮은) 상한.
 * 국면을 판정하지 못한 시장은 중립 상한으로 본다(데이터가 없을 때 공격으로 가지 않게).
 */
export function exposureCapFor(s: Settings, scan: Pick<ScanResult, "markets" | "postures">, region: Region): number {
  const caps = scan.markets.filter((m) => regionOf(m) === region).map((m) => scan.postures?.[m]?.exposureCapPct ?? s.postureCaps.NEUTRAL);
  return caps.length ? Math.min(...caps) : s.postureCaps.NEUTRAL;
}

const heldValueOf = (acct: PaperAccount) => acct.positions.reduce((a, p) => a + p.qty * (p.lastPrice ?? p.entryPrice), 0);

function buildPlans(store: Store, scan: ScanResult) {
  const { settings: s, paper } = store.state;
  const plans: ScanResult["plans"] = {};
  scan.exposureCaps ??= {};
  for (const region of REGIONS) {
    const cur = currencyOfRegion(region);
    const acct = paper[cur];
    const cap = exposureCapFor(s, scan, region);
    scan.exposureCaps[cur] = cap;
    plans[cur] = planWithCash(
      scan.candidates.filter((c) => regionOf(c.market) === region),
      {
        cash: availableCash(s, paper, cur),
        riskPct: s.riskPct, maxWeightPct: s.maxWeightPct, maxPositions: s.maxPositions, reservePct: s.reservePct,
        feeRate: PAPER_COSTS[region].feeRate,
        heldCodes: acct.positions.map((p) => p.code),
        heldCount: acct.positions.length,
        // 모의매매를 끄면 실제 보유분을 모르므로 예수금 × 상한만 적용한다
        exposureCapPct: cap,
        heldValue: s.paperEnabled ? heldValueOf(acct) : 0,
      },
    );
  }
  return plans;
}

const STREAK_RULE = "5.5 박용선·슈웨거";

/**
 * 계좌 단위 리스크 가드(M4-04 일일 손실 한도, 5.5 연속 손실 휴식). 모의계좌와 자동(모의) 매매 기록으로 계산한다.
 * 연속 손실 휴식은 마지막 손실이 난 그날만 진입을 멈추고, 다음 날부터는 규모를 줄이라는 경고로 바꾼다
 * (계속 막으면 새 거래가 없어 연속 손실이 영원히 풀리지 않는다).
 */
export function guardsFor(store: Store, region: Region, today: string, pending: JournalEntry[] = []): GuardResult {
  const { settings: s, paper, journal } = store.state;
  const acct = paper[currencyOfRegion(region)];
  const mine = [...journal, ...pending].filter((e) => regionOfCode(e.code) === region);
  const closed = paperTradesFromJournal(mine).map((t) => t.returnPct);
  const lastSell = mine.filter((e) => e.source === "자동(모의)" && e.side === "SELL").reduce<string | null>((a, e) => (a == null || e.date > a ? e.date : a), null);
  const streakToday = lastSell === today;
  const pnl = todayPnl(mine, today) + paperUnrealizedPnl(acct);
  const g = tradingGuards({
    closedReturnsPct: streakToday ? closed : [],
    todayPnl: pnl,
    equityStartOfDay: paperEquity(acct) - pnl,
    riskPct: s.riskPct,
    maxWeightPct: s.maxWeightPct,
    params: { dailyLossLimitPct: s.dailyLossLimitPct, maxConsecutiveLosses: s.maxConsecutiveLosses },
  });
  const streak = consecutiveLosses(closed);
  if (!streakToday && s.maxConsecutiveLosses > 0 && streak >= s.maxConsecutiveLosses)
    g.notes.push({ tone: "warn", text: `최근 ${streak}번 연속 손실 뒤 하루 쉬었어요. 다시 진입하되 규모를 줄이세요.`, rule: STREAK_RULE });
  return g;
}

async function loadMacro(deps: Deps, result: ScanResult): Promise<MacroSnapshot | null> {
  if (!deps.macro) return null;
  try {
    const m = await deps.macro.getSnapshot();
    if (m.errors.length) result.errors.push(`매크로(FRED) ${m.errors.length}개 시리즈 실패: ${m.errors[0]}`);
    result.macroAsOf = m.snapshot.asOf;
    return m.snapshot.asOf ? m.snapshot : null;
  } catch (e) {
    result.errors.push(`매크로(FRED): ${msg(e)}`);
    return null;
  }
}

/** 시장별 후보 풀을 읽어 규칙에 맞는 단타 후보를 찾고, 예수금으로 살 수 있는 계획을 만든다. */
export async function runScan(deps: Deps): Promise<ScanResult> {
  const { provider, store } = deps;
  const s = store.state.settings;
  const at = nowOf(deps);
  const markets = MARKETS.filter((m) => s.markets[m]);
  const result: ScanResult = {
    id: globalThis.crypto.randomUUID(), at: at.toISOString(), markets, universeCount: 0, scannedCount: 0, rejected: {}, regimes: {},
    postures: {}, exposureCaps: {}, guards: {}, macroAsOf: null,
    candidates: [], plans: {}, executed: [], errors: [],
  };
  const reject = (r: string) => (result.rejected[r] = (result.rejected[r] ?? 0) + 1);
  const macro = await loadMacro(deps, result);

  for (const market of markets) {
    const region = regionOf(market);
    const params = paramsFor(region, s);
    try {
      const idx = await provider.getIndexCandles(market, 250);
      result.regimes[market] = marketRegime(idx)?.regime ?? null;
      result.postures![market] = assessRegime(idx, macro, s.postureCaps, { region });
    } catch (e) {
      result.regimes[market] = null;
      result.postures![market] = null;
      result.errors.push(`${market} 지수: ${msg(e)}`);
    }

    let rows: UniverseRow[] = [];
    try {
      rows = await provider.getUniverse(market);
    } catch (e) {
      result.errors.push(`${market} 후보 목록: ${msg(e)}`);
      continue;
    }
    store.state.lastUniverse[market] = { at: result.at, rows };
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
  result.plans = buildPlans(store, result);

  if (s.paperEnabled) await autoTrade(deps, result, at);
  // 자동매매가 계산하지 않은 지역도 화면에 보여 줄 가드 상태를 남긴다
  for (const region of REGIONS) {
    const cur = currencyOfRegion(region);
    result.guards![cur] ??= guardsFor(store, region, marketClock(region, at).date);
  }

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
      // 방금 청산한 기록까지 반영한 오늘 손익으로 가드를 본다
      const guard = guardsFor(store, region, clock.date, entries);
      scan.guards![cur] = guard;
      const plan = buildPlans(store, scan)[cur]!;
      scan.plans[cur] = plan; // 진입 시점의 계획을 그대로 남긴다(실행된 종목은 executed로 표시)
      const equity = paperEquity(acct);
      if (!guard.blocked)
        for (const item of plan.items) {
          const o = paperOpen(acct, item, at, clock, PAPER_COSTS[region], scan.regimes[item.candidate.market] ?? null, equity);
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
