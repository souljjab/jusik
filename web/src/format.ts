export const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
export const num = (n: number | null | undefined, d = 1) => (n == null ? "-" : n.toLocaleString("ko-KR", { maximumFractionDigits: d }));
export const pct = (n: number, d = 2) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
/** 한국식 색상: 상승 빨강, 하락 파랑 */
export const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
