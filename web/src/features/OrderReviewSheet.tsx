import { AlertTriangle, Check, Minus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { currencyOfRegion, marketClock, regionOfCode, type Evidence, type JournalCheck, type JournalEntry } from "@jusik/shared";
import { addJournal, checkJournal, type JournalInput } from "../api";
import { useApp } from "../app/AppContext";
import {
  Button, Chip, EvidenceStrip, Field, fmtPct, fmtPnl, fmtPrice, fmtRatio, meterState, Notice, NumberStepper, RiskMeter, Sheet, useToast,
} from "../ui";

/*
 * 주문 검토 시트(UI 지도서 5.2 G·7.1 F~H·9.3).
 * 이 앱은 증권사와 연결돼 있지 않아 실제 주문을 내지 않는다. '확인'하면 매매일지에 주문을 기록하고,
 * 실제 주문은 사용자가 증권사 앱에서 낸다(확인 메시지도 그렇게 말한다).
 *  - 손절가 필수: 없으면 확인 버튼이 꺼진다
 *  - 위험 상자: 손절 시 예상 손실(가장 크게), 계좌 대비 비율, 주문 후 종목 비중과 상한
 *  - 규칙 체크 세 가지(손절가 설정·종목 비중 상한 이내·오늘 손실 한도 이내)가 모두 통과해야 '매수 확인'이 켜진다
 *  - 상한 초과면 수량을 줄여 제안, 손실 중 추가 매수면 사전 계획이었는지 묻는다, 연속 손실 휴식이면 '오늘은 기록만'을 권한다
 */

export interface OrderRequest {
  code: string;
  name?: string;
  side: "BUY" | "SELL";
  /** 지정가(없으면 현재가를 넣어 주세요) */
  price?: number;
  stop?: number;
  target?: number;
  strategy?: string;
  reason?: string;
  evidence?: Evidence;
}

/** 직접 쓴 일지 기준으로 지금 보유 수량(매수 − 매도) */
export function heldQty(journal: JournalEntry[], code: string): number {
  return journal.filter((e) => e.code === code && (e.source ?? "수동") === "수동").reduce((q, e) => q + (e.side === "BUY" ? e.qty : -e.qty), 0);
}

function CheckRow({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <li className="row top" style={{ gap: 8, padding: "6px 0" }}>
      {ok == null ? <Minus size={16} className="muted" aria-hidden="true" /> : ok ? <Check size={16} className="accent-text" aria-hidden="true" /> : <AlertTriangle size={16} className="warn-text" aria-hidden="true" />}
      <span className="stack" style={{ gap: 0 }}>
        <span className={ok === false ? "warn-text t-medium" : ""}>
          {label}
          <span className="sr-only">{ok == null ? " 확인 전" : ok ? " 통과" : " 통과 못 함"}</span>
        </span>
        {detail && <span className="t-cap">{detail}</span>}
      </span>
    </li>
  );
}

export function OrderReviewSheet({ req, onClose }: { req: OrderRequest | null; onClose: () => void }) {
  const { server, journal, now, refreshJournal } = useApp();
  const toast = useToast();
  const region = req ? regionOfCode(req.code) : "KR";
  const cur = currencyOfRegion(region);
  const s = server?.settings;
  const deposit = s ? (cur === "KRW" ? s.depositKRW : s.depositUSD) : 0;
  const guard = server?.latestScan?.guards?.[cur] ?? null;
  const held = req ? heldQty(journal, req.code) : 0;

  const [price, setPrice] = useState(0);
  const [stop, setStop] = useState(0);
  const [target, setTarget] = useState(0);
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState("");
  const [planned, setPlanned] = useState<boolean | null>(null);
  const [check, setCheck] = useState<JournalCheck | null>(null);
  const [busy, setBusy] = useState(false);

  // 시트를 열 때마다 값을 새로 채운다. 기본 수량 = 1회 손실 한도(예수금 × riskPct) ÷ 주당 손절폭, 종목 비중 상한 이내
  useEffect(() => {
    if (!req) return;
    const p = req.price ?? 0;
    setPrice(p);
    setStop(req.stop ?? 0);
    setTarget(req.target ?? 0);
    setReason(req.reason ?? "");
    setPlanned(null);
    setCheck(null);
    if (req.side === "SELL") return setQty(Math.max(0, held));
    const risk = s && deposit ? (deposit * s.riskPct) / 100 : 0;
    const perShare = req.stop && p > req.stop ? p - req.stop : 0;
    const byRisk = perShare > 0 ? Math.floor(risk / perShare) : 0;
    const byWeight = s && p > 0 ? Math.floor((deposit * s.maxWeightPct) / 100 / p) : 0;
    setQty(Math.max(perShare > 0 ? 1 : 0, Math.min(byRisk || byWeight, byWeight || byRisk)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  const buy = req?.side === "BUY";
  const stopOk = buy ? stop > 0 && price > 0 && stop < price : true;
  const lossPerShare = stopOk && buy ? price - stop : 0;
  const loss = lossPerShare * qty;
  const lossPctOfAccount = deposit > 0 ? (loss / deposit) * 100 : null;
  const afterWeight = deposit > 0 && price > 0 ? (((buy ? held + qty : Math.max(0, held - qty)) * price) / deposit) * 100 : null;
  const cap = s?.maxWeightPct ?? null;
  const weightState = meterState(afterWeight, cap);
  const weightOk = !buy || weightState !== "over";
  const guardOk = !buy || !guard?.blocked;
  const streak = guard?.notes.find((n) => /연속 손실/.test(n.text));
  const maxQtyByCap = cap != null && price > 0 ? Math.max(0, Math.floor((deposit * cap) / 100 / price) - held) : null;

  // 서버 점검(손실 중 추가 매수 등)을 미리 본다
  const input = useMemo<JournalInput | null>(() => {
    if (!req || !(price > 0) || !(qty > 0)) return null;
    return {
      code: req.code, side: req.side, price, qty, date: marketClock(region, now).date,
      ...(stop > 0 ? { stop } : {}), ...(target > 0 ? { target } : {}), reason, ...(req.strategy ? { strategy: req.strategy } : {}),
      ...(afterWeight != null ? { weightPct: Math.round(afterWeight * 10) / 10 } : {}),
    };
  }, [req, price, qty, stop, target, reason, region, now, afterWeight]);
  useEffect(() => {
    if (!input || input.side !== "BUY") return setCheck(null);
    let alive = true;
    const t = setTimeout(() => checkJournal(input).then((c) => alive && setCheck(c)).catch(() => alive && setCheck(null)), 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [input]);
  const averaging = check?.notes.find((n) => n.text.includes("손실 중 추가 매수") || n.text.includes("평균 단가"));
  const needsPlanAnswer = buy && !!averaging && averaging.tone !== "info";

  const canConfirm = !!input && !busy && (buy ? stopOk && weightOk && guardOk && (!needsPlanAnswer || planned != null) : qty > 0 && qty <= Math.max(held, qty));

  const confirm = async () => {
    if (!input || !req) return;
    setBusy(true);
    try {
      const body: JournalInput = {
        ...input,
        ...(buy ? { selfCheck: { stopSet: stopOk, weightOk, unplanned: needsPlanAnswer ? planned === false : false } } : {}),
        ...(needsPlanAnswer && planned ? { plannedAdd: true } : {}),
      };
      const r = await addJournal(body);
      await refreshJournal();
      try {
        navigator.vibrate?.(20);
      } catch {
        /* 진동을 못 쓰는 기기 */
      }
      toast(r.check.violations.length ? `주문을 기록했어요. 규칙 위반 ${r.check.violations.length}건도 함께 남겼어요` : "주문을 기록했어요. 실제 주문은 증권사 앱에서 내세요", r.check.violations.length ? "warn" : "ok");
      onClose();
    } catch (e) {
      toast(`기록하지 못했어요. ${e instanceof Error ? e.message : ""}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  const title = buy ? "매수 주문 검토" : "매도 주문 검토";
  const pct = (x: number) => (price > 0 ? ((x - price) / price) * 100 : null);
  const pxStep = region === "US" ? 0.01 : 1;

  return (
    <Sheet
      open={!!req}
      onClose={onClose}
      title={title}
      initialFocus="#order-qty"
      footer={
        <div className="stack">
          {!canConfirm && buy && !busy && (
            <span className="t-cap">{!stopOk ? "손절가를 넣어야 확인할 수 있어요" : !weightOk ? "종목 비중이 상한을 넘어요. 수량을 줄여 주세요" : !guardOk ? "오늘은 신규 매수가 잠겨 있어요" : needsPlanAnswer && planned == null ? "추가 매수가 계획이었는지 골라 주세요" : ""}</span>
          )}
          <Button variant={buy ? "buy" : "sell"} size="lg" block disabled={!canConfirm} busy={busy} onClick={confirm}>
            {buy ? "매수 확인" : "매도 확인"}
          </Button>
          <span className="t-cap" style={{ textAlign: "center" }}>증권사에 주문을 보내지 않아요. 확인하면 매매일지에 기록돼요.</span>
        </div>
      }
    >
      {req && (
        <div className="stack-4">
          <div className="row between">
            <span className="t-2">
              {req.name ?? req.code}, 지정가{req.strategy ? ` · ${req.strategy}` : ""}
            </span>
            {req.evidence && <EvidenceStrip evidence={req.evidence} />}
          </div>

          <div className="stack-3">
            <Field label="가격" htmlFor="order-price">
              <input id="order-price" className="ui-input num" inputMode="decimal" value={price || ""} onChange={(e) => setPrice(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} step={pxStep} />
            </Field>
            <Field label={`수량${buy && held > 0 ? ` (보유 ${held}주)` : ""}`} htmlFor="order-qty">
              <NumberStepper id="order-qty" label="수량" value={qty} onChange={setQty} min={0} max={buy ? undefined : held} unit="주" />
            </Field>
            {buy && (
              <Field
                label="손절가"
                required
                htmlFor="order-stop"
                error={stop > 0 && !stopOk ? "손절가는 가격보다 낮아야 해요" : undefined}
                hint={stopOk ? `${fmtPct(pct(stop))} · ${fmtPrice(stop, region, { unit: true })}` : "매수 전에 손실 한도를 정해요"}
              >
                <input id="order-stop" className="ui-input num" inputMode="decimal" aria-invalid={stop > 0 && !stopOk} value={stop || ""} onChange={(e) => setStop(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} />
              </Field>
            )}
            {buy && (
              <Field label="목표가" htmlFor="order-target" hint={target > 0 ? `${fmtPct(pct(target))} · ${fmtPrice(target, region, { unit: true })}` : "선택"}>
                <input id="order-target" className="ui-input num" inputMode="decimal" value={target || ""} onChange={(e) => setTarget(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} />
              </Field>
            )}
            <Field label={buy ? "진입 근거" : "매도 이유"} htmlFor="order-reason">
              <input id="order-reason" className="ui-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={buy ? "예: 30주선 돌파, 거래량 2.3배" : "예: 목표가 도달"} />
            </Field>
          </div>

          {buy && (
            <div className="ui-panel flat stack-3" aria-label="위험 상자">
              <div className="row between base">
                <span className="t-2">손절 시 예상 손실</span>
                <span className="t-cap">계좌의 {lossPctOfAccount == null ? "-" : fmtRatio(lossPctOfAccount)}</span>
              </div>
              <span className="t-price">{stopOk && qty > 0 ? fmtPnl(-loss, region) : "-"}</span>
              <RiskMeter label="주문 후 종목 비중" value={afterWeight} limit={cap} format={(n) => fmtRatio(n)} limitLabel={cap != null ? `상한 ${fmtRatio(cap)}` : undefined} overText="상한 초과" />
              {weightState === "over" && maxQtyByCap != null && maxQtyByCap > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setQty(maxQtyByCap)}>
                  수량을 {maxQtyByCap}주로 줄이기
                </Button>
              )}
            </div>
          )}

          {buy && needsPlanAnswer && (
            <div className="stack">
              <Notice tone="warn" title="손실 중인 종목을 더 사요">
                {averaging!.text}
              </Notice>
              <span className="t-2">처음부터 계획한 분할 매수였나요?</span>
              <div className="ui-chips" role="group" aria-label="추가 매수 계획 여부">
                <Chip pressed={planned === true} onClick={() => setPlanned(true)}>계획한 분할 매수예요</Chip>
                <Chip pressed={planned === false} onClick={() => setPlanned(false)}>계획에 없던 매수예요</Chip>
              </div>
            </div>
          )}

          {buy && streak && !guard?.blocked && <Notice tone="warn" title="오늘은 기록만 하기를 권해요">{streak.text}</Notice>}

          {buy && (
            <ul className="ui-rows" aria-label="규칙 체크">
              <CheckRow ok={stopOk} label="손절가 설정" />
              <CheckRow ok={afterWeight == null ? null : weightOk} label="종목 비중 상한 이내" detail={cap != null ? `상한 ${fmtRatio(cap)}` : undefined} />
              <CheckRow ok={guard ? guardOk : null} label="오늘 손실 한도 이내" detail={guard?.blocked ? (guard.notes.find((n) => n.tone === "bad")?.text ?? "한도에 닿아 다음 거래일에 풀려요") : guard ? undefined : "아직 스캔 기록이 없어 확인하지 못했어요"} />
            </ul>
          )}
          {!buy && held <= 0 && <Notice tone="info">직접 기록한 보유 수량이 없어요. 매도 기록만 남겨요.</Notice>}
        </div>
      )}
    </Sheet>
  );
}
