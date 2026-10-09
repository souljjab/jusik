export interface JournalEntry {
  id: string;
  code: string;
  name: string;
  date: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  /** 매매 당시 계획한 손절가 */
  stop?: number;
  /** 매매 이유(자동 채움 + 직접 입력) */
  reason: string;
  /** 복기 메모: 계획대로 했는지, 감정은 어땠는지 */
  review?: string;
}

export interface ClosedTrade {
  code: string;
  name: string;
  buyDate: string;
  sellDate: string;
  qty: number;
  buyPrice: number;
  sellPrice: number;
  pnl: number;
  returnPct: number;
}

export interface OpenPosition {
  code: string;
  name: string;
  qty: number;
  avgPrice: number;
}

export interface JournalSummary {
  closed: ClosedTrade[];
  open: OpenPosition[];
  totalPnl: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** 매도했는데 보유 수량보다 많이 판 기록이 있었는지(입력 오류 가능성) */
  oversold: boolean;
}

/** 종목별 선입선출(FIFO)로 매수·매도를 짝지어 청산 거래와 보유 포지션을 만든다. 수수료는 포함하지 않는다. */
export function summarizeJournal(entries: JournalEntry[]): JournalSummary {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1));
  const lots = new Map<string, { name: string; date: string; price: number; qty: number }[]>();
  const closed: ClosedTrade[] = [];
  let oversold = false;

  for (const e of sorted) {
    const q = lots.get(e.code) ?? [];
    lots.set(e.code, q);
    if (e.side === "BUY") {
      q.push({ name: e.name, date: e.date, price: e.price, qty: e.qty });
      continue;
    }
    let remain = e.qty;
    while (remain > 0 && q.length) {
      const lot = q[0]!;
      const take = Math.min(lot.qty, remain);
      closed.push({
        code: e.code, name: e.name, buyDate: lot.date, sellDate: e.date, qty: take,
        buyPrice: lot.price, sellPrice: e.price, pnl: (e.price - lot.price) * take, returnPct: (e.price / lot.price - 1) * 100,
      });
      lot.qty -= take;
      remain -= take;
      if (lot.qty === 0) q.shift();
    }
    if (remain > 0) oversold = true;
  }

  const open: OpenPosition[] = [];
  for (const [code, q] of lots) {
    const qty = q.reduce((a, l) => a + l.qty, 0);
    if (qty > 0) open.push({ code, name: q[0]!.name, qty, avgPrice: q.reduce((a, l) => a + l.price * l.qty, 0) / qty });
  }

  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    closed,
    open,
    totalPnl: closed.reduce((a, t) => a + t.pnl, 0),
    winRate: closed.length ? wins.length / closed.length : null,
    avgWinPct: mean(wins.map((t) => t.returnPct)),
    avgLossPct: mean(losses.map((t) => t.returnPct)),
    oversold,
  };
}
