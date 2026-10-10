import { MIN_RELIABLE } from "./dayEval";
import type { DayTradeCandidate } from "./daytrade";
import type { JournalEntry } from "./journal";
import { REGIME_LABEL, type Regime } from "./regime";
import { regionOf, regionOfCode, type Candle, type Market, type Note, type Region } from "./types";

/** 근거 규칙(기초 자료집 부록 A) */
export const REVIEW_RULE = "M5-01 김연수";
export const PAPER_TRACKING_RULE = "M5-02 캔들마스터";

/** 시장 순위표 한 줄. 서버의 UniverseRow와 같은 모양이라 그대로 넘기면 된다 */
export interface MarketRowLike {
  code: string;
  name: string;
  market: Market;
  price: number;
  changePct: number;
  volume: number;
  tradeValue: number;
}

export interface DailyReviewInput {
  /** 복기할 날짜(그 시장 현지 날짜, YYYY-MM-DD). 이 날짜 뒤의 데이터는 쓰지 않는다 */
  date: string;
  region: Region;
  /** 해당 지역 지수 일봉(오래된 순) */
  indices: { name: string; candles: Candle[] }[];
  /** 그날 시장 순위표(거래량·상승률 상위). 다른 지역 종목은 걸러낸다 */
  universe: MarketRowLike[];
  /** 그날 단타 후보. 해당 지역이고 asOf가 date인 것만 쓴다 */
  candidates: DayTradeCandidate[];
  journal: JournalEntry[];
  /** 운용 태도(예: 공격·중립·방어). 코멘트에 그대로 넣는다 */
  posture?: string | null;
  /** 시장 국면. BULL/NEUTRAL/BEAR면 한국어(강세·중립·약세)로 바꿔 쓴다 */
  regime?: string | null;
  /** 52주 신고가 판정용 종목 일봉(코드 → 오래된 순). newHighLookback개 이상 있어야 판정한다 */
  candlesByCode?: Record<string, Candle[]>;
}

export interface IndexMove {
  name: string;
  close: number;
  /** 직전 봉 대비 등락률(%) */
  changePct: number;
  /** INDEX_TREND_DAYS(20)거래일 전 종가 대비(%). 봉이 모자라면 null */
  vs20dPct: number | null;
  /** 실제로 쓴 마지막 봉 날짜. date와 다르면 그날 지수 봉이 아직 없다는 뜻 */
  asOf: string;
}

export interface NewHigh {
  code: string;
  name: string;
  /** 판정 근거(예: "52주 신고가", 후보 근거 문구 "직전 20일 고점 돌파") */
  basis: string;
}

export interface PaperDaySummary {
  buys: number;
  sells: number;
  /** 수수료·세금·슬리피지 반영 순손익 합(현지 통화) */
  realizedPnl: number;
  wins: number;
  losses: number;
}

export interface DailyReview {
  date: string;
  region: Region;
  indexMoves: IndexMove[];
  topGainers: MarketRowLike[];
  topLosers: MarketRowLike[];
  mostTraded: MarketRowLike[];
  newHighs: NewHigh[];
  candidatesTop: { code: string; name: string; score: number }[];
  paper: PaperDaySummary;
  /** 데이터가 없어 채우지 못한 복기 항목. 사용자가 직접 확인할 부분 */
  missing: string[];
  /** 자동 요약 문장 */
  comment: string;
  /** 사용자가 덧붙이는 메모 */
  userComment?: string;
  rule: string;
}

export interface DailyReviewParams {
  /** 특징주·후보를 몇 개씩 보여줄지(앱 기본값) */
  topN: number;
  /** 52주 신고가 판정 기간(거래일, 오늘 포함). 1년 ≈ 250거래일 */
  newHighLookback: number;
}

export const DEFAULT_DAILY_REVIEW: DailyReviewParams = { topN: 5, newHighLookback: 250 };
/** 지수 추세 비교 기간(거래일). 사양의 '20일 전 대비' */
export const INDEX_TREND_DAYS = 20;

/** 앱이 수집하지 못하는 복기 항목(김연수 6항목 중 섹터·실적, 그리고 움직임의 이유) */
export const REVIEW_MISSING = { sector: "섹터", earnings: "실적", reasons: "뉴스·공시(움직임의 이유)" } as const;

