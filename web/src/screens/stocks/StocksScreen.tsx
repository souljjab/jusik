import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { currencyOfRegion, regionOf } from "@jusik/shared";
import type { StockData } from "../../api";
import { useActions } from "../../app/actions";
import { useApp } from "../../app/AppContext";
import { setPrefs, usePrefs } from "../../app/prefs";
import { navigate, useRoute } from "../../app/router";
import { accountBaseOf, heldQty, type OrderRequest } from "../../features/OrderReviewSheet";
import {
  Button, Disclaimer, EmptyState, Notice, prefersReducedMotion, ProgressLine, Resizer, Skeleton, SkeletonRows, Tabs, useBreakpoint, useSlow, type Breakpoint,
} from "../../ui";
import { ChartArea } from "./ChartArea";
import { DisclosureTab } from "./DisclosureTab";
import { EvidencePanel, SignalBlock } from "./EvidencePanel";
import { FinTab } from "./FinTab";
import { MemoTab } from "./MemoTab";
import { MobileOrderBar, OrderBox, orderRequest, PositionCalc, previewOf, stopFromPctCtx, stopPctOf, tabletRequest, useOrderContext } from "./OrderBox";
import type { ChartLine } from "./PriceChart";
import { BackLink, StockHeader } from "./StockHeader";
import {
  defaultPeriod, DETAIL_TABS, fitPanes, PANES, parseStockRoute, stepCode, stockPath, TAB_LABEL, TAB_LABEL_SHORT,
  type DetailTab, type Period,
} from "./stocksModel";
import { useStockData } from "./useStockData";
import { useSignals } from "./useSignals";
import { WatchPane, type ListMode } from "./WatchPane";
import "./stocks.css";

/*
 * 종목(UI 지도서 2장 '종목' 영역: 관심종목 + 종목 상세). 경로 /stocks, /stocks/:code, /stocks/:code/:tab(evidence·fin·disclosure·memo·minute).
 *  - 컴퓨터(1200 이상, 그림 5): 관심종목 | 가격 머리말·차트·신호 | 신호 근거·재무·공시·메모 탭 + 주문 상자. 경계선을 끌어 폭을 바꾸고 다음에도 유지한다
 *    (차트가 최소 폭 아래로 좁아지지 않게 창 폭에 맞춰 줄여 쓴다)
 *  - 태블릿 가로(840~1199, 그림 7): 목록(관심 | 추천) - 상세. 차트 아래 신호 근거(D)와 포지션 계산(E), 오른쪽 아래 떠 있는 매도·매수 주문 검토(F)
 *  - 태블릿 세로·핸드폰(그림 8 왼쪽·그림 9 가운데): /stocks는 목록만, /stocks/:code는 별도 화면(뒤로·넓은 차트·탭·아래 고정 매도·매수)
 * 단축키(지도서 5.4): 1·2·3 일·주·월봉, ↑↓ 관심종목 위아래, Ctrl(⌘) Enter 주문 검토 시트 열기(바로 기록하지 않는다).
 * 제목 구조: 종목을 열면 종목 이름이 h1, 신호·탭 내용이 h2, 그 안의 구역이 h3·h4.
 */

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}
const sheetOpen = () => typeof document !== "undefined" && !!document.querySelector(".ui-sheet");

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
const useWindowHeight = () => useSyncExternalStore(subscribeResize, () => window.innerHeight, () => 900);

function chartHeight(bp: Breakpoint, vh: number): number {
  if (bp === "large") return Math.round(Math.max(280, Math.min(460, vh * 0.42)));
  if (bp === "expanded") return Math.round(Math.max(260, Math.min(380, vh * 0.4)));
  if (bp === "medium") return 320;
  return 260;
}

/** 불러오는 중: 실제 배치와 같은 모양. 1초가 넘으면 진행 표시를 더한다(지도서 9.2) */
function DetailSkeleton({ height, side, back }: { height: number; side?: boolean; back?: boolean }) {
  const slow = useSlow();
  return (
    <div className="stk-skel">
      {back && <BackLink />}
      <h1 className="sr-only">종목</h1>
      {slow && <ProgressLine text="종목 자료를 받는 중이에요" />}
      <div className="stack" role="status" aria-label="종목 자료를 불러오는 중">
        <Skeleton w={160} h={24} />
        <Skeleton w={120} h={14} />
        <Skeleton w={200} h={34} />
      </div>
      <Skeleton w={220} h={32} />
      <Skeleton h={height} />
      {side && <SkeletonRows rows={5} />}
    </div>
  );
}

