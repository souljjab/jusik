import { useEffect, useState } from "react";
import {
  classifyDisclosure, classifySecFiling, FLOW_RULES, secItemsOfTitle, US_FLOW_RULES,
  type Disclosure, type InvestorFlow, type Region, type StockExtras, type UsHolders,
} from "@jusik/shared";
import { getExtras } from "./api";
import { money, num, pct, tone } from "./format";
import { NoteList } from "./NoteList";
import "./styles/analysis.css";
import "./styles/analysis2.css";

const FLOW_ROWS = 10;
const DISCLOSURE_ROWS = 8;
const SEC_ROWS = 10;
const REPORT_ROWS = 8;
const INST_ROWS = 10;
const INSIDER_ROWS = 8;

/** 순매매 주식 수: 부호를 붙여 천 단위 쉼표 */
const shares = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("ko-KR")}`;
const count = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pctOrDash = (n: number | undefined, d = 2) => (n == null ? "-" : `${num(n, d)}%`);

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

/** 원문 링크가 있으면 새 탭으로 연다 */
function DisTitle({ d, text }: { d: Disclosure; text: string }) {
  if (!d.url) return <span className="an-dis-title">{text}</span>;
  return (
    <span className="an-dis-title">
      <a className="an2-dis-link" href={d.url} target="_blank" rel="noopener noreferrer" title={`${d.source ?? "원문"}에서 열기`}>
        {text}
      </a>
    </span>
  );
}

const recentFirst = (list: Disclosure[], n: number) => [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);

/** 국내 공시(DART·네이버). 유형은 제목 키워드로만 나눈다 */
function KrDisclosures({ list }: { list: Disclosure[] }) {
  if (!list.length) return <p className="muted small">최근 공시가 없어요.</p>;
  return (
    <ul className="an-dis">
      {recentFirst(list, DISCLOSURE_ROWS).map((d, i) => {
        const c = classifyDisclosure(d.title);
        return (
          <li key={`${d.date}-${i}`}>
            <span className="an-dis-date">{d.date.slice(5)}</span>
            <DisTitle d={d} text={d.title} />
            <span className={`chip an-tone-${c.tone}`} title="공시 제목 키워드로 분류했어요(본문은 보지 않아요)">{c.type}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** SEC 공시. 유형은 서식(form)과 8-K 항목으로 정하고, 제목 앞의 '유형 · '은 칩과 겹쳐 뺀다 */
function SecFilings({ list }: { list: Disclosure[] }) {
  if (!list.length) return <p className="muted small">최근 90일 SEC 공시가 없어요.</p>;
  return (
    <ul className="an-dis">
      {recentFirst(list, SEC_ROWS).map((d, i) => {
        const c = classifySecFiling(d.form ?? "", secItemsOfTitle(d.title));
        const prefix = `${c.type} · `;
        const text = d.title.startsWith(prefix) ? d.title.slice(prefix.length) : d.title;
        return (
          <li key={`${d.date}-${i}`}>
            <span className="an-dis-date">{d.date.slice(5)}</span>
            <DisTitle d={d} text={text} />
            <span className={`chip an-tone-${c.tone}`} title="SEC 서식과 8-K 항목으로 분류했어요(본문은 보지 않아요). 국내 공시 유형에 맞춘 앱의 해석이에요">
              {c.type}
            </span>
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

/** DART 정기보고서 제출 현황(최근 것부터) */
function ReportTable({ reports }: { reports: NonNullable<StockExtras["reports"]> }) {
  const rows = [...reports].reverse().slice(0, REPORT_ROWS);
  return (
    <div className="an2-block">
      <b className="small">정기보고서 제출 현황(DART)</b>
      <div className="table-wrap">
        <table className="trades">
          <thead>
            <tr>
              <th className="left">기간</th>
              <th className="left">보고서</th>
              <th>제출일</th>
              <th>기한</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.period}`}>
                <td className="left">{r.period}</td>
                <td className="left">{r.kind}</td>
                <td>{r.filed}</td>
                <td>{r.deadline}</td>
                <td>{r.late ? <span className="an2-late">기한 초과</span> : <span className="muted">기한 내</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">기한은 사업보고서 결산 후 90일, 반기·분기보고서 45일(주말이면 다음 월요일)로 계산했어요. 늦게 낸 적이 있으면 회계·재무 문제를 의심해 봐요.</p>
    </div>
  );
}

function FlowScoreLine({ score, max, us }: { score: number; max: number; us?: boolean }) {
  return (
    <p className="small">
      수급 가점 <b className={score > 0 ? "up" : ""}>{num(score, 1)}/{max}</b>{" "}
      <span className="muted">
        — 수급은 점수를 깎지 않는 가점으로만 써요(책마다 견해가 달라요){us ? ". 미국 기준값은 대부분 앱 기본값이에요" : ""}
      </span>
    </p>
  );
}

