import { useEffect, useMemo, useRef } from "react";
import { ColorType, createChart, LineStyle, type Time } from "lightweight-charts";
import type { Candle } from "@jusik/shared";
import { CHART_FONT, CHART_LOCALE, useChartColors } from "../../theme";
import { Skeleton } from "../../ui";
import { indexSeries, seriesSummary, type ChartPeriod } from "./homeModel";

/**
 * 지수 종가 + 30주선(같은 기간 이동평균) 작은 선 차트(지도서 그림 4 '코스피 주봉').
 * 장식 없이 두 선만 그리고, 축 글자는 옅게. 끌기·확대는 끈다(홈은 훑어보는 곳).
 */
export function IndexChart({ candles, period, name, height = 180 }: { candles: Candle[] | null | undefined; period: ChartPeriod; name: string; height?: number }) {
  const colors = useChartColors();
  const box = useRef<HTMLDivElement>(null);
  const series = useMemo(() => (candles ? indexSeries(candles, period) : null), [candles, period]);

  useEffect(() => {
    const el = box.current;
    if (!el || !series || series.close.length < 2) return;
    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: colors.text, fontSize: 11, fontFamily: CHART_FONT },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.grid, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { vertLine: { labelVisible: true }, horzLine: { labelVisible: true } },
      handleScroll: false,
      handleScale: false,
      localization: { locale: CHART_LOCALE, priceFormatter: (p: number) => p.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) },
    });
    const close = chart.addLineSeries({ color: colors.text, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 });
    close.setData(series.close.map((p) => ({ time: p.time as Time, value: p.value })));
    const ma = chart.addLineSeries({ color: colors.accent, lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    ma.setData(series.ma.map((p) => ({ time: p.time as Time, value: p.value })));
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
      chart.timeScale().fitContent();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [series, colors, height]);

  if (candles === undefined) return <Skeleton h={height} />;
  if (!series || series.close.length < 2)
    return (
      <div className="home-chart-empty" style={{ height }}>
        <span className="t-2">지수 자료를 받지 못해 차트를 그리지 못했어요. 잠시 뒤 다시 열어 주세요.</span>
      </div>
    );
  return (
    <figure className="home-chart">
      <div ref={box} className="home-chart-box" role="img" aria-label={seriesSummary(name, series, period)} style={{ height }} />
      <figcaption className="home-legend t-cap">
        <span>
          <i className="home-key close" aria-hidden="true" />
          종가
        </span>
        <span>
          <i className="home-key ma" aria-hidden="true" />
          {series.maLabel}
        </span>
      </figcaption>
    </figure>
  );
}
