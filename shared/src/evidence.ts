import type { Analysis } from "./analyze";
import type { CandleMasterResult } from "./candleMaster";
import type { DayTradeCandidate, DayTradeCheckId } from "./daytrade";
import { POSTURE_LABEL } from "./regimeScore";
import type { StrategyBacktest } from "./strategies";

/*
 * 근거 스트립(UI 지도서 1.2): 규칙 하나당 한 칸. 채운 칸 = 충족, 빈칸 = 미충족, 점선 칸 = 데이터 없음.
 * 칸의 순서는 전략마다 고정이라, 같은 전략이면 같은 위치의 칸이 같은 규칙을 뜻한다.
 * 화면은 이 모듈이 만든 칸을 그대로 그린다(칸 이름·설명·규칙 번호를 화면마다 따로 만들지 않는다).
 */

export type EvidenceState = "met" | "unmet" | "na";

export interface EvidenceCell {
  id: string;
  /** 칸 이름(짧게, 예: "거래량 2배") */
  label: string;
  state: EvidenceState;
  /** 근거 보기에 쓰는 한 줄 설명(실제 값 포함) */
  detail: string;
  /** 규칙 번호·출처(기초 자료집 규칙 카탈로그). 앱이 정한 기준이면 없음 */
  rule?: string;
}

export type EvidenceStrategy = "daytrade" | "weinstein" | "candle-master";

export interface Evidence {
  strategy: EvidenceStrategy;
  /** 전략 이름(목록의 '전략' 열) */
  strategyName: string;
  /** 신호를 한마디로(예: "20일 고점 돌파, 거래량 2.3배") */
  headline: string;
  cells: EvidenceCell[];
  met: number;
  total: number;
}

export const EVIDENCE_STRATEGY_NAME: Record<EvidenceStrategy, string> = {
  daytrade: "단타 돌파",
  weinstein: "2단계 돌파",
  "candle-master": "캔들 신호",
};

const fx = (n: number, d = 1) => n.toLocaleString("ko-KR", { maximumFractionDigits: d });
const st = (v: boolean | null | undefined): EvidenceState => (v == null ? "na" : v ? "met" : "unmet");

function build(strategy: EvidenceStrategy, headline: string, cells: EvidenceCell[]): Evidence {
  return { strategy, strategyName: EVIDENCE_STRATEGY_NAME[strategy], headline, cells, met: cells.filter((c) => c.state === "met").length, total: cells.length };
}

// ───────────────────────── 단타 후보 ─────────────────────────

/** 단타 후보 칸 순서(고정) */
export const DAYTRADE_CELLS: { id: DayTradeCheckId; label: string }[] = [
  { id: "volume2x", label: "거래량 2배" },
  { id: "breakout20", label: "20일 고점 돌파" },
  { id: "trend", label: "단기 정배열" },
  { id: "closeHigh", label: "고가 부근 마감" },
  { id: "momentum", label: "적정 상승폭" },
  { id: "regime", label: "시장 국면" },
];

/** checks가 없는 이전 버전 후보: 근거 문장으로 추정한다 */
function checksFromNotes(c: DayTradeCandidate): Record<DayTradeCheckId, boolean | null> {
  const has = (t: string) => c.notes.some((n) => n.text.includes(t));
  return {
    volume2x: c.volumeRatio >= 2,
    breakout20: has("20일 고점 돌파"),
    trend: has("단기 정배열"),
    closeHigh: has("고가 부근 마감"),
    momentum: c.changePct >= 3 && c.changePct <= 10,
    regime: has("시장 국면 강세") ? true : has("시장 국면 약세") ? false : null,
  };
}

/** 단타 후보(scoreDayTrade)의 근거 스트립 */
export function dayTradeEvidence(c: DayTradeCandidate): Evidence {
  const k = c.checks ?? checksFromNotes(c);
  const detail: Record<DayTradeCheckId, string> = {
    volume2x: `거래량이 20일 평균의 ${fx(c.volumeRatio)}배예요(기준 2배)`,
    breakout20: k.breakout20 ? "종가가 직전 20일 고점을 넘었어요" : "직전 20일 고점을 아직 넘지 못했어요",
    trend: k.trend ? "5일선이 20일선 위, 종가가 20일선 위예요" : "단기 이동평균 정배열이 아니에요",
    closeHigh: k.closeHigh ? "양봉이고 종가가 하루 범위의 위쪽 20% 안이에요" : "종가가 하루 고가에서 멀어요(윗꼬리)",
    momentum: `오늘 ${c.changePct >= 0 ? "+" : ""}${fx(c.changePct, 2)}% 올랐어요(기준 3~10%)`,
    regime: k.regime == null ? "시장 국면을 판정하지 못했어요" : k.regime ? "시장이 약세 국면이 아니에요" : "시장이 약세 국면이에요",
  };
  const cells = DAYTRADE_CELLS.map(({ id, label }) => ({
    id, label, state: st(k[id]), detail: detail[id], ...(id === "regime" ? { rule: "M1 시장 국면" } : {}),
  }));
  const parts = [k.breakout20 ? "20일 고점 돌파" : null, `거래량 ${fx(c.volumeRatio)}배`].filter(Boolean);
  return build("daytrade", parts.join(", "), cells);
}

// ───────────────────────── 와인스타인 2단계 ─────────────────────────

export const WEINSTEIN_CELLS = ["ma30Rising", "aboveMa30", "volume2x", "rs", "earnings", "regime"] as const;

