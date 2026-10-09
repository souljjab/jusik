import { useEffect, useState } from "react";
import { loadStock, type StockData } from "./api";
import { ActionBadge } from "./AnalysisCard";
import { pct, tone } from "./format";

function Row({ code, active, onSelect, onRemove }: { code: string; active: boolean; onSelect: () => void; onRemove: () => void }) {
  const [d, setD] = useState<StockData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadStock(code).then((x) => alive && setD(x)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [code]);
  return (
    <li className={active ? "wl-row active" : "wl-row"}>
      <button className="wl-main" onClick={onSelect}>
        <span className="wl-name">{d?.info.name ?? code}</span>
        {d ? (
          <span className="wl-sub">
            <span className={tone(d.quote.changePct)}>{pct(d.quote.changePct)}</span>
            {d.analysis && <ActionBadge action={d.analysis.action} />}
          </span>
        ) : (
          <span className="wl-sub muted">{failed ? "불러오기 실패" : "불러오는 중…"}</span>
        )}
      </button>
      <button className="icon-btn" title="관심종목에서 삭제" aria-label={`${d?.info.name ?? code} 삭제`} onClick={onRemove}>×</button>
    </li>
  );
}

export function Watchlist({ codes, selected, onSelect, onRemove }: { codes: string[]; selected: string | null; onSelect: (c: string) => void; onRemove: (c: string) => void }) {
  return (
    <aside className="sidebar">
      <h3>관심종목</h3>
      {codes.length === 0 ? (
        <p className="muted small">종목을 검색한 뒤 ☆ 버튼으로 추가해 보세요. 관심종목의 현재 신호를 한눈에 볼 수 있어요.</p>
      ) : (
        <ul className="wl">
          {codes.map((c) => (
            <Row key={c} code={c} active={c === selected} onSelect={() => onSelect(c)} onRemove={() => onRemove(c)} />
          ))}
        </ul>
      )}
    </aside>
  );
}
