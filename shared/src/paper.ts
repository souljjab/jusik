import type { JournalEntry, TradeFeatures } from "./journal";
import type { PlanItem } from "./daytrade";
import { rMultiple } from "./risk";
import type { Region } from "./types";
import type { MarketClock } from "./sessions";

/** 실제 주문이 아니라 가상으로 체결하는 모의계좌 */
export interface PaperPosition {
  code: string;
  name: string;
  /** 체결 시각(ISO) */
  openedAt: string;
  /** 체결일(그 시장 현지 날짜, YYYY-MM-DD) */
  entryDate: string;
  entryPrice: number;
  qty: number;
  stop: number;
  target: number;
  maxHoldDays: number;
  /** 수수료 포함 매수 원가 */
  cost: number;
  lastPrice?: number;
  reason: string;
}

export interface PaperAccount {
  cash: number;
  positions: PaperPosition[];
  realizedPnl: number;
  closed: number;
  wins: number;
}

export interface PaperCosts {
  feeRate: number;
  sellTaxRate: number;
  /** 체결 슬리피지(불리하게 적용) */
  slippage: number;
  /** 체결가 소수점 자리수(원화 0, 달러 2) */
  decimals: number;
}

/** 한국: 수수료 0.015% + 매도세 0.18%. 미국: 수수료 0.25%(증권사마다 다름) + 매도 시 SEC 수수료 약 0.003%. 슬리피지 0.1% 가정 */
export const PAPER_COSTS: Record<Region, PaperCosts> = {
  KR: { feeRate: 0.00015, sellTaxRate: 0.0018, slippage: 0.001, decimals: 0 },
  US: { feeRate: 0.0025, sellTaxRate: 0.00003, slippage: 0.001, decimals: 2 },
};

export const newPaperAccount = (cash: number): PaperAccount => ({ cash, positions: [], realizedPnl: 0, closed: 0, wins: 0 });

/** from 다음 날부터 to까지의 평일 수(같은 날이면 0) */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let t = Date.parse(from) + 86_400_000; t <= Date.parse(to); t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

const uuid = () => globalThis.crypto.randomUUID();
const round2 = (x: number) => Math.round(x * 100) / 100;

/** 모의매매가 쓰는 전략 이름(매매일지 '사용한 전략' 칸) */
export const PAPER_STRATEGY = "단타 돌파";

/**
 * 모의 매수. 예수금이 모자라면 null.
 * equity(계좌 총자산)를 넘기면 매매일지에 계좌 대비 비중(체결 금액 ÷ equity × 100)을 남긴다.
 */
export function paperOpen(
  acct: PaperAccount, item: PlanItem, now: Date, clock: MarketClock, costs: PaperCosts, regime: string | null = null, equity?: number,
): { acct: PaperAccount; entry: JournalEntry } | null {
  const c = item.candidate;
  const fill = Number((c.entry * (1 + costs.slippage)).toFixed(costs.decimals));
  const cost = item.qty * fill * (1 + costs.feeRate);
  if (item.qty < 1 || cost > acct.cash || acct.positions.some((p) => p.code === c.code)) return null;
  const reason = `단타 점수 ${c.score} · ${c.notes.filter((n) => n.tone === "good").map((n) => n.text).slice(0, 3).join(", ")}`;
  const pos: PaperPosition = {
    code: c.code, name: c.name, openedAt: now.toISOString(), entryDate: clock.date, entryPrice: fill, qty: item.qty,
    stop: c.stop, target: c.target, maxHoldDays: c.maxHoldDays, cost, lastPrice: fill, reason,
  };
  return {
    acct: { ...acct, cash: acct.cash - cost, positions: [...acct.positions, pos] },
    entry: {
      id: uuid(), code: c.code, name: c.name, date: pos.entryDate, side: "BUY", price: fill, qty: item.qty, stop: c.stop,
      reason, review: `계획: 손절 ${c.stop.toLocaleString()} / 목표 ${c.target.toLocaleString()} / 최대 ${c.maxHoldDays}일 보유`, source: "자동(모의)",
      meta: { score: c.score, volumeRatio: c.volumeRatio, changePct: c.changePct, stopPct: c.stopPct, market: c.market, regime } satisfies TradeFeatures,
      strategy: PAPER_STRATEGY, target: c.target, regime,
      ...(equity != null && equity > 0 ? { weightPct: round2(((fill * item.qty) / equity) * 100) } : {}),
    },
  };
}

