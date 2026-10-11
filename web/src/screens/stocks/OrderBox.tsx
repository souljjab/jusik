import { useEffect, useId, useMemo, useState } from "react";
import { regionOf, type Evidence, type Region, type Settings } from "@jusik/shared";
import type { StockData } from "../../api";
import { useApp } from "../../app/AppContext";
import { heldQty, type OrderRequest } from "../../features/OrderReviewSheet";
import { Button, fmtInt, fmtPct, fmtPnl, fmtPrice, fmtRatio, Segmented } from "../../ui";
import { clampStopPct, orderPreview, STOP_SLIDER, stopFromPct, type OrderPlan } from "./stocksModel";

/*
 * 주문 미리 보기(UI 지도서 5.2 G·6.1 E·7.1 E). 위험을 버튼보다 먼저: 손절가('필수'), 손절 시 손실 금액, 계좌 대비 비율을 버튼 위에 둔다.
 * 버튼은 바로 체결하지 않고 주문 검토 시트(useActions().openOrderReview)만 연다. 이 앱은 증권사로 주문을 보내지 않는다.
 * 수량은 주문 검토 시트와 같은 식(1회 손실 한도 ÷ 손절폭, 종목 비중 상한 이내)으로 계산한다 — 시트가 같은 수량으로 열린다.
 */

export interface OrderContext {
  code: string;
  name: string;
  region: Region;
  price: number;
  capital: number;
  settings: Settings | null;
  held: number;
  plan: OrderPlan | null;
  evidence: Evidence | null;
}

export function useOrderContext(data: StockData, plan: { plan: OrderPlan; evidence: Evidence } | null): OrderContext {
  const { server, journal } = useApp();
  const region = regionOf(data.info.market);
  const s = server?.settings ?? null;
  return {
    code: data.info.code,
    name: data.info.name,
    region,
    price: data.quote.price,
    capital: s ? (region === "US" ? s.depositUSD : s.depositKRW) : 0,
    settings: s,
    held: heldQty(journal, data.info.code),
    plan: plan?.plan ?? null,
    evidence: plan?.evidence ?? null,
  };
}

/** 주문 검토 시트에 넘길 요청 */
export function orderRequest(ctx: OrderContext, side: "BUY" | "SELL", v: { price?: number; stop?: number; target?: number | null } = {}): OrderRequest {
  const ev = ctx.evidence;
  const stop = v.stop ?? ctx.plan?.stop;
  const target = v.target === undefined ? ctx.plan?.target : v.target;
  return {
    code: ctx.code,
    name: ctx.name,
    side,
    price: v.price ?? ctx.price,
    ...(side === "BUY" && stop && stop > 0 ? { stop } : {}),
    ...(side === "BUY" && target && target > 0 ? { target } : {}),
    ...(ev ? { strategy: ev.strategyName, reason: `${ev.headline}, 근거 ${ev.met}/${ev.total} 충족`, evidence: ev } : {}),
  };
}

