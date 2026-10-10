import { BUY_ACTIONS, SELL_ACTIONS } from "./action";
import { DEFAULT_BACKTEST, summarize, type BacktestResult, type EquityPoint, type Trade } from "./backtest";
import { DAYTRADE_BY_REGION, scoreDayTrade, type DayTradeParams, type StockRef } from "./daytrade";
import { DEFAULT_REPLAY } from "./dayEval";
import { computeIndicators, type IndicatorSet, type Series } from "./indicators";
import { regimeByWeek, type Regime } from "./regime";
import { prepareStage, relativeStrength, stageAt, STAGE_LABEL, type StageResult } from "./stage";
import { regionOf, type Candle } from "./types";
import { toWeekly, weekKeyOf, type WeeklyBar } from "./weekly";

/*
 * 전략 단위 백테스트(자료집 1.1·4장 구현 메모).
 * 책마다 시간 단위가 달라 한 신호 엔진에 섞으면 충돌하므로, 전략마다
 * '진입 조건 · 초기 손절 · 목표/추적 청산 · 포지션 크기'를 한 세트로 묶고 같은 엔진·같은 데이터로 비교한다.
 * 기준값은 저자 경험칙이라 전부 파라미터로 열어 둔다(백테스트로 조정할 대상).
 */

// ───────────────────────── 공통 타입 ─────────────────────────

export interface StrategyContext {
  /** 시장 지수 일봉. 있으면 지수 약세 국면 진입 금지·상대강도에 쓴다 */
  index?: Candle[];
  /** 종목 정보. 단타 전략의 지역별 기준값(국내/미국)을 고를 때 쓴다. 없으면 국내 종목으로 본다 */
  ref?: StockRef;
}

/** i일 종가에 낸 매수 주문. 다음 봉 시가에 체결한다 */
export interface StrategyEntry {
  /** 초기 손절가 */
  stop: number;
  /** 목표가. 닿으면 targetFraction만큼 판다 */
  target?: number;
  reason: string;
  /** 근거 규칙(예: "M3-05 설춘환") */
  rule?: string;
  /** 목표가에서 팔 비율(0~1, 기본 1 = 전량) */
  targetFraction?: number;
  /** 있으면 stop 대신 '체결 봉 시가 × (1 − stopPct%)'를 손절가로 쓴다 */
  stopPct?: number;
  /** 있으면 target 대신 '체결 봉 시가 × (1 + targetPct%)'를 목표가로 쓴다 */
  targetPct?: number;
  /** 다음 날 시가가 이 가격보다 높으면(갭 상승 추격) 주문을 취소한다 */
  maxEntryPrice?: number;
  /** 예수금 중 쓸 비율(0~1, 기본 1). 포지션 크기 규칙 */
  sizeFraction?: number;
  stopRule?: string;
  targetRule?: string;
}

/** i일 종가에 낸 매도 주문. 기본은 다음 봉 시가 체결 */
export interface StrategyExit {
  /** 남은 수량 중 팔 비율(0~1) */
  fraction: number;
  reason: string;
  kind: "SIGNAL" | "PARTIAL" | "TIME";
  rule?: string;
  /**
   * true면 다음 날 시가가 아니라 i일 종가에 판다. 보유 기간처럼 가격과 무관하게 장 마감 전에 알 수 있는
   * 조건(kind = "TIME")에만 허용한다 — 가격 조건에 쓰면 종가를 보고 종가에 파는 미래 참조가 된다.
   */
  atClose?: boolean;
}

export interface StrategyPosition {
  /** 체결 봉 인덱스 */
  entryIndex: number;
  entryDate: string;
  /** 체결가(슬리피지 반영) */
  entryPrice: number;
  /** 지금 남은 수량 */
  shares: number;
  initialShares: number;
  stop: number;
  target: number | null;
  targetFraction: number;
  /** 목표가에서 이미 일부를 팔았는지 */
  targetHit: boolean;
  /** 부분 청산 횟수(목표·신호·시간 모두) */
  partialExits: number;
  entryReason: string;
}

export interface Strategy<P = unknown> {
  id: string;
  name: string;
  /** 출처(저자) */
  source: string;
  timeframe: "daily" | "weekly";
  description: string;
  /** 근거 규칙 ID와 출처 */
  rules: string[];
  prepare(candles: Candle[], ctx: StrategyContext): P;
  /** 진입을 평가할 수 있는 첫 봉 인덱스(지표가 계산되기 시작하는 곳) */
  startIndex(prep: P): number;
  /** i일 종가 시점 평가(i까지의 데이터만). 보유 중이 아닐 때만 부른다 */
  entry(i: number, prep: P): StrategyEntry | null;
  /** i일 종가 시점 평가(i까지의 데이터만). 보유 중일 때만 부른다 */
  exit(i: number, pos: StrategyPosition, prep: P): StrategyExit | null;
  /** 추적 손절. 지금 손절가보다 높을 때만 반영한다(내리지 않는다) */
  updateStop?(i: number, pos: StrategyPosition, prep: P): number | null;
  /** 보유 중에 목표가가 새로 생길 때(예: 스윙 목표). 목표가가 없고 아직 목표 청산을 안 했을 때만 반영한다 */
  updateTarget?(i: number, pos: StrategyPosition, prep: P): { price: number; fraction: number; rule?: string } | null;
}

