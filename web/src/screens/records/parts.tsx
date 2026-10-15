import { AlertTriangle, Check, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isValidCode, PAPER_STRATEGY, STRATEGIES, type Currency, type JournalEntry, type StockInfo } from "@jusik/shared";
import { searchStocks } from "../../api";
import { useApp } from "../../app/AppContext";
import { arrowOf, Chip, fmtPct, fmtPnlByCurrency, toneOf } from "../../ui";
import { EMOTIONS_MAIN, EMOTIONS_MORE, sourceOf, type Tag } from "./recordsModel";

/** 손익 금액: 색 + 삼각형 + 부호(국내 만 원 단위, 미국 달러) */
export function Pnl({ value, currency, className = "" }: { value: number | null | undefined; currency: Currency; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={`num flat ${className}`}>-</span>;
  const t = toneOf(value);
  const text = fmtPnlByCurrency(value, currency);
  return (
    <span className={`num ${t} ${className}`} aria-label={`${text}${t === "up" ? " 이익" : t === "down" ? " 손실" : ""}`}>
      <span aria-hidden="true">
        {arrowOf(value)} {text}
      </span>
    </span>
  );
}

/** 수익률: 색 + 삼각형 + 부호 + 소수 둘째 자리 */
export function Ret({ pct, className = "" }: { pct: number | null | undefined; className?: string }) {
  if (pct == null || !Number.isFinite(pct)) return <span className={`num flat ${className}`}>-</span>;
  const t = toneOf(pct);
  return (
    <span className={`num ${t} ${className}`} aria-label={`${Math.abs(pct).toFixed(2)}% ${t === "up" ? "이익" : t === "down" ? "손실" : "보합"}`}>
      <span aria-hidden="true">
        {arrowOf(pct)} {fmtPct(pct)}
      </span>
    </span>
  );
}

/** 매수·매도 표시(매수는 상승색, 매도는 하락색 — 글자와 함께) */
export function Side({ side }: { side: "BUY" | "SELL" }) {
  return <span className={`rec-side ${side === "BUY" ? "up" : "down"}`}>{side === "BUY" ? "매수" : "매도"}</span>;
}

/** 출처 문구: '자동(모의)' / '직접' */
export const sourceText = (e: Pick<JournalEntry, "source">) => (sourceOf(e) === "자동(모의)" ? "자동(모의)" : "직접");

/** 과정·감정 꼬리표(누르지 않는 표시). 경고는 아이콘 + 경고색 */
export function TagList({ tags, emotions = [], label }: { tags: Tag[]; emotions?: string[]; label?: string }) {
  if (!tags.length && !emotions.length) return null;
  return (
    <ul className="rec-tags" aria-label={label}>
      {tags.map((t) => (
        <li key={t.label} className={`rec-tag is-${t.tone}`}>
          {t.tone === "warn" ? <AlertTriangle size={12} strokeWidth={1.5} aria-hidden="true" /> : t.tone === "ok" ? <Check size={12} strokeWidth={1.5} aria-hidden="true" /> : null}
          {t.label}
        </li>
      ))}
      {emotions.map((e) => (
        <li key={`emo-${e}`} className="rec-tag is-emo">
          {e}
        </li>
      ))}
    </ul>
  );
}

/** 규칙 판정 문구: '규칙 지킴'(보조색 + 체크) / '위반 n건'(경고색 + 아이콘) */
export function Verdict({ v }: { v: { ok: boolean; text: string } | null }) {
  if (!v) return null;
  return (
    <span className={`rec-verdict ${v.ok ? "is-ok" : "is-warn"}`}>
      {v.ok ? <Check size={12} strokeWidth={1.5} aria-hidden="true" /> : <AlertTriangle size={12} strokeWidth={1.5} aria-hidden="true" />}
      {v.text}
    </span>
  );
}

/**
 * 감정 칩: 차분·조급·확신·불안(지도서 7.2 F) + '다른 감정'(욕심·두려움·희망 보유·복수 매매) + 직접 적기.
 * 다른 감정을 이미 골랐으면 펼친 채로 시작한다.
 */
export function EmotionPicker({ chips, text, onChips, onText, idBase }: { chips: string[]; text: string; onChips: (c: string[]) => void; onText: (t: string) => void; idBase: string }) {
  const [more, setMore] = useState(() => chips.some((c) => (EMOTIONS_MORE as readonly string[]).includes(c)));
  const toggle = (e: string) => onChips(chips.includes(e) ? chips.filter((c) => c !== e) : [...chips, e]);
  return (
    <div className="stack">
      <div className="ui-chips" role="group" aria-labelledby={`${idBase}-lbl`}>
        {EMOTIONS_MAIN.map((e) => (
          <Chip key={e} pressed={chips.includes(e)} onClick={() => toggle(e)}>
            {e}
          </Chip>
        ))}
        {more &&
          EMOTIONS_MORE.map((e) => (
            <Chip key={e} pressed={chips.includes(e)} onClick={() => toggle(e)}>
              {e}
            </Chip>
          ))}
        {!more && (
          <button type="button" className="ui-btn link rec-morelink" aria-expanded={false} onClick={() => setMore(true)}>
            다른 감정
          </button>
        )}
      </div>
      <input className="ui-input" value={text} onChange={(e) => onText(e.target.value)} placeholder="직접 적기(예: 손이 먼저 나갔어요)" aria-label="감정 직접 적기" maxLength={150} />
    </div>
  );
}

// ───────────────────────── 전략 고르기 ─────────────────────────

const CUSTOM = "__custom";
export const STRATEGY_OPTIONS: [string, string][] = [
  ...STRATEGIES.map((s): [string, string] => [s.name, `${s.name} · ${s.source}`]),
  ...(STRATEGIES.some((s) => s.name === PAPER_STRATEGY) ? [] : [[PAPER_STRATEGY, `${PAPER_STRATEGY} · 모의매매 규칙`] as [string, string]]),
];
const KNOWN = new Set(STRATEGY_OPTIONS.map(([v]) => v));

/** 전략: 목록에서 고르거나 직접 적기(값은 전략 이름 문자열) */
export function StrategyField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const [custom, setCustom] = useState(() => !!value && !KNOWN.has(value));
  const sel = custom ? CUSTOM : value;
  return (
    <div className="stack">
      <select
        id={id}
        className="ui-select"
        value={sel}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM) {
            setCustom(true);
            onChange("");
          } else {
            setCustom(false);
            onChange(v);
          }
        }}
      >
        <option value="">고르지 않음</option>
        {STRATEGY_OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        <option value={CUSTOM}>직접 적기</option>
      </select>
      {custom && <input className="ui-input" aria-label="전략 이름" value={value} maxLength={60} onChange={(e) => onChange(e.target.value)} placeholder="예: 눌림목 재진입" />}
    </div>
  );
}

