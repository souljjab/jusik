import { ArrowRight, Compass, Search, Star } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { isValidCode, STRATEGIES, type StockInfo } from "@jusik/shared";
import { searchStocks } from "../api";
import { useApp } from "../app/AppContext";
import { navigate } from "../app/router";
import { SCREENS } from "./nav";

interface Item {
  key: string;
  group: "종목" | "전략" | "화면";
  label: string;
  sub?: string;
  go: () => void;
}

/** 명령 검색(Ctrl K, 맥은 Cmd K): 종목·전략·화면을 찾아 바로 이동 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { watchlist, openStock } = useApp();
  const [q, setQ] = useState("");
  const [stocks, setStocks] = useState<StockInfo[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    setQ("");
    setActive(0);
    setTimeout(() => input.current?.focus(), 0);
    return () => (opener.current as HTMLElement | null)?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open || !q.trim()) return setStocks([]);
    let alive = true;
    const t = setTimeout(() => searchStocks(q.trim()).then((r) => alive && setStocks(r.slice(0, 8))).catch(() => alive && setStocks([])), 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const t = q.trim().toLowerCase();
    const match = (s: string) => !t || s.toLowerCase().includes(t);
    const out: Item[] = [];
    const seen = new Set<string>();
    for (const s of stocks) {
      seen.add(s.code);
      out.push({ key: `s:${s.code}`, group: "종목", label: s.name, sub: `${s.code} · ${s.market === "US" ? "미국" : s.market}`, go: () => openStock(s.code) });
    }
    const up = q.trim().toUpperCase();
    if (up && isValidCode(up) && !seen.has(up)) out.push({ key: `s:${up}`, group: "종목", label: up, sub: "코드로 열기", go: () => openStock(up) });
    if (!t) for (const c of watchlist.slice(0, 5)) out.push({ key: `w:${c}`, group: "종목", label: c, sub: "관심종목", go: () => openStock(c) });
    for (const s of STRATEGIES) if (match(`${s.name} ${s.source} ${s.description}`)) out.push({ key: `t:${s.id}`, group: "전략", label: s.name, sub: s.source, go: () => navigate(`/discover/strategy?id=${s.id}`) });
    for (const s of SCREENS) if (match(`${s.label} ${s.keywords}`)) out.push({ key: `p:${s.path}`, group: "화면", label: s.label, go: () => navigate(s.path) });
    return out;
  }, [q, stocks, watchlist, openStock]);

  useEffect(() => setActive((a) => Math.min(a, Math.max(0, items.length - 1))), [items.length]);

  if (!open) return null;
  const run = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    it.go();
  };
  let lastGroup = "";
  return createPortal(
    <>
      <div className="ui-scrim" onClick={onClose} aria-hidden="true" />
      <div className="ui-sheet center cmd" role="dialog" aria-modal="true" aria-label="명령 검색">
        <div className="cmd-input">
          <Search size={18} className="muted" aria-hidden="true" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setActive(0))}
            placeholder="종목명·코드, 전략, 화면 이름"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-activedescendant={items[active] ? `cmd-${items[active]!.key}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
              else if (e.key === "Enter") (e.preventDefault(), run(items[active]));
              else if (e.key === "Escape") (e.preventDefault(), onClose());
              else if (e.key === "Tab") e.preventDefault();
            }}
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
                <Icon size={16} className="muted" aria-hidden="true" />
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
