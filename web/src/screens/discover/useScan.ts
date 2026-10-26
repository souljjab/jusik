import { useCallback, useEffect, useRef, useState } from "react";
import { startScan } from "../../api";
import { useApp } from "../../app/AppContext";
import { errorText, useToast } from "../../ui";
import { scanDoneToast, scanFinished, scanMarkOf, type ScanMark } from "./logic";

/**
 * '지금 스캔': 서버에 스캔을 시작시키고, 끝날 때까지 상태를 자주(1.5초) 다시 받는다.
 * 앱 공용 갱신은 8초 주기라 스캔이 끝난 걸 늦게 알게 되기 때문이다. 2분이 지나면 기다리기를 멈춘다.
 */
export function useScan() {
  const { server, refreshServer } = useApp();
  const toast = useToast();
  const [waiting, setWaiting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const before = useRef<ScanMark>(scanMarkOf(null));
  const deadline = useRef(0);
  const sch = server?.status.scheduler;
  const scanning = !!sch?.scanning || waiting || starting;

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void refreshServer(), 1500);
    return () => clearInterval(t);
  }, [waiting, refreshServer]);

  useEffect(() => {
    if (!waiting || !server) return;
    const s = server.status.scheduler;
    if (scanFinished(before.current, s)) {
      setWaiting(false);
      const t = scanDoneToast(s, server.latestScan?.candidates.length ?? 0);
      toast(t.text, t.tone);
    } else if (Date.now() > deadline.current) {
      setWaiting(false);
      setError("스캔이 2분 넘게 끝나지 않았어요. 서버 기록을 확인하거나 잠시 뒤 상태를 다시 보세요.");
    }
  }, [server, waiting, toast]);

  const start = useCallback(async () => {
    setError(null);
    before.current = scanMarkOf(server?.status.scheduler);
    setStarting(true);
    try {
      const r = await startScan();
      if (!r.started && !/이미 스캔 중/.test(r.message)) {
        setError(`스캔을 시작하지 못했어요. ${errorText(r.message)}`);
        return;
      }
      deadline.current = Date.now() + 120_000;
      setWaiting(true);
      void refreshServer();
    } catch (e) {
      setError(`스캔을 시작하지 못했어요. ${errorText(e)}`);
    } finally {
      setStarting(false);
    }
  }, [server, refreshServer]);

  return { scanning, start, error };
}
