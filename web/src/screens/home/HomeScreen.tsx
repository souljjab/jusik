import { ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type Market, type ServerState } from "@jusik/shared";
import { useApp } from "../../app/AppContext";
import { Link, useRoute } from "../../app/router";
import { CandidateList } from "../../features/candidates/CandidateList";
import { riskSummary } from "../../features/risk/riskSummary";
import { atLeast, Button, Change, EmptyState, fmtAsOf, fmtNum, fmtRatio, MarketStatus, Notice, RiskMeter, Section, Segmented, Skeleton, SkeletonRows, useBreakpoint, type Breakpoint } from "../../ui";
import { AlertsBlock } from "./AlertsBlock";
import { CandidatesBlock, ScanButton, ScanMeta } from "./CandidatesBlock";
import { currenciesOf, enabledMarkets, INDEX_LABEL, MARKET_ORDER, PERIOD_LABEL, PERIOD_NAME, pickMarket, srIndex, unrealized, type ChartPeriod } from "./homeModel";
import { IndexChart } from "./LazyCharts";
import { appliedCap, postureStateOf, RegimeBlock } from "./RegimeBlock";
import { RegimeDetail } from "./RegimeDetail";
import { Pnl, RiskBlock } from "./RiskBlock";
import { useIndexCandles } from "./useHomeData";
import "./home.css";

/*
 * 홈(UI 지도서 2장: M1 시장 국면 + M4 요약, 5.1 그림 4, 7.1 그림 9 왼쪽)과 시장 국면 상세(/?view=regime).
 *  - 컴퓨터(1200 이상): 시장 국면 · 지수 차트 · 리스크 / 오늘의 후보 · 알림
 *  - 태블릿: 국면과 리스크를 위에, 그 아래 차트·후보·알림
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

/** 주요 지수(핸드폰·좁은 태블릿 — 상단 바에 지수가 없는 너비) */
function IndicesRow() {
  const { indices, indicesAt } = useApp();
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
    <section aria-label={`주요 지수${indicesAt ? `, ${fmtAsOf(indicesAt)}` : ""}`}>
      <ul className="home-indices">
        {order.map((x) => (
          <li key={x.market} className="home-index">
            <span className="sr-only">{srIndex(INDEX_LABEL[x.market], x.close, x.changePct)}</span>
            <span className="t-cap" aria-hidden="true">
              {INDEX_LABEL[x.market]}
            </span>
            <span className="home-index-v num" aria-hidden="true">
              {fmtNum(x.close, 2)}
            </span>
            <span aria-hidden="true">
              <Change pct={x.changePct} showAbs={false} className="t-cap" />
            </span>
          </li>
        ))}
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
              </Notice>
            )}
          </div>
        );
      })}
      {rs.nearStop.length > 0 && (
        <Notice tone="warn" action={<Link to="/trade" className="home-more">보유 보기</Link>}>
          {rs.nearStop[0]!.position.name} 손절가까지 {fmtRatio(Math.max(0, rs.nearStop[0]!.leftPct))} 남았어요{rs.nearStop.length > 1 ? ` 외 ${rs.nearStop.length - 1}종목` : ""}.
        </Notice>
      )}
    </Section>
  );
}

/** 불러오는 중: 실제 배치와 같은 모양 */
function DashSkeleton({ bp }: { bp: Breakpoint }) {
  return (
    <div className={`home-grid ${bp}`} role="status" aria-label="불러오는 중">
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
      <div className="home-area-cands">
        <SkeletonRows rows={5} h={22} />
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

function NoScan({ block = false }: { block?: boolean }) {
  return (
    <EmptyState title="아직 스캔 기록이 없어요" action={<ScanButton variant="primary" size={block ? "lg" : "md"} block={block} />}>
      <span className="t-2">스캔하면 시장 국면과 오늘의 후보가 여기에 나와요. 장이 열린 동안에는 정해진 간격으로 자동 스캔해요.</span>
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
        {scan ? <RegimeBlock state={postureStateOf(scan, market)} applied={appliedCap(scan, market)} market={market} markets={markets} onMarket={onMarket} candles={candles} headingId="home-regime-h" /> : <NoScan />}
      </div>
      {bp === "medium" && (
        <div className="home-area-indices">
          <IndicesRow />
        </div>
      )}
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
  const { now, serverAt } = useApp();
  const scan = server.latestScan;
  const candles = useIndexCandles(scan ? market : null);
  const showUS = markets.includes("US");
  return (
    <div className="home-phone stack-5">
      <div className="row wrap">
        {markets.some((m) => m !== "US") && <MarketStatus region="KR" now={now} asOf={serverAt} />}
        {/* 두 시장을 한 줄에: 국내가 있으면 미국은 짧게(자세한 문구는 툴팁) */}
        {showUS && <MarketStatus region="US" now={now} asOf={serverAt} compact={markets.some((m) => m !== "US")} />}
      </div>
      {scan ? <RegimeBlock state={postureStateOf(scan, market)} applied={appliedCap(scan, market)} market={market} markets={markets} onMarket={onMarket} candles={candles} compact headingId="home-regime-h" /> : <NoScan block />}
      <IndicesRow />
      <MyPosition server={server} markets={markets} />
      {scan && (
        <Section title="오늘의 신호" sub={<ScanMeta scan={scan} />}>
          <CandidateList candidates={scan.candidates} limit={5} showPrice={false} empty={<p className="t-2">조건에 맞는 후보가 아직 없어요. 장이 열린 동안 계속 살펴봐요.</p>} />
          <Link to="/discover" className="ui-btn secondary block home-linkbtn home-touch">
            발굴에서 모두 보기
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </Link>
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
  const markets = enabledMarkets(server?.settings, server?.latestScan);
  const market = pickMarket(chosen ?? server?.latestScan?.markets.find((m) => markets.includes(m)), markets);
  const onMarket = useCallback((m: Market) => {
    setChosen(m);
    saveMarket(m);
  }, []);
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
                다시 연결
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
