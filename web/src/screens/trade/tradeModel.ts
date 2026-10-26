import type { OrderRequest } from "../../features/OrderReviewSheet";
import { accountBaseOf } from "../../features/orderMath";
import { fmtBig, fmtRatio } from "../../ui/format";
import {
  consecutiveLosses, currencyOfRegion, EXPOSURE_CAP_REASON, MANUAL_STRATEGY, marketClock, paperEquity, paperTradesFromJournal, regionOfCode, weekdaysBetween,
  type Currency, type JournalEntry, type Note, type PaperAccount, type PaperPosition, type Plan, type Region, type ServerState, type Settings,
} from "@jusik/shared";

/*
 * 매매 화면(보유 종목, 비중과 손실 한도, 오늘의 계획)이 쓰는 순수 계산.
 * 화면 그리기와 떼어 두어 테스트한다(web/test/trade-model.test.ts).
 */

export const CURRENCIES: Currency[] = ["KRW", "USD"];
export const CUR_NAME: Record<Currency, string> = { KRW: "원화", USD: "달러" };
export const CUR_ACCOUNT: Record<Currency, string> = { KRW: "원화 계좌(국내)", USD: "달러 계좌(미국)" };
export const regionOfCur = (c: Currency): Region => (c === "USD" ? "US" : "KR");

/** 손절가까지 남은 거리가 이 값(%) 이하면 경고색(서버 알림·홈과 같은 2%) */
export const NEAR_STOP_PCT = 2;

/** 매매일지에서 직접 쓴 기록인가(출처가 없던 이전 기록도 직접 쓴 것으로 본다) */
export const isManual = (e: Pick<JournalEntry, "source">) => (e.source ?? "수동") === "수동";

/**
 * 화면에 보일 통화: 스캔하는 시장이 있거나, 모의 보유·계획이 있는 통화.
 * 아무것도 없으면 원화만 보인다(빈 화면에 다음 행동을 안내하려고).
 */
export function currenciesShown(st: Pick<ServerState, "settings" | "paper" | "latestScan">): Currency[] {
  const m = st.settings.markets;
  const out = CURRENCIES.filter((c) => {
    const market = c === "KRW" ? m.KOSPI || m.KOSDAQ : m.US;
    return market || st.paper[c].positions.length > 0 || (st.latestScan?.plans[c]?.items.length ?? 0) > 0;
  });
  return out.length ? out : ["KRW"];
}

/** 그 시장의 오늘 날짜(현지) */
export const todayOf = (region: Region, now: Date) => marketClock(region, now).date;

/**
 * 모의계좌 시세의 기준 시각: 서버가 보유 종목 현재가를 마지막으로 받은 때(paper.pricedAt), 없으면 마지막 스캔 시각.
 * 화면이 서버 상태를 받은 시각(serverAt)은 데이터 시각이 아니라서 쓰지 않는다.
 */
export function paperAsOf(st: Pick<ServerState, "paper" | "latestScan">, cur: Currency): string | null {
  return st.paper[cur].pricedAt ?? st.latestScan?.at ?? null;
}

// ───────────────────────── 모의계좌 보유 ─────────────────────────

export interface PositionView {
  position: PaperPosition;
  last: number;
  /** 평가손익(최근가 × 수량 − 수수료 포함 매수 원가) */
  pnl: number;
  /** 평가손익률(원가 대비 %) */
  pnlPct: number | null;
  /** 손절가까지 남은 거리(%) — 음수면 이미 손절가 아래 */
  leftToStopPct: number | null;
  /** 목표가까지 남은 거리(%) */
  toTargetPct: number | null;
  nearStop: boolean;
  /** 진입 뒤 지난 거래일(평일) 수 */
  heldDays: number;
  /** 계좌 총자산 대비 비중(%) */
  weightPct: number | null;
}

export function positionView(p: PaperPosition, today: string, equity: number): PositionView {
  const last = p.lastPrice ?? p.entryPrice;
  const value = p.qty * last;
  const pnl = value - p.cost;
  const left = last > 0 && p.stop > 0 ? ((last - p.stop) / last) * 100 : null;
  return {
    position: p,
    last,
    pnl,
    pnlPct: p.cost > 0 ? (pnl / p.cost) * 100 : null,
    leftToStopPct: left,
    toTargetPct: last > 0 && p.target > 0 ? ((p.target - last) / last) * 100 : null,
    nearStop: left != null && left <= NEAR_STOP_PCT,
    heldDays: today >= p.entryDate ? weekdaysBetween(p.entryDate, today) : 0,
    weightPct: equity > 0 ? (value / equity) * 100 : null,
  };
}

