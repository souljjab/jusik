import { DEFAULT_DAYTRADE, scoreDayTrade, type DayTradeParams, type StockRef } from "./daytrade";
import { netOf, type JournalEntry, type TradeFeatures } from "./journal";
import type { Regime } from "./regime";
import type { Candle } from "./types";

/** 점검 대상 거래 한 건(과거 재현이든 모의매매든 같은 형태) */
export interface EvalTrade extends TradeFeatures {
  code: string;
  name: string;
  /** 신호일(재현) 또는 진입일(모의) */
  date: string;
  exitReason: "손절" | "목표 도달" | "시간 청산" | "기타";
  holdDays: number;
  /** 비용 반영 순수익률(%) */
  returnPct: number;
}

export interface ReplayOptions {
  /** 재현에 쓸 최소 점수. 기준값 비교를 위해 실제 기준보다 낮게 잡아 더 많은 신호를 모은다 */
  floorScore: number;
  /** 다음 날 시가가 신호일 종가보다 이만큼(%) 이상 높게 시작하면 추격하지 않는다 */
  maxGapPct: number;
  /** 체결 슬리피지(%) — 진입·청산 각각 불리하게 */
  slippagePct: number;
  /** 날짜별 시장 국면(없으면 null) */
  regimeOn?: (date: string) => Regime | null;
}

export const DEFAULT_REPLAY: ReplayOptions = { floorScore: 40, maxGapPct: 3, slippagePct: 0.1 };

/**
 * 종목 하나의 과거 일봉에 단타 규칙을 그대로 적용해 가상 매매를 재현한다.
 * - i일 종가까지의 데이터로 신호를 계산하고 i+1일 시가에 진입(미래 참조 없음)
 * - 이후 매일 저가가 손절가 이하면 손절(시가가 이미 아래면 시가), 고가가 목표가 이상이면 목표 청산.
 *   같은 날 둘 다 닿으면 손절로 본다(보수적). 최대 보유일이 지나면 그날 종가에 청산.
 * - 한 종목은 한 번에 한 포지션만. 비용은 지역별 왕복 비용 + 슬리피지
 * 실시간 스캔은 장중 가격으로 들어가지만 재현은 다음 날 시가로 들어가므로 결과가 다를 수 있다.
 */
export function replayDayTrade(ref: StockRef, candles: Candle[], params: Partial<DayTradeParams> = {}, opt: Partial<ReplayOptions> = {}): EvalTrade[] {
  const P = { ...DEFAULT_DAYTRADE, ...params };
  const o = { ...DEFAULT_REPLAY, ...opt };
  const trades: EvalTrade[] = [];
  const costPct = P.roundTripCostPct + o.slippagePct * 2;

  for (let i = 40; i < candles.length - 1; i++) {
    const regime = o.regimeOn?.(candles[i]!.date) ?? null;
    const r = scoreDayTrade(ref, candles.slice(0, i + 1), regime, { ...P, minScore: o.floorScore });
    if (!r.ok) continue;
    const c = r.candidate;
    const entryBar = candles[i + 1]!;
    if (entryBar.open > c.price * (1 + o.maxGapPct / 100)) continue; // 갭 상승 추격 안 함
    const entry = entryBar.open;
    const stop = entry * (1 - c.stopPct / 100);
    const target = entry * (1 + c.targetPct / 100);

    let exit = NaN;
    let reason: EvalTrade["exitReason"] = "기타";
    let j = i + 1;
    for (; j < candles.length; j++) {
      const b = candles[j]!;
      // 진입 당일은 시가 이후의 고가·저가만 의미가 있으므로 그대로 사용(시가에 진입했다고 가정)
      if (b.low <= stop) {
        exit = Math.min(b.open, stop);
        reason = "손절";
        break;
      }
      if (b.high >= target) {
        exit = j === i + 1 ? target : Math.max(b.open, target);
        reason = "목표 도달";
        break;
      }
      if (j - (i + 1) >= P.maxHoldDays) {
        exit = b.close;
        reason = "시간 청산";
        break;
      }
    }
    if (Number.isNaN(exit)) break; // 데이터 끝까지 청산되지 않은 거래는 결과를 모르므로 제외
    trades.push({
      code: ref.code, name: ref.name, market: ref.market, date: candles[i]!.date, score: c.score, volumeRatio: c.volumeRatio, changePct: c.changePct,
      stopPct: c.stopPct, regime, exitReason: reason, holdDays: j - (i + 1), returnPct: (exit / entry - 1) * 100 - costPct,
    });
    i = j; // 청산한 날 이후부터 다시 신호를 찾는다
  }
  return trades;
}

