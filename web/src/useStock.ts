import { useEffect, useState } from "react";
import { loadStock, type StockData } from "./api";

export function useStock(code: string | null) {
  const [state, setState] = useState<{ data?: StockData; error?: string; loading: boolean }>({ loading: !!code });
  useEffect(() => {
    if (!code) return setState({ loading: false });
    let alive = true;
    setState((s) => ({ data: s.data?.info.code === code ? s.data : undefined, loading: true }));
    loadStock(code)
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e: Error) => alive && setState({ error: e.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [code]);
  return state;
}
