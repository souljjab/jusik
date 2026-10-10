import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ColorType, LineStyle, createChart, type ISeriesApi, type Time } from "lightweight-charts";
import {
  DEFAULT_BACKTEST,
  DEFAULT_RUN,
  PAPER_COSTS,
  STRATEGIES,
  TRADE_REASON_LABEL,
  compareStrategies,
  getStrategy,
  type Candle,
  type Region,
  type StockInfo,
  type StrategyBacktest,
  type StrategyComparison,
  type StrategyTrade,
} from "@jusik/shared";
import { money, num, pct, tone } from "./format";
import { useChartColors, type ChartColors } from "./theme";
import "./styles/backtest.css";

// ───────── 백테스트 탭 공용 도우미(전략 비교·적립식에서 같이 써요) ─────────

/** 지역별 매매 비용: 국내는 기존 백테스트 기본값, 미국은 모의투자 비용 */
export function btCosts(region: Region): { feeRate: number; sellTaxRate: number } {
  return region === "US"
    ? { feeRate: PAPER_COSTS.US.feeRate, sellTaxRate: PAPER_COSTS.US.sellTaxRate }
    : { feeRate: DEFAULT_BACKTEST.feeRate, sellTaxRate: DEFAULT_BACKTEST.sellTaxRate };
}

export const btDefaultCash = (region: Region) => (region === "US" ? 10_000 : DEFAULT_BACKTEST.initialCash);

/** 비용 안내 문구(예: 수수료 0.015%(매수·매도) · 매도세 0.18%) */
export function btCostText(region: Region): string {
  const c = btCosts(region);
  return `수수료 ${num(c.feeRate * 100, 3)}%(매수·매도) · 매도세 ${num(c.sellTaxRate * 100, 3)}%`;
}

/** 표 안 가격: 국내는 원 단위 정수, 미국은 소수 둘째 자리 */
export const btPrice = (n: number, region: Region) =>
  region === "US" ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(n).toLocaleString("ko-KR");

export function btChartOptions(c: ChartColors, height: number) {
  return {
    height,
    layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text, fontSize: 12 },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.grid },
    timeScale: { borderColor: c.grid },
    localization: { priceFormatter: (p: number) => (Math.abs(p) >= 1000 ? Math.round(p).toLocaleString("ko-KR") : p.toFixed(2)) },
  } as const;
}

export function Metric({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="metric">
      <span className="muted small">{label}</span>
      <b className={cls}>{value}</b>
    </div>
  );
}

/** 근거 규칙 태그(예: "M3-05 설춘환") */
export function RuleTag({ rule }: { rule?: string }) {
  return rule ? <span className="bt-rule" title="근거 규칙(기초 자료집 부록 A)">{rule}</span> : null;
}

// ───────── 전략 비교 ─────────

type Ran = StrategyComparison & { result: StrategyBacktest };
const BH = "__buyhold";
const MIN_SAMPLE = 30;

/** 전략별 선 색. 상승·하락 색(빨강·파랑)과 헷갈리지 않게 대부분 다른 색을 써요 */
const palette = (c: ChartColors) => [c.accent, c.ma5, c.ma60, c.down, "#ec4899", c.ma20];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);

