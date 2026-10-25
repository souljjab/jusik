import { paperEquity, type Currency, type ServerState } from "@jusik/shared";

/* 주문 계산(순수 함수). 주문 검토 시트·종목 화면 미리 보기·매매 화면이 같은 식을 쓴다 */

/**
 * 매수 기본 수량: 1회 손실 한도(계좌 × riskPct) ÷ 주당 손절폭, 종목 비중 상한(maxWeightPct) 이내.
 * 비중 상한은 이미 가진 수량(held)까지 더한 '주문 뒤 그 종목 전체 비중'으로 본다(주문 검토의 비중 미터와 같은 뜻).
 * - 1회 손실 한도로는 1주도 못 사면(주당 손절폭이 한도보다 크면) 1주를 제안하고 overRisk로 알린다
 *   (비중 상한 수량으로 넘어가 손실 한도를 훌쩍 넘지 않게)
 * - 비중 상한 안에서 1주도 더 살 수 없으면 0주와 overWeight를 돌려준다(상한을 넘는 수량을 제안하지 않는다)
 */
export function defaultBuyQty(i: { capital: number; riskPct: number; maxWeightPct: number; price: number; stop: number; held?: number }): {
  qty: number;
  overRisk: boolean;
  /** 비중 상한 안에서 더 살 수 없어 0주를 제안했다(그럴 때만 있다) */
  overWeight?: true;
} {
  const perShare = i.price > 0 && i.stop > 0 && i.stop < i.price ? i.price - i.stop : 0;
  if (!(perShare > 0)) return { qty: 0, overRisk: false };
  // 계좌 금액을 모르면 1주를 제안해 주당 손실만이라도 보이게 한다
  if (!(i.capital > 0)) return { qty: 1, overRisk: false };
  const held = Math.max(0, Math.floor(i.held ?? 0));
  const byRisk = Math.floor((i.capital * i.riskPct) / 100 / perShare);
  const byWeight = Math.floor((i.capital * i.maxWeightPct) / 100 / i.price) - held;
  if (byWeight < 1) return { qty: 0, overRisk: false, overWeight: true };
  if (byRisk < 1) return { qty: 1, overRisk: true };
  return { qty: Math.min(byRisk, byWeight), overRisk: false };
}

/** 종목 비중 상한 안에서 더 살 수 있는 최대 수량(이미 가진 수량 포함 기준). 계산할 수 없으면 null */
export function maxQtyByCap(i: { capital: number; maxWeightPct: number | null | undefined; price: number; held?: number }): number | null {
  if (i.maxWeightPct == null || !(i.price > 0) || !(i.capital > 0)) return null;
  return Math.max(0, Math.floor((i.capital * i.maxWeightPct) / 100 / i.price) - Math.max(0, i.held ?? 0));
}

/**
 * 계좌 기준 금액: 모의매매를 켰으면 모의계좌 자산, 아니면 설정한 예수금.
 * 주문 검토의 '계좌 대비'·'주문 후 비중'과 매매 화면이 같은 기준을 쓴다(서버의 주문 전 점검도 같은 기준).
 */
export function accountBaseOf(st: Pick<ServerState, "settings" | "paper"> | null | undefined, cur: Currency): number {
  if (!st) return 0;
  const s = st.settings;
  return s.paperEnabled ? paperEquity(st.paper[cur]) : cur === "KRW" ? s.depositKRW : s.depositUSD;
}
