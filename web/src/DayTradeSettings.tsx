import { useEffect, useState } from "react";
import { DEFAULT_POSTURE_CAPS, GUARD_DEFAULTS, POSTURE_LABEL, type Posture, type Settings } from "@jusik/shared";
import { saveSettings } from "./api";
import "./styles/daytrade.css";

const POSTURES: Posture[] = ["ATTACK", "NEUTRAL", "DEFENSE"];

function Num({ label, value, onChange, min, max, step, unit }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; unit?: string }) {
  return (
    <label>
      {label}
      <input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      {unit && <span className="muted small">{unit}</span>}
    </label>
  );
}

/** 규칙 출처 표시(부록 A 규칙 ID 또는 절 번호 + 저자) */
export function RuleTag({ rule }: { rule: string }) {
  return <span className="dt-rule">{rule}</span>;
}

/** 저장 전에 알려 줄 만한 입력(막지는 않는다. 범위 밖 값은 서버가 범위 안으로 맞춘다) */
function draftWarnings(d: Settings): string[] {
  const caps = { ...DEFAULT_POSTURE_CAPS, ...d.postureCaps };
  const out: string[] = [];
  if (caps.ATTACK < caps.NEUTRAL || caps.NEUTRAL < caps.DEFENSE) out.push("국면별 투자 상한이 공격 ≥ 중립 ≥ 방어 순서가 아니에요. 의도한 값인지 확인하세요.");
  for (const p of POSTURES) if (caps[p] < 0 || caps[p] > 100) out.push(`${POSTURE_LABEL[p]} 상한은 0~100% 사이로 저장돼요.`);
  if (d.dailyLossLimitPct < 0 || d.dailyLossLimitPct > 50) out.push("하루 손실 한도는 0~50% 사이로 저장돼요.");
  if (d.maxConsecutiveLosses < 0 || d.maxConsecutiveLosses > 20) out.push("연속 손실 휴식 횟수는 0~20회 사이로 저장돼요.");
  else if (!Number.isInteger(d.maxConsecutiveLosses)) out.push("연속 손실 휴식 횟수는 반올림해서 저장돼요.");
  return out;
}

