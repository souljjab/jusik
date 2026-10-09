import { BUY_ACTIONS, SELL_ACTIONS } from "./action";
import { DEFAULT_BACKTEST, summarize, type BacktestResult, type EquityPoint, type Trade } from "./backtest";
import { regimeByWeek } from "./regime";
import { MIN_WEEKS, prepareStage, relativeStrength, stageAt, type StageResult } from "./stage";
import type { Candle } from "./types";
import { toWeekly } from "./weekly";

export interface StageBacktestOptions {
  initialCash: number;
  feeRate: number;
  sellTaxRate: number;
  /** true면 지수가 약세 국면일 때 신규 매수하지 않는다(지수 데이터가 있을 때만) */
  useRegime: boolean;
}

export const DEFAULT_STAGE_BACKTEST: StageBacktestOptions = {
  initialCash: DEFAULT_BACKTEST.initialCash,
  feeRate: DEFAULT_BACKTEST.feeRate,
  sellTaxRate: DEFAULT_BACKTEST.sellTaxRate,
  useRegime: true,
};

/**
 * 와인스타인 주봉 단계 전략 백테스트.
 * - 신호는 주가 마감된 뒤에만 갱신되고, 다음 거래일 시가에 체결한다(미래 참조 없음)
 * - 매수: 주봉 신호가 매수 계열(2단계 + 돌파/눌림, 과열 아님) / 매도: 3단계 이탈·4단계 신호 또는 손절가 이탈
 * - 손절가: 진입 시 최근 8주 저점, 이후 매주 더 높아질 때만 끌어올린다(후행 손절)
 * - 재무 스크리닝은 과거 시점 재무 데이터가 없어 제외
 */
export function runStageBacktest(
  candles: Candle[],
  indexCandles?: Candle[],
  partial: Partial<StageBacktestOptions> = {},
): BacktestResult | null {
  const o = { ...DEFAULT_STAGE_BACKTEST, ...partial };
  const weekly = toWeekly(candles);
  if (weekly.length < MIN_WEEKS + 2) return null;

  const idxWeekly = indexCandles?.length ? toWeekly(indexCandles) : undefined;
  const rs = idxWeekly ? relativeStrength(weekly, idxWeekly) : undefined;
  const regimes = idxWeekly && o.useRegime ? regimeByWeek(idxWeekly) : undefined;
  const ctx = prepareStage(weekly);
  const results: (StageResult | null)[] = weekly.map((_, k) => stageAt(ctx, k, rs));

  const firstK = results.findIndex((r) => r != null);
  if (firstK < 0 || firstK + 1 >= weekly.length) return null;
  const startDay = weekly[firstK]!.endIndex + 1;

  let cash = o.initialCash;
  let shares = 0;
  let stop = 0;
  let entry: { date: string; price: number; cost: number } | null = null;
  let blockedUntilK = -1;
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];

  const firstOpen = candles[startDay]!.open;
  const bhShares = Math.floor(o.initialCash / (firstOpen * (1 + o.feeRate)));
  const bhCash = o.initialCash - bhShares * firstOpen * (1 + o.feeRate);

  const sell = (date: string, price: number, reason: Trade["reason"]) => {
    const gross = shares * price;
    const proceeds = gross - gross * (o.feeRate + o.sellTaxRate);
    trades.push({ buyDate: entry!.date, buyPrice: entry!.price, sellDate: date, sellPrice: price, shares, returnPct: (proceeds / entry!.cost - 1) * 100, reason });
    cash += proceeds;
    shares = 0;
    entry = null;
  };

  let k = firstK; // 오늘 시가 이전에 마감된 가장 최근 주
  let lastTrailK = firstK - 1;
  for (let i = startDay; i < candles.length; i++) {
    while (k + 1 < weekly.length && weekly[k + 1]!.endIndex < i) k++;
    const sig = results[k];
    const c = candles[i]!;

    if (sig) {
      // 새 주가 마감되면 보유 중 손절가를 끌어올린다(내리지는 않는다)
      if (shares > 0 && k > lastTrailK) stop = Math.max(stop, sig.stopLoss);
      lastTrailK = k;

      if (shares > 0 && SELL_ACTIONS.includes(sig.action)) {
        sell(c.date, c.open, "SIGNAL");
      } else if (shares === 0 && k > blockedUntilK && BUY_ACTIONS.includes(sig.action)) {
        const regime = regimes?.get(weekly[k]!.weekKey);
        const regimeOk = regime !== "BEAR";
        if (regimeOk && c.open > sig.stopLoss) {
          const n = Math.floor(cash / (c.open * (1 + o.feeRate)));
          if (n > 0) {
            const cost = n * c.open * (1 + o.feeRate);
            cash -= cost;
            shares = n;
            stop = sig.stopLoss;
            entry = { date: c.date, price: c.open, cost };
          }
        }
      }
    }

    if (shares > 0 && c.low <= stop) {
      sell(c.date, Math.min(c.open, stop), "STOP_LOSS");
      blockedUntilK = k; // 같은 주 신호로 곧바로 재진입하지 않는다
    }

    equity.push({ date: c.date, equity: cash + shares * c.close, buyHold: bhCash + bhShares * c.close });
  }

  if (equity.length < 2) return null;
  return summarize(equity, trades, o.initialCash, shares > 0);
}
