import { regionOfCode, type Currency, type Region } from "@jusik/shared";

export const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** 지역(통화)에 맞는 금액 표기: 한국은 원, 미국은 달러 */
export const money = (n: number, region: Region) => (region === "US" ? usd(n) : won(n));
export const moneyByCode = (n: number, code: string) => money(n, regionOfCode(code));
export const moneyByCurrency = (n: number, cur: Currency) => (cur === "USD" ? usd(n) : won(n));
/** ISO 시각 → 한국 시간 'MM-DD HH:mm' */
export const kst = (iso: string | null | undefined) => (iso ? new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ") : "-");
export const num = (n: number | null | undefined, d = 1) => (n == null ? "-" : n.toLocaleString("ko-KR", { maximumFractionDigits: d }));
export const pct = (n: number, d = 2) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
/** 한국식 색상: 상승 빨강, 하락 파랑 */
export const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
