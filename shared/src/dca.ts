import { DEFAULT_BACKTEST, summarize, type EquityPoint } from "./backtest";
import type { Candle, Note } from "./types";

/**
 * 적립식 분할 매수(적금주식) 시뮬레이터 — 기초 자료집 4.9, 3.8, 규칙 M3-19 [헬로마녀, 『헬로마녀의 적금주식 투자법』].
 * 투자금을 약 20영업일에 나눠 매일 한도 안에서 사고, 평균 단가 대비 목표 수익률에 닿으면 전량 매도한 뒤 다시 시작한다.
 * 책의 수치는 저자 경험칙이라 모두 파라미터로 열어 둔다.
 */

/** 목표 수익률(%) 기본값: 우량주 약 7%, 소형주 10~15%(가운데 12%) [헬로마녀 4.9] */
export const DCA_TARGETS = { large: 7, small: 12 } as const;

/** 소형주 목표 상단(%). 이보다 높으면 사이클이 길어진다는 경고를 낸다 [헬로마녀 4.9] */
export const DCA_TARGET_MAX = 15;

/** 1일 한도를 나누는 영업일 수(약 한 달). 예: 50만 원이면 하루 2만 5,000원 [헬로마녀 4.9, M3-19] */
export const DCA_DAYS = 20;

export interface DcaParams {
  /** 사이클 하나에 넣을 투자금 */
  capital: number;
  /** 투자금을 나눠 살 영업일 수. 하루 한도 = 예산 ÷ days */
  days: number;
  /** 평균 단가 대비 목표 수익률(%) */
  targetPct: number;
  /** 수수료율(매수·매도 각각) */
  feeRate: number;
  /** 매도 시 거래세율 */
  sellTaxRate: number;
  /** true면 매도 후 원금+수익(현재 현금 전체)으로 재시작, false면 원금만큼만 다시 넣는다 */
  reinvest: boolean;
  /** 체결 슬리피지(%). 매수는 비싸게, 매도는 싸게 불리하게 적용 */
  slippagePct: number;
}

/** 비용은 앱의 기존 백테스트 기본값(한국: 수수료 0.015%, 매도세 0.18%)을 따른다. 세율은 연도별로 바뀌니 현행 규정으로 넘겨야 한다 */
export const DEFAULT_DCA: DcaParams = {
  capital: DEFAULT_BACKTEST.initialCash,
  days: DCA_DAYS,
  targetPct: DCA_TARGETS.large,
  feeRate: DEFAULT_BACKTEST.feeRate,
  sellTaxRate: DEFAULT_BACKTEST.sellTaxRate,
  reinvest: false,
  slippagePct: 0.1,
};

export interface DcaCycle {
  /** 사이클 첫 매수일 */
  start: string;
  /** 전량 매도일. 진행 중이면 null */
  end: string | null;
  /** 시작일부터 매도일(진행 중이면 마지막 날)까지 거래일 수 */
  tradingDays: number;
  /** 이 사이클에 배정한 예산 */
  budget: number;
  /** 실제 매수에 쓴 돈(수수료·슬리피지 포함) */
  invested: number;
  shares: number;
  /** 평균 단가. 슬리피지 반영 체결가 기준, 수수료는 빼고 계산(증권사 표시 방식) */
  avgCost: number;
  /** 매도 체결가(슬리피지 반영). 진행 중이면 null */
  exitPrice: number | null;
  /** 수수료·세금·슬리피지 반영 실현 손익. 진행 중이면 null */
  pnl: number | null;
  /** pnl ÷ invested(%) */
  returnPct: number | null;
}

export interface DcaResult {
  /** 모든 사이클(진행 중인 사이클이 있으면 마지막에 포함) */
  cycles: DcaCycle[];
  completedCycles: number;
  /** 아직 목표에 닿지 않은 마지막 사이클(cycles의 마지막 원소와 같은 객체) */
  openCycle: DcaCycle | null;
  finalEquity: number;
  totalReturnPct: number;
  /** 첫날 종가에 전액 사서 들고 있었을 때 */
  buyHoldReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  /** 완료된 사이클의 평균 거래일 수 */
  avgDaysPerCycle: number | null;
  equity: EquityPoint[];
  /** 마지막 날 종가(진행 중 사이클 평가용) */
  lastClose: number;
  /** 실제로 쓴 파라미터(기본값 채움) */
  params: DcaParams;
}

