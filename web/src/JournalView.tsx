import { Fragment, useMemo, useState } from "react";
import { expectancy, parseNetPnl, regionOfCode, rMultiple, summarizeJournal, type Currency, type JournalEntry } from "@jusik/shared";
import { deleteJournal, patchJournal } from "./api";
import { moneyByCode, moneyByCurrency, num, pct, tone } from "./format";
import { composeEmotion, EmotionPicker, JournalForm, parseEmotion, today } from "./JournalForm";
import "./styles/journal.css";

const fmtR = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(2)}R`;
const COLS = 15;

function csvEscape(v: string | number | undefined): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(entries: JournalEntry[]) {
  const head = ["날짜", "종목코드", "종목명", "구분", "가격", "수량", "손절가", "목표가", "비중(%)", "전략", "청산 사유", "R 배수", "이유", "복기", "감정", "위반", "출처"];
  const rows = entries.map((e) => [
    e.date, e.code, e.name, e.side === "BUY" ? "매수" : "매도", e.price, e.qty, e.stop, e.target, e.weightPct, e.strategy, e.exitReason, e.rMultiple,
    e.reason, e.review, e.emotion, (e.violations ?? []).join(" / "), e.source ?? "수동",
  ]);
  const csv = [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `매매일지_${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** summarizeJournal과 같은 정렬: 날짜순, 같은 날은 매수 먼저 */
const chronological = (a: JournalEntry, b: JournalEntry) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1);

/**
 * R 배수가 저장되지 않은 매도 기록(직접 쓴 기록)에 선입선출 매수 기록의 손절가로 R을 계산해 붙인다.
 * 여러 매수분을 한 번에 팔면 수량으로 가중 평균한다. 손절가가 있는 매수분이 없으면 비워 둔다.
 */
function derivedR(entries: JournalEntry[]): Map<string, number> {
  const lots = new Map<string, { price: number; qty: number; stop?: number }[]>();
  const out = new Map<string, number>();
  for (const e of [...entries].sort(chronological)) {
    const q = lots.get(e.code) ?? [];
    lots.set(e.code, q);
    if (e.side === "BUY") {
      q.push({ price: e.price, qty: e.qty, stop: e.stop });
      continue;
    }
    let remain = e.qty, sum = 0, w = 0;
    while (remain > 0 && q.length) {
      const lot = q[0]!;
      const take = Math.min(lot.qty, remain);
      const r = rMultiple(lot.price, e.price, lot.stop);
      if (r != null) {
        sum += r * take;
        w += take;
      }
      lot.qty -= take;
      remain -= take;
      if (lot.qty === 0) q.shift();
    }
    if (e.rMultiple == null && w > 0) out.set(e.id, sum / w);
  }
  return out;
}

/** 모의매매 매도 기록 복기란의 순수익률 "(+1.23%)" — 모의투자 기간 추적이 읽는 형식(review.ts) */
const netPct = (s: string | undefined) => /\(([+-]?\d+(?:\.\d+)?)%\)/.exec(s ?? "")?.[1] ?? null;