// ───────────────────────── 종목 고르기 ─────────────────────────

/**
 * 종목 검색(이름·코드·티커) + 바로 고르기(모의계좌 보유·최근 기록·관심종목).
 * ↑↓로 고르고 Enter로 정한다. 6자리 코드나 티커를 그대로 넣어도 된다.
 */
export function StockSearch({ code, name, onPick, id, invalid }: { code: string; name: string; onPick: (code: string, name: string) => void; id: string; invalid?: boolean }) {
  const { watchlist, server, journal } = useApp();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();

  const quick = useMemo(() => {
    const out: { code: string; name: string }[] = [];
    const seen = new Set<string>();
    const add = (c: string, n: string) => !seen.has(c) && out.length < 6 && (seen.add(c), out.push({ code: c, name: n }));
    for (const p of [...(server?.paper.KRW.positions ?? []), ...(server?.paper.USD.positions ?? [])]) add(p.code, p.name);
    for (const e of [...journal].reverse()) add(e.code, e.name);
    const names = new Map((server?.latestScan?.candidates ?? []).map((c) => [c.code, c.name]));
    for (const c of watchlist) add(c, names.get(c) ?? c);
    return out;
  }, [watchlist, server, journal]);

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

  const pick = (c: string, n: string) => {
    onPick(c, n);
    setQ("");
    setResults([]);
    setOpen(false);
  };
  const submit = () => {
    const hit = results[active];
    if (hit) pick(hit.code, hit.name);
    else {
      const raw = q.trim().toUpperCase();
      if (isValidCode(raw)) pick(raw, raw);
    }
  };
  const showList = open && results.length > 0;

  return (
    <div className="stack">
      {code && (
        <div className="rec-picked" aria-live="polite">
          <span className="t-medium">{name || code}</span>
          <span className="t-cap">{code}</span>
        </div>
      )}
      <div className="rec-search" ref={wrap}>
        <Search size={16} strokeWidth={1.5} className="rec-search-ico" aria-hidden="true" />
        <input
          id={id}
          className="ui-input"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          placeholder={code ? "다른 종목 찾기" : "종목명·코드·티커(예: 삼성전자, 005930, AAPL)"}
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, results.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
            else if (e.key === "Enter") (e.preventDefault(), submit());
            else if (e.key === "Escape" && showList) (e.stopPropagation(), setOpen(false));
          }}
          onBlur={() => {
            // 목록을 고르지 않고 코드를 그대로 쳤으면 그 코드로 정한다
            const raw = q.trim().toUpperCase();
            if (raw && !results.length && isValidCode(raw)) pick(raw, raw);
          }}
        />
        {showList && (
          <ul className="rec-dropdown" role="listbox" id={listId} aria-label="검색 결과">
            {results.map((s, i) => (
              <li key={s.code} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => (e.preventDefault(), pick(s.code, s.name))} onMouseEnter={() => setActive(i)}>
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
        <div className="rec-quick" role="group" aria-label="최근·보유·관심 종목에서 고르기">
          {quick.map((x) => (
            <Chip key={x.code} pressed={x.code === code} onClick={() => pick(x.code, x.name)}>
              {x.name}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

/** CSV 내려받기(엑셀에서 한글이 깨지지 않게 BOM) */
export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
