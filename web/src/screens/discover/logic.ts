import {
  DEFAULT_SETTINGS,
  DAYTRADE_BY_REGION, DAYTRADE_CELLS, POSTURE_LABEL, dayTradeEvidence, expectancy, josa, regionOf,
  type BacktestResult, type Candle, type DayTradeCandidate, type DayTradeCheckId, type EquityPoint, type Market, type Region, type ScanResult, type SchedulerStatus, type Settings,
} from "@jusik/shared";
import { MARKET_LABEL, fmtBig, fmtInt, fmtTime, fmtWhen } from "../../ui/format";

/*
 * 발굴 화면의 순수 계산(화면과 따로 시험한다): 필터 칩, 스캔 상태 문장, 탈락 사유 → 완화 제안(지도서 9.2),
 * 스캔 조건 초안 비교, 백테스트 요약 숫자, 지수 비교선.
 */

// ───────────────────────── 추천: 필터 칩 ─────────────────────────

/** 필터 칩: 근거 칸 하나(그 칸이 충족) 또는 '근거 모두 충족' */
export type FilterId = DayTradeCheckId | "all-met";

export const FILTER_CHIPS: { id: FilterId; label: string }[] = [
  { id: "all-met", label: "근거 모두 충족" },
  { id: "breakout20", label: "20일 고점 돌파" },
  { id: "volume2x", label: "거래량 2배" },
  { id: "regime", label: "시장 국면 충족" },
  ...DAYTRADE_CELLS.filter((c) => c.id !== "breakout20" && c.id !== "volume2x" && c.id !== "regime").map((c) => ({ id: c.id as FilterId, label: c.label })),
];

export type MarketFilter = "all" | Region;

/** 한 후보가 필터 하나를 통과하는가(근거 스트립과 같은 판정을 쓴다) */
export function passesFilter(c: DayTradeCandidate, f: FilterId): boolean {
  const ev = dayTradeEvidence(c);
  if (f === "all-met") return ev.met === ev.total;
  return ev.cells.find((x) => x.id === f)?.state === "met";
}

/** 고른 필터를 모두 통과하는 후보(필터가 없으면 전부). 시장 필터도 함께 */
export function filterCandidates(list: DayTradeCandidate[], filters: ReadonlySet<FilterId>, market: MarketFilter = "all"): DayTradeCandidate[] {
  return list.filter((c) => (market === "all" || regionOf(c.market) === market) && [...filters].every((f) => passesFilter(c, f)));
}

/** 칩마다 통과하는 후보 수(전체 후보 기준) */
export function filterCounts(list: DayTradeCandidate[]): Record<FilterId, number> {
  const out = Object.fromEntries(FILTER_CHIPS.map((f) => [f.id, 0])) as Record<FilterId, number>;
  for (const c of list) for (const f of FILTER_CHIPS) if (passesFilter(c, f.id)) out[f.id]++;
  return out;
}

// ───────────────────────── 스캔 상태 문장 ─────────────────────────

/** "마지막 스캔 15:12 기준"(오늘이 아니면 날짜도) */
export function lastScanText(at: string | null | undefined, now: Date): string {
  return at ? `마지막 스캔 ${fmtWhen(at, now)} 기준` : "아직 스캔하지 않았어요";
}

/**
 * 다음 스캔 안내. 서버는 켠 시장 중 하나라도 장이 열렸을 때만 스캔 주기마다 자동으로 찾는다.
 * running이 아니면 자동 스캔이 꺼진 서버(지금 스캔으로만 찾는다).
 */
export function nextScanText(sch: Pick<SchedulerStatus, "running" | "nextScanAt" | "marketOpen">, s: Pick<Settings, "markets" | "scanIntervalMin">): string {
  if (!sch.running) return "자동 스캔이 꺼져 있어요. '지금 스캔'으로만 찾아요";
  const open = (Object.keys(s.markets) as Market[]).some((m) => s.markets[m] && sch.marketOpen[regionOf(m)]);
  if (!open) return `장이 열리면 ${s.scanIntervalMin}분마다 자동으로 찾아요`;
  return sch.nextScanAt ? `다음 스캔 ${fmtTime(sch.nextScanAt)}` : `${s.scanIntervalMin}분마다 자동으로 찾아요`;
}