export interface AccountView {
  currency: Currency;
  equity: number;
  cash: number;
  /** 보유 평가액 */
  heldValue: number;
  unrealized: number;
  realized: number;
  closed: number;
  wins: number;
  /** 청산 거래 중 이익 비율(0~1). 청산이 없으면 null */
  winRate: number | null;
  positions: PositionView[];
}

export function accountView(acct: PaperAccount, currency: Currency, today: string): AccountView {
  const equity = paperEquity(acct);
  const positions = acct.positions.map((p) => positionView(p, today, equity));
  return {
    currency,
    equity,
    cash: acct.cash,
    heldValue: equity - acct.cash,
    unrealized: positions.reduce((a, x) => a + x.pnl, 0),
    realized: acct.realizedPnl,
    closed: acct.closed,
    wins: acct.wins,
    winRate: acct.closed > 0 ? acct.wins / acct.closed : null,
    positions,
  };
}

// ───────────────────────── 내 기록(직접) 보유 ─────────────────────────

export interface ManualHolding {
  code: string;
  name: string;
  region: Region;
  currency: Currency;
  /** 남은 수량(매수 − 매도, 선입선출) */
  qty: number;
  /** 남은 수량의 평균 단가 */
  avgPrice: number;
  /** 남은 수량의 매수 금액 */
  cost: number;
  /** 남은 매수분 중 가장 오래된 날 */
  since: string;
  /** 가장 최근 매수 기록의 손절가·목표가·전략 */
  stop?: number;
  target?: number;
  strategy?: string;
}

/**
 * 직접 쓴 매매일지에서 지금 들고 있는 종목(종목별 선입선출). 자동(모의) 기록은 모의계좌에 따로 있으니 뺀다.
 * oversold: 보유 수량보다 많이 판 기록이 있는 종목코드(입력 실수일 수 있어 알려 준다)
 */
export function manualHoldings(journal: JournalEntry[]): { holdings: ManualHolding[]; oversold: string[] } {
  // 날짜순, 같은 날은 기록 순서 그대로(안정 정렬) — 같은 날 '매도 후 재매수'를 새 매수로 본다
  const mine = journal.map((e, i) => ({ e, i })).filter((x) => isManual(x.e)).sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i).map((x) => x.e);
  const lots = new Map<string, { date: string; price: number; qty: number }[]>();
  const last = new Map<string, JournalEntry>();
  const names = new Map<string, string>();
  const oversold = new Set<string>();
  for (const e of mine) {
    const q = lots.get(e.code) ?? [];
    lots.set(e.code, q);
    names.set(e.code, e.name || names.get(e.code) || e.code);
    if (e.side === "BUY") {
      if (e.qty > 0) q.push({ date: e.date, price: e.price, qty: e.qty });
      last.set(e.code, e);
      continue;
    }
    let remain = e.qty;
    while (remain > 0 && q.length) {
      const lot = q[0]!;
      const take = Math.min(lot.qty, remain);
      lot.qty -= take;
      remain -= take;
      if (lot.qty === 0) q.shift();
    }
    if (remain > 0) oversold.add(e.code);
  }
  const holdings: ManualHolding[] = [];
  for (const [code, q] of lots) {
    const qty = q.reduce((a, l) => a + l.qty, 0);
    if (!(qty > 0)) continue;
    const cost = q.reduce((a, l) => a + l.price * l.qty, 0);
    const buy = last.get(code);
    const region = regionOfCode(code);
    holdings.push({
      code, name: names.get(code) ?? code, region, currency: currencyOfRegion(region), qty, avgPrice: cost / qty, cost, since: q[0]!.date,
      ...(buy?.stop && buy.stop > 0 ? { stop: buy.stop } : {}),
      ...(buy?.target && buy.target > 0 ? { target: buy.target } : {}),
      ...(buy?.strategy ? { strategy: buy.strategy } : {}),
    });
  }
  holdings.sort((a, b) => b.since.localeCompare(a.since) || a.name.localeCompare(b.name, "ko"));
  return { holdings, oversold: [...oversold] };
}