function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul className="notes muted small">
      {errors.map((e, i) => (
        <li key={i}>받지 못함 · {e}</li>
      ))}
    </ul>
  );
}

function SourceTag({ src }: { src: StockExtras["disclosureSource"] }) {
  if (!src) return null;
  return (
    <span className="an2-rule" title="공시 목록을 받은 곳">
      출처 {src}
    </span>
  );
}

function KrBody({ x }: { x: StockExtras }) {
  return (
    <>
      <FlowScoreLine score={x.flowScore} max={FLOW_RULES.maxScore} />
      <div className="an-extras-grid">
        <div>
          <b className="small">외국인·기관 순매매(최근 {FLOW_ROWS}일)</b>
          <FlowTable flows={x.flows} />
        </div>
        <div>
          <div className="an2-head-row">
            <b className="small">최근 공시</b>
            <SourceTag src={x.disclosureSource} />
          </div>
          <KrDisclosures list={x.disclosures} />
          {x.disclosureSource === "DART" && <p className="muted small">제목을 누르면 DART 원문이 새 탭에서 열려요.</p>}
          <SectorLine sector={x.sector} />
        </div>
      </div>
      {x.reports && x.reports.length > 0 && <ReportTable reports={x.reports} />}
      {x.notes.length > 0 && <NoteList notes={x.notes} />}
      <Errors errors={x.errors} />
    </>
  );
}

