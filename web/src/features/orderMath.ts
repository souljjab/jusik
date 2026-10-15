import { paperEquity, type Currency, type ServerState } from "@jusik/shared";

/* 주문 계산(순수 함수). 주문 검토 시트·종목 화면 미리 보기·매매 화면이 같은 식을 쓴다 */

/**
 * 매수 기본 수량: 1회 손실 한도(계좌 × riskPct) ÷ 주당 손절폭, 종목 비중 상한(maxWeightPct) 이내.
 * 1회 손실 한도로는 1주도 못 사면(주당 손절폭이 한도보다 크면) 1주를 제안하고 overRisk로 알린다
 * (비중 상한 수량으로 넘어가 손실 한도를 훌쩍 넘지 않게). 주문 검토 시트와 종목 화면 미리 보기가 같이 쓴다.
 */
export function defaultBuyQty(i: { capital: number; riskPct: number; maxWeightPct: number; price: number; stop: number }): { qty: number; overRisk: boolean } {
  const perShare = i.price > 0 && i.stop > 0 && i.stop < i.price ? i.price - i.stop : 0;
  if (!(perShare > 0)) return { qty: 0, overRisk: false };
  // 계좌 금액을 모르면 1주를 제안해 주당 손실만이라도 보이게 한다
  if (!(i.capital > 0)) return { qty: 1, overRisk: false };
  const byRisk = Math.floor((i.capital * i.riskPct) / 100 / perShare);
  const byWeight = Math.floor((i.capital * i.maxWeightPct) / 100 / i.price);
  if (byRisk < 1) return { qty: byWeight >= 1 ? 1 : 0, overRisk: byWeight >= 1 };
  return { qty: Math.max(1, byWeight >= 1 ? Math.min(byRisk, byWeight) : byRisk), overRisk: false };
}

/**
 * 계좌 기준 금액: 모의매매를 켰으면 모의계좌 자산, 아니면 설정한 예수금.
 * 주문 검토의 '계좌 대비'·'주문 후 비중'과 매매 화면이 같은 기준을 쓴다.
 */
export function accountBaseOf(st: Pick<ServerState, "settings" | "paper"> | null | undefined, cur: Currency): number {
  if (!st) return 0;
  const s = st.settings;
  return s.paperEnabled ? paperEquity(st.paper[cur]) : cur === "KRW" ? s.depositKRW : s.depositUSD;
}
