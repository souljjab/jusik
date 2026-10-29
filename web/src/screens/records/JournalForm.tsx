import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { averagingDownCheck, currencyOfRegion, isValidCode, josa, marketClock, preTradeChecklist, regionOfCode, type JournalCheck, type JournalEntry, type Note, type Region } from "@jusik/shared";
import { addJournal, type JournalInput } from "../../api";
import { useApp } from "../../app/AppContext";
import { accountBaseOf, heldQty } from "../../features/OrderReviewSheet";
import { Button, Chip, Field, fmtInputPrice, fmtInt, fmtPct, fmtPrice, fmtRatio, NoteList, Notice, NumberStepper, Segmented, Toggle, useToast } from "../../ui";
import { EmotionPicker, StockSearch, StrategyField } from "./parts";
import { breaches, composeEmotion, failText, EXIT_REASONS, exitValue, optNum, SELF_CHECK_LABEL, sourceOf, weightOf, type SelfCheck } from "./recordsModel";

/*
 * 새 일지(지도서 7.2 기록, 그림 10 오른쪽).
 * 종목·구분·가격·수량·날짜·전략·손절가·목표가·비중·진입 근거·지금 감정·규칙 체크 → '일지 저장'.
 * 저장 전 점검(주문 전 체크리스트·손실 중 추가 매수)은 서버가 저장할 때 하는 것과 같은 함수·같은 설정값(비중 상한·1회 손실 한도·계좌 기준)으로 미리 보여 준다.
 * 막지는 않고, 고치지 않고 저장하면 서버가 위반으로 남긴다. 이 화면은 이미 낸 매매를 적는 곳이고 주문을 내지 않는다.
 * 비중은 주문 검토 시트·모의매매와 같은 뜻: 이 주문 뒤 그 종목 전체 비중(직접 쓴 기록의 보유 수량 + 이번 수량).
 */

export interface Saved {
  entry: JournalEntry;
  check: JournalCheck;
}

export interface FormState {
  code: string;
  name: string;
  side: "BUY" | "SELL";
  price: string;
  qty: number;
  date: string;
  strategy: string;
  stop: string;
  target: string;
  weight: string;
  weightTouched: boolean;
  exitReason: string;
  exitDetail: string;
  reason: string;
  review: string;
  emoChips: string[];
  emoText: string;
  selfCheck: SelfCheck;
  /** 사용자가 직접 바꾼 체크(그 전에는 입력값을 따라간다) */
  checkTouched: Partial<Record<keyof SelfCheck, boolean>>;
  planned: boolean | null;
}

export const emptyForm = (date: string): FormState => ({
  code: "", name: "", side: "BUY", price: "", qty: 1, date, strategy: "", stop: "", target: "", weight: "", weightTouched: false,
  exitReason: "", exitDetail: "", reason: "", review: "", emoChips: [], emoText: "",
  selfCheck: { stopSet: false, weightOk: false, unplanned: false }, checkTouched: {}, planned: null,
});