/** 종목 분석(analyze)의 와인스타인 근거 스트립 */
export function weinsteinEvidence(a: Analysis): Evidence {
  const t = a.timing;
  const g = a.screening.growthGroup;
  const p = a.posture;
  const cells: EvidenceCell[] = [
    {
      id: "ma30Rising", label: "30주선 상승", state: st(t.slopePct > 0),
      detail: `30주선 최근 4주 기울기 ${t.slopePct >= 0 ? "+" : ""}${fx(t.slopePct, 2)}%`, rule: "4.1 와인스타인",
    },
    {
      id: "aboveMa30", label: "30주선 위", state: st(t.close > t.ma30),
      detail: `종가가 30주선보다 ${fx(Math.abs(t.pctFromMa))}% ${t.pctFromMa >= 0 ? "위" : "아래"}예요`, rule: "4.1 와인스타인",
    },
    {
      id: "volume2x", label: "거래량 2배", state: st(t.volumeRatio == null ? null : t.volumeRatio >= 2),
      detail: t.volumeRatio == null ? "주간 거래량 자료가 모자라요" : `이번 주 거래량이 직전 4주 평균의 ${fx(t.volumeRatio)}배예요(기준 2배)`,
      rule: "M3-01 와인스타인",
    },
    {
      id: "rs", label: "상대강도", state: st(t.rs == null ? null : t.rs > 0),
      detail: t.rs == null ? "지수 자료가 없어 상대강도를 계산하지 못했어요" : `만스필드 상대강도 ${t.rs > 0 ? "+" : ""}${fx(t.rs)}(0선 ${t.rs > 0 ? "위" : "아래"})`,
      rule: "M3-01 와인스타인",
    },
    {
      id: "earnings", label: "실적 성장", state: st(g == null ? null : g === "A"),
      detail: g == null ? "연간 실적 자료가 모자라요" : g === "A" ? "매출·영업이익·순이익이 해마다 늘었어요(A그룹)" : "실적 세 항목 중 줄었거나 그대로인 게 있어요(B그룹)",
      rule: "M2-03 설춘환",
    },
    {
      id: "regime", label: "시장 국면", state: st(p == null ? null : p.posture !== "DEFENSE"),
      detail: p == null ? "지수 자료가 없어 국면을 판정하지 못했어요" : `시장 국면 ${POSTURE_LABEL[p.posture]}, 주식 비중 상한 ${p.exposureCapPct}%`,
      rule: "M1 시장 국면",
    },
  ];
  const headline = t.stage === 2 ? (t.breakout ? "2단계 돌파" : "2단계 상승") : `${t.stage}단계`;
  return build("weinstein", headline, cells);
}

// ───────────────────────── 캔들마스터 ─────────────────────────

/** 캔들마스터 주봉(candleMasterAt)의 근거 스트립. 결과가 없으면 null */
export function candleMasterEvidence(r: CandleMasterResult | null): Evidence | null {
  if (!r) return null;
  const hasSignal = r.signals.length > 0;
  const cells: EvidenceCell[] = [
    { id: "wave", label: "파동 해석 대상", state: st(r.wave.ok), detail: r.wave.ok ? "직전 파동과 간격을 둔 수평 파동이에요" : "파동이 해석 대상이 아니에요", rule: "4.5 캔들마스터" },
    { id: "signal", label: "매수 신호 캔들", state: st(hasSignal), detail: hasSignal ? r.signals.map((s) => s.name).join(" · ") : "이번 주 매수 신호 캔들이 없어요", rule: "4.5 캔들마스터" },
    {
      id: "group", label: "캔들군 교과서형", state: st(r.group ? r.group.compact : null),
      detail: r.group == null ? "캔들군을 판정할 주봉이 모자라요" : r.group.compact ? "캔들군이 모여 있어요" : "캔들군이 흩어져 있어요", rule: "4.5 캔들마스터",
    },
    {
      id: "stopFit", label: "손절폭 20% 이내", state: st(r.stopPct == null ? null : r.waitPrice == null),
      detail: r.stopPct == null ? "신호가 없어 손절가가 없어요" : `진입가 대비 손절폭 −${fx(r.stopPct)}%`, rule: "M4-01 캔들마스터",
    },
    {
      id: "standard", label: "표준형", state: st(hasSignal && r.wave.ok ? r.standard : null),
      detail: !hasSignal || !r.wave.ok ? "유효한 신호가 아니라 판정하지 않아요" : r.standard ? "표준형 — 목표 3배" : "비표준형 — 목표 2배", rule: "M3-13 캔들마스터",
    },
  ];
  const headline = hasSignal ? r.signals[0]!.name : "신호 없음";
  return build("candle-master", headline, cells);
}

// ───────────────────────── 같은 신호의 과거 성과 ─────────────────────────

export interface SignalStats {
  /** 청산한 거래 수(부분 청산 포함) */
  count: number;
  /** 승률(%) */
  winRatePct: number | null;
  /** 손익비 = 평균 이익 ÷ 평균 손실(손실 거래가 없으면 null) */
  payoff: number | null;
  /** 평균 수익률(%) */
  avgReturnPct: number | null;
}

/** 전략 백테스트(runStrategy) 거래에서 신호 횟수·승률·손익비를 낸다 */
export function signalStats(bt: Pick<StrategyBacktest, "trades"> | null): SignalStats {
  const r = (bt?.trades ?? []).map((t) => t.returnPct).filter((x) => Number.isFinite(x));
  if (!r.length) return { count: 0, winRatePct: null, payoff: null, avgReturnPct: null };
  const wins = r.filter((x) => x > 0), losses = r.filter((x) => x <= 0);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgLoss = losses.length ? Math.abs(mean(losses)) : 0;
  return {
    count: r.length,
    winRatePct: (wins.length / r.length) * 100,
    payoff: wins.length && avgLoss > 0 ? mean(wins) / avgLoss : null,
    avgReturnPct: mean(r),
  };
}
