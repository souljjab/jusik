import { netOf, type JournalEntry } from "./journal";
import type { Note } from "./types";

/**
 * 리스크 엔진 기준값(자료집 5장, 부록 A M4-01~M4-04, 5.5 심리 규칙).
 * 책의 수치는 저자 경험칙이므로 설정으로 바꿀 수 있게 열어 둔다. 0 이하로 두면 해당 점검을 끈다.
 */
export interface GuardParams {
  /** 하루 손실 한도(하루 시작 자산 대비 %). M4-04 슈웨거(인터뷰) */
  dailyLossLimitPct: number;
  /** 이 횟수만큼 연속 손실이면 신규 진입을 멈추고 쉬기·규모 축소를 권한다. 5.5 박용선·슈웨거(책은 'N회'라고만 해서 3회는 조정 대상) */
  maxConsecutiveLosses: number;
  /** 1회 거래 손실 한도(계좌 대비 %). M4-04 슈웨거(인터뷰) */
  maxPerTradeRiskPct: number;
  /** 종목당 비중 절대 상한(%). M4-03 강영현(캔들마스터 기본은 10%, 1,000만 원 이하면 20%) */
  maxWeightPct: number;
  /** 손실 중 추가 매수 허용 횟수. M4-02 캔들마스터 */
  maxLossAdds: number;
  /** 초기 손절폭 최대(매수가 대비 %). M4-01 캔들마스터(기본 -10%, 최대 -20%) */
  maxStopPct: number;
}

export const GUARD_DEFAULTS: GuardParams = {
  dailyLossLimitPct: 4, // M4-04 슈웨거
  maxConsecutiveLosses: 3, // 5.5 박용선·슈웨거
  maxPerTradeRiskPct: 1.5, // M4-04 슈웨거
  maxWeightPct: 30, // M4-03 강영현
  maxLossAdds: 1, // M4-02 캔들마스터
  maxStopPct: 20, // M4-01 캔들마스터
};

/** 근거 노트에 붙이는 규칙 ID·출처(부록 A, ID가 없으면 절 번호) */
const RULE = {
  dailyLoss: "M4-04 슈웨거",
  perTrade: "M4-04 슈웨거",
  streak: "5.5 박용선·슈웨거",
  weight: "M4-03 강영현",
  lossAdd: "M4-02 캔들마스터",
  averagingDown: "5.3 박용선·와인스타인",
  pyramid: "5.3 와인스타인",
  stopFirst: "5.1 박용선·와인스타인",
  stopWidth: "M4-01 캔들마스터",
  plan: "5.5 헬로마녀·박용선",
} as const;

export interface GuardResult {
  /** true면 신규 진입을 멈춘다 */
  blocked: boolean;
  /** 걸린 항목만 담는다(비어 있으면 모두 통과) */
  notes: Note[];
}

const pctText = (x: number) => (Math.round(x * 10) / 10).toString();

/**
 * 계좌 단위 하드 룰 점검. 걸린 항목만 노트로 돌려준다.
 * - 오늘 손실(실현+평가)이 하루 시작 자산의 dailyLossLimitPct 이상 → 신규 진입 중지(M4-04)
 * - 최근 연속 손실이 maxConsecutiveLosses 이상 → 신규 진입 중지, 쉬기·규모 축소 권고(5.5)
 * - 설정한 1회 손실 비율이 1.5% 초과, 종목당 최대 비중이 30% 초과 → 경고(M4-04, M4-03)
 */
