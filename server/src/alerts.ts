import {
  currencyOfRegion, dayTradeEvidence, marketClock, POSTURE_LABEL, regionOf, regionOfCode,
  type AlertItem, type Disclosure, type Market, type Region, type ScanResult,
} from "@jusik/shared";
import { ALERT_LIMIT, type Store } from "./state";

/*
 * 알림(UI 지도서 5.1 G·7.2·7.4). 스캔·보유 점검 때 사실 문장으로 남긴다.
 * - 같은 종목의 같은 신호는 하루 한 번만(key에 날짜를 넣는다)
 * - 문장은 '무엇이, 얼마나' 순서. 조급함을 부추기는 말(급등 임박, 지금 안 사면…)은 쓰지 않는다
 */

/** 손절가까지 남은 거리가 이 비율(%) 이하이면 리스크 알림(앱 기본값) */
export const NEAR_STOP_PCT = 2;
/** 스캔 한 번에 신호 알림으로 남길 후보 수(점수 순, 앱 기본값) */
export const SIGNAL_ALERTS_PER_SCAN = 5;

const MARKET_LABEL: Record<Market, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "미국" };
const fx = (n: number, d = 1) => n.toLocaleString("ko-KR", { maximumFractionDigits: d });

/** 알림 하나를 남긴다. 같은 key가 이미 있으면 남기지 않고 false */
export function pushAlert(store: Store, a: Omit<AlertItem, "id">): boolean {
  const list = store.state.alerts;
  if (list.some((x) => x.key === a.key)) return false;
  list.push({ id: globalThis.crypto.randomUUID(), ...a });
  if (list.length > ALERT_LIMIT) list.splice(0, list.length - ALERT_LIMIT);
  return true;
}

const dateOf = (region: Region, at: Date) => marketClock(region, at).date;

/**
 * 스캔 결과로 신호·국면·리스크(가드) 알림을 만든다.
 * prev는 직전 스캔(국면이 바뀌었는지 비교). 만든 알림 수를 돌려준다.
 */
export function scanAlerts(store: Store, prev: ScanResult | null, scan: ScanResult, at: Date): number {
  let n = 0;
  for (const c of scan.candidates.slice(0, SIGNAL_ALERTS_PER_SCAN)) {
    const ev = dayTradeEvidence(c);
    const date = dateOf(regionOf(c.market), at);
    if (
      pushAlert(store, {
        at: scan.at, category: "signal", code: c.code, name: c.name, key: `signal:daytrade:${c.code}:${date}`, route: `/stocks/${c.code}`,
        text: `${c.name} ${ev.headline}. 근거 ${ev.total}개 중 ${ev.met}개 충족`,
      })
    )
      n++;
  }
  for (const m of scan.markets) {
    const now = scan.postures?.[m];
    const before = prev?.postures?.[m];
    if (!now || !before || now.posture === before.posture) continue;
    const date = dateOf(regionOf(m), at);
    if (
      pushAlert(store, {
        at: scan.at, category: "regime", key: `regime:${m}:${date}:${now.posture}`, route: "/",
        text: `${MARKET_LABEL[m]} 국면이 ${POSTURE_LABEL[before.posture]}에서 ${POSTURE_LABEL[now.posture]}(으)로 바뀌었어요. 주식 비중 상한 ${now.exposureCapPct}%`,
      })
    )
      n++;
  }
  for (const region of ["KR", "US"] as Region[]) {
    const g = scan.guards?.[currencyOfRegion(region)];
    if (!g?.blocked) continue;
    const date = dateOf(region, at);
    const why = g.notes.find((x) => x.tone === "bad")?.text ?? "리스크 한도에 닿았어요";
    if (pushAlert(store, { at: scan.at, category: "risk", key: `guard:${region}:${date}`, route: "/trade", text: `${region === "KR" ? "국내" : "미국"} 신규 매수를 멈췄어요. ${why}` })) n++;
  }
  return n;
}

/** 모의계좌 보유 종목 중 손절가에 가까워진 종목(남은 거리 ≤ NEAR_STOP_PCT%) 알림 */
export function positionAlerts(store: Store, at: Date): number {
  let n = 0;
  for (const cur of ["KRW", "USD"] as const) {
    for (const p of store.state.paper[cur].positions) {
      const px = p.lastPrice ?? p.entryPrice;
      if (!(px > 0) || !(p.stop > 0)) continue;
      const left = ((px - p.stop) / px) * 100;
      if (left > NEAR_STOP_PCT || left <= 0) continue;
      const date = dateOf(regionOfCode(p.code), at);
      if (
        pushAlert(store, {
          at: at.toISOString(), category: "risk", code: p.code, name: p.name, key: `nearstop:${p.code}:${date}`, route: "/trade",
          text: `${p.name} 손절가까지 ${fx(left, 1)}% 남았어요`,
        })
      )
        n++;
    }
  }
  return n;
}

/** 보유 종목의 오늘 공시 알림. disclosures는 종목별 공시 목록을 주는 함수(실패하면 건너뛴다) */
export async function disclosureAlerts(store: Store, at: Date, disclosures: (code: string) => Promise<Disclosure[]>): Promise<number> {
  let n = 0;
  const held = [...store.state.paper.KRW.positions, ...store.state.paper.USD.positions];
  for (const p of held) {
    const date = dateOf(regionOfCode(p.code), at);
    let list: Disclosure[] = [];
    try {
      list = await disclosures(p.code);
    } catch {
      continue;
    }
    for (const d of list.filter((x) => x.date === date))
      if (
        pushAlert(store, {
          at: at.toISOString(), category: "disclosure", code: p.code, name: p.name, key: `disc:${p.code}:${d.date}:${d.title}`, route: `/stocks/${p.code}/disclosure`,
          text: `${p.name} ${d.title}`,
        })
      )
        n++;
  }
  return n;
}
