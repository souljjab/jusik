import { ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { marketSession, type Market, type ServerState } from "@jusik/shared";
import type { IndexQuote } from "../../api";
import { useApp } from "../../app/AppContext";
import { Link, navigate, useRoute } from "../../app/router";
import { CandidateList } from "../../features/candidates/CandidateList";
import { riskSummary } from "../../features/risk/riskSummary";
import { atLeast, Button, Change, EmptyState, fmtDate, fmtIndex, fmtRatio, MarketStatus, Notice, ProgressLine, RiskMeter, Section, Segmented, Skeleton, useBreakpoint, useSlow, type Breakpoint } from "../../ui";
import { AlertsBlock } from "./AlertsBlock";
import { CandidatesBlock, NoCandidates, ScanButton, ScanMeta } from "./CandidatesBlock";
import { currenciesOf, enabledMarkets, INDEX_LABEL, marketFromQuery, MARKET_ORDER, nearStopNotice, PERIOD_LABEL, PERIOD_NAME, pickMarket, scheduleSentence, srIndex, unrealized, type ChartPeriod } from "./homeModel";
import { IndexChart } from "./LazyCharts";
import { appliedCap, postureStateOf, RegimeBlock } from "./RegimeBlock";
import { RegimeDetail } from "./RegimeDetail";
import { Pnl, RiskBlock } from "./RiskBlock";
import { useIndexCandles } from "./useHomeData";
import "./home.css";

/*
 * 홈(UI 지도서 2장: M1 시장 국면 + M4 요약, 5.1 그림 4, 7.1 그림 9 왼쪽)과 시장 국면 상세(/?view=regime).
 *  - 컴퓨터(1200 이상): 시장 국면 · 지수 차트와 주요 지수 · 리스크 / 오늘의 후보 · 알림
 *  - 태블릿: 국면과 리스크를 위에, 그 아래 차트·주요 지수·후보·알림
 *  - 핸드폰: 시장 상태, 국면, 주요 지수, 내 포지션, 오늘의 신호
 */

const MARKET_KEY = "jusik.home.market";
function loadMarket(): Market | null {
  try {
    const v = localStorage.getItem(MARKET_KEY);
    return MARKET_ORDER.includes(v as Market) ? (v as Market) : null;
  } catch {
    return null;
  }
}
function saveMarket(m: Market) {
  try {
    localStorage.setItem(MARKET_KEY, m);
  } catch {
    /* 저장할 수 없으면 이번 실행에서만 기억한다 */
  }
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** 지수의 마지막 일봉이 그 시장의 오늘이 아니면 그 날짜(오래된 값을 오늘 값으로 착각하지 않게 '10.23(금) 종가'로 쓴다) */
function closeDateOf(x: IndexQuote, now: Date): string | null {
  const day = x.date.slice(0, 10);
  return day !== marketSession(x.market === "US" ? "US" : "KR", now).date ? day : null;
}

/** 주요 지수(지도서 2장 홈: 시장 국면·주요 지수·내 포지션·오늘의 신호). 상단 바는 너비에 따라 일부만 보여 주므로 홈에는 늘 셋 다 둔다 */
function IndicesRow() {
  const { indices, now } = useApp();
  if (!indices.length)
    return (
      <div className="home-indices" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="home-index">
            <Skeleton w={48} h={12} />
            <Skeleton w={64} h={18} />
            <Skeleton w={52} h={12} />
          </div>
        ))}
      </div>
    );
  const order = [...indices].sort((a, b) => MARKET_ORDER.indexOf(a.market) - MARKET_ORDER.indexOf(b.market));
  return (
    <section aria-label="주요 지수">
      <ul className="home-indices">
        {order.map((x) => {
          const day = closeDateOf(x, now);
          return (
            <li key={x.market} className="home-index">
              <span className="sr-only">{srIndex(INDEX_LABEL[x.market], x.close, x.changePct, day)}</span>
              <span className="t-cap" aria-hidden="true">
                {INDEX_LABEL[x.market]}
              </span>
              <span className="home-index-v num" aria-hidden="true">
                {fmtIndex(x.close)}
              </span>
              <span className="home-index-ch" aria-hidden="true">
                <Change pct={x.changePct} showAbs={false} className="t-cap" />
                {day && <span className="t-cap num">{fmtDate(day)} 종가</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 내 포지션(지도서 7.1 B): 평가 손익과 비중 막대, 상한 위치에 세로 눈금 */
function MyPosition({ server, markets }: { server: ServerState; markets: Market[] }) {
  const rs = riskSummary(server);
  const curs = currenciesOf(markets);
  return (
    <Section title="내 포지션" sub="모의계좌">
      {curs.map((c) => {
        const r = rs[c];
        const u = unrealized(r.positions);
        return (
          <div key={c} className="stack">
            {curs.length > 1 && <h3 className="home-sub">{c === "KRW" ? "원화 계좌" : "달러 계좌"}</h3>}
            {r.positions.length ? (
              <div className="home-pos-head">
                <span className="t-2">평가 손익 · {r.positions.length}종목</span>
                <span className="home-pos-v">
                  <Pnl value={u.pnl} currency={c} />
                  {u.pct != null && <Change pct={u.pct} showAbs={false} />}
                </span>
              </div>
            ) : (
              <p className="t-2">보유 중인 모의 포지션이 없어요.</p>
            )}
            <RiskMeter label="주식 비중" value={r.weightPct} limit={r.capPct} format={(n) => fmtRatio(n)} limitLabel={`상한 ${fmtRatio(r.capPct)}`} />
            {r.blocked && (
              <Notice tone="warn" title="신규 매수가 잠겼어요(모의 자동매매)">
                {r.blockReason}
                {r.releaseText && ` ${r.releaseText}`}
              </Notice>
            )}
          </div>
        );
      })}
      {rs.nearStop.length > 0 && (
        <Notice tone="warn" action={<Link to="/trade" className="home-more">보유 보기</Link>}>
          {nearStopNotice(rs.nearStop)}
        </Notice>
      )}
    </Section>
  );
}

/** 불러오는 중: 실제 배치와 같은 모양. 1초가 넘으면 진행 표시를 더한다(지도서 9.2) */
function DashSkeleton({ bp }: { bp: Breakpoint }) {
  const slow = useSlow();
  return (
    <div className="home-skel" role="status" aria-label="불러오는 중">
      {slow && <ProgressLine text="시장 국면과 후보를 받는 중이에요" />}
      <div className={`home-grid ${bp}`}>
        <div className="home-area-regime stack-3">
          <Skeleton w={72} h={14} />
          <Skeleton w={120} h={44} />
          <Skeleton w={200} h={14} />
          <Skeleton w="80%" h={14} />
        </div>
        {bp !== "compact" && (
          <div className="home-area-chart">
            <Skeleton h={200} />
          </div>
        )}
        <div className={`${bp === "large" ? "home-area-side" : "home-area-risk"} stack-3`}>
          <Skeleton w={64} h={18} />
          <Skeleton h={36} />
          <Skeleton h={36} />
        </div>
        {/* 진행 표시는 위에 하나만(SkeletonRows는 자기 진행 표시를 따로 띄우므로 쓰지 않는다) */}
        <div className="home-area-cands stack-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} h={22} w={`${100 - (i % 3) * 12}%`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChartArea({ market, period, onPeriod }: { market: Market; period: ChartPeriod; onPeriod: (p: ChartPeriod) => void }) {
  const candles = useIndexCandles(market);
  return (
    <section className="home-chartarea" aria-labelledby="home-chart-h">
      <div className="home-block-head">
        <h2 id="home-chart-h" className="t-section">
          {INDEX_LABEL[market]} {PERIOD_NAME[period]}
        </h2>
        <Segmented
          label="차트 기간"
          size="sm"
          value={period}
          onChange={onPeriod}
          options={(["D", "W", "M"] as const).map((v) => ({ value: v, label: PERIOD_LABEL[v] }))}
        />
      </div>
      <IndexChart candles={candles} period={period} name={INDEX_LABEL[market]} />
    </section>
  );
}

function NoScan({ server, block = false }: { server: ServerState; block?: boolean }) {
  return (
    <EmptyState title="아직 스캔 기록이 없어요" action={<ScanButton variant="primary" size={block ? "lg" : "md"} block={block} />}>
      <span className="t-2">
        스캔하면 시장 국면과 오늘의 후보가 여기에 나와요. {scheduleSentence(server.status.scheduler, server.settings)}
      </span>
    </EmptyState>
  );
}

/** 컴퓨터·태블릿 홈 */
function Dashboard({ server, markets, market, onMarket, bp }: { server: ServerState; markets: Market[]; market: Market; onMarket: (m: Market) => void; bp: Breakpoint }) {
  const { alerts, now } = useApp();
  const [period, setPeriod] = useState<ChartPeriod>("W");
  const scan = server.latestScan;
  const candles = useIndexCandles(market);

  // 1·2·3: 차트 기간(일봉·주봉·월봉) — 지도서 5.4
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector(".ui-sheet")) return;
      const p = ({ "1": "D", "2": "W", "3": "M" } as const)[e.key as "1" | "2" | "3"];
      if (p) setPeriod(p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`home-grid ${bp}`}>
      <div className="home-area-regime">
        {scan ? <RegimeBlock state={postureStateOf(scan, market)} applied={appliedCap(scan, market)} market={market} markets={markets} onMarket={onMarket} candles={candles} headingId="home-regime-h" /> : <NoScan server={server} />}
      </div>
      {/* 주요 지수: 태블릿 세로는 국면 아래, 태블릿 가로·컴퓨터는 지수 차트 아래(상단 바는 너비에 따라 지수를 다 못 보여 준다) */}
      <div className="home-area-indices">
        <IndicesRow />
      </div>
      <div className="home-area-chart">
        <ChartArea market={market} period={period} onPeriod={setPeriod} />
      </div>
      {bp === "large" ? (
        // 컴퓨터: 리스크와 알림을 오른쪽 한 기둥으로(국면·차트 줄 높이를 리스크가 늘리지 않게)
        <div className="home-area-side">
          <RiskBlock server={server} currencies={currenciesOf(markets)} headingId="home-risk-h" />
          <AlertsBlock alerts={alerts} now={now} headingId="home-alerts-h" />
        </div>
      ) : (
        <div className="home-area-risk">
          <RiskBlock server={server} currencies={currenciesOf(markets)} headingId="home-risk-h" />
        </div>
      )}
      {scan && (
        <div className="home-area-cands">
          <CandidatesBlock scan={scan} headingId="home-cands-h" limit={atLeast(bp, "large") ? 8 : 6} />
        </div>
      )}
      {bp !== "large" && (
        <div className="home-area-alerts">
          <AlertsBlock alerts={alerts} now={now} headingId="home-alerts-h" />
        </div>
      )}
    </div>
  );
}

/** 핸드폰 홈(지도서 그림 9 왼쪽) */
function PhoneHome({ server, markets, market, onMarket }: { server: ServerState; markets: Market[]; market: Market; onMarket: (m: Market) => void }) {
  const { now, indices } = useApp();
  const scan = server.latestScan;
  const candles = useIndexCandles(scan ? market : null);
  const showUS = markets.includes("US");
  // 기준 시각은 바로 아래 지수 데이터의 시각(상단 바와 같다). 서버가 알려 주지 않으면 받은 시각이라고 밝힌다
  const kr = indices.find((x) => x.market === "KOSPI") ?? indices.find((x) => x.market === "KOSDAQ");
  const us = indices.find((x) => x.market === "US");
  return (
    <div className="home-phone stack-5">
      <div className="row wrap">
        {markets.some((m) => m !== "US") && <MarketStatus region="KR" now={now} asOf={kr?.asOf} receivedAt={kr?.receivedAt} />}
        {/* 두 시장을 한 줄에: 국내가 있으면 미국은 짧게 */}
        {showUS && <MarketStatus region="US" now={now} asOf={us?.asOf} receivedAt={us?.receivedAt} compact={markets.some((m) => m !== "US")} />}
      </div>
      {scan ? <RegimeBlock state={postureStateOf(scan, market)} applied={appliedCap(scan, market)} market={market} markets={markets} onMarket={onMarket} candles={candles} compact headingId="home-regime-h" /> : <NoScan server={server} block />}
      <IndicesRow />
      <MyPosition server={server} markets={markets} />
      {scan && (
        <Section title="오늘의 신호" sub={<ScanMeta scan={scan} />}>
          <CandidateList candidates={scan.candidates} limit={5} showPrice={false} empty={<NoCandidates scan={scan} block />} />
          {scan.candidates.length > 0 && (
            <Link to="/discover" className="ui-btn secondary block home-linkbtn home-touch">
              후보 모두 보기
              <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          )}
        </Section>
      )}
    </div>
  );
}

export default function HomeScreen() {
  const { server, offline, refreshServer } = useApp();
  const route = useRoute();
  const bp = useBreakpoint();
  const [chosen, setChosen] = useState<Market | null>(loadMarket);
  // 국면 알림은 '/?view=regime&market=KOSDAQ'처럼 시장을 가리킨다. 그 시장을 고른 시장으로 삼는다
  const queryMarket = marketFromQuery(route.query.get("market"));
  useEffect(() => {
    if (!queryMarket) return;
    setChosen(queryMarket);
    saveMarket(queryMarket);
  }, [queryMarket]);
  const markets = enabledMarkets(server?.settings, server?.latestScan);
  const market = pickMarket(queryMarket ?? chosen ?? server?.latestScan?.markets.find((m) => markets.includes(m)), markets);
  const onMarket = useCallback(
    (m: Market) => {
      setChosen(m);
      saveMarket(m);
      // 경로에 시장이 적혀 있으면 함께 바꾼다(그대로 두면 경로의 시장이 고른 시장을 덮는다)
      if (route.query.has("market")) {
        const q = new URLSearchParams(route.query);
        q.set("market", m);
        navigate(`${route.path}?${q}`, { replace: true });
      }
    },
    [route],
  );
  const [retrying, setRetrying] = useState(false);
  const detail = route.query.get("view") === "regime";

  if (!server) {
    if (offline)
      return (
        <div className="home">
          <h1 className="sr-only">홈</h1>
          <EmptyState
            title="서버에 연결되면 시장 국면과 후보가 여기에 나와요"
            action={
              <Button
                variant="secondary"
                busy={retrying}
                icon={<RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />}
                onClick={async () => {
                  setRetrying(true);
                  await refreshServer();
                  setRetrying(false);
                }}
              >
                다시 불러오기
              </Button>
            }
          >
            <span className="t-2">연결되면 자동으로 다시 받아요.</span>
          </EmptyState>
        </div>
      );
    return (
      <div className="home">
        <h1 className="sr-only">홈</h1>
        <DashSkeleton bp={bp} />
      </div>
    );
  }

  if (detail)
    return (
      <div className="home">
        <RegimeDetail server={server} markets={markets} market={market} onMarket={onMarket} bp={bp} />
      </div>
    );

  return (
    <div className="home">
      <h1 className="sr-only">홈</h1>
      {bp === "compact" ? (
        <PhoneHome server={server} markets={markets} market={market} onMarket={onMarket} />
      ) : (
        <Dashboard server={server} markets={markets} market={market} onMarket={onMarket} bp={bp} />
      )}
    </div>
  );
}
