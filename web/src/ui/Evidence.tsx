import { Check, Minus, X } from "lucide-react";
import type { Evidence, EvidenceCell, EvidenceState } from "@jusik/shared";

const STATE_WORD: Record<EvidenceState, string> = { met: "충족", unmet: "미충족", na: "데이터 없음" };

/** 근거 개수 문장(화면 낭독·보조 문구): "근거 6개 중 4개 충족, 1개 데이터 없음" */
export function evidenceSummary(ev: Pick<Evidence, "cells" | "met" | "total">): string {
  const na = ev.cells.filter((c) => c.state === "na").length;
  return `근거 ${ev.total}개 중 ${ev.met}개 충족${na ? `, ${na}개 데이터 없음` : ""}`;
}

/**
 * 근거 스트립(UI 지도서 1.2 시그니처). 규칙 하나당 한 칸: 채움 = 충족, 빈칸 = 미충족, 점선 = 데이터 없음.
 * 칸 크기는 핸드폰에서도 줄이지 않고 개수(4/6)를 함께 쓴다. onOpen이 있으면 '근거 보기'를 붙인다.
 */
export function EvidenceStrip({ evidence, size = "sm", onOpen, showCount = true, className = "", subject }: {
  evidence: Pick<Evidence, "cells" | "met" | "total">;
  size?: "sm" | "md";
  onOpen?: () => void;
  showCount?: boolean;
  className?: string;
  /** 무엇의 근거인지(종목명 등). 화면 낭독에서 '근거 보기: 한빛반도체'처럼 버튼마다 이름이 달라진다 */
  subject?: string;
}) {
  const label = evidenceSummary(evidence);
  return (
    <span className={`ui-ev ${size} ${className}`}>
      <span className="ui-ev-cells" role="img" aria-label={label}>
        {evidence.cells.map((c) => (
          <span key={c.id} className={`ui-ev-cell ${c.state}`} title={`${c.label}: ${STATE_WORD[c.state]}`} />
        ))}
      </span>
      {showCount && (
        <span className="ui-ev-count" aria-hidden="true">
          {evidence.met}/{evidence.total}
        </span>
      )}
      {onOpen && (
        <button type="button" className="ui-btn link ui-ev-open" aria-label={subject ? `근거 보기: ${subject}` : undefined} onClick={(e) => (e.stopPropagation(), onOpen())}>
          근거 보기
        </button>
      )}
    </span>
  );
}

/** 칸 이름까지 보이는 큰 스트립(그림 1의 구조) */
export function EvidenceStripFull({ evidence }: { evidence: Pick<Evidence, "cells" | "met" | "total"> }) {
  return (
    <div className="stack">
      <div className="row between">
        <span className="t-2">{evidenceSummary(evidence)}</span>
        <span className="ui-ev-count">
          {evidence.met}/{evidence.total}
        </span>
      </div>
      <div className="ui-ev-full" style={{ ["--n" as string]: evidence.cells.length }}>
        {evidence.cells.map((c) => (
          <div key={c.id} className={`cell ${c.state}`}>
            <span className="bar" aria-hidden="true" />
            <span className="lbl">{c.label}</span>
            <span className="st">{STATE_WORD[c.state]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const MARK = { met: Check, unmet: X, na: Minus } as const;

/** 규칙별 충족 여부 목록(근거 패널·근거 보기 시트): 규칙 이름, 실제 값, 출처 */
export function EvidenceList({ cells }: { cells: EvidenceCell[] }) {
  return (
    <ul className="ui-ev-list">
      {cells.map((c) => {
        const Icon = MARK[c.state];
        return (
          <li key={c.id}>
            <Icon className={`mark ${c.state}`} size={16} strokeWidth={2} aria-label={STATE_WORD[c.state]} />
            <div className="stack" style={{ gap: 2 }}>
              <span className="name">{c.label}</span>
              <span className="t-2">{c.detail}</span>
              {c.rule && <span className="rule">{c.rule}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
