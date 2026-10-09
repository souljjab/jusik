import { useMemo, useState } from "react";
import { ACTION_LABEL, expectancy, REGIME_LABEL, STAGE_LABEL, summarizeJournal, type Analysis, type JournalEntry } from "@jusik/shared";
import type { StockData } from "./api";
import { num, pct, tone, won } from "./format";

const today = () => new Date().toISOString().slice(0, 10);

function autoReason(a: Analysis | null): string {
  if (!a) return "";
  const parts = [STAGE_LABEL[a.timing.stage], `주봉 신호 ${ACTION_LABEL[a.timingAction]}`];
  if (a.regime) parts.push(`시장 ${REGIME_LABEL[a.regime.regime]}`);
  if (a.screening.grade !== "N/A") parts.push(`재무 ${a.screening.grade}등급`);
  return parts.join(" · ");
}

function csvEscape(v: string | number | undefined): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(entries: JournalEntry[]) {
  const head = ["날짜", "종목코드", "종목명", "구분", "가격", "수량", "손절가", "매매 이유", "복기"];
  const rows = entries.map((e) => [e.date, e.code, e.name, e.side === "BUY" ? "매수" : "매도", e.price, e.qty, e.stop, e.reason, e.review]);
  const csv = [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `매매일지_${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function JournalTab({ data, entries, onChange }: { data: StockData; entries: JournalEntry[]; onChange: (e: JournalEntry[]) => void }) {
  const a = data.analysis;
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState(String(data.quote.price));
  const [qty, setQty] = useState("1");
  const [stop, setStop] = useState(a ? String(Math.round(a.timing.stopLoss)) : "");
  const [reason, setReason] = useState(autoReason(a));
  const [review, setReview] = useState("");
  const [err, setErr] = useState("");

  const summary = useMemo(() => summarizeJournal(entries), [entries]);
  const ev = summary.winRate != null && summary.avgWinPct != null && summary.avgLossPct != null ? expectancy({ winRate: summary.winRate, avgWinPct: summary.avgWinPct, avgLossPct: summary.avgLossPct }) : null;

  const add = () => {
    const p = Number(price), q = Number(qty);
    if (!(p > 0) || !(q > 0) || !Number.isInteger(q)) return setErr("가격은 0보다 크고, 수량은 1 이상의 정수여야 해요.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr("날짜를 확인해 주세요.");
    const held = summary.open.find((o) => o.code === data.info.code)?.qty ?? 0;
    if (side === "SELL" && q > held && !confirm(`보유 수량(${held}주)보다 많이 팔았다고 기록하려고 해요. 그래도 저장할까요?`)) return;
    setErr("");
    const entry: JournalEntry = {
      id: crypto.randomUUID(), code: data.info.code, name: data.info.name, date, side, price: p, qty: q,
      stop: stop ? Number(stop) : undefined, reason: reason.trim(), review: review.trim() || undefined,
    };
    onChange([...entries, entry]);
    setReview("");
  };

  const sorted = [...entries].sort((x, y) => y.date.localeCompare(x.date));

  return (
    <div className="card">
      <h3 className="h3">매매일지 <span className="muted small">— {data.info.name}에 기록해요 · 이 브라우저에만 저장돼요</span></h3>
      <div className="form">
        <label>구분
          <select value={side} onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}>
            <option value="BUY">매수</option><option value="SELL">매도</option>
          </select>
        </label>
        <label>날짜<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>가격(원)<input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label>수량(주)<input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label>계획한 손절가<input type="number" min={0} value={stop} onChange={(e) => setStop(e.target.value)} /></label>
      </div>
      <div className="form one">
        <label>매매 이유<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="무슨 근거로 샀/팔았나요?" /></label>
        <label>복기 메모<input value={review} onChange={(e) => setReview(e.target.value)} placeholder="계획대로 했나요? 감정은? 다음엔 무엇을 바꿀까요?" /></label>
      </div>
      {err && <p className="warn">{err}</p>}
      <button className="primary" onClick={add}>기록 추가</button>

      <h4 className="group">성과 요약</h4>
      <div className="metrics">
        <div className="metric"><span className="muted small">청산 거래</span><b>{summary.closed.length}회</b></div>
        <div className="metric"><span className="muted small">승률</span><b>{summary.winRate == null ? "-" : `${num(summary.winRate * 100, 0)}%`}</b></div>
        <div className="metric"><span className="muted small">평균 이익 / 손실</span><b>{summary.avgWinPct == null ? "-" : pct(summary.avgWinPct)} / {summary.avgLossPct == null ? "-" : pct(summary.avgLossPct)}</b></div>
        <div className="metric"><span className="muted small">실현 손익</span><b className={tone(summary.totalPnl)}>{won(summary.totalPnl)}</b></div>
        <div className="metric"><span className="muted small">거래당 기대값</span><b className={ev ? tone(ev.expectancyPct) : ""}>{ev ? pct(ev.expectancyPct) : "-"}</b></div>
      </div>
      {summary.closed.length > 0 && summary.closed.length < 20 && <p className="muted small">표본이 {summary.closed.length}회라 승률·기대값은 참고만 하세요(수수료·세금은 포함하지 않았어요).</p>}
      {summary.oversold && <p className="warn">보유 수량보다 많이 판 기록이 있어요. 입력을 확인해 주세요.</p>}
      {summary.open.length > 0 && (
        <p className="small">보유 중: {summary.open.map((o) => `${o.name} ${o.qty.toLocaleString()}주(평단 ${won(o.avgPrice)})`).join(", ")}</p>
      )}

      <h4 className="group">기록 <button className="link" disabled={!entries.length} onClick={() => downloadCsv(sorted)}>CSV 내보내기</button></h4>
      <div className="table-wrap">
        <table className="trades journal">
          <thead><tr><th>날짜</th><th>종목</th><th>구분</th><th>가격</th><th>수량</th><th>손절가</th><th className="left">이유 / 복기</th><th /></tr></thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td><td>{e.name}</td>
                <td className={e.side === "BUY" ? "up" : "down"}>{e.side === "BUY" ? "매수" : "매도"}</td>
                <td>{e.price.toLocaleString()}</td><td>{e.qty.toLocaleString()}</td><td>{e.stop?.toLocaleString() ?? "-"}</td>
                <td className="left">{e.reason}{e.review && <div className="muted small">복기: {e.review}</div>}</td>
                <td><button className="icon-btn" aria-label="기록 삭제" onClick={() => confirm("이 기록을 삭제할까요?") && onChange(entries.filter((x) => x.id !== e.id))}>×</button></td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={8} className="muted">아직 기록이 없어요. 매매할 때마다 이유를 남기고, 나중에 계획대로 했는지 복기해 보세요.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