/** 폼 값과 계산값(검사·점검·저장 본문). 인라인 패널과 하단 시트가 같이 쓴다 */
export function useJournalForm(init: () => FormState) {
  const { journal, server, now } = useApp();
  const [f, setF] = useState<FormState>(init);
  const set = (patch: Partial<FormState>) => setF((x) => ({ ...x, ...patch }));

  const region = f.code ? regionOfCode(f.code) : "KR";
  const cur = currencyOfRegion(region);
  const base = accountBaseOf(server, cur);
  const settings = server?.settings;
  const cap = settings?.maxWeightPct ?? null;
  const price = optNum(f.price);
  const buy = f.side === "BUY";
  // 직접 쓴 기록 기준 지금 보유 수량(모의계좌 보유는 내 실제 보유가 아니라 빼고 센다)
  const held = buy && f.code ? Math.max(0, heldQty(journal, f.code)) : 0;
  const autoWeight = weightOf(price, held + f.qty, base);
  const weight = f.weightTouched ? optNum(f.weight) : autoWeight ?? undefined;
  const stop = optNum(f.stop);
  const target = optNum(f.target);

  // 규칙 체크 기본값: 손절가를 적었는지·비중이 상한 이내인지를 따라간다(직접 바꾸면 그 값을 쓴다)
  const autoCheck: SelfCheck = {
    stopSet: stop != null && Number.isFinite(stop) && stop > 0 && (price == null || stop < price),
    weightOk: weight != null && Number.isFinite(weight) && weight > 0 && (cap == null || weight <= cap),
    unplanned: f.planned === false,
  };
  const selfCheck: SelfCheck = {
    stopSet: f.checkTouched.stopSet ? f.selfCheck.stopSet : autoCheck.stopSet,
    weightOk: f.checkTouched.weightOk ? f.selfCheck.weightOk : autoCheck.weightOk,
    unplanned: f.checkTouched.unplanned ? f.selfCheck.unplanned : autoCheck.unplanned,
  };

  // 저장 전 점검(매수만): 서버와 같은 함수. 모의계좌(자동) 기록은 내 실제 보유가 아니라 직접 쓴 기록끼리만 본다
  const notes = useMemo<Note[]>(() => {
    if (!buy) return [];
    const out = preTradeChecklist(
      { stop, target, reason: f.reason, price, weightPct: weight, qty: f.qty, account: base },
      settings ? { maxWeightPct: settings.maxWeightPct, maxPerTradeRiskPct: settings.riskPct } : {},
    );
    if (f.code && price != null && price > 0) out.push(...averagingDownCheck(journal.filter((e) => sourceOf(e) === "수동"), { code: f.code, side: "BUY", price, date: f.date }).notes);
    return out;
  }, [buy, stop, target, f.reason, price, weight, f.qty, base, settings, f.code, f.date, journal]);
  const averaging = notes.find((n) => n.tone !== "info" && (n.text.includes("손실 중 추가 매수") || n.text.includes("평균 단가")));

  const missing = !f.code || !isValidCode(f.code) ? "종목을 고르세요" : !(price != null && price > 0) ? "가격을 넣으세요" : !(f.qty >= 1) ? "수량을 넣으세요" : !/^\d{4}-\d{2}-\d{2}$/.test(f.date) ? "날짜를 고르세요" : "";

  const body = (): JournalInput => ({
    code: f.code, name: f.name || undefined, side: f.side, price: price!, qty: f.qty, date: f.date,
    ...(buy && stop != null ? { stop } : {}),
    ...(buy && target != null ? { target } : {}),
    ...(buy && weight != null ? { weightPct: weight } : {}),
    reason: f.reason.trim(),
    ...(f.review.trim() ? { review: f.review.trim() } : {}),
    ...(f.strategy.trim() ? { strategy: f.strategy.trim() } : {}),
    ...(composeEmotion(f.emoChips, f.emoText) ? { emotion: composeEmotion(f.emoChips, f.emoText) } : {}),
    ...(!buy && exitValue(f.exitReason, f.exitDetail) ? { exitReason: exitValue(f.exitReason, f.exitDetail) } : {}),
    ...(buy ? { selfCheck } : {}),
    ...(buy && averaging && f.planned === true ? { plannedAdd: true } : {}),
  });

  /** 저장한 뒤 다음 기록을 위해 거래마다 달라지는 칸만 비운다(종목·구분·날짜·전략은 둔다) */
  const resetAfterSave = () =>
    setF((x) => ({
      ...emptyForm(x.date), code: x.code, name: x.name, side: x.side, strategy: x.strategy,
    }));

  return { f, set, setF, region, cur, base, cap, held, price, autoWeight, weight, buy, selfCheck, notes, averaging, missing, body, resetAfterSave, now, today: marketClock(region, now).date };
}

