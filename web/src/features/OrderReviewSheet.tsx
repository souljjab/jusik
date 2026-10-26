import { AlertTriangle, Check, Minus } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  averagingDownCheck, currencyOfRegion, EVIDENCE_STRATEGY_NAME, GUARD_RULE, JOURNAL_STRATEGIES, journalStrategyOf, MANUAL_STRATEGY, marketClock, regionOfCode,
  type Evidence, type EvidenceStrategy, type JournalCheck, type JournalEntry, type Note, type Region,
} from "@jusik/shared";
import { addJournal, checkJournal, type JournalInput } from "../api";
import { useApp } from "../app/AppContext";
import { fmtInputPrice, parseInputPrice } from "../screens/stocks/stocksModel";
import {
  Button, Chip, errorText, EvidenceStrip, Field, fmtPct, fmtPnl, fmtRatio, meterState, NoteList, Notice, NumberStepper, RiskMeter, Sheet, useBreakpoint, useToast,
} from "../ui";
import { accountBaseOf, defaultBuyQty, maxQtyByCap } from "./orderMath";
import { guardOf, guardView, manualStreakOf } from "./risk/riskSummary";
import "./features.css";

export { accountBaseOf, defaultBuyQty };

/*
 * 주문 검토 시트(UI 지도서 5.2 G·7.1 F~H·9.3).
 * 이 앱은 증권사와 연결돼 있지 않아 실제 주문을 내지 않는다. '확인'하면 매매일지에 주문을 기록하고,
 * 실제 주문은 사용자가 증권사 앱에서 낸다(확인 메시지도 그렇게 말한다).
 *  - 손절가 필수: 없으면 확인 버튼이 꺼진다
 *  - 위험 상자: 손절 시 예상 손실(가장 크게), 계좌 대비 비율, 주문 후 종목 비중과 상한. 핸드폰은 버튼 바로 위에 한 줄 요약을 함께 둔다
 *  - 규칙 체크 세 가지(손절가 설정·종목 비중 상한 이내·오늘 손실 한도/연속 손실 휴식)가 모두 통과해야 '매수 확인'이 켜진다.
 *    잠금은 서버가 지금 다시 계산한 리스크 가드(server.guards)로 본다
 *  - 서버 점검(목표가·근거 등)은 확인 전에 보여 주고, 점검이 돌아오기 전에는 '매수 확인'을 켜지 않는다
 *  - 상한 초과면 수량을 줄여 제안, 손실 중 추가 매수면 사전 계획이었는지 묻는다(일지로 바로 판단)
 */

export interface OrderRequest {
  code: string;
  name?: string;
  side: "BUY" | "SELL";
  /** 지정가(없으면 현재가를 넣어 주세요) */
  price?: number;
  stop?: number;
  target?: number;
  /** 매매일지에 남길 전략 이름(JOURNAL_STRATEGIES). 다른 이름이면 근거 전략이나 '직접 판단'으로 바꿔 기록한다 */
  strategy?: string;
  reason?: string;
  evidence?: Evidence;
  /** 처음 넣을 수량(오늘의 계획처럼 이미 정한 수량이 있을 때). 없으면 1회 손실 한도와 종목 비중 상한으로 계산한다 */
  qty?: number;
}

/** 직접 쓴 일지 기준으로 지금 보유 수량(매수 − 매도) */
export function heldQty(journal: JournalEntry[], code: string): number {
  return journal.filter((e) => e.code === code && (e.source ?? "수동") === "수동").reduce((q, e) => q + (e.side === "BUY" ? e.qty : -e.qty), 0);
}

const EVIDENCE_BY_NAME = Object.fromEntries(Object.entries(EVIDENCE_STRATEGY_NAME).map(([k, v]) => [v, k])) as Record<string, EvidenceStrategy>;

/**
 * 매매일지에 남길 전략 이름: 일지 전략 목록에 있는 이름이면 그대로, 아니면 근거 전략(단타 → 단타 돌파 등),
 * 근거 이름('2단계 돌파'·'캔들 신호')이면 그 전략, 그 밖('직접 매매' 등)은 '직접 판단'
 */
export function journalStrategyFor(req: Pick<OrderRequest, "strategy" | "evidence">): string {
  const s = req.strategy?.trim();
  if (s && JOURNAL_STRATEGIES.includes(s)) return s;
  if (req.evidence) return journalStrategyOf(req.evidence.strategy);
  if (s && EVIDENCE_BY_NAME[s]) return journalStrategyOf(EVIDENCE_BY_NAME[s]);
  return MANUAL_STRATEGY;
}