// ───────────────────────── 지금 스캔: 끝났는지와 결과 문장 ─────────────────────────

/** 스캔을 시작하기 직전의 스케줄러 표시(끝났는지 비교할 기준) */
export type ScanMark = Pick<SchedulerStatus, "lastScanAt" | "lastAttemptAt">;

export const scanMarkOf = (s: Partial<ScanMark> | null | undefined): ScanMark => ({ lastScanAt: s?.lastScanAt ?? null, lastAttemptAt: s?.lastAttemptAt ?? null });

/**
 * 시작한 스캔이 끝났는가: 스캔 중이 아니고, 성공 시각(lastScanAt)이나 시도 시각(lastAttemptAt)이 바뀌었으면 끝났다.
 * 실패한 스캔은 lastScanAt을 그대로 두고 lastAttemptAt만 바꾸므로 둘 다 본다(이전 서버에는 lastAttemptAt이 없다).
 */
export function scanFinished(before: ScanMark, s: Pick<SchedulerStatus, "scanning" | "lastScanAt"> & Partial<Pick<SchedulerStatus, "lastAttemptAt">>): boolean {
  if (s.scanning) return false;
  return (s.lastScanAt ?? null) !== before.lastScanAt || (s.lastAttemptAt != null && s.lastAttemptAt !== before.lastAttemptAt);
}

/**
 * 서버 스캔 오류(scheduler.lastError) → 화면 문장. 서버가 보낸 한국어 문장은 그대로 쓰고, 영어 예외 메시지는 그대로 보이지 않고
 * 무엇이 일어났고 어디서 확인하는지로 바꾼다(지도서 9.2). 서버 쪽 오류라 브라우저 연결 문장(errorText)은 쓰지 않는다.
 */
export function scanErrorText(msg: string | null | undefined): string {
  const m = msg?.trim() ?? "";
  if (m && /[가-힣]/.test(m)) return /[.!?]$/.test(m) ? m : `${m}.`;
  return "서버가 스캔하다 오류가 났어요. 자세한 내용은 서버 기록에 있어요.";
}

/** 끝난 스캔의 결과 문장: 실패면 무엇이 일어났고 어떻게 하는지, 성공이면 조건 충족 수 */
export function scanDoneToast(s: Pick<SchedulerStatus, "lastError">, candidates: number): { text: string; tone: "ok" | "warn" } {
  if (s.lastError) return { text: `스캔을 마치지 못했어요. ${scanErrorText(s.lastError)} 잠시 뒤 다시 스캔해 보세요.`, tone: "warn" };
  return { text: `스캔을 마쳤어요. 조건 충족 ${candidates}종목이에요.`, tone: "ok" };
}

// ───────────────────────── 스크리너: 조건 초안 ─────────────────────────

/** 이 화면에서 고치는 스캔 조건(계좌·한도는 설정 화면) */
export const SCAN_KEYS = ["minScore", "minTradeValueKRW", "minTradeValueUSD", "markets", "maxScanPerMarket", "scanIntervalMin", "minuteMode"] as const;
export type ScanKey = (typeof SCAN_KEYS)[number];
export type ScanDraft = Pick<Settings, ScanKey>;

/** 스캔 조건 기본값(앱 설정 기본값 DEFAULT_SETTINGS에서 뽑는다) */
export const SCAN_DEFAULTS: ScanDraft = {
  minScore: DEFAULT_SETTINGS.minScore,
  minTradeValueKRW: DEFAULT_SETTINGS.minTradeValueKRW,
  minTradeValueUSD: DEFAULT_SETTINGS.minTradeValueUSD,
  markets: { ...DEFAULT_SETTINGS.markets },
  maxScanPerMarket: DEFAULT_SETTINGS.maxScanPerMarket,
  scanIntervalMin: DEFAULT_SETTINGS.scanIntervalMin,
  minuteMode: DEFAULT_SETTINGS.minuteMode,
};

