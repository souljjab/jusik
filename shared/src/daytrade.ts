import { atr, rsi, sma } from "./indicators";
import { positionSize } from "./risk";
import type { Regime } from "./regime";
import type { Candle, Market, Note, Region } from "./types";

export interface DayTradeParams {
  /** 후보로 인정하는 최소 점수(0~100) */
  minScore: number;
  /** 당일 최소 거래대금(원) */
  minTradeValue: number;
  minPrice: number;
  /** 당일 등락률 범위(%). 상한가 근처 추격은 제외 */
  minChangePct: number;
  maxChangePct: number;
  maxRsi: number;
  /** 20일선에서 이만큼 이상 벌어지면 과열로 제외(%) */
  maxExtendPct: number;
  maxHoldDays: number;
  /** 목표가 = 진입가 + targetR × 손절폭 */
  targetR: number;
  /** 왕복 거래비용(%) — 손익비 계산에 쓴다 */
  roundTripCostPct: number;
  /** 가격 소수점 자리수(원화 0, 달러 2) */
  decimals: number;
}

export const DEFAULT_DAYTRADE: DayTradeParams = {
  minScore: 55,
  minTradeValue: 1_000_000_000,
  minPrice: 1000,
  minChangePct: 2,
  maxChangePct: 20,
  maxRsi: 80,
  maxExtendPct: 25,
  maxHoldDays: 3,
  targetR: 2,
  roundTripCostPct: 0.015 * 2 + 0.18,
  decimals: 0,
};

/**
 * 지역별 기본값. 한국: 수수료 0.015%×2 + 매도 거래세 0.18%. 미국: 증권사 수수료를 0.25%×2로 가정(증권사마다 다름),
 * 최소 거래대금 500만 달러, 최소 주가 2달러(동전주 제외).
 */
export const DAYTRADE_BY_REGION: Record<Region, DayTradeParams> = {
  KR: { ...DEFAULT_DAYTRADE },
  US: { ...DEFAULT_DAYTRADE, minPrice: 2, minTradeValue: 5_000_000, roundTripCostPct: 0.5 + 0.003, decimals: 2 },
};


export interface StockRef {
  code: string;
  name: string;
  market: Market;
}

export interface DayTradeCandidate extends StockRef {
  /** 마지막 일봉 날짜 */
  asOf: string;
  price: number;
  changePct: number;
  volume: number;
  tradeValue: number;
  /** 당일 거래량 / 직전 20일 평균 */
  volumeRatio: number;
  score: number;
  entry: number;
  stop: number;
  target: number;
  stopPct: number;
  targetPct: number;
  /** 거래비용을 뺀 손익비 */
  netRR: number;
  maxHoldDays: number;
  notes: Note[];
}

export type DayTradeResult = { ok: true; candidate: DayTradeCandidate } | { ok: false; reason: string };

/**
 * 일봉 기반 단타 후보 점수. 마지막 봉이 당일(진행 중일 수 있음)이라고 가정한다.
 * 거래량 급증 + 20일 고점 돌파 + 단기 정배열 + 강한 종가 위치를 보고, 과열·유동성 부족·상한가 추격은 거른다.
 * 경험칙에 기반한 규칙이며 수익이 검증된 것이 아니다(백테스트/모의매매로 확인 필요).
 */
