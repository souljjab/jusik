import { describe, expect, it } from "vitest";
import type { BacktestResult, Candle, DayTradeCandidate, DayTradeCheckId } from "@jusik/shared";
import {
  FILTER_CHIPS, FIXED_RULES, PREFILTER_REASON, SCAN_DEFAULTS, bindingRejection, changedKeys, draftProblems, filterCandidates, filterCounts, indexEquity, lastScanText,
  nextScanText, periodLabel, postureLine, rejectionAdvice, scanDraftOf, summarizeBacktest, topRejection,
} from "../src/screens/discover/logic";
import { ALL_STRATEGIES, btCostText, defaultParams, fmtYmd, hasRegimeToggle, runSelected, signalEvidenceFor, strategyMeta } from "../src/features/strategyRun";

const ALL_MET: Record<DayTradeCheckId, boolean | null> = { volume2x: true, breakout20: true, trend: true, closeHigh: true, momentum: true, regime: true };

function cand(code: string, over: Partial<Record<DayTradeCheckId, boolean | null>> = {}, market: DayTradeCandidate["market"] = "KOSPI"): DayTradeCandidate {
  return {
    code, name: code, market, asOf: "2026-10-09", price: 10000, changePct: 5, volume: 1e6, tradeValue: 1e10, volumeRatio: 2.5, score: 70,
    entry: 10000, stop: 9700, target: 10600, stopPct: 3, targetPct: 6, netRR: 1.8, maxHoldDays: 3, notes: [], checks: { ...ALL_MET, ...over },
  };
}

describe("추천 필터 칩", () => {
  const list = [cand("A"), cand("B", { breakout20: false }), cand("C", { regime: null }), cand("AAPL", { volume2x: false }, "US")];
  it("고른 칩을 모두 충족한 후보만 남긴다", () => {
    expect(filterCandidates(list, new Set()).map((c) => c.code)).toEqual(["A", "B", "C", "AAPL"]);
    expect(filterCandidates(list, new Set(["breakout20"])).map((c) => c.code)).toEqual(["A", "C", "AAPL"]);
    expect(filterCandidates(list, new Set(["breakout20", "volume2x"])).map((c) => c.code)).toEqual(["A", "C"]);
    // 데이터 없음(null)은 충족이 아니다
    expect(filterCandidates(list, new Set(["regime"])).map((c) => c.code)).toEqual(["A", "B", "AAPL"]);
    expect(filterCandidates(list, new Set(["all-met"])).map((c) => c.code)).toEqual(["A"]);
  });
  it("시장 필터와 칩별 개수", () => {
    expect(filterCandidates(list, new Set(), "US").map((c) => c.code)).toEqual(["AAPL"]);
    expect(filterCandidates(list, new Set(), "KR")).toHaveLength(3);
    const n = filterCounts(list);
    expect(n["all-met"]).toBe(1);
    expect(n.breakout20).toBe(3);
    expect(n.volume2x).toBe(3);
    expect(Object.keys(n).sort()).toEqual(FILTER_CHIPS.map((f) => f.id).sort());
  });
});

describe("스캔 상태 문장", () => {
  const now = new Date("2026-10-12T06:20:00Z"); // 15:20 KST(월)
  it("마지막 스캔: 오늘이면 시각만, 아니면 날짜도", () => {
    expect(lastScanText("2026-10-12T06:12:00Z", now)).toBe("마지막 스캔 15:12 기준");
    expect(lastScanText("2026-10-09T06:12:00Z", now)).toBe("마지막 스캔 10.09(금) 15:12 기준");
    expect(lastScanText(null, now)).toBe("아직 스캔하지 않았어요");
  });
  it("다음 스캔: 자동 스캔 꺼짐·장 닫힘·장중", () => {
    const s = { markets: { KOSPI: true, KOSDAQ: false, US: false }, scanIntervalMin: 10 };
    expect(nextScanText({ running: false, nextScanAt: null, marketOpen: { KR: true, US: false } }, s)).toMatch(/꺼져 있어요/);
    expect(nextScanText({ running: true, nextScanAt: null, marketOpen: { KR: false, US: true } }, s)).toBe("장이 열리면 10분마다 자동으로 찾아요");
    expect(nextScanText({ running: true, nextScanAt: "2026-10-12T06:22:00Z", marketOpen: { KR: true, US: false } }, s)).toBe("다음 스캔 15:22");
  });
  it("국면 한 줄", () => {
    expect(postureLine("KOSPI", { posture: "NEUTRAL", exposureCapPct: 50 })).toBe("코스피 중립 · 상한 50%");
    expect(postureLine("US", null)).toBe("미국 판정 불가");
  });
});