/** 설정에서 스캔 조건만 뽑는다(이전 버전 설정에 없는 항목은 기본값) */
export function scanDraftOf(s: Partial<Settings>): ScanDraft {
  return {
    minScore: s.minScore ?? SCAN_DEFAULTS.minScore,
    minTradeValueKRW: s.minTradeValueKRW ?? SCAN_DEFAULTS.minTradeValueKRW,
    minTradeValueUSD: s.minTradeValueUSD ?? SCAN_DEFAULTS.minTradeValueUSD,
    markets: { ...SCAN_DEFAULTS.markets, ...(s.markets ?? {}) },
    maxScanPerMarket: s.maxScanPerMarket ?? SCAN_DEFAULTS.maxScanPerMarket,
    scanIntervalMin: s.scanIntervalMin ?? SCAN_DEFAULTS.scanIntervalMin,
    minuteMode: s.minuteMode ?? SCAN_DEFAULTS.minuteMode,
  };
}

/** 바뀐 조건 이름(저장 버튼·안내 문장용) */
export function changedKeys(saved: ScanDraft, draft: ScanDraft): ScanKey[] {
  return SCAN_KEYS.filter((k) => (k === "markets" ? (["KOSPI", "KOSDAQ", "US"] as const).some((m) => saved.markets[m] !== draft.markets[m]) : saved[k] !== draft[k]));
}

/** 조건 묶음 한 줄 요약(내 전략 목록): "최소 점수 55점 · 국내 100억 · 미국 $5.0M · 코스피·코스닥" */
export function draftSummary(d: ScanDraft): string {
  const markets = (["KOSPI", "KOSDAQ", "US"] as const).filter((m) => d.markets[m]).map((m) => MARKET_LABEL[m]);
  return [
    `최소 점수 ${d.minScore}점`,
    `국내 ${fmtBig(d.minTradeValueKRW, "KR")}`,
    `미국 ${fmtBig(d.minTradeValueUSD, "US")}`,
    markets.length ? markets.join("·") : "대상 시장 없음",
  ].join(" · ");
}

/** 범위 밖 값 안내(서버가 범위 안으로 맞추지만 미리 알린다). 시장을 하나도 안 켜면 스캔할 것이 없다 */
export function draftProblems(d: ScanDraft): string[] {
  const out: string[] = [];
  if (!d.markets.KOSPI && !d.markets.KOSDAQ && !d.markets.US) out.push("대상 시장을 하나 이상 켜야 스캔할 수 있어요.");
  if (!(d.minScore >= 0 && d.minScore <= 100)) out.push("최소 점수는 0~100점 사이로 저장돼요.");
  if (!(d.maxScanPerMarket >= 5 && d.maxScanPerMarket <= 100)) out.push("시장별 스캔 종목 수는 5~100개 사이로 저장돼요.");
  if (!(d.scanIntervalMin >= 1 && d.scanIntervalMin <= 240)) out.push("스캔 주기는 1~240분 사이로 저장돼요.");
  if (!(d.minTradeValueKRW >= 0) || !(d.minTradeValueUSD >= 0)) out.push("최소 거래대금은 0 이상으로 저장돼요.");
  return out;
}

/** 스캔 조건이 아닌 앱 고정 규칙(scoreDayTrade·DAYTRADE_BY_REGION). 화면에서는 읽기만 한다 */
const KR = DAYTRADE_BY_REGION.KR, US = DAYTRADE_BY_REGION.US;
export const FIXED_RULES: { label: string; value: string }[] = [
  { label: "당일 등락률", value: `+${KR.minChangePct}% ~ +${KR.maxChangePct}%` },
  { label: "RSI(14)", value: `${KR.maxRsi} 이하` },
  { label: "20일선 이격", value: `${KR.maxExtendPct}% 이하` },
  { label: "거래량", value: "20일 평균의 1.2배 이상" },
  { label: "최소 주가", value: `국내 ${KR.minPrice.toLocaleString("ko-KR")}원 · 미국 $${US.minPrice}` },
  { label: "일봉 자료", value: "40일 이상, 7일 안의 시세" },
];