function LoadError({ code, error, onRetry }: { code: string; error: string; onRetry: () => void }) {
  return (
    <>
      <h1 className="sr-only">종목 {code}</h1>
      <Notice
        tone="warn"
        title="종목 자료를 불러오지 못했어요"
        action={
          <Button size="sm" onClick={onRetry} icon={<RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />}>
            다시 불러오기
          </Button>
        }
      >
        {error.replace(/[.\s]+$/, "")}. 종목 코드가 맞는지 확인한 뒤 다시 불러오세요.
      </Notice>
    </>
  );
}

function TabBody({ tab, data, signals, brief, compact, onSelectSignal }: {
  tab: DetailTab;
  data: StockData;
  signals: ReturnType<typeof useSignals>;
  brief: boolean;
  compact: boolean;
  onSelectSignal: (id: string) => void;
}) {
  const { server, journal, health } = useApp();
  const region = regionOf(data.info.market);
  const sample = !!health?.sample;
  if (tab === "fin") return <FinTab f={data.fundamentals} a={data.analysis} candles={data.candles} region={region} sample={sample} compact={compact} />;
  if (tab === "disclosure") return <DisclosureTab code={data.info.code} region={region} sample={sample} compact={compact} />;
  if (tab === "memo") return <MemoTab code={data.info.code} />;
  // 리스크·비중 계산은 주문 상자와 같은 계좌 기준(모의매매면 모의계좌 자산)과 보유 수량을 쓴다
  const account = { capital: accountBaseOf(server, currencyOfRegion(region)), paper: !!server?.settings.paperEnabled, held: heldQty(journal, data.info.code) };
  return (
    <EvidencePanel data={data} signals={signals} settings={server?.settings ?? null} journal={journal} account={account} brief={brief} onSelect={onSelectSignal} />
  );
}

interface SidePane {
  width: number;
  max: number;
  onChange: (w: number) => void;
}

