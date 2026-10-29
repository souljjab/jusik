import { AlertTriangle, ChevronLeft, ChevronRight, NotebookPen } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { expectancy, josa, regionOfCode, summarizeJournal, type Currency, type JournalEntry } from "@jusik/shared";
import { useApp } from "../../app/AppContext";
import { navigate } from "../../app/router";
import { Button, EmptyState, Notice, fmtDate, fmtInt, fmtPrice, IconButton, kstDate, Section, Segmented, Skeleton, SkeletonRows, Sparkline, Stat, Stats, useBreakpoint } from "../../ui";
import { DailyReviews } from "./DailyReviews";
import { Pnl, Ret, Side, TagList } from "./parts";
import {
  cumulativePnl, emotionStats, inRange, pct0, periodRange, periodStats, sellResults, sourceOf, tradeRows, violationItems, type Period, type Range, type TradeRow,
} from "./recordsModel";

/*
 * 복기(지도서 6.2 오른쪽 그림 8, 부록 A '주간·월간 복기' — 컴퓨터·태블릿 ●, 핸드폰 ○).
 *  - 일·주·월과 앞뒤 기간 이동
 *  - 거래·승률·규칙 준수를 같은 무게로(규칙 준수에만 강조색): 결과보다 과정을 돌아보게
 *  - 거래별 결과(이름·수익률·과정 태그·감정), 감정별 결과(승률·평균 손익), 규칙 위반
 *  - 전체 기간 성과(통화별), 일일 복기(지수·섹터·신고가·특징주·모의매매 요약 + 내 메모)
 * 펜 메모(태블릿)는 이 버전에 없어요 — 일일 복기마다 메모 칸을 둔다.
 */

const PERIOD_WORD: Record<Period, string> = { day: "일", week: "주", month: "월" };
const THIS: Record<Period, string> = { day: "오늘", week: "이번 주", month: "이번 달" };

function rangeLabel(p: Period, r: Range): string {
  if (p === "day") return fmtDate(r.from);
  if (p === "week") return `${fmtDate(r.from)} ~ ${fmtDate(r.to)}`;
  const [y, m] = r.from.split("-");
  return `${y}년 ${Number(m)}월`;
}