// ───────────────────────── 조건 충족 0개: 가장 많이 걸러낸 조건(지도서 9.2) ─────────────────────────

/** 탈락 사유 중 가장 많은 것. 없으면 null */
export function topRejection(rejected: Record<string, number> | null | undefined): [string, number] | null {
  const list = Object.entries(rejected ?? {}).filter(([, n]) => n > 0);
  if (!list.length) return null;
  list.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return list[0]!;
}

/** 서버가 분석 전에 후보 풀에서 거르는 단계(scanner.ts). 평소 장에서는 늘 가장 많아 완화 대상을 가리지 못한다 */
export const PREFILTER_REASON = "사전 필터(가격·등락률·거래대금)";

/**
 * 결과를 0개로 만든 조건(지도서 9.2 '가장 많이 걸러낸 조건'): 분석까지 간 종목이 있으면 분석 단계 사유 중 가장 많은 것,
 * 분석한 종목이 없으면 사전 필터를 포함한 전체에서 가장 많은 것. stage로 어느 단계인지 알려 준다.
 */
export function bindingRejection(rejected: Record<string, number> | null | undefined, scannedCount: number): { reason: string; count: number; stage: "analysis" | "prefilter" } | null {
  const analysis = Object.fromEntries(Object.entries(rejected ?? {}).filter(([r]) => r !== PREFILTER_REASON));
  const a = scannedCount > 0 ? topRejection(analysis) : null;
  if (a) return { reason: a[0], count: a[1], stage: "analysis" };
  const t = topRejection(rejected);
  return t ? { reason: t[0], count: t[1], stage: t[0] === PREFILTER_REASON ? "prefilter" : "analysis" } : null;
}

export interface RejectionAdvice {
  /** 사용자가 읽는 조건 이름(예: "최소 점수 55점") */
  condition: string;
  /** 앱 고정 규칙이라 이 화면에서 바꿀 수 없는가 */
  fixed: boolean;
  /** 다음에 할 일 */
  text: string;
  /** 완화 버튼(바꿀 수 있는 조건만) */
  fix?: { label: string; patch: Partial<ScanDraft> };
}

const krw = (n: number) => fmtBig(n, "KR");
const usd = (n: number) => fmtBig(n, "US");

/**
 * 최소 거래대금 절반: 정확히 반으로 나눈 뒤 알기 쉬운 단위(국내 1천만 원·미국 10만 달러)로 내림한다.
 * 반올림하면 1억·$1M에서 그대로 남아 '절반으로' 버튼이 아무것도 바꾸지 못한다.
 */
export function halfTradeValue(d: Pick<ScanDraft, "minTradeValueKRW" | "minTradeValueUSD">): { minTradeValueKRW: number; minTradeValueUSD: number } {
  return {
    minTradeValueKRW: Math.max(0, Math.floor(d.minTradeValueKRW / 2 / 1e7) * 1e7),
    minTradeValueUSD: Math.max(0, Math.floor(d.minTradeValueUSD / 2 / 1e5) * 1e5),
  };
}