export function StrategyCompare({ candles, indexCandles, region, info }: { candles: Candle[]; indexCandles: Candle[] | null; region: Region; info?: StockInfo }) {
  const colors = useChartColors();
  const [cashInput, setCash] = useState(() => btDefaultCash(region));
  const initialCash = useDeferredValue(cashInput);
  const [open, setOpen] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const chartEl = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  useEffect(() => setCash(btDefaultCash(region)), [region]);

  const { feeRate, sellTaxRate } = btCosts(region);
  const code = info?.code, name = info?.name, market = info?.market;
  const rows = useMemo(
    () =>
      initialCash > 0
        ? compareStrategies(
            candles,
            {
              index: indexCandles ?? undefined,
              // 종목 정보가 아직 없으면 미국 종목만 지역 기준값을 맞춰 줘요(국내는 기본값과 같아요)
              ref: code != null && name != null && market != null ? { code, name, market } : region === "US" ? { code: "", name: "", market: "US" } : undefined,
            },
            undefined,
            { initialCash, feeRate, sellTaxRate },
          )
        : [],
    [candles, indexCandles, code, name, market, region, initialCash, feeRate, sellTaxRate],
  );
  const ran = useMemo(() => rows.filter((r): r is Ran => r.result != null), [rows]);
  const colorOf = useMemo(() => {
    const p = palette(colors);
    return new Map(rows.map((r, j) => [r.id, p[j % p.length]!]));
  }, [rows, colors]);
  // 실제로 거래한 전략 중 2위보다 확실히 높을 때만 '최고'를 붙여요(모두 0%면 표시 안 함)
  const best = useMemo(() => {
    const traded = ran.filter((r) => r.result.tradeCount > 0 || r.result.openPosition);
    const [a, b] = [...traded].sort((x, y) => y.result.totalReturnPct - x.result.totalReturnPct);
    return a && b && a.result.totalReturnPct > b.result.totalReturnPct ? a.id : null;
  }, [ran]);

  // 차트는 데이터·테마가 바뀔 때만 새로 그리고, 체크박스는 선의 표시 여부만 바꿔요(확대 상태 유지)
  useEffect(() => {
    const el = chartEl.current;
    if (!el || !ran.length) return;
    const chart = createChart(el, btChartOptions(colors, 300));
    const map = new Map<string, ISeriesApi<"Line">>();
    for (const r of ran) {
      const s = chart.addLineSeries({ color: colorOf.get(r.id), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      s.setData(r.result.equity.map((p) => ({ time: p.date as Time, value: p.equity })));
      map.set(r.id, s);
    }
    const bh = chart.addLineSeries({ color: colors.muted, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
    bh.setData(ran[0]!.result.equity.map((p) => ({ time: p.date as Time, value: p.buyHold })));
    map.set(BH, bh);
    seriesRef.current = map;
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
      seriesRef.current = new Map();
    };
  }, [ran, colors, colorOf]);

  useEffect(() => {
    for (const [id, s] of seriesRef.current) s.applyOptions({ visible: !hidden.has(id) });
  }, [hidden, ran, colors, colorOf]);

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const first = ran[0]?.result.equity;
  return (
    <>
      <p className="muted small bt-intro">
        규칙이 다른 전략 {STRATEGIES.length}개를 <b>같은 종목·같은 기간·같은 비용</b>으로 돌려 비교해요. 각 전략의 기준값은 저자 경험칙이라 검증된 통계가 아니에요.
      </p>
      <div className="form">
        <label>
          투자금({region === "US" ? "달러" : "원"})
          <input type="number" min={0} step={region === "US" ? 1000 : 1000000} value={cashInput} onChange={(e) => setCash(Math.max(0, +e.target.value || 0))} />
        </label>
      </div>
      {!(initialCash > 0) ? (
        <p className="muted">투자금을 0보다 크게 넣어 주세요.</p>
      ) : !ran.length ? (
        <p className="muted">데이터가 부족해 어떤 전략도 돌리지 못했어요.</p>
      ) : (
        <>
          <p className="muted small">
            {first![0]!.date} ~ {first!.at(-1)!.date} · {btCostText(region)} · 슬리피지 {num(DEFAULT_RUN.slippagePct, 2)}%
            {!indexCandles && " · 지수 데이터가 없어 지수 약세 국면 필터 없이 돌렸어요"}
          </p>
          <div ref={chartEl} className="bt-chart" />
          <div className="bt-legend" role="group" aria-label="차트에 표시할 선">
            {ran.map((r) => (
              <label key={r.id}>
                <input type="checkbox" checked={!hidden.has(r.id)} onChange={() => toggle(r.id)} />
                <i className="bt-swatch" style={{ background: colorOf.get(r.id) }} aria-hidden />
                {r.name}
              </label>
            ))}
            <label>
              <input type="checkbox" checked={!hidden.has(BH)} onChange={() => toggle(BH)} />
              <i className="bt-swatch bt-swatch-dash" style={{ borderColor: colors.muted }} aria-hidden />
              단순 보유
            </label>
          </div>
        </>
      )}

      {rows.length > 0 && (
        <>
          <div className="table-wrap bt-wrap">
            <table className="trades bt-compare">
              <thead>
                <tr>
                  <th className="left">전략</th><th>총수익률</th><th>단순보유</th><th>연환산(CAGR)</th><th>최대낙폭(MDD)</th><th>거래 수</th><th>승률</th><th>거래당 평균</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <CompareRow r={r} color={r.result ? colorOf.get(r.id) : undefined} best={best === r.id} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
                    {open === r.id && (
                      <tr>
                        <td colSpan={8} className="bt-detail">
                          <StrategyDetail r={r} region={region} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small bt-caption">
            모든 전략을 같은 기간·같은 비용으로 돌렸어요(다음 날 시가 체결, 수수료·세금·슬리피지 {num(DEFAULT_RUN.slippagePct, 2)}% 반영).
            ‘최고’는 이 종목·이 구간에서 수익률이 가장 높았다는 뜻일 뿐이에요. 한 종목의 과거 결과에 맞춰 전략을 고르면 과최적화되기 쉬우니 여러 종목·기간에서 같이 확인해 주세요.
            거래가 {MIN_SAMPLE}회 미만이면 ‘표본 부족’으로 표시해요. 분할 매도도 한 건으로 세요.
          </p>
        </>
      )}
    </>
  );
}

function CompareRow({ r, color, best, open, onToggle }: { r: StrategyComparison; color?: string; best: boolean; open: boolean; onToggle: () => void }) {
  const res = r.result;
  const avg = res ? mean(res.trades.map((t) => t.returnPct)) : null;
  return (
    <tr className={open ? "bt-open" : undefined}>
      <td className="left">
        <button className="bt-name" onClick={onToggle} aria-expanded={open} title="전략 설명과 거래 내역 보기">
          <span aria-hidden className="bt-caret">{open ? "▾" : "▸"}</span>
          {color && <i className="bt-swatch" style={{ background: color }} aria-hidden />}
          {r.name}
          {best && <span className="pill bt-best">최고</span>}
        </button>
        <span className="bt-sub">{r.source} · {r.timeframe === "weekly" ? "주봉" : "일봉"}</span>
      </td>
      {!res ? (
        <td colSpan={7} className="muted left">데이터가 부족해 돌리지 못했어요.</td>
      ) : (
        <>
          <td className={tone(res.totalReturnPct)}><b>{pct(res.totalReturnPct)}</b></td>
          <td className={tone(res.buyHoldReturnPct)}>{pct(res.buyHoldReturnPct)}</td>
          <td className={tone(res.cagrPct)}>{pct(res.cagrPct)}</td>
          <td className={tone(res.maxDrawdownPct)}>{pct(res.maxDrawdownPct)}</td>
          <td>
            {res.tradeCount}회
            {res.tradeCount < MIN_SAMPLE && <span className="pill warn-pill bt-tag">표본 부족</span>}
          </td>
          <td>{res.tradeCount ? `${num(res.winRatePct, 0)}%` : "-"}</td>
          <td className={avg == null ? "muted" : tone(avg)}>{avg == null ? "-" : pct(avg)}</td>
        </>
      )}
    </tr>
  );
}

function StrategyDetail({ r, region }: { r: StrategyComparison; region: Region }) {
  const s = getStrategy(r.id);
  const res = r.result;
  return (
    <div className="bt-detail-body">
      {s && <p className="bt-desc">{s.description}</p>}
      {s && s.rules.length > 0 && (
        <div className="bt-rules">
          <span className="muted small">근거 규칙</span>
          {s.rules.map((rule) => <RuleTag key={rule} rule={rule} />)}
        </div>
      )}
      {!res ? (
        <p className="muted small">데이터가 부족해 이 전략은 돌리지 못했어요. 더 긴 기간의 시세가 필요해요.</p>
      ) : (
        <>
          <p className="muted small">
            최종 평가금액 {money(res.finalEquity, region)}
            {res.openPosition && " · 마지막 날 보유 중인 포지션이 있어요(아래에는 청산된 거래만 있어요)"}
          </p>
          {res.trades.length ? <TradeList trades={res.trades} region={region} /> : <p className="muted small">이 구간에서는 청산된 거래가 없어요.</p>}
        </>
      )}
    </div>
  );
}

function TradeList({ trades, region }: { trades: StrategyTrade[]; region: Region }) {
  return (
    <div className="table-wrap">
      <table className="trades">
        <thead>
          <tr>
            <th>매수일</th><th>매수가</th><th>매도일</th><th>매도가</th><th>수량</th><th>수익률</th><th className="left">진입 근거</th><th className="left">청산 근거</th>
          </tr>
        </thead>
        <tbody>
          {[...trades].reverse().map((t, i) => (
            <tr key={i}>
              <td>{t.buyDate}</td>
              <td>{btPrice(t.buyPrice, region)}</td>
              <td>{t.sellDate}</td>
              <td>{btPrice(t.sellPrice, region)}</td>
              <td>
                {t.shares.toLocaleString()}
                {t.fraction != null && t.fraction < 0.999 && <span className="muted small"> (처음의 {Math.round(t.fraction * 100)}%)</span>}
              </td>
              <td className={tone(t.returnPct)}>{pct(t.returnPct)}</td>
              <td className="left bt-reason">{t.entryReason} <RuleTag rule={t.entryRule} /></td>
              <td className="left bt-reason">
                <b>{TRADE_REASON_LABEL[t.reason]}</b> · {t.exitReason} <RuleTag rule={t.exitRule} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
