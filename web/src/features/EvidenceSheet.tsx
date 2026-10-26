import { useEffect, useState } from "react";
import { regionOf, signalStats, type Evidence, type Note, type SignalStats } from "@jusik/shared";
import { loadStock } from "../api";
import { navigate } from "../app/router";
import { defaultParams, runSelected } from "./strategyRun";
import { Button, EvidenceList, EvidenceStripFull, NoteList, Sheet, Skeleton, Stat, Stats } from "../ui";

/** 근거 전략 → 과거 성과를 낼 백테스트 전략 */
const STRATEGY_OF: Record<Evidence["strategy"], string> = { daytrade: "daytrade-breakout", weinstein: "weinstein", "candle-master": "candle-master" };

type StatsResult = { stats: SignalStats | null; period: string | null };
/** 종목·전략별 결과. 오래 쓰면 계속 늘지 않게 최근 것만 남긴다 */
const statsCache = new Map<string, Promise<StatsResult>>();
const STATS_CACHE_MAX = 30;

function cachedStats(key: string, load: () => Promise<StatsResult>): Promise<StatsResult> {
  const hit = statsCache.get(key);
  if (hit) {
    // 최근에 쓴 것을 뒤로(가장 오래 안 쓴 것부터 지운다)
    statsCache.delete(key);
    statsCache.set(key, hit);
    return hit;
  }
  const p = load();
  p.catch(() => statsCache.delete(key));
  statsCache.set(key, p);
  while (statsCache.size > STATS_CACHE_MAX) statsCache.delete(statsCache.keys().next().value!);
  return p;
}

/**
 * 같은 신호의 과거 성과(UI 지도서 5.2 F): 이 종목 일봉으로 같은 전략을 돌린 신호 횟수·승률·손익비.
 * 발굴 > 전략과 백테스트(runSelected)와 같은 입력으로 돌린다: 종목의 시장(단타 기준값), 시장 지수(국면·상대강도),
 * 그 지역의 수수료·세금. 종목 하나의 과거라 표본이 작을 수 있다(화면에 기간과 함께 쓴다).
 */
export function useSignalStats(code: string | null | undefined, strategy: Evidence["strategy"]): StatsResult & { loading: boolean } {
  const [st, setSt] = useState<StatsResult & { loading: boolean }>({ stats: null, period: null, loading: !!code });
  useEffect(() => {
    if (!code) return setSt({ stats: null, period: null, loading: false });
    let alive = true;
    setSt((s) => ({ ...s, loading: true }));
    const p = cachedStats(`${code}|${strategy}`, () =>
      loadStock(code).then((d): StatsResult => {
        if (d.candles.length < 2) return { stats: null, period: null };
        const region = regionOf(d.info.market);
        const bt = runSelected(STRATEGY_OF[strategy], d.candles, d.indexCandles, d.info, region, defaultParams(region));
        const ym = (x: string) => x.slice(0, 7).replace("-", ".");
        return { stats: bt ? signalStats(bt) : null, period: `${ym(d.candles[0]!.date)}~${ym(d.candles.at(-1)!.date)}` };
      }),
    );
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
          {/* 함께 보여 줄 근거 문장: 경고는 아이콘과 함께(NoteList) */}
          {req.notes && req.notes.length > 0 && <NoteList notes={req.notes} dense />}
          {req.code && <SignalStatsView code={req.code} strategy={req.evidence.strategy} />}
        </div>
      )}
    </Sheet>
  );
}
