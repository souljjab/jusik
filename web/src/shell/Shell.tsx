import { Bell, PanelLeftClose, PanelLeftOpen, Search, Settings, TrendingUp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../app/AppContext";
import { useActions } from "../app/actions";
import { setPrefs, usePrefs } from "../app/prefs";
import { areaOf, href, navigate, useRoute, type Area } from "../app/router";
import { marketSession } from "@jusik/shared";
import { knownName, stockNames, type IndexQuote } from "../api";
import { Change, IconButton, MarketStatus, Notice, fmtAsOf, fmtDate, fmtIndex, overlayOpen, useBreakpoint } from "../ui";
import { CommandPalette } from "./CommandPalette";
import { AREAS, AREA_TITLE, SETTINGS_AREA, screenTitle } from "./nav";
import { ShortcutsHelp } from "./ShortcutsHelp";

const INDEX_NAME = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "S&P 500" } as const;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** 사이드바(컴퓨터): 다섯 영역과 설정. 접으면 아이콘만 남는다 */
function Sidebar({ area }: { area: Area }) {
  const prefs = usePrefs();
  const collapsed = prefs.sidebarCollapsed;
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <nav className={`shell-nav nav-side ${collapsed ? "collapsed" : ""}`} aria-label="주 메뉴">
      <div className="brand">
        <span className="mark" aria-hidden="true">
          <TrendingUp size={16} strokeWidth={1.5} />
        </span>
        <span className="txt">주식 분석 어시스턴트</span>
      </div>
      {AREAS.map((a) => (
        <a key={a.id} className="nav-item" href={href(a.path)} aria-current={area === a.id ? "page" : undefined} title={collapsed ? a.label : undefined}>
          <a.icon size={20} strokeWidth={1.5} aria-hidden="true" />
          <span className="txt">{a.label}</span>
        </a>
      ))}
      <div className="spacer" />
      <a className="nav-item" href={href(SETTINGS_AREA.path)} aria-current={area === "settings" ? "page" : undefined} title={collapsed ? "설정" : undefined}>
        <Settings size={20} strokeWidth={1.5} aria-hidden="true" />
        <span className="txt">설정</span>
      </a>
      <button type="button" className="nav-item" onClick={() => setPrefs({ sidebarCollapsed: !collapsed })} aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}>
        <Toggle size={20} strokeWidth={1.5} aria-hidden="true" />
        <span className="txt">메뉴 접기</span>
      </button>
    </nav>
  );
}

/** 내비게이션 레일(태블릿): 아이콘과 이름, 선택한 영역은 알약 모양 바탕 */
function Rail({ area }: { area: Area }) {
  return (
    <nav className="shell-nav nav-rail" aria-label="주 메뉴">
      {AREAS.map((a) => (
        <a key={a.id} className="rail-item" href={href(a.path)} aria-current={area === a.id ? "page" : undefined}>
          <span className="pill">
            <a.icon size={22} strokeWidth={1.5} aria-hidden="true" />
          </span>
          {a.label}
        </a>
      ))}
      <div className="spacer" />
      <a className="rail-item" href={href("/settings")} aria-current={area === "settings" ? "page" : undefined}>
        <span className="pill">
          <Settings size={22} strokeWidth={1.5} aria-hidden="true" />
        </span>
        설정
      </a>
    </nav>
  );
}

/** 하단 탭(핸드폰): 홈·발굴·관심·매매·기록. 선택한 탭만 채운 아이콘과 강조색(지도서 7.1 C·3.4: 채운 아이콘은 선택 상태에만) */
function BottomTabs({ area }: { area: Area }) {
  return (
    <nav className="tabbar" aria-label="주 메뉴">
      {AREAS.map((a) => (
        <a key={a.id} className="tab-item" href={href(a.path)} aria-current={area === a.id ? "page" : undefined}>
          {area === a.id ? (
            <a.icon size={22} strokeWidth={2} fill="currentColor" fillOpacity={0.2} aria-hidden="true" />
          ) : (
            <a.icon size={22} strokeWidth={1.5} aria-hidden="true" />
          )}
          {a.tabLabel}
        </a>
      ))}
    </nav>
  );
}

/** 지수 하나: 이름, 값(소수 둘째 자리 고정), 등락. 마지막 일봉이 오늘이 아니면 그 날짜를 붙인다(오래된 값을 오늘 값으로 착각하지 않게) */
function IndexItem({ x, now }: { x: IndexQuote; now: Date }) {
  const today = marketSession(x.market === "US" ? "US" : "KR", now).date;
  const day = x.date.slice(0, 10);
  return (
    <span className="ix">
      <span className="nm">{INDEX_NAME[x.market]}</span>
      <span className="v num">{fmtIndex(x.close)}</span>
      <Change pct={x.changePct} showAbs={false} />
      {day !== today && <span className="dt">{fmtDate(day)}</span>}
    </span>
  );
}

