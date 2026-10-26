import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AlertItem, JournalEntry, ServerState } from "@jusik/shared";
import { fetchHealth, getAlerts, getIndexQuote, getJournal, getState, type Health, type IndexQuote } from "../api";
import { loadWatchlist, saveWatchlist } from "../storage";
import { digestSlot, digestText, mergeQueue, notificationOf, planNotifications } from "./notify";
import { getPrefs, inDnd, setPrefs, usePrefs } from "./prefs";
import { navigate } from "./router";

/*
 * 앱 전체가 함께 쓰는 데이터: 서버 상태(스캔·설정·모의계좌), 매매일지, 관심종목, 알림, 지수, 현재 시각.
 * 화면은 useApp()으로 읽고, 고친 뒤에는 refresh*()로 다시 받는다.
 */

export interface AppData {
  health: Health | null;
  /** 서버에 연결하지 못했으면 그 이유 */
  offline: string | null;
  server: ServerState | null;
  /**
   * 서버 상태를 마지막으로 받은 시각(ISO). 데이터 자체의 시각이 아니므로(8초마다 바뀐다) 시세·국면의 '기준' 시각으로 쓰지 않는다 —
   * 스캔 시각(latestScan.at), 지수의 asOf·마지막 일봉 날짜, 시세 시각을 쓴다. 연결 끊김 띠의 '마지막으로 받은 시각'에만 쓴다.
   */
  serverAt: string | null;
  refreshServer: () => Promise<void>;
  journal: JournalEntry[];
  refreshJournal: () => Promise<void>;
  watchlist: string[];
  isWatched: (code: string) => boolean;
  toggleWatch: (code: string) => void;
  setWatchlist: (codes: string[]) => void;
  alerts: AlertItem[];
  unreadAlerts: number;
  markAlertsSeen: () => void;
  refreshAlerts: () => Promise<void>;
  indices: IndexQuote[];
  indicesAt: string | null;
  /** 30초마다 바뀌는 현재 시각(시장 상태 표시용) */
  now: Date;
  /** 종목 상세 열기 */
  openStock: (code: string, tab?: string) => void;
}

const Ctx = createContext<AppData | null>(null);

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppProvider 안에서 써야 해요");
  return v;
}

function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** 브라우저 알림을 띄울 수 있는가(설정에서 켰고 권한이 있음) */
const canNotify = () => getPrefs().notify && typeof Notification !== "undefined" && Notification.permission === "granted";

function showNotification(title: string, body: string, tag: string, route?: string) {
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      if (route) navigate(route);
    };
  } catch {
    /* 일부 브라우저는 페이지에서 직접 알림을 만들 수 없다 */
  }
}

/**
 * 새 알림을 브라우저 알림으로. 방해 금지로 먼저 거르고 리스크를 앞에 세워 최대 3개(notify.planNotifications).
 * 신호 요약을 켰으면 신호는 queue로 돌려준다(정한 시각에 한 번에 띄운다).
 */
