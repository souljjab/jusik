import { useCallback, useEffect, useRef, useState } from "react";
import type { BreadthResponse, Candle, MacroResponse, Market } from "@jusik/shared";
import { CANDLE_COUNT, getBreadth, getMacro } from "../../api";

/*
 * 홈·국면 상세가 따로 받는 자료: 지수 일봉(차트·MACD 교차), 매크로, 시장 폭.
 * 지수 일봉은 api.ts의 종목 분석과 같은 개수(750)로 받아 서버 캐시를 같이 쓴다.
 */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const INDEX_TTL = 5 * 60_000;
const indexCache = new Map<Market, { at: number; p: Promise<Candle[] | null> }>();

function loadIndexCandles(market: Market): Promise<Candle[] | null> {
  const hit = indexCache.get(market);
  if (hit && Date.now() - hit.at < INDEX_TTL) return hit.p;
  const p = fetch(`${BASE}/api/index/${market}/candles?count=${CANDLE_COUNT}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ candles?: Candle[] }>) : null))
    .then((b) => (b && Array.isArray(b.candles) && b.candles.length > 0 ? b.candles : null))
    .catch(() => null);
  indexCache.set(market, { at: Date.now(), p });
  // 실패는 기억하지 않는다(다음에 다시 받는다)
  p.then((c) => {
    if (!c && indexCache.get(market)?.p === p) indexCache.delete(market);
  });
  return p;
}

/** undefined = 불러오는 중, null = 받지 못함 */
export function useIndexCandles(market: Market | null): Candle[] | null | undefined {
  const [got, setGot] = useState<{ market: Market; candles: Candle[] | null } | null>(null);
  useEffect(() => {
    if (!market) return;
    let live = true;
    loadIndexCandles(market).then((candles) => live && setGot({ market, candles }));
    return () => {
      live = false;
    };
  }, [market]);
  return market && got?.market === market ? got.candles : undefined;
}

/** 매크로 스냅숏(api가 캐시). undefined = 불러오는 중, null = 받지 못함 */
export function useMacro(): MacroResponse | null | undefined {
  const [m, setM] = useState<MacroResponse | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    getMacro().then((r) => live && setM(r));
    return () => {
      live = false;
    };
  }, []);
  return m;
}

/**
 * 시장 폭. 서버가 처음 계산 중이면 pending — 15초마다 다시 묻는다(최대 8번).
 * res: undefined = 불러오는 중, null = 받지 못함
 */
export function useBreadth(market: Market) {
  const [got, setGot] = useState<{ market: Market; res: BreadthResponse | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const req = useRef(0);
  const tries = useRef(0);

  const load = useCallback((m: Market, fresh: boolean) => {
    const id = ++req.current;
    setBusy(true);
    getBreadth(m, fresh)
      .catch(() => null)
      .then((res) => {
        if (id !== req.current) return;
        setGot({ market: m, res });
        setBusy(false);
      });
  }, []);

  useEffect(() => {
    tries.current = 0;
    load(market, false);
  }, [market, load]);
  useEffect(() => () => void req.current++, []);

  const res = got?.market === market ? got.res : undefined;
  useEffect(() => {
    if (!res?.pending || tries.current >= 8) return;
    const t = setTimeout(() => {
      tries.current++;
      load(market, true);
    }, 15_000);
    return () => clearTimeout(t);
  }, [res, market, load]);

  return { res, busy, retry: () => load(market, true) };
}
