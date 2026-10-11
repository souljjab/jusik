import { useEffect, useState } from "react";
import { DEFAULT_POSTURE_CAPS, GUARD_DEFAULTS, INTRADAY_PARAMS, MACRO_PARAMS, POSTURE_LABEL, type Posture, type ScanResult, type Settings } from "@jusik/shared";
import { saveSettings } from "./api";
import "./styles/daytrade.css";
import "./styles/market.css";

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

/** ISM 직접 입력 칸(덜 채운 값도 들고 있으려고 글자로 둔다) */
type IsmDraft = { value: string; month: string };
const ISM_MIN = 20;
const ISM_MAX = 80;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ismDraftOf = (m: Settings["ismManual"] | undefined): IsmDraft => (m ? { value: String(m.value), month: m.month } : { value: "", month: "" });

/** 칸 → 저장할 값. 둘 다 비면 null(직접 입력 지움), 덜 채웠거나 범위 밖이면 undefined(저장하지 않고 지금 값을 둔다) */
function parseIsm(d: IsmDraft): Settings["ismManual"] | undefined {
  const v = d.value.trim();
  const m = d.month.trim();
  if (!v && !m) return null;
  const n = Number(v);
  if (!v || !Number.isFinite(n) || n < ISM_MIN || n > ISM_MAX || !MONTH_RE.test(m)) return undefined;
  return { value: Math.round(n * 10) / 10, month: m };
}

/** 이번 달(서버와 같이 UTC 날짜 기준) */
const thisMonth = () => new Date().toISOString().slice(0, 7);
function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** ISM 입력에 대한 안내(막지는 않는다) */
function ismWarnings(d: IsmDraft): string[] {
  const parsed = parseIsm(d);
  if (parsed === undefined) return [`ISM은 값(${ISM_MIN}~${ISM_MAX})과 달을 모두 넣어야 저장돼요. 지금 저장하면 ISM 직접 입력은 이전 값 그대로예요.`];
  if (!parsed) return [];
  if (parsed.month >= thisMonth()) return [`${parsed.month}은(는) 아직 끝나지 않은 달이라 쓰이지 않아요. ISM은 다음 달 첫 영업일에 지난달 값을 발표해요.`];
  const [y, m] = parsed.month.split("-").map(Number) as [number, number];
  // 발표일 ≈ 다음 달 1일(실제는 첫 영업일)
  const age = (Date.now() - Date.UTC(y, m, 1)) / 86_400_000;
  if (age > MACRO_PARAMS.ismMaxAgeDays)
    return [`${parsed.month} 값은 발표된 지 ${MACRO_PARAMS.ismMaxAgeDays}일이 넘어 쓰이지 않고 지역 연준 제조업 지수(대용)로 판단해요.`];
  return [];
}

const MINUTE_MODES: { id: Settings["minuteMode"]; label: string; help: string }[] = [
  { id: "off", label: "끔", help: "분봉을 보지 않고 매매 계획대로 모의 진입해요." },
  {
    id: "filter",
    label: "갭 추격·회피만 거름(기본)",
    help: `분봉 판단이 '피함'이거나, 시초가 갭 +${INTRADAY_PARAMS.gapCautionPct}% 이상에서 아직 '대기'면 이번 스캔에서는 들어가지 않아요. 분봉 자료가 없으면 막지 않아요.`,
  },
  { id: "strict", label: "분봉 매수 신호일 때만", help: "분봉 판단이 '매수'일 때만 들어가요. 분봉 자료가 없으면 들어가지 않아요." },
];

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

/** 최근 스캔에 실제로 쓴 ISM 한 줄 */
function IsmUsed({ macro }: { macro: ScanResult["macroSummary"] }) {
  if (!macro) return null;
  const i = macro.ism;
  return (
    <p className="small mk-now">
      <span className="muted">최근 스캔에 쓴 ISM: </span>
      {i ? (
        <>
          <b className={i.value >= MACRO_PARAMS.ismLine ? "note-good" : "note-warn"}>{i.value.toFixed(1)}</b>{" "}
          <span className="muted">({i.month} · {i.source === "수동" ? "직접 입력" : "ISM 사이트"})</span>
        </>
      ) : (
        <span className="muted">없음 — 지역 연준 제조업 지수가 있으면 대용으로 판단했어요</span>
      )}
    </p>
  );
}

