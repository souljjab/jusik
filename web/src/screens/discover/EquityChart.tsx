import { useEffect, useRef } from "react";
import { ColorType, LineStyle, createChart, type ISeriesApi, type SeriesMarker, type Time } from "lightweight-charts";
import { CHART_FONT, CHART_LOCALE, useChartColors } from "../../theme";

export interface ChartLine {
  id: string;
  label: string;
  color: string;
  /** 실선(기본)·점선·파선 */
  style?: "solid" | "dotted" | "dashed";
  width?: 1 | 2 | 3;
  data: { date: string; value: number }[];
  markers?: { date: string; color: string }[];
}

const STYLE = { solid: LineStyle.Solid, dotted: LineStyle.Dotted, dashed: LineStyle.Dashed } as const;

/**
 * 자산 곡선 차트(전략·단순 보유·지수). 바탕은 투명, 격자는 가로선만 옅게.
 * 화면 낭독기에는 summary 문장을 읽어 준다(차트에는 요약 문장 — 지도서 10장).
 * hidden에 든 선은 숨기기만 한다(확대 상태 유지).
 */
export function EquityChart({ lines, height = 280, summary, hidden }: { lines: ChartLine[]; height?: number; summary: string; hidden?: ReadonlySet<string> }) {
  const colors = useChartColors();
  const el = useRef<HTMLDivElement>(null);
  const series = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  useEffect(() => {
    const node = el.current;
    if (!node || !lines.length) return;
    const chart = createChart(node, {
      width: node.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: colors.text, fontSize: 11, fontFamily: CHART_FONT },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.grid, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { vertLine: { color: colors.muted, labelBackgroundColor: colors.muted }, horzLine: { color: colors.muted, labelBackgroundColor: colors.muted } },
      localization: {
        locale: CHART_LOCALE,
        priceFormatter: (p: number) => (Math.abs(p) >= 1000 ? Math.round(p).toLocaleString("ko-KR") : p.toFixed(2)),
      },
    });
    const map = new Map<string, ISeriesApi<"Line">>();
    for (const l of lines) {
      const s = chart.addLineSeries({
        color: l.color, lineWidth: l.width ?? 2, lineStyle: STYLE[l.style ?? "solid"], priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerRadius: 3,
      });
      s.setData(l.data.map((p) => ({ time: p.date as Time, value: p.value })));
      if (l.markers?.length) s.setMarkers(l.markers.map((m): SeriesMarker<Time> => ({ time: m.date as Time, position: "aboveBar", shape: "circle", color: m.color, size: 0.6 })));
      map.set(l.id, s);
    }
    series.current = map;
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: node.clientWidth }));
    ro.observe(node);
    return () => {
      ro.disconnect();
      chart.remove();
      series.current = new Map();
    };
  }, [lines, colors, height]);

  useEffect(() => {
    for (const [id, s] of series.current) s.applyOptions({ visible: !hidden?.has(id) });
  }, [hidden, lines, colors]);

  return <div ref={el} className="disc-chart" style={{ height }} role="img" aria-label={summary} />;
}

/** 선 범례. onToggle이 있으면 눌러서 선을 숨기고 보인다 */
export function ChartLegend({ lines, hidden, onToggle }: { lines: Pick<ChartLine, "id" | "label" | "color" | "style">[]; hidden?: ReadonlySet<string>; onToggle?: (id: string) => void }) {
  return (
    <div className="disc-legend" role={onToggle ? "group" : undefined} aria-label={onToggle ? "차트에 표시할 선" : undefined}>
      {lines.map((l) => {
        const sw = <i className={`disc-swatch ${l.style ?? "solid"}`} style={{ borderColor: l.color }} aria-hidden="true" />;
        return onToggle ? (
          <button key={l.id} type="button" className="disc-legend-item" aria-pressed={!hidden?.has(l.id)} onClick={() => onToggle(l.id)}>
            {sw}
            {l.label}
          </button>
        ) : (
          <span key={l.id} className="disc-legend-item">
            {sw}
            {l.label}
          </span>
        );
      })}
    </div>
  );
}
