import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import {
  classifyDisclosure, classifySecFiling, FLOW_RULES, josa, secItemsOfTitle, US_FLOW_RULES,
  type Disclosure, type InvestorFlow, type Region, type StockExtras, type UsHolders,
} from "@jusik/shared";
import { Button, Change, fmtDate, fmtInt, fmtNum, fmtPct, fmtPrice, kstDate, Notice, NoteList, Section, SkeletonRows, Stat, Stats } from "../../ui";
import { markDate } from "./stocksModel";
import { useExtras } from "./useExtras";

/*
 * 공시 탭(예전 수급·공시·업종 패널): 국내는 외국인·기관 순매매, 최근 공시(DART·네이버), 업종 등락, 정기보고서 제출 현황.
 * 미국은 기관·내부자·공매도 보유 현황(야후)과 SEC 공시. 알림의 공시 항목은 이 탭(/stocks/:code/disclosure)으로 연결된다.
 */

const FLOW_ROWS = 10;
const DISCLOSURE_ROWS = 10;
const REPORT_ROWS = 8;
const INST_ROWS = 10;
const INSIDER_ROWS = 8;

const shares = (n: number) => `${n > 0 ? "+" : ""}${fmtInt(n)}`;
const toneOf = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
const pctOrDash = (n: number | undefined, d = 1) => (n == null ? "-" : `${fmtNum(n, d)}%`);
/** 날짜(지도서 3.2 '10.12(월)'). 해가 다르면 '25.3.14(금)'처럼 해를 붙인다. 날짜 꼴이 아니면 그대로 */
const dateKo = (d: string | null | undefined) => (!d ? "-" : /^\d{4}-\d{2}-\d{2}/.test(d) ? markDate(d.slice(0, 10), kstDate(new Date())) : d);

function Tag({ tone, children, title }: { tone: "good" | "bad" | "info"; children: string; title?: string }) {
  return (
    <span className={`stk-flag ${tone === "good" ? "good" : tone === "bad" ? "warn" : "info"}`} title={title}>
      {children}
    </span>
  );
}