export function SettingsPanel({ s, onSaved, macro }: { s: Settings; onSaved: () => void; macro?: ScanResult["macroSummary"] }) {
  const [draft, setDraft] = useState<Settings>(s);
  const [ism, setIsm] = useState<IsmDraft>(() => ismDraftOf(s.ismManual));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  // 다른 곳에서 바뀐 값은 편집 중이 아닐 때만 반영한다
  useEffect(() => {
    if (dirty) return;
    setDraft(s);
    setIsm(ismDraftOf(s.ismManual));
  }, [s, dirty]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };
  const editIsm = (patch: Partial<IsmDraft>) => {
    setIsm((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const ismParsed = parseIsm(ism);
  const save = async () => {
    try {
      // 덜 채운 ISM은 보내지 않고 저장된 값을 그대로 둔다
      await saveSettings({ ...draft, ismManual: ismParsed === undefined ? (s.ismManual ?? null) : ismParsed });
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
  const minuteMode = draft.minuteMode ?? "filter";
  const warnings = dirty ? [...draftWarnings({ ...draft, postureCaps: caps, dailyLossLimitPct: dailyLoss, maxConsecutiveLosses: streak }), ...ismWarnings(ism)] : [];
  const savedIsm = s.ismManual ?? null;
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
          <RuleTag rule="M4-04 슈웨거" /> 오늘 손실(실현+평가, 전날 대비)이 하루 시작 자산의 이 비율에 닿으면 그날은 신규 진입을 멈춰요. 기본 {GUARD_DEFAULTS.dailyLossLimitPct}%는 인터뷰에서 나온 경험칙이에요.
        </li>
        <li className="muted">
          <RuleTag rule="5.5 박용선·슈웨거" /> 이 횟수만큼 연속으로 손실이 나면 그날과 다음 거래일은 신규 진입을 멈추고, 그 뒤로는 규모를 줄이라는 경고만 해요. 책은 횟수를 정하지 않아 기본 {GUARD_DEFAULTS.maxConsecutiveLosses}회는 예시값이에요.
        </li>
      </ul>

      <h4 className="group">ISM 제조업지수 직접 입력 <RuleTag rule="2.3 강영현·강동진" /></h4>
      <p className="muted small dt-help">
        사이트에서 ISM을 못 읽을 때 매월 첫 영업일 발표값을 넣어요. {MACRO_PARAMS.ismLine} 이상이면 제조업 확장, 아래면 수축으로 보고 국면 점수의 매크로 신호에 써요.
        직접 넣은 값이 사이트 값보다 먼저 쓰이니, 사이트에 더 새 값이 나오면 지워 주세요.
      </p>
      <div className="form mk-form">
        <label>
          PMI 값({ISM_MIN}~{ISM_MAX})
          <input type="number" inputMode="decimal" value={ism.value} min={ISM_MIN} max={ISM_MAX} step={0.1} placeholder="예: 48.7" onChange={(e) => editIsm({ value: e.target.value })} />
        </label>
        <label>
          가리키는 달
          <input type="month" value={ism.month} max={prevMonth(thisMonth())} onChange={(e) => editIsm({ month: e.target.value })} />
        </label>
        <button type="button" className="link small mk-clear" disabled={!ism.value && !ism.month} onClick={() => editIsm({ value: "", month: "" })}>
          지우기
        </button>
      </div>
      <p className="muted small mk-now">
        {savedIsm ? `저장된 직접 입력: ${savedIsm.value.toFixed(1)} (${savedIsm.month})` : "저장된 직접 입력 없음 — 사이트 값이나 대용 지표를 써요"}
        {savedIsm && ismParsed === null && " · 저장하면 지우고 사이트 값을 써요"}
      </p>
      <IsmUsed macro={macro} />

      <h4 className="group">분봉 확인 <RuleTag rule="4.7·M3-18 강창권" /></h4>
      <p className="muted small dt-help">모의 자동매매가 진입하기 직전에 그 종목의 1분봉을 확인해요. 모의매매 자동 실행이 꺼져 있으면 쓰이지 않아요.</p>
      <div className="form compact">
        <label>
          분봉 확인 모드
          <select className="mk-select" value={minuteMode} onChange={(e) => set("minuteMode", e.target.value as Settings["minuteMode"])}>
            {MINUTE_MODES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>
      <ul className="notes small mk-modes">
        {MINUTE_MODES.map((m) => (
          <li key={m.id} className={m.id === minuteMode ? "mk-on" : undefined}>
            {m.id === minuteMode ? "▶ " : ""}<b>{m.label}</b> — {m.help}
          </li>
        ))}
      </ul>
      <p className="muted small dt-help">
        책의 기준: 시초가 갭이 +{INTRADAY_PARAMS.gapNoChasePct}% 이상이면 시초가에 사지 않고, 약 {INTRADAY_PARAMS.gapWaitMinutes}분 기다려 1분봉 20분선 지지를 확인한 뒤 나눠 사요. 미룬 종목은 다음 스캔에서 다시 봐요.
      </p>

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
