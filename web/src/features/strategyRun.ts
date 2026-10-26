import {
  DEFAULT_BACKTEST, DEFAULT_RUN, PAPER_COSTS, STRATEGIES, candleMasterEvidence, dayTradeEvidence, getStrategy, runBacktest, runStageBacktest, runStrategy, shortDateKo, weinsteinEvidence, weinsteinStrategy,
  type Analysis, type BacktestResult, type Candle, type DayTradeCandidate, type Evidence, type Region, type StockInfo, type Strategy, type StrategyTrade,
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

/**
 * 입력칸 글자 그대로의 초안. 숫자로 바로 바꾸면 '-'만 친 중간 상태가 0이 되어 음수 기준점을 칠 수 없고,
 * 투자금도 쉼표 없이 '10000000'으로 보인다. '백테스트 실행'을 누를 때 parseBtForm으로 읽는다.
 */
export interface BtForm {
  /** 투자금(쉼표 포함 글자) */
  cash: string;
  buy: string;
  sell: string;
  stop: string;
  useRegime: boolean;
}

/** 금액 입력칸 표시: 정수에 천 단위 쉼표(국내·미국 모두 정수 금액) */
export function fmtAmountInput(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
}
/** 금액 입력칸 글자 → 숫자(쉼표 등은 무시, 비었으면 0) */
export const parseAmountInput = (s: string) => {
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const btFormOf = (p: BtParams): BtForm => ({
  cash: fmtAmountInput(String(Math.round(p.initialCash))),
  buy: String(p.buyThreshold),
  sell: String(p.sellThreshold),
  stop: String(p.stopPct),
  useRegime: p.useRegime,
});

export type BtFormField = "cash" | "buy" | "sell" | "stop";

/** 초안 → 실행 값. 읽을 수 없거나 범위 밖이면 칸별 문장(errors)을 돌려준다 */
export function parseBtForm(f: BtForm, base: BtParams): { params: BtParams | null; errors: Partial<Record<BtFormField, string>> } {
  const errors: Partial<Record<BtFormField, string>> = {};
  const num = (s: string) => (/^\s*-?\d+(\.\d+)?\s*$/.test(s) ? Number(s) : NaN);
  const cash = parseAmountInput(f.cash);
  if (!(cash > 0)) errors.cash = "투자금을 0보다 크게 넣어 주세요.";
  const buy = num(f.buy), sell = num(f.sell), stop = f.stop.trim() === "" ? 0 : num(f.stop);
  if (!(buy >= -100 && buy <= 100)) errors.buy = "-100~100 사이 숫자로 넣어 주세요.";
  if (!(sell >= -100 && sell <= 100)) errors.sell = "-100~100 사이 숫자로 넣어 주세요.";
  if (!(stop >= 0 && stop <= 50)) errors.stop = "0~50 사이로 넣어 주세요(0이면 쓰지 않아요).";
  if (Object.keys(errors).length) return { params: null, errors };
  return { params: { ...base, initialCash: cash, buyThreshold: buy, sellThreshold: sell, stopPct: stop, useRegime: f.useRegime }, errors };
}

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

/** 오늘(한국 날짜 "YYYY-MM-DD") */
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * 표의 날짜(지도서 3.2 월.일(요일)): 올해면 "3.05(목)", 여러 해에 걸친 백테스트라 다른 해면 연도 두 자리를 앞에 "24.3.05(화)".
 * 종목 화면의 신호 날짜(stocksModel.markDate)와 같은 규칙이다.
 */
export function fmtYmd(d: string | null | undefined, today: string = todayKst()): string {
  if (!d) return "-";
  const ymd = d.slice(0, 10);
  return ymd.slice(0, 4) === today.slice(0, 4) ? shortDateKo(ymd) : `${ymd.slice(2, 4)}.${shortDateKo(ymd)}`;
}

/**
 * 고른 전략으로 본 이 종목의 지금 신호 근거(근거 스트립). 근거 칸을 정의한 전략만:
 * 와인스타인(주봉 단계 신호 포함)·캔들마스터는 종목 분석으로, 단타 돌파는 최근 스캔 후보일 때만.
 * 설춘환 스윙·RSI 회복·BBC 눌림·일봉 기술 점수는 근거 칸이 없어 null.
 */
export function signalEvidenceFor(id: string, analysis: Analysis | null | undefined, candidate: DayTradeCandidate | null | undefined): Evidence | null {
  if (id === "weinstein" || id === "app-stage") return analysis ? weinsteinEvidence(analysis) : null;
  if (id === "candle-master") return analysis ? candleMasterEvidence(analysis.candleMaster) : null;
  if (id === "daytrade-breakout") return candidate ? dayTradeEvidence(candidate) : null;
  return null;
}