function FlowRows({ flows, compact }: { flows: InvestorFlow[]; compact: boolean }) {
  if (!flows.length) return <p className="t-2">수급 데이터가 없어요.</p>;
  const start = Math.max(0, flows.length - FLOW_ROWS);
  const rows = flows.slice(start).map((f, k) => ({ f, prev: flows[start + k - 1] })).reverse();
  if (compact)
    return (
      <ul className="stk-flowlist">
        {rows.map(({ f, prev }) => (
          <li key={f.date}>
            <span className="stack" style={{ gap: 0 }}>
              <span className="t-medium">{fmtDate(f.date)}</span>
              <span className="t-cap num">
                종가 {fmtPrice(f.close, "KR")}
                {prev && <> · {fmtPct((f.close / prev.close - 1) * 100)}</>}
              </span>
            </span>
            <span className="stack right" style={{ gap: 0 }}>
              <span className="num">
                외국인 <span className={toneOf(f.foreignNet)}>{shares(f.foreignNet)}</span>
              </span>
              <span className="num">
                기관 <span className={toneOf(f.institutionNet)}>{shares(f.institutionNet)}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="ui-table-wrap tall" tabIndex={0} role="region" aria-label="외국인·기관 순매매 표">
      <table className="ui-table on-surface">
        <thead>
          <tr>
            <th>날짜</th>
            <th className="r">종가</th>
            <th className="r">외국인(주)</th>
            <th className="r">기관(주)</th>
            <th className="r">외국인 보유율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ f, prev }) => (
            <tr key={f.date}>
              <td className="nowrap">{fmtDate(f.date)}</td>
              <td className="r">
                <span className="num">{fmtPrice(f.close, "KR")}</span>
                {prev && <Change pct={(f.close / prev.close - 1) * 100} showAbs={false} className="t-cap stk-flowchg" />}
              </td>
              <td className={`r num ${toneOf(f.foreignNet)}`}>{shares(f.foreignNet)}</td>
              <td className={`r num ${toneOf(f.institutionNet)}`}>{shares(f.institutionNet)}</td>
              <td className="r num">{f.foreignHoldPct == null ? "-" : `${fmtNum(f.foreignHoldPct, 2)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const recentFirst = (list: Disclosure[], n: number) => [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);

function DisLink({ d, text }: { d: Disclosure; text: string }) {
  if (!d.url) return <span>{text}</span>;
  return (
    <a href={d.url} target="_blank" rel="noopener noreferrer" className="stk-dislink" title={`${d.source ?? "원문"}에서 새 탭으로 열기`}>
      {text}
      <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
      <span className="sr-only">(새 탭)</span>
    </a>
  );
}

function DisclosureList({ list, sec }: { list: Disclosure[]; sec: boolean }) {
  if (!list.length) return <p className="t-2">{sec ? "최근 90일 SEC 공시가 없어요." : "최근 공시가 없어요."}</p>;
  return (
    <ul className="stk-dis">
      {recentFirst(list, DISCLOSURE_ROWS).map((d, i) => {
        const c = sec ? classifySecFiling(d.form ?? "", secItemsOfTitle(d.title)) : classifyDisclosure(d.title);
        const prefix = `${c.type} · `;
        const text = sec && d.title.startsWith(prefix) ? d.title.slice(prefix.length) : d.title;
        return (
          <li key={`${d.date}-${i}`}>
            <span className="t-cap num">{dateKo(d.date)}</span>
            <span className="stk-dis-title">
              <DisLink d={d} text={text} />
            </span>
            <Tag tone={c.tone} title={sec ? "SEC 서식과 8-K 항목으로 분류했어요(본문은 보지 않아요)" : "공시 제목 키워드로 분류했어요(본문은 보지 않아요)"}>
              {c.type}
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

function Reports({ reports }: { reports: NonNullable<StockExtras["reports"]> }) {
  const rows = [...reports].reverse().slice(0, REPORT_ROWS);
  return (
    <div className="stack">
      <h4 className="stk-sub">정기보고서 제출 현황(DART)</h4>
      <div className="ui-table-wrap" tabIndex={0} role="region" aria-label="정기보고서 제출 현황 표">
        <table className="ui-table on-surface">
          <thead>
            <tr>
              <th>기간</th>
              <th>보고서</th>
              <th className="r">제출일</th>
              <th className="r">기한</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.period}`}>
                <td className="nowrap">{r.period}</td>
                <td className="nowrap">{r.kind}</td>
                <td className="r num">{dateKo(r.filed)}</td>
                <td className="r num">{dateKo(r.deadline)}</td>
                <td className="nowrap">{r.late ? (
                    <span className="warn-text t-medium stk-warnline">
                      <AlertTriangle size={12} strokeWidth={1.5} aria-hidden="true" />
                      기한 초과
                    </span>
                  ) : (
                    <span className="t-2">기한 내</span>
                  )}{r.amended ? <span className="t-cap"> · 정정본만 확인</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="t-cap">기한은 사업보고서 결산 후 90일, 반기·분기보고서 45일(주말이면 다음 월요일)로 계산했어요. 늦게 낸 적이 있으면 회계·재무 문제를 의심해 봐요.</p>
    </div>
  );
}

function FlowScore({ score, max, us }: { score: number; max: number; us?: boolean }) {
  return (
    <p className="t-2">
      수급 가점 <span className="num t-medium">{fmtNum(score, 1)}/{max}</span> — 수급은 점수를 깎지 않는 가점으로만 써요(책마다 견해가 달라요){us ? ". 미국 기준값은 대부분 앱 기본값이에요" : ""}.
    </p>
  );
}

function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <details className="stk-details">
      <summary>받지 못한 항목 {errors.length}개</summary>
      <ul className="stk-bullets t-2">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </details>
  );
}

function Holders({ h, compact }: { h: UsHolders | null | undefined; compact: boolean }) {
  if (!h) return <p className="t-2">기관·내부자·공매도 현황을 받지 못했어요.</p>;
  const R = US_FLOW_RULES;
  const shortChange = h.sharesShort != null && h.sharesShortPrior != null && h.sharesShortPrior > 0 ? (h.sharesShort / h.sharesShortPrior - 1) * 100 : null;
  const shortHot = h.shortPctFloat != null && h.shortPctFloat >= R.shortFloatWarnPct;
  const shortUpHot = shortChange != null && shortChange >= R.shortChangeWarnPct;
  const ins = h.insiderNet6m;
  const insts = (h.topInstitutions ?? []).slice(0, INST_ROWS);
  const recent = (h.recentInsider ?? []).slice(0, INSIDER_ROWS);
  return (
    <div className="stack-3">
      <Stats n={3}>
        <Stat value={pctOrDash(h.institutionsPct)} label="기관 보유" />
        <Stat value={pctOrDash(h.insidersPct)} label="내부자 보유" />
        <Stat value={h.institutionsCount == null ? "-" : `${fmtInt(h.institutionsCount)}곳`} label="보유 기관 수" />
        <Stat value={<span className={shortHot ? "warn-text" : ""}>{pctOrDash(h.shortPctFloat)}</span>} label={`공매도 비중(경고 ${R.shortFloatWarnPct}%)`} />
        <Stat value={h.shortRatio == null ? "-" : `${fmtNum(h.shortRatio, 1)}일`} label="숏 레이쇼" />
        <Stat value={<span className={shortUpHot ? "warn-text" : ""}>{shortChange == null ? "-" : fmtPct(shortChange, 1)}</span>} label="공매도 잔고 전월 대비" />
      </Stats>
      {ins ? (
        <p className="t-2">
          내부자 6개월 순매매 <span className={`num t-medium ${toneOf(ins.netShares)}`}>{shares(ins.netShares)}주</span> (매수 {ins.buyCount}건 {fmtInt(ins.buyShares)}주 · 매도 {ins.sellCount}건 {fmtInt(ins.sellShares)}주)
        </p>
      ) : (
        <p className="t-2">최근 6개월 내부자 거래 요약이 없어요.</p>
      )}
      {insts.length > 0 && (
        <div className="stack">
          <h4 className="stk-sub">상위 보유 기관</h4>
          {compact ? (
            <ul className="stk-flowlist">
              {insts.map((t, i) => (
                <li key={`${t.name}-${i}`}>
                  <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                    <span className="t-medium">{t.name}</span>
                    <span className="t-cap num">{dateKo(t.date)} 기준</span>
                  </span>
                  <span className="stack right" style={{ gap: 0 }}>
                    <span className="num">{fmtNum(t.pctHeld, 2)}%</span>
                    <span className={`t-cap num ${t.pctChange == null ? "" : toneOf(t.pctChange)}`}>{t.pctChange == null ? "-" : fmtPct(t.pctChange, 1)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
          <div className="ui-table-wrap tall" tabIndex={0} role="region" aria-label="상위 보유 기관 표">
            <table className="ui-table on-surface">
              <thead>
                <tr>
                  <th>기관</th>
                  <th className="r">보유율</th>
                  <th className="r">보유 주식 변화</th>
                  <th className="r">기준일</th>
                </tr>
              </thead>
              <tbody>
                {insts.map((t, i) => (
                  <tr key={`${t.name}-${i}`}>
                    <td>{t.name}</td>
                    <td className="r num">{fmtNum(t.pctHeld, 2)}%</td>
                    <td className={`r num ${t.pctChange == null ? "" : toneOf(t.pctChange)}`}>{t.pctChange == null ? "-" : fmtPct(t.pctChange, 1)}</td>
                    <td className="r num">{dateKo(t.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
      {recent.length > 0 && (
        <div className="stack">
          <h4 className="stk-sub">최근 내부자 거래</h4>
          {compact ? (
            <ul className="stk-flowlist">
              {recent.map((t, i) => (
                <li key={`${t.date}-${i}`}>
                  <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                    <span className="t-medium">{t.name}</span>
                    <span className="t-cap">
                      <span className="num">{dateKo(t.date)}</span> · {t.text || "-"}
                    </span>
                  </span>
                  <span className="stack right" style={{ gap: 0 }}>
                    <span className="num">{fmtInt(t.shares)}주</span>
                    <span className="t-cap num">{t.value == null ? "-" : fmtPrice(t.value, "US", { unit: true })}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
          <div className="ui-table-wrap" tabIndex={0} role="region" aria-label="최근 내부자 거래 표">
            <table className="ui-table on-surface">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>이름</th>
                  <th>내용</th>
                  <th className="r">주식 수</th>
                  <th className="r">금액</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t, i) => (
                  <tr key={`${t.date}-${i}`}>
                    <td className="nowrap">{dateKo(t.date)}</td>
                    <td className="stk-td-name">{t.name}</td>
                    <td className="stk-td-text">{t.text || "-"}</td>
                    <td className="r num">{fmtInt(t.shares)}</td>
                    <td className="r num">{t.value == null ? "-" : fmtPrice(t.value, "US", { unit: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DisclosureTab({ code, region, sample, compact }: { code: string; region: Region; sample: boolean; compact: boolean }) {
  const { data: x, error, loading, reload } = useExtras(code);
  const us = region === "US" || x?.region === "US" || !!x?.us;
  const what = us ? "수급·공시" : "수급·공시·업종";

  if (loading && !x)
    return (
      <div className="stk-tabbody">
        <SkeletonRows rows={6} />
      </div>
    );
  if (error || !x)
    return (
      <div className="stk-tabbody">
        <Notice
          tone="warn"
          title={`${josa(what, "을/를")} 받지 못했어요`}
          action={
            <Button size="sm" onClick={reload} icon={<RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />}>
              다시 불러오기
            </Button>
          }
        >
          {(error ?? "응답이 비어 있어요").replace(/[.\s]+$/, "")}. 잠시 뒤 다시 불러오세요.
        </Notice>
      </div>
    );
  if (!x.supported)
    return (
      <div className="stk-tabbody">
        <p className="t-2">
          {us
            ? "미국 종목의 수급·공시를 받을 원천이 꺼져 있어요. SEC 공시는 서버에 SEC_USER_AGENT(연락처가 든 User-Agent)를 넣어야 받아요."
            : "이 종목은 수급·공시·업종을 지원하지 않아요(6자리 국내 종목 코드만 받아요)."}
        </p>
        <Errors errors={x.errors} />
      </div>
    );

  const sampleNote = sample ? " · 샘플 자료" : "";
  if (us)
    return (
      <div className="stk-tabbody">
        <Section title="최근 SEC 공시" sub={`${x.disclosureSource ? `출처 ${x.disclosureSource}` : ""}${sampleNote}`} as="h3">
          {x.disclosureSource === "SEC" ? (
            <>
              <DisclosureList list={x.disclosures} sec />
              <p className="t-cap">제목을 누르면 SEC EDGAR 원문이 새 탭에서 열려요. 유형은 국내 공시 유형에 맞춘 앱의 해석이에요.</p>
            </>
          ) : (
            <p className="t-2">SEC 공시를 받지 못했어요. 아래 받지 못한 항목을 확인해 주세요.</p>
          )}
        </Section>
        <Section title="기관·내부자·공매도" sub={sampleNote ? "샘플 자료" : undefined} as="h3">
          {x.us?.holders && <FlowScore score={x.flowScore} max={US_FLOW_RULES.maxScore} us />}
          <Holders h={x.us?.holders} compact={compact} />
        </Section>
        {x.notes.length > 0 && <NoteList notes={x.notes} dense />}
        <Errors errors={x.errors} />
      </div>
    );

  const s = x.sector;
  return (
    <div className="stk-tabbody">
      <Section title="최근 공시" sub={`${x.disclosureSource ? `출처 ${x.disclosureSource}` : ""}${sampleNote}`} as="h3">
        <DisclosureList list={x.disclosures} sec={false} />
        {x.disclosureSource === "DART" && <p className="t-cap">제목을 누르면 DART 원문이 새 탭에서 열려요.</p>}
      </Section>
      <Section title="외국인·기관 순매매" sub={`최근 ${FLOW_ROWS}일${sampleNote}`} as="h3">
        <FlowScore score={x.flowScore} max={FLOW_RULES.maxScore} />
        <FlowRows flows={x.flows} compact={compact} />
      </Section>
      <Section title="업종" as="h3">
        {s ? (
          <p className="t-2">
            {s.name}{" "}
            {s.changePct == null ? "등락률 -" : <Change pct={s.changePct} showAbs={false} />}
            {s.rank != null && <> · 오늘 업종 등락률 {s.rank}위/{s.total}</>}
          </p>
        ) : (
          <p className="t-2">업종 정보를 찾지 못했어요.</p>
        )}
      </Section>
      {x.reports && x.reports.length > 0 && <Reports reports={x.reports} />}
      {x.notes.length > 0 && <NoteList notes={x.notes} dense />}
      <Errors errors={x.errors} />
    </div>
  );
}