const AUTO = "자동(모의)";
/** 후보 근거 중 신고가·고점 돌파를 뜻하는 문구. 캔들 무효 조건("고점 돌파 시 무효")은 제외 */
const NEW_HIGH_NOTE = /신고가|고점 돌파/;

const upTo = (cs: Candle[], date: string) => cs.filter((c) => c.date <= date);
const chg = (a: number, b: number) => (a / b - 1) * 100;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 모의매매 매도 기록 복기란의 "순손익 X (" 숫자를 읽는다(paper.ts paperCheckExits 형식).
 * 형식이 다르면 null.
 */
export function parseNetPnl(review: string | undefined): number | null {
  const m = /순손익\s*([+-]?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?)\s*\(/i.exec(review ?? "");
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 매도 기록 복기란의 "(+1.23%)" 순수익률. 없으면 null */
const parseNetPct = (review: string | undefined): number | null => {
  const m = /\(([+-]?\d+(?:\.\d+)?)%\)/.exec(review ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * 김연수의 일일 복기 6항목(지수 흐름·섹터 흐름·신고가·특징주·실적·코멘트)을 앱이 가진 데이터로 자동 작성한다.
 * 섹터·실적·뉴스는 데이터가 없어 missing에 남긴다. date 이후의 봉·기록은 쓰지 않으므로 과거 날짜로 다시 만들어도 같다.
 */
export function buildDailyReview(input: DailyReviewInput, params: Partial<DailyReviewParams> = {}): DailyReview {
  const P = { ...DEFAULT_DAILY_REVIEW, ...params };
  const { date, region } = input;
  const missing: string[] = [];

  // 1) 지수 흐름: 마지막 봉 등락률 + N거래일 전 대비
  const indexMoves: IndexMove[] = [];
  for (const ix of input.indices) {
    const cs = upTo(ix.candles, date);
    const i = cs.length - 1;
    const last = cs[i], prev = cs[i - 1];
    if (!last || !prev || !(prev.close > 0)) {
      missing.push(`지수(${ix.name})`);
      continue;
    }
    const base = i >= INDEX_TREND_DAYS ? cs[i - INDEX_TREND_DAYS]! : null;
    indexMoves.push({ name: ix.name, close: last.close, changePct: chg(last.close, prev.close), vs20dPct: base && base.close > 0 ? chg(last.close, base.close) : null, asOf: last.date });
  }
  if (!input.indices.length) missing.push("지수");

  // 2) 섹터 흐름: 업종 데이터가 없다
  missing.push(REVIEW_MISSING.sector);

  // 같은 종목이 여러 순위표에 겹쳐 올 수 있어 첫 줄만 쓴다
  const rows: MarketRowLike[] = [];
  const seen = new Set<string>();
  for (const r of input.universe) {
    if (regionOf(r.market) !== region || seen.has(r.code) || !(r.price > 0) || !Number.isFinite(r.changePct)) continue;
    seen.add(r.code);
    rows.push(r);
  }
  const cands = input.candidates.filter((c) => regionOf(c.market) === region && c.asOf === date);

  // 3) 신고가: 후보 근거 문구 + (일봉이 있으면) 52주 최고가 경신
  const names = new Map<string, string>([...rows.map((r) => [r.code, r.name] as const), ...cands.map((c) => [c.code, c.name] as const)]);
  const highs = new Map<string, NewHigh>();
  for (const c of cands) {
    const n = c.notes.find((x) => (x.tone === "good" || x.tone === "info") && NEW_HIGH_NOTE.test(x.text) && !x.text.includes("무효"));
    if (n) highs.set(c.code, { code: c.code, name: c.name, basis: n.text });
  }
  let judged = 0;
  for (const [code, all] of Object.entries(input.candlesByCode ?? {})) {
    if (regionOfCode(code) !== region) continue;
    const cs = upTo(all, date);
    const last = cs[cs.length - 1];
    if (!last || last.date !== date || cs.length < P.newHighLookback) continue;
    judged++;
    const prior = Math.max(...cs.slice(-P.newHighLookback, -1).map((c) => c.high));
    if (last.high > prior) highs.set(code, { code, name: names.get(code) ?? code, basis: "52주 신고가" });
  }
  if (!judged) missing.push("52주 신고가");
  const newHighs = [...highs.values()];

  // 4) 특징주: 상승·하락 상위, 거래대금 상위
  const topGainers = rows.filter((r) => r.changePct > 0).sort((a, b) => b.changePct - a.changePct || b.tradeValue - a.tradeValue).slice(0, P.topN);
  const topLosers = rows.filter((r) => r.changePct < 0).sort((a, b) => a.changePct - b.changePct || b.tradeValue - a.tradeValue).slice(0, P.topN);
  const mostTraded = rows.filter((r) => r.tradeValue > 0).sort((a, b) => b.tradeValue - a.tradeValue).slice(0, P.topN);
  if (!rows.length) missing.push("특징주");

  // 5) 실적: 실적 데이터가 없다. 지수·특징주가 움직인 이유(뉴스)도 없다
  missing.push(REVIEW_MISSING.earnings, REVIEW_MISSING.reasons);

  const candidatesTop = [...cands].sort((a, b) => b.score - a.score).slice(0, P.topN).map((c) => ({ code: c.code, name: c.name, score: c.score }));

  // 모의매매: 그날·그 지역의 자동(모의) 기록
  const paper: PaperDaySummary = { buys: 0, sells: 0, realizedPnl: 0, wins: 0, losses: 0 };
  let unparsed = 0;
  for (const e of input.journal) {
    if (e.date !== date || e.source !== AUTO || regionOfCode(e.code) !== region) continue;
    if (e.side === "BUY") {
      paper.buys++;
      continue;
    }
    paper.sells++;
    const pnl = parseNetPnl(e.review);
    if (pnl == null) {
      unparsed++;
      continue;
    }
    paper.realizedPnl += pnl;
    if (pnl > 0) paper.wins++;
    else paper.losses++;
  }
  paper.realizedPnl = r2(paper.realizedPnl);
  if (unparsed) missing.push(`모의 매도 손익 ${unparsed}건`);

  const review: DailyReview = { date, region, indexMoves, topGainers, topLosers, mostTraded, newHighs, candidatesTop, paper, missing, comment: "", rule: REVIEW_RULE };
  // 6) 코멘트: 앞 항목을 종합한 자동 요약
  review.comment = reviewComment(review, cands.length, input.regime ?? null, input.posture ?? null);
  return review;
}

const signPct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
const withCommas = (x: number, d: number) => Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
/** 지역 통화로 부호 붙인 금액(반올림한 값으로 부호를 정해 "-0원"을 막는다) */
const fmtMoney = (x: number, region: Region) => {
  const v = Number(x.toFixed(region === "KR" ? 0 : 2));
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${withCommas(v, region === "KR" ? 0 : 2)}${region === "KR" ? "원" : "달러"}`;
};
const fmtTradeValue = (x: number, region: Region) => (region === "KR" ? `${withCommas(x / 1e8, 0)}억 원` : `${withCommas(x / 1e6, 1)}백만 달러`);

/** 마지막 글자 받침 유무로 "이에요/예요"를 고른다(숫자는 읽는 소리 기준) */
function eyo(word: string): string {
  const ch = [...word.replace(/[^가-힣0-9A-Za-z%]+$/, "")].pop() ?? "";
  const code = ch.charCodeAt(0);
  let batchim = false;
  if (code >= 0xac00 && code <= 0xd7a3) batchim = (code - 0xac00) % 28 !== 0;
  else if (/[0-9]/.test(ch)) batchim = "013678".includes(ch); // 영·일·삼·육·칠·팔
  else if (/[LMNlmn]/.test(ch)) batchim = true; // 엘·엠·엔
  return `${word}${batchim ? "이에요" : "예요"}`;
}

function reviewComment(r: DailyReview, candCount: number, regime: string | null, posture: string | null): string {
  const out: string[] = [];
  const moves = r.indexMoves;
  if (moves.length) {
    const list = moves.map((m) => `${m.name} ${signPct(m.changePct)}${m.asOf !== r.date ? `(${m.asOf} 기준)` : ""}`).join(", ");
    const ups = moves.filter((m) => m.changePct > 0).length, downs = moves.filter((m) => m.changePct < 0).length;
    const all = moves.length > 1 ? "모두 " : "";
    const verb = ups === moves.length ? `${all}올랐어요` : downs === moves.length ? `${all}내렸어요` : ups || downs ? "엇갈렸어요" : "보합이에요";
    out.push(`지수는 ${list}로 ${verb}.`);
    const trend = moves.filter((m) => m.vs20dPct != null).map((m) => `${m.name} ${signPct(m.vs20dPct!)}`);
    if (trend.length) out.push(`${INDEX_TREND_DAYS}거래일 전과 비교하면 ${trend.join(", ")}예요.`);
  } else out.push("지수 데이터가 없어요.");

  if (regime) out.push(`시장 국면은 ${eyo(REGIME_LABEL[regime as Regime] ?? regime)}.`);
  if (posture) out.push(`운용 태도는 ${eyo(posture)}.`);

  const best = r.candidatesTop[0];
  out.push(candCount ? `단타 후보는 ${candCount}개이고 최고는 ${best!.name} ${best!.score}점이에요.` : "단타 후보는 없어요.");
  if (r.newHighs.length) out.push(`신고가·고점 돌파 종목은 ${r.newHighs.length}개예요.`);
  const g = r.topGainers[0];
  if (g) out.push(`상승 1위는 ${g.name}(${signPct(g.changePct)})예요.`);

  const p = r.paper;
  if (p.buys + p.sells === 0) out.push("모의매매 기록은 없어요.");
  else out.push(`모의매매는 매수 ${p.buys}건, 매도 ${p.sells}건이고 순손익은 ${eyo(fmtMoney(p.realizedPnl, r.region))}(${p.wins}승 ${p.losses}패).`);

  // 섹터·실적은 늘 빠지는 항목이라 직접 확인하라고 덧붙인다
  if (r.missing.includes(REVIEW_MISSING.sector) && r.missing.includes(REVIEW_MISSING.earnings)) out.push("섹터·실적은 데이터가 없어 직접 확인해야 해요.");
  return out.join(" ");
}

/** 엑셀/구글 시트용 표 머리글 */
export const REVIEW_HEADERS = ["항목", "내용"];

/** 복기 결과를 (항목, 내용) 두 칸짜리 행으로 바꾼다. 목록 항목은 한 줄에 하나씩 */
export function reviewToRows(r: DailyReview): (string | number)[][] {
  const rows: (string | number)[][] = [
    ["날짜", r.date],
    ["지역", r.region === "KR" ? "국내" : "미국"],
  ];
  const list = <T>(label: string, xs: T[], f: (x: T) => string) => {
    if (!xs.length) rows.push([label, "없음"]);
    else for (const x of xs) rows.push([label, f(x)]);
  };
  const cl = (x: number) => withCommas(x, 2);
  list("지수 흐름", r.indexMoves, (m) => `${m.name} ${cl(m.close)} (${signPct(m.changePct)}, ${INDEX_TREND_DAYS}거래일 전 대비 ${m.vs20dPct == null ? "-" : signPct(m.vs20dPct)})${m.asOf !== r.date ? ` · ${m.asOf} 기준` : ""}`);
  rows.push(["섹터 흐름", r.missing.includes(REVIEW_MISSING.sector) ? "데이터 없음(직접 확인)" : "-"]);
  list("신고가", r.newHighs, (h) => `${h.name}(${h.code}) — ${h.basis}`);
  list("특징주(상승)", r.topGainers, (x) => `${x.name}(${x.code}) ${signPct(x.changePct)}`);
  list("특징주(하락)", r.topLosers, (x) => `${x.name}(${x.code}) ${signPct(x.changePct)}`);
  list("특징주(거래대금)", r.mostTraded, (x) => `${x.name}(${x.code}) ${fmtTradeValue(x.tradeValue, r.region)} (${signPct(x.changePct)})`);
  rows.push(["실적", r.missing.includes(REVIEW_MISSING.earnings) ? "데이터 없음(직접 확인)" : "-"]);
  list("단타 후보", r.candidatesTop, (c) => `${c.name}(${c.code}) ${c.score}점`);
  const p = r.paper;
  rows.push(["모의매매", `매수 ${p.buys}건 · 매도 ${p.sells}건 · 순손익 ${fmtMoney(p.realizedPnl, r.region)} · ${p.wins}승 ${p.losses}패`]);
  rows.push(["빠진 항목", r.missing.length ? r.missing.join(", ") : "없음"]);
  rows.push(["코멘트", r.comment]);
  if (r.userComment) rows.push(["메모", r.userComment]);
  rows.push(["근거", r.rule]);
  return rows;
}

export interface PaperTrackingParams {
  /** 실전 전 최소 모의투자 기간(일). 캔들마스터: 최소 3개월 */
  minDays: number;
  /** 판단에 필요한 최소 청산 거래 수. 통계적으로 볼 만한 표본(dayEval MIN_RELIABLE) */
  minClosedTrades: number;
}

export const DEFAULT_PAPER_TRACKING: PaperTrackingParams = { minDays: 90, minClosedTrades: MIN_RELIABLE };

export interface PaperTrackingStatus {
  /** 첫 자동(모의) 기록일 */
  startedAt: string | null;
  /** 시작일을 1일째로 센 경과 일수(달력 기준) */
  days: number;
  closedTrades: number;
  /** 청산 거래당 평균 순수익률(%). 계산할 거래가 없으면 null */
  expectancyPct: number | null;
  ready: boolean;
  message: string;
  note: Note;
}

/**
 * 모의투자 기간 추적(캔들마스터: 모의투자 최소 3개월, 실전 6개월 무수익이면 소액으로 6개월 연장).
 * 책은 모의투자에서 수익이 없어도 근거 있는 진입·청산이면 충분하다고 보지만, 앱의 자동 모의매매는 늘 규칙대로
 * 진입·청산하므로 '근거'는 이미 충족된다. 그래서 대신 표본 수와 기대값(+)으로 실전 검토 여부를 판단한다.
 * today 이후 기록은 쓰지 않는다.
 */
export function paperTrackingStatus(journal: JournalEntry[], today: string, opt: Partial<PaperTrackingParams> & { region?: Region } = {}): PaperTrackingStatus {
  const P = { ...DEFAULT_PAPER_TRACKING, ...opt };
  const auto = journal
    .filter((e) => e.source === AUTO && e.date <= today && (!opt.region || regionOfCode(e.code) === opt.region))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1));
  const done = (tone: Note["tone"], message: string, rest: Omit<PaperTrackingStatus, "message" | "note" | "ready">, ready = false): PaperTrackingStatus => ({
    ...rest, ready, message, note: { tone, text: message, rule: PAPER_TRACKING_RULE },
  });
  const months = Math.round(P.minDays / 30);
  if (!auto.length)
    return done("info", `아직 모의투자 기록이 없어요. 최소 ${months}개월(${P.minDays}일)은 모의투자로 연습해 보세요.`, { startedAt: null, days: 0, closedTrades: 0, expectancyPct: null });

  const startedAt = auto[0]!.date;
  const days = Math.floor((Date.parse(today) - Date.parse(startedAt)) / 86_400_000) + 1;

  // 청산 거래: 매도 기록마다 복기란의 순수익률, 없으면 선입선출 매수가 대비 수익률
  const open = new Map<string, JournalEntry[]>();
  const returns: number[] = [];
  let closedTrades = 0;
  for (const e of auto) {
    const q = open.get(e.code) ?? [];
    open.set(e.code, q);
    if (e.side === "BUY") {
      q.push(e);
      continue;
    }
    closedTrades++;
    const buy = q.shift();
    const net = parseNetPct(e.review);
    if (net != null) returns.push(net);
    else if (buy && buy.price > 0) returns.push((e.price / buy.price - 1) * 100);
  }
  const expectancyPct = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null;
  const base = { startedAt, days, closedTrades, expectancyPct };
  const ev = expectancyPct == null ? "-" : signPct(expectancyPct);

  if (days < P.minDays)
    return done("info", `모의투자 ${days}일째예요. 최소 ${months}개월(${P.minDays}일)은 해 보길 권해요. ${P.minDays - days}일 남았어요(청산 ${closedTrades}건).`, base);
  if (closedTrades < P.minClosedTrades)
    return done("info", `모의투자 ${days}일째지만 청산 거래가 ${closedTrades}건이에요. 판단하려면 ${P.minClosedTrades}건 이상 필요해요.`, base);
  if (expectancyPct == null || expectancyPct <= 0)
    return done("warn", `모의투자 ${days}일째, 청산 ${closedTrades}건인데 거래당 기대값이 ${eyo(ev)}. 실전 전에 규칙부터 점검하세요.`, base);
  return done(
    "good",
    `모의투자 ${days}일째, 청산 ${closedTrades}건, 거래당 기대값 ${eyo(ev)}. 소액 실전 검토 가능해요. 실전 6개월 동안 수익이 없으면 소액으로 6개월 더 연장하세요.`,
    base,
    true,
  );
}
