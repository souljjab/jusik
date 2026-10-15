import { BellOff, ChevronRight, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { dayTradeEvidence, type AlertItem, type DayTradeCandidate } from "@jusik/shared";
import { useActions } from "../../app/actions";
import { useApp } from "../../app/AppContext";
import { getPrefs } from "../../app/prefs";
import { href, Link, navigate, useRoute } from "../../app/router";
import {
  Button, Disclaimer, EmptyState, EvidenceStrip, IconButton, Notice, Section, Sheet, Skeleton, Tabs, atLeast, fmtAsOf, fmtTime, kstDate, useBreakpoint,
} from "../../ui";
import {
  ALERT_FILTERS, alertHeadline, countByFilter, filterAlerts, filterLabel, groupByDay, isAlertFilter, isUnread, srAlert, type AlertFilter,
} from "./alertsModel";
import { AlertSources, BrowserNotify, DndEditor, DndToggleRow } from "./NotifyControls";
import "./alerts.css";

/*
 * 알림 센터(UI 지도서 7.2 그림 10 가운데·7.4·2장 전역).
 *  - 위: 방해 금지(22:00~07:00 기본) 켜고 끄기. 시간·리스크 예외·브라우저 알림은 '알림 설정'(넓은 화면은 오른쪽 열)
 *  - 범주 탭: 전체·신호·리스크·공시·국면 (/alerts?cat=risk)
 *  - 오늘·어제·날짜로 묶고, 행은 범주(글자 색) · 시각 · 종목명 · '무엇이 얼마나' 문장. 리스크는 왼쪽 경고색 막대
 *  - 행을 누르면 알림이 가리키는 화면으로 간다. 이 화면을 보면 새 알림 표시를 지운다
 */

function LoadingShape() {
  return (
    <div className="glb-al-list" role="status" aria-label="불러오는 중">
      <Skeleton w={48} h={14} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="glb-al-skel">
          <div className="row between">
            <Skeleton w={40} h={14} />
            <Skeleton w={40} h={12} />
          </div>
          <Skeleton w={`${40 + (i % 3) * 12}%`} h={18} />
          <Skeleton w={`${60 + (i % 2) * 20}%`} h={14} />
        </div>
      ))}
    </div>
  );
}

/** 알림 한 줄. 신호 알림은 오늘 스캔에 그 후보가 있으면 근거 스트립과 '근거 보기'를 붙인다 */
function AlertRow({ a, unread, candidate, wide }: { a: AlertItem; unread: boolean; candidate: DayTradeCandidate | null; wide: boolean }) {
  const { openEvidence } = useActions();
  const h = alertHeadline(a);
  const time = fmtTime(a.at);
  const ev = candidate ? dayTradeEvidence(candidate) : null;
  const inner = (
    <>
      <span className="glb-al-top">
        <span className={`cat ${a.category}`}>{filterLabel(a.category)}</span>
        {unread && (
          <span className="glb-al-new">
            <span className="dot" aria-hidden="true" />
            새 알림
          </span>
        )}
        <time className="glb-al-time num" dateTime={a.at}>
          {time}
        </time>
      </span>
      <span className="glb-al-title">{h.title}</span>
      <span className="glb-al-text">{h.body}</span>
    </>
  );
  return (
    <li className={`glb-al-item cat-${a.category} ${unread ? "is-new" : ""}`}>
      {a.route ? (
        <a className="glb-al-link" href={href(a.route)} aria-label={srAlert(a, time, unread)}>
          <span className="glb-al-main">{inner}</span>
          {wide && <ChevronRight className="glb-al-chev" size={18} strokeWidth={1.5} aria-hidden="true" />}
        </a>
      ) : (
        <div className="glb-al-link static">
          <span className="glb-al-main">{inner}</span>
        </div>
      )}
      {ev && candidate && (
        <div className="glb-al-ev">
          <EvidenceStrip evidence={ev} onOpen={() => openEvidence({ title: `${candidate.name} 근거`, evidence: ev, code: candidate.code, notes: candidate.notes })} />
          <span className="t-cap">최근 스캔 기준</span>
        </div>
      )}
    </li>
  );
}

function SettingsSide() {
  return (
    <>
      <Section title="방해 금지" as="h2">
        <DndEditor />
      </Section>
      <Section title="브라우저 알림" as="h2">
        <BrowserNotify />
      </Section>
      <Section title="알림이 생기는 때" as="h2">
        <AlertSources />
      </Section>
      <p className="t-cap">
        이 설정은 이 기기에만 저장돼요. <Link to="/settings/alerts">설정 &gt; 알림</Link>에서도 바꿀 수 있어요.
      </p>
    </>
  );
}

