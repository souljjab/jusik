import { useEffect, useMemo, useState } from "react";
import {
  candleMasterEvidence, dayTradeEvidence, regionOf, weekKeyOf, weinsteinEvidence,
  type DayTradeCandidate, type Evidence, type Note, type Posture,
} from "@jusik/shared";
import type { StockData } from "../../api";
import { fmtDate } from "../../ui";
import {
  analysisAt, candleMarks, candlePlan, dailyMarks, dayTradePlan, postureAt, stagesByWeek, weinsteinMarks, weinsteinPlan,
  type OrderPlan, type SignalMark,
} from "./stocksModel";

/*
 * 종목의 신호 기록(차트 표식)과 지금 고른 신호. 고른 신호에 따라 오른쪽 '신호 근거'와 주문 미리 보기의 손절·목표가 바뀐다.
 * 고를 수 있는 것: 지금 분석(와인스타인), 지금 캔들마스터 신호, 오늘의 단타 후보(스캔), 과거 신호(차트 표식).
 */

export const NOW = "now";
export const NOW_CANDLE = "now:candle";
export const NOW_DAYTRADE = "now:daytrade";

export interface SignalView {
  id: string;
  /** 근거 보기·과거 성과에 쓰는 전략 */
  strategy: Evidence["strategy"];
  title: string;
  /** "10.10(금) 마감 주" 같은 시점 */
  when: string;
  evidence: Evidence | null;
  notes: Note[];
  /** 과거 신호(단계·국면 칸을 그 주 기준으로 다시 계산했다) */
  historical: boolean;
  /** 일봉 보조 신호(의견을 바꾸지 않는 참고 신호) */
  daily?: SignalMark["daily"];
  mark?: SignalMark;
}

export interface Signals {
  marks: SignalMark[];
  selected: SignalView;
  selectedId: string;
  select: (id: string) => void;
  /** 지금 고를 수 있는 '지금' 항목(목록 맨 위) */
  current: SignalView[];
  /** 주문 미리 보기에 쓸 손절·목표와 근거 */
  plan: { plan: OrderPlan; evidence: Evidence } | null;
  candidate: DayTradeCandidate | null;
}

const week = (d: string) => `${fmtDate(d)} 마감 주`;

export function useSignals(data: StockData | null, candidate: DayTradeCandidate | null, caps?: Record<Posture, number>): Signals {
  const code = data?.info.code ?? null;
  const a = data?.analysis ?? null;
  const region = data ? regionOf(data.info.market) : "KR";

  const marks = useMemo<SignalMark[]>(() => {
    if (!data) return [];
    const idx = data.indexCandles;
    return [...weinsteinMarks(data.candles, idx), ...candleMarks(data.candles), ...dailyMarks(data.candles, idx, 160)];
  }, [data]);
  const stages = useMemo(() => (data ? stagesByWeek(data.candles, data.indexCandles) : new Map()), [data]);

  const current = useMemo<SignalView[]>(() => {
    const out: SignalView[] = [];
    if (candidate) {
      const ev = dayTradeEvidence(candidate);
      out.push({ id: NOW_DAYTRADE, strategy: "daytrade", title: ev.headline, when: `${fmtDate(candidate.asOf)} 스캔`, evidence: ev, notes: candidate.notes, historical: false });
    }
    if (a) {
      const ev = weinsteinEvidence(a);
      out.push({ id: NOW, strategy: "weinstein", title: ev.headline, when: week(a.timing.weekDate), evidence: ev, notes: [...a.gates, ...a.timing.notes], historical: false });
      const cm = a.candleMaster;
      const cev = candleMasterEvidence(cm);
      if (cm && cev && cm.signals.length) out.push({ id: NOW_CANDLE, strategy: "candle-master", title: cev.headline, when: week(cm.date), evidence: cev, notes: cm.notes, historical: false });
    }
    return out;
  }, [a, candidate]);

  const defaultId = candidate ? NOW_DAYTRADE : NOW;
  const [selectedId, setSelectedId] = useState<string>(defaultId);
  useEffect(() => setSelectedId(defaultId), [code, defaultId]);

  const selected = useMemo<SignalView>(() => {
    const now = current.find((v) => v.id === selectedId);
    if (now) return now;
    const m = marks.find((x) => x.id === selectedId);
    if (m && a) {
      if (m.kind === "weinstein" && m.stage) {
        const posture = postureAt(data?.indexCandles, m.date, caps, region);
        const ev = weinsteinEvidence(analysisAt(a, m.stage, posture));
        return { id: m.id, strategy: "weinstein", title: m.label, when: week(m.date), evidence: { ...ev, headline: m.label }, notes: m.stage.notes, historical: !m.latest, mark: m };
      }
      if (m.kind === "candle" && m.candle) {
        const ev = candleMasterEvidence(m.candle);
        return { id: m.id, strategy: "candle-master", title: m.label, when: week(m.date), evidence: ev, notes: m.candle.notes, historical: !m.latest, mark: m };
      }
      if (m.kind === "daily") {
        const st = stages.get(weekKeyOf(m.date));
        const ev = st ? weinsteinEvidence(analysisAt(a, st, postureAt(data?.indexCandles, m.date, caps, region))) : null;
        return { id: m.id, strategy: "weinstein", title: m.label, when: fmtDate(m.date), evidence: ev, notes: [], historical: !m.latest, daily: m.daily, mark: m };
      }
    }
    return current.find((v) => v.id === NOW) ?? current[0] ?? { id: NOW, strategy: "weinstein", title: "분석 없음", when: "", evidence: null, notes: [], historical: false };
  }, [selectedId, current, marks, a, stages, data, caps, region]);

  const plan = useMemo(() => {
    if (!a) return null;
    if (selected.id === NOW_DAYTRADE && candidate) return { plan: dayTradePlan(candidate), evidence: selected.evidence! };
    if ((selected.id === NOW_CANDLE || (selected.mark?.kind === "candle" && selected.mark.latest)) && a.candleMaster) {
      const p = candlePlan(a.candleMaster);
      const ev = candleMasterEvidence(a.candleMaster);
      if (p && ev) return { plan: p, evidence: ev };
    }
    return { plan: weinsteinPlan(a), evidence: weinsteinEvidence(a) };
  }, [a, selected, candidate]);

  return { marks, selected, selectedId: selected.id, select: setSelectedId, current, plan, candidate };
}