export interface RunOptions {
  initialCash: number;
  /** 수수료율(매수·매도 각각) */
  feeRate: number;
  /** 매도 거래세율 */
  sellTaxRate: number;
  /** 체결 슬리피지(%) — 매수는 비싸게, 매도는 싸게. 기본값은 단타 재현과 같은 0.1% */
  slippagePct: number;
  /** 평가 시작 봉. 전략 비교 때 같은 구간을 쓰도록 맞춘다(전략의 첫 봉보다 앞이면 무시) */
  startIndex: number;
}

export const DEFAULT_RUN: RunOptions = {
  initialCash: DEFAULT_BACKTEST.initialCash,
  feeRate: DEFAULT_BACKTEST.feeRate,
  sellTaxRate: DEFAULT_BACKTEST.sellTaxRate,
  slippagePct: DEFAULT_REPLAY.slippagePct,
  startIndex: 0,
};

export interface StrategyTrade extends Trade {
  entryReason: string;
  exitReason: string;
  entryRule?: string;
  exitRule?: string;
}

export interface StrategyBacktest extends BacktestResult {
  strategyId: string;
  /** 부분 청산도 한 건씩 기록한다(승률·거래 수도 매도 건 기준) */
  trades: StrategyTrade[];
}

export const TRADE_REASON_LABEL: Record<Trade["reason"], string> = {
  SIGNAL: "신호 매도",
  STOP_LOSS: "손절",
  TARGET: "목표가",
  PARTIAL: "분할 매도",
  TIME: "시간 청산",
};

// ───────────────────────── 엔진 ─────────────────────────