/** 상단 바: 명령 검색, 시장 상태와 기준 시각, 지수, 알림. 핸드폰은 화면 제목과 검색·알림·설정 아이콘 */
function TopBar({ area }: { area: Area }) {
  const { health, indices, now, unreadAlerts } = useApp();
  const { openPalette } = useActions();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  // 기준 시각은 상단 바가 보여 주는 지수 데이터의 시각(서버가 알려 주면 그 시각, 아니면 받은 시각이라고 밝힌다)
  const kr = indices.find((x) => x.market === "KOSPI") ?? indices.find((x) => x.market === "KOSDAQ");
  const us = indices.find((x) => x.market === "US");
  return (
    <header className="shell-top topbar">
      <span className="title compact-only">{AREA_TITLE[area]}</span>
      <button type="button" className="cmd-trigger wide-only" onClick={openPalette} aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}>
        <Search size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="txt">종목, 전략, 화면 검색</span>
        <span className="txt-s">검색</span>
        <span className="kbd">{mac ? "⌘ K" : "Ctrl K"}</span>
      </button>
      <div className="status">
        <MarketStatus region="KR" now={now} asOf={kr?.asOf} receivedAt={kr?.receivedAt} compact />
        <MarketStatus region="US" now={now} asOf={us?.asOf} receivedAt={us?.receivedAt} compact />
      </div>
      {indices.length > 0 && (
        <div className="indices" role="group" aria-label="주요 지수">
          {indices.map((x) => (
            <IndexItem key={x.market} x={x} now={now} />
          ))}
        </div>
      )}
      <div className="actions">
        {health?.sample && (
          <span className="sample-pill" title="실제 시세가 아닌 임의로 만든 데이터예요">
            샘플 데이터
          </span>
        )}
        <IconButton label="검색" className="compact-only" onClick={openPalette}>
          <Search size={20} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
        <IconButton label="알림" badge={unreadAlerts} onClick={() => navigate("/alerts")} aria-current={area === "alerts" ? "page" : undefined}>
          <Bell size={20} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
        <IconButton label="설정" className="compact-only" onClick={() => navigate("/settings")} aria-current={area === "settings" ? "page" : undefined}>
          <Settings size={20} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  );
}

/**
 * 앱 껍데기. 창 너비로 내비게이션을 바꾼다(1200 이상 사이드바, 600~1199 레일, 600 미만 하단 탭).
 * 전역 단축키: Ctrl/Cmd K 명령 검색, ? 단축키 목록. 화면별 단축키(1·2·3, ↑↓, Ctrl Enter)는 각 화면이 단다.
 */
export function Shell({ children }: { children: ReactNode }) {
  const route = useRoute();
  const area = areaOf(route);
  const bp = useBreakpoint();
  const { offline, serverAt } = useApp();
  const { openPalette, openShortcuts, paletteOpen, shortcutsOpen, closePalette, closeShortcuts } = useActions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 시트·명령 검색이 열려 있으면 그 위에 또 층을 열지 않는다(지도서 7.3). Esc로 먼저 닫는다
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (!overlayOpen()) openPalette();
      } else if (e.key === "?" && !isTyping(e.target) && !e.ctrlKey && !e.metaKey && !overlayOpen()) {
        e.preventDefault();
        openShortcuts();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette, openShortcuts]);

  // 창 제목: 화면마다 다르게(종목 화면은 종목 이름). 이름을 아직 모르면 검색으로 찾아 본다
  const code = route.segments[0] === "stocks" ? route.segments[1] : undefined;
  const [stockName, setStockName] = useState<string | undefined>();
  useEffect(() => {
    if (!code) return setStockName(undefined);
    const k = knownName(code);
    setStockName(k);
    if (k) return;
    let alive = true;
    void stockNames([code]).then((r) => alive && setStockName(r[code]));
    return () => {
      alive = false;
    };
  }, [code]);
  useEffect(() => {
    document.title = screenTitle(route, stockName);
  }, [route, stockName]);

  // 화면이 바뀌면 맨 위로(핸드폰에서 이전 화면 스크롤이 남지 않게)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.segments[0]]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById("main")?.focus())}>
        본문으로 건너뛰기
      </a>
      {bp === "large" ? <Sidebar area={area} /> : bp !== "compact" ? <Rail area={area} /> : null}
      <TopBar area={area} />
      <main id="main" className="shell-main" tabIndex={-1}>
        {offline && (
          <Notice tone="warn" title="서버에 연결할 수 없어요" className="bar" >
            {serverAt ? `표시된 내용은 ${fmtAsOf(serverAt)}이에요. ` : ""}앱 서버가 켜져 있는지 확인해 주세요. 연결되면 자동으로 다시 받아요.
          </Notice>
        )}
        {children}
      </main>
      {bp === "compact" && <BottomTabs area={area} />}
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <ShortcutsHelp open={shortcutsOpen} onClose={closeShortcuts} />
    </div>
  );
}
