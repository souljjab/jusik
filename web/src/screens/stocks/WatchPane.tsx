import { ArrowDown, ArrowUp, Compass, X } from "lucide-react";
import { useMemo, useState } from "react";
import { dayTradeEvidence, regionOf, regionOfCode, type DayTradeCandidate } from "@jusik/shared";
import { useActions } from "../../app/actions";
import { useApp } from "../../app/AppContext";
import { href, navigate } from "../../app/router";
import { heldQty } from "../../features/OrderReviewSheet";
import { Button, Change, EmptyState, EvidenceStrip, IconButton, Price, Segmented, Skeleton, Sparkline, srQuote } from "../../ui";
import { StockSearch } from "./StockSearch";
import { moveItem, restoreAt, stateLabel, stockPath } from "./stocksModel";
import { useStockLite } from "./useStockData";

/*
 * 관심종목 목록(UI 지도서 5.2 A·6.1 A·9.2): 이름, 현재가, 등락률, 작은 추세선. 선택한 행은 강조색의 옅은 바탕.
 * '편집'에서 순서를 바꾸고 뺄 수 있고(빼면 되돌리기), ↑↓로 위아래 종목으로 옮겨 간다(화면이 단다).
 * 태블릿 가로에서는 관심 | 추천(오늘의 단타 후보)을 바꿔 본다.
 */

export type ListMode = "watch" | "recs";

