import { useCallback, useEffect, useState } from "react";
import type { StockExtras } from "@jusik/shared";
import { getExtras } from "../../api";
import { errorText } from "../../ui/format";

/*
 * 종목 보조 자료(국내: 수급·공시·업종, 미국: 보유 현황·SEC 공시). 머리말의 업종 이름과 공시 탭이 같이 쓴다.
 * 5분 동안 같은 응답을 다시 쓴다(서버도 캐시한다). 실패한 응답은 기억하지 않는다.
 * 오래 쓰면 메모리가 계속 늘지 않게 받을 때마다 지난 항목을 지우고, 최근에 본 CACHE_MAX 종목만 남긴다.
 */

const TTL = 5 * 60_000;
export const EXTRAS_CACHE_MAX = 30;
const cache = new Map<string, { at: number; p: Promise<StockExtras> }>();

/** 지난 항목을 지우고 오래된 것부터 max개만 남긴다(Map은 넣은 순서를 지킨다) */
export function pruneCache<T extends { at: number }>(m: Map<string, T>, now: number, ttl: number, max: number): void {
  for (const [k, v] of m) if (now - v.at >= ttl) m.delete(k);
  while (m.size > max) {
    const oldest = m.keys().next();
    if (oldest.done) break;
    m.delete(oldest.value);
  }
}

function fetchExtras(code: string, fresh = false): Promise<StockExtras> {
  const now = Date.now();
  const hit = cache.get(code);
  if (!fresh && hit && now - hit.at < TTL) {
    // 최근에 쓴 종목을 뒤로(가장 오래 안 쓴 것부터 지워지게)
    cache.delete(code);
    cache.set(code, hit);
    return hit.p;
  }
  const p = getExtras(code);
  cache.delete(code);
  cache.set(code, { at: now, p });
  pruneCache(cache, now, TTL, EXTRAS_CACHE_MAX);
  p.catch(() => cache.get(code)?.p === p && cache.delete(code));
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
      .catch((e: unknown) => alive && setSt({ code, data: null, error: errorText(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [code, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  if (st.code !== code) return { data: null, error: null, loading: !!code, reload };
  return { data: st.data, error: st.error, loading: st.loading, reload };
}
