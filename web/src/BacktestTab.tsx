import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, createChart, type Time } from "lightweight-charts";
import { DEFAULT_BACKTEST, expectancy, runBacktest, runStageBacktest, type BacktestResult, type Candle } from "@jusik/shared";
import { num, pct, tone, won } from "./format";
import { useChartColors } from "./theme";

function Metric({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="metric">
      <span className="muted small">{label}</span>
      <b className={cls}>{value}</b>
    </div>
  );
}

type Strategy = "stage" | "score";

export function BacktestTab({ candles, indexCandles }: { candles: Candle[]; indexCandles: Candle[] | null }) {
  const colors = useChartColors();
  const [strategy, setStrategy] = useState<Strategy>("stage");
  const [initialCash, setCash] = useState(DEFAULT_BACKTEST.initialCash);
  const [useRegime, setUseRegime] = useState(true);
  const [buy, setBuy] = useState(DEFAULT_BACKTEST.buyThreshold);
  const [sell, setSell] = useState(DEFAULT_BACKTEST.sellThreshold);
  const [stop, setStop] = useState(0);
  const chartEl = useRef<HTMLDivElement>(null);

  const result: BacktestResult | null = useMemo(
    () =>
      strategy === "stage"
        ? runStageBacktest(candles, indexCandles ?? undefined, { initialCash, useRegime })
        : runBacktest(candles, { initialCash, buyThreshold: buy, sellThreshold: sell, stopLossPct: stop / 100 }),
    [strategy, candles, indexCandles, initialCash, useRegime, buy, sell, stop],
  );

  const ev = useMemo(() => {
    if (!result || result.trades.length < 3) return null;
    const w = result.trades.filter((t) => t.returnPct > 0);
    const l = result.trades.filter((t) => t.returnPct <= 0);
    if (!w.length || !l.length) return null;
    const mean = (xs: number[]) => xs.reduce((a, t) => a + t, 0) / xs.length;
    return expectancy({ winRate: w.length / result.trades.length, avgWinPct: mean(w.map((t) => t.returnPct)), avgLossPct: mean(l.map((t) => t.returnPct)) });
  }, [result]);

  useEffect(() => {
    if (!chartEl.current || !result) return;
    const chart = createChart(chartEl.current, {
      height: 280,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: colors.text, fontSize: 12 },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid },
      localization: { priceFormatter: (p: number) => Math.round(p).toLocaleString("ko-KR") },
    });
    chart.addLineSeries({ color: colors.accent, lineWidth: 2, title: "전략" }).setData(result.equity.map((p) => ({ time: p.date as Time, value: p.equity })));
    chart.addLineSeries({ color: colors.muted, lineWidth: 1, title: "단순보유" }).setData(result.equity.map((p) => ({ time: p.date as Time, value: p.buyHold })));
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: chartEl.current!.clientWidth }));
    ro.observe(chartEl.current);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [result, colors]);

  return (
    <div className="card">
      <div className="seg" role="radiogroup" aria-label="전략">
        <button role="radio" aria-checked={strategy === "stage"} className={strategy === "stage" ? "on" : ""} onClick={() => setStrategy("stage")}>주봉 단계 전략 (기본)</button>
        <button role="radio" aria-checked={strategy === "score"} className={strategy === "score" ? "on" : ""} onClick={() => setStrategy("score")}>일봉 점수 전략 (단기)</button>
      </div>
      <p className="muted small">
        {strategy === "stage" ? (
          <>주봉이 마감된 뒤 신호를 갱신하고 <b>다음 거래일 시가</b>에 체결해요. 매수: 2단계 상승 + 과열 아님. 매도: 3단계 이탈·4단계 또는 손절가 이탈(손절가는 최근 8주 저점에서 시작해 올라가기만 해요).</>
        ) : (
          <>일봉 기술 점수가 기준 이상이면 다음 거래일 시가에 매수, 기준 이하면 매도해요.</>
        )}{" "}
        재무 지표는 과거 시점 데이터가 없어 백테스트에 포함하지 않아요.
      </p>
      <div className="form">
        <label>투자금(원)<input type="number" min={100000} step={1000000} value={initialCash} onChange={(e) => setCash(Math.max(100000, +e.target.value || 0))} /></label>
        {strategy === "stage" ? (
          <label className="check">
            <input type="checkbox" checked={useRegime} disabled={!indexCandles} onChange={(e) => setUseRegime(e.target.checked)} />
            지수 약세 국면에서는 매수 안 함{!indexCandles && " (지수 데이터 없음)"}
          </label>
        ) : (
          <>
            <label>매수 기준 점수 ≥<input type="number" min={-100} max={100} value={buy} onChange={(e) => setBuy(+e.target.value)} /></label>
            <label>매도 기준 점수 ≤<input type="number" min={-100} max={100} value={sell} onChange={(e) => setSell(+e.target.value)} /></label>
            <label>손절 %(0=사용 안 함)<input type="number" min={0} max={50} value={stop} onChange={(e) => setStop(Math.max(0, +e.target.value || 0))} /></label>
          </>
        )}
      </div>
      {!result ? (
        <p className="muted">데이터가 부족해서 백테스트를 할 수 없어요.</p>
      ) : (
        <>
          <p className="muted small">수수료 0.015%(매수·매도) + 매도 거래세 0.18% 가정 · {result.equity[0]!.date} ~ {result.equity.at(-1)!.date}</p>
          <div className="metrics">
            <Metric label="전략 수익률" value={pct(result.totalReturnPct)} cls={tone(result.totalReturnPct)} />
            <Metric label="단순 보유 수익률" value={pct(result.buyHoldReturnPct)} cls={tone(result.buyHoldReturnPct)} />
            <Metric label="연환산(CAGR)" value={pct(result.cagrPct)} cls={tone(result.cagrPct)} />
            <Metric label="최대 낙폭(MDD)" value={pct(result.maxDrawdownPct)} cls="down" />
            <Metric label="거래 횟수" value={`${result.tradeCount}회`} />
            <Metric label="승률" value={result.tradeCount ? `${num(result.winRatePct, 0)}%` : "-"} />
            <Metric label="최종 평가금액" value={won(result.finalEquity)} />
            {ev && <Metric label="거래당 기대값" value={pct(ev.expectancyPct)} cls={tone(ev.expectancyPct)} />}
            {ev && <Metric label="손익비(평균이익/손실)" value={ev.payoff ? `${num(ev.payoff, 2)} : 1` : "-"} />}
            {ev && <Metric label="켈리 비중(절반)" value={`${num(ev.kellyPct, 0)}% (${num(ev.halfKellyPct, 0)}%)`} />}
          </div>
          {result.tradeCount < 10 && <p className="warn">거래가 {result.tradeCount}회뿐이라 승률·기대값은 통계로서 의미가 약해요. 여러 종목, 더 긴 기간으로 확인하세요.</p>}
          {result.totalReturnPct < result.buyHoldReturnPct && (
            <p className="warn">이 구간에서는 신호 매매가 단순 보유보다 성과가 낮았어요. 하락 방어(MDD)까지 같이 비교해 보세요.</p>
          )}
          <div ref={chartEl} />
          {result.openPosition && <p className="muted small">※ 마지막 날 기준 보유 중인 포지션이 있어요(거래 내역에는 청산된 거래만 표시).</p>}
          <div className="table-wrap">
            <table className="trades">
              <thead>
                <tr><th>매수일</th><th>매수가</th><th>매도일</th><th>매도가</th><th>수량</th><th>수익률</th><th>사유</th></tr>
              </thead>
              <tbody>
                {[...result.trades].reverse().map((t, i) => (
                  <tr key={i}>
                    <td>{t.buyDate}</td><td>{t.buyPrice.toLocaleString()}</td>
                    <td>{t.sellDate}</td><td>{t.sellPrice.toLocaleString()}</td>
                    <td>{t.shares.toLocaleString()}</td>
                    <td className={tone(t.returnPct)}>{pct(t.returnPct)}</td>
                    <td>{t.reason === "STOP_LOSS" ? "손절" : "신호"}</td>
                  </tr>
                ))}
                {result.trades.length === 0 && <tr><td colSpan={7} className="muted">이 조건에서는 거래가 발생하지 않았어요.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