export function tradingGuards(input: {
  /** 청산 거래의 순수익률(%) — 시간순(오래된 것 먼저) */
  closedReturnsPct: number[];
  /** 오늘 실현+평가 손익(통화 단위) */
  todayPnl: number;
  equityStartOfDay: number;
  /** 설정의 1회 손절 시 손실 비율(%) */
  riskPct: number;
  /** 설정의 종목당 최대 비중(%) */
  maxWeightPct: number;
  params?: Partial<GuardParams>;
}): GuardResult {
  const P = { ...GUARD_DEFAULTS, ...input.params };
  const notes: Note[] = [];
  let blocked = false;

  if (P.dailyLossLimitPct > 0) {
    if (input.equityStartOfDay > 0 && Number.isFinite(input.todayPnl)) {
      const lossPct = (-input.todayPnl / input.equityStartOfDay) * 100;
      if (lossPct >= P.dailyLossLimitPct) {
        blocked = true;
        notes.push({ tone: "bad", text: `오늘 손실이 ${pctText(lossPct)}%로 하루 한도(${P.dailyLossLimitPct}%)에 닿았어요. 오늘은 신규 진입을 멈춰요.`, rule: RULE.dailyLoss });
      }
    } else {
      notes.push({ tone: "warn", text: "하루 시작 자산이나 오늘 손익을 몰라서 일일 손실 한도를 확인하지 못했어요.", rule: RULE.dailyLoss });
    }
  }

  const streak = consecutiveLosses(input.closedReturnsPct);
  if (P.maxConsecutiveLosses > 0 && streak >= P.maxConsecutiveLosses) {
    blocked = true;
    notes.push({ tone: "bad", text: `최근 ${streak}번 연속 손실이에요. 잠시 쉬고, 다시 시작할 때는 규모를 줄여요.`, rule: RULE.streak });
  }

  if (P.maxPerTradeRiskPct > 0 && input.riskPct > P.maxPerTradeRiskPct)
    notes.push({ tone: "warn", text: `1회 손실 비율이 ${input.riskPct}%예요. 한 번 손절로 계좌의 ${P.maxPerTradeRiskPct}%를 넘게 잃지 않게 낮춰요.`, rule: RULE.perTrade });
  if (P.maxWeightPct > 0 && input.maxWeightPct > P.maxWeightPct)
    notes.push({ tone: "warn", text: `종목당 최대 비중이 ${input.maxWeightPct}%예요. 한 종목에 ${P.maxWeightPct}% 넘게 싣지 않아요.`, rule: RULE.weight });

  return { blocked, notes };
}

/**
 * 끝에서부터 이어진 손실 거래 수. 0%도 손실로 센다(stats·summarizeJournal과 같은 기준).
 * 숫자가 아닌 값은 건너뛴다. 앞쪽(과거) 값만 쓰므로 i번째까지 잘라 넣으면 그 시점의 값이 나온다.
 */
export function consecutiveLosses(returnsPct: number[]): number {
  let n = 0;
  for (let i = returnsPct.length - 1; i >= 0; i--) {
    const x = returnsPct[i]!;
    if (!Number.isFinite(x)) continue;
    if (x > 0) break;
    n++;
  }
  return n;
}

/**
 * 날짜순, 같은 날은 기록한 순서 그대로(안정 정렬). 기록에는 시각이 없지만 매매일지는 일어난 순서대로 쌓이므로
 * 같은 날 '매도 후 재매수'를 새 포지션으로 본다(매수를 먼저 놓으면 물타기로 잘못 센다)
 */
const chronological = (a: JournalEntry, b: JournalEntry) => a.date.localeCompare(b.date);

const priceText = (x: number) => (Math.round(x * 100) / 100).toLocaleString();

/**
 * 손실 중 추가 매수(물타기) 점검. 같은 종목 보유분(선입선출)의 평균 단가보다 낮은 가격에 더 사면 손실 중 추가 매수로 센다.
 * 평균 단가 이상에서 더 사는 것(이익 중 추가 매수)은 허용하고 세지 않는다. 보유분을 다 팔면 횟수를 0으로 되돌린다.
 * 주문일(next.date) 이후의 기록은 보지 않는다. lossAdds는 이번 주문을 포함한 현재 보유분의 손실 중 추가 매수 횟수.
 */
