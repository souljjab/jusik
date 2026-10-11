import { useEffect, useMemo, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type LineData,
  type LineWidth,
  type Time,
  type WhitespaceData,
} from "lightweight-charts";
import { PER_BAND_PARAMS, type BandLevel, type Candle, type PerBand, type Region } from "@jusik/shared";
import { num } from "./format";
import { useChartColors, type ChartColors } from "./theme";
import "./styles/valuation.css";

/** 범례·통계 표시 순서(비싼 쪽 → 싼 쪽, 차트 위 → 아래와 같다) */
export const BAND_LEVELS: readonly BandLevel[] = ["max", "p80", "median", "p20", "min"];

/** 밴드 이름. 하단·상단 숫자는 PER을 낮은 순으로 세웠을 때의 위치(백분위) */
export function bandLevelLabel(level: BandLevel): string {
  const P = PER_BAND_PARAMS;
  return { min: "최저", p20: `하단 ${P.lowPct}%`, median: "중앙", p80: `상단 ${P.highPct}%`, max: "최고" }[level];
}

/** 싼 쪽은 차가운 색, 비싼 쪽은 따뜻한 색. 종가(글자색)와 겹치지 않는 테마 색만 쓴다 */
export function bandColor(c: ChartColors, level: BandLevel): string {
  return { min: c.down, p20: c.ma20, median: c.ma60, p80: c.ma5, max: c.up }[level];
}

type Dash = "solid" | "dashed" | "dotted";
const BAND_LINE: Record<BandLevel, { dash: Dash; width: LineWidth }> = {
  min: { dash: "dotted", width: 2 },
  p20: { dash: "solid", width: 1 },
  median: { dash: "dashed", width: 1 },
  p80: { dash: "solid", width: 1 },
  max: { dash: "dotted", width: 2 },
};
const LINE_STYLE: Record<Dash, LineStyle> = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted };

/** 범례·통계 칸에서 같이 쓰는 선 견본 */
export function BandSwatch({ level, colors }: { level: BandLevel; colors: ChartColors }) {
  return <i className={`va-swatch va-swatch-${BAND_LINE[level].dash}`} style={{ borderColor: bandColor(colors, level) }} aria-hidden />;
}

function chartOptions(c: ChartColors, region: Region) {
  return {
    height: 260,
    layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text, fontSize: 12 },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.grid },
    timeScale: { borderColor: c.grid },
    crosshair: { mode: CrosshairMode.Normal },
    localization: {
      priceFormatter: (p: number) => (region === "US" || Math.abs(p) < 1000 ? p.toFixed(2) : Math.round(p).toLocaleString("ko-KR")),
    },
  } as const;
}

/**
 * PER 밴드 차트: 밴드 기간의 종가와 밴드선(그날 EPS × 기간 PER 배수).
 * EPS가 0 이하이거나 없는 날은 밴드선을 끊는다(빈 점).
 */
export function PerBandChart({ candles, band, region }: { candles: Candle[]; band: PerBand; region: Region }) {
  const colors = useChartColors();
  const el = useRef<HTMLDivElement>(null);
  const { from, to } = band;
  const win = useMemo(() => (from && to ? candles.filter((c) => c.date >= from && c.date <= to) : []), [candles, from, to]);
  const lines = useMemo(
    () => BAND_LEVELS.flatMap((level) => band.bands.filter((b) => b.level === level)),
    [band.bands],
  );

  useEffect(() => {
    const node = el.current;
    if (!node || !win.length || !lines.length) return;
    const chart = createChart(node, chartOptions(colors, region));
    for (const b of lines) {
      const byDate = new Map(b.points.map((p) => [p.date, p.price]));
      const data: (LineData | WhitespaceData)[] = win.map((c) => {
        const v = byDate.get(c.date);
        return v == null ? { time: c.date as Time } : { time: c.date as Time, value: v };
      });
      const st = BAND_LINE[b.level];
      chart
        .addLineSeries({
          color: bandColor(colors, b.level),
          lineWidth: st.width,
          lineStyle: LINE_STYLE[st.dash],
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        .setData(data);
    }
    chart
      .addLineSeries({ color: colors.text, lineWidth: 2, priceLineVisible: false })
      .setData(win.map((c) => ({ time: c.date as Time, value: c.close })));
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: node.clientWidth }));
    ro.observe(node);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [win, lines, colors, region]);

  if (!win.length || !lines.length) return null;
  return (
    <div className="va-chart">
      <div className="va-legend" role="list" aria-label="차트 범례">
        <span role="listitem">
          <i className="va-swatch va-swatch-solid va-swatch-thick" style={{ borderColor: colors.text }} aria-hidden />
          종가
        </span>
        {lines.map((b) => (
          <span role="listitem" key={b.level}>
            <BandSwatch level={b.level} colors={colors} />
            {bandLevelLabel(b.level)} {num(b.multiple, 1)}배
          </span>
        ))}
      </div>
      <div ref={el} className="va-chart-box" />
      <p className="va-caption">
        밴드선은 그날까지 공시된 최근 12개월 EPS에 기간 PER 배수를 곱한 가격이에요. 배수는 유효숫자 두 자리로 반올림했고, EPS가 0 이하인 날은 선을 끊어요.
      </p>
    </div>
  );
}
