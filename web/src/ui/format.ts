import { regionOfCode, shortDateKo, type Currency, type Region } from "@jusik/shared";

/*
 * 숫자 표기(UI 지도서 3.2 표).
 *  - 가격: 천 단위 쉼표. 목록에서는 '원' 생략, 주문 화면에서는 붙임 → fmtPrice(n, region, { unit: true })
 *  - 등락률: 부호를 항상, 소수 둘째 자리까지(+3.18%, -1.42%, 0.00%)
 *  - 등락 표시: 색 + 삼각형 + 부호를 함께(▲ 2,600 +3.18%)
 *  - 큰 금액: 억·조로 줄이고 소수 첫째 자리까지(거래대금 1.2조)
 *  - 손익 금액: 만 원 단위로 줄이고 부호(-8만 1천 원)
 *  - 시각: 한국 시간 24시 + 기준(15:12 기준), 날짜: 10.12(월)
 */

export type Tone = "up" | "down" | "flat";
export const toneOf = (n: number | null | undefined): Tone => (n == null || !Number.isFinite(n) || n === 0 ? "flat" : n > 0 ? "up" : "down");
export const arrowOf = (n: number | null | undefined) => (toneOf(n) === "up" ? "▲" : toneOf(n) === "down" ? "▼" : "");
export const regionOfCurrency = (c: Currency): Region => (c === "USD" ? "US" : "KR");

