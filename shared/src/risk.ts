export interface PositionSizeInput {
  capital: number;
  entry: number;
  stop: number;
  /** 한 번 손절 시 잃어도 되는 자본 비율(%) */
  riskPct?: number;
  /** 한 종목 최대 비중(%) */
  maxWeightPct?: number;
  feeRate?: number;
}

export interface PositionSize {
  shares: number;
  amount: number;
  weightPct: number;
  /** 손절 시 예상 손실액(수수료 제외) */
  riskAmount: number;
  riskPerSharePct: number;
  /** 비중 상한 때문에 손절 기준보다 적게 샀는지 */
  cappedByWeight: boolean;
}

/** 손절폭 기준 포지션 크기: 손절 시 손실이 자본의 riskPct%를 넘지 않게, 비중 상한도 지킨다. */
export function positionSize(i: PositionSizeInput): PositionSize | null {
  const riskPct = i.riskPct ?? 1;
  const maxW = i.maxWeightPct ?? 25;
  const fee = i.feeRate ?? 0.00015;
  const perShare = i.entry - i.stop;
  if (!(i.capital > 0) || !(i.entry > 0) || !(perShare > 0)) return null;
  const byRisk = Math.floor((i.capital * riskPct) / 100 / (perShare + i.entry * fee * 2));
  const byWeight = Math.floor((i.capital * maxW) / 100 / (i.entry * (1 + fee)));
  const shares = Math.max(0, Math.min(byRisk, byWeight));
  const amount = shares * i.entry;
  return {
    shares,
    amount,
    weightPct: (amount / i.capital) * 100,
    riskAmount: shares * perShare,
    riskPerSharePct: (perShare / i.entry) * 100,
    cappedByWeight: byWeight < byRisk,
  };
}

export interface Expectancy {
  /** 거래 1회당 기대 수익률(%), 비용 반영 */
  expectancyPct: number;
  /** 평균이익 / 평균손실 */
  payoff: number | null;
  /** 켈리 비중(%) — 이론상 최대치. 실전에선 절반 이하로 쓰는 게 일반적 */
  kellyPct: number;
  halfKellyPct: number;
}

/**
 * 기대값 = 승률×평균이익 - (1-승률)×평균손실 - 비용.
 * 책의 "수익 = 원금 × 수익률 × 성공확률 × 비중 × (1-비용)" 관점을 손실까지 넣어 확장한 형태.
 */
export function expectancy(i: { winRate: number; avgWinPct: number; avgLossPct: number; costPct?: number }): Expectancy {
  const p = Math.min(1, Math.max(0, i.winRate));
  const loss = Math.abs(i.avgLossPct);
  const e = p * i.avgWinPct - (1 - p) * loss - (i.costPct ?? 0);
  const b = loss > 0 ? i.avgWinPct / loss : null;
  const kelly = b != null && b > 0 ? Math.max(0, p - (1 - p) / b) * 100 : 0;
  return { expectancyPct: e, payoff: b, kellyPct: kelly, halfKellyPct: kelly / 2 };
}

/** 이 종목 비중으로 담았을 때 계좌에 미치는 기대 손익(원) */
export function expectedPortfolioProfit(capital: number, weightPct: number, e: Expectancy): number {
  return capital * (weightPct / 100) * (e.expectancyPct / 100);
}
