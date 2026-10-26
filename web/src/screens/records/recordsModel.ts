import { currencyOfRegion, followedRules, netOf, regionOfCode, rMultiple, type Currency, type JournalEntry } from "@jusik/shared";
import { fmtRatio } from "../../ui/format";

/*
 * 기록 화면 계산 도우미(순수 함수). 화면은 여기서 만든 값만 그린다.
 *  - 감정 태그: 지도서 7.2 F(차분·조급·확신·불안) + 자료집 5.5 위험 감정(욕심·두려움·희망 보유·복수 매매)
 *  - 기간: 일·주(월~일)·월. 날짜는 일지의 날짜 문자열(YYYY-MM-DD, 그 시장 현지 날짜)로 자른다
 *  - 거래 결과: 매도 기록마다 같은 출처(직접·자동)·같은 종목의 매수분을 선입선출로 짝지어 손익·수익률·R을 낸다.
 *    자동(모의) 매도만 비용을 뺀 순손익(netOf)을 쓰고, 직접 쓴 매도는 선입선출 결과(수수료 제외)를 쓴다
 *  - 손절 지연: 직접 쓴 매도가 계획한 손절가보다 1% 넘게 아래면 그 매도 기록의 위반으로 센다.
 *    자동(모의) 손절이 갭 하락으로 손절가 아래에서 체결된 것은 위반이 아니라 사실로만 보여 준다
 *  - 규칙 준수율: 직접 쓴 기록 중 판단할 수 있는 기록에서 지킨 기록의 비율(모의매매 자동 기록과 판단할 수 없는 기록은 빼고 센다)
 *  - '거래' 수는 결과를 아는 청산(매도) 수 = 승률의 바탕(지도서 7.2 E '4건 · 50%')
 */

// ───────────────────────── 감정 ─────────────────────────

/** 새 일지의 '지금 감정' 칩(지도서 7.2 F) */
export const EMOTIONS_MAIN = ["차분", "조급", "확신", "불안"] as const;
/** 더 고를 수 있는 감정(자료집 5.5 심리 규칙의 위험 감정. 이전 일지에서 쓰던 이름) */
export const EMOTIONS_MORE = ["욕심", "두려움", "희망 보유", "복수 매매"] as const;
export const EMOTIONS: readonly string[] = [...EMOTIONS_MAIN, ...EMOTIONS_MORE];
/** 이전 버전 이름 → 지금 칩 이름 */
const ALIAS: Record<string, string> = { 조급함: "조급" };

const norm = (s: string) => ALIAS[s.trim()] ?? s.trim();

/** 저장된 감정 문자열("조급, 메모")을 칩과 직접 적은 글로 나눈다 */
export function parseEmotion(v: string | null | undefined): { chips: string[]; text: string } {
  const parts = (v ?? "").split(",").map(norm).filter(Boolean);
  const known = new Set(EMOTIONS);
  return { chips: [...new Set(parts.filter((p) => known.has(p)))], text: parts.filter((p) => !known.has(p)).join(", ") };
}

/** 칩(정해진 순서) + 직접 적은 글을 한 문자열로. 서버 한도(200자)에 맞춘다 */
export function composeEmotion(chips: string[], text: string): string {
  return [...EMOTIONS.filter((e) => chips.includes(e)), text.trim()].filter(Boolean).join(", ").slice(0, 200);
}

/** 감정 태그 목록(칩 + 직접 적은 말 조각). 감정별 결과를 묶는 데 쓴다 */
export function emotionTags(v: string | null | undefined): string[] {
  return [...new Set((v ?? "").split(",").map(norm).filter(Boolean))];
}

// ───────────────────────── 규칙 체크 ─────────────────────────

export type SelfCheck = NonNullable<JournalEntry["selfCheck"]>;

/** 규칙 체크 토글 이름(지도서 7.2 G) */
export const SELF_CHECK_LABEL: Record<keyof SelfCheck, string> = {
  stopSet: "손절가를 미리 정했다",
  weightOk: "비중 상한을 지켰다",
  unplanned: "계획에 없던 매수다",
};

