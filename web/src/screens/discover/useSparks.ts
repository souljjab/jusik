import { useEffect, useState } from "react";
import { getCandles } from "../../api";

/** 52주(약 260거래일) 종가. 화면을 오가도 다시 받지 않게 10분 동안 기억한다 */
const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; p: Promise<number[]> }>();

function closes(code: string): Promise<number[]> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = getCandles(code, 260).then((c) => c.map((x) => x.close));
  p.catch(() => cache.delete(code));
  cache.set(code, { at: Date.now(), p });
  return p;
}

/**
 * 결과 표 위쪽 몇 종목의 52주 추세선(지도서 5.3 E). 한 번에 셋씩 차례로 받아 서버에 부담을 덜 준다.
 * 못 받은 종목은 비워 둔다(추세선만 빠진다).
 */
export function useSparks(codes: string[], limit = 10): Record<string, number[]> {
  const [map, setMap] = useState<Record<string, number[]>>({});
  const key = codes.slice(0, limit).join(",");
  useEffect(() => {
    let alive = true;
    const list = key ? key.split(",") : [];
    const queue = [...list];
    const worker = async () => {
      while (alive && queue.length) {
        const code = queue.shift()!;
        try {
          const v = await closes(code);
          if (alive) setMap((m) => (m[code] ? m : { ...m, [code]: v }));
        } catch {
          /* 추세선만 빠진다 */
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => {
      alive = false;
    };
  }, [key]);
  return map;
}
