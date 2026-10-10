import { useEffect, useState } from "react";
import { classifyDisclosure, FLOW_RULES, type InvestorFlow, type Region, type StockExtras } from "@jusik/shared";
import { getExtras } from "./api";
import { money, num, pct, tone } from "./format";
import { NoteList } from "./NoteList";
import "./styles/analysis.css";

const FLOW_ROWS = 10;
const DISCLOSURE_ROWS = 8;

/** 순매매 주식 수: 부호를 붙여 천 단위 쉼표 */
const shares = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("ko-KR")}`;

function FlowTable({ flows }: { flows: InvestorFlow[] }) {
  if (!flows.length) return <p className="muted small">수급 데이터가 없어요.</p>;
  // flows는 날짜 오름차순. 최근 10일을 최신부터 보여 주고, 종가 색은 전날 종가와 비교한다
  const start = Math.max(0, flows.length - FLOW_ROWS);
  const rows = flows.slice(start).map((f, k) => ({ f, prev: flows[start + k - 1] })).reverse();
  return (
    <div className="table-wrap">
      <table className="trades">
        <thead>
          <tr>
            <th className="left">날짜</th>
            <th>종가</th>
            <th>외국인(주)</th>
            <th>기관(주)</th>
            <th>외국인 보유율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ f, prev }) => (
            <tr key={f.date}>
              <td className="left">{f.date.slice(5)}</td>
              <td className={prev ? tone(f.close - prev.close) : ""}>{money(f.close, "KR")}</td>
              <td className={tone(f.foreignNet)}>{shares(f.foreignNet)}</td>
              <td className={tone(f.institutionNet)}>{shares(f.institutionNet)}</td>
              <td>{f.foreignHoldPct == null ? "-" : `${num(f.foreignHoldPct, 2)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Disclosures({ list }: { list: StockExtras["disclosures"] }) {
  if (!list.length) return <p className="muted small">최근 공시가 없어요.</p>;
  const recent = [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, DISCLOSURE_ROWS);
  return (
    <ul className="an-dis">
      {recent.map((d, i) => {
        const c = classifyDisclosure(d.title);
        return (
          <li key={`${d.date}-${i}`}>
            <span className="an-dis-date">{d.date.slice(5)}</span>
            <span className="an-dis-title">{d.title}</span>
            <span className={`chip an-tone-${c.tone}`} title="공시 제목 키워드로 분류했어요(본문은 보지 않아요)">{c.type}</span>
          </li>
        );
      })}
    </ul>
  );
}

function SectorLine({ sector }: { sector: StockExtras["sector"] }) {
  if (!sector) return <p className="muted small">업종 정보를 찾지 못했어요.</p>;
  return (
    <p className="small">
      업종 <b>{sector.name}</b>{" "}
      {sector.changePct == null ? <span className="muted">등락률 -</span> : <b className={tone(sector.changePct)}>{pct(sector.changePct, 2)}</b>}
      {sector.rank != null && <> · {sector.rank}위/{sector.total}</>}
      <span className="muted"> (오늘 업종 등락률 순위)</span>
    </p>
  );
}

/** 국내 종목 수급·공시·업종(네이버 금융). 종목이 바뀔 때마다 새로 받는다 */
export function ExtrasPanel({ code, region }: { code?: string; region: Region }) {
  const [state, setState] = useState<{ code: string; data?: StockExtras; error?: string } | null>(null);
  const skip = !code || region === "US";

  useEffect(() => {
    if (!code || skip) return;
    let alive = true;
    setState({ code });
    getExtras(code)
      .then((data) => alive && setState({ code, data }))
      .catch((e: unknown) => alive && setState({ code, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [code, skip]);

  if (!code) return null;
  const title = <h4 className="group">수급·공시·업종 (국내)</h4>;
  const unsupported = <p className="muted small">미국 종목은 수급·공시·업종 데이터를 아직 지원하지 않아요.</p>;
  if (skip) return <section className="an-extras">{title}{unsupported}</section>;

  const cur = state?.code === code ? state : null;
  let body: React.ReactNode;
  if (!cur || (!cur.data && !cur.error)) body = <p className="muted small">수급·공시·업종을 불러오는 중…</p>;
  else if (cur.error) body = <p className="muted small">수급·공시·업종을 불러오지 못했어요: {cur.error}</p>;
  else if (!cur.data!.supported) body = unsupported;
  else {
    const x = cur.data!;
    body = (
      <>
        <p className="small">
          수급 가점 <b className={x.flowScore > 0 ? "up" : ""}>{num(x.flowScore, 1)}/{FLOW_RULES.maxScore}</b>{" "}
          <span className="muted">— 수급은 점수를 깎지 않는 가점으로만 써요(책마다 견해가 달라요)</span>
        </p>
        <div className="an-extras-grid">
          <div>
            <b className="small">외국인·기관 순매매(최근 {FLOW_ROWS}일)</b>
            <FlowTable flows={x.flows} />
          </div>
          <div>
            <b className="small">최근 공시</b>
            <Disclosures list={x.disclosures} />
            <SectorLine sector={x.sector} />
          </div>
        </div>
        {x.notes.length > 0 && <NoteList notes={x.notes} />}
        {x.errors.length > 0 && (
          <ul className="notes muted small">
            {x.errors.map((e, i) => (
              <li key={i}>받지 못함 · {e}</li>
            ))}
          </ul>
        )}
      </>
    );
  }
  return <section className="an-extras">{title}{body}</section>;
}
