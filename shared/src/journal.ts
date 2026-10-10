import { rMultiple } from "./risk";

/** 매매일지 한 줄. 필드 구성은 자료집 6장 '매매일지 필드'(언제·왜·얼마나·어떻게 끝났나·돌아보기)를 따른다 */
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
  /** 기록 출처. 자동(모의)은 앱이 모의매매하며 남긴 기록 */
  source?: "수동" | "자동(모의)";
  /** 자동 매수 시점의 신호 특성(규칙 점검용) */
  meta?: TradeFeatures;
  /** 사용한 전략(어느 규칙으로 샀나). 예: "단타 돌파" */
  strategy?: string;
  /** 매매 당시 계획한 목표가 */
  target?: number;
  /** 계좌 대비 비중(%) */
  weightPct?: number;
  /** 진입 시점의 시장 국면 */
  regime?: string | null;
  /** 청산 사유(목표·손절·시간·추적·재량 등) */
  exitReason?: string;
  /** 손실 단위(R) 배수 = (청산가−진입가)/(진입가−계획 손절가) */
  rMultiple?: number;
  /** 어긴 규칙(복기용). 예: ["손절가 미입력", "손실 중 추가 매수"] */
  violations?: string[];
  /** 감정 메모(조급함·희망 보유 등) */
  emotion?: string;
}

/** 진입 시점의 신호 특성. 어떤 조건의 신호가 실제로 잘 맞았는지 나눠 보는 데 쓴다 */
export interface TradeFeatures {
  score: number;
  volumeRatio: number;
  changePct: number;
  stopPct: number;
  market: string;
  regime: string | null;
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
  /** 매수 기록의 계획 손절가로 계산한 R 배수(손절가가 없으면 없음) */
  rMultiple?: number;
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
  /** R을 계산할 수 있는 청산 거래의 평균 R 배수(없으면 null) */
  avgR?: number | null;
  /** R을 계산할 수 있었던 청산 거래 수(매수 기록에 손절가가 있는 것) */
  rCount?: number;
}

/** 종목별 선입선출(FIFO)로 매수·매도를 짝지어 청산 거래와 보유 포지션을 만든다. 수수료는 포함하지 않는다. */
export function summarizeJournal(entries: JournalEntry[]): JournalSummary {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1));
  const lots = new Map<string, { name: string; date: string; price: number; qty: number; stop?: number }[]>();
  const closed: ClosedTrade[] = [];
  let oversold = false;

  for (const e of sorted) {
    const q = lots.get(e.code) ?? [];
    lots.set(e.code, q);
    if (e.side === "BUY") {
      q.push({ name: e.name, date: e.date, price: e.price, qty: e.qty, stop: e.stop });
      continue;
    }
    let remain = e.qty;
    while (remain > 0 && q.length) {
      const lot = q[0]!;
      const take = Math.min(lot.qty, remain);
      const r = rMultiple(lot.price, e.price, lot.stop);
      closed.push({
        code: e.code, name: e.name, buyDate: lot.date, sellDate: e.date, qty: take,
        buyPrice: lot.price, sellPrice: e.price, pnl: (e.price - lot.price) * take, returnPct: (e.price / lot.price - 1) * 100,
        ...(r != null ? { rMultiple: r } : {}),
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
  const rs = closed.flatMap((t) => (t.rMultiple != null ? [t.rMultiple] : []));
  return {
    closed,
    open,
    totalPnl: closed.reduce((a, t) => a + t.pnl, 0),
    winRate: closed.length ? wins.length / closed.length : null,
    avgWinPct: mean(wins.map((t) => t.returnPct)),
    avgLossPct: mean(losses.map((t) => t.returnPct)),
    oversold,
    avgR: mean(rs),
    rCount: rs.length,
  };
}