/** 매도 주문 검토: 지금 가격(모르면 평균 단가). 전략은 그 종목을 산 기록의 전략(없으면 '직접 판단') */
export function sellRequest({ h, q }: { h: ManualHolding; q?: { price: number } }): OrderRequest {
  return { code: h.code, name: h.name, side: "SELL", price: q?.price ?? h.avgPrice, strategy: h.strategy ?? MANUAL_STRATEGY };
}

/**
 * 추가 매수 주문 검토. 예전에 적은 손절가는 지금 가격보다 낮을 때만 넘긴다
 * (이미 손절가 아래인 종목에 그 값을 넣으면 시트가 잘못된 손절가와 수량 0으로 열린다). 목표가는 지금 가격보다 높을 때만.
 */
export function buyMoreRequest({ h, q }: { h: ManualHolding; q?: { price: number } }): OrderRequest {
  const price = q?.price ?? h.avgPrice;
  return {
    code: h.code, name: h.name, side: "BUY", price,
    ...(h.stop && h.stop < price ? { stop: h.stop } : {}), ...(h.target && h.target > price ? { target: h.target } : {}), strategy: h.strategy ?? MANUAL_STRATEGY,
  };
}

/** 직접 보유분 중 손절가 근접(2% 안쪽)이거나 이미 손절가 아래인 종목 수(현재가를 받은 종목만) */
export function manualNearStopCount(holdings: ManualHolding[], prices: Record<string, { price: number } | undefined>): number {
  return holdings.filter((h) => {
    const left = holdingPnl(h, prices[h.code]?.price).leftToStopPct;
    return left != null && left <= NEAR_STOP_PCT;
  }).length;
}

/** 직접 보유분의 평가(현재가를 받았을 때) */
export function holdingPnl(h: ManualHolding, price: number | null | undefined): { value: number | null; pnl: number | null; pct: number | null; leftToStopPct: number | null } {
  if (price == null || !(price > 0)) return { value: null, pnl: null, pct: null, leftToStopPct: null };
  const value = price * h.qty;
  const pnl = value - h.cost;
  return {
    value,
    pnl,
    pct: h.cost > 0 ? (pnl / h.cost) * 100 : null,
    leftToStopPct: h.stop ? ((price - h.stop) / price) * 100 : null,
  };
}

// ───────────────────────── 연속 손실 ─────────────────────────

/** 모의 자동매매의 끝에서부터 이어진 손실 거래 수(서버 리스크 가드와 같은 기준: 그 지역 자동(모의) 청산 거래) */
export function paperLossStreak(journal: JournalEntry[], region: Region): number {
  const mine = journal.filter((e) => regionOfCode(e.code) === region);
  return consecutiveLosses(paperTradesFromJournal(mine).map((t) => t.returnPct));
}

/**
 * 연속 손실 미터의 상태 문구. 서버가 실제로 쉬게 하는 동안만 '휴식 중'이고,
 * 쉬는 기간(마지막 손실일과 그다음 거래일)이 지나면 '휴식 끝남'(서버가 '규모를 줄이세요' 노트를 함께 준다)
 */
export function streakMeterText(streak: number, max: number, resting: boolean): { nearText: string; overText: string } {
  const after = resting ? "휴식 중" : "휴식 끝남";
  return { nearText: max > 0 && streak >= max ? after : "휴식 기준 근접", overText: after };
}

/** 직접 기록한 매매의 연속 손실: 쉬는 기간이 지났으면 서버의 모의 노트처럼 '규모를 줄이세요'를 메모로 */
export function manualStreakNotes(m: { streak: number; resting: boolean }, max: number): Note[] {
  if (!(max > 0) || m.streak < max || m.resting) return [];
  return [{ tone: "warn", text: `직접 기록한 매매가 최근 ${m.streak}번 연속 손실 뒤 쉬었어요. 다시 들어가되 규모를 줄이세요.` }];
}

// ───────────────────────── 오늘의 계획 ─────────────────────────