/** 손절 지연 문장(직접 쓴 매도) */
export const stopLateText = (r: Pick<SellResult, "belowStopPct">) => `계획한 손절가보다 ${fmtRatio(r.belowStopPct)} 아래에서 팔았어요.`;

/** 서버 위반 중 스스로 표시한 체크와 같은 규칙(손절가·비중)인 것 */
const SAME_RULE: Partial<Record<keyof SelfCheck, RegExp>> = { stopSet: /손절가/, weightOk: /비중/ };

/**
 * 기록 하나가 어긴 것: 서버가 찾은 위반 + 스스로 표시한 체크에서 어긴 것 + 손절 지연(직접 쓴 매도, r을 줄 때).
 * 같은 규칙은 한 번만 센다: 서버가 이미 손절가·비중 위반을 남겼으면 같은 체크 항목은 더하지 않는다.
 */
export function breaches(e: Pick<JournalEntry, "violations" | "selfCheck">, r?: Pick<SellResult, "stopLate" | "belowStopPct">): string[] {
  const v = e.violations ?? [];
  const out = [...v];
  const c = e.selfCheck;
  const dup = (k: keyof SelfCheck) => v.some((x) => SAME_RULE[k]?.test(x));
  if (c) {
    if (!c.stopSet && !dup("stopSet")) out.push("손절가를 미리 정하지 않았어요.");
    if (!c.weightOk && !dup("weightOk")) out.push("비중 상한을 넘었어요.");
    if (c.unplanned) out.push("계획에 없던 매수예요.");
  }
  if (r?.stopLate) out.push(stopLateText(r));
  return out;
}

/** 규칙을 지킨 기록인가: 손절 지연 매도는 어긴 기록, 그 밖은 followedRules. 판단할 근거가 없으면 null */
export function entryFollowed(e: Pick<JournalEntry, "violations" | "selfCheck" | "source">, r?: Pick<SellResult, "stopLate">): boolean | null {
  if (r?.stopLate) return false;
  return followedRules(e);
}

/** 규칙 판정 문구: '규칙 지킴' / '위반 n건' / null(판단할 근거 없음). 매도는 r(거래 결과)을 주면 손절 지연도 본다 */
export function ruleVerdict(e: Pick<JournalEntry, "violations" | "selfCheck" | "source">, r?: Pick<SellResult, "stopLate" | "belowStopPct">): { ok: boolean; text: string } | null {
  const f = entryFollowed(e, r);
  if (f == null) return null;
  if (f) return { ok: true, text: "규칙 지킴" };
  return { ok: false, text: `위반 ${Math.max(1, breaches(e, r).length)}건` };
}

// ───────────────────────── 날짜·기간 ─────────────────────────

export type Period = "day" | "week" | "month";
export interface Range {
  from: string;
  to: string;
}

const ymdUTC = (d: Date) => d.toISOString().slice(0, 10);
const parse = (ymd: string) => new Date(`${ymd.slice(0, 10)}T00:00:00Z`);

export function addDays(ymd: string, n: number): string {
  return ymdUTC(new Date(parse(ymd).getTime() + n * 86_400_000));
}

/** 그 주의 월요일 */
export function weekStart(ymd: string): string {
  const wd = parse(ymd).getUTCDay(); // 0 일요일
  return addDays(ymd, -((wd + 6) % 7));
}

/** 기준 날짜가 든 기간을 offset만큼 앞뒤로 옮긴 범위(양 끝 포함) */
export function periodRange(period: Period, anchor: string, offset = 0): Range {
  if (period === "day") {
    const d = addDays(anchor, offset);
    return { from: d, to: d };
  }
  if (period === "week") {
    const from = addDays(weekStart(anchor), offset * 7);
    return { from, to: addDays(from, 6) };
  }
  const a = parse(anchor);
  const first = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { from: ymdUTC(first), to: ymdUTC(last) };
}

export const inRange = (ymd: string, r: Range) => ymd.slice(0, 10) >= r.from && ymd.slice(0, 10) <= r.to;

// ───────────────────────── 거래 결과 ─────────────────────────