/** 탈락 사유(서버 scanner.ts·scoreDayTrade 문구) → 조건 이름과 완화 제안 */
export function rejectionAdvice(reason: string, d: ScanDraft): RejectionAdvice {
  const r = reason.replace(/\(\d+\)$/, "");
  const lowerScore = Math.max(0, Math.min(d.minScore - 10, 45));
  const { minTradeValueKRW: lowerKrw, minTradeValueUSD: lowerUsd } = halfTradeValue(d);
  const canHalve = lowerKrw < d.minTradeValueKRW || lowerUsd < d.minTradeValueUSD;
  switch (r) {
    case "점수 미달":
      return d.minScore > 0
        ? { condition: `최소 점수 ${d.minScore}점`, fixed: false, text: `최소 점수를 ${lowerScore}점으로 낮춰 보세요. 점수가 낮은 후보는 근거가 적으니 근거 보기로 확인하세요.`, fix: { label: `최소 점수 ${lowerScore}점으로`, patch: { minScore: lowerScore } } }
        : { condition: "최소 점수", fixed: false, text: "최소 점수가 이미 0점이에요. 장중에 다시 스캔해 보세요." };
    case "거래대금 부족":
    case "사전 필터(가격·등락률·거래대금)":
      return {
        condition: r === "거래대금 부족" ? `최소 거래대금(국내 ${krw(d.minTradeValueKRW)} · 미국 ${usd(d.minTradeValueUSD)})` : "사전 필터(주가·등락률·거래대금)",
        fixed: false,
        text: canHalve
          ? `등락률 2~20%와 최소 주가는 고정 규칙이라, 바꿀 수 있는 건 최소 거래대금이에요. 국내 ${krw(lowerKrw)} · 미국 ${josa(usd(lowerUsd), "으로/로")} 낮추거나 장중에 다시 스캔해 보세요.`
          : "등락률 2~20%와 최소 주가는 고정 규칙이고, 최소 거래대금은 이미 가장 낮아요. 장중에 다시 스캔해 보세요.",
        ...(canHalve ? { fix: { label: "최소 거래대금 절반으로", patch: { minTradeValueKRW: lowerKrw, minTradeValueUSD: lowerUsd } } } : {}),
      };
    case "RSI 과열":
      return { condition: "RSI 80 이하(고정 규칙)", fixed: true, text: "과열 종목을 거르는 고정 규칙이라 바꿀 수 없어요. 과열이 풀린 뒤 다시 스캔해 보세요." };
    case "20일선 이격 과열":
      return { condition: "20일선 이격 25% 이하(고정 규칙)", fixed: true, text: "추격 매수를 막는 고정 규칙이라 바꿀 수 없어요. 대상 시장을 넓히거나 다음 스캔을 기다려 보세요." };
    case "상승폭 부족":
      return { condition: "당일 등락률 +2% 이상(고정 규칙)", fixed: true, text: "돌파 당일만 찾는 고정 규칙이에요. 장중에 다시 스캔해 보세요." };
    case "상한가 근처 추격 위험":
      return { condition: "당일 등락률 +20% 이하(고정 규칙)", fixed: true, text: "상한가 추격을 막는 고정 규칙이라 바꿀 수 없어요." };
    case "거래량 증가 없음":
      return { condition: "거래량 20일 평균의 1.2배 이상(고정 규칙)", fixed: true, text: "거래량이 붙지 않은 상승을 거르는 고정 규칙이에요. 장중 거래량이 쌓인 뒤 다시 스캔해 보세요." };
    case "저가주":
      return { condition: "최소 주가(고정 규칙)", fixed: true, text: "동전주를 거르는 고정 규칙이라 바꿀 수 없어요." };
    case "오래된 데이터":
    case "데이터 부족":
    case "지표 계산 불가":
      return { condition: `시세 자료(${r})`, fixed: true, text: "시세 자료가 오래됐거나 모자라요. 장이 열린 뒤 다시 스캔해 보세요." };
    default:
      return { condition: r, fixed: true, text: "다음 스캔에서 다시 확인해 보세요." };
  }
}

/**
 * 조건 충족 0개일 때의 사실 문장(지도서 9.2): 가장 많이 걸러낸 조건과 그 종목 수. 홈의 빈 화면도 같은 문장을 쓴다.
 * 완화 버튼은 스크리너(ZeroResult)에 있으니 그리로 안내한다.
 */
export function zeroScanSentence(scan: Pick<ScanResult, "rejected" | "scannedCount">, settings: Partial<Settings>): string {
  const top = bindingRejection(scan.rejected, scan.scannedCount);
  return top
    ? `모든 조건을 만족하는 종목이 없어요. 가장 많이 걸러낸 조건은 ${rejectionAdvice(top.reason, scanDraftOf(settings)).condition}(${fmtInt(top.count)}종목)이에요. 스크리너에서 완화 제안을 볼 수 있어요.`
    : "모든 조건을 만족하는 종목이 없어요. 장중에 다시 스캔해 보세요.";
}

// ───────────────────────── 백테스트 요약 ─────────────────────────