/** 미국 보유 현황(야후): 기관·내부자·공매도 */
function Holders({ h }: { h: UsHolders | null | undefined }) {
  if (!h) return <p className="muted small">기관·내부자·공매도 현황을 받지 못했어요.</p>;
  const R = US_FLOW_RULES;
  const shortChange = h.sharesShort != null && h.sharesShortPrior != null && h.sharesShortPrior > 0 ? (h.sharesShort / h.sharesShortPrior - 1) * 100 : null;
  const shortHot = h.shortPctFloat != null && h.shortPctFloat >= R.shortFloatWarnPct;
  const shortUpHot = shortChange != null && shortChange >= R.shortChangeWarnPct;
  const ins = h.insiderNet6m;
  const insts = (h.topInstitutions ?? []).slice(0, INST_ROWS);
  const recent = (h.recentInsider ?? []).slice(0, INSIDER_ROWS);
  return (
    <>
      <div className="metrics">
        <div className="metric" title="유통 주식 중 기관이 가진 비율">
          <span>기관 보유</span>
          <b>{pctOrDash(h.institutionsPct, 1)}</b>
        </div>
        <div className="metric" title={`임원·대주주 보유 비율. ${R.insiderHighPct}% 이상이면 참고 노트를 남겨요`}>
          <span>내부자 보유</span>
          <b>{pctOrDash(h.insidersPct, 1)}</b>
        </div>
        <div className="metric">
          <span>보유 기관 수</span>
          <b>{h.institutionsCount == null ? "-" : `${count(h.institutionsCount)}곳`}</b>
        </div>
        <div className="metric" title={`유동주식 대비 공매도 잔고. ${R.shortFloatWarnPct}% 이상이면 경고(앱 기본값)`}>
          <span>공매도 비중</span>
          <b className={shortHot ? "an2-hot" : ""}>{pctOrDash(h.shortPctFloat, 1)}</b>
        </div>
        <div className="metric" title="공매도 잔고 ÷ 하루 평균 거래량. 다 갚는 데 걸리는 날 수">
          <span>숏 레이쇼</span>
          <b>{h.shortRatio == null ? "-" : `${num(h.shortRatio, 1)}일`}</b>
        </div>
        <div className="metric" title={`공매도 잔고 전월 대비. +${R.shortChangeWarnPct}% 이상이면 경고(앱 기본값)`}>
          <span>공매도 잔고 전월 대비</span>
          <b className={shortUpHot ? "an2-hot" : ""}>{shortChange == null ? "-" : pct(shortChange, 1)}</b>
        </div>
      </div>
      {ins ? (
        <p className="small">
          내부자 6개월 순매매 <b className={tone(ins.netShares)}>{shares(ins.netShares)}주</b>{" "}
          <span className="muted">
            (매수 {ins.buyCount}건 {count(ins.buyShares)}주 · 매도 {ins.sellCount}건 {count(ins.sellShares)}주)
          </span>
        </p>
      ) : (
        <p className="muted small">최근 6개월 내부자 거래 요약이 없어요.</p>
      )}
      {insts.length > 0 && (
        <div className="an2-block">
          <b className="small">상위 보유 기관</b>
          <div className="table-wrap">
            <table className="trades">
              <thead>
                <tr>
                  <th className="left">기관</th>
                  <th>보유율</th>
                  <th>보유 주식 변화</th>
                  <th>기준일</th>
                </tr>
              </thead>
              <tbody>
                {insts.map((t, i) => (
                  <tr key={`${t.name}-${i}`}>
                    <td className="left">{t.name}</td>
                    <td>{num(t.pctHeld, 2)}%</td>
                    <td className={t.pctChange == null ? "" : tone(t.pctChange)}>{t.pctChange == null ? "-" : pct(t.pctChange, 1)}</td>
                    <td>{t.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {recent.length > 0 && (
        <div className="an2-block">
          <b className="small">최근 내부자 거래</b>
          <div className="table-wrap">
            <table className="trades">
              <thead>
                <tr>
                  <th className="left">날짜</th>
                  <th className="left">이름</th>
                  <th className="left">내용</th>
                  <th>주식 수</th>
                  <th>금액</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t, i) => (
                  <tr key={`${t.date}-${i}`}>
                    <td className="left">{t.date}</td>
                    <td className="left">{t.name}</td>
                    <td className="left">{t.text || "-"}</td>
                    <td>{count(t.shares)}</td>
                    <td>{t.value == null ? "-" : money(t.value, "US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function UsBody({ x }: { x: StockExtras }) {
  return (
    <div className="an2-us">
      {x.us?.holders && <FlowScoreLine score={x.flowScore} max={US_FLOW_RULES.maxScore} us />}
      <div className="an-extras-grid">
        <div>
          <b className="small">기관·내부자·공매도</b>
          <Holders h={x.us?.holders} />
        </div>
        <div>
          <div className="an2-head-row">
            <b className="small">최근 SEC 공시</b>
            <SourceTag src={x.disclosureSource} />
          </div>
          {x.disclosureSource === "SEC" ? (
            <>
              <SecFilings list={x.disclosures} />
              <p className="muted small">제목을 누르면 SEC EDGAR 원문이 새 탭에서 열려요.</p>
            </>
          ) : (
            <p className="muted small">SEC 공시를 받지 못했어요. 아래 사유를 확인해 주세요.</p>
          )}
        </div>
      </div>
      {x.notes.length > 0 && <NoteList notes={x.notes} />}
      <Errors errors={x.errors} />
    </div>
  );
}

/**
 * 종목 보조 데이터. 국내: 수급(네이버)·공시(DART 또는 네이버)·업종, 미국: 보유 현황(야후)·SEC 공시.
 * 종목이 바뀔 때마다 새로 받는다. sample이면 샘플 표시를 붙인다(응답에는 샘플 여부가 없어 App이 알려 준다).
 */
export function ExtrasPanel({ code, region, sample }: { code?: string; region: Region; sample?: boolean }) {
  const [state, setState] = useState<{ code: string; data?: StockExtras; error?: string } | null>(null);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    setState({ code });
    getExtras(code)
      .then((data) => alive && setState({ code, data }))
      .catch((e: unknown) => alive && setState({ code, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [code]);

  if (!code) return null;
  const cur = state?.code === code ? state : null;
  const x = cur?.data;
  const us = region === "US" || x?.region === "US" || !!x?.us;
  const label = us ? "수급·공시 (미국)" : "수급·공시·업종 (국내)";
  const title = (
    <h4 className="group">
      {label}
      {sample && (
        <span className="pill warn-pill" title="실제 값이 아닌 임의로 만든 수급·공시예요">
          샘플
        </span>
      )}
    </h4>
  );

  const what = us ? "수급·공시를" : "수급·공시·업종을";
  let body: React.ReactNode;
  if (!cur || (!cur.data && !cur.error)) body = <p className="muted small">{what} 불러오는 중…</p>;
  else if (cur.error) body = <p className="muted small">{what} 불러오지 못했어요: {cur.error}</p>;
  else if (!x!.supported)
    body = (
      <>
        <p className="muted small">
          {us
            ? "미국 종목의 수급·공시를 받을 원천이 꺼져 있어요. SEC 공시는 서버에 SEC_USER_AGENT(연락처가 든 User-Agent)를 넣어야 받아요."
            : "이 종목은 수급·공시·업종을 지원하지 않아요(6자리 국내 종목 코드만 받아요)."}
        </p>
        <Errors errors={x!.errors} />
      </>
    );
  else body = us ? <UsBody x={x!} /> : <KrBody x={x!} />;
  return (
    <section className="an-extras">
      {title}
      {body}
    </section>
  );
}