const nf = (d: number) => new Intl.NumberFormat("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2);

/** 가격. 국내는 정수·쉼표, 미국은 소수 둘째 자리. unit이면 '원'·'$'를 붙인다 */
export function fmtPrice(n: number | null | undefined, region: Region = "KR", opts: { unit?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "-";
  if (region === "US") return `${opts.unit ? "$" : ""}${NF2.format(n)}`;
  return `${NF0.format(Math.round(n))}${opts.unit ? "원" : ""}`;
}
export const fmtPriceByCode = (n: number | null | undefined, code: string, opts: { unit?: boolean } = {}) => fmtPrice(n, regionOfCode(code), opts);

/** 등락률: 항상 부호, 소수 둘째 자리 */
export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "-";
  const v = Number(n.toFixed(digits));
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(digits)}%`;
}

/** 부호 없는 비율(비중·한도 등): 소수 첫째 자리 */
export const fmtRatio = (n: number | null | undefined, digits = 1) => (n == null || !Number.isFinite(n) ? "-" : `${Number(n.toFixed(digits)).toLocaleString("ko-KR", { maximumFractionDigits: digits })}%`);

/** 변동폭(부호 없음, 삼각형과 함께 쓴다) */
export const fmtChangeAbs = (n: number | null | undefined, region: Region = "KR") => (n == null || !Number.isFinite(n) ? "-" : fmtPrice(Math.abs(n), region));

/** 큰 금액(원 또는 달러 원값): 국내 1.2조·3,450.2억·5,400만, 미국 $1.2B·$345.6M */
export function fmtBig(n: number | null | undefined, region: Region = "KR"): string {
  if (n == null || !Number.isFinite(n)) return "-";
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (region === "US") {
    if (a >= 1e12) return `${s}$${NF1.format(a / 1e12)}T`;
    if (a >= 1e9) return `${s}$${NF1.format(a / 1e9)}B`;
    if (a >= 1e6) return `${s}$${NF1.format(a / 1e6)}M`;
    return `${s}$${NF0.format(a)}`;
  }
  if (a >= 1e12) return `${s}${NF1.format(a / 1e12)}조`;
  if (a >= 1e8) return `${s}${NF1.format(a / 1e8)}억`;
  if (a >= 1e4) return `${s}${NF0.format(a / 1e4)}만`;
  return `${s}${NF0.format(a)}`;
}
/** 억원 단위로 받은 금액(시가총액 등) → 1.2조·3,450억 */
export const fmtEok = (eok: number | null | undefined) => (eok == null || !Number.isFinite(eok) ? "-" : fmtBig(eok * 1e8, "KR"));

/** 원화 손익: 만 원 단위로 줄이고 부호. -81,000 → "-8만 1천 원", 1,234,567 → "+123만 5천 원" */
export function fmtPnlKrw(n: number | null | undefined, opts: { sign?: boolean } = { sign: true }): string {
  if (n == null || !Number.isFinite(n)) return "-";
  // 1억 이상은 만 원 단위, 그 아래는 천 원 단위로 반올림한다
  const step = Math.abs(n) >= 1e8 ? 1e4 : 1e3;
  const r = Math.round(n / step) * step;
  const a = Math.abs(r);
  const sign = opts.sign === false ? "" : r > 0 ? "+" : r < 0 ? "-" : "";
  if (Math.abs(n) < 1000) return `${opts.sign === false ? "" : n > 0 ? "+" : n < 0 ? "-" : ""}${NF0.format(Math.abs(Math.round(n)))}원`;
  const eok = Math.floor(a / 1e8), man = Math.floor((a % 1e8) / 1e4), cheon = Math.floor((a % 1e4) / 1e3);
  const parts: string[] = [];
  if (eok) parts.push(`${NF0.format(eok)}억`);
  if (man) parts.push(`${NF0.format(man)}만`);
  if (cheon && !eok) parts.push(`${cheon}천`);
  return `${sign}${parts.join(" ") || "0"} 원`;
}

/** 지역에 맞는 손익 금액(국내 만 원 단위, 미국 달러) */
export function fmtPnl(n: number | null | undefined, region: Region = "KR"): string {
  if (n == null || !Number.isFinite(n)) return "-";
  if (region === "US") return `${n > 0 ? "+" : n < 0 ? "-" : ""}$${NF2.format(Math.abs(n))}`;
  return fmtPnlKrw(n);
}
export const fmtPnlByCurrency = (n: number | null | undefined, c: Currency) => fmtPnl(n, regionOfCurrency(c));

/** 금액(부호 없음): 국내 1,234,000원, 미국 $1,234.00 */
export function fmtMoney(n: number | null | undefined, region: Region = "KR"): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return region === "US" ? `$${NF2.format(n)}` : `${NF0.format(Math.round(n))}원`;
}
export const fmtMoneyByCurrency = (n: number | null | undefined, c: Currency) => fmtMoney(n, regionOfCurrency(c));

/** 정수(수량 등) */
export const fmtInt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "-" : NF0.format(Math.round(n)));
/** 일반 숫자(배수·지표) */
export const fmtNum = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n) ? "-" : n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** ISO 시각 → 한국 시간 "15:12" */
export function fmtTime(iso: string | number | Date | null | undefined): string {
  if (iso == null) return "-";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
/** "15:12 기준" */
export const fmtAsOf = (iso: string | number | Date | null | undefined) => (iso == null ? "" : `${fmtTime(iso)} 기준`);
/** "YYYY-MM-DD" → "10.12(월)" */
export const fmtDate = (ymd: string | null | undefined) => (ymd ? shortDateKo(ymd.slice(0, 10)) : "-");
/** ISO 시각 → 한국 날짜 "YYYY-MM-DD" */
export function kstDate(iso: string | number | Date): string {
  const d = new Date(iso);
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
/** ISO 시각 → "10.12(월) 15:12" (오늘이면 시각만) */
export function fmtWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "-";
  const day = kstDate(iso);
  return day === kstDate(now) ? fmtTime(iso) : `${fmtDate(day)} ${fmtTime(iso)}`;
}

/** 화면 낭독용 숫자 읽기: 84,300 → "8만 4천3백" */
export function readKo(n: number): string {
  const a = Math.round(Math.abs(n));
  if (a === 0) return "0";
  const small = (x: number) => {
    const u: [number, string][] = [[1000, "천"], [100, "백"], [10, "십"]];
    let out = "", r = x;
    for (const [v, w] of u) {
      const q = Math.floor(r / v);
      if (q) out += `${q}${w}`;
      r %= v;
    }
    return out + (r ? String(r) : "");
  };
  const parts: string[] = [];
  const jo = Math.floor(a / 1e12), eok = Math.floor((a % 1e12) / 1e8), man = Math.floor((a % 1e8) / 1e4), rest = a % 1e4;
  if (jo) parts.push(`${small(jo)}조`);
  if (eok) parts.push(`${small(eok)}억`);
  if (man) parts.push(`${small(man)}만`);
  if (rest) parts.push(small(rest));
  return `${n < 0 ? "마이너스 " : ""}${parts.join(" ")}`;
}

/** 화면 낭독용 시세 문장: "한빛반도체, 8만 4천3백 원, 3.18% 상승" */
export function srQuote(name: string, price: number, changePct: number | null | undefined, region: Region = "KR"): string {
  const p = region === "US" ? `${price.toFixed(2)}달러` : `${readKo(price)} 원`;
  if (changePct == null || !Number.isFinite(changePct)) return `${name}, ${p}`;
  const dir = changePct > 0 ? "상승" : changePct < 0 ? "하락" : "보합";
  return `${name}, ${p}, ${Math.abs(changePct).toFixed(2)}% ${dir}`;
}
