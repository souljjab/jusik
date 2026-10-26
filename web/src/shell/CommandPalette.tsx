import { ArrowRight, Compass, Search, Star } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { StockInfo } from "@jusik/shared";
import { knownName, searchStocks, stockNames } from "../api";
import { useApp } from "../app/AppContext";
import { useOverlayLayer } from "../ui";
import { paletteItems, WATCH_MAX, type PaletteItem } from "./paletteModel";

/** 명령 검색(Ctrl K, 맥은 Cmd K): 종목·전략·화면을 찾아 바로 이동 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { watchlist, openStock, server, journal } = useApp();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; list: StockInfo[] } | null>(null);
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useOverlayLayer(open, dialog, onClose, "input");

  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults(null);
    setActive(0);
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!open || !query) return;
    let alive = true;
    const t = setTimeout(
      () =>
        searchStocks(query)
          .then((r) => alive && setResults({ q: query, list: r.slice(0, 8) }))
          .catch(() => alive && setResults({ q: query, list: [] })),
      150,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open]);

  // 관심종목 이름: 마지막 스캔 후보·매매일지·이미 받은 이름에서 먼저 찾고, 모르는 것만 검색으로 찾는다
  const names = useMemo(() => {
    const m: Record<string, string> = { ...fetched };
    for (const e of journal) if (e.name && e.name !== e.code) m[e.code] = e.name;
    for (const c of server?.latestScan?.candidates ?? []) m[c.code] = c.name;
    for (const c of watchlist) {
      const k = knownName(c);
      if (k) m[c] = k;
    }
    return m;
  }, [fetched, journal, server?.latestScan, watchlist]);

  const shownWatch = watchlist.slice(0, WATCH_MAX);
  const missing = shownWatch.filter((c) => !names[c]).join(",");
  useEffect(() => {
    if (!open || !missing) return;
    let alive = true;
    void stockNames(missing.split(",")).then((r) => alive && Object.keys(r).length && setFetched((f) => ({ ...f, ...r })));
    return () => {
      alive = false;
    };
  }, [open, missing]);

  const items = useMemo(() => paletteItems({ q, results, watchlist, names, openStock }), [q, results, watchlist, names, openStock]);

  useEffect(() => setActive((a) => Math.min(a, Math.max(0, items.length - 1))), [items.length]);

  if (!open) return null;
  const run = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    it.go();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
    else if (e.key === "Enter") (e.preventDefault(), run(items[active]));
  };
  let lastGroup = "";
  return createPortal(
    <>
      <div className="ui-scrim" onClick={onClose} aria-hidden="true" />
      {/* 목록의 빈 곳·묶음 이름을 눌러도 포커스는 입력 칸에 남는다(Esc·화살표가 계속 듣게) */}
      <div
        ref={dialog}
        className="ui-sheet ui-sheet--center cmd"
        role="dialog"
        aria-modal="true"
        aria-label="명령 검색"
        tabIndex={-1}
        onKeyDown={onKey}
        onMouseDown={(e) => e.target !== input.current && e.preventDefault()}
      >
        <div className="cmd-input">
          <Search size={18} strokeWidth={1.5} className="muted" aria-hidden="true" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setActive(0))}
            placeholder="종목명·코드, 전략, 화면 이름"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? `cmd-${items[active]!.key}` : undefined}
          />
          <span className="kbd">Esc</span>
        </div>
        <ul className="cmd-list" id="cmd-list" role="listbox" aria-label="검색 결과">
          {items.length === 0 && <li className="cmd-group">찾는 항목이 없어요. 종목코드(예: 005930, AAPL)로도 열 수 있어요.</li>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <li key={`g-${it.group}`} className="cmd-group" role="presentation">{it.group}</li> : null;
            lastGroup = it.group;
            const Icon = it.group === "종목" ? Star : it.group === "전략" ? Compass : ArrowRight;
            return [
              head,
              <li
                key={it.key}
                id={`cmd-${it.key}`}
                role="option"
                aria-selected={i === active}
                className="cmd-item"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => (e.preventDefault(), run(it))}
              >
                <Icon size={16} strokeWidth={1.5} className="muted" aria-hidden="true" />
                <span>{it.label}</span>
                {it.sub && <span className="sub">{it.sub}</span>}
              </li>,
            ];
          })}
        </ul>
      </div>
    </>,
    document.body,
  );
}
