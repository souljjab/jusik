import { useMemo, useState } from "react";
import { ACTION_LABEL, expectancy, positionSize, REGIME_LABEL, STAGE_LABEL, summarizeJournal, type Action, type Analysis, type JournalEntry } from "@jusik/shared";
import { NoteList } from "./NoteList";
import { num, won } from "./format";
import { loadSettings, saveSettings, type Settings } from "./storage";

export function ActionBadge({ action }: { action: Action }) {
  return <span className={`badge ${action}`}>{ACTION_LABEL[action]}</span>;
}

function Step({ n, title, children, badge }: { n: number; title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section className="step">
      <h4>
        <span className="step-n">{n}</span> {title} {badge}
      </h4>
      {children}
    </section>
  );
}

const ACTION_HINT: Record<Action, string> = {
  STRONG_BUY: "신규 매수 가능 구간 — 분할 진입을 권장해요",
  BUY: "신규 매수 가능 구간 — 분할 진입을 권장해요",
  HOLD: "신규 매수는 대기 · 보유 중이면 유지하며 손절가만 지켜요",
  SELL: "보유 중이면 비중 축소·청산을 검토하세요",
  STRONG_SELL: "신규 매수 금지 · 보유 중이면 청산을 검토하세요",
};

export function AnalysisCard({ a, journal }: { a: Analysis | null; journal: JournalEntry[] }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const patch = (p: Partial<Settings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    saveSettings(next);
  };

  const size = useMemo(
    () => (a ? positionSize({ capital: settings.capital, entry: a.price, stop: a.timing.stopLoss, riskPct: settings.riskPct, maxWeightPct: settings.maxWeightPct }) : null),
    [a, settings],
  );
  const mine = useMemo(() => summarizeJournal(journal), [journal]);
  const myEv = useMemo(
    () => (mine.closed.length >= 5 && mine.winRate != null && mine.avgWinPct != null && mine.avgLossPct != null ? expectancy({ winRate: mine.winRate, avgWinPct: mine.avgWinPct, avgLossPct: mine.avgLossPct }) : null),
    [mine],
  );

  if (!a) return <div className="card muted">분석에 필요한 데이터(주봉 약 34주 이상)가 부족해요.</div>;
  const t = a.timing;
  const changed = a.action !== a.timingAction;

  return (
    <div className="card analysis">
      <div className="rec-head">
        <ActionBadge action={a.action} />
        <div>
          <strong>{STAGE_LABEL[t.stage]}</strong>
          <div className="small">{ACTION_HINT[a.action]}</div>
          {changed && <div className="muted small">주봉 신호는 「{ACTION_LABEL[a.timingAction]}」이었지만 아래 조건 때문에 조정했어요</div>}
        </div>
      </div>
      <p className="muted small">기준일 {a.asOf} · 주봉 신호는 마감된 주({t.weekDate}) 기준이에요. 시장 → 종목 → 타이밍 → 리스크 순서로 확인해요.</p>
      {a.gates.length > 0 && <NoteList notes={a.gates} />}

      <div className="steps">
        <Step n={1} title="시장 국면" badge={a.regime && <span className={`chip regime-${a.regime.regime}`}>{REGIME_LABEL[a.regime.regime]}</span>}>
          {a.regime ? <NoteList notes={a.regime.notes} /> : <p className="muted small">지수 데이터가 없어요.</p>}
          <p className="muted small">금리·유동성·VIX 같은 매크로 지표는 아직 반영하지 않았어요(지수 추세만 사용).</p>
        </Step>

        <Step n={2} title="종목 스크리닝" badge={<span className={`chip grade-${a.screening.grade.replace("/", "")}`}>{a.screening.grade}</span>}>
          <p className="small">
            체크리스트 <b>{a.screening.passed}</b> / {a.screening.known} 통과
            {a.screening.known < a.screening.total && <span className="muted"> (데이터 없음 {a.screening.total - a.screening.known})</span>}
          </p>
          <ul className="notes">
            {a.screening.checks.filter((c) => c.status === "fail").map((c) => (
              <li key={c.id} className="note-bad">✖ {c.label} {c.value} (기준 {c.rule})</li>
            ))}
            {a.screening.checks.every((c) => c.status !== "fail") && <li className="note-good">✔ 확인된 항목에서 기준 미달이 없어요</li>}
          </ul>
          <p className="muted small">전체 항목은 「재무·스크리닝」 탭에서 볼 수 있어요.</p>
        </Step>

        <Step n={3} title="진입·청산 타이밍" badge={<ActionBadge action={a.timingAction} />}>
          <NoteList notes={t.notes} />
          <div className="levels">
            <div><span className="muted">현재가</span><b>{won(a.price)}</b></div>
            <div><span className="muted">참고 손절가(최근 8주 저점)</span><b className={a.belowStop ? "down" : ""}>{won(t.stopLoss)}{a.belowStop ? " · 이탈" : ""}</b></div>
            <div><span className="muted">참고 목표가(손익비 2:1)</span><b className="up">{won(a.target)}</b></div>
            <div><span className="muted">30주선 이격</span><b>{num(t.pctFromMa, 1)}%</b></div>
          </div>
          {a.candlePatterns.length > 0 && (
            <div className="patterns">
              <b className="small">캔들 보조 신호(일봉)</b>
              <ul className="notes">
                {a.candlePatterns.map((p) => (
                  <li key={p.id} className={p.direction === "bullish" ? "note-good" : "note-bad"}>
                    {p.direction === "bullish" ? "▲" : "▼"} {p.name} — {p.note} (기준가 {won(p.invalidation)})
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted small">일봉 단기 점수 {a.shortTerm.score > 0 ? "+" : ""}{a.shortTerm.score} (과열·눌림 참고용, 진입 판단에는 쓰지 않아요)</p>
        </Step>

        <Step n={4} title="리스크·비중">
          <div className="form compact">
            <label>투자 원금(원)<input type="number" min={100000} step={1000000} value={settings.capital} onChange={(e) => patch({ capital: Math.max(100000, +e.target.value || 0) })} /></label>
            <label>1회 손절 허용 손실(%)<input type="number" min={0.1} max={10} step={0.1} value={settings.riskPct} onChange={(e) => patch({ riskPct: Math.min(10, Math.max(0.1, +e.target.value || 1)) })} /></label>
            <label>한 종목 최대 비중(%)<input type="number" min={1} max={100} value={settings.maxWeightPct} onChange={(e) => patch({ maxWeightPct: Math.min(100, Math.max(1, +e.target.value || 25)) })} /></label>
          </div>
          {size && size.shares > 0 ? (
            <ul className="notes">
              {a.action !== "BUY" && a.action !== "STRONG_BUY" && <li className="note-warn">⚠ 지금은 매수 신호가 아니에요. 아래는 매수한다고 가정했을 때의 계산이에요</li>}
              <li className="note-info">참고 매수 수량 <b>{size.shares.toLocaleString()}주</b> ({won(size.amount)}, 비중 {num(size.weightPct, 1)}%)</li>
              <li className="note-info">손절가({won(a.timing.stopLoss)})까지 가면 약 {won(size.riskAmount)} 손실 (자본의 {num((size.riskAmount / settings.capital) * 100, 2)}%)</li>
              {size.cappedByWeight && <li className="note-warn">⚠ 손절폭은 더 사도 되지만 비중 상한 때문에 수량을 줄였어요</li>}
              {size.riskPerSharePct > 15 && <li className="note-warn">⚠ 손절폭이 {num(size.riskPerSharePct, 0)}%로 커요. 손절가를 더 가깝게 잡을 수 있는지 보세요</li>}
            </ul>
          ) : (
            <p className="muted small">현재가가 손절가보다 낮거나 같아서 수량을 계산할 수 없어요.</p>
          )}
          {myEv ? (
            <p className="small">내 매매일지 기준({mine.closed.length}회) 기대값 <b className={myEv.expectancyPct >= 0 ? "up" : "down"}>{myEv.expectancyPct >= 0 ? "+" : ""}{num(myEv.expectancyPct, 2)}%</b>/회 · 켈리 {num(myEv.kellyPct, 0)}% (절반 {num(myEv.halfKellyPct, 0)}%)</p>
          ) : (
            <p className="muted small">매매일지에 청산 거래가 5회 이상 쌓이면 내 승률로 기대값을 계산해 줘요.</p>
          )}
          <p className="muted small">올인보다 손절폭 기준 비중을 기본으로 해요. 한 종목에 몰아넣는 전략은 확신과 손실 감내가 있을 때만 상한을 직접 올리세요.</p>
        </Step>
      </div>
    </div>
  );
}
