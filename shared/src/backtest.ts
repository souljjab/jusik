import type { Candle } from "./types";
import { computeIndicators } from "./indicators";
import { technicalScoreAt } from "./technical";
import { MIN_CANDLES } from "./action";

export interface BacktestOptions {
  initialCash: number;
  /** 점수가 이 값 이상이면 매수 */
  buyThreshold: number;
  /** 점수가 이 값 이하면 매도 */
  sellThreshold: number;
  /** 수수료율(매수·매도 각각) */
  feeRate: number;
  /** 매도 시 거래세율 */
  sellTaxRate: number;
  /** 매수가 대비 손절 비율(예: 0.1 = -10%). 0이면 사용 안 함 */
  stopLossPct: number;
}

export const DEFAULT_BACKTEST: BacktestOptions = {
  initialCash: 10_000_000,
  buyThreshold: 20,
  sellThreshold: -20,
  feeRate: 0.00015,
  sellTaxRate: 0.0018,
  stopLossPct: 0,
};

export interface Trade {
  buyDate: string;
  buyPrice: number;
  sellDate: string;
  sellPrice: number;
  shares: number;
  /** 수수료·세금 반영 손익률 */
  returnPct: number;
  reason: "SIGNAL" | "STOP_LOSS";
}

export interface EquityPoint {
  date: string;
  equity: number;
  buyHold: number;
}

export interface BacktestResult {
  trades: Trade[];
  equity: EquityPoint[];
  finalEquity: number;
  totalReturnPct: number;
  buyHoldReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  tradeCount: number;
  /** 마지막까지 보유 중인 포지션이 있는지 */
  openPosition: boolean;
}

/**
 * 기술적 점수 기반 단순 매매 전략 백테스트.
 * - t일 종가까지의 정보로 신호를 계산하고 t+1일 시가에 체결(미래 참조 없음)
 * - 한 종목 전량 매수/전량 매도
 */
export function runBacktest(candles: Candle[], partial: Partial<BacktestOptions> = {}): BacktestResult | null {
  const o: BacktestOptions = { ...DEFAULT_BACKTEST, ...partial };
  if (candles.length < MIN_CANDLES + 2) return null;
  const ind = computeIndicators(candles);

  let cash = o.initialCash;
  let shares = 0;
  let entry: { date: string; price: number; cost: number } | null = null;
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];

  const start = MIN_CANDLES;
  const firstOpen = candles[start]!.open;
  const bhShares = Math.floor(o.initialCash / (firstOpen * (1 + o.feeRate)));
  const bhCash = o.initialCash - bhShares * firstOpen * (1 + o.feeRate);

  const sell = (date: string, price: number, reason: Trade["reason"]) => {
    const gross = shares * price;
    const proceeds = gross - gross * (o.feeRate + o.sellTaxRate);
    trades.push({
      buyDate: entry!.date,
      buyPrice: entry!.price,
      sellDate: date,
      sellPrice: price,
      shares,
      returnPct: (proceeds / entry!.cost - 1) * 100,
      reason,
    });
    cash += proceeds;
    shares = 0;
    entry = null;
  };

  for (let i = start; i < candles.length; i++) {
    const c = candles[i]!;

    // 1) 전일 신호로 오늘 시가에 체결
    if (i > start) {
      const sig = technicalScoreAt(candles, ind, i - 1).score;
      if (shares === 0 && sig >= o.buyThreshold) {
        const n = Math.floor(cash / (c.open * (1 + o.feeRate)));
        if (n > 0) {
          const cost = n * c.open * (1 + o.feeRate);
          cash -= cost;
          shares = n;
          entry = { date: c.date, price: c.open, cost };
        }
      } else if (shares > 0 && sig <= o.sellThreshold) {
        sell(c.date, c.open, "SIGNAL");
      }
    }

    // 2) 장중 손절(시가가 손절가 아래로 갭하락하면 시가, 아니면 손절가에 체결 가정)
    if (shares > 0 && o.stopLossPct > 0 && entry) {
      const stop = entry.price * (1 - o.stopLossPct);
      if (c.low <= stop) sell(c.date, Math.min(c.open, stop), "STOP_LOSS");
    }

    equity.push({
      date: c.date,
      equity: cash + shares * c.close,
      buyHold: bhCash + bhShares * c.close,
    });
  }

  return summarize(equity, trades, o.initialCash, shares > 0);
}

/** 자산 곡선과 거래 목록으로 성과 지표를 계산한다 */
export function summarize(equity: EquityPoint[], trades: Trade[], initialCash: number, openPosition: boolean): BacktestResult {
  const finalEquity = equity[equity.length - 1]!.equity;
  const bhFinal = equity[equity.length - 1]!.buyHold;
  const days = (Date.parse(equity[equity.length - 1]!.date) - Date.parse(equity[0]!.date)) / 86_400_000;
  const years = days / 365;

  let peak = -Infinity;
  let mdd = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.equity);
    mdd = Math.min(mdd, p.equity / peak - 1);
  }

  const wins = trades.filter((t) => t.returnPct > 0).length;
  return {
    trades,
    equity,
    finalEquity,
    totalReturnPct: (finalEquity / initialCash - 1) * 100,
    buyHoldReturnPct: (bhFinal / initialCash - 1) * 100,
    cagrPct: years > 0.1 ? ((finalEquity / initialCash) ** (1 / years) - 1) * 100 : 0,
    maxDrawdownPct: mdd * 100,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    tradeCount: trades.length,
    openPosition,
  };
}