/** 부동소수점 오차 허용(목표가 10,700이 10,700.000000000002로 계산되는 경우 등) */
const EPS = 1e-9;

/**
 * 오늘 살 수량. 하루 한도(capital ÷ days)에 이전 날 남은 자투리(carry)를 더한 금액 안에서 정수 주식만 산다.
 * dayIndex는 사이클 안에서 0부터 센 매수일. 매수 기간(days일)이 끝났으면 사지 않고 자투리는 현금으로 남긴다.
 * price가 0 이하(시세 없음)면 오늘 한도를 자투리로 넘긴다.
 */
export function dcaPlanToday(p: {
  capital: number;
  days: number;
  dayIndex: number;
  price: number;
  carry: number;
  /** 수수료율(선택, 기본 0) */
  feeRate?: number;
}): { shares: number; spend: number; carry: number; dailyLimit: number } {
  const days = Math.max(1, Math.floor(p.days));
  const dailyLimit = p.capital > 0 ? p.capital / days : 0;
  const carry = Math.max(0, p.carry || 0);
  if (!(p.dayIndex >= 0) || p.dayIndex >= days) return { shares: 0, spend: 0, carry, dailyLimit };
  const allowance = dailyLimit + carry;
  if (!(p.price > 0)) return { shares: 0, spend: 0, carry: allowance, dailyLimit };
  const unit = p.price * (1 + (p.feeRate ?? 0));
  const shares = Math.max(0, Math.floor(allowance / unit + EPS));
  const spend = shares * unit;
  return { shares, spend, carry: Math.max(0, allowance - spend), dailyLimit };
}

/** 배당 권리: 국내 결제는 T+2라 배당기준일 2영업일 전까지 사야 주주가 된다 [설춘환, 자료집 7장 배당 권리] */
export const DIVIDEND_SETTLEMENT_DAYS = 2;

/**
 * 예금주식(배당 응용) 하루 매수 한도 [헬로마녀 4.9]. 배당기준일까지 남은 기간에 자금을 나눠 산다.
 * tradingDaysUntilRecord: 배당기준일까지 남은 영업일 수(오늘 제외, 기준일 포함 — 내일이 기준일이면 1).
 * 기준일 2영업일 전(D-2)까지 산 주식만 권리가 생기므로, 오늘 포함 실제 매수 가능일은 n-1일로 나눈다.
 * 자료집은 연말 배당 기준일을 폐장일로 적었지만, 기준일은 회사마다 다를 수 있어 공시로 확인해야 한다.
 * 받은 배당금은 같은 종목에 재투자한다[헬로마녀]. 살 수 있는 날이 없으면 0.
 */
export function dividendSchedule(capital: number, tradingDaysUntilRecord: number): number {
  const buyDays = Math.floor(tradingDaysUntilRecord) - DIVIDEND_SETTLEMENT_DAYS + 1;
  if (!(capital > 0) || !(buyDays >= 1)) return 0;
  return capital / buyDays;
}

/**
 * 적립식 분할 매수 시뮬레이션(미래 참조 없음).
 * - 사이클 시작 시 예산 = capital(reinvest면 그때 현금 전체), 하루 한도 = 예산 ÷ days.
 * - 매일 종가에 한도(+자투리) 안에서 정수 주식 매수. days일이 지나면 목표 도달까지 보유만 한다.
 * - t일 장중 고가 ≥ (t-1일까지의 평균 단가) × (1 + 목표%)면 max(시가, 목표가)에 전량 매도.
 *   매수는 종가에 하므로 같은 날 산 수량은 그날 판단에 들어가지 않는다. 매도 다음 날부터 새 사이클.
 * - 손절은 넣지 않았다. 책은 하락 시 종목 악재·외부 요인을 먼저 점검하고 결정적 오류일 때만 손절하라고 한다(정량화 불가).
 * - i일까지의 결과는 candles[0..i]만으로 정해진다.
 */