export function ReviewTab({ loaded }: { loaded: boolean }) {
  const { journal, now, offline } = useApp();
  const bp = useBreakpoint();
  const [period, setPeriod] = useState<Period>("week");
  const [offset, setOffset] = useState(0);
  const today = kstDate(now);
  const range = useMemo(() => periodRange(period, today, offset), [period, today, offset]);

  const results = useMemo(() => sellResults(journal), [journal]);
  const inPeriod = useMemo(() => journal.filter((e) => inRange(e.date, range)), [journal, range]);
  const st = useMemo(() => periodStats(inPeriod, results), [inPeriod, results]);
  const rows = useMemo(() => tradeRows(inPeriod, journal, results), [inPeriod, journal, results]);
  const emo = useMemo(() => emotionStats(rows), [rows]);
  const viol = useMemo(() => violationItems(inPeriod, results), [inPeriod, results]);
  const curs: Currency[] = (["KRW", "USD"] as Currency[]).filter((c) => rows.some((r) => r.result?.currency === c && r.result.pnl != null));
  const wide = bp === "large" || bp === "expanded";
  const busy = !loaded && !journal.length;

  const head = (
    <div className="rec-period">
      <Segmented
        label="복기 기간"
        value={period}
        onChange={(p) => {
          setPeriod(p);
          setOffset(0);
        }}
        options={(["day", "week", "month"] as Period[]).map((p) => ({ value: p, label: PERIOD_WORD[p] }))}
      />
      <div className="rec-period-nav">
        <IconButton label={`이전 ${PERIOD_WORD[period]}`} onClick={() => setOffset((o) => o - 1)}>
          <ChevronLeft size={18} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
        <span className="rec-period-label num" aria-live="polite">
          {rangeLabel(period, range)}
        </span>
        <IconButton label={`다음 ${PERIOD_WORD[period]}`} disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))}>
          <ChevronRight size={18} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
        {offset < 0 && (
          <Button variant="link" className="rec-touchlink" onClick={() => setOffset(0)}>
            {josa(THIS[period], "으로/로")} 이동
          </Button>
        )}
      </div>
    </div>
  );

  const stats = busy ? (
    <div className="rec-skel-stats" role="status" aria-label="불러오는 중">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} h={44} />
      ))}
    </div>
  ) : (
    <div className="stack-3">
      <Stats n={3}>
        <Stat value={`${fmtInt(st.closed)}건`} label="거래" />
        <Stat value={pct0(st.winRate)} label="승률" />
        <Stat value={pct0(st.compliance)} label="규칙 준수" accent />
      </Stats>
      <p className="t-cap">
        거래와 승률은 결과를 아는 청산 {fmtInt(st.closed)}건 기준이에요(기록은 매수 {fmtInt(st.buys)}건 · 매도 {fmtInt(st.sells)}건). 규칙 준수는 직접 쓴 기록 중 판단할 수 있는 {fmtInt(st.judged)}건 기준이고, 모의매매 자동 기록은 빼요.
      </p>
      {curs.length > 0 && (
        <div className="rec-pnlline">
          {curs.map((c) => (
            <span key={c} className="rec-pnlitem">
              <span className="t-2">{c === "KRW" ? "실현 손익(국내)" : "실현 손익(미국)"}</span>
              <Pnl value={st.pnl[c]} currency={c} className="t-medium" />
              {bp !== "compact" && <Sparkline values={cumulativePnl(rows, c)} width={96} height={24} label={`${rangeLabel(period, range)} 누적 손익 추이`} />}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const trades = (
    <Section title="거래별 결과" sub={rows.length ? `${fmtInt(rows.length)}건` : undefined}>
      {busy ? (
        <SkeletonRows rows={4} h={36} />
      ) : rows.length === 0 ? (
        <EmptyState title={`${rangeLabel(period, range)}에 청산한 거래가 없어요`} action={offset === 0 ? <Button onClick={() => setOffset(-1)}>이전 {PERIOD_WORD[period]} 보기</Button> : undefined}>
          {inPeriod.length ? `매수 기록 ${fmtInt(st.buys)}건은 팔고 나면 결과가 여기에 보여요.` : undefined}
        </EmptyState>
      ) : (
        <ul className="rec-trades">
          {rows.map((r) => (
            <TradeItem key={r.id} r={r} />
          ))}
        </ul>
      )}
    </Section>
  );

  const emotions = (
    <Section title="감정별 결과">
      {busy ? (
        <SkeletonRows rows={3} h={24} />
      ) : emo.length === 0 ? (
        <p className="t-2">청산한 거래가 생기면 그때 감정과 결과를 함께 보여 줘요.</p>
      ) : (
        <div className="ui-table-wrap tall">
          <table className="ui-table rec-emo-table">
            <caption className="sr-only">감정별 거래 수, 승률, 평균 수익률</caption>
            <thead>
              <tr>
                <th scope="col">감정</th>
                <th scope="col" className="r">
                  거래
                </th>
                <th scope="col" className="r">
                  승률
                </th>
                <th scope="col" className="r">
                  평균 수익률
                </th>
              </tr>
            </thead>
            <tbody>
              {emo.map((x) => (
                <tr key={x.tag}>
                  <th scope="row" className="rec-emo-name">
                    {x.tag}
                  </th>
                  <td className="r num">{fmtInt(x.n)}</td>
                  <td className="r num">{pct0(x.winRate)}</td>
                  <td className="r">
                    <Ret pct={x.avgPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {emo.some((x) => x.n < 5) && <p className="t-cap">거래가 적은 감정은 우연일 수 있어요. 여러 주를 모아 보세요.</p>}
    </Section>
  );

  const violations = (
    <Section title="규칙 위반" sub={viol.length ? `${fmtInt(viol.length)}건` : undefined}>
      {busy ? (
        <SkeletonRows rows={2} h={24} />
      ) : viol.length === 0 ? (
        <p className="t-2">{st.judged > 0 ? "이 기간에는 위반한 기록이 없어요." : "규칙 체크를 표시한 기록이 없어 판단하지 못했어요."}</p>
      ) : (
        <ul className="rec-viol">
          {viol.map((v) => (
            <li key={v.id}>
              <div className="row wrap" style={{ gap: "0 8px" }}>
                <span className="t-cap num">{fmtDate(v.date)}</span>
                <Side side={v.side} />
                <span className="t-medium">{v.name}</span>
              </div>
              <ul className="rec-warnlist">
                {v.items.map((x, i) => (
                  <li key={i} className="rec-warnline">
                    <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
                    {x}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );

  return (
    <div className="rec-review stack-5">
      <section className="stack-4" aria-label="기간 요약">
        {head}
        {stats}
      </section>
      {offline && journal.length === 0 ? (
        <Notice tone="warn" title="기록을 불러오지 못했어요">
          서버와 연결되지 않았어요. 연결되면 자동으로 다시 받아요.
        </Notice>
      ) : !busy && journal.length === 0 ? (
        <EmptyState icon={<NotebookPen size={24} strokeWidth={1.5} aria-hidden="true" />} title="아직 기록이 없어요" action={<Button variant="primary" onClick={() => navigate("/records", { replace: true })}>일지 쓰기</Button>}>
          매매일지를 쓰거나 모의매매를 켜면 기간별로 돌아볼 수 있어요.
        </EmptyState>
      ) : wide ? (
        <div className="rec-review-cols">
          <div className="rec-review-main">{trades}</div>
          <div className="rec-review-side">
            {emotions}
            {violations}
          </div>
        </div>
      ) : (
        <div className="rec-review-stack">
          {trades}
          {emotions}
          {violations}
        </div>
      )}
      {journal.length > 0 && <Overall journal={journal} />}
      <DailyReviews />
    </div>
  );
}

function TradeItem({ r }: { r: TradeRow }) {
  const { openStock } = useApp();
  return (
    <li className="rec-trade">
      <div className="rec-trade-top">
        <button type="button" className="rec-namebtn" onClick={() => openStock(r.code)} title={`${r.name}(${r.code}) 종목 분석 열기`}>
          {r.name}
        </button>
        <span className="rec-trade-res">
          <Ret pct={r.result?.pct} className="t-medium" />
          {r.result?.pnl != null && <Pnl value={r.result.pnl} currency={r.result.currency} className="t-cap" />}
        </span>
      </div>
      <div className="rec-trade-sub">
        <span className="t-cap rec-tnum">
          {fmtDate(r.date)} 매도 · {sourceOf({ source: r.source }) === "자동(모의)" ? "자동(모의)" : "직접"}
          {r.result && !r.result.net && r.result.pnl != null ? " · 수수료 제외" : ""}
        </span>
        <TagList tags={r.tags} emotions={r.emotions} label={`${r.name} 거래 태그`} />
      </div>
    </li>
  );
}

/** 전체 기간 성과(통화별): 청산 거래·승률·평균 이익/손실·실현 손익·기대값·평균 R */
function Overall({ journal }: { journal: JournalEntry[] }) {
  const groups = (["KRW", "USD"] as Currency[])
    .map((c) => ({ c, entries: journal.filter((e) => (regionOfCode(e.code) === "US") === (c === "USD")) }))
    .filter((g) => g.entries.length > 0);
  return (
    <Section title="전체 기간 성과" sub="직접·자동 기록을 종목별 선입선출로 짝지은 값, 수수료 제외">
      <div className="rec-overall">
        {groups.map((g) => (
          <OverallCur key={g.c} cur={g.c} entries={g.entries} />
        ))}
      </div>
    </Section>
  );
}

const fmtR = (r: number) => `${r > 0 ? "+" : r < 0 ? "-" : ""}${Math.abs(r).toFixed(2)}R`;

function OverallCur({ cur, entries }: { cur: Currency; entries: JournalEntry[] }) {
  // 직접 쓴 기록과 모의계좌 기록은 다른 계좌라 따로 짝짓고 합친다
  const sm = useMemo(() => {
    const parts = [summarizeJournal(entries.filter((e) => sourceOf(e) === "수동")), summarizeJournal(entries.filter((e) => sourceOf(e) !== "수동"))];
    const closed = parts.flatMap((p) => p.closed);
    const wins = closed.filter((t) => t.pnl > 0), losses = closed.filter((t) => t.pnl <= 0);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const rs = closed.flatMap((t) => (t.rMultiple != null ? [t.rMultiple] : []));
    return {
      closed, open: parts.flatMap((p) => p.open), oversold: parts.some((p) => p.oversold), totalPnl: closed.reduce((a, t) => a + t.pnl, 0),
      winRate: closed.length ? wins.length / closed.length : null, avgWinPct: mean(wins.map((t) => t.returnPct)), avgLossPct: mean(losses.map((t) => t.returnPct)), avgR: mean(rs), rCount: rs.length,
    };
  }, [entries]);
  // 모두 이기거나 모두 진 기간도 기대값이 있다(없는 쪽 평균은 0으로 본다: 기대값 = 평균 수익률)
  const ev = sm.winRate != null ? expectancy({ winRate: sm.winRate, avgWinPct: sm.avgWinPct ?? 0, avgLossPct: sm.avgLossPct ?? 0 }) : null;
  const region = cur === "USD" ? "US" : "KR";
  return (
    <div className="stack-3">
      <h3 className="rec-lbl">{cur === "KRW" ? "원화(국내)" : "달러(미국)"}</h3>
      <dl className="rec-kv rec-kv-4">
        <div>
          <dt>청산 거래</dt>
          <dd className="num">{fmtInt(sm.closed.length)}회</dd>
        </div>
        <div>
          <dt>승률</dt>
          <dd className="num">{pct0(sm.winRate)}</dd>
        </div>
        <div>
          <dt>평균 이익 / 손실</dt>
          <dd>
            <Ret pct={sm.avgWinPct} /> / <Ret pct={sm.avgLossPct} />
          </dd>
        </div>
        <div>
          <dt>실현 손익</dt>
          <dd>
            <Pnl value={sm.totalPnl} currency={cur} />
          </dd>
        </div>
        <div>
          <dt>거래당 기대값</dt>
          <dd>
            <Ret pct={ev?.expectancyPct} />
          </dd>
        </div>
        <div>
          <dt title="R = (청산가 - 진입가) ÷ (진입가 - 계획 손절가). 1R은 계획한 1회 손실만큼이에요">평균 R</dt>
          <dd className="num">
            {sm.avgR == null ? "-" : fmtR(sm.avgR)} <span className="t-cap">{fmtInt(sm.rCount)}건</span>
          </dd>
        </div>
      </dl>
      {sm.closed.length > 0 && sm.closed.length < 20 && <p className="t-cap">표본이 {sm.closed.length}회라 승률·기대값은 참고만 하세요.</p>}
      {sm.closed.length > sm.rCount && <p className="t-cap">R은 매수 기록에 손절가가 있는 청산 거래만 계산해요(청산 {sm.closed.length}회 중 {sm.rCount}회).</p>}
      {sm.oversold && (
        <p className="t-2 rec-warnline">
          <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
          보유 수량보다 많이 판 기록이 있어요. 매매일지에서 수량을 확인해 주세요.
        </p>
      )}
      {sm.open.length > 0 && (
        <p className="t-2">
          보유 중:{" "}
          {sm.open.map((o, i) => (
            <Fragment key={o.code}>
              {i > 0 && ", "}
              <span className="nowrap">
                {o.name} <span className="num">{fmtInt(o.qty)}주(평단 {fmtPrice(o.avgPrice, region)})</span>
              </span>
            </Fragment>
          ))}
        </p>
      )}
    </div>
  );
}