/** 가격 → 입력칸 글자(국내 쉼표, 미국 소수 둘째 자리까지) */
export const priceToInput = (n: number | undefined, region: Region) =>
  n != null && n > 0 ? fmtInputPrice(region === "US" ? String(Math.round(n * 100) / 100) : String(Math.round(n)), region) : "";

/** 시트가 직접 보여 주는 점검(손절가·비중·1회 손실·손실 중 추가 매수)은 서버 노트에서 빼고 나머지만 보여 준다 */
const SHOWN_IN_SHEET = new Set<string>([GUARD_RULE.stopFirst, GUARD_RULE.weight, GUARD_RULE.perTrade, GUARD_RULE.lossAdd, GUARD_RULE.averagingDown, GUARD_RULE.pyramid]);
export const extraCheckNotes = (notes: Note[]): Note[] => notes.filter((n) => (n.tone === "bad" || n.tone === "warn") && !(n.rule && SHOWN_IN_SHEET.has(n.rule)));

const CHECKING = "규칙을 점검하고 있어요";

function CheckRow({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <li className="row top" style={{ gap: 8, padding: "6px 0" }}>
      {ok == null ? (
        <Minus size={16} strokeWidth={1.5} className="muted" aria-hidden="true" />
      ) : ok ? (
        <Check size={16} strokeWidth={1.5} className="accent-text" aria-hidden="true" />
      ) : (
        <AlertTriangle size={16} strokeWidth={1.5} className="warn-text" aria-hidden="true" />
      )}
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

/** 가격 입력칸(쉼표·소수점, 오른쪽에 단위) */
function PriceInput({ id, value, onChange, region, invalid, describedBy }: { id: string; value: string; onChange: (v: string) => void; region: Region; invalid?: boolean; describedBy?: string }) {
  return (
    <div className="ord-input">
      <input
        id={id}
        className="ui-input num"
        inputMode={region === "US" ? "decimal" : "numeric"}
        autoComplete="off"
        spellCheck={false}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(fmtInputPrice(e.target.value, region))}
      />
      <span className="ord-unit" aria-hidden="true">
        {region === "US" ? "달러" : "원"}
      </span>
    </div>
  );
}

export function OrderReviewSheet({ req, onClose }: { req: OrderRequest | null; onClose: () => void }) {
  const { server, journal, now, refreshJournal } = useApp();
  const toast = useToast();
  const bp = useBreakpoint();
  const ids = useId();
  const region: Region = req ? regionOfCode(req.code) : "KR";
  const cur = currencyOfRegion(region);
  const s = server?.settings;
  const deposit = accountBaseOf(server, cur);
  const gv = guardView(server ? guardOf(server, cur) : null);
  const held = req ? heldQty(journal, req.code) : 0;
  const today = marketClock(region, now).date;
  const unit = region === "US" ? "달러" : "원";

  const [priceText, setPriceText] = useState("");
  const [stopText, setStopText] = useState("");
  const [targetText, setTargetText] = useState("");
  /** 사용자가 수량을 직접 바꾸기 전에는 가격·손절가에 맞춰 기본 수량을 다시 계산한다 */
  const [qtyAuto, setQtyAuto] = useState(true);
  const [qtyManual, setQtyManual] = useState(0);
  const [reason, setReason] = useState("");
  const [planned, setPlanned] = useState<boolean | null>(null);
  const [check, setCheck] = useState<{ key: string; check: JournalCheck | null } | null>(null);
  const [busy, setBusy] = useState(false);

  // 시트를 열 때마다 값을 새로 채운다
  useEffect(() => {
    if (!req) return;
    const r = regionOfCode(req.code);
    setPriceText(priceToInput(req.price, r));
    setStopText(priceToInput(req.stop, r));
    setTargetText(priceToInput(req.target, r));
    setReason(req.reason ?? "");
    setPlanned(null);
    setCheck(null);
    if (req.side === "SELL") {
      setQtyAuto(false);
      return setQtyManual(req.qty != null && req.qty > 0 ? Math.floor(req.qty) : Math.max(0, held));
    }
    setQtyAuto(!(req.qty != null && req.qty > 0));
    setQtyManual(req.qty != null && req.qty > 0 ? Math.floor(req.qty) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  const buy = req?.side === "BUY";
  const price = parseInputPrice(priceText);
  const stop = parseInputPrice(stopText);
  const target = parseInputPrice(targetText);
  const cap = s?.maxWeightPct ?? null;
  // 기본 수량 = 1회 손실 한도(계좌 × riskPct) ÷ 주당 손절폭, 이미 가진 수량을 더해 종목 비중 상한 이내
  const autoQty = buy && s ? defaultBuyQty({ capital: deposit, riskPct: s.riskPct, maxWeightPct: s.maxWeightPct, price, stop, held: Math.max(0, held) }).qty : 0;
  const qty = buy && qtyAuto ? autoQty : qtyManual;
  const setQty = (n: number) => {
    setQtyAuto(false);
    setQtyManual(n);
  };

  const stopOk = buy ? stop > 0 && price > 0 && stop < price : true;
  const loss = stopOk && buy ? (price - stop) * qty : 0;
  // 손절가가 없거나 수량이 0이면 '계좌의 0%'가 아니라 모름(-)
  const lossPctOfAccount = buy && stopOk && qty > 0 && deposit > 0 ? (loss / deposit) * 100 : null;
  // 1회 손실 한도(riskPct)를 넘는 주문은 막지 않지만 위험 상자에 알린다
  const overRiskLimit = buy && s != null && lossPctOfAccount != null && lossPctOfAccount > s.riskPct + 1e-9;
  // 주문 후 그 종목 전체 비중(보유 + 이번 주문). 매매일지 weightPct와 같은 뜻
  const afterWeight = deposit > 0 && price > 0 ? (((buy ? Math.max(0, held) + qty : Math.max(0, held - qty)) * price) / deposit) * 100 : null;
  const weightState = meterState(afterWeight, cap);
  const weightOk = !buy || weightState !== "over";
  const guardOk = !buy || !gv.blocked;
  const maxByCap = maxQtyByCap({ capital: deposit, maxWeightPct: cap, price, held: Math.max(0, held) });

  // 손실 중 추가 매수는 내 일지로 바로 판단한다(서버 점검을 기다리는 동안에도 질문이 먼저 나온다)
  const manual = useMemo(() => journal.filter((e) => (e.source ?? "수동") === "수동"), [journal]);
  const averaging = buy && req && price > 0 ? averagingDownCheck(manual, { code: req.code, side: "BUY", price, date: today }).notes.find((n) => n.tone !== "info") : undefined;
  const needsPlanAnswer = buy && !!averaging;
  const strategy = req ? journalStrategyFor(req) : MANUAL_STRATEGY;
  const manualStreak = buy && s ? manualStreakOf(journal, region, today, s.maxConsecutiveLosses) : null;
  const streakNote = buy && !gv.blocked ? gv.notes.find((n) => n.rule === GUARD_RULE.streak && n.tone === "warn") : undefined;

  // 서버 점검(체크리스트·손실 중 추가 매수)을 미리 본다
  const input = useMemo<JournalInput | null>(() => {
    if (!req || !(price > 0) || !(qty > 0)) return null;
    return {
      code: req.code, side: req.side, price, qty, date: today,
      ...(stop > 0 ? { stop } : {}), ...(target > 0 ? { target } : {}), reason, strategy,
      ...(afterWeight != null ? { weightPct: Math.round(afterWeight * 10) / 10 } : {}),
    };
  }, [req, price, qty, stop, target, reason, today, afterWeight, strategy]);
  const inputKey = input ? JSON.stringify(input) : "";
  useEffect(() => {
    if (!input || input.side !== "BUY") return;
    let alive = true;
    const key = JSON.stringify(input);
    const t = setTimeout(
      () =>
        checkJournal(input)
          .then((c) => alive && setCheck({ key, check: c }))
          // 점검을 못 받아도 기록은 막지 않는다(기록할 때 서버가 다시 점검한다)
          .catch(() => alive && setCheck({ key, check: null })),
      250,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [input]);
  const checkPending = buy && !!input && check?.key !== inputKey;
  const extraNotes = !checkPending && check?.check ? extraCheckNotes(check.check.notes) : [];

  const canConfirm =
    !!input && !busy && (buy ? stopOk && qty > 0 && weightOk && guardOk && !checkPending && (!needsPlanAnswer || planned != null) : qty > 0 && price > 0);

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
      toast(`기록하지 못했어요. ${errorText(e)}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  const title = buy ? "매수 주문 검토" : "매도 주문 검토";
  const pct = (x: number) => (price > 0 ? ((x - price) / price) * 100 : null);
  const streakLock = gv.blocked && gv.blockReasons.includes("streak") && !gv.blockReasons.includes("dailyLoss");
  const lockText = gv.blocked ? `${streakLock ? "연속 손실 휴식 중이라" : "오늘 손실 한도에 닿아"} 신규 매수가 잠겨 있어요. ${gv.releaseText ?? ""}`.trim() : "";
  const why = !canConfirm && buy && !busy
    ? !stopOk
      ? "손절가를 넣어야 확인할 수 있어요"
      : !(qty > 0)
        ? "수량을 넣어 주세요"
        : !weightOk
          ? "종목 비중이 상한을 넘어요. 수량을 줄여 주세요"
          : !guardOk
            ? lockText
            : needsPlanAnswer && planned == null
              ? "추가 매수가 계획이었는지 골라 주세요"
              : checkPending
                ? CHECKING
                : ""
    : !canConfirm && !buy && !busy
      ? !(price > 0) ? "가격을 넣어 주세요" : !(qty > 0) ? "수량을 넣어 주세요" : ""
      : "";
  const whyId = `${ids}-why`;
  const passed = [stopOk, afterWeight == null ? null : weightOk, gv.checked ? guardOk : null];

  return (
    <Sheet
      open={!!req}
      onClose={onClose}
      title={title}
      initialFocus="#order-qty"
      footer={
        <div className="stack">
          {buy && bp === "compact" && (
            // 핸드폰: 위험을 버튼보다 먼저(지도서 1.3) — 위험 상자와 규칙 체크가 아래로 밀려도 버튼 바로 위에서 보이게
            <p className="ord-foot-risk t-cap">
              <span>
                손절 시 <b className="num">{stopOk && qty > 0 ? fmtPnl(-loss, region) : "-"}</b>
                {lossPctOfAccount != null && <span className="num"> · 계좌의 {fmtRatio(lossPctOfAccount)}</span>}
              </span>
              <span className={weightState === "over" ? "warn-text t-medium" : ""}>
                비중 <span className="num">{fmtRatio(afterWeight)}</span>
                {cap != null && <span className="num"> / 상한 {fmtRatio(cap)}</span>}
              </span>
              <span>
                규칙 체크 <span className="num">{passed.filter((x) => x === true).length}/3</span> 통과
              </span>
            </p>
          )}
          {why && (
            // 점검 중 안내만 아이콘 없이, 확인을 막는 까닭은 경고 아이콘과 함께
            <span className={`t-cap row top ${why === CHECKING ? "" : "warn-text"}`} style={{ gap: 4 }} id={whyId}>
              {why !== CHECKING && <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" style={{ flex: "none", marginTop: 1 }} />}
              <span>{why}</span>
            </span>
          )}
          <Button variant={buy ? "buy" : "sell"} size="lg" block disabled={!canConfirm} busy={busy} onClick={confirm} aria-describedby={why ? whyId : undefined}>
            {buy ? "매수 확인" : "매도 확인"}
          </Button>
          <span className="t-cap" style={{ textAlign: "center" }}>증권사에 주문을 보내지 않아요. 확인하면 매매일지에 기록돼요.</span>
        </div>
      }
    >
      {req && (
        <div className="stack-4 ord-sheet">
          <div className="row between wrap">
            <span className="t-2">
              {req.name ?? req.code}, 지정가 · {strategy}
            </span>
            {req.evidence && <EvidenceStrip evidence={req.evidence} subject={req.name ?? req.code} />}
          </div>

          <div className="stack-3">
            <div className="ord-pair">
              <Field label={<>가격<span className="sr-only">({unit})</span></>} htmlFor="order-price">
                <PriceInput id="order-price" value={priceText} onChange={setPriceText} region={region} />
              </Field>
              <Field label={`수량${held > 0 ? ` (보유 ${held}주)` : ""}`} htmlFor="order-qty">
                <NumberStepper id="order-qty" label="수량" value={qty} onChange={setQty} min={0} unit="주" />
              </Field>
            </div>
            {buy && (
              <div className="ord-pair">
                <Field
                  label={<>손절가<span className="sr-only">({unit})</span></>}
                  required
                  htmlFor="order-stop"
                  error={stop > 0 && !stopOk ? "손절가는 가격보다 낮아야 해요" : undefined}
                  hint={stopOk ? `가격 대비 ${fmtPct(pct(stop))}` : "매수 전에 손실 한도를 정해요"}
                >
                  <PriceInput id="order-stop" value={stopText} onChange={setStopText} region={region} invalid={stop > 0 && !stopOk} />
                </Field>
                <Field label={<>목표가<span className="sr-only">({unit})</span></>} htmlFor="order-target" hint={target > 0 ? `가격 대비 ${fmtPct(pct(target))}` : "선택"}>
                  <PriceInput id="order-target" value={targetText} onChange={setTargetText} region={region} />
                </Field>
              </div>
            )}
            <Field label={buy ? "진입 근거" : "매도 이유"} htmlFor="order-reason">
              <input id="order-reason" className="ui-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={buy ? "예: 30주선 돌파, 거래량 2.3배" : "예: 목표가 도달"} />
            </Field>
          </div>

          {buy && manualStreak?.resting && (
            <Notice tone="warn" title="오늘은 기록만 하기를 권해요">
              직접 기록한 매매가 최근 {manualStreak.streak}번 연속 손실이에요. 마지막 손실이 난 날과 그다음 거래일까지는 새로 사지 말고 기록과 복기만 해 보세요.
            </Notice>
          )}

          {buy && (
            <div className="ui-panel flat stack-3" role="group" aria-label="위험 상자">
              <div className="row between base">
                <span className="t-2">손절 시 예상 손실</span>
                <span className={overRiskLimit ? "t-cap warn-text t-medium" : "t-cap"}>
                  계좌의 {lossPctOfAccount == null ? "-" : fmtRatio(lossPctOfAccount)}
                  {overRiskLimit && s ? ` · 1회 손실 한도 ${fmtRatio(s.riskPct)} 초과` : ""}
                </span>
              </div>
              <span className="t-price">{stopOk && qty > 0 ? fmtPnl(-loss, region) : "-"}</span>
              <RiskMeter label="주문 후 종목 비중" value={afterWeight} limit={cap} format={(n) => fmtRatio(n)} limitLabel={cap != null ? `상한 ${fmtRatio(cap)}` : undefined} overText="상한 초과" />
              {weightState === "over" && maxByCap != null && (
                maxByCap > 0 ? (
                  <Button variant="secondary" size="sm" onClick={() => setQty(maxByCap)}>
                    수량을 {maxByCap}주로 줄이기
                  </Button>
                ) : (
                  <span className="t-cap warn-text row" style={{ gap: 4 }}>
                    <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
                    이미 가진 수량만으로 비중 상한에 닿아 더 살 수 없어요.
                  </span>
                )
              )}
            </div>
          )}

          {buy && needsPlanAnswer && (
            <div className="stack">
              <Notice tone="warn" title="손실 중인 종목을 더 사요">
                {averaging!.text}
              </Notice>
              <span className="t-2" id={`${ids}-plan`}>처음부터 계획한 분할 매수였나요?</span>
              <div className="ui-chips" role="group" aria-labelledby={`${ids}-plan`}>
                <Chip pressed={planned === true} onClick={() => setPlanned(true)}>계획한 분할 매수예요</Chip>
                <Chip pressed={planned === false} onClick={() => setPlanned(false)}>계획에 없던 매수예요</Chip>
              </div>
            </div>
          )}

          {streakNote && (
            <Notice tone="warn" title="규모를 줄여요">
              {streakNote.text}
            </Notice>
          )}

          {buy && (
            <ul className="ui-rows" aria-label="규칙 체크">
              <CheckRow ok={stopOk} label="손절가 설정" />
              <CheckRow ok={afterWeight == null ? null : weightOk} label="종목 비중 상한 이내" detail={cap != null ? `상한 ${fmtRatio(cap)}` : undefined} />
              <CheckRow
                ok={gv.checked ? guardOk : null}
                label={streakLock ? "연속 손실 휴식 아님" : "오늘 손실 한도 이내"}
                detail={gv.blocked ? `${gv.blockReason} ${gv.releaseText ?? ""}`.trim() : gv.checked ? undefined : "리스크 가드 정보를 받지 못해 확인하지 못했어요"}
              />
            </ul>
          )}

          {extraNotes.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="t-2">기록 전에 확인할 점</span>
              <NoteList notes={extraNotes} dense />
              {extraNotes.some((n) => n.tone === "bad") && <span className="t-cap">고치지 않고 확인하면 규칙 위반으로 함께 기록돼요.</span>}
            </div>
          )}

          {!buy && held <= 0 && <Notice tone="info">직접 기록한 보유 수량이 없어요. 매도 기록만 남겨요.</Notice>}
          {!buy && held > 0 && qty > held && (
            <Notice tone="warn">직접 기록한 보유 수량({held}주)보다 많이 팔아요. 매매일지의 보유 수량이 맞지 않을 수 있어요.</Notice>
          )}
        </div>
      )}
    </Sheet>
  );
}
