import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { currencyOfRegion, josa, journalStrategyOf, regionOf, type Evidence, type Region, type Settings } from "@jusik/shared";
import type { StockData } from "../../api";
import { useApp } from "../../app/AppContext";
import { accountBaseOf, heldQty, type OrderRequest } from "../../features/OrderReviewSheet";
import { Button, fmtInt, fmtPct, fmtPnl, fmtPrice, fmtRatio, meterState, Segmented } from "../../ui";
import { clampStopPct, fmtInputPrice, orderPreview, parseInputPrice, STOP_SLIDER, stopFromPct, type OrderPlan, type OrderPreview } from "./stocksModel";

/*
 * 주문 미리 보기(UI 지도서 5.2 G·6.1 E·7.1 E). 위험을 버튼보다 먼저: 손절가('필수'), 손절 시 손실 금액, 계좌 대비 비율을 버튼 위에 둔다.
 * 버튼은 바로 체결하지 않고 주문 검토 시트(useActions().openOrderReview)만 연다. 이 앱은 증권사로 주문을 보내지 않는다.
 * 수량은 주문 검토 시트와 같은 식(1회 손실 한도 ÷ 손절폭, 이미 가진 수량을 더해 종목 비중 상한 이내)과 같은 계좌 기준(accountBaseOf: 모의매매를 켰으면
 * 모의계좌 자산, 아니면 예수금)으로 계산하고, 그 수량을 시트에 그대로 넘긴다 — 미리 보기와 시트의 숫자가 같다.
 * 한도를 넘는 경우(1주만 사도 1회 손실 한도 초과, 주문 후 비중 상한 근접·초과)도 시트처럼 경고색·아이콘·문장으로 버튼 위에 알린다.
 */

export interface OrderContext {
  code: string;
  name: string;
  region: Region;
  price: number;
  /** 계좌 기준 금액(그 시장 통화). 주문 검토 시트·매매 화면과 같은 기준 */
  capital: number;
  /** 계좌 기준이 모의계좌 자산인지(아니면 설정한 예수금) */
  paperBase: boolean;
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
    capital: accountBaseOf(server, currencyOfRegion(region)),
    paperBase: !!s?.paperEnabled,
    settings: s,
    held: heldQty(journal, data.info.code),
    plan: plan?.plan ?? null,
    evidence: plan?.evidence ?? null,
  };
}

/** 미리 보기 계산(주문 검토 시트와 같은 식) */
export const previewOf = (ctx: OrderContext, side: "BUY" | "SELL", price: number, stop: number) =>
  orderPreview({ side, price, stop, capital: ctx.capital, riskPct: ctx.settings?.riskPct ?? 1, maxWeightPct: ctx.settings?.maxWeightPct ?? 100, held: ctx.held });

/**
 * 주문 검토 시트에 넘길 요청. qty를 주면 시트가 그 수량으로 열린다(미리 보기와 같은 수량).
 * stop·target은 넘기지 않았을 때만 계획 값을 쓴다 — 사용자가 손절가를 지웠으면(0) 시트도 손절가 없이 열려 다시 정하게 한다.
 * 매수 신호의 근거·이유·전략은 매수 요청에만 붙인다(매도 일지에 매수 근거가 남지 않게).
 */
