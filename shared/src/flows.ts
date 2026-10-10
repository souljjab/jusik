import type { Note } from "./types";

/*
 * 수급(외국인·기관)·공시·업종 신호 — 기초 자료집 3.4(수급), 3.5(업종과 주도주), 3.6(이벤트·공시), 규칙 M2-15.
 * 책들 사이에서 수급 추종은 상충 지점(8장)이라, 수급은 점수를 깎지 않는 가점(0~+2)으로만 쓴다.
 * 기준값은 책에 수치가 없어 앱이 정한 기본값이다(백테스트로 조정할 대상).
 */

/** 하루치 투자자별 매매(네이버 금융 '외국인·기관 순매매' 표 기준). 순매매는 주식 수, +면 순매수 */
export interface InvestorFlow {
  /** YYYY-MM-DD */
  date: string;
  close: number;
  volume: number;
  institutionNet: number;
  foreignNet: number;
  /** 외국인 보유율 % */
  foreignHoldPct?: number;
}

export interface Disclosure {
  /** YYYY-MM-DD */
  date: string;
  title: string;
}

export interface SectorRow {
  /** 네이버 업종 번호(sise_group_detail의 no=) */
  no: string;
  name: string;
  changePct: number;
}

export type DisclosureType =
  | "공급계약"
  | "대량보유"
  | "자사주"
  | "무상증자"
  | "배당"
  | "손익구조변동"
  | "유상증자"
  | "전환사채"
  | "감자"
  | "관리·불성실"
  | "기타";

type DisclosureTone = "good" | "bad" | "info";

// ───────────────────────── 공시 ─────────────────────────

/** 호재성 공시 6종(3.6 표, 설춘환). 손익구조변동은 제목만으로 방향을 알 수 없어 info로 둔다 */
export const GOOD_DISCLOSURE_TYPES: readonly DisclosureType[] = ["공급계약", "대량보유", "자사주", "무상증자", "배당", "손익구조변동"];

/** 최근 며칠 공시를 이벤트로 볼지(앱 기본값. 3.6은 '단기 대응'만 말하고 기간 수치는 없다) */
export const DISCLOSURE_RECENT_DAYS = 10;

/** 철회·취소·해지·해제 같은 '되돌림' 표현 */
const UNDO = /철회|취소|해지|해제|해소|미해당|제외/;

/*
 * 순서가 중요하다: 악재를 먼저 본다. '유무상증자'는 '무상증자'도 포함하므로 유상증자(희석)로 분류한다.
 * undo는 되돌림 표현이 있을 때 바뀌는 톤(예: 공급계약 해지 → 악재, 관리종목 해제 → 참고).
 */
const DISCLOSURE_RULES: { type: DisclosureType; re: RegExp; tone: DisclosureTone; undo: DisclosureTone; undoRe?: RegExp }[] = [
  { type: "관리·불성실", re: /관리종목|불성실공시|상장폐지|상장적격성|투자주의환기|매매거래정지|횡령|배임|의견거절|부적정의견|회생절차|부도발생/, tone: "bad", undo: "info" },
  { type: "유상증자", re: /유상증자|유무상증자/, tone: "bad", undo: "info" },
  { type: "전환사채", re: /전환사채|신주인수권부사채|교환사채|전환청구권|신주인수권행사|전환가액/, tone: "bad", undo: "info", undoRe: /철회|취소|만기전사채취득/ },
  { type: "감자", re: /감자/, tone: "bad", undo: "info" },
  { type: "공급계약", re: /공급계약|판매계약/, tone: "good", undo: "bad" },
  { type: "대량보유", re: /대량보유/, tone: "good", undo: "info" },
  // 자기주식 '처분'은 유통 주식이 늘어 호재가 아니므로 취득·소각만 본다
  { type: "자사주", re: /자기주식취득|자사주취득|주식소각|이익소각/, tone: "good", undo: "info" },
  { type: "무상증자", re: /무상증자/, tone: "good", undo: "bad" },
  { type: "배당", re: /배당/, tone: "good", undo: "bad", undoRe: /철회|취소/ },
  { type: "손익구조변동", re: /손익구조/, tone: "info", undo: "info" },
];

