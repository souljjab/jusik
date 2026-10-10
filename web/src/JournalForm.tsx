import { useMemo, useState } from "react";
import { averagingDownCheck, PAPER_STRATEGY, preTradeChecklist, STRATEGIES, type JournalCheck, type JournalEntry, type Note } from "@jusik/shared";
import { addJournal } from "./api";
import { moneyByCode } from "./format";
import { NoteList } from "./NoteList";
import "./styles/journal.css";

export const today = () => new Date().toISOString().slice(0, 10);

// ---- 감정 메모(5.5 심리 규칙에 나오는 위험 감정) ----
export const EMOTIONS = ["차분", "조급함", "욕심", "두려움", "희망 보유", "복수 매매"] as const;

/** 저장된 감정 문자열("조급함, 메모")을 칩과 직접 적은 글로 나눈다 */
export function parseEmotion(v: string | undefined): { chips: string[]; text: string } {
  const parts = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const known = new Set<string>(EMOTIONS);
  return { chips: parts.filter((p) => known.has(p)), text: parts.filter((p) => !known.has(p)).join(", ") };
}

export const composeEmotion = (chips: string[], text: string) => [...EMOTIONS.filter((e) => chips.includes(e)), text.trim()].filter(Boolean).join(", ");

export function EmotionPicker({ chips, text, onChips, onText }: { chips: string[]; text: string; onChips: (c: string[]) => void; onText: (t: string) => void }) {
  return (
    <div className="jr-emos">
      {EMOTIONS.map((e) => {
        const on = chips.includes(e);
        return (
          <button key={e} type="button" className="jr-emo" aria-pressed={on} onClick={() => onChips(on ? chips.filter((c) => c !== e) : [...chips, e])}>{e}</button>
        );
      })}
      <input className="jr-emo-text" value={text} onChange={(ev) => onText(ev.target.value)} placeholder="직접 적기" aria-label="감정 직접 적기" maxLength={150} />
    </div>
  );
}

// ---- 전략·청산 사유 ----
const CUSTOM = "__custom";
const STRATEGY_OPTIONS: [string, string][] = [
  ...STRATEGIES.map((s): [string, string] => [s.name, `${s.name} · ${s.source}`]),
  ...(STRATEGIES.some((s) => s.name === PAPER_STRATEGY) ? [] : [[PAPER_STRATEGY, `${PAPER_STRATEGY} · 모의매매 규칙`] as [string, string]]),
];
export const EXIT_REASONS = ["목표 도달", "손절", "시간 청산", "추적 손절", "재량", "기타"] as const;

/** 빈칸은 undefined, 숫자가 아니면 NaN(체크리스트가 '미입력'으로 본다) */
const optNum = (s: string) => (s.trim() === "" ? undefined : Number(s));

function PreTradeChecklist({ notes }: { notes: Note[] }) {
  const must = notes.filter((n) => n.tone === "bad").length;
  return (
    <div className={`jr-check${must === 0 ? " jr-ok" : ""}`}>
      <h4>
        주문 전 체크리스트
        <span className="muted small">— 손절가·목표가·근거·비중을 먼저 적고, 손실 중 추가 매수를 점검해요 (5.5 헬로마녀·박용선, M4-02 캔들마스터)</span>
      </h4>
      {must === 0 && <NoteList notes={[{ tone: "good", text: "필수 항목을 모두 채웠어요. 계획대로 매매해요." }]} />}
      {notes.length > 0 && <NoteList notes={notes} />}
      {must > 0 && <p className="muted small">저장을 막지는 않아요. ✖ 항목을 고치지 않고 저장하면 기록에 위반으로 남아요.</p>}
    </div>
  );
}

function SaveResult({ entry, check, onClose }: { entry: JournalEntry; check: JournalCheck; onClose: () => void }) {
  const others = check.notes.filter((n) => n.tone !== "bad");
  return (
    <div className="jr-result" role="status">
      <p>
        <b>저장했어요</b> — {entry.name} <span className="muted small">{entry.code}</span> {entry.side === "BUY" ? "매수" : "매도"} {moneyByCode(entry.price, entry.code)} × {entry.qty.toLocaleString()}주
      </p>
      {check.violations.length > 0 && (
        <>
          <p className="note-bad">기록에 위반으로 남겼어요 ({check.violations.length}건). 복기할 때 다시 봐요.</p>
          <NoteList notes={check.notes.filter((n) => n.tone === "bad")} />
        </>
      )}
      {others.length > 0 && <NoteList notes={others} />}
      {entry.side === "BUY" && check.notes.length === 0 && <p className="note-good">주문 전 체크리스트를 모두 지켰어요.</p>}
      <button className="link small" onClick={onClose}>닫기</button>
    </div>
  );
}