export function scoreDayTrade(ref: StockRef, candles: Candle[], regime: Regime | null, partial: Partial<DayTradeParams> = {}): DayTradeResult {
  const P = { ...DEFAULT_DAYTRADE, ...partial };
  const rp = (x: number) => Number(x.toFixed(P.decimals));
  const n = candles.length;
  if (n < 40) return { ok: false, reason: "데이터 부족" };
  const c = candles[n - 1]!;
  const prev = candles[n - 2]!;
  const changePct = (c.close / prev.close - 1) * 100;
  const tradeValue = c.close * c.volume;

  if (c.close < P.minPrice) return { ok: false, reason: "저가주" };
  if (tradeValue < P.minTradeValue) return { ok: false, reason: "거래대금 부족" };
  if (changePct < P.minChangePct) return { ok: false, reason: "상승폭 부족" };
  if (changePct > P.maxChangePct) return { ok: false, reason: "상한가 근처 추격 위험" };

  const closes = candles.map((x) => x.close);
  const s5 = sma(closes, 5)[n - 1]!;
  const s20 = sma(closes, 20)[n - 1]!;
  const s60 = n >= 60 ? sma(closes, 60)[n - 1] : null;
  const r = rsi(closes, 14)[n - 1];
  const a = atr(candles, 14)[n - 1];
  if (a == null || r == null) return { ok: false, reason: "지표 계산 불가" };
  if (r > P.maxRsi) return { ok: false, reason: "RSI 과열" };
  const extendPct = (c.close / s20 - 1) * 100;
  if (extendPct > P.maxExtendPct) return { ok: false, reason: "20일선 이격 과열" };

  const window = candles.slice(n - 21, n - 1);
  const avgVol = window.reduce((acc, x) => acc + x.volume, 0) / window.length;
  const prevHigh = Math.max(...window.map((x) => x.high));
  const volumeRatio = avgVol > 0 ? c.volume / avgVol : 0;
  if (volumeRatio < 1.2) return { ok: false, reason: "거래량 증가 없음" };

  const notes: Note[] = [];
  let score = 0;
  const add = (pts: number, tone: Note["tone"], text: string) => {
    score += pts;
    notes.push({ tone, text });
  };

  if (volumeRatio >= 5) add(25, "good", `거래량 20일 평균의 ${volumeRatio.toFixed(1)}배(폭증)`);
  else if (volumeRatio >= 3) add(20, "good", `거래량 20일 평균의 ${volumeRatio.toFixed(1)}배`);
  else if (volumeRatio >= 2) add(15, "good", `거래량 20일 평균의 ${volumeRatio.toFixed(1)}배`);
  else if (volumeRatio >= 1.5) add(8, "info", `거래량 20일 평균의 ${volumeRatio.toFixed(1)}배`);
  else add(2, "info", `거래량 20일 평균의 ${volumeRatio.toFixed(1)}배(약한 증가)`);

  if (c.close > prevHigh) add(20, "good", "직전 20일 고점 돌파");
  else if (c.close > prevHigh * 0.97) add(8, "info", "직전 20일 고점 3% 이내(돌파 직전)");

  let trend = 0;
  if (s5 > s20) trend += 10;
  if (c.close > s20) trend += 5;
  if (s60 != null && s20 > s60) trend += 5;
  if (trend > 0) add(trend, trend >= 15 ? "good" : "info", trend >= 15 ? "단기 정배열(5>20, 종가>20일선)" : "추세 일부 충족");
  else notes.push({ tone: "warn", text: "단기 추세 약함" });

  const range = c.high - c.low;
  const pos = range > 0 ? (c.close - c.low) / range : 0.5;
  if (c.close > c.open && pos >= 0.8) add(15, "good", "고가 부근 마감(매수세 유지)");
  else if (c.close > c.open && pos >= 0.6) add(8, "info", "양봉, 종가가 범위 상단");
  else if (pos < 0.4) add(-10, "warn", "윗꼬리가 긺(차익 매물 출회)");

  if (changePct >= 3 && changePct <= 10) add(10, "good", `당일 ${changePct.toFixed(1)}% 상승(적정 탄력)`);
  else if (changePct > 10) add(5, "warn", `당일 ${changePct.toFixed(1)}% 급등(추격 주의)`);
  else add(5, "info", `당일 ${changePct.toFixed(1)}% 상승`);

  if (r >= 70) add(-8, "warn", `RSI ${r.toFixed(0)}: 단기 과열 구간`);
  if (regime === "BEAR") add(-15, "bad", "시장 국면 약세 — 단타도 성공률이 떨어지는 구간");
  else if (regime === "BULL") add(5, "good", "시장 국면 강세");

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (score < P.minScore) return { ok: false, reason: `점수 미달(${score})` };

  // 손절폭: 1.5×ATR을 2~5% 안으로 제한. 목표는 손익비 targetR
  const entry = c.close;
  const dist = Math.min(Math.max(1.5 * a, entry * 0.02), entry * 0.05);
  const stop = rp(entry - dist);
  const target = rp(entry + dist * P.targetR);
  const stopPct = ((entry - stop) / entry) * 100;
  const targetPct = ((target - entry) / entry) * 100;
  const netRR = (targetPct - P.roundTripCostPct) / (stopPct + P.roundTripCostPct);

  return {
    ok: true,
    candidate: {
      ...ref, asOf: c.date, price: c.close, changePct, volume: c.volume, tradeValue, volumeRatio, score,
      entry, stop, target, stopPct, targetPct, netRR, maxHoldDays: P.maxHoldDays, notes,
    },
  };
}

