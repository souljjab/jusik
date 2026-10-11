import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { isValidCode, type StockInfo } from "@jusik/shared";
import { searchStocks } from "../../api";
import { useApp } from "../../app/AppContext";
import { Chip } from "../../ui";

/**
 * 백테스트할 종목 고르기: 이름·코드 검색, 관심종목과 스캔 후보에서 바로 고르기.
 * 검색 결과는 ↑↓로 고르고 Enter로 정한다(6자리 코드나 티커를 그대로 넣어도 된다).
 */
export function StockPicker({ code, onPick }: { code: string; onPick: (code: string) => void }) {
  const { watchlist, server, journal } = useApp();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();

  /** 이름을 아는 종목(스캔 후보·일지·모의계좌) */
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of journal) m.set(e.code, e.name);
    for (const c of server?.latestScan?.candidates ?? []) m.set(c.code, c.name);
    for (const p of [...(server?.paper.KRW.positions ?? []), ...(server?.paper.USD.positions ?? [])]) m.set(p.code, p.name);
    return m;
  }, [journal, server]);

  const quick = useMemo(() => {
    const out: { code: string; from: string }[] = [];
    const seen = new Set<string>();
    for (const c of watchlist.slice(0, 6)) if (!seen.has(c)) (seen.add(c), out.push({ code: c, from: "관심" }));
    for (const c of (server?.latestScan?.candidates ?? []).slice(0, 4)) if (!seen.has(c.code)) (seen.add(c.code), out.push({ code: c.code, from: "후보" }));
    return out;
  }, [watchlist, server]);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    let alive = true;
    const t = setTimeout(() => {
      searchStocks(q.trim())
        .then((r) => alive && (setResults(r.slice(0, 8)), setActive(0)))
        .catch(() => alive && setResults([]));
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

  const pick = (c: string) => {
    onPick(c);
    setQ("");
    setResults([]);
    setOpen(false);
  };
  const submit = () => {
    const hit = results[active];
    if (hit) pick(hit.code);
    else if (isValidCode(q.trim().toUpperCase())) pick(q.trim().toUpperCase());
  };
  const showList = open && results.length > 0;

  return (
    <div className="disc-picker">
      <div className="disc-search" ref={wrap}>
        <Search size={16} strokeWidth={1.5} className="disc-search-ico" aria-hidden="true" />
        <input
          className="ui-input"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="백테스트할 종목 검색"
          placeholder="종목명·코드·티커 (예: 삼성전자, 005930, AAPL)"
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, results.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
            else if (e.key === "Enter") (e.preventDefault(), submit());
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {showList && (
          <ul className="disc-dropdown" role="listbox" id={listId} aria-label="검색 결과">
            {results.map((s, i) => (
              <li key={s.code} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => (e.preventDefault(), pick(s.code))} onMouseEnter={() => setActive(i)}>
                <span className="t-medium">{s.name}</span>
                <span className="t-cap">
                  {s.code} · {s.market}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {quick.length > 0 && (
        <div className="disc-chips scroll" role="group" aria-label="관심종목과 후보에서 고르기">
          {quick.map((x) => (
            <Chip key={x.code} pressed={x.code === code} onClick={() => pick(x.code)}>
              {names.get(x.code) ?? x.code}
              <span className="t-cap">{x.from}</span>
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
