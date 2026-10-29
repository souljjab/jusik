import { useCallback, useEffect, useRef, useState } from "react";
import { marketSession, regionOfCode } from "@jusik/shared";
import { loadStock, type StockData } from "../../api";
import { errorText } from "../../ui/format";

/*
 * 종목 자료(loadStock: 개요·일봉·지수·분석)와 받은 시각. loadStock은 60초 캐시라 같은 약속(Promise)을 돌려줄 수 있어,
 * 약속마다 처음 풀린 시각을 기억해 '시세 15:12 기준'에 쓴다(캐시를 다시 써도 실제로 받은 시각이 나온다).
 */

const resolvedAt = new WeakMap<Promise<StockData>, number>();
const watched = new WeakSet<Promise<StockData>>();

async function fetchStock(code: string): Promise<{ data: StockData; at: number }> {
  const p = loadStock(code);
  if (!watched.has(p)) {
    watched.add(p);
    p.then(() => resolvedAt.set(p, Date.now())).catch(() => {});
  }
  const data = await p;
  return { data, at: resolvedAt.get(p) ?? Date.now() };
}

export interface StockState {
  data: StockData | null;
  /** 받은 시각(ms) */
  at: number | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** 장이 열린 동안 다시 받는 간격(loadStock 캐시와 같다) */
const REFRESH_MS = 60_000;

/** 종목 상세 자료. 장이 열려 있고 화면이 보이는 동안 1분마다 다시 받는다(받는 동안 이전 값을 그대로 보여 준다) */
export function useStockData(code: string | null): StockState {
  const [st, setSt] = useState<{ code: string | null; data: StockData | null; at: number | null; error: string | null; loading: boolean }>(
    { code, data: null, at: null, error: null, loading: !!code },
  );
  const seq = useRef(0);

  const run = useCallback(
    (silent: boolean) => {
      if (!code) return;
      const id = ++seq.current;
      if (!silent) setSt((s) => ({ code, data: s.code === code ? s.data : null, at: s.code === code ? s.at : null, error: null, loading: true }));
      fetchStock(code)
        .then(({ data, at }) => id === seq.current && setSt({ code, data, at, error: null, loading: false }))
        .catch((e: unknown) => {
          if (id !== seq.current) return;
          const msg = errorText(e);
          // 조용히 다시 받다 실패하면 보던 값을 지킨다
          setSt((s) => (silent && s.code === code && s.data ? { ...s, loading: false } : { code, data: null, at: null, error: msg, loading: false }));
        });
    },
    [code],
  );

  useEffect(() => {
    if (!code) {
      seq.current++;
      setSt({ code: null, data: null, at: null, error: null, loading: false });
      return;
    }
    run(false);
  }, [code, run]);

  useEffect(() => {
    if (!code) return;
    const region = regionOfCode(code);
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (marketSession(region, new Date()).state === "open") run(true);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [code, run]);

  const same = st.code === code;
  return {
    data: same ? st.data : null,
    at: same ? st.at : null,
    error: same ? st.error : null,
    loading: same ? st.loading : !!code,
    reload: () => run(false),
  };
}

/**
 * 목록 행용: 같은 loadStock 캐시를 쓴다(상세로 들어가면 바로 그려진다). at은 받은 시각(ms).
 * 상세와 같이 장이 열려 있고 화면이 보이는 동안 1분마다 다시 받는다(고른 행과 가격 머리말이 같은 값을 보이게). 다시 받다 실패하면 보던 값을 지킨다
 */
export function useStockLite(code: string): { data: StockData | null; failed: boolean; at: number | null } {
  const [st, setSt] = useState<{ code: string; data: StockData | null; failed: boolean; at: number | null }>({ code, data: null, failed: false, at: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setSt((s) => (s.code === code ? s : { code, data: null, failed: false, at: null }));
    fetchStock(code)
      .then(({ data, at }) => alive && setSt({ code, data, failed: false, at }))
      .catch(() => alive && setSt((s) => (s.code === code && s.data ? s : { code, data: null, failed: true, at: null })));
    return () => {
      alive = false;
    };
  }, [code, tick]);
  useEffect(() => {
    const region = regionOfCode(code);
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (marketSession(region, new Date()).state === "open") setTick((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [code]);
  return st.code === code ? { data: st.data, failed: st.failed, at: st.at } : { data: null, failed: false, at: null };
}
