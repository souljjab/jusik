import {
  DEFAULT_BACKTEST, DEFAULT_RUN, PAPER_COSTS, STRATEGIES, getStrategy, runBacktest, runStageBacktest, runStrategy, weinsteinStrategy,
  type BacktestResult, type Candle, type Region, type StockInfo, type Strategy, type StrategyTrade,
} from "@jusik/shared";

/*
 * 전략과 백테스트(지도서 5.3 F)의 계산. 책 전략(STRATEGIES)은 같은 엔진(runStrategy)으로,
 * 앱이 원래 가지고 있던 두 전략(주봉 단계 신호·일봉 기술 점수)은 기존 엔진으로 돌린다.
 */

export interface StrategyMeta {
  id: string;
  name: string;
  source: string;
  timeframe: "daily" | "weekly";
  description: string;
  rules: string[];
  /** 책 전략(전략 비교 표에 들어간다) */
  book: boolean;
}

/** 앱 기본 전략(이전 백테스트 탭의 '단일 전략' 두 가지) */
export const APP_STRATEGIES: StrategyMeta[] = [
  {
    id: "app-stage",
    name: "주봉 단계 신호",
    source: "앱 기본(와인스타인 단계)",
    timeframe: "weekly",
    description:
      "주봉이 마감된 뒤 신호를 갱신하고 다음 거래일 시가에 체결해요. 매수: 2단계 상승 + 과열 아님. 매도: 3단계 이탈·4단계 또는 손절가 이탈(손절가는 최근 8주 저점에서 시작해 올라가기만 해요).",
    rules: [],
    book: false,
  },
  {
    id: "app-score",
    name: "일봉 기술 점수",
    source: "앱 기본(기술 지표 점수)",
    timeframe: "daily",
    description: "일봉 기술 점수가 매수 기준 이상이면 다음 거래일 시가에 사고, 매도 기준 이하면 팔아요. 손절 비율을 정하면 그 아래에서 팔아요.",
    rules: [],
    book: false,
  },
];

export const BOOK_STRATEGIES: StrategyMeta[] = STRATEGIES.map((s) => ({
  id: s.id, name: s.name, source: s.source, timeframe: s.timeframe, description: s.description, rules: s.rules, book: true,
}));

export const ALL_STRATEGIES: StrategyMeta[] = [...BOOK_STRATEGIES, ...APP_STRATEGIES];

export const strategyMeta = (id: string | null | undefined): StrategyMeta | undefined => ALL_STRATEGIES.find((s) => s.id === id);

export const DEFAULT_STRATEGY_ID = "weinstein";

/** 지역별 매매 비용: 국내는 백테스트 기본값(수수료 0.015%·매도세 0.18%), 미국은 모의투자 비용 */
export function btCosts(region: Region): { feeRate: number; sellTaxRate: number } {
  return region === "US"
    ? { feeRate: PAPER_COSTS.US.feeRate, sellTaxRate: PAPER_COSTS.US.sellTaxRate }
    : { feeRate: DEFAULT_BACKTEST.feeRate, sellTaxRate: DEFAULT_BACKTEST.sellTaxRate };
}

export const btDefaultCash = (region: Region) => (region === "US" ? 10_000 : DEFAULT_BACKTEST.initialCash);

/** "수수료 0.015%(매수·매도) · 매도세 0.18% · 슬리피지 0.1%" */
export function btCostText(region: Region, slippage = true): string {
  const c = btCosts(region);
  const p = (x: number) => `${Number((x * 100).toFixed(3))}%`;
  return `수수료 ${p(c.feeRate)}(매수·매도) · 매도세 ${p(c.sellTaxRate)}${slippage ? ` · 슬리피지 ${DEFAULT_RUN.slippagePct}%` : ""}`;
}

/** 전략마다 고칠 수 있는 값 */
export interface BtParams {
  initialCash: number;
  /** 지수 약세 국면에서는 매수 안 함(주봉 전략) */
  useRegime: boolean;
  /** 일봉 기술 점수: 매수·매도 기준과 손절 % */
  buyThreshold: number;
  sellThreshold: number;
  stopPct: number;
}

export const defaultParams = (region: Region): BtParams => ({
  initialCash: btDefaultCash(region),
  useRegime: true,
  buyThreshold: DEFAULT_BACKTEST.buyThreshold,
  sellThreshold: DEFAULT_BACKTEST.sellThreshold,
  stopPct: 0,
});

/** 백테스트 결과(앱 엔진은 진입·청산 근거 문장이 없다) */
export type AnyTrade = BacktestResult["trades"][number] & Partial<Pick<StrategyTrade, "entryReason" | "exitReason" | "entryRule" | "exitRule">>;
export type AnyBacktest = Omit<BacktestResult, "trades"> & { trades: AnyTrade[] };

/** 고른 전략 하나를 종목 일봉에 돌린다. 데이터가 모자라면 null */
export function runSelected(id: string, candles: Candle[], index: Candle[] | null, info: StockInfo | null, region: Region, p: BtParams): AnyBacktest | null {
  const { feeRate, sellTaxRate } = btCosts(region);
  if (!(p.initialCash > 0)) return null;
  if (id === "app-score")
    return runBacktest(candles, { initialCash: p.initialCash, buyThreshold: p.buyThreshold, sellThreshold: p.sellThreshold, stopLossPct: Math.max(0, p.stopPct) / 100, feeRate, sellTaxRate });
  if (id === "app-stage") return runStageBacktest(candles, index ?? undefined, { initialCash: p.initialCash, useRegime: p.useRegime, feeRate, sellTaxRate });
  const s: Strategy | undefined = id === "weinstein" ? weinsteinStrategy({ useRegime: p.useRegime }) : getStrategy(id);
  if (!s) return null;
  const ref = info ? { code: info.code, name: info.name, market: info.market } : region === "US" ? { code: "", name: "", market: "US" as const } : undefined;
  return runStrategy(s, candles, { index: index ?? undefined, ref }, { initialCash: p.initialCash, feeRate, sellTaxRate });
}

/** 전략에 지수 국면 거르기 설정이 있는가 */
export const hasRegimeToggle = (id: string) => id === "weinstein" || id === "app-stage";

/** 표의 날짜: 여러 해에 걸치므로 연도까지 "2024.03.05" */
export const fmtYmd = (d: string | null | undefined) => (d ? d.slice(0, 10).replace(/-/g, ".") : "-");
