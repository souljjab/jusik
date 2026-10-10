import type { Disclosure } from "./flows";
import type { Note } from "./types";

/*
 * 미국 종목의 공시(SEC EDGAR)·수급(기관·내부자·공매도) 신호 — 국내 flows.ts의 미국판.
 * 책(기초 자료집)의 공시·수급 규칙은 국내(DART·네이버) 기준이라, 미국 서식은 가장 가까운 국내 유형에 대응시켜 읽는다.
 *  - 공시: 3.6 설춘환(호재면 단기 매수, 악재면 단기 매도 대응), M2-15(호재성 공시 6종 → 이벤트 플래그)
 *  - 수급: 3.4 설춘환·강동진(기관 순매수), 3.3 박병창(린치: 임원 자사주 매수), 3.4 강영현·박병창(공매도 경계)
 * 책들 사이에서 수급 추종은 상충 지점(8장)이라 국내와 똑같이 가점(0~+2)으로만 쓰고 감점하지 않는다.
 * 미국 서식·항목 → 국내 유형 대응은 책에 없는 앱의 해석이다.
 */

export type SecFilingType =
  | "실적 발표"
  | "중요 계약"
  | "증자·공모"
  | "대량보유(행동주의)"
  | "대량보유(단순)"
  | "내부자 거래"
  | "정기보고서"
  | "제출 지연"
  | "상장폐지·요건 미달"
  | "파산"
  | "재무제표 신뢰성 문제"
  | "경영진 변동"
  | "인수·매각"
  | "주주총회"
  | "기타";

type Tone = "good" | "bad" | "info";

/** 8-K 항목 번호 → 유형·톤. 여러 항목이 함께 오면 악재 → 호재 → 참고 순으로 가장 앞선 것을 쓴다 */
const ITEM_RULES: Record<string, { type: SecFilingType; tone: Tone }> = {
  "1.01": { type: "중요 계약", tone: "good" }, // 중요 계약 체결 ≈ 국내 '단일판매·공급계약 체결'(3.6 호재성 공시)
  "1.02": { type: "중요 계약", tone: "bad" }, // 중요 계약 해지 ≈ 공급계약 해지
  "1.03": { type: "파산", tone: "bad" }, // 파산·법정관리
  "2.01": { type: "인수·매각", tone: "info" }, // 자산 인수·처분 완료(방향은 본문 확인)
  "2.02": { type: "실적 발표", tone: "info" }, // 실적 발표(좋고 나쁨은 숫자로 판단)
  "3.01": { type: "상장폐지·요건 미달", tone: "bad" }, // 상장폐지 통지·상장 유지 요건 미달
  "3.02": { type: "증자·공모", tone: "bad" }, // 미등록 지분증권 발행(희석) ≈ 국내 유상증자(제3자배정)
  "4.02": { type: "재무제표 신뢰성 문제", tone: "bad" }, // 과거 재무제표를 믿지 말라는 공시 ≈ 국내 감사의견 문제
  "5.02": { type: "경영진 변동", tone: "info" }, // 임원·이사 선임·사임
  "8.01": { type: "기타", tone: "info" }, // 기타 사건(내용이 제각각이라 분류하지 않는다)
};

const TONE_ORDER: Record<Tone, number> = { bad: 0, good: 1, info: 2 };