function Summary({ cur, entries }: { cur: Currency; entries: JournalEntry[] }) {
  const sm = useMemo(() => summarizeJournal(entries), [entries]);
  const ev = sm.winRate != null && sm.avgWinPct != null && sm.avgLossPct != null ? expectancy({ winRate: sm.winRate, avgWinPct: sm.avgWinPct, avgLossPct: sm.avgLossPct }) : null;
  if (entries.length === 0) return null;
  const rCount = sm.rCount ?? 0;
  return (
    <>
      <h4 className="group">성과 · {cur === "KRW" ? "원화(국내)" : "달러(해외)"}</h4>
      <div className="metrics">
        <div className="metric"><span className="muted small">청산 거래</span><b>{sm.closed.length}회</b></div>
        <div className="metric"><span className="muted small">승률</span><b>{sm.winRate == null ? "-" : `${num(sm.winRate * 100, 0)}%`}</b></div>
        <div className="metric"><span className="muted small">평균 이익 / 손실</span><b>{sm.avgWinPct == null ? "-" : pct(sm.avgWinPct)} / {sm.avgLossPct == null ? "-" : pct(sm.avgLossPct)}</b></div>
        <div className="metric"><span className="muted small">실현 손익(수수료 제외)</span><b className={tone(sm.totalPnl)}>{moneyByCurrency(sm.totalPnl, cur)}</b></div>
        <div className="metric"><span className="muted small">거래당 기대값</span><b className={ev ? tone(ev.expectancyPct) : ""}>{ev ? pct(ev.expectancyPct) : "-"}</b></div>
        <div className="metric">
          <span className="muted small" title="R = (청산가 − 진입가) ÷ (진입가 − 계획 손절가). 1R은 계획한 1회 손실만큼이에요">평균 R</span>
          <b className={sm.avgR == null ? "" : tone(sm.avgR)}>{sm.avgR == null ? "-" : fmtR(sm.avgR)}</b>
        </div>
        <div className="metric"><span className="muted small">R 계산 거래 수</span><b>{rCount}건</b></div>
      </div>
      {sm.closed.length > 0 && sm.closed.length < 20 && <p className="muted small">표본이 {sm.closed.length}회라 승률·기대값은 참고만 하세요.</p>}
      {sm.closed.length > rCount && <p className="muted small">R은 매수 기록에 손절가가 있는 청산 거래만 계산해요(청산 {sm.closed.length}회 중 {rCount}회).</p>}
      {sm.oversold && <p className="warn">보유 수량보다 많이 판 기록이 있어요. 입력을 확인해 주세요.</p>}
      {sm.open.length > 0 && <p className="small">보유 중: {sm.open.map((o) => `${o.name} ${o.qty.toLocaleString()}주(평단 ${moneyByCode(o.avgPrice, o.code)})`).join(", ")}</p>}
    </>
  );
}

interface Edit {
  id: string;
  review: string;
  chips: string[];
  text: string;
}