export interface SellResult {
  /** 손익(현지 통화). 자동(모의)은 비용을 뺀 순손익, 직접 쓴 기록은 비용을 빼지 않은 금액 */
  pnl: number | null;
  /** 수익률(%) */
  pct: number | null;
  /** 수수료·세금을 뺀 값인지 */
  net: boolean;
  /** R 배수(매수분에 손절가가 있을 때) */
  r: number | null;
  /** R을 매수 기록의 손절가로 계산했는지(저장된 R이 아니라) */
  rDerived: boolean;
  /** 짝지은 매수 기록 */
  buyIds: string[];
  /** 직접 쓴 매도가 계획한 손절가보다 1% 넘게 아래에서 팔았는지(손절 지연, 규칙 위반) */
  stopLate: boolean;
  /** 계획한 손절가보다 1% 넘게 아래에서 팔았으면 얼마나 아래였는지(%). 자동(모의)도 채운다(갭 하락 체결 안내용) */
  belowStopPct: number | null;
  currency: Currency;
}

export const sourceOf = (e: Pick<JournalEntry, "source">) => e.source ?? "수동";
export const currencyOfCode = (code: string): Currency => currencyOfRegion(regionOfCode(code));

/** 같은 날은 매수 먼저, 그다음 저장 순서(summarizeJournal과 같은 짝짓기 순서) */
function chronological(entries: JournalEntry[]): JournalEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.date.localeCompare(b.e.date) || (a.e.side === b.e.side ? a.i - b.i : a.e.side === "BUY" ? -1 : 1))
    .map((x) => x.e);
}

/** 손절가보다 이만큼 넘게 낮은 값에 팔았으면 '손절 지연'으로 본다(체결 미끄러짐 여유) */
export const STOP_LATE_TOL = 0.01;

/**
 * 매도 기록마다 결과를 낸다. 출처(직접·자동)가 다르면 다른 계좌라 섞어 짝짓지 않는다.
 * 자동(모의) 매도는 비용을 뺀 순손익(netOf)을 먼저 쓰고, 직접 쓴 매도는 선입선출 결과만 쓴다(복기 메모의 글이 결과로 읽히지 않게).
 * 짝지을 매수분이 없고 순손익 숫자도 없으면 손익·수익률은 null.
 */
export function sellResults(entries: JournalEntry[]): Map<string, SellResult> {
  const lots = new Map<string, { id: string; price: number; qty: number; stop?: number }[]>();
  const out = new Map<string, SellResult>();
  for (const e of chronological(entries)) {
    const key = `${sourceOf(e)}|${e.code}`;
    const q = lots.get(key) ?? [];
    lots.set(key, q);
    if (e.side === "BUY") {
      q.push({ id: e.id, price: e.price, qty: e.qty, stop: e.stop });
      continue;
    }
    let remain = e.qty, cost = 0, matched = 0, rSum = 0, rW = 0, below: number | null = null;
    const buyIds: string[] = [];
    while (remain > 0 && q.length) {
      const lot = q[0]!;
      const take = Math.min(lot.qty, remain);
      cost += lot.price * take;
      matched += take;
      if (!buyIds.includes(lot.id)) buyIds.push(lot.id);
      const r = rMultiple(lot.price, e.price, lot.stop);
      if (r != null) (rSum += r * take), (rW += take);
      if (lot.stop != null && lot.stop > 0 && e.price < lot.stop * (1 - STOP_LATE_TOL)) below = Math.max(below ?? 0, (1 - e.price / lot.stop) * 100);
      lot.qty -= take;
      remain -= take;
      if (lot.qty === 0) q.shift();
    }
    const auto = sourceOf(e) === "자동(모의)";
    const n = auto ? netOf(e) : { pnl: null, pct: null };
    const gross = matched > 0 ? { pnl: (e.price - cost / matched) * matched, pct: (e.price / (cost / matched) - 1) * 100 } : null;
    const net = n.pnl != null || n.pct != null;
    const stored = e.rMultiple != null && Number.isFinite(e.rMultiple) ? e.rMultiple : null;
    out.set(e.id, {
      pnl: n.pnl ?? (net ? null : gross?.pnl ?? null),
      pct: n.pct ?? gross?.pct ?? null,
      net,
      r: stored ?? (rW > 0 ? rSum / rW : null),
      rDerived: stored == null && rW > 0,
      buyIds,
      stopLate: !auto && below != null,
      belowStopPct: below,
      currency: currencyOfCode(e.code),
    });
  }
  return out;
}