export function JournalForm({ entries, defaultCode, onChanged }: { entries: JournalEntry[]; defaultCode: string | null; onChanged: () => void }) {
  const [code, setCode] = useState(defaultCode ?? "");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [weight, setWeight] = useState("");
  const [strategy, setStrategy] = useState("");
  const [customStrategy, setCustomStrategy] = useState("");
  const [exitReason, setExitReason] = useState("");
  const [exitDetail, setExitDetail] = useState("");
  const [emoChips, setEmoChips] = useState<string[]>([]);
  const [emoText, setEmoText] = useState("");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ entry: JournalEntry; check: JournalCheck } | null>(null);

  const normCode = code.trim().toUpperCase();

  // 매수일 때만: 서버가 저장할 때 하는 점검과 같은 함수로 미리 보여 준다
  const checklist = useMemo<Note[]>(() => {
    if (side !== "BUY") return [];
    const p = optNum(price);
    const notes = preTradeChecklist({ stop: optNum(stop), target: optNum(target), reason, price: p, weightPct: optNum(weight) });
    // 모의계좌(자동) 보유분은 내 실제 보유가 아니라서 직접 쓴 기록끼리만 본다(서버 점검과 같은 기준)
    const manual = entries.filter((e) => (e.source ?? "수동") === "수동");
    if (normCode && p != null && p > 0) notes.push(...averagingDownCheck(manual, { code: normCode, side: "BUY", price: p, date }).notes);
    return notes;
  }, [side, price, stop, target, reason, weight, normCode, date, entries]);

  const strategyValue = strategy === CUSTOM ? customStrategy.trim() : strategy;
  const exitValue = side !== "SELL" || !exitReason ? "" : exitReason === "기타" && exitDetail.trim() ? `기타: ${exitDetail.trim()}`.slice(0, 60) : exitReason;

  const add = async () => {
    setBusy(true);
    try {
      const res = await addJournal({
        code: normCode, side, price: Number(price), qty: Number(qty), date,
        stop: optNum(stop), target: optNum(target), weightPct: optNum(weight),
        reason, review: review || undefined,
        strategy: strategyValue || undefined,
        emotion: composeEmotion(emoChips, emoText) || undefined,
        exitReason: exitValue || undefined,
      });
      setErr("");
      setSaved(res);
      // 다음 기록을 위해 거래마다 달라지는 칸을 비운다(종목·구분·날짜·전략은 둔다)
      setPrice("");
      setStop("");
      setTarget("");
      setWeight("");
      setReason("");
      setReview("");
      setExitReason("");
      setExitDetail("");
      setEmoChips([]);
      setEmoText("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="form">
        <label>종목코드·티커<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="005930 / AAPL" /></label>
        <label>구분<select value={side} onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}><option value="BUY">매수</option><option value="SELL">매도</option></select></label>
        <label>날짜<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>가격<input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label>수량(주)<input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label>계획한 손절가<input type="number" min={0} step="any" value={stop} onChange={(e) => setStop(e.target.value)} /></label>
        <label>목표가<input type="number" min={0} step="any" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <label>비중(%)<input type="number" min={0} max={100} step="any" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="계좌 대비" /></label>
        <label>
          전략
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            <option value="">선택 안 함</option>
            {STRATEGY_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            <option value={CUSTOM}>직접 입력</option>
          </select>
        </label>
        {strategy === CUSTOM && <label>전략 이름<input value={customStrategy} maxLength={60} onChange={(e) => setCustomStrategy(e.target.value)} placeholder="예: 눌림목 재진입" /></label>}
        {side === "SELL" && (
          <label>
            청산 사유
            <select value={exitReason} onChange={(e) => setExitReason(e.target.value)}>
              <option value="">선택 안 함</option>
              {EXIT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        {side === "SELL" && exitReason === "기타" && <label>기타 사유<input value={exitDetail} maxLength={50} onChange={(e) => setExitDetail(e.target.value)} placeholder="짧게 적어요" /></label>}
      </div>
      <div className="form one">
        <label>매매 이유<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="무슨 근거로 샀/팔았나요?" /></label>
        <div className="jr-field">
          <span>감정 <span className="small">— 그때 마음을 골라요(여러 개 가능)</span></span>
          <EmotionPicker chips={emoChips} text={emoText} onChips={setEmoChips} onText={setEmoText} />
        </div>
        <label>복기 메모<input value={review} onChange={(e) => setReview(e.target.value)} placeholder="계획대로 했나요? 다음엔 무엇을 바꿀까요?" /></label>
      </div>

      {side === "BUY" && <PreTradeChecklist notes={checklist} />}
      {err && <p className="warn">{err}</p>}
      <button className="primary" onClick={add} disabled={busy}>{busy ? "저장 중…" : "기록 추가"}</button>
      {saved && <SaveResult entry={saved.entry} check={saved.check} onClose={() => setSaved(null)} />}
    </>
  );
}