describe("스크리너 조건 초안", () => {
  it("이전 버전 설정은 기본값으로 채운다", () => {
    expect(scanDraftOf({})).toEqual(SCAN_DEFAULTS);
    expect(scanDraftOf({ minScore: 60, markets: { KOSPI: true, KOSDAQ: false, US: true } }).markets.KOSDAQ).toBe(false);
  });
  it("바뀐 조건과 문제", () => {
    const d = { ...SCAN_DEFAULTS, minScore: 65, markets: { KOSPI: true, KOSDAQ: true, US: false } };
    expect(changedKeys(SCAN_DEFAULTS, d)).toEqual(["minScore", "markets"]);
    expect(changedKeys(SCAN_DEFAULTS, { ...SCAN_DEFAULTS })).toEqual([]);
    expect(draftProblems(SCAN_DEFAULTS)).toEqual([]);
    expect(draftProblems({ ...SCAN_DEFAULTS, markets: { KOSPI: false, KOSDAQ: false, US: false } })[0]).toMatch(/하나 이상/);
    expect(draftProblems({ ...SCAN_DEFAULTS, maxScanPerMarket: 2 })).toHaveLength(1);
  });
});

describe("조건 충족 0개: 가장 많이 걸러낸 조건(지도서 9.2)", () => {
  it("가장 많은 사유", () => {
    expect(topRejection({ a: 1, b: 5, c: 3 })).toEqual(["b", 5]);
    expect(topRejection({})).toBeNull();
    expect(topRejection(null)).toBeNull();
  });
  it("분석한 종목이 있으면 사전 필터보다 분석 단계 사유를 고른다", () => {
    const r = { [PREFILTER_REASON]: 44, "점수 미달": 11, "RSI 과열": 3 };
    expect(bindingRejection(r, 15)).toEqual({ reason: "점수 미달", count: 11, stage: "analysis" });
    expect(bindingRejection({ [PREFILTER_REASON]: 44 }, 0)).toEqual({ reason: PREFILTER_REASON, count: 44, stage: "prefilter" });
    expect(bindingRejection({}, 0)).toBeNull();
  });
  it("바꿀 수 있는 조건은 완화 제안, 고정 규칙은 안내만", () => {
    const a = rejectionAdvice("점수 미달", { ...SCAN_DEFAULTS, minScore: 100 });
    expect(a.condition).toBe("최소 점수 100점");
    expect(a.fixed).toBe(false);
    expect(a.fix?.patch).toEqual({ minScore: 45 });
    expect(rejectionAdvice("점수 미달(48)", SCAN_DEFAULTS).fix?.patch).toEqual({ minScore: 45 });
    const tv = rejectionAdvice(PREFILTER_REASON, SCAN_DEFAULTS);
    expect(tv.fix?.patch).toEqual({ minTradeValueKRW: 5e8, minTradeValueUSD: 2.5e6 });
    expect(rejectionAdvice(PREFILTER_REASON, { ...SCAN_DEFAULTS, minTradeValueKRW: 0, minTradeValueUSD: 0 }).fix).toBeUndefined();
    const rsi = rejectionAdvice("RSI 과열", SCAN_DEFAULTS);
    expect(rsi.fixed).toBe(true);
    expect(rsi.fix).toBeUndefined();
    expect(rejectionAdvice("알 수 없는 사유", SCAN_DEFAULTS).condition).toBe("알 수 없는 사유");
  });
});

describe("백테스트 요약", () => {
  const base: BacktestResult = {
    trades: [], equity: [], finalEquity: 1, totalReturnPct: 0, buyHoldReturnPct: 0, cagrPct: 0, maxDrawdownPct: 0, winRatePct: 0, tradeCount: 0, openPosition: false,
  };
  const t = (r: number) => ({ buyDate: "2024-01-02", buyPrice: 1, sellDate: "2024-01-05", sellPrice: 1, shares: 1, returnPct: r, reason: "SIGNAL" as const });
  it("손익비 = 평균 이익 ÷ 평균 손실, 기대값은 이익·손실 거래가 모두 있을 때만", () => {
    const s = summarizeBacktest({ ...base, trades: [t(10), t(6), t(-4)], tradeCount: 3, winRatePct: 66.7 });
    expect(s.payoff).toBeCloseTo(2);
    expect(s.winRatePct).toBe(66.7);
    expect(s.expectancyPct).toBeCloseTo((2 / 3) * 8 - (1 / 3) * 4);
    const none = summarizeBacktest(base);
    expect(none.winRatePct).toBeNull();
    expect(none.payoff).toBeNull();
    expect(none.expectancyPct).toBeNull();
    expect(summarizeBacktest({ ...base, trades: [t(3), t(5)], tradeCount: 2, winRatePct: 100 }).payoff).toBeNull();
  });
  it("기간 표기와 지수 비교선(첫날을 투자금으로 맞추고 빈 날은 직전 값)", () => {
    const eq = [{ date: "2024-01-02" }, { date: "2024-01-03" }, { date: "2024-01-04" }, { date: "2025-03-05" }];
    expect(periodLabel(eq)).toBe("2024.01~2025.03");
    expect(periodLabel([])).toBe("");
    const ix: Candle[] = [
      { date: "2023-12-29", open: 0, high: 0, low: 0, close: 100, volume: 0 },
      { date: "2024-01-03", open: 0, high: 0, low: 0, close: 110, volume: 0 },
      { date: "2025-03-05", open: 0, high: 0, low: 0, close: 90, volume: 0 },
    ];
    expect(indexEquity(eq, ix, 1000).map((p) => Math.round(p.value))).toEqual([1000, 1100, 1100, 900]);
    expect(indexEquity(eq, null, 1000)).toEqual([]);
    // 첫날보다 이른 지수가 없으면 그날은 건너뛴다
    expect(indexEquity(eq, ix.slice(1), 1000).map((p) => p.date)).toEqual(["2024-01-03", "2024-01-04", "2025-03-05"]);
  });
});