/** 이긴 거래인가(손익이 없으면 수익률로). 결과를 모르면 null */
export function isWin(r: Pick<SellResult, "pnl" | "pct"> | undefined): boolean | null {
  if (!r) return null;
  if (r.pnl != null) return r.pnl > 0;
  if (r.pct != null) return r.pct > 0;
  return null;
}

// ───────────────────────── 기간 요약 ─────────────────────────

export interface PeriodStats {
  /** 매수·매도 기록 수(직접·자동 모두) */
  buys: number;
  sells: number;
  /** 결과를 아는 청산(매도) 수. 화면의 '거래' 수이자 승률의 바탕 */
  closed: number;
  wins: number;
  winRate: number | null;
  /** 규칙 준수를 판단할 수 있었던 직접 쓴 기록 수(모의매매 자동 기록은 빼고 센다) */
  judged: number;
  followed: number;
  /** 0~1. 판단할 기록이 없으면 null */
  compliance: number | null;
  /** 통화별 실현 손익 합(결과를 아는 매도만) */
  pnl: Record<Currency, number>;
}

export function periodStats(entries: JournalEntry[], results: Map<string, SellResult>): PeriodStats {
  let buys = 0, sells = 0, closed = 0, wins = 0, judged = 0, followed = 0;
  const pnl: Record<Currency, number> = { KRW: 0, USD: 0 };
  for (const e of entries) {
    const r = e.side === "SELL" ? results.get(e.id) : undefined;
    if (e.side === "BUY") buys++;
    else {
      sells++;
      const w = isWin(r);
      if (w != null) {
        closed++;
        if (w) wins++;
      }
      if (r?.pnl != null) pnl[r.currency] += r.pnl;
    }
    // 규칙 준수율은 내가 직접 한 매매의 과정만 본다(지도서 6.2 D·7.2 G). 모의매매 엔진이 남긴 기록은 빼고 센다
    if (sourceOf(e) !== "수동") continue;
    const f = entryFollowed(e, r);
    if (f != null) {
      judged++;
      if (f) followed++;
    }
  }
  return { buys, sells, closed, wins, winRate: closed ? wins / closed : null, judged, followed, compliance: judged ? followed / judged : null, pnl };
}

/** 0~1 비율 → "92%"(없으면 "-") */
export const pct0 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "-" : `${Math.round(x * 100)}%`);

// ───────────────────────── 거래별 결과(복기) ─────────────────────────

export interface Tag {
  label: string;
  tone: "ok" | "warn" | "plain";
}

export interface TradeRow {
  id: string;
  code: string;
  name: string;
  date: string;
  source: "수동" | "자동(모의)";
  result: SellResult | undefined;
  /** 매도·짝지은 매수 기록을 모두 보고 낸 규칙 판정 */
  followed: boolean | null;
  /** 과정 태그: 계획대로·손절 지연·위반 n건·계획 외 매수 */
  tags: Tag[];
  /** 매수·매도 때 남긴 감정 */
  emotions: string[];
}

