import type { Note } from "@jusik/shared";
import "./styles/analysis.css";

const ICON: Record<Note["tone"], string> = { good: "✔", bad: "✖", warn: "⚠", info: "ℹ" };

/** 근거 규칙 꼬리표(예: "M3-05 설춘환"). 값이 없으면 아무것도 그리지 않는다 */
export function RuleTag({ rule }: { rule?: string | null }) {
  if (!rule) return null;
  return (
    <span className="an-rule" title="근거 규칙(자료집 부록 A)">
      {rule}
    </span>
  );
}

export function NoteList({ notes }: { notes: Note[] }) {
  return (
    <ul className="notes">
      {notes.map((n, i) => (
        <li key={i} className={`note-${n.tone}`}>
          <span aria-hidden>{ICON[n.tone]}</span> {n.text}
          {n.rule && <> <RuleTag rule={n.rule} /></>}
        </li>
      ))}
    </ul>
  );
}