const num = (s: string) => {
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const PLAN_LABEL = { weinstein: "와인스타인 참고 손절가", candle: "캔들마스터 신호 손절가", daytrade: "단타 후보 손절가" } as const;

/** 슬라이더 비율 → 손절가 */
export const stopFromPctCtx = (ctx: OrderContext, pct: number) => stopFromPct(ctx.price, pct, ctx.region);

/** 컴퓨터 오른쪽 패널 아래 주문 상자(G). reviewRef에 검토 열기를 걸어 Ctrl(⌘)+Enter가 이 상자의 값으로 시트를 연다 */
export function OrderBox({ ctx, onReview, reviewRef }: { ctx: OrderContext; onReview: (r: OrderRequest) => void; reviewRef?: { current: (() => void) | null } }) {
  const id = useId();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [price, setPrice] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [priceDirty, setPriceDirty] = useState(false);
  const planKey = `${ctx.code}|${ctx.plan?.source}|${ctx.plan?.stop}|${ctx.plan?.target}`;

  // 신호(계획)가 바뀌면 손절·목표를 다시 채운다. 가격은 직접 고치지 않았으면 현재가를 따라간다
  useEffect(() => {
    setStop(ctx.plan?.stop ? String(roundPx(ctx.plan.stop, ctx.region)) : "");
    setTarget(ctx.plan?.target ? String(roundPx(ctx.plan.target, ctx.region)) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);
  useEffect(() => setPriceDirty(false), [ctx.code]);
  useEffect(() => {
    if (!priceDirty) setPrice(String(ctx.price));
  }, [ctx.price, priceDirty]);

  const p = num(price), st = num(stop), tg = num(target);
  const pv = useMemo(
    () => orderPreview({ side, price: p, stop: st, capital: ctx.capital, riskPct: ctx.settings?.riskPct ?? 1, maxWeightPct: ctx.settings?.maxWeightPct ?? 100, held: ctx.held }),
    [side, p, st, ctx.capital, ctx.settings, ctx.held],
  );
  const buy = side === "BUY";
  const pct = (x: number) => (p > 0 && x > 0 ? fmtPct((x / p - 1) * 100, 1) : "");
  const review = () => onReview(orderRequest(ctx, side, { price: p || undefined, stop: st || undefined, target: tg || null }));
  useEffect(() => {
    if (!reviewRef) return;
    reviewRef.current = review;
    return () => {
      reviewRef.current = null;
    };
  });

  return (
    <form
      className="stk-order"
      aria-label="주문 미리 보기"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      <Segmented
        label="주문 방향"
        className="stk-order-side"
        value={side}
        onChange={setSide}
        options={[{ value: "BUY", label: "매수" }, { value: "SELL", label: "매도" }]}
      />
      <div className="stk-order-grid">
        <label htmlFor={`${id}-price`} className="t-2">
          가격
        </label>
        <input id={`${id}-price`} className="ui-input num" inputMode="decimal" value={price} onChange={(e) => (setPrice(e.target.value), setPriceDirty(true))} />

        <span className="t-2">수량</span>
        <span className="num t-medium right" aria-live="polite">
          {fmtInt(pv.qty)}주{!buy && <span className="t-cap"> (보유 {fmtInt(ctx.held)}주)</span>}
        </span>

        {buy && (
          <>
            <label htmlFor={`${id}-stop`} className="t-2 stk-order-lbl">
              손절가 <span className="stk-req">필수</span>
              <span className="t-cap num">{pct(st)}</span>
            </label>
            <input
              id={`${id}-stop`}
              className="ui-input num"
              inputMode="decimal"
              aria-required="true"
              aria-invalid={st > 0 && !pv.stopOk}
              aria-describedby={`${id}-stop-hint`}
              value={stop}
              onChange={(e) => setStop(e.target.value)}
            />
            <span id={`${id}-stop-hint`} className={`stk-order-hint ${st > 0 && !pv.stopOk ? "warn-text" : "t-cap"}`}>
              {!st ? "매수 전에 손실 한도를 정해요" : !pv.stopOk ? "손절가는 가격보다 낮아야 해요" : ctx.plan ? `${PLAN_LABEL[ctx.plan.source]}로 채웠어요` : ""}
            </span>
            <label htmlFor={`${id}-target`} className="t-2 stk-order-lbl">
              목표가 <span className="t-cap num">{pct(tg)}</span>
            </label>
            <input id={`${id}-target`} className="ui-input num" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </>
        )}
      </div>

      {buy ? (
        <dl className="stk-order-risk">
          <dt>손절 시 손실</dt>
          <dd className="num">{pv.stopOk && pv.qty > 0 ? fmtPnl(-pv.loss, ctx.region) : "-"}</dd>
          <dt>계좌 대비</dt>
          <dd className="num">{pv.lossPct == null || !pv.stopOk ? "-" : fmtRatio(pv.lossPct, 1)}</dd>
          <dt>주문 후 종목 비중</dt>
          <dd className="num">
            {pv.weightAfter == null ? "-" : fmtRatio(pv.weightAfter, 1)}
            {ctx.settings && <span className="t-cap"> / 상한 {fmtRatio(ctx.settings.maxWeightPct, 0)}</span>}
          </dd>
        </dl>
      ) : (
        <p className="t-cap">직접 기록한 보유 {fmtInt(ctx.held)}주 기준이에요. 모의계좌 보유는 서버가 규칙대로 자동 청산해요.</p>
      )}

      <Button type="submit" variant={buy ? "buy" : "sell"} size="lg" block>
        {buy ? "매수 주문 검토" : "매도 주문 검토"}
      </Button>
      <p className="t-cap stk-order-foot">
        <span className="kbd">{MAC ? "⌘ Enter" : "Ctrl Enter"}</span> 검토 시트에서 한 번 더 확인해요. 증권사로 주문을 보내지 않아요.
      </p>
    </form>
  );
}

/** 가격 단위 맞추기(국내 원 단위 정수, 미국 센트) */
export const roundPx = (n: number, region: Region) => (region === "US" ? Math.round(n * 100) / 100 : Math.round(n));

/** 계획 손절가 → 슬라이더 비율(−15~−1%) */
export const stopPctOf = (ctx: OrderContext) => clampStopPct(ctx.plan && ctx.price > 0 && ctx.plan.stop > 0 ? (ctx.plan.stop / ctx.price - 1) * 100 : -8);

/** 태블릿 포지션 계산(E): 손절가 슬라이더를 움직이면 수량과 예상 손실이 바로 다시 계산된다 */
export function PositionCalc({ ctx, stopPct, onStopPct }: { ctx: OrderContext; stopPct: number; onStopPct: (n: number) => void }) {
  const id = useId();
  const stop = stopFromPct(ctx.price, stopPct, ctx.region);
  const pv = orderPreview({ side: "BUY", price: ctx.price, stop, capital: ctx.capital, riskPct: ctx.settings?.riskPct ?? 1, maxWeightPct: ctx.settings?.maxWeightPct ?? 100, held: ctx.held });
  const realPct = pv.stopPct ?? stopPct;
  return (
    <section className="stk-poscalc" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="t-section">
        포지션 계산
      </h3>
      <div className="stack" style={{ gap: 4 }}>
        <div className="row between base">
          <label htmlFor={`${id}-stop`} className="t-2">
            손절가 <span className="stk-req">필수</span>
          </label>
          <span className="num t-medium">
            {fmtPrice(stop, ctx.region)} <span className="t-2">({fmtPct(realPct, 1)})</span>
          </span>
        </div>
        <input
          id={`${id}-stop`}
          type="range"
          className="stk-range"
          min={STOP_SLIDER.min}
          max={STOP_SLIDER.max}
          step={STOP_SLIDER.step}
          value={stopPct}
          aria-valuetext={`손절가 ${fmtPrice(stop, ctx.region, { unit: true })}, ${fmtPct(realPct, 1)}`}
          onChange={(e) => onStopPct(clampStopPct(Number(e.target.value)))}
        />
        <div className="row between t-cap" aria-hidden="true">
          <span>−15%</span>
          <span>−1%</span>
        </div>
      </div>
      <dl className="stk-order-risk">
        <dt>수량</dt>
        <dd className="num">{fmtInt(pv.qty)}주</dd>
        <dt>손절 시 손실</dt>
        <dd className="num">
          {pv.qty > 0 ? fmtPnl(-pv.loss, ctx.region) : "-"}
          {pv.lossPct != null && pv.qty > 0 && <span className="t-2">, 계좌 {fmtRatio(pv.lossPct, 1)}</span>}
        </dd>
      </dl>
      <p className="t-cap">
        1회 손실 한도 {ctx.settings?.riskPct ?? "-"}%와 종목 비중 상한 {ctx.settings?.maxWeightPct ?? "-"}% 안에서 계산했어요.
        {ctx.plan ? ` 처음 값은 ${PLAN_LABEL[ctx.plan.source]}예요.` : ""}
      </p>
    </section>
  );
}

/** 핸드폰·태블릿 세로 아래 고정 주문 줄(지도서 7.1 E·6.2 B): 위험 한 줄 + 매도(왼쪽)·매수(오른쪽) */
export function MobileOrderBar({ ctx, onReview }: { ctx: OrderContext; onReview: (r: OrderRequest) => void }) {
  const stop = ctx.plan?.stop ?? 0;
  const pv = orderPreview({ side: "BUY", price: ctx.price, stop, capital: ctx.capital, riskPct: ctx.settings?.riskPct ?? 1, maxWeightPct: ctx.settings?.maxWeightPct ?? 100, held: ctx.held });
  return (
    <div className="stk-mbar" role="region" aria-label="주문">
      <p className="t-cap stk-mbar-risk">
        {pv.stopOk ? (
          <>
            손절가 <span className="num">{fmtPrice(stop, ctx.region)}</span>({fmtPct(pv.stopPct, 1)}) · 손실 <span className="num">{fmtPnl(-pv.loss, ctx.region)}</span>
            {pv.lossPct != null && <>, 계좌 {fmtRatio(pv.lossPct, 1)}</>}
          </>
        ) : (
          "손절가는 주문 검토에서 정해요"
        )}
        <span> · 보유 {fmtInt(ctx.held)}주</span>
      </p>
      <div className="stk-mbar-btns">
        <Button variant="sell" size="lg" block onClick={() => onReview(orderRequest(ctx, "SELL"))}>
          매도
        </Button>
        <Button variant="buy" size="lg" block onClick={() => onReview(orderRequest(ctx, "BUY"))}>
          매수
        </Button>
      </div>
    </div>
  );
}

