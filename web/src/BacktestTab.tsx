import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, createChart, type Time } from "lightweight-charts";
import { DEFAULT_BACKTEST, runBacktest, type Candle } from "@jusik/shared";
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

export function BacktestTab({ candles }: { candles: Candle[] }) {
  const colors = useChartColors();
  const [initialCash, setCash] = useState(DEFAULT_BACKTEST.initialCash);
  const [buy, setBuy] = useState(DEFAULT_BACKTEST.buyThreshold);
  const [sell, setSell] = useState(DEFAULT_BACKTEST.sellThreshold);
  const [stop, setStop] = useState(0);
  const chartEl = useRef<HTMLDivElement>(null);

  const result = useMemo(
    () => runBacktest(candles, { initialCash, buyThreshold: buy, sellThreshold: sell, stopLossPct: stop / 100 }),
    [candles, initialCash, buy, sell, stop],
  );

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
      <p className="muted small">
        기술적 점수 신호를 과거에 그대로 적용해 본 결과예요. 신호는 당일 종가로 계산하고 <b>다음 거래일 시가</b>에 체결한다고 가정해요.
        재무 지표는 과거 시점 데이터가 없어 백테스트에 포함하지 않아요.
      </p>
      <div className="form">
        <label>투자금(원)<input type="number" min={100000} step={1000000} value={initialCash} onChange={(e) => setCash(Math.max(100000, +e.target.value || 0))} /></label>
        <label>매수 기준 점수 ≥<input type="number" min={-100} max={100} value={buy} onChange={(e) => setBuy(+e.target.value)} /></label>
        <label>매도 기준 점수 ≤<input type="number" min={-100} max={100} value={sell} onChange={(e) => setSell(+e.target.value)} /></label>
        <label>손절 %(0=사용 안 함)<input type="number" min={0} max={50} value={stop} onChange={(e) => setStop(Math.max(0, +e.target.value || 0))} /></label>
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
          </div>
          {result.totalReturnPct < result.buyHoldReturnPct && (
            <p className="warn">이 구간에서는 신호 매매가 단순 보유보다 성과가 낮았어요. 신호를 그대로 믿기보다 참고용으로만 보세요.</p>
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
