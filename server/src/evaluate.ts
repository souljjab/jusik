import {
  evaluateTrades, paperTradesFromJournal, regimeByWeek, regionOf, replayDayTrade, toWeekly, weekKeyOf,
  type EvalTrade, type Evaluation, type Market, type Regime, type ReplayRun,
} from "@jusik/shared";
import { paramsFor } from "./scanner";
import type { Deps } from "./scanner";
import { STOCKS } from "./stocks";

/** 매매일지의 자동(모의) 거래로 규칙을 점검한다 */
export function evaluatePaper(deps: Pick<Deps, "store">): { evaluation: Evaluation; tradeCount: number } {
  const trades = paperTradesFromJournal(deps.store.state.journal);
  return { evaluation: evaluateTrades(trades, deps.store.state.settings.minScore), tradeCount: trades.length };
}

/** 지난주까지 마감된 주봉으로 판정한 국면을 날짜별로 돌려주는 함수(그 주 데이터는 쓰지 않아 미래 참조 없음) */
async function regimeLookup(deps: Deps, market: Market, count: number): Promise<(date: string) => Regime | null> {
  const idx = await deps.provider.getIndexCandles(market, count + 200);
  const byWeek = regimeByWeek(toWeekly(idx));
  return (date) => {
    const prevWeek = new Date(Date.parse(weekKeyOf(date)) - 7 * 86_400_000).toISOString().slice(0, 10);
    return byWeek.get(prevWeek) ?? null;
  };
}

/**
 * 과거 일봉으로 단타 규칙을 재현한다. 대상은 내장 종목 목록 + 지금까지 스캔에서 후보로 나왔던 종목.
 * 실제 스캔은 매일의 거래량·상승률 상위에서 고르므로 대상 종목 구성이 다르다(대형주 위주 → 결과가 다를 수 있음).
 */
export async function runReplay(deps: Deps, opt: { markets?: Market[]; count?: number } = {}): Promise<ReplayRun> {
  const s = deps.store.state.settings;
  const markets = opt.markets?.length ? opt.markets : (["KOSPI", "KOSDAQ", "US"] as Market[]).filter((m) => s.markets[m]);
  const count = Math.min(Math.max(opt.count ?? 500, 120), 1500);
  const errors: string[] = [];
  const trades: EvalTrade[] = [];
  const seen = new Set<string>();
  let codesTested = 0;

  for (const market of markets) {
    let regimeOn: ((d: string) => Regime | null) | undefined;
    try {
      regimeOn = await regimeLookup(deps, market, count);
    } catch (e) {
      errors.push(`${market} 지수: ${msg(e)}`);
    }
    const refs = [
      ...STOCKS.filter((x) => x.market === market),
      ...deps.store.state.history.filter((h) => h.market === market).map((h) => ({ code: h.code, name: h.name, market: h.market })),
    ].filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)));

    for (const ref of refs) {
      try {
        const candles = await deps.provider.getCandles(ref.code, count);
        codesTested++;
        trades.push(...replayDayTrade(ref, candles, paramsFor(regionOf(market), s), { regimeOn }));
      } catch (e) {
        errors.push(`${ref.code}: ${msg(e)}`);
      }
    }
  }
  const run: ReplayRun = { at: new Date().toISOString(), markets, codesTested, tradeCount: trades.length, candleCount: count, evaluation: evaluateTrades(trades, s.minScore), errors };
  deps.store.state.lastReplay = run;
  deps.store.save();
  return run;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