export function orderRequest(ctx: OrderContext, side: "BUY" | "SELL", v: { price?: number; stop?: number; target?: number | null; qty?: number } = {}): OrderRequest {
  const buy = side === "BUY";
  const ev = buy ? ctx.evidence : null;
  const stop = "stop" in v ? v.stop : ctx.plan?.stop;
  const target = "target" in v ? v.target : ctx.plan?.target;
  return {
    code: ctx.code,
    name: ctx.name,
    side,
    price: v.price ?? ctx.price,
    ...(buy && stop && stop > 0 ? { stop } : {}),
    ...(buy && target && target > 0 ? { target } : {}),
    ...(v.qty != null && v.qty > 0 ? { qty: v.qty } : {}),
    ...(ev ? { strategy: journalStrategyOf(ev.strategy), reason: `${ev.headline}, 근거 ${ev.met}/${ev.total} 충족`, evidence: ev } : {}),
  };
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const PLAN_LABEL = { weinstein: "와인스타인 참고 손절가", candle: "캔들마스터 신호 손절가", daytrade: "단타 후보 손절가" } as const;
/** 계좌 기준 문구 */
const baseWord = (ctx: OrderContext) => (ctx.paperBase ? "모의계좌 자산" : "예수금");

/** 슬라이더 비율 → 손절가 */
export const stopFromPctCtx = (ctx: OrderContext, pct: number) => stopFromPct(ctx.price, pct, ctx.region);

/** 경고 한 줄: 경고색 + 아이콘 + 문장(지도서 3.1) */
function WarnLine({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`warn-text t-cap stk-warnline ${className}`}>
      <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** 미리 보기의 한도 경고 문장(주문 검토 시트의 위험 상자와 같은 판정) */
export function previewWarnings(ctx: OrderContext, pv: OrderPreview): string[] {
  const s = ctx.settings;
  const out: string[] = [];
  if (pv.stopOk && pv.overRisk && s) out.push(`1주만 사도 1회 손실 한도 ${fmtRatio(s.riskPct)}를 넘어요`);
  if (pv.stopOk && pv.overWeight && s) out.push(`이미 가진 ${fmtInt(ctx.held)}주로 종목 비중 상한 ${fmtRatio(s.maxWeightPct, 0)}에 닿아 더 살 수 없어요`);
  else if (s) {
    const w = meterState(pv.weightAfter, s.maxWeightPct);
    if (w === "over") out.push(`주문 후 종목 비중이 상한 ${fmtRatio(s.maxWeightPct, 0)}를 넘어요`);
    else if (w === "near") out.push(`주문 후 종목 비중이 상한 ${fmtRatio(s.maxWeightPct, 0)}에 가까워요`);
  }
  return out;
}

/**
 * 컴퓨터 오른쪽 패널 아래 주문 상자(G). 가격·수량, 손절가(필수)·목표가를 두 칸씩, 그 아래 손절 시 손실과 계좌 대비를 버튼 바로 위에.
 * reviewRef에 검토 열기를 걸어 Ctrl(⌘)+Enter가 이 상자의 값으로 시트를 연다(시트만 열고 기록하지 않는다).
 * onLevels로 지금 상자의 손절·목표가를 알린다(차트의 손절·목표선이 이 값을 따른다).
 */
export function OrderBox({ ctx, onReview, reviewRef, onLevels }: {
  ctx: OrderContext;
  onReview: (r: OrderRequest) => void;
  reviewRef?: { current: (() => void) | null };
  onLevels?: (l: { stop: number; target: number }) => void;
}) {
  const id = useId();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [price, setPrice] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [priceDirty, setPriceDirty] = useState(false);
  // 직접 고친 손절·목표는 새 스캔·자동 새로고침으로 계획 값이 바뀌어도 덮어쓰지 않는다. 다른 신호(계획)를 고르면 다시 채운다
  const planSel = `${ctx.code}|${ctx.plan?.source ?? ""}`;
  const planKey = `${planSel}|${ctx.plan?.stop}|${ctx.plan?.target}`;
  const edited = useRef({ sel: planSel, stop: false, target: false });
  const planStopText = ctx.plan?.stop ? pxInput(ctx.plan.stop, ctx.region) : "";
  const planTargetText = ctx.plan?.target ? pxInput(ctx.plan.target, ctx.region) : "";

  useEffect(() => {
    const e = edited.current;
    if (e.sel !== planSel) Object.assign(e, { sel: planSel, stop: false, target: false });
    if (!e.stop) setStop(planStopText);
    if (!e.target) setTarget(planTargetText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);
  useEffect(() => setPriceDirty(false), [ctx.code]);
  useEffect(() => {
    if (!priceDirty) setPrice(fmtInputPrice(ctx.region === "US" ? ctx.price.toFixed(2) : String(ctx.price), ctx.region));
  }, [ctx.price, ctx.region, priceDirty]);

  const p = parseInputPrice(price), st = parseInputPrice(stop), tg = parseInputPrice(target);
  const fmtIn = (v: string) => fmtInputPrice(v, ctx.region);
  const pv = useMemo(() => previewOf(ctx, side, p, st), [ctx, side, p, st]);
  const buy = side === "BUY";
  const pct = (x: number) => (p > 0 && x > 0 ? fmtPct((x / p - 1) * 100) : "");
  // 손절가가 없거나 맞지 않으면 수량을 넘기지 않는다(시트가 손절가를 정한 뒤 다시 계산한다)
  const review = () => onReview(orderRequest(ctx, side, { price: p || undefined, stop: st, target: tg || null, qty: buy && !pv.stopOk ? undefined : pv.qty }));
  useEffect(() => {
    if (!reviewRef) return;
    reviewRef.current = review;
    return () => {
      reviewRef.current = null;
    };
  });
  useEffect(() => onLevels?.({ stop: st, target: tg }), [st, tg, onLevels]);
  const stopBad = st > 0 && !pv.stopOk;
  const fromPlan = !!ctx.plan && st > 0 && st === parseInputPrice(planStopText);
  const restoreStop = () => {
    edited.current.stop = false;
    setStop(planStopText);
  };
  const warns = buy ? previewWarnings(ctx, pv) : [];
  const weightState = meterState(pv.weightAfter, ctx.settings?.maxWeightPct);

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
        size="sm"
        className="stk-order-side"
        value={side}
        onChange={setSide}
        options={[{ value: "BUY", label: "매수" }, { value: "SELL", label: "매도" }]}
      />
      <div className="stk-order-grid">
        <div className="stk-order-f">
          <label htmlFor={`${id}-price`} className="t-2">
            가격
          </label>
          <input id={`${id}-price`} className="ui-input num" inputMode="decimal" value={price} onChange={(e) => (setPrice(fmtIn(e.target.value)), setPriceDirty(true))} />
        </div>
        <div className="stk-order-f">
          <span className="t-2" id={`${id}-qty-l`}>
            수량{!buy && <span className="t-cap"> · 보유 {fmtInt(ctx.held)}주</span>}
          </span>
          <span className="stk-order-qty num" aria-labelledby={`${id}-qty-l`} aria-live="polite">
            {fmtInt(pv.qty)}주
          </span>
        </div>

        {buy && (
          <>
            <div className="stk-order-f">
              <label htmlFor={`${id}-stop`} className="t-2 stk-order-lbl">
                손절가 <span className="stk-req">필수</span>
                <span className="t-cap num">{pct(st)}</span>
              </label>
              <input
                id={`${id}-stop`}
                className="ui-input num"
                inputMode="decimal"
                aria-required="true"
                aria-invalid={stopBad}
                aria-describedby={`${id}-stop-hint`}
                value={stop}
                onChange={(e) => {
                  edited.current.stop = true;
                  setStop(fmtIn(e.target.value));
                }}
              />
            </div>
            <div className="stk-order-f">
              <label htmlFor={`${id}-target`} className="t-2 stk-order-lbl">
                목표가 <span className="t-cap num">{pct(tg)}</span>
              </label>
              <input
                id={`${id}-target`}
                className="ui-input num"
                inputMode="decimal"
                value={target}
                onChange={(e) => {
                  edited.current.target = true;
                  setTarget(fmtIn(e.target.value));
                }}
              />
            </div>
            <div className="stk-order-hint">
              {!st || stopBad ? (
                <span id={`${id}-stop-hint`} className="warn-text stk-warnline">
                  <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
                  {!st ? "손절가를 넣어야 검토할 수 있어요. 매수 전에 손실 한도를 정해요" : "손절가는 가격보다 낮아야 해요"}
                </span>
              ) : (
                <span id={`${id}-stop-hint`} className="t-cap">
                  {fromPlan ? `${josa(PLAN_LABEL[ctx.plan!.source], "으로/로")} 채웠어요` : ctx.plan ? "직접 정한 손절가예요" : ""}
                </span>
              )}
              {ctx.plan && !fromPlan && (
                <Button variant="link" className="stk-order-restore" onClick={restoreStop}>
                  {josa(PLAN_LABEL[ctx.plan.source], "으로/로")} 되돌리기
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {buy ? (
        <>
          <dl className="stk-order-risk">
            <dt>손절 시 손실</dt>
            <dd className="num stk-order-loss">{pv.stopOk && pv.qty > 0 ? fmtPnl(-pv.loss, ctx.region) : "-"}</dd>
            <dt>
              계좌 대비 <span className="t-cap">{baseWord(ctx)} 기준</span>
            </dt>
            <dd className={`num ${pv.stopOk && pv.overRisk ? "warn-text" : ""}`}>{pv.lossPct == null || !pv.stopOk || !pv.qty ? "-" : fmtRatio(pv.lossPct, 1)}</dd>
            <dt>주문 후 종목 비중</dt>
            <dd className="num">
              <span className={weightState !== "normal" ? "warn-text" : ""}>{pv.weightAfter == null ? "-" : fmtRatio(pv.weightAfter, 1)}</span>
              {ctx.settings && <span className="t-cap"> / 상한 {fmtRatio(ctx.settings.maxWeightPct, 0)}</span>}
            </dd>
          </dl>
          {warns.map((w) => (
            <WarnLine key={w}>{w}</WarnLine>
          ))}
        </>
      ) : (
        <p className="t-cap">직접 기록한 보유 {fmtInt(ctx.held)}주 기준이에요. 모의계좌 보유는 서버가 규칙대로 자동 청산해요.</p>
      )}

      <Button type="submit" variant={buy ? "buy" : "sell"} size="lg" block aria-keyshortcuts={MAC ? "Meta+Enter" : "Control+Enter"}>
        {buy ? "매수 주문 검토" : "매도 주문 검토"}
      </Button>
      <p className="t-cap stk-order-foot">
        <span className="kbd">{MAC ? "⌘ Enter" : "Ctrl Enter"}</span>
        검토 시트에서 한 번 더 확인해요. 증권사로 주문을 보내지 않아요.
      </p>
    </form>
  );
}

/** 입력칸 처음 값(국내 원 단위 정수 + 쉼표, 미국 소수 둘째 자리) */
const pxInput = (n: number, region: Region) => fmtInputPrice(region === "US" ? n.toFixed(2) : String(Math.round(n)), region);

/** 계획 손절가 → 슬라이더 비율(-15~-1%) */
export const stopPctOf = (ctx: OrderContext) => clampStopPct(ctx.plan && ctx.price > 0 && ctx.plan.stop > 0 ? (ctx.plan.stop / ctx.price - 1) * 100 : -8);

/** 태블릿 '매수 주문 검토': 슬라이더 손절가와 그 수량으로 검토 시트를 연다 */
export function tabletRequest(ctx: OrderContext, stopPct: number): OrderRequest {
  const stop = stopFromPctCtx(ctx, stopPct);
  const pv = previewOf(ctx, "BUY", ctx.price, stop);
  return orderRequest(ctx, "BUY", { stop, qty: pv.stopOk ? pv.qty : undefined });
}

/** 태블릿 포지션 계산(E): 손절가 슬라이더를 움직이면 수량과 예상 손실이 바로 다시 계산된다 */
export function PositionCalc({ ctx, stopPct, onStopPct }: { ctx: OrderContext; stopPct: number; onStopPct: (n: number) => void }) {
  const id = useId();
  const stop = stopFromPct(ctx.price, stopPct, ctx.region);
  const pv = previewOf(ctx, "BUY", ctx.price, stop);
  const realPct = pv.stopPct ?? stopPct;
  const warns = previewWarnings(ctx, pv);
  return (
    <section className="stk-poscalc" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="t-section">
        포지션 계산
      </h3>
      <div className="stack" style={{ gap: 4 }}>
        <div className="row between base wrap">
          <label htmlFor={`${id}-stop`} className="t-2">
            손절가 <span className="stk-req">필수</span>
          </label>
          <span className="num t-medium">
            {fmtPrice(stop, ctx.region)} <span className="t-2">({fmtPct(realPct)})</span>
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
          aria-valuetext={`손절가 ${fmtPrice(stop, ctx.region, { unit: true })}, ${fmtPct(realPct)}`}
          onChange={(e) => onStopPct(clampStopPct(Number(e.target.value)))}
        />
        <div className="row between t-cap" aria-hidden="true">
          <span>{fmtRatio(STOP_SLIDER.min, 0)}</span>
          <span>{fmtRatio(STOP_SLIDER.max, 0)}</span>
        </div>
      </div>
      <dl className="stk-order-risk">
        <dt>수량</dt>
        <dd className="num">{fmtInt(pv.qty)}주</dd>
        <dt>손절 시 손실</dt>
        <dd className="num">
          {pv.qty > 0 ? fmtPnl(-pv.loss, ctx.region) : "-"}
          {pv.lossPct != null && pv.qty > 0 && <span className={pv.overRisk ? "warn-text" : "t-2"}>, 계좌 {fmtRatio(pv.lossPct, 1)}</span>}
        </dd>
      </dl>
      {warns.map((w) => (
        <WarnLine key={w}>{w}</WarnLine>
      ))}
      <p className="t-cap">
        {baseWord(ctx)} 기준 1회 손실 한도 {ctx.settings ? fmtRatio(ctx.settings.riskPct) : "-"}와 종목 비중 상한 {ctx.settings ? fmtRatio(ctx.settings.maxWeightPct, 0) : "-"} 안에서 계산했어요.
        {ctx.plan ? ` 처음 값은 ${PLAN_LABEL[ctx.plan.source]}예요.` : ""}
      </p>
    </section>
  );
}

/** 핸드폰·태블릿 세로 아래 고정 주문 줄(지도서 7.1 E·6.2 B): 위험 한 줄 + 매도(왼쪽)·매수(오른쪽) 주문 검토 */
export function MobileOrderBar({ ctx, onReview }: { ctx: OrderContext; onReview: (r: OrderRequest) => void }) {
  const stop = ctx.plan?.stop ?? 0;
  const pv = previewOf(ctx, "BUY", ctx.price, stop);
  const warn = pv.stopOk && (pv.overRisk || pv.overWeight || meterState(pv.weightAfter, ctx.settings?.maxWeightPct) === "over");
  return (
    <div className="stk-mbar" role="region" aria-label="주문">
      <p className="t-cap stk-mbar-risk">
        {pv.stopOk ? (
          <>
            손절가 <span className="num">{fmtPrice(stop, ctx.region)}</span>({fmtPct(pv.stopPct)}) · 손실 <span className="num">{pv.qty > 0 ? fmtPnl(-pv.loss, ctx.region) : "-"}</span>
            {pv.lossPct != null && pv.qty > 0 && (
              <span className={pv.overRisk ? "warn-text" : ""}>, 계좌 {fmtRatio(pv.lossPct, 1)}</span>
            )}
          </>
        ) : (
          "손절가는 주문 검토에서 정해요"
        )}
        <span> · 보유 {fmtInt(ctx.held)}주</span>
        {warn && (
          <span className="warn-text stk-mbar-warn">
            <AlertTriangle size={12} strokeWidth={1.5} aria-hidden="true" /> {pv.overRisk ? "1회 손실 한도 초과" : "비중 상한 초과"}
          </span>
        )}
      </p>
      <div className="stk-mbar-btns">
        <Button variant="sell" size="lg" block onClick={() => onReview(orderRequest(ctx, "SELL"))}>
          매도 주문 검토
        </Button>
        <Button variant="buy" size="lg" block onClick={() => onReview(orderRequest(ctx, "BUY", { qty: pv.stopOk ? pv.qty : undefined }))}>
          매수 주문 검토
        </Button>
      </div>
    </div>
  );
}
