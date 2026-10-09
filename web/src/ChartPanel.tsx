import { useEffect, useMemo, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type LogicalRange,
  type Time,
} from "lightweight-charts";
import { computeIndicators, type Candle, type Series } from "@jusik/shared";
import { useChartColors, type ChartColors } from "./theme";

const toLine = (candles: Candle[], s: Series) =>
  candles.flatMap((c, i) => (s[i] != null ? [{ time: c.date as Time, value: s[i] as number }] : []));

function baseOptions(c: ChartColors, height: number) {
  return {
    height,
    layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text, fontSize: 12 },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.grid },
    timeScale: { borderColor: c.grid, rightOffset: 4 },
    crosshair: { mode: CrosshairMode.Normal },
    localization: { priceFormatter: (p: number) => (Math.abs(p) >= 1000 ? Math.round(p).toLocaleString("ko-KR") : p.toFixed(2)) },
  } as const;
}

/** 가격(캔들+이동평균+거래량) / RSI / MACD 3개 차트를 만들고 시간축을 동기화한다. */
export function ChartPanel({ candles }: { candles: Candle[] }) {
  const colors = useChartColors();
  const priceEl = useRef<HTMLDivElement>(null);
  const rsiEl = useRef<HTMLDivElement>(null);
  const macdEl = useRef<HTMLDivElement>(null);
  const ind = useMemo(() => computeIndicators(candles), [candles]);

  useEffect(() => {
    if (!priceEl.current || !rsiEl.current || !macdEl.current) return;

    const price = createChart(priceEl.current, baseOptions(colors, 380));
    const candle = price.addCandlestickSeries({
      upColor: colors.up, downColor: colors.down, borderUpColor: colors.up, borderDownColor: colors.down,
      wickUpColor: colors.up, wickDownColor: colors.down,
    });
    candle.setData(candles.map((c) => ({ time: c.date as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    for (const [s, color, title] of [[ind.sma5, colors.ma5, "5"], [ind.sma20, colors.ma20, "20"], [ind.sma60, colors.ma60, "60"]] as const) {
      price.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title }).setData(toLine(candles, s));
    }
    const vol = price.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    price.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(candles.map((c, i) => ({
      time: c.date as Time, value: c.volume,
      color: (i > 0 && c.close < candles[i - 1]!.close ? colors.down : colors.up) + "88",
    })));

    const rsi = createChart(rsiEl.current, baseOptions(colors, 120));
    const rsiLine = rsi.addLineSeries({ color: colors.accent, lineWidth: 2, title: "RSI" });
    rsiLine.setData(toLine(candles, ind.rsi14));
    rsiLine.createPriceLine({ price: 70, color: colors.muted, lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
    rsiLine.createPriceLine({ price: 30, color: colors.muted, lineStyle: 2, lineWidth: 1, axisLabelVisible: false });

    const macd = createChart(macdEl.current, baseOptions(colors, 140));
    const hist = macd.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    hist.setData(ind.macd.hist.flatMap((v, i) => (v != null ? [{ time: candles[i]!.date as Time, value: v, color: v >= 0 ? colors.up : colors.down }] : [])));
    macd.addLineSeries({ color: colors.ma20, lineWidth: 1, title: "MACD", priceLineVisible: false }).setData(toLine(candles, ind.macd.macd));
    macd.addLineSeries({ color: colors.ma5, lineWidth: 1, title: "시그널", priceLineVisible: false }).setData(toLine(candles, ind.macd.signal));

    // 최근 6개월만 먼저 보여준다
    const n = candles.length;
    const initial = { from: Math.max(0, n - 130), to: n + 4 } as LogicalRange;
    const charts: IChartApi[] = [price, rsi, macd];
    charts.forEach((c) => c.timeScale().setVisibleLogicalRange(initial));

    let syncing = false;
    const handlers = charts.map((src) => {
      const h = (range: LogicalRange | null) => {
        if (!range || syncing) return;
        syncing = true;
        charts.forEach((dst) => dst !== src && dst.timeScale().setVisibleLogicalRange(range));
        syncing = false;
      };
      src.timeScale().subscribeVisibleLogicalRangeChange(h);
      return h;
    });

    const els = [priceEl.current, rsiEl.current, macdEl.current];
    const ro = new ResizeObserver(() => charts.forEach((c, i) => c.applyOptions({ width: els[i]!.clientWidth })));
    els.forEach((e) => ro.observe(e));

    return () => {
      ro.disconnect();
      charts.forEach((c, i) => c.timeScale().unsubscribeVisibleLogicalRangeChange(handlers[i]!));
      charts.forEach((c) => c.remove());
    };
  }, [candles, ind, colors]);

  return (
    <div className="charts">
      <div className="legend">
        <span style={{ color: colors.ma5 }}>● 5일</span>
        <span style={{ color: colors.ma20 }}>● 20일</span>
        <span style={{ color: colors.ma60 }}>● 60일</span>
      </div>
      <div ref={priceEl} />
      <div className="subtitle">RSI(14) · 70 이상 과매수 / 30 이하 과매도</div>
      <div ref={rsiEl} />
      <div className="subtitle">MACD(12,26,9)</div>
      <div ref={macdEl} />
    </div>
  );
}