export default function AlertsScreen() {
  const { alerts, markAlertsSeen, refreshAlerts, offline, now, server } = useApp();
  const bp = useBreakpoint();
  const route = useRoute();
  const compact = bp === "compact";
  const wideSide = atLeast(bp, "expanded");
  const cat = route.query.get("cat");
  const filter: AlertFilter = isAlertFilter(cat) ? cat : "all";

  // 이번에 화면을 열기 전까지 본 시각: 그 뒤 알림은 이번 방문 동안 '새 알림'으로 표시한다
  const [seenAt] = useState(() => getPrefs().alertsSeenAt);
  const [loaded, setLoaded] = useState(alerts.length > 0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshAlerts();
      setFetchedAt(new Date().toISOString());
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 이 화면을 보고 있는 동안 들어온 알림도 본 것으로 친다(상단 알림 배지를 지운다)
  useEffect(() => {
    markAlertsSeen();
  }, [markAlertsSeen]);
  useEffect(() => {
    if (alerts.length) setFetchedAt((t) => t ?? new Date().toISOString());
  }, [alerts]);

  const counts = useMemo(() => countByFilter(alerts), [alerts]);
  const groups = useMemo(() => groupByDay(filterAlerts(alerts, filter), now), [alerts, filter, now]);
  // 신호 알림의 근거: 오늘 날짜이고 최근 스캔 후보에 있을 때만(지난 신호는 문장의 근거 개수로 본다)
  const today = kstDate(now);
  const candOf = (a: AlertItem): DayTradeCandidate | null => {
    if (a.category !== "signal" || !a.code || kstDate(a.at) !== today) return null;
    return server?.latestScan?.candidates.find((c) => c.code === a.code) ?? null;
  };
  const hasSignals = groups.some((g) => g.items.some((a) => a.category === "signal"));

  const setFilter = (f: AlertFilter) => navigate(f === "all" ? "/alerts" : `/alerts?cat=${f}`, { replace: true });
  const items = ALERT_FILTERS.map((f) => ({
    value: f,
    label: (
      <span className="glb-al-tab">
        {filterLabel(f)}
        {counts[f] > 0 && (
          <span className="glb-al-tabn num" aria-label={`${counts[f]}건`}>
            {counts[f] > 99 ? "99+" : counts[f]}
          </span>
        )}
      </span>
    ),
  }));

  let list;
  if (!loaded && !alerts.length) list = offline ? null : <LoadingShape />;
  else if (!groups.length)
    list =
      filter === "all" ? (
        <EmptyState
          icon={<BellOff size={24} strokeWidth={1.5} aria-hidden="true" />}
          title="아직 알림이 없어요"
          action={
            <Button variant="secondary" onClick={() => navigate("/discover")}>
              발굴로 이동
            </Button>
          }
        >
          <span className="t-2">스캔에서 조건에 맞는 후보가 나오거나 모의계좌 보유 종목이 손절가에 가까워지면 여기에 쌓여요.</span>
        </EmptyState>
      ) : (
        <EmptyState
          title={`${filterLabel(filter)} 알림이 없어요`}
          action={
            <Button variant="secondary" onClick={() => setFilter("all")}>
              전체 알림 보기
            </Button>
          }
        >
          {counts.all > 0 && <span className="t-2">다른 범주 알림 {counts.all}건이 있어요.</span>}
        </EmptyState>
      );
  else
    list = (
      <div className="glb-al-list">
        {groups.map((g) => (
          <section key={g.day} className="glb-al-group" aria-labelledby={`glb-al-day-${g.day}`}>
            <h2 id={`glb-al-day-${g.day}`} className="glb-al-day">
              {g.label}
              <span className="sr-only">, {g.items.length}건</span>
            </h2>
            <ul className="glb-al-items">
              {g.items.map((a) => (
                <AlertRow key={a.id} a={a} unread={isUnread(a, seenAt)} candidate={candOf(a)} wide={!compact} />
              ))}
            </ul>
          </section>
        ))}
        <p className="t-cap glb-al-foot">최근 200건까지 보여요. 알림은 서버가 스캔과 보유 점검 때 남겨요.</p>
        {hasSignals && <Disclaimer />}
      </div>
    );

  return (
    <div className={`glb-al is-${bp}`}>
      <div className="glb-al-head">
        <div className="stack" style={{ gap: 2 }}>
          <h1 className={compact ? "sr-only" : "t-title"}>알림</h1>
          {!compact && <p className="t-2">스캔과 보유 점검 때 남긴 신호·리스크·공시·국면 알림이에요.</p>}
          {fetchedAt && <span className="t-cap">{fmtAsOf(fetchedAt)} · 20초마다 새로 받아요</span>}
        </div>
        <div className="row">
          <IconButton label="알림 새로 받기" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={20} strokeWidth={1.5} aria-hidden="true" className={refreshing ? "glb-spin" : undefined} />
          </IconButton>
          {!wideSide && (
            <IconButton label="알림 설정" onClick={() => setSettingsOpen(true)}>
              <SlidersHorizontal size={20} strokeWidth={1.5} aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </div>

      <div className={`glb-al-body ${wideSide ? "has-side" : ""}`}>
        <div className="glb-al-col">
          {!wideSide && (
            <div className="glb-al-dnd">
              <DndToggleRow now={now} />
              <Button variant="link" className="glb-al-dnd-more" onClick={() => setSettingsOpen(true)}>
                시간 바꾸기
              </Button>
            </div>
          )}
          {offline && !alerts.length && (
            <Notice
              tone="warn"
              title="알림을 불러오지 못했어요"
              action={
                <Button variant="secondary" busy={refreshing} onClick={() => void refresh()}>
                  다시 받기
                </Button>
              }
            >
              서버와 연결되면 자동으로 다시 받아요.
            </Notice>
          )}
          <Tabs idBase="glb-al" label="알림 범주" value={filter} items={items} onChange={setFilter} className="glb-al-tabs" />
          <div id={`glb-al-${filter}`} role="tabpanel" aria-labelledby={`glb-al-tab-${filter}`} className="glb-al-panel">
            {list}
          </div>
        </div>
        {wideSide && (
          <aside className="glb-al-side" aria-label="알림 설정">
            <SettingsSide />
          </aside>
        )}
      </div>

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="알림 설정" side="auto">
        <div className="stack-5">
          <Section title="방해 금지" as="h3">
            <DndEditor />
          </Section>
          <Section title="브라우저 알림" as="h3">
            <BrowserNotify />
          </Section>
          <Section title="알림이 생기는 때" as="h3">
            <AlertSources />
          </Section>
        </div>
      </Sheet>
    </div>
  );
}
