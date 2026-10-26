import { AlertTriangle, Loader2, Minus, Plus } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/**
 * 버튼(UI 지도서 8장): 매수·매도·기본·보조·비활성·처리 중. 버튼 문구는 무엇이 일어나는지 동사로('매수 확인', '일지 저장').
 * 매수는 상승색, 매도는 하락색(한국 관례 — 미국식 설정이면 색이 따라 바뀐다).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "link" | "buy" | "sell";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  busy?: boolean;
  icon?: ReactNode;
}>(function Button({ variant = "secondary", size = "md", block, busy, icon, children, className = "", disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={`ui-btn ${variant} ${size === "md" ? "" : size} ${block ? "block" : ""} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Loader2 className="spin" size={16} strokeWidth={1.5} aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md"; badge?: number | null }>(
  function IconButton({ label, size = "md", badge, children, className = "", ...rest }, ref) {
    return (
      <button ref={ref} type="button" className={`ui-iconbtn ${size === "sm" ? "sm" : ""} ${className}`} aria-label={badge ? `${label}, ${badge}건` : label} title={label} {...rest}>
        {children}
        {badge ? <span className="ui-badge" aria-hidden="true">{badge > 99 ? "99+" : badge}</span> : null}
      </button>
    );
  },
);

function arrowNav(e: KeyboardEvent<HTMLElement>, count: number, index: number, go: (i: number) => void) {
  const k = e.key;
  if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Home" && k !== "End") return;
  e.preventDefault();
  const next = k === "Home" ? 0 : k === "End" ? count - 1 : (index + (k === "ArrowRight" ? 1 : -1) + count) % count;
  go(next);
  const el = (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined) ?? null;
  el?.focus();
}

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/** 세그먼트(라디오 묶음): 기간(일·주·월), 필터 등 하나만 고르는 짧은 선택 */
export function Segmented<T extends string>({ value, options, onChange, label, size = "md", className = "" }: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`ui-seg ${size} ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === idx ? 0 : -1}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => arrowNav(e, options.length, i, (n) => !options[n]!.disabled && onChange(options[n]!.value))}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 탭(화면 안의 하위 구역). 탭 패널에는 id={`${idBase}-${value}`} role="tabpanel"을 붙인다 */
export function Tabs<T extends string>({ value, items, onChange, label, idBase, className = "" }: {
  value: T;
  items: Option<T>[];
  onChange: (v: T) => void;
  label: string;
  idBase?: string;
  className?: string;
}) {
  const idx = Math.max(0, items.findIndex((o) => o.value === value));
  return (
    <div className={`ui-tabs ${className}`} role="tablist" aria-label={label}>
      {items.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          id={idBase ? `${idBase}-tab-${o.value}` : undefined}
          aria-controls={idBase ? `${idBase}-${o.value}` : undefined}
          aria-selected={o.value === value}
          tabIndex={i === idx ? 0 : -1}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => arrowNav(e, items.length, i, (n) => onChange(items[n]!.value))}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 칩: 한 번 눌러 켜고 끄는 선택(필터·감정 태그·조건) */
export function Chip({ pressed, onClick, children, className = "", disabled }: { pressed?: boolean; onClick?: () => void; children: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <button type="button" className={`ui-chip ${className}`} aria-pressed={pressed ?? undefined} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** 켜고 끄는 스위치 */
export function Toggle({ checked, onChange, label, hint, disabled, className = "" }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`ui-toggle ${className}`} onClick={() => onChange(!checked)} disabled={disabled}>
      <span className="track" aria-hidden="true">
        <span className="knob" />
      </span>
      <span className="stack" style={{ gap: 0 }}>
        <span>{label}</span>
        {hint && <span className="t-cap">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * 입력 칸 묶음: 이름, 필수 표시, 도움말, 오류(경고색 + 아이콘 + 문장).
 * 도움말·오류는 입력 칸(htmlFor로 가리킨 요소, 없으면 묶음 안의 첫 입력)에 aria-describedby로 이어 주고,
 * 오류가 있으면 aria-invalid를 붙인다(포커스할 때 화면 낭독이 도움말의 숫자까지 읽게).
 */
export function Field({ label, required, hint, error, children, className = "", htmlFor }: { label: ReactNode; required?: boolean; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const descId = `${useId()}-desc`;
  const msg = error ? "err" : hint ? "hint" : null;
  const invalid = !!error;
  useEffect(() => {
    const el = htmlFor ? document.getElementById(htmlFor) : box.current?.querySelector<HTMLElement>("input, select, textarea");
    if (!el) return;
    const others = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((x) => x && x !== descId);
    const ids = msg ? [...others, descId] : others;
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
    if (invalid) el.setAttribute("aria-invalid", "true");
    else if (el.dataset.fieldInvalid) el.removeAttribute("aria-invalid");
    if (invalid) el.dataset.fieldInvalid = "1";
    else delete el.dataset.fieldInvalid;
  });
  return (
    <div ref={box} className={`ui-field ${className}`}>
      <label className="lbl" htmlFor={htmlFor}>
        {label}
        {required && <span className="req">필수</span>}
      </label>
      {children}
      {error ? (
        <span className="err" role="alert" id={descId}>
          <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>{error}</span>
        </span>
      ) : hint ? (
        <span className="hint" id={descId}>{hint}</span>
      ) : null}
    </div>
  );
}

/** 수량 입력에서 친 글자 → 숫자(빈 칸은 null) */
export function parseQty(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  return digits === "" ? null : Number(digits);
}

/**
 * −/+ 단추가 붙은 수량 입력. 고치는 동안에는 칸을 비울 수 있고(지운 뒤 5를 치면 15가 아니라 5),
 * 비운 채로 나가면 최솟값으로 돌린다. 최댓값을 넘게 치면 바로 최댓값으로 맞춘다.
 */
export function NumberStepper({ value, onChange, step = 1, min = 0, max, label, unit, id, ...aria }: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  label: string;
  unit?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const clamp = (v: number) => Math.max(min, max != null ? Math.min(max, v) : v);
  // 고치는 중인 글자(null이면 value를 그대로 보여 준다)
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="ui-stepper">
      <button type="button" aria-label={`${label} 줄이기`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
        <Minus size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <input
        id={id}
        inputMode="numeric"
        aria-label={label}
        {...aria}
        value={text ?? (Number.isFinite(value) ? String(value) : "")}
        onChange={(e) => {
          const n = parseQty(e.target.value);
          if (n == null) {
            setText("");
            onChange(clamp(min));
            return;
          }
          const v = clamp(n);
          setText(v === n ? String(n) : String(v));
          onChange(v);
        }}
        onBlur={() => setText(null)}
      />
      <button type="button" aria-label={`${label} 늘리기`} onClick={() => onChange(clamp(value + step))} disabled={max != null && value >= max}>
        <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {unit && <span className="sr-only">{unit}</span>}
    </div>
  );
}

/** 구역: 제목 + 보조 동작. 카드 대신 여백과 구분선으로 나눈다 */
export function Section({ title, sub, actions, children, className = "", as = "h2", id }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; as?: "h1" | "h2" | "h3"; id?: string }) {
  const H = as;
  const auto = useId();
  const hid = id ?? auto;
  return (
    <section className={`ui-section ${className}`} aria-labelledby={title ? hid : undefined}>
      {(title || actions) && (
        <div className="ui-section-head">
          {title && (
            <H id={hid} className="t-section">
              {title} {sub && <span className="sub">{sub}</span>}
            </H>
          )}
          {actions && <div className="row wrap">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** 큰 숫자 하나와 설명(통계 묶음) */
export function Stat({ value, label, accent, className = "" }: { value: ReactNode; label: ReactNode; accent?: boolean; className?: string }) {
  return (
    <div className={`ui-stat ${accent ? "accent" : ""} ${className}`}>
      <span className="v">{value}</span>
      <span className="k">{label}</span>
    </div>
  );
}
export function Stats({ children, n }: { children: ReactNode; n?: number }) {
  return (
    <div className="ui-stats" style={n ? { ["--n" as string]: n } : undefined}>
      {children}
    </div>
  );
}

/** 점수 막대 + 숫자 */
export function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className="ui-score" role="img" aria-label={`점수 ${Math.round(value)}점`}>
      <span className="ui-score-track" aria-hidden="true">
        <span className="ui-score-fill" style={{ width: `${w}%`, display: "block" }} />
      </span>
      <span className="n" aria-hidden="true">{Math.round(value)}</span>
    </span>
  );
}

/** 축 없는 작은 추세선(모양만). tone=auto면 처음 대비 마지막이 오르면 상승색, 내리면 하락색 */
export function Sparkline({ values, width = 72, height = 24, tone = "auto", label }: { values: number[]; width?: number; height?: number; tone?: "auto" | "accent" | "muted"; label?: string }) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return <svg className="ui-spark" width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * width).toFixed(1)},${(height - 2 - ((x - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  const dir = v.at(-1)! - v[0]!;
  const color = tone === "accent" ? "var(--color-accent)" : tone === "muted" ? "var(--color-text-2)" : dir > 0 ? "var(--color-up)" : dir < 0 ? "var(--color-down)" : "var(--color-text-2)";
  return (
    <svg className="ui-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** 불러오는 중: 문장 없이 실제 배치와 같은 모양의 회색 틀 */
export function Skeleton({ w = "100%", h = 14, className = "", style }: { w?: number | string; h?: number | string; className?: string; style?: CSSProperties }) {
  return <span className={`ui-skel ${className}`} style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}
/** ms가 지나면 true(불러오기가 오래 걸릴 때 진행 표시를 띄우는 데 쓴다) */
export function useSlow(active = true, ms = 1000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return setSlow(false);
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}

/** 진행 표시(가는 막대 + 문장). 불러오기가 1초를 넘으면 스켈레톤 위에 띄운다(지도서 9.2) */
export function ProgressLine({ text = "불러오는 중이에요" }: { text?: string }) {
  return (
    <div className="ui-progress-line">
      <span className="ui-progress-bar" aria-hidden="true" />
      <span className="ui-progress">{text}</span>
    </div>
  );
}

/** 목록 모양 스켈레톤. 1초가 넘으면 진행 표시(progress 문장)가 함께 나온다 */
export function SkeletonRows({ rows = 4, h = 18, progress }: { rows?: number; h?: number; progress?: string }) {
  const slow = useSlow();
  return (
    <div className="ui-skel-rows" role="status" aria-label="불러오는 중">
      {slow && <ProgressLine text={progress} />}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={h} w={`${100 - (i % 3) * 12}%`} />
      ))}
    </div>
  );
}

/** 빈 화면: 무엇이 없는지 + 다음 행동 버튼 */
export function EmptyState({ title, children, action, center, icon }: { title: ReactNode; children?: ReactNode; action?: ReactNode; center?: boolean; icon?: ReactNode }) {
  return (
    <div className={`ui-empty ${center ? "center" : ""}`}>
      {icon}
      <span className="ttl">{title}</span>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

/** 고지 문구: 목록 끝과 상세 화면 하단에만 */
export function Disclaimer() {
  return <p className="ui-disclaimer">규칙에 맞는 후보 목록이며 투자 권유가 아니에요. 투자 판단과 책임은 본인에게 있어요.</p>;
}

/** 경계선을 끌어서 폭을 바꾸는 손잡이(컴퓨터). 키보드 ←→로도 바꾼다 */
export function Resizer({ value, onChange, min, max, label, invert = false }: { value: number; onChange: (v: number) => void; min: number; max: number; label: string; invert?: boolean }) {
  const start = useRef<{ x: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <button
      type="button"
      className="ui-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, v: value };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        onChange(clamp(start.current.v + (invert ? -dx : dx)));
      }}
      onPointerUp={() => (start.current = null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const d = (e.key === "ArrowRight" ? 16 : -16) * (invert ? -1 : 1);
          onChange(clamp(value + d));
        }
      }}
    />
  );
}