export type ExitReason = "손절" | "목표 도달" | "시간 청산";

/** 최신 가격으로 손절·목표·보유기간 청산 조건을 확인하고 해당 포지션을 매도 처리한다. */
export function paperCheckExits(acct: PaperAccount, prices: Record<string, number>, clock: MarketClock, costs: PaperCosts): { acct: PaperAccount; entries: JournalEntry[] } {
  const today = clock.date;
  // 마감 임박이거나, 평일 장이 끝난 뒤(오전 개장 전은 제외)
  const weekday = clock.weekday >= 1 && clock.weekday <= 5;
  const afterClose = clock.nearClose || (weekday && !clock.isOpen && clock.minutes > 12 * 60);
  const entries: JournalEntry[] = [];
  const positions: PaperPosition[] = [];
  let { cash, realizedPnl, closed, wins } = acct;

  for (const pos of acct.positions) {
    const price = prices[pos.code];
    if (price == null || !(price > 0)) {
      positions.push(pos);
      continue;
    }
    const held = weekdaysBetween(pos.entryDate, today);
    let reason: ExitReason | null = null;
    if (price <= pos.stop) reason = "손절";
    else if (price >= pos.target) reason = "목표 도달";
    else if (held > pos.maxHoldDays || (held >= pos.maxHoldDays && afterClose)) reason = "시간 청산";

    if (!reason) {
      positions.push({ ...pos, lastPrice: price });
      continue;
    }
    const fill = Number((price * (1 - costs.slippage)).toFixed(costs.decimals));
    const proceeds = pos.qty * fill * (1 - costs.feeRate - costs.sellTaxRate);
    const pnl = proceeds - pos.cost;
    const pct = (pnl / pos.cost) * 100;
    cash += proceeds;
    realizedPnl += pnl;
    closed += 1;
    if (pnl > 0) wins += 1;
    // R은 체결가 기준(비용 제외): (청산 체결가 − 진입 체결가) ÷ (진입 체결가 − 계획 손절가)
    const r = rMultiple(pos.entryPrice, fill, pos.stop);
    entries.push({
      id: uuid(), code: pos.code, name: pos.name, date: today, side: "SELL", price: fill, qty: pos.qty, stop: pos.stop,
      reason: `${reason}(${price.toLocaleString()})`,
      // 이 형식("순손익 X (+x.xx%)")은 paperTradesFromJournal·todayPnl이 읽으므로 바꾸지 않는다
      review: `수수료·세금·슬리피지 반영 순손익 ${Math.round(pnl * 100) / 100} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`,
      source: "자동(모의)",
      strategy: PAPER_STRATEGY, target: pos.target, exitReason: reason,
      ...(r != null ? { rMultiple: round2(r) } : {}),
    });
  }
  return { acct: { cash, positions, realizedPnl, closed, wins }, entries };
}

/** 평가금액 포함 총자산 */
export function paperEquity(acct: PaperAccount): number {
  return acct.cash + acct.positions.reduce((a, p) => a + p.qty * (p.lastPrice ?? p.entryPrice), 0);
}

/**
 * 보유 포지션의 평가손익 합계(최근가 × 수량 − 수수료 포함 매수 원가). 매도 비용은 빼지 않는다.
 * 진입 이후 누적이라 전날부터 들고 있던 손실도 들어간다(일일 손실 한도 판단에서는 보수적으로 작동).
 */
export function paperUnrealizedPnl(acct: PaperAccount): number {
  return acct.positions.reduce((a, p) => a + p.qty * (p.lastPrice ?? p.entryPrice) - p.cost, 0);
}