/** 종목 상세(컴퓨터·태블릿·핸드폰 배치) */
function Detail({ code, tab, minute, bp, reviewRef, side }: {
  code: string;
  tab: DetailTab;
  minute: boolean;
  bp: Breakpoint;
  reviewRef: { current: (() => void) | null };
  /** 컴퓨터: 오른쪽 패널 폭과 경계선 */
  side?: SidePane;
}) {
  const { server } = useApp();
  const { openOrderReview } = useActions();
  const vh = useWindowHeight();
  const st = useStockData(code);
  const data = st.data;
  const candidate = useMemo(() => server?.latestScan?.candidates.find((c) => c.code === code) ?? null, [server?.latestScan, code]);
  const signals = useSignals(data, candidate, server?.settings.postureCaps);
  const tabRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const large = bp === "large";
  const single = bp === "compact" || bp === "medium";
  const height = chartHeight(bp, vh);

  // 기본 기간(지도서 5.2 C: 단타 후보 일봉, 그 밖은 주봉). 사용자가 기간을 고르기 전에는 서버 상태가 늦게 와서
  // 후보인지가 나중에 알려져도 다시 맞춘다(종목이 바뀌면 상세가 새로 만들어져 처음부터 다시 정한다)
  const [period, setPeriod] = useState<Period>(() => (minute ? "m" : defaultPeriod(!!candidate)));
  const periodPicked = useRef(minute);
  const isCandidate = !!candidate;
  useEffect(() => {
    if (!periodPicked.current) setPeriod(defaultPeriod(isCandidate));
  }, [isCandidate]);
  useEffect(() => {
    if (!minute) return;
    periodPicked.current = true;
    setPeriod("m");
  }, [minute]);
  const changePeriod = useCallback(
    (p: Period) => {
      periodPicked.current = true;
      setPeriod(p);
      if (minute && p !== "m") navigate(stockPath(code), { replace: true });
    },
    [minute, code],
  );

  // 1·2·3: 일·주·월봉(지도서 5.4)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || sheetOpen()) return;
      const p = ({ "1": "D", "2": "W", "3": "M" } as const)[e.key as "1" | "2" | "3"];
      if (p) changePeriod(p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changePeriod]);

  const setTab = useCallback((t: DetailTab) => navigate(stockPath(code, t), { replace: true }), [code]);
  const select = signals.select;
  // 신호를 고르면 근거 탭으로 바꾸고 바뀐 신호 근거가 보이게 옮긴다: 컴퓨터는 오른쪽 패널 맨 위, 그 밖은 탭 막대가 상단 바 바로 아래에
  const selectSignal = useCallback(
    (id: string) => {
      select(id);
      if (tab !== "evidence") setTab("evidence");
      requestAnimationFrame(() => {
        const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
        if (large) tabRef.current?.closest(".stk-side-body")?.scrollTo({ top: 0, behavior });
        else (tabsRef.current ?? tabRef.current)?.scrollIntoView({ block: "start", behavior });
      });
    },
    [select, tab, setTab, large],
  );

  const ctx = useOrderContext(
    data ?? ({ info: { code, name: code, market: "KOSPI" }, quote: { code, price: 0, change: 0, changePct: 0 } } as StockData),
    signals.plan,
  );
  // 태블릿 포지션 계산의 손절 비율(계획이 바뀌면 다시 채운다)
  const [stopPct, setStopPct] = useState(() => stopPctOf(ctx));
  const planKey = `${code}|${ctx.plan?.source}|${ctx.plan?.stop}|${ctx.price > 0}`;
  useEffect(() => setStopPct(stopPctOf(ctx)), [planKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 차트의 손절·목표선은 지금 주문 미리 보기 값을 따른다: 컴퓨터는 주문 상자 입력, 태블릿 가로는 손절 슬라이더, 그 밖은 계획 값
  const [boxLevels, setBoxLevels] = useState<{ stop: number; target: number } | null>(null);
  const onLevels = useCallback((l: { stop: number; target: number }) => setBoxLevels((p) => (p && p.stop === l.stop && p.target === l.target ? p : l)), []);
  const lv =
    large && boxLevels
      ? boxLevels
      : bp === "expanded"
        ? { stop: stopFromPctCtx(ctx, stopPct), target: ctx.plan?.target ?? 0 }
        : { stop: ctx.plan?.stop ?? 0, target: ctx.plan?.target ?? 0 };
  const lines = useMemo<ChartLine[]>(
    () => [
      ...(lv.stop > 0 ? [{ price: lv.stop, title: "손절", kind: "stop" as const }] : []),
      ...(lv.target > 0 ? [{ price: lv.target, title: "목표", kind: "target" as const }] : []),
    ],
    [lv.stop, lv.target],
  );

  const review = (r: OrderRequest) => openOrderReview(r);
  const tabletReview = () => review(tabletRequest(ctx, stopPct));
  const planReview = () => {
    const pv = previewOf(ctx, "BUY", ctx.price, ctx.plan?.stop ?? 0);
    review(orderRequest(ctx, "BUY", { qty: pv.stopOk ? pv.qty : undefined }));
  };
  // Ctrl(⌘)+Enter: 검토 시트만 연다. 컴퓨터는 주문 상자 값(상자가 직접 등록), 태블릿은 슬라이더 손절가, 그 밖은 계획 값
  useEffect(() => {
    if (!data || large) return;
    reviewRef.current = bp === "expanded" ? tabletReview : planReview;
    return () => {
      reviewRef.current = null;
    };
  });

  const sideResizer = side && <Resizer value={side.width} onChange={side.onChange} min={PANES.side.min} max={side.max} label="근거·주문 패널 폭 조절" invert />;

  if (st.error && !data)
    return (
      <div className={large ? "stk-pane stk-pane-center" : "stk-detail"}>
        {single && <BackLink />}
        <LoadError code={code} error={st.error} onRetry={st.reload} />
      </div>
    );
  if (!data)
    return (
      <>
        <div className={large ? "stk-pane stk-pane-center" : "stk-detail"}>
          <DetailSkeleton height={height} side={!large} back={single} />
        </div>
        {large && (
          <>
            {sideResizer}
            <aside className="stk-pane stk-pane-side stk-skel-side" aria-hidden="true">
              <Skeleton w={240} h={28} />
              <SkeletonRows rows={8} />
              <Skeleton h={48} className="stk-skel-btn" />
            </aside>
          </>
        )}
      </>
    );

  // 태블릿 가로: 차트 바로 아래 신호 근거(D)와 포지션 계산(E)
  const de =
    bp === "expanded" ? (
      <div className="stk-de">
        <h2 className="sr-only">신호 근거 요약과 포지션 계산</h2>
        <section aria-label="신호 근거 요약">
          <SignalBlock view={signals.selected} name={data.info.name} code={code} variant="brief" />
        </section>
        <PositionCalc ctx={ctx} stopPct={stopPct} onStopPct={setStopPct} />
      </div>
    ) : undefined;
  const chart = (
    <ChartArea
      data={data}
      at={st.at}
      period={period}
      onPeriod={changePeriod}
      signals={signals}
      onSelect={selectSignal}
      lines={lines}
      bp={bp}
      height={height}
      afterChart={de}
      onReload={st.reload}
    />
  );
  const tabs = (
    <Tabs
      label="종목 상세"
      idBase="stk-tab"
      value={tab}
      onChange={setTab}
      items={DETAIL_TABS.map((t) => ({ value: t, label: single ? TAB_LABEL_SHORT[t] : TAB_LABEL[t] }))}
      className="stk-tabs"
    />
  );
  const panel = (
    <div ref={tabRef} id={`stk-tab-${tab}`} role="tabpanel" aria-labelledby={`stk-tab-tab-${tab}`} className="stk-tabpanel" tabIndex={-1}>
      <h2 className="sr-only">{TAB_LABEL[tab]}</h2>
      <TabBody tab={tab} data={data} signals={signals} brief={single} compact={bp === "compact" || large} onSelectSignal={selectSignal} />
    </div>
  );

  if (large)
    return (
      <>
        <div className="stk-pane stk-pane-center">
          <StockHeader data={data} at={st.at} />
          {chart}
          <Disclaimer />
        </div>
        {sideResizer}
        <aside className="stk-pane stk-pane-side" aria-label="근거와 주문">
          {tabs}
          <div className="stk-side-body">{panel}</div>
          <div className="stk-side-order">
            <OrderBox ctx={ctx} onReview={review} reviewRef={reviewRef} onLevels={onLevels} />
          </div>
        </aside>
      </>
    );

  const tabsAt = (
    <div ref={tabsRef} className="stk-tabs-at">
      {tabs}
    </div>
  );

  if (bp === "expanded")
    return (
      <div className="stk-detail">
        <StockHeader data={data} at={st.at} />
        {chart}
        {tabsAt}
        {panel}
        <Disclaimer />
        {/* 떠 있는 주문 버튼(F): 이 앱은 주문을 내지 않고 검토 시트만 연다. 매도도 여기서 */}
        <div className="stk-fab" role="group" aria-label="주문">
          <Button variant="sell" size="lg" onClick={() => review(orderRequest(ctx, "SELL"))}>
            매도 주문 검토
          </Button>
          <Button variant="buy" size="lg" onClick={tabletReview}>
            매수 주문 검토
          </Button>
        </div>
      </div>
    );

  return (
    <div className="stk-detail">
      <StockHeader data={data} at={st.at} back />
      {chart}
      {tabsAt}
      {panel}
      <Disclaimer />
      <div className="stk-mbar-space" aria-hidden="true" />
      <MobileOrderBar ctx={ctx} onReview={review} />
    </div>
  );
}

/** 상자 폭(px)을 따라 읽는다(세 영역 폭 맞추기) */
function useBoxWidth(ref: { current: HTMLElement | null }, on: boolean): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const read = () => setW(Math.round(el.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on]);
  return w;
}