/** 매매일지의 자동(모의) 매수·매도를 종목별 선입선출로 짝지어 점검용 거래로 만든다. 특성(meta)이 없는 기록은 제외 */
export function paperTradesFromJournal(entries: JournalEntry[]): EvalTrade[] {
  const auto = entries.filter((e) => e.source === "자동(모의)").sort((a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1));
  const open = new Map<string, JournalEntry[]>();
  const out: EvalTrade[] = [];
  for (const e of auto) {
    const q = open.get(e.code) ?? [];
    open.set(e.code, q);
    if (e.side === "BUY") {
      q.push(e);
      continue;
    }
    const buy = q.shift();
    if (!buy?.meta) continue;
    // 매도 기록의 복기란에 비용 반영 순수익률이 있으면 그것을, 없으면 가격으로 계산
    const net = netOf(e).pct;
    const reason = (["손절", "목표 도달", "시간 청산"] as const).find((r) => e.reason.startsWith(r)) ?? "기타";
    out.push({
      ...buy.meta, code: e.code, name: e.name, date: buy.date, exitReason: reason,
      holdDays: Math.max(0, Math.round((Date.parse(e.date) - Date.parse(buy.date)) / 86_400_000)),
      returnPct: net != null ? net : (e.price / buy.price - 1) * 100,
    });
  }
  return out;
}

export interface Stats {
  n: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** 거래당 평균 순수익률(%) = 기대값 */
  expectancyPct: number | null;
  /** 총이익 / 총손실 */
  profitFactor: number | null;
  /** 기대값의 95% 신뢰구간 하단(대략). 0보다 크면 우연이 아닐 가능성이 높다 */
  lowerBoundPct: number | null;
  /** 표본이 통계적으로 의미 있을 만큼 큰지(30건 이상) */
  reliable: boolean;
}

export const MIN_RELIABLE = 30;
/** 기준을 바꾸자고 제안하려면 뒤 기간 기대값이 현재 기준보다 거래당 이만큼(%p) 이상 나아야 한다(잡음 추종 방지) */
export const MIN_IMPROVEMENT_PCT = 0.25;

export function stats(xs: number[]): Stats {
  const n = xs.length;
  if (!n) return { n, winRate: null, avgWinPct: null, avgLossPct: null, expectancyPct: null, profitFactor: null, lowerBoundPct: null, reliable: false };
  const wins = xs.filter((x) => x > 0), losses = xs.filter((x) => x <= 0);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const gw = wins.reduce((a, b) => a + b, 0), gl = -losses.reduce((a, b) => a + b, 0);
  return {
    n,
    winRate: wins.length / n,
    avgWinPct: wins.length ? gw / wins.length : null,
    avgLossPct: losses.length ? -gl / losses.length : null,
    expectancyPct: mean,
    profitFactor: gl > 0 ? gw / gl : null,
    lowerBoundPct: n > 1 ? mean - 1.96 * (sd / Math.sqrt(n)) : null,
    reliable: n >= MIN_RELIABLE,
  };
}

export interface Bucket {
  label: string;
  stats: Stats;
}

export interface BucketGroup {
  title: string;
  buckets: Bucket[];
}

function group(trades: EvalTrade[], title: string, defs: [string, (t: EvalTrade) => boolean][]): BucketGroup {
  return { title, buckets: defs.map(([label, f]) => ({ label, stats: stats(trades.filter(f).map((t) => t.returnPct)) })).filter((b) => b.stats.n > 0) };
}

export interface ThresholdRow {
  minScore: number;
  all: Stats;
  /** 기간 앞 절반 */
  firstHalf: Stats;
  /** 기간 뒤 절반 */
  secondHalf: Stats;
}

export interface Suggestion {
  /** 제안하는 최소 점수. 근거가 부족하면 null */
  minScore: number | null;
  reason: string;
}

export interface Evaluation {
  overall: Stats;
  groups: BucketGroup[];
  thresholds: ThresholdRow[];
  suggestion: Suggestion;
  from: string | null;
  to: string | null;
}

/**
 * 거래 목록을 조건별로 나눠 승률·기대값을 계산하고, 최소 점수 기준을 제안한다.
 * 과최적화를 피하려고 앞 절반 기간에서 가장 좋은 기준을 고른 뒤 뒤 절반에서도 기대값이 플러스이고
 * 현재 기준보다 나을 때만 제안한다.
 */