/** 기간 안의 매도 기록을 거래 행으로. 최신 먼저 */
export function tradeRows(periodEntries: JournalEntry[], all: JournalEntry[], results: Map<string, SellResult>): TradeRow[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  const rows: TradeRow[] = [];
  for (const e of periodEntries) {
    if (e.side !== "SELL") continue;
    const r = results.get(e.id);
    const buys = (r?.buyIds ?? []).map((id) => byId.get(id)).filter((x): x is JournalEntry => !!x);
    const verdicts = [e, ...buys].map((x) => followedRules(x));
    const followed = verdicts.includes(false) ? false : verdicts.includes(true) ? true : null;
    const unplanned = buys.filter((b) => b.selfCheck?.unplanned).length;
    // '계획 외 매수'는 따로 태그로 보이므로 위반 건수에서 뺀다
    const otherBreaches = [e, ...buys].reduce((a, x) => a + breaches(x).length, 0) - unplanned;
    const tags: Tag[] = [];
    if (followed === true && !r?.stopLate) tags.push({ label: "계획대로", tone: "ok" });
    if (r?.stopLate) tags.push({ label: "손절 지연", tone: "warn" });
    // 자동(모의) 손절이 갭 하락 등으로 손절가 아래에서 체결됨: 위반이 아니라 사실만
    else if (r?.belowStopPct != null) tags.push({ label: "손절가 아래 체결", tone: "plain" });
    if (unplanned) tags.push({ label: "계획 외 매수", tone: "warn" });
    if (otherBreaches > 0) tags.push({ label: `위반 ${otherBreaches}건`, tone: "warn" });
    const emotions = [...new Set([...buys.flatMap((b) => emotionTags(b.emotion)), ...emotionTags(e.emotion)])];
    rows.push({ id: e.id, code: e.code, name: e.name, date: e.date, source: sourceOf(e), result: r, followed: r?.stopLate ? false : followed, tags, emotions });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export interface EmotionStat {
  tag: string;
  n: number;
  wins: number;
  winRate: number | null;
  /** 평균 수익률(%) */
  avgPct: number | null;
}

export const NO_EMOTION = "감정 기록 없음";

/** 감정별 결과(지도서 7.2 F: 복기 때 감정과 결과의 관계). 거래가 많은 감정 먼저, '기록 없음'은 맨 끝 */
export function emotionStats(rows: TradeRow[]): EmotionStat[] {
  const m = new Map<string, { n: number; wins: number; pcts: number[] }>();
  for (const row of rows) {
    const w = isWin(row.result);
    if (w == null) continue;
    for (const tag of row.emotions.length ? row.emotions : [NO_EMOTION]) {
      const s = m.get(tag) ?? { n: 0, wins: 0, pcts: [] };
      s.n++;
      if (w) s.wins++;
      if (row.result?.pct != null) s.pcts.push(row.result.pct);
      m.set(tag, s);
    }
  }
  return [...m.entries()]
    .map(([tag, s]) => ({ tag, n: s.n, wins: s.wins, winRate: s.n ? s.wins / s.n : null, avgPct: s.pcts.length ? s.pcts.reduce((a, b) => a + b, 0) / s.pcts.length : null }))
    .sort((a, b) => (a.tag === NO_EMOTION ? 1 : b.tag === NO_EMOTION ? -1 : b.n - a.n || a.tag.localeCompare(b.tag)));
}

export interface ViolationItem {
  id: string;
  date: string;
  code: string;
  name: string;
  side: "BUY" | "SELL";
  items: string[];
}

/** 기간 안의 위반 기록(최신 먼저). results를 주면 손절 지연 매도도 넣는다(복기 탭 표시 숫자와 같은 규칙) */
export function violationItems(entries: JournalEntry[], results?: Map<string, SellResult>): ViolationItem[] {
  return entries
    .map((e, i) => ({ e, i, items: breaches(e, e.side === "SELL" ? results?.get(e.id) : undefined) }))
    .filter((x) => x.items.length > 0)
    .sort((a, b) => b.e.date.localeCompare(a.e.date) || b.i - a.i)
    .map(({ e, items }) => ({ id: e.id, date: e.date, code: e.code, name: e.name, side: e.side, items }));
}

// ───────────────────────── 일지 목록 ─────────────────────────

/** 날짜별 묶음. 최신 날짜 먼저, 같은 날은 나중에 적은 기록 먼저 */
export function groupByDate(entries: JournalEntry[]): { date: string; items: JournalEntry[] }[] {
  const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => b.e.date.localeCompare(a.e.date) || b.i - a.i);
  const groups: { date: string; items: JournalEntry[] }[] = [];
  for (const { e } of sorted) {
    const g = groups.at(-1);
    if (g && g.date === e.date) g.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  return groups;
}

/** 누적 손익 추이(기간 안 매도 결과를 날짜순으로 더한 값). 통화 하나만 */
export function cumulativePnl(rows: TradeRow[], cur: Currency): number[] {
  const xs = rows.filter((r) => r.result?.currency === cur && r.result.pnl != null).sort((a, b) => a.date.localeCompare(b.date));
  let s = 0;
  return xs.length ? [0, ...xs.map((r) => (s += r.result!.pnl!))] : [];
}

// ───────────────────────── 새 일지 입력 ─────────────────────────

/** 빈칸은 undefined, 숫자가 아니면 NaN(체크리스트가 '미입력'으로 본다) */
export const optNum = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s.replace(/,/g, "")));

