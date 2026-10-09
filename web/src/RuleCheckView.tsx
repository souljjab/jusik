import { useCallback, useEffect, useState } from "react";
import { MIN_RELIABLE, type Evaluation, type Market, type ReplayRun, type Stats } from "@jusik/shared";
import { getPaperEval, getReplay, runReplay, saveSettings } from "./api";
import { kst, num, pct, tone } from "./format";

const v = (x: number | null, d = 2) => (x == null ? "-" : pct(x, d));

function StatCells({ s }: { s: Stats }) {
  return (
    <>
      <td>{s.n}{!s.reliable && <span className="muted small" title={`${MIN_RELIABLE}건 미만은 우연일 수 있어요`}> *</span>}</td>
      <td>{s.winRate == null ? "-" : `${num(s.winRate * 100, 0)}%`}</td>
      <td className={s.expectancyPct == null ? "" : tone(s.expectancyPct)}>{v(s.expectancyPct)}</td>
      <td className={s.lowerBoundPct == null ? "" : tone(s.lowerBoundPct)}>{v(s.lowerBoundPct)}</td>
      <td>{s.profitFactor == null ? "-" : num(s.profitFactor, 2)}</td>
    </>
  );
}

const HEAD = (
  <>
    <th>거래 수</th><th>승률</th><th title="거래당 평균 순수익률(비용 반영)">기대값</th><th title="기대값의 95% 신뢰구간 하단 — 0보다 커야 우연이 아닐 가능성이 높아요">기대값 하한</th><th title="총이익 ÷ 총손실">PF</th>
  </>
);