export function simulateDca(candles: Candle[], params: Partial<DcaParams> = {}): DcaResult | null {
  const p: DcaParams = { ...DEFAULT_DCA, ...params };
  const days = Math.floor(p.days);
  if (candles.length < 2 || !(p.capital > 0) || !(days >= 1) || !(p.targetPct > 0)) return null;
  const slip = p.slippagePct / 100;
  const up = 1 + p.targetPct / 100;

  let cash = p.capital;
  const cycles: DcaCycle[] = [];
  const equity: EquityPoint[] = [];
  // 진행 중 사이클 상태: gross는 수수료 뺀 매수 금액 합(평균 단가 계산용)
  let cur: { cycle: DcaCycle; startIdx: number; dayIdx: number; carry: number; gross: number } | null = null;

  // 단순 보유: 첫날 종가에 같은 비용으로 전액 매수
  const bhFill = candles[0]!.close * (1 + slip);
  const bhShares = bhFill > 0 ? Math.floor(p.capital / (bhFill * (1 + p.feeRate))) : 0;
  const bhCash = p.capital - bhShares * bhFill * (1 + p.feeRate);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    let soldToday = false;

    // 1) 장중 매도 판단: 어제까지 산 수량과 그 평균 단가만 쓴다
    if (cur && cur.cycle.shares > 0) {
      const cy = cur.cycle;
      const target = cy.avgCost * up;
      if (c.high >= target * (1 - EPS)) {
        const px = Math.max(c.open, target) * (1 - slip);
        const proceeds = cy.shares * px * (1 - p.feeRate - p.sellTaxRate);
        cash += proceeds;
        cy.end = c.date;
        cy.tradingDays = i - cur.startIdx + 1;
        cy.exitPrice = px;
        cy.pnl = proceeds - cy.invested;
        cy.returnPct = (cy.pnl / cy.invested) * 100;
        cur = null;
        soldToday = true;
      }
    }

    // 2) 첫날 또는 매도 다음 날 새 사이클
    if (!cur && !soldToday) {
      const budget = p.reinvest ? cash : Math.min(p.capital, cash);
      const cycle: DcaCycle = { start: c.date, end: null, tradingDays: 0, budget, invested: 0, shares: 0, avgCost: 0, exitPrice: null, pnl: null, returnPct: null };
      cycles.push(cycle);
      cur = { cycle, startIdx: i, dayIdx: 0, carry: 0, gross: 0 };
    }

    // 3) 종가 매수(매수 기간 안에서만)
    if (cur && cur.dayIdx < days) {
      const fill = c.close * (1 + slip);
      const plan = dcaPlanToday({ capital: cur.cycle.budget, days, dayIndex: cur.dayIdx, price: fill, carry: cur.carry, feeRate: p.feeRate });
      const unit = fill * (1 + p.feeRate);
      // 반올림 오차로 현금을 넘기지 않게 한 번 더 막는다
      const n = unit > 0 ? Math.min(plan.shares, Math.floor((cash + 1e-6) / unit)) : 0;
      if (n > 0) {
        const cy = cur.cycle;
        cash -= n * unit;
        cy.shares += n;
        cy.invested += n * unit;
        cur.gross += n * fill;
        cy.avgCost = cur.gross / cy.shares;
      }
      cur.carry = plan.carry + (plan.shares - n) * unit;
      cur.dayIdx++;
    }
    if (cur) cur.cycle.tradingDays = i - cur.startIdx + 1;

    equity.push({ date: c.date, equity: cash + (cur?.cycle.shares ?? 0) * c.close, buyHold: bhCash + bhShares * c.close });
  }

  const s = summarize(equity, [], p.capital, cur != null && cur.cycle.shares > 0);
  const done = cycles.filter((cy) => cy.end != null);
  return {
    cycles,
    completedCycles: done.length,
    openCycle: cur?.cycle ?? null,
    finalEquity: s.finalEquity,
    totalReturnPct: s.totalReturnPct,
    buyHoldReturnPct: s.buyHoldReturnPct,
    cagrPct: s.cagrPct,
    maxDrawdownPct: s.maxDrawdownPct,
    avgDaysPerCycle: done.length ? done.reduce((a, cy) => a + cy.tradingDays, 0) / done.length : null,
    equity,
    lastClose: candles[candles.length - 1]!.close,
    params: p,
  };
}