/** 결정적인 가짜 일봉(완만한 상승 + 사인파) */
function candles(n: number): Candle[] {
  const out: Candle[] = [];
  const d0 = Date.UTC(2023, 0, 2);
  let i = 0, day = 0;
  while (out.length < n) {
    const dt = new Date(d0 + day++ * 86_400_000);
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
    const c = 10000 * (1 + i * 0.0008) * (1 + 0.08 * Math.sin(i / 9));
    out.push({ date: dt.toISOString().slice(0, 10), open: c * 0.995, high: c * 1.02, low: c * 0.98, close: c, volume: 100000 + 50000 * Math.abs(Math.sin(i / 3)) });
    i++;
  }
  return out;
}

describe("전략 실행", () => {
  const c = candles(500);
  const info = { code: "005930", name: "삼성전자", market: "KOSPI" as const };
  it("모든 전략이 같은 이름표를 갖고, 기본 전략과 국면 토글이 맞다", () => {
    expect(ALL_STRATEGIES.map((s) => s.id)).toContain("app-score");
    expect(ALL_STRATEGIES.filter((s) => s.book)).toHaveLength(6);
    expect(strategyMeta("weinstein")?.book).toBe(true);
    expect(strategyMeta("nope")).toBeUndefined();
    expect(hasRegimeToggle("weinstein")).toBe(true);
    expect(hasRegimeToggle("rsi-recovery")).toBe(false);
  });
  it("책 전략·앱 전략 모두 돌아가고, 투자금이 0이면 돌리지 않는다", () => {
    for (const s of ALL_STRATEGIES) {
      const r = runSelected(s.id, c, c, info, "KR", defaultParams("KR"));
      expect(r, s.id).not.toBeNull();
      expect(r!.equity[0]!.equity, s.id).toBeCloseTo(defaultParams("KR").initialCash, -1);
    }
    expect(runSelected("weinstein", c, null, info, "KR", { ...defaultParams("KR"), initialCash: 0 })).toBeNull();
    expect(runSelected("app-score", c.slice(0, 20), null, info, "KR", defaultParams("KR"))).toBeNull();
  });
  it("표 날짜와 비용 문구", () => {
    // 지도서 3.2 월.일(요일). 다른 해면 연도 두 자리를 앞에 붙인다
    expect(fmtYmd("2024-03-05", "2026-10-26")).toBe("24.3.05(화)");
    expect(fmtYmd("2026-10-23", "2026-10-26")).toBe("10.23(금)");
    expect(fmtYmd(null)).toBe("-");
    expect(btCostText("KR")).toBe("수수료 0.015%(매수·매도) · 매도세 0.18% · 슬리피지 0.1%");
    expect(btCostText("KR", false)).not.toMatch(/슬리피지/);
    expect(defaultParams("US").initialCash).toBe(10_000);
  });
});

describe("고정 규칙과 지금 신호 근거", () => {
  it("고정 규칙은 공용 단타 기준값에서 만든다", () => {
    const text = FIXED_RULES.map((r) => `${r.label} ${r.value}`).join(" / ");
    expect(text).toContain("당일 등락률 +2% ~ +20%");
    expect(text).toContain("RSI(14) 80 이하");
    expect(text).toContain("20일선 이격 25% 이하");
    expect(text).toContain("최소 주가 국내 1,000원 · 미국 $2");
  });
  it("근거 칸이 있는 전략만 지금 신호를 만든다", () => {
    const c = cand("005930");
    expect(signalEvidenceFor("daytrade-breakout", null, c)?.strategy).toBe("daytrade");
    expect(signalEvidenceFor("daytrade-breakout", null, null)).toBeNull();
    expect(signalEvidenceFor("weinstein", null, c)).toBeNull();
    expect(signalEvidenceFor("rsi-recovery", null, c)).toBeNull();
    expect(signalEvidenceFor("seol-swing", null, c)).toBeNull();
  });
});
