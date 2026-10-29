import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { GUARD_DEFAULTS, type Currency, type Posture } from "@jusik/shared";
import { saveSettings } from "../../api";
import { useApp } from "../../app/AppContext";
import { accountBaseOf } from "../../features/OrderReviewSheet";
import { Button, Notice, RuleTag, Section, fmtMoneyByCurrency, useToast } from "../../ui";
import { ActionBar, NumField } from "./parts";
import {
  DEFAULT_LIMITS, LIMIT_KEYS, LIMIT_SPEC, failText, limitsChanged, limitsDraftOf, limitsErrors, limitsPatch, limitsWarnings, parseNum,
  type LimitKey, type LimitsDraft,
} from "./settingsModel";
import { SectionLoading, ServerMissing } from "./status";
import type { DraftProps, SecProps } from "./types";

/*
 * 매매 한도(지도서 9.3 과매매를 막는 장치, 부록 A M4-01~M4-04·5.5). 서버에 저장해 모든 기기가 같이 쓴다.
 * 칸은 글자로 들고 있다가 저장할 때 숫자로 바꿔 범위를 확인한다(서버는 범위 밖 값을 조용히 맞추므로 화면에서 먼저 막는다).
 * 한도 칸만 보내 다른 화면에서 고친 스캔 조건을 덮지 않는다.
 */

const CAP: Record<Posture, LimitKey> = { ATTACK: "capATTACK", NEUTRAL: "capNEUTRAL", DEFENSE: "capDEFENSE" };
const POSTURES: Posture[] = ["ATTACK", "NEUTRAL", "DEFENSE"];

