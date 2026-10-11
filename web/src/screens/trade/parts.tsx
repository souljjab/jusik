import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Currency, Region } from "@jusik/shared";
import { getOverview, startScan } from "../../api";
import { useApp } from "../../app/AppContext";
import { arrowOf, Button, fmtPnlByCurrency, fmtRatio, fmtWhen, MarketStatus, toneOf, useToast } from "../../ui";
import { CUR_ACCOUNT, NEAR_STOP_PCT, regionOfCur } from "./tradeModel";

/** 손익 금액: 색 + 삼각형 + 부호(만 원 단위) */
export function Pnl({ value, currency, className = "" }: { value: number | null | undefined; currency: Currency; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={`num flat ${className}`}>-</span>;
  const t = toneOf(value);
  const text = fmtPnlByCurrency(value, currency);
  return (
    <span className={`num ${t} ${className}`} aria-label={`${text}${t === "up" ? " 이익" : t === "down" ? " 손실" : ""}`}>
      <span aria-hidden="true">
        {arrowOf(value)} {text}
      </span>
    </span>
  );
}

/**
 * 손절 시 예상 손실(아직 일어나지 않은 금액): 부호만 붙이고 상승·하락 색과 삼각형은 쓰지 않는다(주문 검토 시트의 위험 상자와 같게).
 * value는 잃는 금액(양수).
 */
export function Loss({ value, currency, className = "" }: { value: number; currency: Currency; className?: string }) {
  const text = value > 0 ? fmtPnlByCurrency(-value, currency) : fmtPnlByCurrency(0, currency);
  return <span className={`num ${className}`}>{text}</span>;
}

/**
 * 손절가까지 남은 거리. 2% 안쪽이면 경고색 + 아이콘 + 문장(색에만 기대지 않는다).
 * 이미 손절가 아래면 '손절가 아래'.
 */
export function StopDistance({ leftPct, className = "" }: { leftPct: number | null | undefined; className?: string }) {
  if (leftPct == null || !Number.isFinite(leftPct)) return <span className={`t-cap ${className}`}>손절가 없음</span>;
  const near = leftPct <= NEAR_STOP_PCT;
  return (
    <span className={`trd-stopdist ${near ? "is-near" : ""} ${className}`}>
      {near && <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />}
      {leftPct <= 0 ? "손절가 아래" : `손절가까지 ${fmtRatio(leftPct)}`}
      {near && leftPct > 0 && <span className="sr-only">, 손절가 근접</span>}
    </span>
  );
}

/** 계좌 이름 + 그 시장 상태와 기준 시각 */
export function AccountTitle({ currency, asOf, as: H = "h3", id, extra }: { currency: Currency; asOf?: string | null; as?: "h2" | "h3"; id?: string; extra?: ReactNode }) {
  const { now } = useApp();
  return (
    <div className="trd-acct-title">
      <H id={id} className="trd-h3">
        {CUR_ACCOUNT[currency]}
      </H>
      <MarketStatus region={regionOfCur(currency)} now={now} asOf={asOf} showRegion={false} />
      {extra}
    </div>
  );
}

/** "15:12 기준"(오늘이 아니면 "10.10(금) 15:12 기준") */
export function asOfText(iso: string | null | undefined, now: Date): string {
  return iso ? `${fmtWhen(iso, now)} 기준` : "";
}

/** '지금 스캔': 서버가 스캔 중이면 처리 중 표시. 결과는 서버 상태를 다시 받아 반영한다 */
export function ScanButton({ variant = "secondary", size = "sm", block = false }: { variant?: "primary" | "secondary"; size?: "sm" | "md" | "lg"; block?: boolean }) {
  const { server, refreshServer } = useApp();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const scanning = pending || !!server?.status.scheduler.scanning;
  const run = async () => {
    setPending(true);
    try {
      const r = await startScan();
      toast(r.started ? "스캔을 시작했어요. 끝나면 계획이 바뀌어요." : r.message, r.started ? "info" : "warn");
      await refreshServer();
    } finally {
      setPending(false);
    }
  };
  return (
    <Button variant={variant} size={size} block={block} busy={scanning} icon={<RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={run}>
      {scanning ? "스캔 중" : "지금 스캔"}
    </Button>
  );
}

export interface QuoteInfo {
  price: number;
  changePct: number | null;
}

/**
 * 직접 보유한 종목의 현재가(모의계좌 종목은 서버가 이미 갱신한다). 종목마다 개요를 한 번씩 받고,
 * 1분마다 다시 받는다. 받지 못한 종목은 비워 둔다(화면은 '-'로 보인다).
 */
export function useQuotes(codes: string[]): { quotes: Record<string, QuoteInfo>; at: string | null; failed: boolean } {
  const [quotes, setQuotes] = useState<Record<string, QuoteInfo>>({});
  const [at, setAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const key = [...new Set(codes)].sort().join(",");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!key) return;
    const list = key.split(",").slice(0, 30);
    const load = async () => {
      const got = await Promise.all(
        list.map((c) =>
          getOverview(c)
            .then((r) => [c, r.quote && r.quote.price > 0 ? { price: r.quote.price, changePct: Number.isFinite(r.quote.changePct) ? r.quote.changePct : null } : null] as const)
            .catch(() => [c, null] as const),
        ),
      );
      if (!alive.current) return;
      const next: Record<string, QuoteInfo> = {};
      let miss = 0;
      for (const [c, q] of got) q ? (next[c] = q) : miss++;
      setQuotes((prev) => ({ ...prev, ...next }));
      setFailed(miss === list.length);
      if (miss < list.length) setAt(new Date().toISOString());
    };
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [key]);
  return { quotes, at, failed };
}

/** 진행 막대(모의투자 기간·청산 건수). 강조색 대신 보조 글자색으로 채운다 */
export function Progress({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <div className="trd-progress">
      <div className="row between t-2">
        <span>{label}</span>
        <span className="num">
          <span className="trd-strong">{value.toLocaleString("ko-KR")}</span> / {max.toLocaleString("ko-KR")}
          {unit}
        </span>
      </div>
      <div className="trd-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
        <span className="trd-progress-fill" style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

export const REGION_NAME: Record<Region, string> = { KR: "국내", US: "미국" };
