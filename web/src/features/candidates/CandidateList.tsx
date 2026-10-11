import { useMemo, useState, type ReactNode } from "react";
import { dayTradeEvidence, regionOf, type DayTradeCandidate, type Evidence } from "@jusik/shared";
import { useActions } from "../../app/actions";
import { useApp } from "../../app/AppContext";
import { Change, EmptyState, EvidenceStrip, fmtPrice, ScoreBar, Sparkline, useBreakpoint } from "../../ui";

/*
 * 후보 목록(UI 지도서 5.1 F·7.2 A): 종목, 전략, 근거 스트립과 충족 개수, 점수.
 * 컴퓨터·태블릿은 표, 핸드폰은 카드 대신 목록 행. 행을 누르면 종목 분석으로 가고, '근거 보기'는 근거 시트를 연다.
 */

export interface CandidateRow {
  candidate: DayTradeCandidate;
  evidence: Evidence;
}

export function toRows(cands: DayTradeCandidate[]): CandidateRow[] {
  return cands.map((c) => ({ candidate: c, evidence: dayTradeEvidence(c) }));
}

type SortKey = "score" | "evidence" | "change";

export function CandidateList({ candidates, limit, sparks, showPrice = true, empty }: {
  candidates: DayTradeCandidate[];
  /** 앞에서부터 이만큼만(홈) */
  limit?: number;
  /** 종목별 작은 추세선 값(52주 종가 등). 있으면 열을 하나 더 그린다 */
  sparks?: Record<string, number[]>;
  showPrice?: boolean;
  empty?: ReactNode;
}) {
  const { openStock } = useApp();
  const { openEvidence } = useActions();
  const bp = useBreakpoint();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "score", desc: true });
  const rows = useMemo(() => {
    const r = toRows(candidates);
    const val = (x: CandidateRow) => (sort.key === "score" ? x.candidate.score : sort.key === "evidence" ? x.evidence.met : x.candidate.changePct);
    r.sort((a, b) => (val(b) - val(a)) * (sort.desc ? 1 : -1));
    return limit ? r.slice(0, limit) : r;
  }, [candidates, sort, limit]);

  if (!candidates.length) return <>{empty ?? <EmptyState title="아직 후보가 없어요">스캔하면 규칙에 맞는 후보가 여기에 나와요.</EmptyState>}</>;

  const open = (x: CandidateRow) => openEvidence({ title: `${x.candidate.name} 근거`, evidence: x.evidence, code: x.candidate.code, notes: x.candidate.notes });

  // 태블릿 세로(840 미만)까지는 표 대신 목록 행(표가 좁아 열이 한 글자씩 꺾인다)
  if (bp === "compact" || bp === "medium")
    return (
      <ul className="ui-rows" aria-label="후보 목록">
        {rows.map((x) => {
          const region = regionOf(x.candidate.market);
          return (
            <li key={x.candidate.code} className="ui-rowitem click" onClick={() => openStock(x.candidate.code)}>
              <div className="grow stack" style={{ gap: 4 }}>
                <div className="row between">
                  <span className="t-bold ellipsis">{x.candidate.name}</span>
                  <span className="t-2 nowrap">{x.evidence.strategyName}</span>
                </div>
                <div className="row between">
                  <EvidenceStrip evidence={x.evidence} onOpen={() => open(x)} />
                  {showPrice && (
                    <span className="row" style={{ gap: 8 }}>
                      <span className="num t-table">{fmtPrice(x.candidate.price, region)}</span>
                      <Change pct={x.candidate.changePct} showAbs={false} />
                    </span>
                  )}
                </div>
              </div>
              <span className="t-section num" aria-label={`점수 ${x.candidate.score}점`}>{x.candidate.score}</span>
            </li>
          );
        })}
      </ul>
    );

  const th = (key: SortKey, label: string, cls = "") => (
    <th className={cls} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button type="button" className="ui-sort" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        <thead>
          <tr>
            <th>종목</th>
            <th>전략</th>
            {th("evidence", "근거")}
            {showPrice && <th className="r">현재가</th>}
            {showPrice && th("change", "등락률", "r")}
            {sparks && <th>추세</th>}
            {th("score", "점수", "r")}
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const region = regionOf(x.candidate.market);
            return (
              <tr key={x.candidate.code} className="click" onClick={() => openStock(x.candidate.code)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openStock(x.candidate.code)}>
                <td>
                  <div className="stack" style={{ gap: 0 }}>
                    <span className="t-medium">{x.candidate.name}</span>
                    <span className="t-cap">{x.candidate.code}</span>
                  </div>
                </td>
                <td className="t-2">{x.evidence.headline || x.evidence.strategyName}</td>
                <td>
                  <EvidenceStrip evidence={x.evidence} onOpen={() => open(x)} />
                </td>
                {showPrice && <td className="r num">{fmtPrice(x.candidate.price, region)}</td>}
                {showPrice && (
                  <td className="r">
                    <Change pct={x.candidate.changePct} showAbs={false} />
                  </td>
                )}
                {sparks && <td>{sparks[x.candidate.code] ? <Sparkline values={sparks[x.candidate.code]!} /> : null}</td>}
                <td className="r">
                  <ScoreBar value={x.candidate.score} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
