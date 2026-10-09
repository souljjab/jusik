import { useMemo, useState } from "react";
import { expectancy, regionOfCode, summarizeJournal, type Currency, type JournalEntry } from "@jusik/shared";
import { addJournal, deleteJournal } from "./api";
import { moneyByCode, moneyByCurrency, num, pct, tone } from "./format";

const today = () => new Date().toISOString().slice(0, 10);

function csvEscape(v: string | number | undefined): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(entries: JournalEntry[]) {
  const head = ["날짜", "종목코드", "종목명", "구분", "가격", "수량", "손절가", "이유", "복기", "출처"];
  const rows = entries.map((e) => [e.date, e.code, e.name, e.side === "BUY" ? "매수" : "매도", e.price, e.qty, e.stop, e.reason, e.review, e.source ?? "수동"]);
  const csv = [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `매매일지_${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Summary({ cur, entries }: { cur: Currency; entries: JournalEntry[] }) {
  const sm = useMemo(() => summarizeJournal(entries), [entries]);
  const ev = sm.winRate != null && sm.avgWinPct != null && sm.avgLossPct != null ? expectancy({ winRate: sm.winRate, avgWinPct: sm.avgWinPct, avgLossPct: sm.avgLossPct }) : null;
  if (entries.length === 0) return null;
  return (
    <>
      <h4 className="group">성과 · {cur === "KRW" ? "원화(국내)" : "달러(해외)"}</h4>
      <div className="metrics">
        <div className="metric"><span className="muted small">청산 거래</span><b>{sm.closed.length}회</b></div>
        <div className="metric"><span className="muted small">승률</span><b>{sm.winRate == null ? "-" : `${num(sm.winRate * 100, 0)}%`}</b></div>
        <div className="metric"><span className="muted small">평균 이익 / 손실</span><b>{sm.avgWinPct == null ? "-" : pct(sm.avgWinPct)} / {sm.avgLossPct == null ? "-" : pct(sm.avgLossPct)}</b></div>
        <div className="metric"><span className="muted small">실현 손익(수수료 제외)</span><b className={tone(sm.totalPnl)}>{moneyByCurrency(sm.totalPnl, cur)}</b></div>
        <div className="metric"><span className="muted small">거래당 기대값</span><b className={ev ? tone(ev.expectancyPct) : ""}>{ev ? pct(ev.expectancyPct) : "-"}</b></div>
      </div>
      {sm.closed.length > 0 && sm.closed.length < 20 && <p className="muted small">표본이 {sm.closed.length}회라 승률·기대값은 참고만 하세요.</p>}
      {sm.oversold && <p className="warn">보유 수량보다 많이 판 기록이 있어요. 입력을 확인해 주세요.</p>}
      {sm.open.length > 0 && <p className="small">보유 중: {sm.open.map((o) => `${o.name} ${o.qty.toLocaleString()}주(평단 ${moneyByCode(o.avgPrice, o.code)})`).join(", ")}</p>}
    </>
  );
}

export function JournalView({ entries, defaultCode, onChanged }: { entries: JournalEntry[]; defaultCode: string | null; onChanged: () => void }) {
  const [code, setCode] = useState(defaultCode ?? "");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [stop, setStop] = useState("");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState("");
  const [err, setErr] = useState("");

  const sorted = useMemo(() => [...entries].sort((a, b) => b.date.localeCompare(a.date)), [entries]);
  const krw = useMemo(() => entries.filter((e) => regionOfCode(e.code) === "KR"), [entries]);
  const usd = useMemo(() => entries.filter((e) => regionOfCode(e.code) === "US"), [entries]);

  const add = async () => {
    try {
      await addJournal({ code: code.trim().toUpperCase(), side, price: Number(price), qty: Number(qty), date, stop: stop ? Number(stop) : undefined, reason, review: review || undefined });
      setErr("");
      setReview("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card">
      <h3 className="h3">매매일지 <span className="muted small">— 모의매매는 자동으로 기록되고, 실제로 직접 매매한 내용은 여기에 직접 적어요</span></h3>
      <div className="form">
        <label>종목코드·티커<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="005930 / AAPL" /></label>
        <label>구분<select value={side} onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}><option value="BUY">매수</option><option value="SELL">매도</option></select></label>
        <label>날짜<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>가격<input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label>수량(주)<input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label>계획한 손절가<input type="number" min={0} step="any" value={stop} onChange={(e) => setStop(e.target.value)} /></label>
      </div>
      <div className="form one">
        <label>매매 이유<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="무슨 근거로 샀/팔았나요?" /></label>
        <label>복기 메모<input value={review} onChange={(e) => setReview(e.target.value)} placeholder="계획대로 했나요? 감정은? 다음엔 무엇을 바꿀까요?" /></label>
      </div>
      {err && <p className="warn">{err}</p>}
      <button className="primary" onClick={add}>기록 추가</button>

      <Summary cur="KRW" entries={krw} />
      <Summary cur="USD" entries={usd} />

      <h4 className="group">기록 <button className="link" disabled={!entries.length} onClick={() => downloadCsv(sorted)}>CSV 내보내기</button></h4>
      <div className="table-wrap tall">
        <table className="trades journal">
          <thead><tr><th>날짜</th><th className="left">종목</th><th>구분</th><th>가격</th><th>수량</th><th>손절가</th><th className="left">이유 / 복기</th><th>출처</th><th /></tr></thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td><td className="left">{e.name} <span className="muted small">{e.code}</span></td>
                <td className={e.side === "BUY" ? "up" : "down"}>{e.side === "BUY" ? "매수" : "매도"}</td>
                <td>{moneyByCode(e.price, e.code)}</td><td>{e.qty.toLocaleString()}</td><td>{e.stop != null ? moneyByCode(e.stop, e.code) : "-"}</td>
                <td className="left">{e.reason}{e.review && <div className="muted small">{e.review}</div>}</td>
                <td className="small">{e.source ?? "수동"}</td>
                <td><button className="icon-btn" aria-label="기록 삭제" onClick={() => confirm("이 기록을 삭제할까요?") && deleteJournal(e.id).then(onChanged)}>×</button></td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={9} className="muted">아직 기록이 없어요. 모의매매를 켜면 진입·청산이 이유와 함께 자동으로 쌓여요.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