export interface BacktestSummary {
  cagrPct: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  buyHoldReturnPct: number;
  tradeCount: number;
  /** 거래가 없으면 null */
  winRatePct: number | null;
  /** 평균 이익 ÷ 평균 손실. 손실 거래가 없으면 null */
  payoff: number | null;
  /** 거래당 기대값(%)·켈리 비중. 이긴 거래와 진 거래가 모두 3건 이상 있을 때만 */
  expectancyPct: number | null;
  kellyPct: number | null;
  halfKellyPct: number | null;
  finalEquity: number;
  openPosition: boolean;
}

export function summarizeBacktest(r: Omit<BacktestResult, "trades"> & { trades: Pick<BacktestResult["trades"][number], "returnPct">[] }): BacktestSummary {
  const wins = r.trades.filter((t) => t.returnPct > 0), losses = r.trades.filter((t) => t.returnPct <= 0);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // 손익비 = 평균 이익 ÷ 평균 손실(shared signalStats와 같은 정의)
  const avgLoss = losses.length ? Math.abs(mean(losses.map((t) => t.returnPct))) : 0;
  const payoff = wins.length && avgLoss > 0 ? mean(wins.map((t) => t.returnPct)) / avgLoss : null;
  const ev = r.trades.length >= 3 && wins.length && losses.length
    ? expectancy({ winRate: wins.length / r.trades.length, avgWinPct: mean(wins.map((t) => t.returnPct)), avgLossPct: mean(losses.map((t) => t.returnPct)) })
    : null;
  return {
    cagrPct: r.cagrPct,
    maxDrawdownPct: r.maxDrawdownPct,
    totalReturnPct: r.totalReturnPct,
    buyHoldReturnPct: r.buyHoldReturnPct,
    tradeCount: r.tradeCount,
    winRatePct: r.tradeCount ? r.winRatePct : null,
    payoff,
    expectancyPct: ev?.expectancyPct ?? null,
    kellyPct: ev?.kellyPct ?? null,
    halfKellyPct: ev?.halfKellyPct ?? null,
    finalEquity: r.finalEquity,
    openPosition: r.openPosition,
  };
}

/** 기간 표기: "2023.11~2026.10" */
export function periodLabel(equity: Pick<EquityPoint, "date">[]): string {
  if (!equity.length) return "";
  const ym = (d: string) => d.slice(0, 7).replace("-", ".");
  return `${ym(equity[0]!.date)}~${ym(equity.at(-1)!.date)}`;
}

/**
 * 지수 비교선: 백테스트 첫날 지수 종가를 투자금으로 맞춰 같은 날짜마다 환산한다.
 * 지수에 없는 날(휴장 차이)은 직전 값을 쓴다. 첫날 이전 지수가 하나도 없으면 빈 배열.
 */
export function indexEquity(equity: Pick<EquityPoint, "date">[], index: Candle[] | null | undefined, initialCash: number): { date: string; value: number }[] {
  if (!index?.length || !equity.length) return [];
  const sorted = [...index].sort((a, b) => a.date.localeCompare(b.date));
  let j = -1;
  let base: number | null = null;
  const out: { date: string; value: number }[] = [];
  for (const p of equity) {
    while (j + 1 < sorted.length && sorted[j + 1]!.date <= p.date) j++;
    if (j < 0) continue;
    const close = sorted[j]!.close;
    if (base == null) base = close;
    if (!(base > 0)) return [];
    out.push({ date: p.date, value: (initialCash * close) / base });
  }
  return out;
}

/** 거래 수가 적어 통계로 읽기 어려운 기준(전략 비교 표와 같다) */
export const MIN_SAMPLE = 30;

/** 국면 한 줄: "코스피 중립 · 상한 50%" */
export function postureLine(market: Market, p: { posture: keyof typeof POSTURE_LABEL; exposureCapPct: number } | null | undefined): string {
  return p ? `${MARKET_LABEL[market]} ${POSTURE_LABEL[p.posture]} · 상한 ${p.exposureCapPct}%` : `${MARKET_LABEL[market]} 판정 불가`;
}
