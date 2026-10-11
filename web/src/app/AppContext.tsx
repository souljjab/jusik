import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ALERT_CATEGORY_LABEL, type AlertItem, type JournalEntry, type ServerState } from "@jusik/shared";
import { fetchHealth, getAlerts, getIndexQuote, getJournal, getState, type Health, type IndexQuote } from "../api";
import { loadWatchlist, saveWatchlist } from "../storage";
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
  /** 서버 상태를 마지막으로 받은 시각(ISO) — '15:12 기준' 표시용 */
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

/** 새 알림을 브라우저 알림으로(설정에서 켰고 권한이 있고 방해 금지 시간이 아니면) */
function notifyBrowser(items: AlertItem[]) {
  const p = getPrefs();
  if (!p.notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  for (const a of items.slice(0, 3)) {
    if (inDnd(p.dnd) && !(p.dnd.allowRisk && a.category === "risk")) continue;
    try {
      const n = new Notification(`${ALERT_CATEGORY_LABEL[a.category]} 알림`, { body: a.text, tag: a.key });
      n.onclick = () => {
        window.focus();
        if (a.route) navigate(a.route);
      };
    } catch {
      /* 일부 브라우저는 페이지에서 직접 알림을 만들 수 없다 */
    }
  }
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

  const refreshServer = useCallback(async () => {
    try {
      setServer(await getState());
      setServerAt(new Date().toISOString());
      setOffline(null);
    } catch (e) {
      setOffline(e instanceof Error ? e.message : String(e));
    }
  }, []);
  const refreshJournal = useCallback(async () => {
    try {
      setJournal(await getJournal());
    } catch {
      /* 다음 주기에 다시 받는다 */
    }
  }, []);
  const refreshAlerts = useCallback(async () => {
    try {
      const list = await getAlerts();
      if (seenIds.current) {
        const fresh = list.filter((a) => !seenIds.current!.has(a.id));
        if (fresh.length) notifyBrowser(fresh);
      }
      seenIds.current = new Set(list.map((a) => a.id));
      setAlerts(list);
    } catch {
      /* 다음 주기에 다시 받는다 */
    }
  }, []);
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
  useInterval(() => setNow(new Date()), 30_000);

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
