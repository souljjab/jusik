import { useEffect, useRef, useState } from "react";
import type { Region } from "@jusik/shared";
import { arrowOf, fmtChangeAbs, fmtPct, fmtPrice, srQuote, toneOf } from "./format";

/**
 * 가격(UI 지도서 8장 시세 표시). 값이 바뀌면 칸 바탕을 0.3초 옅게 물들였다 지운다(동작 줄이기 설정이면 안 한다).
 * unit: 주문 화면처럼 '원'·'$'를 붙일 때
 */
export function Price({
  value, region = "KR", size = "md", unit = false, tone = false, change, className = "",
}: {
  value: number | null | undefined;
  region?: Region;
  size?: "lg" | "md" | "sm";
  unit?: boolean;
  /** true면 change 부호로 색을 입힌다(현재가 머리말 등) */
  tone?: boolean;
  change?: number | null;
  className?: string;
}) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current != null && value != null && prev.current !== value) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 300);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  const t = tone ? toneOf(change) : "";
  return <span className={`ui-price ${size} ${t} ${flash ? "flash" : ""} ${className}`}>{fmtPrice(value, region, { unit })}</span>;
}

/**
 * 등락: 색 + 삼각형 + 부호를 함께 써서 색 없이도 읽히게(▲ 2,600 +3.18%).
 * layout="stack"이면 가격 아래 두 줄(핸드폰 목록).
 */
export function Change({
  change, pct, region = "KR", layout = "inline", showAbs = true, className = "",
}: {
  change?: number | null;
  pct: number | null | undefined;
  region?: Region;
  layout?: "inline" | "stack";
  showAbs?: boolean;
  className?: string;
}) {
  const basis = pct ?? change ?? 0;
  const tone = toneOf(basis);
  const dir = tone === "up" ? "상승" : tone === "down" ? "하락" : "보합";
  return (
    <span className={`ui-change ${tone} ${layout === "stack" ? "stack" : ""} ${className}`} aria-label={`${pct != null ? `${Math.abs(pct).toFixed(2)}% ` : ""}${dir}`}>
      {showAbs && change != null && (
        <span aria-hidden="true">
          {arrowOf(basis)} {fmtChangeAbs(change, region)}
        </span>
      )}
      <span aria-hidden="true">{!showAbs || change == null ? `${arrowOf(basis)} ` : ""}{fmtPct(pct)}</span>
    </span>
  );
}

/** 거래 정지·지연 표시 */
export function QuoteState({ halted, delayMin }: { halted?: boolean; delayMin?: number | null }) {
  if (halted) return <span className="ui-quote-state">거래 정지</span>;
  if (delayMin) return <span className="ui-quote-state">{delayMin}분 지연</span>;
  return null;
}

/** 이름·가격·등락 한 덩어리(목록 행). 화면 낭독은 한 문장으로 읽는다 */
export function QuoteLine({ name, price, change, pct, region = "KR", layout = "inline" }: { name: string; price: number; change?: number | null; pct: number | null | undefined; region?: Region; layout?: "inline" | "stack" }) {
  return (
    <span className="row" aria-label={srQuote(name, price, pct, region)}>
      <span aria-hidden="true" className="row">
        <Price value={price} region={region} size="sm" />
        <Change change={change} pct={pct} region={region} layout={layout} showAbs={false} />
      </span>
    </span>
  );
}
