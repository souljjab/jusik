import { ACTION_LABEL, type Reason, type Recommendation } from "@jusik/shared";
import { num, won } from "./format";

export function ActionBadge({ action }: { action: Recommendation["action"] }) {
  return <span className={`badge ${action}`}>{ACTION_LABEL[action]}</span>;
}

function Reasons({ title, score, reasons }: { title: string; score: number | null; reasons: Reason[] }) {
  return (
    <div className="reasons">
      <h4>
        {title} <small>{score == null ? "데이터 없음" : `${score > 0 ? "+" : ""}${score}점`}</small>
      </h4>
      {reasons.length === 0 ? (
        <p className="muted">뚜렷한 신호가 없어요.</p>
      ) : (
        <ul>
          {reasons.map((r, i) => (
            <li key={i}>
              <span className={r.points > 0 ? "up" : "down"}>{r.points > 0 ? "▲" : "▼"} {r.points > 0 ? "+" : ""}{r.points}</span> {r.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecommendationCard({ rec }: { rec: Recommendation | null }) {
  if (!rec) return <div className="card muted">분석에 필요한 데이터(최소 60거래일)가 부족해요.</div>;
  return (
    <div className="card rec">
      <div className="rec-head">
        <ActionBadge action={rec.action} />
        <div className="gauge" aria-label={`종합 점수 ${rec.total}`}>
          <div className="gauge-mid" />
          <div className="gauge-dot" style={{ left: `${(rec.total + 100) / 2}%` }} />
        </div>
        <strong className="score">{rec.total > 0 ? "+" : ""}{rec.total}</strong>
      </div>
      <p className="muted small">기준일 {rec.asOf} 종가 기준 · 종합 = 기술 60% + 재무 40%{rec.valuation == null ? " (재무 데이터가 없어 기술 점수만 사용)" : ""}</p>
      {rec.stopLoss != null && rec.target != null && (
        <div className="levels">
          <div><span className="muted">참고 손절가 (ATR×2)</span><b className="down">{won(rec.stopLoss)}</b></div>
          <div><span className="muted">참고 목표가 (ATR×3)</span><b className="up">{won(rec.target)}</b></div>
          <div><span className="muted">손익비</span><b>{num((rec.target - rec.price) / (rec.price - rec.stopLoss), 1)} : 1</b></div>
        </div>
      )}
      <div className="reason-grid">
        <Reasons title="기술적 분석" score={rec.technical} reasons={rec.technicalReasons} />
        <Reasons title="재무·가치 분석" score={rec.valuation} reasons={rec.valuationReasons} />
      </div>
    </div>
  );
}
