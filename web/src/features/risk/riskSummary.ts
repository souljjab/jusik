import { paperEquity, type Currency, type PaperPosition, type ServerState } from "@jusik/shared";

/*
 * 리스크 요약(UI 지도서 5.1 E, 7.1 B): 주식 비중과 상한, 오늘 손익과 일일 한도, 손절가 근접 종목.
 * 모의계좌 기준이다(앱이 실제 계좌를 모른다). 모의매매를 꺼 두면 보유가 없어서 비중 0%로 보인다.
 */

/** 손절가까지 남은 거리가 이 비율(%) 이하면 '손절가 근접'(서버 알림 NEAR_STOP_PCT와 같은 값) */
export const NEAR_STOP_PCT = 2;

export interface NearStop {
  position: PaperPosition;
  currency: Currency;
  /** 손절가까지 남은 거리(%) */
  leftPct: number;
}

export interface CurrencyRisk {
  currency: Currency;
  equity: number;
  heldValue: number;
  /** 주식 비중(%) */
  weightPct: number;
  /** 국면별 주식 비중 상한(%) — 마지막 스캔에서 적용한 값, 없으면 중립 상한 */
  capPct: number;
  /** 오늘 손익(%) — 하루 시작 자산 대비. 오늘 장 기록이 없으면 null */
  todayPct: number | null;
  todayPnl: number | null;
  /** 일일 손실 한도(%) — 음수로 돌려준다(예: −2). 0이면 끔 → null */
  dailyLimitPct: number | null;
  /** 신규 매수가 잠겼는지(일일 손실 한도·연속 손실) */
  blocked: boolean;
  blockReason: string | null;
  positions: PaperPosition[];
}

export interface RiskSummary {
  KRW: CurrencyRisk;
  USD: CurrencyRisk;
  nearStop: NearStop[];
}

export function leftToStopPct(p: PaperPosition): number | null {
  const px = p.lastPrice ?? p.entryPrice;
  if (!(px > 0) || !(p.stop > 0)) return null;
  return ((px - p.stop) / px) * 100;
}

export function riskSummary(st: ServerState): RiskSummary {
  const s = st.settings;
  const one = (cur: Currency): CurrencyRisk => {
    const acct = st.paper[cur];
    const equity = paperEquity(acct);
    const heldValue = equity - acct.cash;
    const t = st.todayPnl?.[cur] ?? null;
    const g = st.latestScan?.guards?.[cur];
    return {
      currency: cur,
      equity,
      heldValue,
      weightPct: equity > 0 ? (heldValue / equity) * 100 : 0,
      capPct: st.latestScan?.exposureCaps?.[cur] ?? s.postureCaps.NEUTRAL,
      todayPct: t ? t.pct : null,
      todayPnl: t ? t.pnl : null,
      dailyLimitPct: s.dailyLossLimitPct > 0 ? -s.dailyLossLimitPct : null,
      blocked: !!g?.blocked,
      blockReason: g?.blocked ? (g.notes.find((n) => n.tone === "bad")?.text ?? "리스크 한도에 닿았어요") : null,
      positions: acct.positions,
    };
  };
  const nearStop: NearStop[] = [];
  for (const cur of ["KRW", "USD"] as const)
    for (const p of st.paper[cur].positions) {
      const left = leftToStopPct(p);
      if (left != null && left <= NEAR_STOP_PCT) nearStop.push({ position: p, currency: cur, leftPct: left });
    }
  nearStop.sort((a, b) => a.leftPct - b.leftPct);
  return { KRW: one("KRW"), USD: one("USD"), nearStop };
}