interface Holding extends StrategyPosition {
  /** 수수료 포함 1주 원가 */
  costPerShare: number;
  entryRule?: string;
  stopRule?: string;
  targetRule?: string;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const px = (x: number) => (Math.abs(x) >= 1000 ? Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : x.toFixed(2));

/**
 * 전략 하나를 일봉에 적용한다. 봉마다 순서:
 * (1) 직전 종가에 정한 주문을 오늘 시가에 체결
 * (2) 보유 중이면 장중 손절(저가 ≤ 손절 → min(시가, 손절)) 먼저, 그다음 목표(고가 ≥ 목표 → max(시가, 목표)). 같은 봉에서 둘 다 닿으면 손절
 * (3) 종가에 exit / updateStop / entry 평가(i까지의 데이터만)
 * 한 번에 한 포지션, 정수 주식, 수수료·매도세·슬리피지 반영. 청산한 봉에서는 다시 진입하지 않는다.
 */
export function runStrategy<P>(strategy: Strategy<P>, candles: Candle[], ctx: StrategyContext = {}, opts: Partial<RunOptions> = {}): StrategyBacktest | null {
  if (candles.length < 2) return null;
  return runPrepared(strategy, candles, strategy.prepare(candles, ctx), { ...DEFAULT_RUN, ...opts });
}

function runPrepared<P>(strategy: Strategy<P>, candles: Candle[], prep: P, o: RunOptions): StrategyBacktest | null {
  const start = Math.max(strategy.startIndex(prep), o.startIndex);
  if (!(start >= 0) || start >= candles.length - 1) return null;
  const slip = o.slippagePct / 100;

  let cash = o.initialCash;
  let pos: Holding | null = null;
  let pendingBuy: StrategyEntry | null = null;
  let pendingExit: StrategyExit | null = null;
  const trades: StrategyTrade[] = [];
  const equity: EquityPoint[] = [];

  const firstOpen = candles[start]!.open;
  const bhShares = Math.floor(o.initialCash / (firstOpen * (1 + o.feeRate)));
  const bhCash = o.initialCash - bhShares * firstOpen * (1 + o.feeRate);

  const qtyOf = (h: Holding, fraction: number) => (fraction >= 1 ? h.shares : Math.min(h.shares, Math.max(1, Math.floor(h.shares * fraction))));

  /** 보유분 중 qty주를 판다(가격은 슬리피지 전). 남은 포지션, 다 팔았으면 null */
  const sell = (h: Holding, i: number, rawPrice: number, qty: number, reason: Trade["reason"], text: string, rule?: string): Holding | null => {
    const price = rawPrice * (1 - slip);
    const gross = qty * price;
    const proceeds = gross - gross * (o.feeRate + o.sellTaxRate);
    trades.push({
      buyDate: h.entryDate, buyPrice: h.entryPrice, sellDate: candles[i]!.date, sellPrice: price, shares: qty,
      returnPct: (proceeds / (qty * h.costPerShare) - 1) * 100, reason, fraction: qty / h.initialShares,
      entryReason: h.entryReason, exitReason: text, entryRule: h.entryRule, exitRule: rule,
    });
    cash += proceeds;
    h.shares -= qty;
    return h.shares > 0 ? h : null;
  };

  const buy = (e: StrategyEntry, i: number): Holding | null => {
    const c = candles[i]!;
    if (e.maxEntryPrice != null && c.open > e.maxEntryPrice) return null; // 갭 상승 추격 안 함
    const stop = e.stopPct != null ? c.open * (1 - e.stopPct / 100) : e.stop;
    if (!(c.open > stop)) return null; // 이미 손절가 아래에서 시작하면 들어가지 않는다
    const price = c.open * (1 + slip);
    const n = Math.floor((cash * clamp01(e.sizeFraction ?? 1)) / (price * (1 + o.feeRate)));
    if (n < 1) return null;
    const costPerShare = price * (1 + o.feeRate);
    cash -= n * costPerShare;
    const target = e.targetPct != null ? c.open * (1 + e.targetPct / 100) : e.target;
    return {
      entryIndex: i, entryDate: c.date, entryPrice: price, shares: n, initialShares: n, stop,
      target: target != null && target > price ? target : null, targetFraction: clamp01(e.targetFraction ?? 1),
      targetHit: false, partialExits: 0, entryReason: e.reason, costPerShare, entryRule: e.rule, stopRule: e.stopRule, targetRule: e.targetRule,
    };
  };

  const view = (h: Holding): StrategyPosition => ({ ...h });

  for (let i = start; i < candles.length; i++) {
    const c = candles[i]!;
    let closedToday = false;

    // 1) 직전 종가에 정한 주문을 오늘 시가에 체결
    if (pendingExit && pos) {
      const ex: StrategyExit = pendingExit;
      pos = sell(pos, i, c.open, qtyOf(pos, ex.fraction), ex.kind, ex.reason, ex.rule);
      if (pos) pos.partialExits++;
      else closedToday = true;
    } else if (pendingBuy && !pos) {
      pos = buy(pendingBuy, i);
    }
    pendingBuy = null;
    pendingExit = null;

    // 2) 장중 손절 먼저, 그다음 목표
    if (pos && c.low <= pos.stop) {
      pos = sell(pos, i, Math.min(c.open, pos.stop), pos.shares, "STOP_LOSS", `손절가 ${px(pos.stop)} 이탈`, pos.stopRule);
      closedToday = true;
    } else if (pos && pos.target != null && c.high >= pos.target) {
      const t = pos.target;
      pos = sell(pos, i, Math.max(c.open, t), qtyOf(pos, pos.targetFraction), "TARGET", `목표가 ${px(t)} 도달`, pos.targetRule);
      if (pos) {
        pos.target = null;
        pos.targetHit = true;
        pos.partialExits++;
      } else closedToday = true;
    }

    // 3) 종가에 청산·손절 갱신·진입 평가(체결은 다음 봉 시가)
    if (pos) {
      const ex = strategy.exit(i, view(pos), prep);
      if (ex && ex.fraction > 0) {
        if (ex.kind === "TIME" && ex.atClose) {
          pos = sell(pos, i, c.close, qtyOf(pos, ex.fraction), "TIME", ex.reason, ex.rule);
          if (pos) pos.partialExits++;
          else closedToday = true;
        } else pendingExit = ex;
      }
      if (pos) {
        const ns = strategy.updateStop?.(i, view(pos), prep);
        if (ns != null && ns > pos.stop) pos.stop = ns;
        if (pos.target == null && !pos.targetHit) {
          const nt = strategy.updateTarget?.(i, view(pos), prep);
          if (nt && nt.price > c.close) {
            pos.target = nt.price;
            pos.targetFraction = clamp01(nt.fraction);
            pos.targetRule = nt.rule;
          }
        }
      }
    } else if (!closedToday && i < candles.length - 1) {
      pendingBuy = strategy.entry(i, prep);
    }

    equity.push({ date: c.date, equity: cash + (pos ? pos.shares * c.close : 0), buyHold: bhCash + bhShares * c.close });
  }

  if (equity.length < 2) return null;
  return { ...summarize(equity, trades, o.initialCash, pos != null), strategyId: strategy.id, trades };
}

// ───────────────────────── 공통 도우미 ─────────────────────────

/** 최근 lookback봉 안에 a가 b를 위로 교차했는지(i까지만 본다) */
function crossedUpWithin(a: Series, b: Series, i: number, lookback: number): boolean {
  for (let k = 0; k < lookback; k++) {
    const t = i - k;
    if (t < 1) return false;
    const a0 = a[t - 1], b0 = b[t - 1], a1 = a[t], b1 = b[t];
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
    if (a0 <= b0 && a1 > b1) return true;
  }
  return false;
}

const prevWeekKey = (date: string) => new Date(Date.parse(weekKeyOf(date)) - 7 * 86_400_000).toISOString().slice(0, 10);

/** 날짜별 시장 국면: 지난주까지 마감된 지수 주봉으로 판정한다(그 주 데이터는 쓰지 않아 미래 참조 없음) */
export function dailyRegimeLookup(index: Candle[]): (date: string) => Regime | null {
  const byWeek = regimeByWeek(toWeekly(index));
  return (date) => byWeek.get(prevWeekKey(date)) ?? null;
}

interface DailyPrep {
  candles: Candle[];
  ind: IndicatorSet;
}

const prepareDaily = (candles: Candle[]): DailyPrep => ({ candles, ind: computeIndicators(candles) });

// ───────────────────────── 1. 와인스타인 주봉 단계 ─────────────────────────

export interface WeinsteinParams {
  /** 지수가 약세 국면이면 신규 진입 금지(지수 데이터가 있을 때만). M1-02 와인스타인 */
  useRegime: boolean;
  /** 돌파 후 첫 풀백(M3-02)도 진입으로 인정 */
  usePullback: boolean;
  /** 스윙 목표가에서 팔 비율. M3-03 "목표 근처에서 일부 매도" — 비율은 책에 없어 50%로 둔다 */
  targetFraction: number;
}

export const WEINSTEIN_DEFAULTS: WeinsteinParams = { useRegime: true, usePullback: true, targetFraction: 0.5 };

export interface WeinsteinPrep {
  candles: Candle[];
  weekly: WeeklyBar[];
  /** 일봉 인덱스 → 주봉 인덱스 */
  weekOf: number[];
  results: (StageResult | null)[];
  regimes?: Map<string, Regime>;
}

export function weinsteinStrategy(partial: Partial<WeinsteinParams> = {}): Strategy<WeinsteinPrep> {
  const P = { ...WEINSTEIN_DEFAULTS, ...partial };
  /** i일이 그 주의 마지막 거래일인지. 다음 봉의 날짜(달력)만 보고 가격은 보지 않는다. 마지막 봉은 금요일 이후면 마감으로 본다 */
  const weekEnd = (p: WeinsteinPrep, i: number) => {
    const next = p.candles[i + 1];
    if (next) return weekKeyOf(next.date) !== weekKeyOf(p.candles[i]!.date);
    return (new Date(Date.parse(p.candles[i]!.date)).getUTCDay() + 6) % 7 >= 4;
  };
  const signal = (p: WeinsteinPrep, i: number): StageResult | null => (weekEnd(p, i) ? p.results[p.weekOf[i]!] ?? null : null);

  return {
    id: "weinstein",
    name: "주봉 단계 돌파",
    source: "와인스타인",
    timeframe: "weekly",
    description: "30주선이 오르는 2단계에서 거래량을 동반한 돌파나 첫 풀백에 사요. 손절은 8주 저점(최대 10%)에서 시작해 매주 끌어올리고, 스윙 목표가에서 절반을 팔아요. 3단계 이탈·4단계면 다 팔아요.",
    rules: ["M1-02 와인스타인", "M3-01 와인스타인", "M3-02 와인스타인", "M3-03 와인스타인", "M3-04 와인스타인", "M4-01 와인스타인"],
    prepare(candles, ctx) {
      const weekly = toWeekly(candles);
      const weekOf: number[] = new Array(candles.length).fill(0);
      weekly.forEach((w, k) => {
        for (let d = w.startIndex; d <= w.endIndex; d++) weekOf[d] = k;
      });
      const idxWeekly = ctx.index?.length ? toWeekly(ctx.index) : undefined;
      const rs = idxWeekly ? relativeStrength(weekly, idxWeekly) : undefined;
      const sctx = prepareStage(weekly);
      // 각 주의 판정은 그 주까지의 데이터만 쓴다(stageAt). 주 마감 봉에서만 꺼내 쓴다
      const results = weekly.map((_, k) => stageAt(sctx, k, rs));
      const regimes = idxWeekly && P.useRegime ? regimeByWeek(idxWeekly) : undefined;
      return { candles, weekly, weekOf, results, regimes };
    },
    startIndex(p) {
      const k = p.results.findIndex((r) => r != null);
      return k < 0 ? Infinity : p.weekly[k]!.endIndex;
    },
    entry(i, p) {
      const r = signal(p, i);
      if (!r) return null;
      const k = p.weekOf[i]!;
      if (p.regimes?.get(p.weekly[k]!.weekKey) === "BEAR") return null; // 지수 약세 국면: 신규 매수 중단
      const buy = BUY_ACTIONS.includes(r.action);
      const pullback = P.usePullback && r.pullbackBuy && r.stage !== 4;
      if (!buy && !pullback) return null;
      const rule = buy ? (r.breakout && r.volumeBasis ? "M3-01 와인스타인" : "4.1 와인스타인") : "M3-02 와인스타인";
      const reason = buy ? `주봉 ${STAGE_LABEL[r.stage]} 매수 신호${r.breakout && r.volumeBasis ? "(거래량 동반 돌파)" : ""}` : "돌파 후 첫 풀백 — 돌파가 위 유지";
      return {
        stop: r.stopLoss, stopRule: "M4-01 와인스타인", target: r.swingTarget ?? undefined, targetFraction: P.targetFraction, targetRule: "M3-03 와인스타인",
        reason, rule,
      };
    },
    exit(i, _pos, p) {
      const r = signal(p, i);
      if (!r || !SELL_ACTIONS.includes(r.action)) return null;
      return r.stage === 4
        ? { fraction: 1, kind: "SIGNAL", reason: "4단계 진입 — 전량 매도", rule: "M3-04 와인스타인" }
        : { fraction: 1, kind: "SIGNAL", reason: "천장권에서 30주선 아래로 이탈 — 매도", rule: "4.1 와인스타인" };
    },
    updateStop(i, _pos, p) {
      return signal(p, i)?.stopLoss ?? null;
    },
    updateTarget(i, _pos, p) {
      const r = signal(p, i);
      return r?.swingTarget != null ? { price: r.swingTarget, fraction: P.targetFraction, rule: "M3-03 와인스타인" } : null;
    },
  };
}

// ───────────────────────── 2. 설춘환 일봉 스윙 ─────────────────────────

export interface SeolSwingParams {
  /** 골든크로스(SMA5↑SMA20)를 인정하는 최근 봉 수 */
  crossLookback: number;
  /** 눌림목: SMA5와 SMA20이 이 비율(%) 안으로 붙어 있을 때(정리자 정의 — 책엔 수치 없음) */
  pullbackNearPct: number;
  /** 20일선 대비 종가 이격 상한(%) — 과열된 정배열 추격 금지 */
  maxExtendPct: number;
  /** 손절폭(%). 설춘환은 성향에 따라 −5% 또는 −10%(5.1) — 기본 7 */
  stopPct: number;
  /** 이익 실현 기준(%)과 비율. 5.3 "+10% 수준에서 50%를 판다" */
  takeProfitPct: number;
  takeProfitFraction: number;
}

export const SEOL_SWING_DEFAULTS: SeolSwingParams = { crossLookback: 3, pullbackNearPct: 2, maxExtendPct: 10, stopPct: 7, takeProfitPct: 10, takeProfitFraction: 0.5 };

export function seolSwingStrategy(partial: Partial<SeolSwingParams> = {}): Strategy<DailyPrep> {
  const P = { ...SEOL_SWING_DEFAULTS, ...partial };
  return {
    id: "seol-swing",
    name: "일봉 이평선 스윙",
    source: "설춘환",
    timeframe: "daily",
    description: `20일선이 60일선 위인 종목에서 5·20일선 골든크로스나 눌림목에 사요. 손절 −${P.stopPct}%, +${P.takeProfitPct}%에서 절반을 팔고 남은 건 5일선을 깨면 팔아요. 20일선을 깨면 다 팔아요.`,
    rules: ["M3-05 설춘환", "M3-06 설춘환", "M3-08 설춘환", "5.3 설춘환"],
    prepare: (candles) => prepareDaily(candles),
    startIndex: () => 60,
    entry(i, { candles, ind }) {
      const s5 = ind.sma5[i], s20 = ind.sma20[i], s60 = ind.sma60[i], s5p = ind.sma5[i - 1];
      const c = candles[i]!, prev = candles[i - 1];
      if (s5 == null || s20 == null || s60 == null || s5p == null || !prev) return null;
      const golden = crossedUpWithin(ind.sma5, ind.sma20, i, P.crossLookback);
      const near = Math.abs(s5 / s20 - 1) * 100 <= P.pullbackNearPct;
      const pullback = near && c.volume > prev.volume && c.close > prev.close && s5 > s5p;
      if (!golden && !pullback) return null;
      if (!(s20 > s60) || !(c.close > s5) || c.close / s20 > 1 + P.maxExtendPct / 100) return null;
      return {
        stop: c.close * (1 - P.stopPct / 100), stopPct: P.stopPct, stopRule: "5.1 설춘환",
        target: c.close * (1 + P.takeProfitPct / 100), targetPct: P.takeProfitPct, targetFraction: P.takeProfitFraction, targetRule: "5.3 설춘환",
        reason: golden ? "5일선이 20일선을 상향 돌파(골든크로스), 20일선 > 60일선" : "5·20일선이 붙은 자리에서 거래량 증가 + 상승(눌림목)",
        rule: golden ? "M3-05 설춘환" : "M3-08 설춘환",
      };
    },
    exit(i, pos, { candles, ind }) {
      const c = candles[i]!, s5 = ind.sma5[i], s20 = ind.sma20[i];
      if (s20 != null && c.close < s20) return { fraction: 1, kind: "SIGNAL", reason: "종가가 20일선 아래 — 전량 매도", rule: "M3-06 설춘환" };
      if (pos.targetHit && s5 != null && c.close < s5) return { fraction: 1, kind: "SIGNAL", reason: "분할 매도 후 5일선 이탈 — 남은 수량 매도", rule: "M3-06 설춘환" };
      return null;
    },
  };
}

// ───────────────────────── 3. RSI 30 회복 ─────────────────────────

export interface RsiRecoveryParams {
  oversold: number;
  overbought: number;
  /** 손절폭(%). 박용선(오닐) 7~8%(5.1) */
  stopPct: number;
  /** 이 봉 수가 지나면 종가에 시간 청산(정리자 정의) */
  maxHoldBars: number;
}

export const RSI_RECOVERY_DEFAULTS: RsiRecoveryParams = { oversold: 30, overbought: 70, stopPct: 8, maxHoldBars: 20 };

export function rsiRecoveryStrategy(partial: Partial<RsiRecoveryParams> = {}): Strategy<DailyPrep> {
  const P = { ...RSI_RECOVERY_DEFAULTS, ...partial };
  return {
    id: "rsi-recovery",
    name: "RSI 30 회복",
    source: "강영현·강동진",
    timeframe: "daily",
    description: `RSI가 ${P.oversold} 아래에 있다가 위로 올라서고 종가가 5일선 위면 사요. 손절 −${P.stopPct}%, RSI ${P.overbought} 이상이면 팔고, ${P.maxHoldBars}봉이 지나면 정리해요.`,
    rules: ["M3-14 강영현·강동진", "4.6 강동진", "5.1 박용선"],
    prepare: (candles) => prepareDaily(candles),
    startIndex: () => 15,
    entry(i, { candles, ind }) {
      const r = ind.rsi14[i], rp = ind.rsi14[i - 1], s5 = ind.sma5[i];
      const c = candles[i]!;
      if (r == null || rp == null || s5 == null) return null;
      if (!(rp <= P.oversold && r > P.oversold && c.close > s5)) return null;
      return {
        stop: c.close * (1 - P.stopPct / 100), stopPct: P.stopPct, stopRule: "5.1 박용선",
        reason: `RSI ${rp.toFixed(0)} → ${r.toFixed(0)}: 과매도에서 회복, 종가가 5일선 위`, rule: "M3-14 강영현·강동진",
      };
    },
    exit(i, pos, { ind }) {
      const r = ind.rsi14[i];
      if (r != null && r >= P.overbought) return { fraction: 1, kind: "SIGNAL", reason: `RSI ${r.toFixed(0)}: 과매수 — 매도`, rule: "4.6 강동진" };
      if (i - pos.entryIndex >= P.maxHoldBars) return { fraction: 1, kind: "TIME", atClose: true, reason: `${P.maxHoldBars}봉 보유 — 종가에 정리` };
      return null;
    },
  };
}

// ───────────────────────── 4. 박병창 매수 2원칙 ─────────────────────────

export interface BbcPullbackParams {
  /** SMA20 상승 여부를 이 봉 수 전과 비교 */
  slopeBars: number;
  /** 오늘 직전 이 봉 수 동안 거래량이 매일 줄어야 한다 */
  quietBars: number;
  /** 오늘 거래량 > 전일 × 이 배수 */
  volumeJump: number;
  /** '최근 하락폭'을 재는 구간(봉, 종가 기준) */
  dropLookback: number;
  /** 하락폭 중 이 비율을 넘게 반등해야 한다. 4.4 "직전 하락폭의 50%를 넘는 반등이 첫 신호" */
  reboundRatio: number;
  /** 너무 얕은 눌림은 제외(%, 정리자 정의) */
  minDropPct: number;
  /** 손절 = 최근 이 봉 수 최저가 × (1 − stopBufferPct%) */
  stopLookback: number;
  stopBufferPct: number;
  /** 매도 1원칙(M3-10): 거래량 ≥ 직전 20일 평균 × 이 배수인 장대 음봉 */
  sellVolumeMultiple: number;
  /** 장대 음봉: 몸통이 시가의 이 비율(%) 이상(정리자 정의 — 책엔 수치 없음) */
  bigBodyPct: number;
  /** 매도 1원칙 분할 비율. 책은 30~50% */
  partialFraction: number;
  /**
   * '5~20일선 사이' 위치를 어느 봉 종가로 볼지. signal: 신호 봉(오늘) / pullback: 눌림 봉(전날) / either: 둘 중 하나(기본).
   * 오늘 종가만 보면 하락폭 50% 넘는 반등과 겹치기 어려워 신호가 거의 나오지 않는다. 오늘 종가는 어느 경우든 20일선 위여야 한다
   */
  zoneBar: "signal" | "pullback" | "either";
}

export const BBC_PULLBACK_DEFAULTS: BbcPullbackParams = {
  slopeBars: 5, quietBars: 3, volumeJump: 1.5, dropLookback: 5, reboundRatio: 0.5, minDropPct: 3,
  stopLookback: 5, stopBufferPct: 1, sellVolumeMultiple: 2, bigBodyPct: 3, partialFraction: 0.5, zoneBar: "either",
};

export function bbcPullbackStrategy(partial: Partial<BbcPullbackParams> = {}): Strategy<DailyPrep> {
  const P = { ...BBC_PULLBACK_DEFAULTS, ...partial };
  return {
    id: "bbc-pullback",
    name: "거래량 눌림 반등",
    source: "박병창",
    timeframe: "daily",
    description: "20일선이 오르는 종목이 거래량이 줄며 5일선 아래로 눌렸다가, 거래량이 늘며 하락폭의 절반 넘게 되돌리는 양봉이 나오면 사요. 거래량 터진 장대 음봉엔 절반, 20일선을 깨면 다 팔아요.",
    rules: ["4.4 박병창", "M3-09 박병창", "M3-10 박병창"],
    prepare: (candles) => prepareDaily(candles),
    startIndex: () => 25,
    entry(i, { candles, ind }) {
      const c = candles[i]!, prev = candles[i - 1];
      const s5 = ind.sma5[i], s20 = ind.sma20[i], s20old = ind.sma20[i - P.slopeBars];
      if (!prev || s5 == null || s20 == null || s20old == null || i < P.dropLookback + P.quietBars) return null;
      // 5~20일선 사이(상승 추세의 눌림)
      const inZone = (j: number) => {
        const a = ind.sma5[j], b = ind.sma20[j], x = candles[j]!.close;
        return a != null && b != null && x < a && x > b;
      };
      const zone = P.zoneBar === "signal" ? inZone(i) : P.zoneBar === "pullback" ? inZone(i - 1) : inZone(i) || inZone(i - 1);
      if (!zone || !(c.close > s20)) return null;
      if (!(s20 > s20old)) return null;
      for (let j = i - P.quietBars + 1; j <= i - 1; j++) if (!(candles[j]!.volume < candles[j - 1]!.volume)) return null; // 거래량 줄며 조정
      if (!(c.volume > prev.volume * P.volumeJump) || !(c.close > c.open)) return null; // 거래량 늘며 양봉
      // 최근 하락폭(종가 기준): 직전 구간 최고 종가 H → 그 뒤 최저 종가 L
      let hIdx = i - P.dropLookback;
      for (let j = hIdx; j <= i - 1; j++) if (candles[j]!.close >= candles[hIdx]!.close) hIdx = j;
      const H = candles[hIdx]!.close;
      let L = Infinity;
      for (let j = hIdx + 1; j <= i - 1; j++) L = Math.min(L, candles[j]!.close);
      if (!Number.isFinite(L) || (H - L) / H * 100 < P.minDropPct) return null;
      const recovered = (c.close - L) / (H - L);
      if (!(recovered > P.reboundRatio)) return null;
      const lows = candles.slice(i - P.stopLookback + 1, i + 1).map((x) => x.low);
      const stop = Math.min(...lows) * (1 - P.stopBufferPct / 100);
      return { stop, stopRule: "4.4 박병창", reason: `거래량 ${(c.volume / prev.volume).toFixed(1)}배 양봉이 최근 하락폭의 ${(recovered * 100).toFixed(0)}% 회복(매수 2원칙)`, rule: "M3-09 박병창" };
    },
    exit(i, _pos, { candles, ind }) {
      const c = candles[i]!, s5 = ind.sma5[i], s20 = ind.sma20[i];
      if (s20 != null && c.close < s20) return { fraction: 1, kind: "SIGNAL", reason: "20일선 붕괴 — 남은 수량 정리(매도 2원칙)", rule: "4.4 박병창" };
      if (i < 20 || s5 == null) return null;
      const avgVol = candles.slice(i - 20, i).reduce((a, x) => a + x.volume, 0) / 20;
      const body = ((c.open - c.close) / c.open) * 100;
      if (c.close > s5 && avgVol > 0 && c.volume >= avgVol * P.sellVolumeMultiple && body >= P.bigBodyPct)
        return { fraction: P.partialFraction, kind: "PARTIAL", reason: `5일선 위에서 거래량 ${(c.volume / avgVol).toFixed(1)}배 장대 음봉 — 분할 매도(매도 1원칙)`, rule: "M3-10 박병창" };
      return null;
    },
  };
}

// ───────────────────────── 5. 단타 돌파 ─────────────────────────

export interface DayTradeStrategyPrep {
  candles: Candle[];
  ref: StockRef;
  params: DayTradeParams;
  regimeOn: (date: string) => Regime | null;
}

/**
 * 기존 단타 점수(scoreDayTrade)를 규칙 그대로 쓴다. 후보의 손절·목표 비율을 실제 진입가(다음 날 시가)에 적용하고,
 * 최대 보유일이 지나면 종가에 판다. dayEval.replayDayTrade와 같은 규칙(갭 상승 추격 금지 포함)이다.
 * 차이: 재현은 floorScore(기본 40)로 신호를 더 모으지만 이 전략은 params.minScore(기본 55)를 그대로 쓰고,
 * 끝까지 청산되지 않은 거래도 평가액으로 남긴다.
 */
export function dayTradeBreakoutStrategy(params: Partial<DayTradeParams> = {}, maxGapPct = DEFAULT_REPLAY.maxGapPct): Strategy<DayTradeStrategyPrep> {
  return {
    id: "daytrade-breakout",
    name: "단타 거래량 돌파",
    source: "앱 단타 규칙(강창권 등 참고)",
    timeframe: "daily",
    description: "거래량이 터지며 20일 고점을 넘는 날 종가로 고르고 다음 날 시가에 사요. ATR 기준 손절과 손익비 목표를 두고, 최대 보유일이 지나면 종가에 정리해요.",
    rules: ["4.7 강창권"],
    prepare(candles, ctx) {
      const ref = ctx.ref ?? { code: "", name: "", market: "KOSPI" as const };
      const base = DAYTRADE_BY_REGION[regionOf(ref.market)];
      return { candles, ref, params: { ...base, ...params }, regimeOn: ctx.index?.length ? dailyRegimeLookup(ctx.index) : () => null };
    },
    startIndex: () => 40,
    entry(i, p) {
      const r = scoreDayTrade(p.ref, p.candles.slice(0, i + 1), p.regimeOn(p.candles[i]!.date), p.params);
      if (!r.ok) return null;
      const c = r.candidate;
      return {
        stop: c.stop, target: c.target, stopPct: c.stopPct, targetPct: c.targetPct, maxEntryPrice: c.price * (1 + maxGapPct / 100),
        reason: `단타 후보 ${c.score}점(거래량 ${c.volumeRatio.toFixed(1)}배, ${c.changePct.toFixed(1)}% 상승)`, rule: "4.7 강창권",
      };
    },
    exit(i, pos, p) {
      if (i - pos.entryIndex >= p.params.maxHoldDays) return { fraction: 1, kind: "TIME", atClose: true, reason: `${p.params.maxHoldDays}일 보유 — 종가 청산` };
      return null;
    },
  };
}

// ───────────────────────── 목록과 비교 ─────────────────────────

export const STRATEGIES: Strategy[] = [
  weinsteinStrategy(),
  seolSwingStrategy(),
  rsiRecoveryStrategy(),
  bbcPullbackStrategy(),
  dayTradeBreakoutStrategy(),
];

export function getStrategy(id: string): Strategy | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

export interface StrategyComparison {
  id: string;
  name: string;
  source: string;
  timeframe: "daily" | "weekly";
  /** 데이터가 모자라 돌릴 수 없으면 null */
  result: StrategyBacktest | null;
}

/**
 * 같은 데이터·같은 구간으로 전략들을 비교한다. 지표가 늦게 계산되는 전략(주봉 등)에 맞춰 시작 봉을 통일해
 * 단순 보유 수익률도 모두 같다. 데이터가 모자라 돌릴 수 없는 전략은 시작 봉 계산에서 빼고 result를 null로 둔다.
 */
export function compareStrategies(candles: Candle[], ctx: StrategyContext = {}, ids?: string[], opts: Partial<RunOptions> = {}): StrategyComparison[] {
  const list = ids?.length ? ids.map(getStrategy).filter((s): s is Strategy => s != null) : STRATEGIES;
  const o = { ...DEFAULT_RUN, ...opts };
  const preps = list.map((s) => s.prepare(candles, ctx));
  const starts = list.map((s, j) => s.startIndex(preps[j]));
  const common = Math.max(o.startIndex, ...starts.filter((x) => x < candles.length - 1));
  return list.map((s, j) => ({
    id: s.id, name: s.name, source: s.source, timeframe: s.timeframe,
    result: candles.length < 2 ? null : runPrepared(s, candles, preps[j], { ...o, startIndex: common }),
  }));
}