export function LimitsSection({ gh, bp, drafts, setDraft }: SecProps & DraftProps) {
  const { server, offline, refreshServer } = useApp();
  const toast = useToast();
  const saved = useMemo(() => (server ? limitsDraftOf(server.settings) : null), [server]);
  const [shown, setShown] = useState<Set<LimitKey>>(() => new Set());
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!server || !saved) return offline ? <ServerMissing /> : <SectionLoading rows={8} />;

  const draft: LimitsDraft = drafts.limits ?? saved;
  const changed = limitsChanged(saved, draft);
  const dirty = changed.length > 0;
  const errors = limitsErrors(draft);
  const warnings = limitsWarnings(draft);
  const errOf = (k: LimitKey) => (tried || shown.has(k) ? errors[k] ?? null : null);
  const set = (k: LimitKey, v: string) => setDraft("limits", { ...draft, [k]: v });
  const blur = (k: LimitKey) => setShown((s) => (s.has(k) ? s : new Set(s).add(k)));
  const isDefault = limitsChanged(DEFAULT_LIMITS, draft).length === 0;
  const s = server.settings;

  // 지금 입력한 비율이 계좌 기준으로 얼마인지(주문 검토와 같은 기준: 모의매매면 모의계좌 자산, 아니면 예수금)
  const base = (c: Currency) => {
    if (s.paperEnabled) return accountBaseOf(server, c);
    const n = parseNum(draft[c === "KRW" ? "depositKRW" : "depositUSD"]);
    return n ?? accountBaseOf(server, c);
  };
  const amountOf = (k: LimitKey, prefix: string) => {
    const p = parseNum(draft[k]);
    if (p == null || errors[k]) return undefined;
    const krw = fmtMoneyByCurrency((base("KRW") * p) / 100, "KRW");
    const usd = fmtMoneyByCurrency((base("USD") * p) / 100, "USD");
    return `${prefix} ${krw} · ${usd}`;
  };

  const save = async () => {
    setTried(true);
    const patch = limitsPatch(draft);
    if (!patch) {
      const first = LIMIT_KEYS.find((k) => errors[k]);
      if (first) document.getElementById(`glb-lim-${first}`)?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveSettings(patch);
      // 서버가 리스크 가드를 /api/state마다 새 한도로 다시 계산하므로, 곧바로 다시 받아 주문 검토·비중과 한도가 새 기준을 쓰게 한다
      await refreshServer();
      setDraft("limits", null);
      setTried(false);
      setShown(new Set());
      toast("매매 한도를 저장했어요. 주문 검토에는 바로, 매매 계획에는 다음 스캔부터 적용돼요.", "ok");
    } catch (e) {
      setError(failText("매매 한도를 저장하지 못했어요", e, "값을 확인하고 다시 저장하세요."));
    } finally {
      setSaving(false);
    }
  };

  const field = (k: LimitKey, hint: string, rule?: string, note?: string) => {
    const spec = LIMIT_SPEC[k];
    return (
      <NumField
        id={`glb-lim-${k}`}
        label={spec.label}
        unit={spec.unit}
        value={draft[k]}
        onChange={(v) => set(k, v)}
        onBlur={() => blur(k)}
        integer={spec.integer}
        commas={k === "depositKRW" || k === "depositUSD"}
        hint={hint}
        note={note}
        rule={rule}
        error={errOf(k)}
      />
    );
  };
  const errCount = Object.keys(errors).length;
  const compact = bp === "compact";

  return (
    <>
      <Section title="계좌 기준" as={gh}>
        <div className="glb-grid">
          {field("depositKRW", "모의매매가 꺼져 있을 때 계획과 주문 검토가 쓰는 원화 계좌 금액이에요.")}
          {field("depositUSD", "미국 종목에 쓰는 달러 계좌 금액이에요.")}
        </div>
        {s.paperEnabled ? (
          <Notice>
            모의매매가 켜져 있어 계좌 기준은 모의계좌 자산(<span className="num">{fmtMoneyByCurrency(accountBaseOf(server, "KRW"), "KRW")}</span> ·{" "}
            <span className="num">{fmtMoneyByCurrency(accountBaseOf(server, "USD"), "USD")}</span>)이에요. 예수금을 바꾸면 보유 종목이 없는 모의계좌는 새 예수금으로 다시 시작해요.
          </Notice>
        ) : (
          <p className="t-cap">예수금을 바꾸면 보유 종목이 없는 모의계좌도 새 예수금으로 다시 시작해요.</p>
        )}
      </Section>

      <Section title="한 번의 매매" as={gh}>
        <div className="glb-grid">
          {field("riskPct", `손절가에 닿을 때 잃는 돈이 계좌의 이 비율이 되도록 수량을 정해요. 책 기준 ${GUARD_DEFAULTS.maxPerTradeRiskPct}% 이하.`, "M4-04 슈웨거", amountOf("riskPct", "손절 1회 최대"))}
          {field("maxWeightPct", `한 종목에 넣는 최대 비율이에요. 넘으면 주문 검토가 수량을 줄여 제안해요. 책 기준 ${GUARD_DEFAULTS.maxWeightPct}% 이하.`, "M4-03 강영현", amountOf("maxWeightPct", "한 종목 최대"))}
          {field("maxPositions", "동시에 들고 있을 최대 종목 수예요. 다 차면 계획에서 더 고르지 않아요.", "M4-03 캔들마스터")}
          {field("reservePct", "계획을 짤 때 쓰지 않고 남겨 두는 현금 비율이에요.")}
        </div>
      </Section>

      <Section title="국면별 주식 비중 상한" as={gh} sub={<RuleTag rule="2.5 강동진" />}>
        <p className="t-2">계좌 대비 주식에 넣을 최대 비율이에요. 스캔할 때 시장 국면(공격·중립·방어)에 맞는 상한을 매매 계획에 적용해요. 책의 예시값이라 조정할 수 있어요.</p>
        <div className="glb-grid three">
          {POSTURES.map((p) => (
            <div key={p}>{field(CAP[p], p === "ATTACK" ? "시장 국면 3칸" : p === "NEUTRAL" ? "시장 국면 2칸" : "시장 국면 1칸")}</div>
          ))}
        </div>
      </Section>

      <Section title="신규 매수를 멈추는 장치" as={gh}>
        <div className="glb-grid">
          {field("dailyLossLimitPct", "오늘 손실(실현+평가)이 하루 시작 자산의 이 비율에 닿으면 그날은 신규 매수를 잠가요. 0이면 꺼요.", "M4-04 슈웨거")}
          {field("maxConsecutiveLosses", "이 횟수만큼 연속으로 손실이 나면 그날과 다음 거래일은 신규 매수를 멈추고 기록만 하기를 권해요. 0이면 꺼요.", "5.5 박용선·슈웨거")}
        </div>
        <p className="t-cap">모의 자동매매의 신규 진입과 주문 검토의 매수 확인이 같이 멈춰요. 책의 수치는 저자의 경험칙이라 조정할 수 있어요.</p>
      </Section>

      <Section title="주문 검토에서 늘 지키는 것" as={gh}>
        <ul className="glb-fixed">
          <li>
            <span>손절가를 넣지 않으면 매수 확인 버튼이 꺼져요.</span> <RuleTag rule="5.1 박용선·와인스타인" />
          </li>
          <li>
            <span>주문 후 종목 비중이 상한을 넘으면 매수 확인이 꺼지고 수량을 줄이라고 안내해요.</span> <RuleTag rule="M4-03 강영현" />
          </li>
          <li>
            <span>손실 중인 종목을 더 살 때는 미리 계획한 분할 매수였는지 물어요.</span> <RuleTag rule="M4-02 캔들마스터" />
          </li>
        </ul>
        <p className="t-cap">이 규칙은 설정으로 끌 수 없어요. 실제 주문은 내지 않고, 확인하면 매매일지에 기록해요.</p>
      </Section>

      {warnings.length > 0 && (
        <Notice tone="warn" title="저장은 되지만 책의 기준과 달라요">
          <ul className="glb-warn-list">
            {warnings.map((w) => (
              <li key={w.text}>
                {w.text} {w.rule && <RuleTag rule={w.rule} />}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {tried && errCount > 0 && <Notice tone="warn">입력을 확인해 주세요. 고칠 칸이 {errCount}개 있어요.</Notice>}
      {error && <Notice tone="warn">{error}</Notice>}

      <ActionBar sticky={compact && dirty}>
        <span className="t-2 glb-actions-note">{dirty ? `바뀐 칸 ${changed.length}개 · 저장해야 적용돼요` : isDefault ? "기본값과 같아요" : "저장한 값과 같아요"}</span>
        <div className="glb-actions-btns">
          {dirty ? (
            <Button variant="ghost" size={compact ? "lg" : "md"} onClick={() => (setDraft("limits", null), setTried(false), setShown(new Set()), setError(null))}>
              되돌리기
            </Button>
          ) : (
            !isDefault && (
              <Button variant="ghost" icon={<RotateCcw size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={() => setDraft("limits", DEFAULT_LIMITS)}>
                기본값으로 되돌리기
              </Button>
            )
          )}
          <Button variant="primary" size={compact ? "lg" : "md"} disabled={!dirty} busy={saving} onClick={() => void save()}>
            한도 저장
          </Button>
        </div>
      </ActionBar>
    </>
  );
}