export function averagingDownCheck(
  entries: JournalEntry[],
  next: { code: string; side: "BUY" | "SELL"; price: number; date: string },
  params: Partial<GuardParams> = {},
): { allowed: boolean; lossAdds: number; notes: Note[] } {
  const P = { ...GUARD_DEFAULTS, ...params };
  const mine = entries.filter((e) => e.code === next.code && e.date <= next.date).sort(chronological);
  const lots: { price: number; qty: number }[] = [];
  let lossAdds = 0;
  const avg = () => {
    const qty = lots.reduce((a, l) => a + l.qty, 0);
    return qty > 0 ? lots.reduce((a, l) => a + l.price * l.qty, 0) / qty : null;
  };

  for (const e of mine) {
    if (e.side === "BUY") {
      const a = avg();
      if (a != null && e.price < a) lossAdds++;
      lots.push({ price: e.price, qty: e.qty });
      continue;
    }
    let remain = e.qty;
    while (remain > 0 && lots.length) {
      const lot = lots[0]!;
      const take = Math.min(lot.qty, remain);
      lot.qty -= take;
      remain -= take;
      if (lot.qty === 0) lots.shift();
    }
    if (lots.length === 0) lossAdds = 0; // 다 팔았으면 다음 매수부터 새 포지션
  }

  const a = avg();
  if (next.side === "SELL" || a == null) return { allowed: true, lossAdds, notes: [] };
  if (next.price >= a)
    return {
      allowed: true,
      lossAdds,
      notes: [{ tone: "info", text: `평균 단가(${priceText(a)}) 이상에서 더 사는 거라 손실 중 추가 매수로 세지 않아요.`, rule: RULE.pyramid }],
    };

  const count = lossAdds + 1;
  if (count > P.maxLossAdds)
    return {
      allowed: false,
      lossAdds: count,
      notes: [
        { tone: "bad", text: `평균 단가(${priceText(a)})보다 낮은 추가 매수가 이번이 ${count}번째예요. 손실 중 추가 매수는 ${P.maxLossAdds}회까지만 해요.`, rule: RULE.lossAdd },
        { tone: "bad", text: "물타기는 실패의 지름길이에요. 평균 단가를 낮추려 사지 말고 손절 기준부터 다시 봐요.", rule: RULE.averagingDown },
      ],
    };
  return {
    allowed: true,
    lossAdds: count,
    notes: [{ tone: "warn", text: `손실 중 추가 매수예요(${count}/${P.maxLossAdds}회). 처음부터 계획한 분할 매수일 때만 해요.`, rule: RULE.lossAdd }],
  };
}

/**
 * 매수 주문 전 체크리스트(5.5 구현 메모: 손절가·목표가·비중을 필수 입력으로). 걸린 항목만 돌려준다.
 * tone "bad"는 채우거나 고쳐야 하는 항목, "warn"은 다시 생각해 볼 항목. 비어 있으면 통과.
 */
export function preTradeChecklist(
  e: { stop?: number; target?: number; reason?: string; price?: number; weightPct?: number },
  params: Partial<GuardParams> = {},
): Note[] {
  const P = { ...GUARD_DEFAULTS, ...params };
  const notes: Note[] = [];
  const valid = (x: number | undefined): x is number => x != null && Number.isFinite(x) && x > 0;
  const price = valid(e.price) ? e.price : null;

  if (!valid(e.stop)) notes.push({ tone: "bad", text: "손절가를 먼저 정해요. 사기 전에 얼마까지 잃을지 적어 둬요.", rule: RULE.stopFirst });
  else if (price != null) {
    if (e.stop >= price) notes.push({ tone: "bad", text: "손절가가 매수가보다 높거나 같아요. 매수가 아래로 다시 정해요.", rule: RULE.stopFirst });
    else {
      const stopPct = (1 - e.stop / price) * 100;
      if (P.maxStopPct > 0 && stopPct > P.maxStopPct)
        notes.push({ tone: "warn", text: `손절폭이 ${pctText(stopPct)}%로 최대 ${P.maxStopPct}%를 넘어요. 진입 시점을 늦춰 폭을 줄여요.`, rule: RULE.stopWidth });
    }
  }

  if (!valid(e.target)) notes.push({ tone: "bad", text: "목표가(매도 기준)를 먼저 적어요.", rule: RULE.plan });
  else if (price != null && e.target <= price) notes.push({ tone: "bad", text: "목표가가 매수가보다 낮거나 같아요.", rule: RULE.plan });

  if (!e.reason?.trim()) notes.push({ tone: "bad", text: "매수 근거를 적어요. 분석 없이 사지 않아요.", rule: RULE.plan });

  // 5.5 구현 메모: 손절가·목표가·비중은 필수 입력
  if (!valid(e.weightPct)) notes.push({ tone: "bad", text: "비중(계좌 대비 %)을 먼저 정해요.", rule: RULE.plan });
  else if (P.maxWeightPct > 0 && e.weightPct > P.maxWeightPct)
    notes.push({ tone: "bad", text: `비중이 ${pctText(e.weightPct)}%예요. 한 종목에 ${P.maxWeightPct}% 넘게 싣지 않아요.`, rule: RULE.weight });

  return notes;
}

/**
 * 그날(date) 자동(모의) 매도 기록의 비용 반영 순손익 합계(실현 손익만, 평가손익은 따로 더한다).
 * 통화가 섞이지 않게 호출 전에 통화별로 걸러서 넘긴다.
 */
export function todayPnl(entries: JournalEntry[], date: string): number {
  let sum = 0;
  for (const e of entries) {
    if (e.side !== "SELL" || e.date !== date || e.source !== "자동(모의)") continue;
    const { pnl } = netOf(e);
    if (pnl != null) sum += pnl;
  }
  return sum;
}
