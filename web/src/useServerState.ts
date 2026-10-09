import { useCallback, useEffect, useState } from "react";
import type { ServerState } from "@jusik/shared";
import { getState } from "./api";

/** 서버 상태(스캔 결과·설정·모의계좌·내보내기 상태)를 주기적으로 가져온다 */
export function useServerState(intervalMs = 8000) {
  const [state, setState] = useState<ServerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setState(await getState());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);
  return { state, error, refresh };
}