function EvaluationPanel({ ev, currentMin, onApplied }: { ev: Evaluation; currentMin: number; onApplied: () => void }) {
  const [msg, setMsg] = useState("");
  const apply = async () => {
    if (ev.suggestion.minScore == null) return;
    if (!confirm(`최소 점수를 ${currentMin}점 → ${ev.suggestion.minScore}점으로 바꿀까요?`)) return;
    await saveSettings({ minScore: ev.suggestion.minScore });
    setMsg("적용했어요");
    onApplied();
  };
  if (ev.overall.n === 0) return <p className="muted">점검할 거래가 아직 없어요.</p>;
  const o = ev.overall;
  return (
    <>
      <p className="muted small">기간 {ev.from} ~ {ev.to} · 모든 수익률은 수수료·세금·슬리피지를 뺀 값이에요 · * 표시는 표본 {MIN_RELIABLE}건 미만</p>
      <div className="metrics">
        <div className="metric"><span className="muted small">거래 수</span><b>{o.n}</b></div>
        <div className="metric"><span className="muted small">승률</span><b>{o.winRate == null ? "-" : `${num(o.winRate * 100, 0)}%`}</b></div>
        <div className="metric"><span className="muted small">평균 이익 / 손실</span><b>{v(o.avgWinPct)} / {v(o.avgLossPct)}</b></div>
        <div className="metric"><span className="muted small">거래당 기대값</span><b className={tone(o.expectancyPct ?? 0)}>{v(o.expectancyPct)}</b></div>
        <div className="metric"><span className="muted small">기대값 95% 하한</span><b className={tone(o.lowerBoundPct ?? 0)}>{v(o.lowerBoundPct)}</b></div>
      </div>
      <div className={`suggest ${ev.suggestion.minScore != null ? "on" : ""}`}>
        <b>기준 제안:</b> {ev.suggestion.minScore != null ? `최소 점수 ${ev.suggestion.minScore}점` : "변경하지 않음"} — {ev.suggestion.reason}
        {ev.suggestion.minScore != null && ev.suggestion.minScore !== currentMin && <> <button className="primary small-btn" onClick={apply}>이 기준 적용</button> <span className="muted small">{msg}</span></>}
      </div>

      <h4 className="group">최소 점수 기준별 성과 <span className="muted small">— 앞 절반에서 고른 기준이 뒤 절반에서도 통하는지 봐요(현재 {currentMin}점)</span></h4>
      <div className="table-wrap">
        <table className="trades">
          <thead><tr><th>기준</th>{HEAD}<th>앞 절반 기대값</th><th>뒤 절반 기대값</th></tr></thead>
          <tbody>
            {ev.thresholds.filter((t) => t.all.n > 0).map((t) => (
              <tr key={t.minScore} className={t.minScore === currentMin ? "hl" : ""}>
                <td>{t.minScore}점 이상</td><StatCells s={t.all} />
                <td className={tone(t.firstHalf.expectancyPct ?? 0)}>{v(t.firstHalf.expectancyPct)} <span className="muted small">({t.firstHalf.n})</span></td>
                <td className={tone(t.secondHalf.expectancyPct ?? 0)}>{v(t.secondHalf.expectancyPct)} <span className="muted small">({t.secondHalf.n})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="eval-groups">
        {ev.groups.map((g) => (
          <div key={g.title}>
            <h4 className="group">{g.title}별</h4>
            <table className="trades">
              <thead><tr><th className="left">조건</th>{HEAD}</tr></thead>
              <tbody>{g.buckets.map((b) => <tr key={b.label}><td className="left">{b.label}</td><StatCells s={b.stats} /></tr>)}</tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}

export function RuleCheckView({ currentMin, refresh }: { currentMin: number; refresh: () => void }) {
  const [paper, setPaper] = useState<{ evaluation: Evaluation; tradeCount: number } | null>(null);
  const [replay, setReplay] = useState<ReplayRun | null>(null);
  const [running, setRunning] = useState(false);
  const [markets, setMarkets] = useState<Record<Market, boolean>>({ KOSPI: true, KOSDAQ: true, US: true });
  const [count, setCount] = useState(500);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    getPaperEval().then(setPaper).catch(() => {});
    getReplay().then((r) => { setReplay(r.run); setRunning(r.running); }).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const run = async () => {
    setRunning(true);
    setErr("");
    try {
      const r = await runReplay({ markets: (Object.keys(markets) as Market[]).filter((m) => markets[m]), count });
      setReplay(r.run);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };
  const applied = () => { refresh(); load(); };

  return (
    <div>
      <div className="card">
        <h3 className="h3">① 모의매매 실적으로 점검</h3>
        <p className="muted small">모의매매가 자동으로 남긴 매수·매도 기록을 짝지어, 진입 당시 점수·거래량·상승률·시장 국면별로 실제 결과를 나눠 봐요. 가장 현실에 가까운 근거지만 쌓이는 데 시간이 걸려요.</p>
        {paper ? <EvaluationPanel ev={paper.evaluation} currentMin={currentMin} onApplied={applied} /> : <p className="muted">불러오는 중…</p>}
        {paper && paper.tradeCount === 0 && <p className="muted small">「단타 추천」 설정에서 모의매매 자동 실행을 켜 두면 장중에 기록이 쌓여요. 아니면 아래 과거 재현으로 먼저 확인할 수 있어요.</p>}
      </div>

      <div className="card">
        <h3 className="h3">② 과거 데이터로 재현</h3>
        <p className="muted small">
          종목별 과거 일봉에 지금 규칙을 그대로 적용해요(신호 다음 날 시가 진입, 같은 날 손절·목표가 모두 닿으면 손절로 처리). 대상은 내장 종목 목록과 지금까지 스캔에 나온 종목이라,
          매일 거래량 상위에서 고르는 실제 스캔과 구성이 달라요(대형주 위주). 실시간 스캔은 장중에 들어가므로 체결 가격도 달라요. 참고용으로 보세요.
        </p>
        <div className="checks">
          {(["KOSPI", "KOSDAQ", "US"] as const).map((m) => (
            <label key={m} className="check"><input type="checkbox" checked={markets[m]} onChange={(e) => setMarkets({ ...markets, [m]: e.target.checked })} />{m === "US" ? "미국" : m}</label>
          ))}
          <label className="check">기간
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              <option value={250}>약 1년(250봉)</option><option value={500}>약 2년(500봉)</option><option value={1000}>약 4년(1000봉)</option>
            </select>
          </label>
          <button className="primary" disabled={running} onClick={run}>{running ? "재현 중… (종목 수에 따라 1~3분)" : "재현 실행"}</button>
        </div>
        {err && <p className="warn">{err}</p>}
        {replay ? (
          <>
            <p className="small">마지막 재현 {kst(replay.at)} · {replay.markets.join(", ")} · {replay.codesTested}종목 · 거래 {replay.tradeCount}건 · 일봉 {replay.candleCount}개</p>
            {replay.errors.length > 0 && <details><summary className="note-bad small">읽지 못한 항목 {replay.errors.length}건</summary><ul className="notes">{replay.errors.slice(0, 10).map((e, i) => <li key={i} className="note-bad small">{e}</li>)}</ul></details>}
            <EvaluationPanel ev={replay.evaluation} currentMin={currentMin} onApplied={applied} />
          </>
        ) : (
          <p className="muted">아직 재현한 적이 없어요.</p>
        )}
      </div>

      <p className="muted small">
        기대값이 플러스여도 하한이 0 아래면 우연일 수 있어요. 승률보다 <b>기대값과 그 하한</b>을 보세요. 기준을 자주 바꾸면 과거에만 맞는 규칙이 되기 쉬우니, 제안은 앞·뒤 기간 모두에서 나았을 때만 나와요.
      </p>
    </div>
  );
}
