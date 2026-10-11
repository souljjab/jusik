import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { POSTURE_LABEL, regionOf, REGIME_SCORE_PARAMS, type Market, type RegimeAssessment, type ScanResult, type ServerState } from "@jusik/shared";
import { useApp } from "../../app/AppContext";
import { Link } from "../../app/router";
import { atLeast, EmptyState, fmtDate, fmtWhen, MarketStatus, NoteList, RegimeGauge, RuleTag, Section, Segmented, type Breakpoint } from "../../ui";
import { BreadthSection } from "./BreadthSection";
import { ScanButton } from "./CandidatesBlock";
import { breadthStateOf, capSource, INDEX_LABEL, lastMacdCross, PERIOD_LABEL, regimeReasons, scoreParts, signed, type ChartPeriod } from "./homeModel";
import { IndexChart } from "./LazyCharts";
import { MacroSection } from "./MacroSection";
import { MarketPicker, postureStateOf } from "./RegimeBlock";
import { useIndexCandles } from "./useHomeData";

/** 점수 한 항목: −범위~+범위 막대에서 0을 가운데 두고 값만큼 칠한다 */
function PartBar({ value, min, max }: { value: number; min: number; max: number }) {
  const span = Math.max(Math.abs(min), Math.abs(max), 1);
  const w = (Math.min(Math.abs(value), span) / span) * 50;
  return (
    <span className="home-partbar" aria-hidden="true">
      <span className="home-partbar-zero" />
      {value !== 0 && <span className={`home-partbar-fill ${value > 0 ? "pos" : "neg"}`} style={value > 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />}
    </span>
  );
}

/** 국면 점수 구성(합이 국면 점수) */
function Breakdown({ p, compact }: { p: RegimeAssessment; compact: boolean }) {
  const parts = scoreParts(p.breakdown);
  const P = REGIME_SCORE_PARAMS;
  return (
    <Section title="점수 구성" sub={`합계 ${signed(p.score)}점`}>
      <ul className="home-parts">
        {parts.map((x) => (
          <li key={x.key}>
            <div className="home-part-name">
              <span className="t-medium">{x.label}</span>
              {!compact && <span className="t-cap">{x.how}</span>}
              <RuleTag rule={x.rule} />
            </div>
            {!compact && <PartBar value={x.value} min={x.min} max={x.max} />}
            <span className="home-part-v num" aria-label={`${x.label} ${x.value}점`}>
              {signed(x.value)}
            </span>
          </li>
        ))}
        <li className="total">
          <div className="home-part-name">
            <span className="t-bold">국면 점수</span>
          </div>
          {!compact && <PartBar value={p.score} min={-7} max={5} />}
          <span className="home-part-v num t-bold">{signed(p.score)}</span>
        </li>
      </ul>
      <p className="t-cap">
        합계 {signed(P.attackScore)} 이상이면 공격, {P.defenseScore} 이하면 방어, 그 사이는 중립이에요. 지수가 30주선 아래 하락 국면이면 점수와 상관없이 방어, 주봉 판정이 없으면 공격으로
        가지 않아요. 배점과 기준은 저자 경험칙과 예시값이라 검증된 통계가 아니에요.
      </p>
    </Section>
  );
}

/** 통화별로 실제 적용한 상한과 출처 */
function Caps({ scan }: { scan: ScanResult }) {
  const caps = scan.exposureCaps;
  if (!caps) return <p className="t-2">적용 투자 상한은 다음 스캔부터 보여요.</p>;
  return (
    <dl className="home-facts">
      {(["KRW", "USD"] as const).map((cur) => (
        <div key={cur}>
          <dt>{cur === "KRW" ? "원화 계좌(국내)" : "달러 계좌(미국)"}</dt>
          <dd>
            <span className="num t-bold">{caps[cur] != null ? `${caps[cur]}%` : "-"}</span> <span className="t-cap">{capSource(cur, scan.markets)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Summary({ p, market, scan, compact }: { p: RegimeAssessment | null; market: Market; scan: ScanResult; compact: boolean }) {
  const candles = useIndexCandles(market);
  const cross = p && candles?.length && candles.at(-1)!.date === p.asOf ? lastMacdCross(candles.map((c) => c.close)) : null;
  const [period, setPeriod] = useState<ChartPeriod>("W");
  return (
    <div className="home-detail-summary">
      <div className="home-regime">
        <p className="home-eyebrow">{INDEX_LABEL[market]} 국면</p>
        <p className="home-regime-label">{p ? POSTURE_LABEL[p.posture] : "판정 없음"}</p>
        <RegimeGauge posture={p?.posture ?? null} size="lg" />
        {p ? (
          <>
            <ul className="home-reasons">
              {regimeReasons(p, cross).map((r) => (
                <li key={r.short}>{r.long}</li>
              ))}
            </ul>
            <p className="home-cap">
              주식 비중 상한 <span className="num">{p.exposureCapPct}%</span>
            </p>
            <p className="t-cap">
              지수 기준일 {fmtDate(p.asOf)}
              {p.rsi != null && ` · RSI ${p.rsi.toFixed(0)}`} · 스캔 {fmtWhen(scan.at)} 기준
            </p>
          </>
        ) : (
          <p className="t-2">이 시장은 국면을 판정하지 못했어요. 지수 자료가 없거나 다음 스캔부터 보여요.</p>
        )}
      </div>
      {!compact && (
        <div className="home-detail-chart">
          <div className="home-block-head">
            <h2 className="t-section">{INDEX_LABEL[market]} 지수</h2>
            <Segmented label="차트 기간" size="sm" value={period} onChange={setPeriod} options={(["D", "W", "M"] as const).map((v) => ({ value: v, label: PERIOD_LABEL[v] }))} />
          </div>
          <IndexChart candles={candles} period={period} name={INDEX_LABEL[market]} height={220} />
        </div>
      )}
    </div>
  );
}

/**
 * 시장 국면 상세(부록 A, 경로 /?view=regime): 국면 점수 구성, 판정 근거 문장 전부, 적용 상한, 매크로, 시장 폭과 차트.
 * 핸드폰은 요약과 근거 문장만(차트는 눌러서 펼친다).
 */
export function RegimeDetail({ server, markets, market, onMarket, bp }: { server: ServerState; markets: Market[]; market: Market; onMarket: (m: Market) => void; bp: Breakpoint }) {
  const { now, serverAt } = useApp();
  const compact = bp === "compact";
  const scan = server.latestScan;
  const wide = atLeast(bp, "large");
  const region = regionOf(market);

  const head = (
    <div className="home-detail-head">
      <Link to="/" className="home-back">
        <ArrowLeft size={18} strokeWidth={1.5} aria-hidden="true" />
        홈
      </Link>
      <div className="home-detail-title">
        <h1 className="t-title">시장 국면 상세</h1>
        <MarketStatus region={region} now={now} asOf={serverAt} />
      </div>
      <MarketPicker market={market} markets={markets} onChange={onMarket} size={compact ? "md" : "sm"} />
    </div>
  );

  if (!scan)
    return (
      <div className="home-detail reading">
        {head}
        <EmptyState title="아직 스캔 기록이 없어요" action={<ScanButton variant="primary" size="md" />}>
          <span className="t-2">스캔하면 시장별 국면 점수와 근거가 여기에 나와요.</span>
        </EmptyState>
      </div>
    );

  const st = postureStateOf(scan, market);
  const p = st.kind === "ok" ? st.p : null;
  const notes = p ? (
    <Section title="판정 근거" sub={`${p.notes.length}개`}>
      <NoteList notes={p.notes} />
    </Section>
  ) : null;

  return (
    <div className="home-detail reading">
      {head}
      <Summary p={p} market={market} scan={scan} compact={compact} />
      <div className={`home-detail-cols ${wide ? "wide" : ""}`}>
        <div className="home-detail-col">
          {p && <Breakdown p={p} compact={compact} />}
          {notes}
          <Section title="적용 투자 상한" sub={<RuleTag rule="2.5 강동진" />}>
            <Caps scan={scan} />
            <p className="t-cap">국내는 코스피·코스닥 중 낮은 상한을 써요. 모의 자동매매와 주문 검토가 이 상한을 기준으로 비중을 점검해요.</p>
          </Section>
        </div>
        <div className="home-detail-col">
          <MacroSection scan={scan} region={region} compact={compact} />
          <BreadthSection market={market} brief={breadthStateOf(scan, market)} compact={compact} />
        </div>
      </div>
    </div>
  );
}
