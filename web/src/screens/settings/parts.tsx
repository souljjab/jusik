import { AlertTriangle } from "lucide-react";
import { useId, type ReactNode } from "react";
import { setPrefs, usePrefs } from "../../app/prefs";
import { Link } from "../../app/router";
import { Change, RuleTag, Segmented } from "../../ui";
import {
  CONVENTION_DESC, CONVENTION_LABEL, STYLE_OPTIONS, THEME_LABEL, cleanNumText, withCommas,
  type ConventionPref, type InvestStyle, type ThemePref,
} from "./settingsModel";
import "./settings.css";

/*
 * 설정과 첫 실행 안내가 같이 쓰는 조각: 테마·색 관례(모드, 지도서 3.1·11.2), 투자 성향, 숫자 입력 칸, 아래 붙는 버튼 줄.
 */

const THEMES: ThemePref[] = ["system", "light", "dark"];
const CONVENTIONS: ConventionPref[] = ["KR", "US"];

/** 테마: 기기 설정 따름(기본)·라이트·다크. 고르면 바로 바뀐다 */
export function ThemeChoice() {
  const prefs = usePrefs();
  return (
    <Segmented
      label="테마"
      value={prefs.theme}
      options={THEMES.map((t) => ({ value: t, label: THEME_LABEL[t] }))}
      onChange={(v) => setPrefs({ theme: v })}
      className="glb-seg"
    />
  );
}

/** 색 관례 고르기 + 지금 고른 관례로 그린 시세 미리 보기 */
export function ConventionChoice() {
  const prefs = usePrefs();
  return (
    <div className="glb-conv">
      <Segmented
        label="색 관례"
        value={prefs.convention}
        options={CONVENTIONS.map((c) => ({ value: c, label: CONVENTION_LABEL[c] }))}
        onChange={(v) => setPrefs({ convention: v })}
        className="glb-seg"
      />
      <ConventionPreview />
    </div>
  );
}

/** 미리 보기(가상의 예시 숫자). 색 + 삼각형 + 부호를 함께 써서 색 없이도 읽힌다 */
export function ConventionPreview() {
  const prefs = usePrefs();
  return (
    <div className="glb-preview" aria-label={`미리 보기, ${CONVENTION_LABEL[prefs.convention]}: ${CONVENTION_DESC[prefs.convention]}`} role="group">
      <div className="glb-preview-head">
        <span className="t-2">미리 보기 · {CONVENTION_DESC[prefs.convention]}</span>
        <span className="t-cap">예시 숫자</span>
      </div>
      <ul className="glb-preview-rows">
        <li>
          <span className="num t-medium">84,300</span>
          <Change change={2600} pct={3.18} />
        </li>
        <li>
          <span className="num t-medium">51,200</span>
          <Change change={-740} pct={-1.42} />
        </li>
        <li>
          <span className="num t-medium">29,450</span>
          <Change change={0} pct={0} />
        </li>
      </ul>
      <p className="t-cap">매수·매도 버튼과 차트의 봉 색도 함께 바뀌어요.</p>
    </div>
  );
}

/** 투자 성향 고르기(라디오). 고르면 먼저 볼 화면을 알려 준다 */
export function StyleChoice({ showStart = true, onPick }: { showStart?: boolean; onPick?: (s: InvestStyle) => void }) {
  const prefs = usePrefs();
  const name = useId();
  const picked = STYLE_OPTIONS.find((o) => o.id === prefs.style) ?? null;
  return (
    <div className="glb-style">
      <div className="glb-opts" role="radiogroup" aria-label="투자 성향">
        {STYLE_OPTIONS.map((o) => (
          <label key={o.id} className={`glb-opt ${prefs.style === o.id ? "on" : ""}`}>
            <input
              type="radio"
              name={name}
              value={o.id}
              checked={prefs.style === o.id}
              onChange={() => {
                setPrefs({ style: o.id });
                onPick?.(o.id);
              }}
            />
            <span className="glb-opt-body">
              <span className="glb-opt-title">
                <span className="t-bold">{o.label}</span>
                <span className="t-2">{o.period}</span>
              </span>
              <span className="t-2">{o.desc}</span>
            </span>
          </label>
        ))}
      </div>
      {showStart && picked && (
        <p className="t-2 glb-style-start">
          {picked.label}라면 먼저 볼 곳:{" "}
          {picked.start.map((s, i) => (
            <span key={s.path}>
              {i > 0 && ", "}
              <Link to={s.path}>{s.label}</Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** 숫자 입력 칸: 이름, 단위, 도움말(규칙 출처), 오류(경고색 + 문장) */
export function NumField({
  id, label, unit, value, onChange, onBlur, integer = false, commas = false, hint, note, rule, error, placeholder,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  integer?: boolean;
  /** 천 단위 쉼표(금액) */
  commas?: boolean;
  hint?: ReactNode;
  /** 입력값으로 계산한 보조 숫자(예: 계좌 기준 금액). 도움말 아래 한 줄 */
  note?: ReactNode;
  rule?: string;
  error?: string | null;
  placeholder?: string;
}) {
  const descId = `${id}-desc`;
  return (
    <div className="ui-field glb-num">
      <div className="glb-num-lblrow">
        <label className="lbl" htmlFor={id}>
          {label}
          <span className="sr-only">({unit})</span>
        </label>
        {rule && (
          <span className="glb-rule">
            <span className="sr-only">근거 규칙 </span>
            <RuleTag rule={rule} />
          </span>
        )}
      </div>
      <div className="glb-num-box">
        <input
          id={id}
          className="ui-input num"
          inputMode={integer ? "numeric" : "decimal"}
          autoComplete="off"
          spellCheck={false}
          value={commas ? withCommas(value) : value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={descId}
          onChange={(e) => onChange(cleanNumText(e.target.value, integer))}
          onBlur={onBlur}
        />
        <span className="glb-num-unit" aria-hidden="true">
          {unit}
        </span>
      </div>
      {error ? (
        <span className="err" id={descId}>
          <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>{error}</span>
        </span>
      ) : (
        <span className="hint" id={descId}>
          {note && <span className="glb-num-note num">{note}</span>}
          {hint}
        </span>
      )}
    </div>
  );
}

/** 경고 한 줄(경고색 + 아이콘 + 문장, 지도서 3.1). 표 칸·목록 안처럼 Notice가 너무 큰 곳에 쓴다 */
export function WarnLine({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`glb-warnline ${className}`}>
      <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/** 구역 안의 버튼 줄. 핸드폰은 하단 탭 바로 위에 붙는다(엄지 영역) */
export function ActionBar({ children, sticky }: { children: ReactNode; sticky: boolean }) {
  return <div className={`glb-actions ${sticky ? "sticky" : ""}`}>{children}</div>;
}