/** "2.02,9.01" · ["2.02", "9.01"] · "Item 2.02" → ["2.02", "9.01"] */
export function normalizeSecItems(items?: string | readonly string[] | null): string[] {
  if (!items) return [];
  const raw = Array.isArray(items) ? items.join(",") : String(items);
  const out: string[] = [];
  for (const m of raw.matchAll(/(\d{1,2})\.(\d{2})/g)) {
    const k = `${Number(m[1])}.${m[2]}`;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** 서식 이름 정리: 대문자, 공백 하나, 'SCHEDULE 13D' → 'SC 13D'(2024년 말부터 EDGAR가 쓰는 새 이름) */
const normForm = (form: string) => form.trim().toUpperCase().replace(/\s+/g, " ").replace(/^SCHEDULE 13/, "SC 13");

/**
 * SEC 서식(form)과 8-K 항목(items)으로 공시 유형·톤을 정한다. 제목만 보는 국내 분류(classifyDisclosure)처럼
 * 본문은 보지 않으므로 방향을 알 수 없으면 info. 모르는 서식은 { 기타, info }.
 */
export function classifySecFiling(form: string, items?: string | readonly string[] | null): { type: SecFilingType; tone: Tone } {
  const f = normForm(form ?? "");
  const amended = f.endsWith("/A");
  const base = amended ? f.slice(0, -2) : f;

  if (base === "8-K") {
    let best: { type: SecFilingType; tone: Tone } | undefined;
    for (const it of normalizeSecItems(items)) {
      const r = ITEM_RULES[it];
      if (!r) continue;
      // 같은 톤이면 앞 항목 우선, 단 '기타'(8.01)는 다른 유형이 있으면 밀린다
      if (!best || TONE_ORDER[r.tone] < TONE_ORDER[best.tone] || (best.type === "기타" && r.type !== "기타" && r.tone === best.tone)) best = r;
    }
    return best ?? { type: "기타", tone: "info" };
  }
  if (/^NT 10-[KQ]$/.test(base) || /^NT 20-F$/.test(base)) return { type: "제출 지연", tone: "bad" };
  if (/^(10-K|10-Q|10-KT|10-QT|20-F|40-F)$/.test(base)) return { type: "정기보고서", tone: "info" };
  if (base === "25" || base === "25-NSE") return { type: "상장폐지·요건 미달", tone: "bad" };
  // 13D(경영 참여 목적 5% 이상)·13G(단순 투자) 최초 제출은 국내 '대량보유' 호재(3.6)에 대응. 변경(/A)은 늘었는지 줄었는지 본문을 봐야 해 info
  if (base === "SC 13D") return { type: "대량보유(행동주의)", tone: amended ? "info" : "good" };
  if (base === "SC 13G") return { type: "대량보유(단순)", tone: amended ? "info" : "good" };
  // 증권 신고서·투자설명서: 주식이 늘 수 있어 국내 유상증자(희석, 3.6 악재)에 대응. 채권 발행일 수도 있다
  if (/^(S-1|S-3|S-3ASR|F-1|F-3|424B\d*)$/.test(base)) return { type: "증자·공모", tone: "bad" };
  if (/^(3|4|5|144)$/.test(base)) return { type: "내부자 거래", tone: "info" }; // 매수인지 매도인지는 서식만으로 모른다
  if (/^(DEF 14A|DEFA14A|DEFM14A|PRE 14A)$/.test(base)) return { type: "주주총회", tone: "info" };
  return { type: "기타", tone: "info" };
}

/** sec.ts가 만든 공시 제목("실적 발표 · 8-K (Item 2.02, 9.01) — …")에서 8-K 항목 번호를 되찾는다 */
export function secItemsOfTitle(title: string): string[] {
  const m = /\(Items?\s+([\d.,\s]+)\)/i.exec(title);
  return m ? normalizeSecItems(m[1]) : [];
}

/** 미국 공시 노트 기준(앱 기본값. 3.6은 '단기 대응'만 말하고 기간 수치는 없다 — 국내 DISCLOSURE_RECENT_DAYS와 같은 값) */
export const SEC_NOTE_PARAMS = {
  /** 최근 며칠 공시를 이벤트로 볼지 */
  recentDays: 10,
  /** 제목 표시 최대 글자 수 */
  titleMax: 48,
} as const;

/** 호재 유형(M2-15 호재성 공시 6종 중 미국에 대응하는 것: 공급계약 ≈ 중요 계약, 대량보유 ≈ 13D·13G) */
export const SEC_GOOD_TYPES: readonly SecFilingType[] = ["중요 계약", "대량보유(행동주의)", "대량보유(단순)"];

const MEANING: Record<string, string> = {
  "중요 계약|good": "중요 계약을 맺었어요. 매출로 이어지는 계약인지 본문을 확인해 주세요.",
  "중요 계약|bad": "중요 계약이 해지됐어요. 매출 영향을 확인해 주세요.",
  "대량보유(행동주의)|good": "5% 이상 지분을 경영 참여 목적으로 새로 보유했다는 신고예요.",
  "대량보유(행동주의)|info": "행동주의 대량보유 변경 신고예요. 늘었는지 줄었는지 본문을 확인해 주세요.",
  "대량보유(단순)|good": "단순 투자 목적으로 5% 이상 지분을 새로 보유했다는 신고예요.",
  "대량보유(단순)|info": "대량보유 변경 신고예요. 늘었는지 줄었는지 본문을 확인해 주세요.",
  "증자·공모|bad": "주식을 새로 발행하면 기존 주주 몫이 줄 수 있어요. 채권 발행인지 본문을 확인해 주세요.",
  "파산|bad": "파산·법정관리 공시예요. 새로 사지 않는 게 좋아요.",
  "상장폐지·요건 미달|bad": "상장폐지 또는 상장 유지 요건 미달 공시예요. 새로 사지 않는 게 좋아요.",
  "재무제표 신뢰성 문제|bad": "과거 재무제표를 믿을 수 없다는 공시예요. 실적 숫자를 그대로 쓰지 마세요.",
  "제출 지연|bad": "정기보고서를 기한 안에 못 냈어요. 회계·재무 문제일 수 있어요.",
  "실적 발표|info": "실적을 발표했어요. 매출·이익이 늘었는지 확인해 주세요.",
  "정기보고서|info": "정기보고서가 나왔어요. 실적 기준(3년 연속 증가 등)을 다시 확인해 주세요.",
  "내부자 거래|info": "임원·대주주 거래 신고예요. 매수인지 매도인지 확인해 주세요.",
  "경영진 변동|info": "임원·이사가 바뀌었어요.",
  "인수·매각|info": "자산 인수·매각을 마쳤어요. 사업에 주는 영향을 확인해 주세요.",
  "주주총회|info": "주주총회 안건이 나왔어요.",
};

const DAY_MS = 86_400_000;
const TYPE_LABELS = new Set<string>(["실적 발표", "중요 계약", "증자·공모", "대량보유(행동주의)", "대량보유(단순)", "내부자 거래", "정기보고서", "제출 지연", "상장폐지·요건 미달", "파산", "재무제표 신뢰성 문제", "경영진 변동", "인수·매각", "주주총회", "기타"] satisfies SecFilingType[]);
/** 노트 머리에 유형이 이미 있으므로 제목 앞의 '유형 · '은 뺀다 */
const withoutTypeLabel = (t: string) => {
  const i = t.indexOf(" · ");
  return i > 0 && TYPE_LABELS.has(t.slice(0, i)) ? t.slice(i + 3) : t;
};
const shortTitle = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * 최근 N일(오늘 포함, 달력 기준) SEC 공시를 유형별로 묶어 노트로 만든다(국내 disclosureNotes의 미국판).
 * 유형은 form과 제목 속 8-K 항목으로 다시 정한다. today 이후 날짜는 쓰지 않는다(과거 재현 시 미래 공시 참조 방지).
 * '기타'는 노트를 만들지 않는다. 호재 대응 유형은 M2-15, 나머지는 3.6을 근거로 달되 '미국 공시 대응'(앱 해석)임을 밝힌다.
 */
export function secDisclosureNotes(list: Disclosure[], today: string, days: number = SEC_NOTE_PARAMS.recentDays): Note[] {
  const end = Date.parse(today);
  if (!Number.isFinite(end)) return [];
  const start = end - days * DAY_MS;
  const recent = list
    .filter((d) => {
      const t = Date.parse(d.date);
      return Number.isFinite(t) && t >= start && t <= end;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const groups = new Map<string, { type: SecFilingType; tone: Tone; items: Disclosure[] }>();
  for (const d of recent) {
    if (!d.form) continue;
    const c = classifySecFiling(d.form, secItemsOfTitle(d.title));
    if (c.type === "기타") continue;
    const key = `${c.type}|${c.tone}`;
    const g = groups.get(key) ?? { ...c, items: [] };
    // 같은 날 같은 제목(같은 서류의 중복 제출)은 한 건으로 센다
    if (!g.items.some((x) => x.date === d.date && x.title === d.title)) g.items.push(d);
    groups.set(key, g);
  }

  const label: Record<Tone, string> = { good: "호재성 공시", bad: "악재성 공시", info: "확인할 공시" };
  return [...groups.values()]
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.items[0]!.date.localeCompare(a.items[0]!.date))
    .map((g) => {
      const top = g.items[0]!;
      const more = g.items.length > 1 ? ` 외 ${g.items.length - 1}건` : "";
      const meaning = MEANING[`${g.type}|${g.tone}`] ?? "본문을 확인해 주세요.";
      return {
        tone: g.tone,
        text: `${label[g.tone]}(${g.type}): ${shortTitle(withoutTypeLabel(top.title), SEC_NOTE_PARAMS.titleMax)} · ${top.date}${more}. ${meaning}`,
        rule: g.tone === "good" && SEC_GOOD_TYPES.includes(g.type) ? "M2-15 설춘환(미국 공시 대응)" : "3.6 설춘환(미국 공시 대응)",
      };
    });
}

// ───────────────────────── 수급(기관·내부자·공매도) ─────────────────────────

/** 미국 종목 지분·수급 요약(야후 quoteSummary 기준). 비율은 모두 %(0~100) */
export interface UsHolders {
  /** 내부자(임원·대주주) 보유율 % */
  insidersPct?: number;
  /** 기관 보유율 % */
  institutionsPct?: number;
  /** 보유 기관 수 */
  institutionsCount?: number;
  /** 최근 6개월 내부자 순매수(주식 수·건수) */
  insiderNet6m?: { buyShares: number; sellShares: number; netShares: number; buyCount: number; sellCount: number };
  /** 최근 내부자 거래(최신순) */
  recentInsider?: { name: string; text: string; shares: number; value?: number; date: string }[];
  /** 유동주식 대비 공매도 잔고 % */
  shortPctFloat?: number;
  /** 공매도 잔고 ÷ 일평균 거래량(일, days to cover) */
  shortRatio?: number;
  /** 공매도 잔고(주) */
  sharesShort?: number;
  /** 전월 공매도 잔고(주) */
  sharesShortPrior?: number;
  /** 상위 보유 기관(보유율 %, 직전 보고 대비 보유 주식 변화 %, 보고 기준일) */
  topInstitutions?: { name: string; pctHeld: number; pctChange?: number; date: string }[];
}

/**
 * 미국 수급 가점 기준. 책에 미국 수치가 없어 대부분 앱 기본값이다(백테스트로 조정할 대상).
 * 국내 FLOW_RULES처럼 가점만 주고 감점은 하지 않는다(8장 상충 지점: 강영현은 맹목적 수급 추종을 경계).
 */
export const US_FLOW_RULES = {
  /** 내부자 순매수로 볼 최소 매수 건수(앱 기본값. 3.3 박병창 '임원 자사주 매수'는 수치 없음) */
  insiderMinBuyCount: 1,
  /** 상위 기관 증감을 판단할 최소 기관 수(앱 기본값) */
  instMinCount: 3,
  /** 보유를 늘린 기관 비율이 이 이상이면 '대부분 늘림'(앱 기본값) */
  instIncreasingShare: 0.6,
  /** 공매도 잔고가 유동주식의 몇 % 이상이면 경고(앱 기본값. 3.4 강영현·박병창의 '하루 거래량의 10~20%'는 일별 공매도 비중이라 다른 척도) */
  shortFloatWarnPct: 20,
  /** 공매도 잔고가 전월보다 몇 % 이상 늘면 경고(앱 기본값) */
  shortChangeWarnPct: 20,
  /** 내부자 보유율이 이 이상이면 참고 노트(앱 기본값. 3.2 박용선(오닐) '경영진 지분이 많은 기업 선호'는 수치 없음) */
  insiderHighPct: 10,
  /** 가점 상한(국내 FLOW_RULES.maxScore와 같음) */
  maxScore: 2,
} as const;

const fmtInt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct1 = (n: number) => `${n.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;

/**
 * 미국 수급 가점(0 ~ +2). 야후가 주는 '현재 시점' 요약만 쓰므로 과거 날짜 재현에는 쓰지 않는다.
 *  +1 최근 6개월 내부자 순매수(린치식 '임원 자사주 매수', 3.3 박병창)
 *  +1 상위 보유 기관 대부분이 보유를 늘림(3.4 설춘환의 기관 순매수, 3.2 김연수 CAN SLIM '기관 매수')
 * 공매도 잔고가 유동주식의 20% 이상이거나 전월보다 20% 이상 늘면 경고만 남긴다(점수는 깎지 않음).
 */
export function usFlowSignals(h: UsHolders): { score: number; notes: Note[] } {
  const R = US_FLOW_RULES;
  const notes: Note[] = [];
  let score = 0;

  const ins = h.insiderNet6m;
  if (ins) {
    if (ins.netShares > 0 && ins.buyCount >= R.insiderMinBuyCount) {
      score += 1;
      notes.push({ tone: "good", text: `최근 6개월 내부자가 ${fmtInt(ins.netShares)}주 순매수했어요(매수 ${ins.buyCount}건, 매도 ${ins.sellCount}건). 임원 자사주 매수는 린치식 가점이에요.`, rule: "3.3 박병창(린치)" });
    } else if (ins.netShares < 0) {
      notes.push({ tone: "info", text: `최근 6개월 내부자가 ${fmtInt(-ins.netShares)}주 순매도했어요(매수 ${ins.buyCount}건, 매도 ${ins.sellCount}건). 보상 주식 매도가 흔해 점수는 깎지 않아요.`, rule: "3.3 박병창(린치)" });
    }
  }

  if (h.insidersPct != null && h.insidersPct >= R.insiderHighPct)
    notes.push({ tone: "info", text: `내부자 보유율이 ${pct1(h.insidersPct)}예요. 경영진 지분이 많은 편이에요.`, rule: "3.2 박용선(오닐)" });

  const inst = (h.topInstitutions ?? []).filter((x) => x.pctChange != null && Number.isFinite(x.pctChange) && x.pctChange !== 0);
  if (inst.length >= R.instMinCount) {
    const up = inst.filter((x) => x.pctChange! > 0).length;
    const down = inst.length - up;
    if (up / inst.length >= R.instIncreasingShare) {
      score += 1;
      notes.push({ tone: "good", text: `상위 보유 기관 ${inst.length}곳 중 ${up}곳이 보유를 늘렸어요.`, rule: "3.4 설춘환" });
    } else if (down / inst.length >= R.instIncreasingShare) {
      notes.push({ tone: "warn", text: `상위 보유 기관 ${inst.length}곳 중 ${down}곳이 보유를 줄였어요. 점수는 깎지 않지만 참고해 주세요.`, rule: "3.4 설춘환" });
    }
  }
  if (h.institutionsPct != null)
    notes.push({ tone: "info", text: `기관 보유율 ${pct1(h.institutionsPct)}${h.institutionsCount != null ? `(${fmtInt(h.institutionsCount)}곳)` : ""}예요.`, rule: "3.4 설춘환" });

  if (h.shortPctFloat != null && h.shortPctFloat >= R.shortFloatWarnPct)
    notes.push({
      tone: "warn",
      text: `공매도 잔고가 유동주식의 ${pct1(h.shortPctFloat)}예요${h.shortRatio != null ? `(다 갚는 데 약 ${h.shortRatio.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}일)` : ""}. 하락 중이라면 숏커버나 강한 매수 주체가 들어오기 전까지 사지 않아요.`,
      rule: "3.4 강영현·박병창",
    });
  if (h.sharesShort != null && h.sharesShortPrior != null && h.sharesShortPrior > 0) {
    const chg = (h.sharesShort / h.sharesShortPrior - 1) * 100;
    // 나눗셈 오차(120/100 → 19.999…%) 없이 비교
    if ((h.sharesShort - h.sharesShortPrior) * 100 >= R.shortChangeWarnPct * h.sharesShortPrior)
      notes.push({ tone: "warn", text: `공매도 잔고가 전월보다 ${pct1(chg)} 늘었어요(${fmtInt(h.sharesShortPrior)}주 → ${fmtInt(h.sharesShort)}주).`, rule: "3.4 강영현·박병창" });
  }

  notes.push({ tone: "info", text: "수급은 가점으로만 써요. 기관·내부자 매매를 그대로 따라가지는 마세요.", rule: "3.4 강영현" });
  return { score: Math.min(R.maxScore, score), notes };
}
