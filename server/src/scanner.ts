import {
  assessRegime, consecutiveLosses, currencyOfRegion, DAYTRADE_BY_REGION, marketClock, marketRegime, newPaperAccount, PAPER_COSTS, paperCheckExits, paperEquity, paperOpen,
  paperTradesFromJournal, paperUnrealizedPnl, planWithCash, regionOf, regionOfCode, scoreDayTrade, todayPnl, tradingGuards, weekdaysBetween,
  type Currency, type DayTradeParams, type GuardResult, type JournalEntry, type MacroSnapshot, type Market, type PaperAccount, type Region,
} from "@jusik/shared";
import type { BreadthResult, BreadthSource } from "./breadthSource";
import type { MacroSource } from "./extras";
import { minuteDecision, minuteFor } from "./intradayCheck";
import type { MinuteSource } from "./minute";
import type { MarketDataProvider, UniverseRow } from "./provider";
import { BREADTH_LOG_LIMIT, HISTORY_LIMIT, type ScanResult, type Settings, type Store } from "./state";

export interface Deps {
  provider: MarketDataProvider;
  store: Store;
  /** 매크로(FRED) 스냅숏. 없으면 국면 점수에서 매크로를 뺀다 */
  macro?: MacroSource | null;
  /** 시장 폭(A/D선·MI). 없거나 아직 계산 중이면 국면 점수에서 뺀다 */
  breadth?: BreadthSource | null;
  /** 분봉(모의 자동매매 진입 전 확인) */
  minute?: MinuteSource | null;
  now?: () => Date;
}

/** 시장 폭은 처음 계산할 때 바스켓 종목 일봉을 모두 받아 오래 걸린다. 스캔은 이만큼만 기다리고, 계산은 뒤에서 계속돼 다음 스캔부터 쓰인다 */
export const BREADTH_WAIT_MS = 1500;

/** p가 ms 안에 끝나면 그 값, 아니면 null(p는 계속 진행된다) */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