function notifyBrowser(items: AlertItem[]): AlertItem[] {
  if (!canNotify()) return [];
  const plan = planNotifications(items, getPrefs());
  for (const a of plan.now) {
    const { title, body } = notificationOf(a);
    showNotification(title, body, a.key, a.route);
  }
  return plan.queue;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const prefs = usePrefs();
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [server, setServer] = useState<ServerState | null>(null);
  const [serverAt, setServerAt] = useState<string | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [watchlist, setWatch] = useState<string[]>(loadWatchlist);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [indicesAt, setIndicesAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const seenIds = useRef<Set<string> | null>(null);
  // 신호 요약: 모아 둔 신호와 마지막으로 확인한 요약 시각
  const digestQueue = useRef<AlertItem[]>([]);
  const digestLast = useRef<string | null>(null);
  /*
   * 요청 순번: 주기 폴링과 화면이 고친 뒤 부르는 refresh*()가 겹치면 늦게 도착한 오래된 응답이 새 상태를 덮어쓸 수 있다
   * (설정을 끈 직전에 보낸 폴링이 나중에 와서 다시 켜진 것처럼 보이는 문제). 가장 최근에 보낸 요청의 응답만 쓴다.
   */
  const seq = useRef({ server: 0, journal: 0, alerts: 0 });

  const refreshServer = useCallback(async () => {
    const id = ++seq.current.server;
    try {
      const s = await getState();
      if (id !== seq.current.server) return;
      setServer(s);
      setServerAt(new Date().toISOString());
      setOffline(null);
    } catch (e) {
      if (id !== seq.current.server) return;
      setOffline(e instanceof Error ? e.message : String(e));
    }
  }, []);
  const refreshJournal = useCallback(async () => {
    const id = ++seq.current.journal;
    try {
      const list = await getJournal();
      if (id === seq.current.journal) setJournal(list);
    } catch {
      /* 다음 주기에 다시 받는다 */
    }
  }, []);
  /** 요약 시각이 지났으면 모아 둔 신호를 한 번에 띄운다(방해 금지 시간이면 다음 시각으로 미룬다) */
  const flushDigest = useCallback(() => {
    const p = getPrefs();
    if (!p.digest.enabled) {
      digestQueue.current = [];
      digestLast.current = null;
      return;
    }
    const now = new Date();
    const slot = digestSlot(p.digest.times, now);
    // 처음 확인할 때는 기준만 잡는다(앱을 연 순간 지난 시각의 요약을 띄우지 않게)
    if (digestLast.current == null || slot == null) {
      digestLast.current = slot;
      return;
    }
    if (slot === digestLast.current) return;
    digestLast.current = slot;
    const items = mergeQueue(digestQueue.current, [], now);
    if (!items.length || inDnd(p.dnd, now)) return;
    digestQueue.current = [];
    if (!canNotify()) return;
    const { title, body } = digestText(items);
    showNotification(title, body, `digest:${slot}`, "/alerts?cat=signal");
  }, []);
  const refreshAlerts = useCallback(async () => {
    const id = ++seq.current.alerts;
    try {
      const list = await getAlerts();
      if (id !== seq.current.alerts) return;
      if (seenIds.current) {
        const fresh = list.filter((a) => !seenIds.current!.has(a.id));
        if (fresh.length) {
          const queued = notifyBrowser(fresh);
          if (queued.length) digestQueue.current = mergeQueue(digestQueue.current, queued);
        }
      }
      seenIds.current = new Set(list.map((a) => a.id));
      setAlerts(list);
    } catch {
      /* 다음 주기에 다시 받는다 */
    }
    flushDigest();
  }, [flushDigest]);
  const refreshIndices = useCallback(async () => {
    const list = (await Promise.all((["KOSPI", "KOSDAQ", "US"] as const).map(getIndexQuote))).filter((x): x is IndexQuote => !!x);
    if (list.length) {
      setIndices(list);
      setIndicesAt(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    fetchHealth().then(setHealth).catch((e: Error) => setOffline(e.message));
    void refreshServer();
    void refreshJournal();
    void refreshAlerts();
    void refreshIndices();
  }, [refreshServer, refreshJournal, refreshAlerts, refreshIndices]);
  useInterval(() => void refreshServer(), 8_000);
  useInterval(() => (void refreshJournal(), void refreshAlerts()), 20_000);
  useInterval(() => void refreshIndices(), 60_000);
  useInterval(() => (setNow(new Date()), flushDigest()), 30_000);

  const setWatchlist = useCallback((codes: string[]) => {
    setWatch(codes);
    saveWatchlist(codes);
  }, []);
  const toggleWatch = useCallback(
    (code: string) => setWatch((w) => {
      const next = w.includes(code) ? w.filter((c) => c !== code) : [...w, code];
      saveWatchlist(next);
      return next;
    }),
    [],
  );

  const unreadAlerts = useMemo(() => alerts.filter((a) => !prefs.alertsSeenAt || a.at > prefs.alertsSeenAt).length, [alerts, prefs.alertsSeenAt]);
  const markAlertsSeen = useCallback(() => {
    const latest = alerts[0]?.at;
    if (latest && (!getPrefs().alertsSeenAt || latest > getPrefs().alertsSeenAt!)) setPrefs({ alertsSeenAt: latest });
  }, [alerts]);

  const value = useMemo<AppData>(
    () => ({
      health, offline, server, serverAt, refreshServer, journal, refreshJournal,
      watchlist, isWatched: (c) => watchlist.includes(c), toggleWatch, setWatchlist,
      alerts, unreadAlerts, markAlertsSeen, refreshAlerts, indices, indicesAt, now,
      openStock: (code, tab) => navigate(`/stocks/${encodeURIComponent(code)}${tab ? `/${tab}` : ""}`),
    }),
    [health, offline, server, serverAt, refreshServer, journal, refreshJournal, watchlist, toggleWatch, setWatchlist, alerts, unreadAlerts, markAlertsSeen, refreshAlerts, indices, indicesAt, now],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
