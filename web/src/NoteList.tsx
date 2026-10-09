import type { Note } from "@jusik/shared";

const ICON: Record<Note["tone"], string> = { good: "✔", bad: "✖", warn: "⚠", info: "ℹ" };

export function NoteList({ notes }: { notes: Note[] }) {
  return (
    <ul className="notes">
      {notes.map((n, i) => (
        <li key={i} className={`note-${n.tone}`}>
          <span aria-hidden>{ICON[n.tone]}</span> {n.text}
        </li>
      ))}
    </ul>
  );
}