export interface PlanParams {
  /** 지금 쓸 수 있는 예수금(원) */
  cash: number;
  /** 1회 손절 시 잃어도 되는 예수금 비율(%) */
  riskPct: number;
  maxWeightPct: number;
  maxPositions: number;
  /** 항상 남겨 둘 현금 비율(%) */
  reservePct: number;
  feeRate?: number;
  /** 이미 보유 중이라 제외할 종목 */
  heldCodes?: string[];
  /** 이미 보유한 종목 수(최대 종목 수에서 차감) */
  heldCount?: number;
}

export interface PlanItem {
  candidate: DayTradeCandidate;
  qty: number;
  amount: number;
  /** 손절가까지 갔을 때 예상 손실(수수료·세금 제외) */
  riskAmount: number;
  weightPct: number;
}

export interface SkippedItem {
  candidate: DayTradeCandidate;
  reason: string;
}

export interface Plan {
  items: PlanItem[];
  skipped: SkippedItem[];
  spendable: number;
  used: number;
  remainingCash: number;
}

/** 점수 순으로 예수금 안에서 살 수 있는 조합을 만든다. 손절폭 기준 수량 + 비중 상한 + 예비 현금 + 최대 종목 수를 지킨다. */
export function planWithCash(candidates: DayTradeCandidate[], p: PlanParams): Plan {
  const spendable = Math.max(0, p.cash * (1 - p.reservePct / 100));
  const slots = Math.max(0, p.maxPositions - (p.heldCount ?? 0));
  const held = new Set(p.heldCodes ?? []);
  const items: PlanItem[] = [];
  const skipped: SkippedItem[] = [];
  let used = 0;

  for (const cand of [...candidates].sort((a, b) => b.score - a.score)) {
    if (held.has(cand.code)) {
      skipped.push({ candidate: cand, reason: "이미 보유 중" });
      continue;
    }
    if (items.length >= slots) {
      skipped.push({ candidate: cand, reason: `최대 보유 종목 수(${p.maxPositions}) 도달` });
      continue;
    }
    const size = positionSize({ capital: p.cash, entry: cand.entry, stop: cand.stop, riskPct: p.riskPct, maxWeightPct: p.maxWeightPct, feeRate: p.feeRate });
    if (!size || size.shares < 1) {
      skipped.push({ candidate: cand, reason: "손절폭·비중 한도로는 1주도 살 수 없음" });
      continue;
    }
    const room = spendable - used;
    const byCash = Math.floor(room / (cand.entry * (1 + (p.feeRate ?? 0.00015))));
    const qty = Math.min(size.shares, byCash);
    if (qty < 1) {
      skipped.push({ candidate: cand, reason: "남은 예수금 부족" });
      continue;
    }
    const amount = qty * cand.entry;
    used += amount;
    items.push({ candidate: cand, qty, amount, riskAmount: qty * (cand.entry - cand.stop), weightPct: p.cash > 0 ? (amount / p.cash) * 100 : 0 });
  }
  return { items, skipped, spendable, used, remainingCash: p.cash - used };
}