export default function StocksScreen() {
  const route = useRoute();
  const r = parseStockRoute(route.segments);
  const bp = useBreakpoint();
  const prefs = usePrefs();
  const { watchlist, server } = useApp();
  const [mode, setMode] = useState<ListMode>("watch");
  const reviewRef = useRef<(() => void) | null>(null);
  const largeRef = useRef<HTMLDivElement>(null);
  const twoPane = bp === "large" || bp === "expanded";
  const box = useBoxWidth(largeRef, bp === "large");
  const saved = { list: prefs.panes[PANES.list.key], side: prefs.panes[PANES.side.key] };
  const fit = fitPanes(bp === "large" ? box : 0, saved);
  const setPane = (key: string, w: number) => setPrefs((p) => ({ panes: { ...p.panes, [key]: Math.round(w) } }));

  const listCodes = mode === "watch" ? watchlist : (server?.latestScan?.candidates ?? []).map((c) => c.code);

  // 넓은 화면에서 종목을 고르지 않았으면 첫 관심종목을 연다
  useEffect(() => {
    if (twoPane && !r.code && watchlist[0]) navigate(stockPath(watchlist[0]), { replace: true });
  }, [twoPane, r.code, watchlist]);

  // ↑↓: 목록 위아래 종목(목록에 포커스가 있거나 아무 데도 없을 때만 — 다른 곳의 화살표 스크롤은 그대로 둔다).
  // 목록에 포커스가 있었으면 포커스도 새로 고른 행으로 옮긴다(포커스·선택·Enter가 같은 종목을 가리키게)
  useEffect(() => {
    if (!twoPane) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || sheetOpen()) return;
      const a = document.activeElement as HTMLElement | null;
      const inList = !!a?.closest(".stk-list");
      if (a && a !== document.body && !inList && a.id !== "main") return;
      const next = stepCode(listCodes, r.code, e.key === "ArrowDown" ? 1 : -1);
      if (!next || next === r.code) return;
      e.preventDefault();
      navigate(stockPath(next), { replace: true });
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(".stk-row.sel .stk-row-main");
        if (inList) row?.focus();
        else row?.scrollIntoView({ block: "nearest" });
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [twoPane, listCodes, r.code]);

  // Ctrl(⌘)+Enter: 주문 검토 시트만 연다(지도서 5.4)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 메모처럼 여러 줄 입력칸에서는 Ctrl(⌘)+Enter를 가로채지 않는다
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || sheetOpen()) return;
      if ((e.target as HTMLElement | null)?.tagName === "TEXTAREA") return;
      if (!reviewRef.current) return;
      e.preventDefault();
      reviewRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const list = <WatchPane selected={r.code} mode={mode} onMode={setMode} compact={!twoPane} showStatus={bp === "compact"} />;
  const noPick: ReactNode = (
    <EmptyState title="종목을 고르면 차트와 근거가 여기에 나와요" center>
      <span className="t-2">왼쪽 목록에서 고르거나 종목 검색으로 찾아보세요.</span>
    </EmptyState>
  );
  // 화면 제목(h1)은 하나: 종목을 열면 종목 이름, 열지 않았으면 '종목'
  const screenH1 = !r.code && <h1 className="sr-only">종목</h1>;

  if (bp === "large")
    return (
      <div ref={largeRef} className="stk stk-large" style={{ ["--stk-list" as string]: `${fit.list}px`, ["--stk-side" as string]: `${fit.side}px` } as CSSProperties}>
        {screenH1}
        <div className="stk-pane stk-pane-list">{list}</div>
        <Resizer value={fit.list} onChange={(w) => setPane(PANES.list.key, w)} min={PANES.list.min} max={fit.listMax} label="관심종목 목록 폭 조절" />
        {r.code ? (
          <Detail
            key={r.code}
            code={r.code}
            tab={r.tab}
            minute={r.minute}
            bp={bp}
            reviewRef={reviewRef}
            side={{ width: fit.side, max: fit.sideMax, onChange: (w) => setPane(PANES.side.key, w) }}
          />
        ) : (
          <div className="stk-pane stk-pane-center stk-nopick">{noPick}</div>
        )}
      </div>
    );

  if (bp === "expanded")
    return (
      <div className="stk stk-expanded" style={{ ["--stk-list" as string]: `${clamp(fit.list, 260, 340)}px` } as CSSProperties}>
        {screenH1}
        <div className="stk-pane stk-pane-list">{list}</div>
        {/* 종목을 바꾸면 상세 스크롤은 맨 위부터(목록 스크롤은 그대로) */}
        <div key={r.code ?? ""} className="stk-pane stk-pane-detail">
          {r.code ? <Detail key={r.code} code={r.code} tab={r.tab} minute={r.minute} bp={bp} reviewRef={reviewRef} /> : noPick}
        </div>
      </div>
    );

  if (!r.code)
    return (
      <div className="stk stk-single">
        <h1 className={bp === "compact" ? "sr-only" : "t-title"}>관심종목</h1>
        {list}
        {mode === "recs" && <Disclaimer />}
      </div>
    );
  return (
    <div className="stk stk-single">
      <Detail key={r.code} code={r.code} tab={r.tab} minute={r.minute} bp={bp} reviewRef={reviewRef} />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