export type JournalFormApi = ReturnType<typeof useJournalForm>;

/** 저장 결과: 서버 점검 문장(위반은 경고색). 기록 완료와 규칙 준수에만 짧게 피드백한다 */
export function SaveResult({ saved, onClose }: { saved: Saved; onClose?: () => void }) {
  const { entry, check } = saved;
  // 기록 목록의 '위반 n건'과 같은 셈(서버 위반 + 스스로 표시한 체크, 같은 규칙은 한 번)
  const issues = breaches(entry);
  const others = check.notes.filter((n) => n.tone !== "bad");
  const region = regionOfCode(entry.code);
  return (
    <div className="rec-saved stack-3" role="status">
      <div className="row between top">
        <div className="stack" style={{ gap: 2 }}>
          <span className="row t-medium">
            <CheckCircle2 size={16} strokeWidth={1.5} className="ok-text" aria-hidden="true" />
            일지를 저장했어요
          </span>
          <span className="t-2">
            {entry.name} {entry.side === "BUY" ? "매수" : "매도"} <span className="num">{fmtPrice(entry.price, region)} × {fmtInt(entry.qty)}주</span>
          </span>
        </div>
        {onClose && (
          <Button variant="link" className="rec-touchlink" onClick={onClose}>
            닫기
          </Button>
        )}
      </div>
      {issues.length > 0 && (
        <Notice tone="warn" title={`규칙 위반 ${issues.length}건을 함께 남겼어요`}>
          복기할 때 다시 봐요. {issues.join(" ")}
        </Notice>
      )}
      {others.length > 0 && <NoteList notes={others} dense />}
      {entry.side === "BUY" && issues.length === 0 && <span className="t-2">저장 전 점검 항목을 모두 지켰어요.</span>}
    </div>
  );
}

/** 가격 입력칸: 천 단위 쉼표(미국은 소수 둘째 자리까지), 오른쪽에 단위(주문 검토 시트와 같은 모양) */
function PriceInput({ id, value, onChange, region, invalid }: { id: string; value: string; onChange: (v: string) => void; region: Region; invalid?: boolean }) {
  return (
    <div className="rec-input">
      <input
        id={id}
        className="ui-input num"
        inputMode={region === "US" ? "decimal" : "numeric"}
        autoComplete="off"
        spellCheck={false}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(fmtInputPrice(e.target.value, region))}
      />
      <span className="rec-unit" aria-hidden="true">
        {region === "US" ? "달러" : "원"}
      </span>
    </div>
  );
}