export function SettingsPanel({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const [draft, setDraft] = useState<Settings>(s);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  // 다른 곳에서 바뀐 값은 편집 중이 아닐 때만 반영한다
  useEffect(() => {
    if (!dirty) setDraft(s);
  }, [s, dirty]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };
  const save = async () => {
    try {
      await saveSettings(draft);
      setDirty(false);
      setMsg("저장했어요");
      onSaved();
    } catch (e) {
      setMsg(`저장 실패: ${e instanceof Error ? e.message : e}`);
    }
    setTimeout(() => setMsg(""), 3000);
  };
  // 이전 버전 설정에는 새 항목이 없을 수 있다
  const caps: Record<Posture, number> = { ...DEFAULT_POSTURE_CAPS, ...draft.postureCaps };
  const dailyLoss = draft.dailyLossLimitPct ?? GUARD_DEFAULTS.dailyLossLimitPct;
  const streak = draft.maxConsecutiveLosses ?? GUARD_DEFAULTS.maxConsecutiveLosses;
  const warnings = dirty ? draftWarnings({ ...draft, postureCaps: caps, dailyLossLimitPct: dailyLoss, maxConsecutiveLosses: streak }) : [];
  return (
    <details className="card" open>
      <summary><b>설정</b> <span className="muted small">— 예수금과 위험 한도를 정하면 그 안에서 살 수 있는 매매만 추천해요</span></summary>
      <h4 className="group">예수금</h4>
      <div className="form compact">
        <Num label="원화 예수금(원)" value={draft.depositKRW} step={100000} min={0} onChange={(v) => set("depositKRW", v)} />
        <Num label="달러 예수금($)" value={draft.depositUSD} step={100} min={0} onChange={(v) => set("depositUSD", v)} />
      </div>
      <h4 className="group">위험 관리</h4>
      <div className="form compact">
        <Num label="1회 손절 허용 손실(예수금 대비 %)" value={draft.riskPct} min={0.1} max={10} step={0.1} onChange={(v) => set("riskPct", v)} />
        <Num label="한 종목 최대 비중(%)" value={draft.maxWeightPct} min={1} max={100} onChange={(v) => set("maxWeightPct", v)} />
        <Num label="최대 보유 종목 수" value={draft.maxPositions} min={1} max={10} onChange={(v) => set("maxPositions", v)} />
        <Num label="항상 남길 현금(%)" value={draft.reservePct} min={0} max={90} onChange={(v) => set("reservePct", v)} />
      </div>

      <h4 className="group">국면별 투자 상한 <RuleTag rule="2.5 강동진" /></h4>
      <p className="muted small dt-help">예수금 대비 주식에 넣을 최대 비율이에요. 책의 예시값이라 조정 대상이에요. 스캔할 때 시장 국면(공격·중립·방어)에 맞는 상한을 매매 계획에 적용해요.</p>
      <div className="form compact">
        {POSTURES.map((p) => (
          <Num key={p} label={`${POSTURE_LABEL[p]} 국면(%)`} value={caps[p]} min={0} max={100} step={5} onChange={(v) => set("postureCaps", { ...caps, [p]: v })} />
        ))}
      </div>

      <h4 className="group">리스크 가드 <span className="muted small dt-weak">모의 자동매매의 신규 진입을 멈추는 기준</span></h4>
      <div className="form compact">
        <Num label="하루 손실 한도(%)" value={dailyLoss} min={0} max={50} step={0.5} unit="0이면 꺼요" onChange={(v) => set("dailyLossLimitPct", v)} />
        <Num label="연속 손실 휴식(회)" value={streak} min={0} max={20} step={1} unit="0이면 꺼요" onChange={(v) => set("maxConsecutiveLosses", v)} />
      </div>
      <ul className="notes small dt-help">
        <li className="muted">
          <RuleTag rule="M4-04 슈웨거" /> 오늘 손실(실현+평가)이 하루 시작 자산의 이 비율에 닿으면 그날은 신규 진입을 멈춰요. 기본 {GUARD_DEFAULTS.dailyLossLimitPct}%는 인터뷰에서 나온 경험칙이에요.
        </li>
        <li className="muted">
          <RuleTag rule="5.5 박용선·슈웨거" /> 이 횟수만큼 연속으로 손실이 나면 그날은 신규 진입을 멈추고, 다음 날부터는 규모를 줄이라는 경고만 해요. 책은 횟수를 정하지 않아 기본 {GUARD_DEFAULTS.maxConsecutiveLosses}회는 예시값이에요.
        </li>
      </ul>

      <h4 className="group">스캔</h4>
      <div className="form compact">
        <Num label="최소 점수(0~100)" value={draft.minScore} min={0} max={100} onChange={(v) => set("minScore", v)} />
        <Num label="스캔 주기(분)" value={draft.scanIntervalMin} min={1} max={240} onChange={(v) => set("scanIntervalMin", v)} />
        <Num label="보유 종목 점검 주기(초)" value={draft.monitorIntervalSec} min={15} max={3600} onChange={(v) => set("monitorIntervalSec", v)} />
        <Num label="시장별 스캔 종목 수" value={draft.maxScanPerMarket} min={5} max={100} onChange={(v) => set("maxScanPerMarket", v)} />
        <Num label="최소 거래대금(국내, 원)" value={draft.minTradeValueKRW} step={100000000} min={0} onChange={(v) => set("minTradeValueKRW", v)} />
        <Num label="최소 거래대금(해외, $)" value={draft.minTradeValueUSD} step={1000000} min={0} onChange={(v) => set("minTradeValueUSD", v)} />
      </div>
      <div className="checks">
        {(["KOSPI", "KOSDAQ", "US"] as const).map((m) => (
          <label key={m} className="check">
            <input type="checkbox" checked={draft.markets[m]} onChange={(e) => set("markets", { ...draft.markets, [m]: e.target.checked })} />
            {m === "US" ? "미국" : m}
          </label>
        ))}
        <label className="check strong">
          <input type="checkbox" checked={draft.paperEnabled} onChange={(e) => set("paperEnabled", e.target.checked)} />
          규칙대로 모의매매 자동 실행 + 매매일지 자동 작성
        </label>
      </div>
      {warnings.length > 0 && (
        <ul className="notes small">{warnings.map((w) => <li key={w} className="note-warn">⚠ {w}</li>)}</ul>
      )}
      <button className="primary" disabled={!dirty} onClick={save}>설정 저장</button> <span className="muted small">{msg}</span>
    </details>
  );
}
