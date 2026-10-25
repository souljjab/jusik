import { useMemo, useState, type ReactNode } from "react";
import { dayTradeEvidence, regionOf, type DayTradeCandidate, type Evidence } from "@jusik/shared";
import { useActions } from "../../app/actions";
import { useApp } from "../../app/AppContext";
import { href } from "../../app/router";
import { Change, EmptyState, EvidenceStrip, fmtPrice, ScoreBar, Sparkline, srQuote, useBreakpoint } from "../../ui";
import "../features.css";

/*
 * 후보 목록(UI 지도서 5.1 F·7.2 A): 종목, 전략, 근거 스트립과 충족 개수, 점수.
 * 컴퓨터·태블릿은 표, 핸드폰은 카드 대신 목록 행. 종목 이름은 종목 분석으로 가는 링크(키보드·화면 낭독),
 * 목록 행은 그 링크가 행 전체를 덮어 어디를 눌러도 종목 분석으로 가고, '근거 보기'는 그 위에 따로 놓여 근거 시트를 연다.
 */

export interface CandidateRow {
  candidate: DayTradeCandidate;
  evidence: Evidence;
}

export function toRows(cands: DayTradeCandidate[]): CandidateRow[] {
  return cands.map((c) => ({ candidate: c, evidence: dayTradeEvidence(c) }));
}

type SortKey = "score" | "evidence" | "change";

const stockHref = (code: string) => href(`/stocks/${encodeURIComponent(code)}`);

/** 목록 행 링크의 화면 낭독 이름: "기아, 8만 6백8십 원, 6.00% 상승, 단타 돌파, 점수 82점" */
export function candidateLabel(x: CandidateRow, showPrice = true): string {
  const c = x.candidate;
  const head = showPrice ? srQuote(c.name, c.price, c.changePct, regionOf(c.market)) : c.name;
  return `${head}, ${x.evidence.strategyName}, 점수 ${Math.round(c.score)}점`;
}

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
      <ul className="ui-rows cand-rows" aria-label="후보 목록">
        {rows.map((x) => {
          const region = regionOf(x.candidate.market);
          return (
            <li key={x.candidate.code} className="ui-rowitem cand-row">
              <div className="cand-main">
                <div className="cand-line">
                  <a className="cand-link t-bold ellipsis" href={stockHref(x.candidate.code)} aria-label={candidateLabel(x, showPrice)}>
                    {x.candidate.name}
                  </a>
                  <span className="t-2 cand-strategy" aria-hidden="true">{x.evidence.strategyName}</span>
                </div>
                <div className="cand-line">
                  <EvidenceStrip evidence={x.evidence} onOpen={() => open(x)} subject={x.candidate.name} className="cand-ev" />
                  {showPrice && (
                    <span className="cand-quote" aria-hidden="true">
                      <span className="num t-table">{fmtPrice(x.candidate.price, region)}</span>
                      <Change pct={x.candidate.changePct} showAbs={false} />
                    </span>
                  )}
                </div>
              </div>
              <span className="t-section num cand-score" aria-hidden="true">{Math.round(x.candidate.score)}</span>
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
      <table className="ui-table cand-table">
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
              // 행 어디를 눌러도 종목 분석으로 간다(마우스). 키보드·화면 낭독은 종목 이름 링크로
              <tr key={x.candidate.code} className="click" onClick={() => openStock(x.candidate.code)}>
                <td className="cand-name-cell">
                  <div className="stack" style={{ gap: 0 }}>
                    <a className="cand-name-link t-medium" href={stockHref(x.candidate.code)} onClick={(e) => e.stopPropagation()}>
                      {x.candidate.name}
                    </a>
                    <span className="t-cap nowrap">{x.candidate.code}</span>
                  </div>
                </td>
                <td className="cand-strategy-cell">
                  <div className="stack" style={{ gap: 0 }}>
                    <span>{x.evidence.strategyName}</span>
                    {x.evidence.headline && <span className="t-cap">{x.evidence.headline}</span>}
                  </div>
                </td>
                <td>
                  <EvidenceStrip evidence={x.evidence} onOpen={() => open(x)} subject={x.candidate.name} />
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