/** 제외 사유별 개수(많은 순) */
export function reasonCounts(plan: Pick<Plan, "skipped">): [string, number][] {
  const m = new Map<string, number>();
  for (const x of plan.skipped) m.set(x.reason, (m.get(x.reason) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
}

export const capHit = (plan: Pick<Plan, "skipped">) => plan.skipped.some((x) => x.reason === EXPOSURE_CAP_REASON);

/** 계획 전체의 손절 시 손실 합계 */
export const planRisk = (plan: Pick<Plan, "items">) => plan.items.reduce((a, i) => a + i.riskAmount, 0);

/**
 * 계획이 기준으로 삼은 현금. 계획에 그때의 현금(plan.cash)이 있으면 그 값을 '계획 당시 현금'으로 쓴다
 * (모의매매가 계획대로 산 뒤의 지금 현금과 계획의 '남는 현금'을 한 줄에 섞지 않으려고).
 * 이전 저장분처럼 plan.cash가 없을 때만 지금 값: 모의매매를 켜면 모의계좌 현금, 끄면 예수금.
 */
export function planCashBase(st: Pick<ServerState, "settings" | "paper">, cur: Currency, plan?: Pick<Plan, "cash">): { cash: number; label: string; snapshot: boolean } {
  const s = st.settings;
  if (plan?.cash != null && Number.isFinite(plan.cash)) return { cash: plan.cash, label: "계획 당시 현금", snapshot: true };
  return s.paperEnabled
    ? { cash: st.paper[cur].cash, label: "모의계좌 현금", snapshot: false }
    : { cash: cur === "KRW" ? s.depositKRW : s.depositUSD, label: "예수금", snapshot: false };
}

/** '계좌의 x%'에 쓰는 기준 금액: 모의매매를 켜면 모의계좌 총자산, 끄면 예수금 */
export function accountBase(st: Pick<ServerState, "settings" | "paper">, cur: Currency): number {
  return accountBaseOf(st, cur);
}

export const planKey = (cur: Currency, code: string) => `${cur}:${code}`;

/**
 * 금액(목록): 국내는 억·만 단위로 줄이고 '원'을 손익 금액처럼 띄어 쓴다('199만 원', 만 아래는 '5,000원'), 미국은 $.
 */
export function amountText(n: number, cur: Currency): string {
  if (cur === "USD") return fmtBig(n, "US");
  const b = fmtBig(n, "KR");
  return b === "-" ? b : /[만억조]$/.test(b) ? `${b} 원` : `${b}원`;
}

/** 손익비(순손익비 등): 소수 첫째 자리 고정(지도서 '2.6') */
export const payoffText = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "-" : x.toFixed(1));

/** 손절가·목표가의 진입가 대비 거리(%) */
export const distPct = (from: number, to: number) => (from > 0 && to > 0 ? ((to - from) / from) * 100 : null);

// ───────────────────────── 한도 설정 요약 ─────────────────────────

export interface RuleLine {
  label: string;
  value: string;
  hint?: string;
}

/** 지금 적용 중인 규칙(설정에서 바꾼다) */
export function ruleLines(s: Settings, fmtMoney: (n: number, c: Currency) => string): RuleLine[] {
  const pct = (n: number) => fmtRatio(n);
  return [
    { label: "1회 손실 비율", value: pct(s.riskPct), hint: "한 번 손절할 때 예수금 대비 잃어도 되는 비율" },
    { label: "종목 비중 상한", value: pct(s.maxWeightPct), hint: "한 종목에 싣는 최대 비중" },
    { label: "최대 종목 수", value: `${s.maxPositions}종목` },
    { label: "예비 현금", value: pct(s.reservePct), hint: "늘 남겨 두는 현금" },
    { label: "국면별 비중 상한", value: `공격 ${pct(s.postureCaps.ATTACK)} · 중립 ${pct(s.postureCaps.NEUTRAL)} · 방어 ${pct(s.postureCaps.DEFENSE)}` },
    { label: "일일 손실 한도", value: s.dailyLossLimitPct > 0 ? fmtRatio(-s.dailyLossLimitPct) : "꺼짐", hint: "하루 시작 자산 대비" },
    { label: "연속 손실 휴식", value: s.maxConsecutiveLosses > 0 ? `${s.maxConsecutiveLosses}회` : "꺼짐" },
    { label: "예수금", value: `${fmtMoney(s.depositKRW, "KRW")} · ${fmtMoney(s.depositUSD, "USD")}` },
    { label: "모의매매 자동 실행", value: s.paperEnabled ? "켜짐" : "꺼짐" },
  ];
}
