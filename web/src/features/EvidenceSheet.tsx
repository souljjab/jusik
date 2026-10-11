import { useEffect, useState } from "react";
import { getStrategy, runStrategy, signalStats, type Evidence, type Note, type SignalStats } from "@jusik/shared";
import { CANDLE_COUNT, getCandles } from "../api";
import { navigate } from "../app/router";
import { Button, EvidenceList, EvidenceStripFull, Sheet, Skeleton, Stat, Stats } from "../ui";

/** 근거 전략 → 과거 성과를 낼 백테스트 전략 */
const STRATEGY_OF: Record<Evidence["strategy"], string> = { daytrade: "daytrade-breakout", weinstein: "weinstein", "candle-master": "candle-master" };

type StatsResult = { stats: SignalStats | null; period: string | null };
const statsCache = new Map<string, Promise<StatsResult>>();

/**
 * 같은 신호의 과거 성과(UI 지도서 5.2 F): 이 종목 일봉으로 같은 전략을 돌린 신호 횟수·승률·손익비.
 * 종목 하나의 과거라 표본이 작을 수 있다(화면에 기간과 함께 쓴다).
 */
export function useSignalStats(code: string | null | undefined, strategy: Evidence["strategy"]): StatsResult & { loading: boolean } {
  const [st, setSt] = useState<StatsResult & { loading: boolean }>({ stats: null, period: null, loading: !!code });
  useEffect(() => {
    if (!code) return setSt({ stats: null, period: null, loading: false });
    let alive = true;
    setSt((s) => ({ ...s, loading: true }));
    const key = `${code}|${strategy}`;
    let p = statsCache.get(key);
    if (!p) {
      p = getCandles(code, CANDLE_COUNT).then((candles): StatsResult => {
        const s = getStrategy(STRATEGY_OF[strategy]);
        if (!s || candles.length < 2) return { stats: null, period: null };
        const ym = (d: string) => d.slice(0, 7).replace("-", ".");
        return { stats: signalStats(runStrategy(s, candles)), period: `${ym(candles[0]!.date)}~${ym(candles.at(-1)!.date)}` };
      });
      p.catch(() => statsCache.delete(key));
      statsCache.set(key, p);
    }
    p.then((r) => alive && setSt({ ...r, loading: false })).catch(() => alive && setSt({ stats: null, period: null, loading: false }));
    return () => {
      alive = false;
    };
  }, [code, strategy]);
  return st;
}

/** 같은 신호의 과거 성과 세 숫자 */
export function SignalStatsView({ code, strategy }: { code: string | null | undefined; strategy: Evidence["strategy"] }) {
  const { stats, loading, period } = useSignalStats(code, strategy);
  return (
    <div className="stack">
      <div className="row between">
        <h3 className="t-body t-bold">같은 신호의 과거 성과</h3>
        {period && <span className="t-cap">{period}, 이 종목 일봉 · 수수료·세금 반영</span>}
      </div>
      {loading ? (
        <Stats n={3}>
          <Skeleton h={28} />
          <Skeleton h={28} />
          <Skeleton h={28} />
        </Stats>
      ) : !stats || stats.count === 0 ? (
        <p className="t-2">이 종목에서는 같은 신호로 청산까지 간 거래가 아직 없어요.</p>
      ) : (
        <Stats n={3}>
          <Stat value={`${stats.count}회`} label="신호" />
          <Stat value={stats.winRatePct == null ? "-" : `${Math.round(stats.winRatePct)}%`} label="승률" />
          <Stat value={stats.payoff == null ? "-" : stats.payoff.toFixed(1)} label="손익비" />
        </Stats>
      )}
    </div>
  );
}

export interface EvidenceRequest {
  /** 시트 제목(예: "한빛반도체 근거") */
  title: string;
  evidence: Evidence;
  code?: string;
  /** 함께 보여 줄 근거 문장(분석 노트 등) */
  notes?: Note[];
}

/** 근거 보기 시트: 규칙 이름·충족 여부·실제 값·출처, 같은 신호의 과거 성과 */
export function EvidenceSheet({ req, onClose }: { req: EvidenceRequest | null; onClose: () => void }) {
  return (
    <Sheet
      open={!!req}
      onClose={onClose}
      title={req?.title ?? "근거"}
      footer={
        req?.code ? (
          <Button variant="secondary" block onClick={() => (onClose(), navigate(`/stocks/${req.code}`))}>
            종목 분석 열기
          </Button>
        ) : undefined
      }
    >
      {req && (
        <div className="stack-4">
          <div className="stack" style={{ gap: 2 }}>
            <span className="t-2">{req.evidence.strategyName}</span>
            <span className="t-section">{req.evidence.headline}</span>
          </div>
          <EvidenceStripFull evidence={req.evidence} />
          <EvidenceList cells={req.evidence.cells} />
          {req.notes && req.notes.length > 0 && (
            <ul className="ui-ev-list">
              {req.notes.map((n, i) => (
                <li key={i} style={{ gridTemplateColumns: "1fr" }}>
                  <span className={n.tone === "bad" || n.tone === "warn" ? "warn-text" : ""}>{n.text}</span>
                  {n.rule && <span className="t-cap">{n.rule}</span>}
                </li>
              ))}
            </ul>
          )}
          {req.code && <SignalStatsView code={req.code} strategy={req.evidence.strategy} />}
        </div>
      )}
    </Sheet>
  );
}