/** 거래소 전체 상승·하락 종목 수를 그 시장 날짜로 쌓는다(같은 날은 최신 값으로 덮어쓴다) */
export function logBreadthToday(store: Store, market: Market, date: string, today: BreadthResult["today"]) {
  if (!today) return;
  const log = (store.state.breadthLog[market] ??= []);
  const row = { date, ...today };
  const i = log.findIndex((r) => r.date === date);
  if (i >= 0) log[i] = row;
  else log.push(row);
  log.sort((a, b) => a.date.localeCompare(b.date));
  if (log.length > BREADTH_LOG_LIMIT) log.splice(0, log.length - BREADTH_LOG_LIMIT);
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
 * 그 시장 날짜의 첫 점검 때(현재가를 새로 반영하기 전) 모의계좌 자산을 '하루 시작 자산'으로 남긴다.
 * 이 시점의 보유 종목 평가는 전날 마지막 가격이라, 이후 자산 변화가 곧 오늘 손익이다(이전 날 이익이 오늘 손실을 가리지 않는다).
 */
export function markDayStart(store: Store, region: Region, today: string) {
  const cur = currencyOfRegion(region);
  const ds = store.state.dayStart[cur];
  if (!ds || ds.date !== today) store.state.dayStart[cur] = { date: today, equity: paperEquity(store.state.paper[cur]) };
}

/**
 * 계좌 단위 리스크 가드(M4-04 일일 손실 한도, 5.5 연속 손실 휴식). 모의계좌와 자동(모의) 매매 기록으로 계산한다.
 * - 오늘 손익 = 지금 자산 − 하루 시작 자산(markDayStart). 기록이 없으면 오늘 실현 손익 + 평가손실(평가이익은 빼고)
 * - 연속 손실 휴식은 마지막 손실이 난 날과 그다음 거래일까지 신규 진입을 멈춘다. 마감 무렵 시간 청산으로
 *   연속 손실이 채워져도 다음 날 장 전체를 쉬게 하려는 것이다. 그 뒤에는 규모를 줄이라는 경고만 남긴다
 *   (계속 막으면 새 거래가 없어 연속 손실이 영원히 풀리지 않는다).
 */
export function guardsFor(store: Store, region: Region, today: string, pending: JournalEntry[] = []): GuardResult {
  const { settings: s, paper, journal } = store.state;
  const cur = currencyOfRegion(region);
  const acct = paper[cur];
  const mine = [...journal, ...pending].filter((e) => regionOfCode(e.code) === region);
  const closed = paperTradesFromJournal(mine).map((t) => t.returnPct);
  const lastSell = mine.filter((e) => e.source === "자동(모의)" && e.side === "SELL").reduce<string | null>((a, e) => (a == null || e.date > a ? e.date : a), null);
  const resting = lastSell != null && lastSell <= today && weekdaysBetween(lastSell, today) <= 1;
  const equity = paperEquity(acct);
  const ds = store.state.dayStart[cur];
  const pnl = ds && ds.date === today ? equity - ds.equity : todayPnl(mine, today) + Math.min(0, paperUnrealizedPnl(acct));
  const g = tradingGuards({
    closedReturnsPct: resting ? closed : [],
    todayPnl: pnl,
    equityStartOfDay: equity - pnl,
    riskPct: s.riskPct,
    maxWeightPct: s.maxWeightPct,
    params: { dailyLossLimitPct: s.dailyLossLimitPct, maxConsecutiveLosses: s.maxConsecutiveLosses },
  });
  const streak = consecutiveLosses(closed);
  if (s.maxConsecutiveLosses > 0 && streak >= s.maxConsecutiveLosses)
    g.notes.push(
      resting
        ? { tone: "info", text: `연속 손실 휴식은 마지막 손실이 난 날(${lastSell})과 그다음 거래일까지예요.`, rule: STREAK_RULE }
        : { tone: "warn", text: `최근 ${streak}번 연속 손실 뒤 쉬었어요. 다시 진입하되 규모를 줄이세요.`, rule: STREAK_RULE },
    );
  return g;
}

async function loadMacro(deps: Deps, result: ScanResult): Promise<MacroSnapshot | null> {
  if (!deps.macro) return null;
  try {
    const m = await deps.macro.getSnapshot({ ism: deps.store.state.settings.ismManual });
    if (m.errors.length) result.errors.push(`매크로 자료 ${m.errors.length}건 문제: ${m.errors[0]}`);
    result.macroAsOf = m.snapshot.asOf;
    const i = m.snapshot.ism;
    result.macroSummary = {
      ism: i ? { value: i.value, month: i.month, source: i.source } : null, rateRising: m.snapshot.rateRising ?? null, us10yChange6m: m.snapshot.us10yChange6m ?? null,
    };
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
    postures: {}, exposureCaps: {}, guards: {}, macroAsOf: null, breadth: {}, minuteSkips: [],
    candidates: [], plans: {}, executed: [], errors: [],
  };
  const reject = (r: string) => (result.rejected[r] = (result.rejected[r] ?? 0) + 1);
  const macro = await loadMacro(deps, result);

  for (const market of markets) {
    const region = regionOf(market);
    const params = paramsFor(region, s);
    let breadth: BreadthResult | null = null;
    if (deps.breadth) {
      breadth = await withTimeout(deps.breadth.getBreadth(market), BREADTH_WAIT_MS);
      if (breadth) {
        logBreadthToday(store, market, marketClock(region, at).date, breadth.today);
        const a = breadth.analysis;
        result.breadth![market] = a
          ? {
            asOf: a.asOf, basis: a.basis, sampleSize: a.sampleSize, score: a.score, divergence: a.divergence, miSignal: a.miSignal, hiLoState: a.hiLoState, hiLo: a.hiLo,
            mi: a.mi.at(-1)?.value ?? null, adLine: a.adLine.at(-1)?.value ?? null,
          }
          : null;
      } else result.breadth![market] = null;
    }
    try {
      const idx = await provider.getIndexCandles(market, 250);
      result.regimes[market] = marketRegime(idx)?.regime ?? null;
      result.postures![market] = assessRegime(idx, macro, s.postureCaps, { region, breadth: breadth?.analysis ?? null });
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
    markDayStart(store, region, clock.date);
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
          // 분봉 확인(4.7·M3-18): 시초가 갭 추격·회피 자리면 이번 스캔에서는 들어가지 않는다(다음 스캔에서 다시 본다)
          if (store.state.settings.minuteMode !== "off" && deps.minute) {
            const m = await minuteFor({ provider, minute: deps.minute }, item.candidate.code, at).catch(() => null);
            const d = minuteDecision(store.state.settings.minuteMode, m?.assessment ?? null);
            if (!d.enter) {
              scan.minuteSkips!.push({ code: item.candidate.code, name: item.candidate.name, verdict: m?.assessment?.entry.verdict ?? "wait", reason: d.reason });
              continue;
            }
          }
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
    markDayStart(store, region, clock.date);
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
  // 계좌를 새로 만들면 하루 시작 자산도 다시 잡는다(예수금 변경이 손익으로 보이지 않게)
  if (force || paper.KRW.positions.length === 0) {
    store.state.paper.KRW = newPaperAccount(s.depositKRW);
    delete store.state.dayStart.KRW;
  }
  if (force || paper.USD.positions.length === 0) {
    store.state.paper.USD = newPaperAccount(s.depositUSD);
    delete store.state.dayStart.USD;
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