/** 비교 전에 공백과 가운뎃점(ㆍ·・ 등)을 지운다. DART 제목은 '단일판매ㆍ공급계약체결'처럼 붙여 쓴다 */
const squash = (s: string) => s.replace(/[\s·ㆍ・‧∙•]/g, "");

/** 공시 제목 키워드로 유형과 톤을 정한다(3.6 설춘환). 본문은 보지 않으므로 방향이 애매하면 info. */
export function classifyDisclosure(title: string): { type: DisclosureType; tone: DisclosureTone } {
  const t = squash(title);
  for (const r of DISCLOSURE_RULES) {
    if (!r.re.test(t)) continue;
    return { type: r.type, tone: (r.undoRe ?? UNDO).test(t) ? r.undo : r.tone };
  }
  return { type: "기타", tone: "info" };
}

const MEANING: Record<string, string> = {
  "공급계약|good": "수주로 매출이 늘 수 있어요.",
  "공급계약|bad": "계약이 해지·철회됐어요. 매출 영향을 확인해 주세요.",
  "대량보유|good": "기관이 지분을 샀을 수 있어요. 늘었는지 줄었는지는 본문을 확인해 주세요.",
  "자사주|good": "주주 환원과 유통 주식 감소 효과가 있어요.",
  "무상증자|good": "유통 물량과 관심이 늘 수 있어요.",
  "배당|good": "배당 수익과 주주 환원을 기대할 수 있어요.",
  "손익구조변동|info": "실적이 크게 바뀌었어요. 이익이 늘었는지 본문을 확인해 주세요.",
  "유상증자|bad": "주식 수가 늘어 기존 주주 몫이 줄 수 있어요.",
  "전환사채|bad": "나중에 주식으로 바뀌면 물량 부담이 생길 수 있어요.",
  "감자|bad": "자본금을 줄이는 결정이에요. 재무 상태를 확인해 주세요.",
  "관리·불성실|bad": "거래 위험이 큰 공시예요. 새로 사지 않는 게 좋아요.",
};

const DAY_MS = 86_400_000;
const shortTitle = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * 최근 N일(오늘 포함, 달력 기준) 공시를 유형별로 묶어 이벤트 노트로 만든다.
 * today 이후 날짜는 쓰지 않는다(과거 재현 시 미래 공시 참조 방지). '기타'는 노트를 만들지 않는다.
 * 호재성 6종은 M2-15, 악재(6종의 해지·철회 포함)는 같은 절(3.6)의 '악재면 단기 매도 대응'을 근거로 단다.
 */
