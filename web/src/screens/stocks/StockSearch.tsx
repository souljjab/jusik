import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { isValidCode, type StockInfo } from "@jusik/shared";
import { searchStocks } from "../../api";
import { MARKET_LABEL } from "../../ui";

/** 목록 위 종목 검색(지도서 6.1 '종목 검색'): 이름·코드·티커. ↑↓로 고르고 Enter로 연다 */
export function StockSearch({ onPick }: { onPick: (code: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    let alive = true;
    const t = setTimeout(() => {
      searchStocks(q)
        .then((r) => alive && (setResults(r.slice(0, 8)), setActive(0)))
        .catch(() => alive && setResults([]));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const close = (e: PointerEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const pick = (code: string) => {
    onPick(code);
    setQ("");
    setResults([]);
    setOpen(false);
  };
  const submit = () => {
    const hit = results[active];
    if (hit) pick(hit.code);
    else if (isValidCode(q.trim().toUpperCase())) pick(q.trim().toUpperCase());
  };
  const show = open && results.length > 0;

  return (
    <div className="stk-search" ref={wrap}>
      <Search size={16} strokeWidth={1.5} className="ico" aria-hidden="true" />
      <input
        className="ui-input"
        type="search"
        placeholder="종목 검색(이름·코드·티커)"
        value={q}
        role="combobox"
        aria-expanded={show}
        aria-controls={`${id}-list`}
        aria-activedescendant={show ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        aria-label="종목 검색"
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, results.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === "Enter") submit();
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {show && (
        <ul id={`${id}-list`} className="stk-search-list" role="listbox" aria-label="검색 결과">
          {results.map((s, i) => (
            <li
              key={s.code}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => (e.preventDefault(), pick(s.code))}
              onPointerEnter={() => setActive(i)}
            >
              <span className="ellipsis">{s.name}</span>
              <span className="t-cap nowrap">
                {s.code} · {MARKET_LABEL[s.market] ?? s.market}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
