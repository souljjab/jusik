import type { KeyboardEvent } from "react";
import type { Region } from "@jusik/shared";
import { fmtAmountInput } from "../../features/strategyRun";

/** 금액 입력칸 이름: 단위는 입력칸 오른쪽에 보이고, 화면 낭독에는 이름에 붙여 읽힌다 */
export function amountLabel(label: string, region: Region) {
  return (
    <>
      {label}
      <span className="sr-only">({region === "US" ? "달러" : "원"})</span>
    </>
  );
}

/** 금액 입력칸(주문 검토 시트의 가격 칸처럼 천 단위 쉼표, 오른쪽에 단위) */
export function AmountInput({ id, value, onChange, region, onEnter, invalid }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  region: Region;
  onEnter?: () => void;
  invalid?: boolean;
}) {
  return (
    <span className="disc-amount">
      <input
        id={id}
        className="ui-input num"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(fmtAmountInput(e.target.value))}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && onEnter?.()}
      />
      <span className="disc-amount-unit" aria-hidden="true">
        {region === "US" ? "달러" : "원"}
      </span>
    </span>
  );
}