export function disclosureNotes(list: Disclosure[], today: string, days = DISCLOSURE_RECENT_DAYS): Note[] {
  const end = Date.parse(today);
  if (!Number.isFinite(end)) return [];
  const start = end - days * DAY_MS;
  const recent = list
    .filter((d) => {
      const t = Date.parse(d.date);
      return Number.isFinite(t) && t >= start && t <= end;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const groups = new Map<string, { type: DisclosureType; tone: DisclosureTone; items: Disclosure[] }>();
  for (const d of recent) {
    const c = classifyDisclosure(d.title);
    if (c.type === "기타") continue;
    const key = `${c.type}|${c.tone}`;
    const g = groups.get(key) ?? { ...c, items: [] };
    // 정정 공시 등으로 같은 날 같은 제목이 겹치면 한 건으로 센다
    if (!g.items.some((x) => x.date === d.date && squash(x.title) === squash(d.title))) g.items.push(d);
    groups.set(key, g);
  }

  const order: Record<DisclosureTone, number> = { bad: 0, good: 1, info: 2 };
  const label: Record<DisclosureTone, string> = { good: "호재성 공시", bad: "악재성 공시", info: "확인할 공시" };
  return [...groups.values()]
    .sort((a, b) => order[a.tone] - order[b.tone] || b.items[0]!.date.localeCompare(a.items[0]!.date))
    .map((g) => {
      const top = g.items[0]!;
      const more = g.items.length > 1 ? ` 외 ${g.items.length - 1}건` : "";
      const meaning = MEANING[`${g.type}|${g.tone}`] ?? "본문을 확인해 주세요.";
      return {
        tone: g.tone,
        text: `${label[g.tone]}(${g.type}): ${shortTitle(top.title)} · ${top.date}${more}. ${meaning}`,
        rule: g.tone !== "bad" && GOOD_DISCLOSURE_TYPES.includes(g.type) ? "M2-15 설춘환" : "3.6 설춘환",
      };
    });
}

// ───────────────────────── 수급 ─────────────────────────

/**
 * 수급 가점 기준. 3.4(설춘환·강동진·강창권)는 외국인·기관 순매수를 보라고만 하고 수치는 없어서 앱 기본값이다.
 * 강영현은 맹목적 수급 추종을 경계하므로(8장 상충 지점) 가점만 주고 감점은 하지 않는다.
 */
export const FLOW_RULES = {
  /** 단기 합계 일수 */
  shortDays: 5,
  /** 중기 합계 일수 */
  longDays: 20,
  /** 외국인·기관 동반 순매수 연속 일수 기준 */
  streakMin: 3,
  /** 20일 (외국인+기관) 순매수 합 ÷ 20일 거래량 기준(5%) */
  netVolRatioMin: 0.05,
  /** 외국인 보유율 변화를 알릴 최소 폭(%p) */
  holdPctChangeMin: 0.5,
  /** 가점 상한 */
  maxScore: 2,
} as const;

const shares = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("ko-KR")}주`;
const pct1 = (n: number) => `${n.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;

/**
 * 외국인·기관 수급 가점(0 ~ +2). flows는 날짜 오름차순.
 * at을 주면 flows[0..at]만 쓴다(과거 재현용, 미래 참조 없음). 기본은 마지막 날.
 *  +1   최근 5일 외국인·기관 모두 순매수(한쪽만이면 +0.5)
 *  +0.5 외국인·기관 동반 순매수 3일 이상 연속
 *  +0.5 20일 순매수 합이 20일 거래량의 5% 이상
 * 순매도는 감점하지 않고 경고 노트만 남긴다.
 */
export function flowSignals(flows: InvestorFlow[], at = flows.length - 1): { score: number; notes: Note[] } {
  const R = FLOW_RULES;
  const end = Math.min(at, flows.length - 1);
  if (end < 0) return { score: 0, notes: [] };
  const win = (n: number) => flows.slice(Math.max(0, end - n + 1), end + 1);
  const sum = (xs: InvestorFlow[], f: (x: InvestorFlow) => number) => xs.reduce((s, x) => s + f(x), 0);
  const RULE = "3.4 설춘환·강동진";
  const notes: Note[] = [];
  let score = 0;

  const short = win(R.shortDays);
  const f5 = sum(short, (x) => x.foreignNet), i5 = sum(short, (x) => x.institutionNet);
  const days = short.length;
  if (f5 > 0 && i5 > 0) {
    score += 1;
    notes.push({ tone: "good", text: `최근 ${days}일 외국인 ${shares(f5)}, 기관 ${shares(i5)} 동반 순매수예요.`, rule: RULE });
  } else if (f5 > 0 || i5 > 0) {
    score += 0.5;
    const who = f5 > 0 ? `외국인만 순매수(${shares(f5)})` : `기관만 순매수(${shares(i5)})`;
    notes.push({ tone: "info", text: `최근 ${days}일 ${who}예요.`, rule: RULE });
  } else if (f5 < 0 && i5 < 0) {
    notes.push({ tone: "warn", text: `최근 ${days}일 외국인 ${shares(f5)}, 기관 ${shares(i5)} 동반 순매도예요. 점수는 깎지 않지만 참고해 주세요.`, rule: RULE });
  }

  let streak = 0;
  for (let k = end; k >= 0 && flows[k]!.foreignNet > 0 && flows[k]!.institutionNet > 0; k--) streak++;
  if (streak >= R.streakMin) {
    score += 0.5;
    notes.push({ tone: "good", text: `외국인·기관이 ${streak}일 연속 함께 순매수했어요.`, rule: RULE });
  }

  const long = win(R.longDays);
  const net = sum(long, (x) => x.foreignNet + x.institutionNet);
  const vol = sum(long, (x) => x.volume);
  if (vol > 0) {
    const ratio = net / vol;
    if (ratio >= R.netVolRatioMin) {
      score += 0.5;
      notes.push({ tone: "good", text: `${long.length}일 외국인·기관 순매수 합이 거래량의 ${pct1(ratio * 100)}예요.`, rule: RULE });
    } else if (ratio <= -R.netVolRatioMin) {
      notes.push({ tone: "warn", text: `${long.length}일 외국인·기관 순매도 합이 거래량의 ${pct1(-ratio * 100)}예요.`, rule: RULE });
    }
  }

  // 외국인 보유율 변화(지분 흐름 참고, 점수 없음)
  const held = long.filter((x) => x.foreignHoldPct != null);
  if (held.length >= 2) {
    const a = held[0]!.foreignHoldPct!, b = held.at(-1)!.foreignHoldPct!;
    if (Math.abs(b - a) >= R.holdPctChangeMin)
      notes.push({ tone: "info", text: `외국인 보유율이 ${pct1(a)}에서 ${pct1(b)}로 ${b > a ? "늘었어요" : "줄었어요"}.`, rule: "3.4 설춘환" });
  }

  notes.push({ tone: "info", text: "수급은 가점으로만 써요. 외국인·기관 매매를 그대로 따라가지는 마세요.", rule: "3.4 강영현" });
  return { score: Math.min(R.maxScore, score), notes };
}

// ───────────────────────── 업종 ─────────────────────────

/** 업종 순위 기준(3.5 와인스타인·박병창의 '주도 업종'을 등락률 상위로 근사한 앱 기본값) */
export const SECTOR_RULES = {
  /** 상위 몇 %면 주도 업종 후보 */
  leaderTopPct: 0.2,
  /** 하위 몇 %면 소외 업종 경고 */
  laggardBottomPct: 0.2,
  /** 업종 수가 이보다 적으면 순위만 알린다 */
  minTotal: 5,
} as const;

/**
 * 업종 등락률 순위(동률은 같은 순위). 하루 등락률이라 업종 단계(30주선) 판정과는 다르다는 점을 노트에 남긴다.
 * 상위 20% → 주도 업종 후보(good), 하위 20% → 소외 업종(warn).
 */
export function sectorStrength(rows: SectorRow[], sectorNo: string | null): { rank: number | null; total: number; notes: Note[] } {
  const R = SECTOR_RULES;
  const valid = rows.filter((r) => Number.isFinite(r.changePct));
  const total = valid.length;
  const me = sectorNo == null ? undefined : valid.find((r) => r.no === sectorNo);
  if (!me) return { rank: null, total, notes: [] };
  const rank = 1 + valid.filter((r) => r.changePct > me.changePct).length;
  const head = `업종 ${me.name}: 오늘 등락률 ${me.changePct > 0 ? "+" : ""}${pct1(me.changePct)}, ${rank}위/${total}개`;
  const notes: Note[] = [];
  if (total >= R.minTotal && rank <= Math.max(1, Math.ceil(total * R.leaderTopPct))) {
    notes.push({ tone: "good", text: `${head}로 주도 업종 후보예요. 업종 차트(30주선)도 함께 확인해 주세요.`, rule: "3.5 와인스타인·박병창" });
  } else if (total >= R.minTotal && rank > total - Math.max(1, Math.ceil(total * R.laggardBottomPct))) {
    notes.push({ tone: "warn", text: `${head}로 하위권이에요. 소외 업종은 싸 보여도 수익이 약할 수 있어요.`, rule: "3.5 박병창" });
  } else {
    notes.push({ tone: "info", text: `${head}예요.`, rule: "3.5 와인스타인" });
  }
  return { rank, total, notes };
}