function EditRow({ entry, edit, setEdit, onSaved }: { entry: JournalEntry; edit: Edit; setEdit: (e: Edit | null) => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 자동(모의) 매도 기록의 복기란에는 집계가 읽는 순손익 문구가 들어 있다
  const autoSell = entry.source === "자동(모의)" && entry.side === "SELL";

  const save = async () => {
    // 자동 기록의 순손익·순수익률 문구는 일일 복기·모의투자 집계가 읽으므로 숫자가 바뀌면 저장하지 않는다
    if (autoSell && (parseNetPnl(entry.review) !== parseNetPnl(edit.review) || netPct(entry.review) !== netPct(edit.review))) {
      setErr("자동 기록의 순손익 문구가 바뀌었어요. 그 부분은 그대로 두고 앞뒤에 덧붙여 주세요.");
      return;
    }
    setBusy(true);
    try {
      await patchJournal(edit.id, { review: edit.review, emotion: composeEmotion(edit.chips, edit.text) });
      setEdit(null);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="jr-edit-row">
      <td colSpan={COLS}>
        <div className="jr-edit">
          <label className="jr-field">
            복기 메모 — {entry.name} {entry.side === "BUY" ? "매수" : "매도"} ({entry.date})
            <textarea className="jr-textarea" value={edit.review} maxLength={1000} onChange={(e) => setEdit({ ...edit, review: e.target.value })} placeholder="계획대로 했나요? 다음엔 무엇을 바꿀까요?" />
          </label>
          {autoSell && <p className="muted small">자동 기록의 순손익 문구는 일일 복기·모의투자 집계에 쓰여요. 그 부분은 그대로 두고 덧붙여 주세요.</p>}
          <div className="jr-field">
            <span>감정</span>
            <EmotionPicker chips={edit.chips} text={edit.text} onChips={(chips) => setEdit({ ...edit, chips })} onText={(text) => setEdit({ ...edit, text })} />
          </div>
          {err && <p className="warn">{err}</p>}
          <div className="jr-actions">
            <button className="primary small-btn" onClick={save} disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
            <button className="link" onClick={() => setEdit(null)} disabled={busy}>취소</button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function EntryRow({ e, r, editing, onEdit, onChanged }: { e: JournalEntry; r: { value: number; derived: boolean } | null; editing: boolean; onEdit: () => void; onChanged: () => void }) {
  const v = e.violations ?? [];
  return (
    <tr className={editing ? "jr-editing" : ""}>
      <td>{e.date}</td><td className="left">{e.name} <span className="muted small">{e.code}</span></td>
      <td className={e.side === "BUY" ? "up" : "down"}>{e.side === "BUY" ? "매수" : "매도"}</td>
      <td>{moneyByCode(e.price, e.code)}</td><td>{e.qty.toLocaleString()}</td>
      <td>{e.stop != null ? moneyByCode(e.stop, e.code) : "-"}</td>
      <td>{e.target != null ? moneyByCode(e.target, e.code) : "-"}</td>
      <td className={r ? tone(r.value) : "muted"} title={r?.derived ? "매수 기록의 계획 손절가로 계산했어요" : r ? undefined : e.side === "SELL" ? "매수 기록에 손절가가 있어야 계산돼요" : undefined}>
        {r ? fmtR(r.value) : "-"}
      </td>
      <td className="small">{e.strategy ?? "-"}</td>
      <td className="small">{e.side === "SELL" ? e.exitReason ?? "-" : ""}</td>
      <td className="left jr-wide">{e.reason}{e.review && <div className="muted small">{e.review}</div>}</td>
      <td className="left small">{e.emotion ?? <span className="muted">-</span>}</td>
      <td>
        {v.length > 0 ? <span className="jr-viol" title={v.join("\n")} aria-label={`위반 ${v.length}건: ${v.join(", ")}`}>{v.length}</span> : <span className="muted">-</span>}
      </td>
      <td className="small">{e.source ?? "수동"}</td>
      <td>
        <div className="jr-row-actions">
          <button className="link small" onClick={onEdit} disabled={editing} title="복기 메모와 감정 고치기">수정</button>
          <button className="icon-btn" aria-label="기록 삭제" onClick={() => confirm("이 기록을 삭제할까요?") && deleteJournal(e.id).then(onChanged)}>×</button>
        </div>
      </td>
    </tr>
  );
}

export function JournalView({ entries, defaultCode, onChanged }: { entries: JournalEntry[]; defaultCode: string | null; onChanged: () => void }) {
  const [edit, setEdit] = useState<Edit | null>(null);

  const sorted = useMemo(() => [...entries].sort((a, b) => b.date.localeCompare(a.date)), [entries]);
  const krw = useMemo(() => entries.filter((e) => regionOfCode(e.code) === "KR"), [entries]);
  const usd = useMemo(() => entries.filter((e) => regionOfCode(e.code) === "US"), [entries]);
  const rDerived = useMemo(() => derivedR(entries), [entries]);

  const rOf = (e: JournalEntry) => {
    if (e.rMultiple != null) return { value: e.rMultiple, derived: false };
    const d = rDerived.get(e.id);
    return d != null ? { value: d, derived: true } : null;
  };
  const startEdit = (e: JournalEntry) => {
    const p = parseEmotion(e.emotion);
    setEdit({ id: e.id, review: e.review ?? "", chips: p.chips, text: p.text });
  };

  return (
    <div className="card">
      <h3 className="h3">매매일지 <span className="muted small">— 모의매매는 자동으로 기록되고, 실제로 직접 매매한 내용은 여기에 직접 적어요</span></h3>
      <JournalForm entries={entries} defaultCode={defaultCode} onChanged={onChanged} />

      <Summary cur="KRW" entries={krw} />
      <Summary cur="USD" entries={usd} />

      <h4 className="group">기록 <button className="link" disabled={!entries.length} onClick={() => downloadCsv(sorted)}>CSV 내보내기</button></h4>
      <div className="table-wrap tall">
        <table className="trades journal">
          <thead>
            <tr>
              <th>날짜</th><th className="left">종목</th><th>구분</th><th>가격</th><th>수량</th><th>손절가</th><th>목표가</th>
              <th title="손실 단위 배수 = (청산가 − 진입가) ÷ (진입가 − 계획 손절가)">R</th><th>전략</th><th>청산 사유</th>
              <th className="left">이유 / 복기</th><th className="left">감정</th><th title="주문 전 체크리스트에서 어긴 항목 수(마우스를 올리면 내용)">위반</th><th>출처</th><th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <Fragment key={e.id}>
                <EntryRow e={e} r={rOf(e)} editing={edit?.id === e.id} onEdit={() => startEdit(e)} onChanged={onChanged} />
                {edit?.id === e.id && <EditRow entry={e} edit={edit} setEdit={setEdit} onSaved={onChanged} />}
              </Fragment>
            ))}
            {sorted.length === 0 && <tr><td colSpan={COLS} className="muted">아직 기록이 없어요. 모의매매를 켜면 진입·청산이 이유와 함께 자동으로 쌓여요.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