/** 입력 칸들(저장 버튼은 놓는 곳이 달라서 밖에 둔다) */
export function JournalFields({ api, idBase }: { api: JournalFormApi; idBase: string }) {
  const { f, set, setF, region, cap, held, price, autoWeight, buy, selfCheck, notes, averaging, base } = api;
  const unit = region === "US" ? "달러" : "원";
  const id = (k: string) => `${idBase}-${k}`;
  const pct = (x: number | undefined) => (x != null && price ? ((x - price) / price) * 100 : null);
  const stop = optNum(f.stop);
  const target = optNum(f.target);
  const must = notes.filter((n) => n.tone === "bad");
  const setCheck = (k: keyof SelfCheck, v: boolean) => setF((x) => ({ ...x, selfCheck: { ...selfCheck, [k]: v }, checkTouched: { ...x.checkTouched, [k]: true } }));

  // 종목을 바꾸면 그 시장의 오늘 날짜로(직접 고친 날짜는 둔다)
  const [dateTouched, setDateTouched] = useState(false);
  useEffect(() => {
    if (!dateTouched) set({ date: api.today });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.today]);

  return (
    <div className="rec-fields">
      <Field label="종목" required htmlFor={id("code")} className="rec-f-wide">
        <StockSearch id={id("code")} code={f.code} name={f.name} onPick={(code, name) => set({ code, name })} />
      </Field>

      <div className="rec-f-wide stack" style={{ gap: 4 }}>
        <span className="rec-lbl" id={id("side-lbl")}>
          구분
        </span>
        <Segmented
          label="매수 또는 매도"
          value={f.side}
          onChange={(side) => set({ side, planned: null })}
          options={[
            { value: "BUY", label: "매수" },
            { value: "SELL", label: "매도" },
          ]}
        />
      </div>

      <Field label={<>가격<span className="sr-only">({unit})</span></>} required htmlFor={id("price")}>
        <PriceInput id={id("price")} value={f.price} region={region} onChange={(v) => set({ price: v })} />
      </Field>
      <Field label="수량" required htmlFor={id("qty")} hint="주">
        <NumberStepper id={id("qty")} label="수량" value={f.qty} min={1} onChange={(qty) => set({ qty })} unit="주" />
      </Field>
      {buy && (
        <>
          <Field
            label={<>손절가<span className="sr-only">({unit})</span></>}
            required
            htmlFor={id("stop")}
            error={stop != null && price != null && stop >= price ? "손절가는 매수가보다 낮아야 해요" : undefined}
            hint={stop && price && stop < price ? `가격 대비 ${fmtPct(pct(stop))}` : "사기 전에 얼마까지 잃을지 정해요"}
          >
            <PriceInput id={id("stop")} value={f.stop} region={region} invalid={stop != null && price != null && stop >= price} onChange={(v) => set({ stop: v })} />
          </Field>
          <Field label={<>목표가<span className="sr-only">({unit})</span></>} htmlFor={id("target")} hint={target && price && target > price ? `가격 대비 ${fmtPct(pct(target))}` : "매도 기준"}>
            <PriceInput id={id("target")} value={f.target} region={region} onChange={(v) => set({ target: v })} />
          </Field>
        </>
      )}

      <Field label="날짜" htmlFor={id("date")}>
        <input
          id={id("date")}
          className="ui-input"
          type="date"
          value={f.date}
          max={api.today}
          onChange={(e) => {
            setDateTouched(true);
            set({ date: e.target.value });
          }}
        />
      </Field>
      {buy && (
        <Field
          label="비중(계좌 대비 %)"
          htmlFor={id("weight")}
          hint={
            !f.weightTouched && autoWeight != null
              ? `${josa(held > 0 ? `보유 ${fmtInt(held)}주 + 이번 ${fmtInt(f.qty)}주` : "가격 × 수량", "으로/로")} 계산한 주문 뒤 종목 비중이에요${cap != null ? ` · 상한 ${fmtRatio(cap)}` : ""}`
              : base > 0
                ? cap != null
                  ? `상한 ${fmtRatio(cap)}`
                  : undefined
                : "계좌 금액을 설정하면 자동으로 계산돼요"
          }
        >
          <input
            id={id("weight")}
            className="ui-input num"
            inputMode="decimal"
            autoComplete="off"
            value={f.weightTouched ? f.weight : autoWeight != null ? String(autoWeight) : ""}
            onChange={(e) => set({ weight: e.target.value.replace(/[^\d.]/g, ""), weightTouched: true })}
          />
        </Field>
      )}
      {!buy && (
        <Field label="청산 사유" htmlFor={id("exit")}>
          <div className="stack">
            <select id={id("exit")} className="ui-select" value={f.exitReason} onChange={(e) => set({ exitReason: e.target.value })}>
              <option value="">고르지 않음</option>
              {EXIT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {f.exitReason === "기타" && <input className="ui-input" aria-label="기타 청산 사유" value={f.exitDetail} maxLength={50} onChange={(e) => set({ exitDetail: e.target.value })} placeholder="짧게 적어요" />}
          </div>
        </Field>
      )}

      <Field label="전략" htmlFor={id("strategy")} className="rec-f-wide">
        <StrategyField id={id("strategy")} value={f.strategy} onChange={(strategy) => set({ strategy })} />
      </Field>

      <Field label={buy ? "진입 근거" : "매도 이유"} required={buy} htmlFor={id("reason")} className="rec-f-wide">
        <textarea
          id={id("reason")}
          className="ui-textarea"
          rows={3}
          maxLength={500}
          value={f.reason}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder={buy ? "예: 30주선 돌파, 거래량 2.3배. 업종도 2단계에 들어섬." : "예: 목표가 도달, 손절가 이탈"}
        />
      </Field>

      <div className="rec-f-wide stack" style={{ gap: 4 }}>
        <span className="rec-lbl" id={`${id("emo")}-lbl`}>
          지금 감정
        </span>
        <EmotionPicker idBase={id("emo")} chips={f.emoChips} text={f.emoText} onChips={(emoChips) => set({ emoChips })} onText={(emoText) => set({ emoText })} />
      </div>

      {buy && averaging && (
        <div className="rec-f-wide stack">
          <Notice tone="warn" title="손실 중인 종목을 더 사요">
            {averaging.text}
          </Notice>
          <span className="t-2" id={id("plan-q")}>
            처음부터 계획한 분할 매수였나요?
          </span>
          <div className="ui-chips" role="group" aria-labelledby={id("plan-q")}>
            <Chip pressed={f.planned === true} onClick={() => set({ planned: true })}>
              계획한 분할 매수예요
            </Chip>
            <Chip pressed={f.planned === false} onClick={() => set({ planned: false })}>
              계획에 없던 매수예요
            </Chip>
          </div>
        </div>
      )}

      {buy && (
        <fieldset className="rec-f-wide rec-checks">
          <legend className="rec-lbl">규칙 체크</legend>
          {(Object.keys(SELF_CHECK_LABEL) as (keyof SelfCheck)[]).map((k) => (
            <Toggle key={k} className="rec-toggle" checked={selfCheck[k]} onChange={(v) => setCheck(k, v)} label={SELF_CHECK_LABEL[k]} />
          ))}
        </fieldset>
      )}

      <Field label="복기 메모" htmlFor={id("review")} hint="나중에 기록 목록에서 채워도 돼요" className="rec-f-wide">
        <textarea id={id("review")} className="ui-textarea" rows={2} maxLength={1000} value={f.review} onChange={(e) => set({ review: e.target.value })} placeholder="계획대로 했나요? 다음엔 무엇을 바꿀까요?" />
      </Field>

      {buy && (
        <div className="rec-f-wide stack" aria-live="polite">
          <span className="rec-lbl">저장 전 점검</span>
          {must.length === 0 ? (
            <span className="row t-2">
              <CheckCircle2 size={16} strokeWidth={1.5} className="ok-text" aria-hidden="true" />
              필수 항목을 모두 채웠어요.
            </span>
          ) : (
            <span className="t-cap">저장을 막지는 않아요. 고치지 않고 저장하면 기록에 위반으로 남아요.</span>
          )}
          <NoteList notes={notes} dense />
        </div>
      )}
    </div>
  );
}

/** 저장 동작(버튼 상태·결과·알림) */
export function useSaveJournal(api: JournalFormApi, onSaved: (s: Saved) => void) {
  const { refreshJournal } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (api.missing) return;
    setBusy(true);
    setErr("");
    try {
      const res = await addJournal(api.body());
      await refreshJournal();
      api.resetAfterSave();
      const n = breaches(res.entry).length;
      toast(n ? `일지를 저장했어요. 규칙 위반 ${n}건도 함께 남겼어요` : "일지를 저장했어요", n ? "warn" : "ok");
      onSaved(res);
    } catch (e) {
      setErr(`일지를 저장하지 못했어요. ${failText(e, "입력한 내용은 그대로 있어요. 고친 뒤 다시 저장해 주세요.")}`);
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, save };
}
