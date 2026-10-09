import { useEffect, useRef, useState } from "react";
import type { StockInfo } from "@jusik/shared";
import { searchStocks } from "./api";

export function SearchBox({ onPick }: { onPick: (code: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    let alive = true;
    const t = setTimeout(() => {
      searchStocks(q).then((r) => alive && (setResults(r), setActive(0))).catch(() => alive && setResults([]));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
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
    else if (/^\d{6}$/.test(q.trim())) pick(q.trim());
  };

  return (
    <div className="search" ref={wrap}>
      <input
        placeholder="종목명 또는 6자리 코드 (예: 삼성전자, 005930)"
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter") submit();
          else if (e.key === "Escape") setOpen(false);
        }}
        aria-label="종목 검색"
      />
      {open && results.length > 0 && (
        <ul className="dropdown" role="listbox">
          {results.map((s, i) => (
            <li key={s.code} role="option" aria-selected={i === active} className={i === active ? "active" : ""} onMouseDown={() => pick(s.code)}>
              <span>{s.name}</span>
              <span className="muted small">{s.code} · {s.market}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
