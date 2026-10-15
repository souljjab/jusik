import { useCallback, useEffect, useState } from "react";
import type { StockExtras } from "@jusik/shared";
import { getExtras } from "../../api";

/*
 * 종목 보조 자료(국내: 수급·공시·업종, 미국: 보유 현황·SEC 공시). 머리말의 업종 이름과 공시 탭이 같이 쓴다.
 * 5분 동안 같은 응답을 다시 쓴다(서버도 캐시한다). 실패한 응답은 기억하지 않는다.
 */

const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; p: Promise<StockExtras> }>();

function fetchExtras(code: string, fresh = false): Promise<StockExtras> {
  const hit = cache.get(code);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.p;
  const p = getExtras(code);
  cache.set(code, { at: Date.now(), p });
  p.catch(() => cache.delete(code));
  return p;
}

export function useExtras(code: string | null): { data: StockExtras | null; error: string | null; loading: boolean; reload: () => void } {
  const [st, setSt] = useState<{ code: string | null; data: StockExtras | null; error: string | null; loading: boolean }>({ code, data: null, error: null, loading: !!code });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!code) return;
    let alive = true;
    setSt((s) => (s.code === code && s.data ? s : { code, data: null, error: null, loading: true }));
    fetchExtras(code, tick > 0)
      .then((data) => alive && setSt({ code, data, error: null, loading: false }))
      .catch((e: unknown) => alive && setSt({ code, data: null, error: e instanceof Error ? e.message : String(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [code, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  if (st.code !== code) return { data: null, error: null, loading: !!code, reload };
  return { data: st.data, error: st.error, loading: st.loading, reload };
}