/** 노트 기준값. 앱이 정한 값이며 책 수치가 아니다 */
export const DCA_NOTE_PARAMS = {
  /** 진행 중 사이클이 이 영업일 수를 넘기면 경고. 저자 실적(연 12회 ≈ 한 달에 한 번)의 약 3배 */
  staleDays: 60,
  /** 완료 사이클이 예산을 평균 이 비율(%)보다 적게 썼으면 알려준다 */
  lowUsePct: 50,
} as const;

const RULE = "M3-19 헬로마녀";
const RULE_DOWN = "4.9 헬로마녀";
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

/** 시뮬레이션 결과를 화면용 근거 문장으로 바꾼다 */
export function dcaNotes(r: DcaResult): Note[] {
  const notes: Note[] = [];
  const t = r.params.targetPct;
  const done = r.cycles.filter((cy) => cy.end != null && cy.returnPct != null);

  if (t > DCA_TARGET_MAX) {
    notes.push({ tone: "warn", rule: RULE, text: `목표 ${t}%는 책 기준(우량주 ${DCA_TARGETS.large}%, 소형주 10~${DCA_TARGET_MAX}%)보다 높아요. 사이클이 길어질 수 있어요` });
  }

  if (done.length) {
    const avgRet = done.reduce((a, cy) => a + cy.returnPct!, 0) / done.length;
    notes.push({ tone: "info", rule: RULE, text: `목표 ${t}%로 사이클 ${done.length}회 마쳤어요. 한 번에 평균 ${Math.round(r.avgDaysPerCycle ?? 0)}영업일 걸렸어요` });
    notes.push({ tone: avgRet > 0 ? "good" : "bad", rule: RULE, text: `사이클 평균 수익은 비용을 빼고 ${pct(avgRet)}예요` });
    // 목표에 너무 빨리 닿으면 예산을 조금만 넣고 끝나 수익 금액이 작다
    const used = (done.reduce((a, cy) => a + (cy.budget > 0 ? cy.invested / cy.budget : 0), 0) / done.length) * 100;
    if (used < DCA_NOTE_PARAMS.lowUsePct) {
      notes.push({ tone: "info", rule: RULE, text: `목표에 빨리 닿아 사이클마다 예산의 평균 ${Math.round(used)}%만 썼어요` });
    }
  } else {
    notes.push({ tone: "warn", rule: RULE, text: `아직 목표 ${t}%에 닿은 사이클이 없어요` });
  }

  const total = pct(r.totalReturnPct);
  const bh = pct(r.buyHoldReturnPct);
  if (r.totalReturnPct > r.buyHoldReturnPct) {
    notes.push(
      r.totalReturnPct >= 0
        ? { tone: "good", rule: RULE, text: `분할 매수 ${total}로 단순 보유(${bh})보다 나았어요` }
        : { tone: "info", rule: RULE, text: `분할 매수 ${total}로 단순 보유(${bh})보다 손실이 작았어요` },
    );
  } else {
    notes.push({ tone: "info", rule: RULE, text: `단순 보유(${bh})가 분할 매수(${total})보다 나았어요` });
  }

  const o = r.openCycle;
  if (o) {
    if (o.shares === 0) {
      if (o.tradingDays >= r.params.days) notes.push({ tone: "warn", rule: RULE, text: "예산으로 1주도 사지 못했어요. 투자금이나 나눌 기간을 다시 정해요" });
    } else {
      const u = (r.lastClose / o.avgCost - 1) * 100;
      if (o.tradingDays > DCA_NOTE_PARAMS.staleDays) {
        notes.push({ tone: "warn", rule: RULE, text: `진행 중 사이클이 ${o.tradingDays}영업일째 목표에 못 미쳐요(평균 단가 대비 ${pct(u)})` });
      } else {
        notes.push({ tone: "info", rule: RULE, text: `진행 중 사이클 ${o.tradingDays}영업일째, 평균 단가 대비 ${pct(u)}예요` });
      }
      if (u < 0) {
        notes.push({ tone: "warn", rule: RULE_DOWN, text: "평균 단가 아래예요. 종목 악재인지 시장 탓인지 먼저 확인하고, 결정적 오류면 손절해요" });
      }
    }
  }
  return notes;
}