function WatchRow({ code, active, editing, index, count, onMove, onRemove }: {
  code: string;
  active: boolean;
  editing: boolean;
  index: number;
  count: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const { data, failed } = useStockLite(code);
  const { journal, server } = useApp();
  const region = regionOfCode(code);
  const name = data?.info.name ?? code;
  const held = heldQty(journal, code) > 0 || !!server?.paper[region === "US" ? "USD" : "KRW"].positions.some((p) => p.code === code);
  const candidate = !!server?.latestScan?.candidates.some((c) => c.code === code);
  const sub = data ? stateLabel({ held, candidate, analysis: data.analysis }) : failed ? "불러오지 못했어요" : "";
  const spark = useMemo(() => data?.candles.slice(-60).map((c) => c.close) ?? [], [data]);
  const q = data?.quote;
  const label = q ? `${srQuote(name, q.price, q.changePct, region)}${sub ? `, ${sub}` : ""}` : name;

  return (
    <li className={`stk-row ${active ? "sel" : ""}`}>
      <a className="stk-row-main" href={href(stockPath(code))} aria-current={active ? "page" : undefined} aria-label={label}>
        <span className="stk-row-name" aria-hidden="true">
          <span className="t-medium ellipsis">{name}</span>
          <span className="t-cap ellipsis">{sub || <Skeleton w={56} h={10} />}</span>
        </span>
        {!editing && (
          <span className="stk-row-spark" aria-hidden="true">
            <Sparkline values={spark} width={56} height={22} />
          </span>
        )}
        <span className="stk-row-quote" aria-hidden="true">
          {q ? (
            <>
              <Price value={q.price} region={region} size="sm" />
              <Change pct={q.changePct} showAbs={false} className="t-cap" />
            </>
          ) : failed ? (
            <span className="t-cap">-</span>
          ) : (
            <>
              <Skeleton w={56} h={14} />
              <Skeleton w={40} h={10} />
            </>
          )}
        </span>
      </a>
      {editing && (
        <span className="stk-row-edit">
          <IconButton size="sm" label={`${name} 위로`} onClick={() => onMove(-1)} disabled={index === 0}>
            <ArrowUp size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
          <IconButton size="sm" label={`${name} 아래로`} onClick={() => onMove(1)} disabled={index === count - 1}>
            <ArrowDown size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
          <IconButton size="sm" label={`${name} 관심종목에서 빼기`} onClick={onRemove}>
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        </span>
      )}
    </li>
  );
}

function RecRow({ c, active }: { c: DayTradeCandidate; active: boolean }) {
  const { openEvidence } = useActions();
  const region = regionOf(c.market);
  const ev = useMemo(() => dayTradeEvidence(c), [c]);
  return (
    <li className={`stk-row rec ${active ? "sel" : ""}`} onClick={() => navigate(stockPath(c.code))}>
      <a className="stk-row-main" href={href(stockPath(c.code))} aria-current={active ? "page" : undefined} aria-label={`${srQuote(c.name, c.price, c.changePct, region)}, ${ev.strategyName} ${ev.headline}`} onClick={(e) => e.stopPropagation()}>
        <span className="stk-row-name" aria-hidden="true">
          <span className="t-medium ellipsis">{c.name}</span>
          <span className="t-cap ellipsis">{ev.strategyName} · {ev.headline}</span>
        </span>
        <span className="stk-row-quote" aria-hidden="true">
          <Price value={c.price} region={region} size="sm" />
          <Change pct={c.changePct} showAbs={false} className="t-cap" />
        </span>
      </a>
      <span className="stk-row-ev">
        <EvidenceStrip evidence={ev} onOpen={() => openEvidence({ title: `${c.name} 근거`, evidence: ev, code: c.code, notes: c.notes })} />
      </span>
    </li>
  );
}

export function WatchPane({ selected, mode, onMode, compact = false }: { selected: string | null; mode: ListMode; onMode: (m: ListMode) => void; compact?: boolean }) {
  const { watchlist, setWatchlist, server } = useApp();
  const [editing, setEditing] = useState(false);
  const [undo, setUndo] = useState<{ code: string; index: number } | null>(null);
  const recs = server?.latestScan?.candidates ?? [];

  const remove = (code: string) => {
    const index = watchlist.indexOf(code);
    setWatchlist(watchlist.filter((c) => c !== code));
    setUndo({ code, index });
  };

  const seg = (
    <Segmented
      label="목록"
      size="sm"
      className="stk-list-mode"
      value={mode}
      onChange={(m) => (onMode(m), setEditing(false))}
      options={[{ value: "watch", label: `관심 ${watchlist.length}` }, { value: "recs", label: `추천 ${recs.length}` }]}
    />
  );

  return (
    <section className={`stk-list ${compact ? "compact" : ""}`} aria-labelledby="stk-list-h">
      <div className="stk-list-head">
        <h2 id="stk-list-h" className={compact ? "sr-only" : "t-section"}>
          {mode === "watch" ? "관심종목" : "추천 후보"}
        </h2>
        {compact && seg}
        {mode === "watch" && watchlist.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => (setEditing((v) => !v), setUndo(null))} aria-pressed={editing}>
            {editing ? "편집 끝내기" : "편집"}
          </Button>
        )}
      </div>
      {!compact && seg}
      <StockSearch onPick={(code) => navigate(stockPath(code))} />

      {undo && (
        <div className="stk-undo" role="status">
          <span className="t-2">관심종목에서 뺐어요.</span>
          <Button variant="link" onClick={() => (setWatchlist(restoreAt(watchlist, undo.code, undo.index)), setUndo(null))}>
            되돌리기
          </Button>
        </div>
      )}

      {mode === "watch" ? (
        watchlist.length === 0 ? (
          <EmptyState
            title="관심종목이 없어요"
            icon={<Compass size={24} strokeWidth={1.5} aria-hidden="true" />}
            action={
              <Button variant="primary" onClick={() => navigate("/discover")}>
                발굴로 이동
              </Button>
            }
          >
            <span className="t-2">발굴에서 후보를 찾아 추가하세요. 종목 화면의 별 단추로도 추가할 수 있어요.</span>
          </EmptyState>
        ) : (
          <ul className="stk-rows" aria-label="관심종목">
            {watchlist.map((code, i) => (
              <WatchRow
                key={code}
                code={code}
                index={i}
                count={watchlist.length}
                active={code === selected}
                editing={editing}
                onMove={(d) => setWatchlist(moveItem(watchlist, i, d))}
                onRemove={() => remove(code)}
              />
            ))}
          </ul>
        )
      ) : recs.length === 0 ? (
        <EmptyState
          title="오늘의 추천 후보가 아직 없어요"
          action={
            <Button variant="secondary" onClick={() => navigate("/discover")}>
              발굴로 이동
            </Button>
          }
        >
          <span className="t-2">스캔하면 규칙에 맞는 후보가 여기에 나와요.</span>
        </EmptyState>
      ) : (
        <ul className="stk-rows" aria-label="추천 후보">
          {recs.map((c) => (
            <RecRow key={c.code} c={c} active={c.code === selected} />
          ))}
        </ul>
      )}
      {mode === "watch" && watchlist.length > 0 && !compact && <p className="t-cap stk-list-foot">↑↓ 키로 위아래 종목을 볼 수 있어요.</p>}
    </section>
  );
}
