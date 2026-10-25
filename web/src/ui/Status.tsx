import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { marketSession, POSTURE_LABEL, type Posture, type Region } from "@jusik/shared";
import { fmtWhen } from "./format";

const POSTURE_CELLS: Record<Posture, number> = { DEFENSE: 1, NEUTRAL: 2, ATTACK: 3 };
const ORDER: Posture[] = ["DEFENSE", "NEUTRAL", "ATTACK"];

/**
 * 시장 국면 게이지(UI 지도서 3.1·8장): 색이 아니라 채운 칸 수로 방어 1칸·중립 2칸·공격 3칸.
 * posture가 null이면 점선 칸(판정 불가).
 */
export function RegimeGauge({ posture, size = "md", labels = true }: { posture: Posture | null | undefined; size?: "md" | "lg"; labels?: boolean }) {
  const n = posture ? POSTURE_CELLS[posture] : 0;
  const text = posture ? `시장 국면 ${POSTURE_LABEL[posture]}(3칸 중 ${n}칸)` : "시장 국면 판정 불가";
  return (
    <span className={`ui-gauge ${size}`} role="img" aria-label={text}>
      <span className="ui-gauge-cells" aria-hidden="true">
        {ORDER.map((p, i) => (
          <span key={p} className={`ui-gauge-cell ${!posture ? "na" : i < n ? "on" : ""}`} />
        ))}
      </span>
      {labels && (
        <span className="ui-gauge-labels" aria-hidden="true">
          {ORDER.map((p) => (
            <span key={p} className={p === posture ? "on" : ""}>
              {POSTURE_LABEL[p]}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * 시장 상태(장 시작 전·장중·장 마감·시간외·휴장) + 데이터 기준 시각(지도서 9.1). 지연 시세면 몇 분 지연인지 쓴다.
 * 장중에는 데이터의 기준 시각(asOf, 오늘이 아니면 날짜까지 '10.15(목) 19:53 기준'), 그 밖에는 기준 문구
 * ('전일 종가 기준', '15:30 종가', '다음 거래일 10.12(월)', '시간외 단일가')를 늘 보이게 쓴다(툴팁은 터치·키보드로 열 수 없다).
 * asOf를 모르고 받은 시각(receivedAt)만 알면 '15:12 받음'처럼 받은 시각이라고 밝힌다.
 * 휴장은 주말만 안다(공휴일 달력 없음).
 */
export function MarketStatus({ region, now, asOf, receivedAt, delayMin, showRegion = true, compact = false }: {
  region: Region;
  now: Date;
  /** 표시한 데이터의 기준 시각(스캔 시각·시세 시각 등) */
  asOf?: string | number | Date | null;
  /** 데이터 자체의 시각을 모를 때 받은 시각 */
  receivedAt?: string | number | Date | null;
  delayMin?: number | null;
  showRegion?: boolean;
  /** 상단 바처럼 좁은 곳: 휴장 문구를 '다음 10.12(월)'로 줄인다 */
  compact?: boolean;
}) {
  const s = marketSession(region, now);
  const when = (t: string | number | Date) => fmtWhen(new Date(t).toISOString(), now);
  const time =
    s.state === "open"
      ? delayMin
        ? `${delayMin}분 지연`
        : asOf != null && Number.isFinite(new Date(asOf).getTime())
          ? `${when(asOf)} 기준`
          : receivedAt != null && Number.isFinite(new Date(receivedAt).getTime())
            ? `${when(receivedAt)} 받음`
            : ""
      : compact && s.state === "holiday"
        ? s.sub.replace("다음 거래일", "다음")
        : s.sub;
  const tip = [s.state !== "open" ? s.sub : "", s.state === "holiday" ? "주말만 휴장으로 표시해요(공휴일은 반영하지 않아요)" : ""].filter(Boolean).join(" · ");
  return (
    <span className={`ui-mstatus ${s.state}`} title={tip || undefined}>
      <span className="dot" aria-hidden="true" />
      {showRegion && <span className="sub">{region === "KR" ? "국내" : "미국"}</span>}
      <span className="lbl">{s.label}</span>
      {time && <span className="sub">{time}</span>}
    </span>
  );
}

export type MeterState = "normal" | "near" | "over";

/**
 * 리스크 미터(UI 지도서 8장): 정상, 상한 근접(90% 이상), 초과. 초과면 주문 확인 버튼을 꺼야 한다(meterState로 판정).
 * 손실 한도처럼 음수 한도도 받는다(value −0.6, limit −2.0 → 30%).
 */
export function meterState(value: number | null | undefined, limit: number | null | undefined): MeterState {
  if (value == null || limit == null || !Number.isFinite(value) || !Number.isFinite(limit) || limit === 0) return "normal";
  const r = value / limit;
  if (r > 1 + 1e-9) return "over";
  if (r >= 0.9) return "near";
  return "normal";
}

export function RiskMeter({ label, value, limit, format, limitLabel, overText = "초과", nearText = "상한 근접" }: {
  label: string;
  value: number | null | undefined;
  limit: number | null | undefined;
  format: (n: number) => string;
  /** 한도 문구(기본: "상한 10%") */
  limitLabel?: string;
  overText?: string;
  nearText?: string;
}) {
  const st = meterState(value, limit);
  const ratio = value != null && limit ? Math.max(0, value / limit) : 0;
  const scale = Math.max(1.1, ratio); // 한도 눈금이 보이도록 막대 끝을 한도보다 조금 길게
  return (
    <div className={`ui-meter ${st}`}>
      <div className="ui-meter-head">
        <span className="t-2">{label}</span>
        <span className="val">{value == null ? "-" : format(value)}</span>
      </div>
      <div className="ui-meter-track" aria-hidden="true">
        <div className="ui-meter-fill" style={{ width: `${Math.min(100, (ratio / scale) * 100)}%` }} />
        {limit != null && <div className="ui-meter-tick" style={{ left: `calc(${(1 / scale) * 100}% - 1px)` }} />}
      </div>
      <div className="ui-meter-foot">
        <span>{limitLabel ?? (limit != null ? `한도 ${format(limit)}` : "한도 없음")}</span>
        {st !== "normal" && (
          <span className="state row" style={{ gap: 4 }}>
            <AlertTriangle size={12} strokeWidth={1.5} aria-hidden="true" />
            {st === "over" ? overText : nearText}
          </span>
        )}
      </div>
    </div>
  );
}

/** 안내 띠: 오류·경고는 경고색 + 아이콘 + 문장(빨강은 쓰지 않는다) */
export function Notice({ tone = "info", title, children, action, className = "" }: { tone?: "info" | "warn" | "ok"; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = tone === "warn" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Info;
  return (
    <div className={`ui-notice ${tone} ${className}`} role={tone === "warn" ? "alert" : "status"}>
      <Icon className="ico" size={16} strokeWidth={1.5} aria-hidden="true" />
      <div className="grow stack" style={{ gap: 2 }}>
        {title && <span className="ttl">{title}</span>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}