export function evaluateTrades(trades: EvalTrade[], currentMinScore: number): Evaluation {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const r = (ts: EvalTrade[]) => ts.map((t) => t.returnPct);
  const groups: BucketGroup[] = [
    group(sorted, "점수", [["40~54", (t) => t.score < 55], ["55~64", (t) => t.score >= 55 && t.score < 65], ["65~74", (t) => t.score >= 65 && t.score < 75], ["75 이상", (t) => t.score >= 75]]),
    group(sorted, "거래량 배수", [["1.2~2배", (t) => t.volumeRatio < 2], ["2~3배", (t) => t.volumeRatio >= 2 && t.volumeRatio < 3], ["3~5배", (t) => t.volumeRatio >= 3 && t.volumeRatio < 5], ["5배 이상", (t) => t.volumeRatio >= 5]]),
    group(sorted, "당일 상승률", [["2~5%", (t) => t.changePct < 5], ["5~10%", (t) => t.changePct >= 5 && t.changePct < 10], ["10% 이상", (t) => t.changePct >= 10]]),
    group(sorted, "시장 국면", [["강세", (t) => t.regime === "BULL"], ["중립", (t) => t.regime === "NEUTRAL"], ["약세", (t) => t.regime === "BEAR"], ["확인 불가", (t) => t.regime == null]]),
    group(sorted, "시장", [["국내", (t) => t.market !== "US"], ["미국", (t) => t.market === "US"]]),
    group(sorted, "청산 사유", [["목표 도달", (t) => t.exitReason === "목표 도달"], ["손절", (t) => t.exitReason === "손절"], ["시간 청산", (t) => t.exitReason === "시간 청산"]]),
  ];

  const half = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, half), second = sorted.slice(half);
  const levels = [40, 45, 50, 55, 60, 65, 70, 75, 80];
  const thresholds: ThresholdRow[] = levels.map((s) => ({
    minScore: s,
    all: stats(r(sorted.filter((t) => t.score >= s))),
    firstHalf: stats(r(first.filter((t) => t.score >= s))),
    secondHalf: stats(r(second.filter((t) => t.score >= s))),
  }));

  return {
    overall: stats(r(sorted)),
    groups,
    thresholds,
    suggestion: suggest(thresholds, currentMinScore),
    from: sorted[0]?.date ?? null,
    to: sorted.at(-1)?.date ?? null,
  };
}

function suggest(rows: ThresholdRow[], current: number): Suggestion {
  // 앞·뒤 기간 각각 통계적으로 볼 만한 표본(30건)이 있어야 비교한다
  const usable = rows.filter((x) => x.firstHalf.n >= MIN_RELIABLE && x.secondHalf.n >= MIN_RELIABLE);
  if (!usable.length) return { minScore: null, reason: `기간을 둘로 나눴을 때 각각 ${MIN_RELIABLE}건 이상인 기준이 없어 제안하지 않아요. 거래가 더 쌓여야 해요.` };
  const best = usable.reduce((a, b) => ((b.firstHalf.expectancyPct ?? -Infinity) > (a.firstHalf.expectancyPct ?? -Infinity) ? b : a));
  const cur = rows.find((x) => x.minScore === current) ?? rows.reduce((a, b) => (Math.abs(b.minScore - current) < Math.abs(a.minScore - current) ? b : a));
  const oos = best.secondHalf.expectancyPct ?? -Infinity;
  const curOos = cur.secondHalf.expectancyPct ?? -Infinity;
  if (oos <= 0)
    return { minScore: null, reason: `앞 기간에서 가장 좋았던 기준(${best.minScore}점)도 뒤 기간에서 기대값이 ${fmt(oos)}로 손실이에요. 점수 기준만 바꿔서는 해결되지 않아요 — 규칙 자체를 손보거나 매매를 쉬는 게 맞아요.` };
  if (best.minScore === cur.minScore) return { minScore: null, reason: `현재 기준(${cur.minScore}점)이 앞 기간에서 가장 좋았고 뒤 기간에서도 기대값 ${fmt(oos)}로 유지돼요. 바꿀 필요가 없어요.` };
  if (oos <= curOos) return { minScore: null, reason: `앞 기간에서는 ${best.minScore}점이 좋았지만 뒤 기간에서는 현재 기준(${cur.minScore}점, ${fmt(curOos)})보다 낫지 않아요(${fmt(oos)}). 우연일 가능성이 커서 바꾸지 않는 걸 권해요.` };
  if (oos - curOos < MIN_IMPROVEMENT_PCT)
    return { minScore: null, reason: `${best.minScore}점 기준이 뒤 기간에서 조금 나았지만(${fmt(oos)} vs 현재 ${fmt(curOos)}) 차이가 거래당 ${MIN_IMPROVEMENT_PCT}%p 미만이라 바꿀 만한 근거가 아니에요.` };
  const lb = best.secondHalf.lowerBoundPct ?? -Infinity;
  if (lb <= 0) return { minScore: null, reason: `${best.minScore}점 기준이 뒤 기간에서도 나았지만(${fmt(oos)}) 기대값의 95% 하한이 ${fmt(lb)}로 0 아래라 우연과 구별되지 않아요. 거래가 더 쌓이면 다시 확인하세요.` };
  return { minScore: best.minScore, reason: `앞 기간에서 고른 ${best.minScore}점 기준이 뒤 기간에서도 기대값 ${fmt(oos)}(현재 ${cur.minScore}점: ${fmt(curOos)})로 더 나았어요. 표본은 뒤 기간 ${best.secondHalf.n}건이에요.` };
}

const fmt = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(2)}%` : "-");
