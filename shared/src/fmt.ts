/** 등락률 글자(UI 지도서 3.2): 항상 부호, 소수 둘째 자리(+3.18%, -1.42%, 0.00%). 화면의 fmtPct와 같은 규칙(서버·공용 문장용) */
export function signedPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "-";
  const v = Number(n.toFixed(digits));
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(digits)}%`;
}