/**
 * 계좌 대비 비중(%) = 가격 × 수량 ÷ 계좌 기준 금액. 계산할 수 없으면 null(소수 첫째 자리).
 * 일지의 비중은 '이 주문 뒤 그 종목 전체 비중'이라 수량에 이미 가진 수량을 더해서 넘긴다(JournalEntry.weightPct)
 */
export function weightOf(price: number | undefined, qty: number | undefined, base: number): number | null {
  if (!(price != null && price > 0 && qty != null && qty > 0 && base > 0)) return null;
  return Math.round(((price * qty) / base) * 1000) / 10;
}

/** 청산 사유 */
export const EXIT_REASONS = ["목표 도달", "손절", "시간 청산", "추적 손절", "재량", "기타"] as const;

/** 청산 사유 값: '기타'에 적은 말이 있으면 "기타: …"(60자) */
export function exitValue(reason: string, detail: string): string {
  if (!reason) return "";
  return reason === "기타" && detail.trim() ? `기타: ${detail.trim()}`.slice(0, 60) : reason;
}

/** 저장된 청산 사유를 고르기 값과 기타 설명으로 나눈다 */
export function parseExit(v: string | undefined): { reason: string; detail: string } {
  if (!v) return { reason: "", detail: "" };
  if ((EXIT_REASONS as readonly string[]).includes(v)) return { reason: v, detail: "" };
  const m = /^기타:\s*(.*)$/.exec(v);
  return { reason: "기타", detail: m ? m[1]! : v };
}

// ───────────────────────── 내보내기 ─────────────────────────

function csvEscape(v: string | number | undefined | null): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 규칙 체크 칸 값: 예·아니요, 표시하지 않았으면 빈칸(엑셀·구글 시트 내보내기와 같다) */
const yn = (v: boolean | undefined) => (v == null ? "" : v ? "예" : "아니요");

/**
 * 매매일지 CSV(엑셀에서 한글이 깨지지 않게 BOM을 붙이는 건 호출하는 쪽).
 * 규칙 체크 세 칸·계획한 분할 매수·어긴 규칙은 서버의 엑셀·구글 시트 '매매일지' 표와 같은 이름과 값으로 쓴다.
 */
export function journalCsv(entries: JournalEntry[], results: Map<string, SellResult>): string {
  const head = [
    "날짜", "종목코드", "종목명", "구분", "가격", "수량", "손절가", "목표가", "비중(%)", "전략", "청산 사유", "손익", "수익률(%)", "R 배수", "이유", "복기", "감정", "어긴 규칙",
    "손절가 미리 정함", "비중 상한 지킴", "계획에 없던 매수", "계획한 분할 매수", "손절 지연", "출처",
  ];
  const rows = entries.map((e) => {
    const r = results.get(e.id);
    const sc = e.selfCheck;
    return [
      e.date, e.code, e.name, e.side === "BUY" ? "매수" : "매도", e.price, e.qty, e.stop, e.target, e.weightPct, e.strategy, e.exitReason,
      r?.pnl != null ? Math.round(r.pnl * 100) / 100 : "", r?.pct != null ? r.pct.toFixed(2) : "", r?.r != null ? r.r.toFixed(2) : e.rMultiple,
      e.reason, e.review, e.emotion, (e.violations ?? []).join(" / "),
      yn(sc?.stopSet), yn(sc?.weightOk), yn(sc?.unplanned), e.plannedAdd ? "예" : "", r?.stopLate ? "예" : "", sourceOf(e),
    ];
  });
  return [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}
