import { AlertTriangle, Check, Info, X } from "lucide-react";
import type { Note } from "@jusik/shared";

/** 근거 규칙 꼬리표(예: "M3-05 설춘환"). 값이 없으면 아무것도 그리지 않는다 */
export function RuleTag({ rule }: { rule?: string | null }) {
  if (!rule) return null;
  return (
    <span className="t-cap" title="근거 규칙(기초 자료집 규칙 카탈로그)">
      {rule}
    </span>
  );
}

const ICON = { good: Check, bad: X, warn: AlertTriangle, info: Info } as const;
const WORD: Record<Note["tone"], string> = { good: "충족", bad: "위험", warn: "주의", info: "참고" };

/**
 * 근거 문장 목록. 충족(good)은 강조색 체크, 주의·위험은 경고색 아이콘 + 문장(빨강은 쓰지 않는다), 참고는 보조 글자색.
 * 규칙 번호가 있으면 문장 아래에 작게 붙인다.
 */
export function NoteList({ notes, dense = false }: { notes: Note[]; dense?: boolean }) {
  if (!notes.length) return null;
  return (
    <ul className="ui-ev-list">
      {notes.map((n, i) => {
        const Icon = ICON[n.tone];
        const cls = n.tone === "good" ? "met" : n.tone === "info" ? "na" : "unmet";
        return (
          <li key={i} style={dense ? { paddingTop: 4, paddingBottom: 4 } : undefined}>
            <Icon className={`mark ${cls}`} size={16} strokeWidth={2} aria-label={WORD[n.tone]} />
            <div className="stack" style={{ gap: 0 }}>
              <span className={n.tone === "bad" ? "t-medium" : ""}>{n.text}</span>
              <RuleTag rule={n.rule} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
