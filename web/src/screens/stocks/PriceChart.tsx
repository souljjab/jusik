import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType, CrosshairMode, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type LogicalRange, type MouseEventParams, type SeriesMarker, type Time,
} from "lightweight-charts";
import type { Region } from "@jusik/shared";
import { CHART_FONT, CHART_LOCALE, useChartColors, type ChartColors } from "../../theme";
import { fmtBig, fmtPrice, kstDate } from "../../ui";
import {
  barLabel, chartSummary, crosshairTime, declutterLabels, INITIAL_BARS, MA_SETS, macdPoints, maPoints, PERIOD_NAME, rsiPoints,
  type Bar, type BarPeriod, type ChartMarker,
} from "./stocksModel";

/*
 * 종목 차트(UI 지도서 5.2 C·D, 8장 차트 상태): 캔들 + 이동평균 + 거래량, 보조 지표 패널(거래량·RSI·MACD).
 * 크로스헤어(마우스 위치의 날짜·가격), 휠 확대, 끌어서 이동은 lightweight-charts 기본 동작을 쓴다.
 * 신호가 난 봉 아래(매도 쪽은 위)에 표식을 달고, 표식을 누르면 onMarker로 그 신호를 알려 준다.
 * 보조 지표 패널 2개 이상은 컴퓨터에서만(지도서 8장) — 패널 구성은 부모가 정한다.
 */

export interface ChartLine {
  price: number;
  title: string;
  kind: "stop" | "target";
}

export interface ChartToggles {
  ma: boolean;
  volume: boolean;
  rsi: boolean;
  macd: boolean;
}

interface Pane {
  chart: IChartApi;
  /** 크로스헤어를 맞출 대표 시리즈와 시각별 값 */
  series: ISeriesApi<"Candlestick" | "Line" | "Histogram">;
  values: Map<string, number>;
}

const priceText = (region: Region) => (p: number) =>
  region === "US" || Math.abs(p) < 100 ? p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(p).toLocaleString("ko-KR");

function options(c: ChartColors, region: Region, period: BarPeriod, showTime: boolean, main: boolean, formatter?: (p: number) => string) {
  const today = kstDate(new Date());
  return {
    autoSize: true,
    // 출처 표시(TradingView 로고)는 가격 패널에 한 번만
    layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text, fontSize: 11, fontFamily: CHART_FONT, attributionLogo: main },
    grid: { vertLines: { visible: false }, horzLines: { color: c.grid, style: LineStyle.Dotted } },
    rightPriceScale: { borderVisible: false, minimumWidth: 72 },
    timeScale: { borderColor: c.grid, rightOffset: 4, visible: showTime, minBarSpacing: 2 },
    crosshair: { mode: CrosshairMode.Normal },
    localization: { locale: CHART_LOCALE, priceFormatter: formatter ?? priceText(region), timeFormatter: (t: Time) => crosshairTime(t, period, today) },
  } as const;
}

/** 거래량 눈금: 1,000만·1.2억처럼 짧게 */
const volText = (p: number) => (p >= 1e4 ? fmtBig(p) : Math.round(p).toLocaleString("ko-KR"));

const hexA = (color: string, alpha: string) => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color);

export function PriceChart({
  bars, period, region, name, toggles, separateVolume, height, markers, selectedId, onMarker, lines,
}: {
  bars: Bar[];
  period: BarPeriod;
  region: Region;
  name: string;
  toggles: ChartToggles;
  /** 거래량을 따로 된 패널로(컴퓨터). 아니면 가격 패널 아래쪽에 겹쳐 그린다 */
  separateVolume: boolean;
  height: number;
  markers: ChartMarker[];
  selectedId: string | null;
  onMarker: (id: string) => void;
  lines: ChartLine[];
}) {
  const colors = useChartColors();
  const mainEl = useRef<HTMLDivElement>(null);
  const volEl = useRef<HTMLDivElement>(null);
  const rsiEl = useRef<HTMLDivElement>(null);
  const macdEl = useRef<HTMLDivElement>(null);
  const api = useRef<{
    main: IChartApi;
    candle: ISeriesApi<"Candlestick">;
    mas: ISeriesApi<"Line">[];
    vol: ISeriesApi<"Histogram"> | null;
    rsi: ISeriesApi<"Line"> | null;
    macd: { hist: ISeriesApi<"Histogram">; line: ISeriesApi<"Line">; signal: ISeriesApi<"Line"> } | null;
    panes: Pane[];
    lines: IPriceLine[];
    key: string;
  } | null>(null);
  const [hover, setHover] = useState<Bar | null>(null);
  const markerRef = useRef({ markers, onMarker });
  markerRef.current = { markers, onMarker };

  const volPane = toggles.volume && separateVolume;
  const paneKey = `${period}|${volPane}|${toggles.rsi}|${toggles.macd}|${region}`;
  const mas = MA_SETS[period];
  const byTime = useMemo(() => new Map(bars.map((b) => [b.time, b])), [bars]);
  const summary = useMemo(() => chartSummary(name, bars, period, (n) => fmtPrice(n, region)), [name, bars, period, region]);
  const byTimeRef = useRef(byTime);
  byTimeRef.current = byTime;

  // 차트 만들기: 기간·패널 구성·색이 바뀔 때만(자동 새로고침은 아래에서 자료만 바꿔 확대 상태를 지킨다)
  useEffect(() => {
    const el = mainEl.current;
    if (!el) return;
    const below = [volPane && volEl.current, toggles.rsi && rsiEl.current, toggles.macd && macdEl.current].filter(Boolean) as HTMLDivElement[];
    const lastEl = below.at(-1) ?? el;
    const make = (node: HTMLDivElement, formatter?: (p: number) => string) => createChart(node, options(colors, region, period, node === lastEl, node === el, formatter));

    const main = make(el);
    const candle = main.addCandlestickSeries({
      upColor: colors.up, downColor: colors.down, borderUpColor: colors.up, borderDownColor: colors.down, wickUpColor: colors.up, wickDownColor: colors.down,
      priceLineVisible: false,
    });
    const maSeries = MA_SETS[period].map((m) =>
      main.addLineSeries({ color: colors[m.color], lineWidth: m.n === 30 && period === "W" ? 2 : 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
    );
    const panes: Pane[] = [{ chart: main, series: candle, values: new Map() }];

    let vol: ISeriesApi<"Histogram"> | null = null;
    if (volPane && volEl.current) {
      const c = make(volEl.current, volText);
      vol = c.addHistogramSeries({ priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
      panes.push({ chart: c, series: vol, values: new Map() });
    } else {
      vol = main.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false });
      main.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
    main.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: volPane ? 0.06 : 0.2 } });

    let rsi: ISeriesApi<"Line"> | null = null;
    if (toggles.rsi && rsiEl.current) {
      const c = make(rsiEl.current, (p) => p.toFixed(0));
      rsi = c.addLineSeries({ color: colors.accent, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 });
      rsi.createPriceLine({ price: 70, color: colors.muted, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      rsi.createPriceLine({ price: 30, color: colors.muted, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      c.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
      panes.push({ chart: c, series: rsi, values: new Map() });
    }
    let macd: { hist: ISeriesApi<"Histogram">; line: ISeriesApi<"Line">; signal: ISeriesApi<"Line"> } | null = null;
    if (toggles.macd && macdEl.current) {
      const c = make(macdEl.current);
      const hist = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
      const line = c.addLineSeries({ color: colors.ma20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const signal = c.addLineSeries({ color: colors.ma5, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      macd = { hist, line, signal };
      panes.push({ chart: c, series: line, values: new Map() });
    }

    // 패널끼리 보이는 범위와 크로스헤어를 맞춘다
    let syncing = false;
    const unsubs: (() => void)[] = [];
    for (const src of panes) {
      const onRange = (r: LogicalRange | null) => {
        if (!r || syncing) return;
        syncing = true;
        panes.forEach((p) => p !== src && p.chart.timeScale().setVisibleLogicalRange(r));
        syncing = false;
      };
      src.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
      const onMove = (param: MouseEventParams) => {
        const t = param.time as string | undefined;
        setHover(t ? (byTimeRef.current.get(t) ?? null) : null);
        for (const p of panes) {
          if (p === src) continue;
          const v = t ? p.values.get(t) : undefined;
          if (t && v != null) p.chart.setCrosshairPosition(v, t as Time, p.series);
          else p.chart.clearCrosshairPosition();
        }
      };
      src.chart.subscribeCrosshairMove(onMove);
      unsubs.push(() => {
        src.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
        src.chart.unsubscribeCrosshairMove(onMove);
      });
    }
    // 표식 누르기: 표식 위면 그 표식, 아니면 같은 봉의 첫 표식
    const onClick = (param: MouseEventParams) => {
      const { markers: ms, onMarker: cb } = markerRef.current;
      const id = typeof param.hoveredObjectId === "string" ? param.hoveredObjectId : null;
      const hit = (id && ms.find((m) => m.id === id)) || (param.time ? ms.find((m) => m.time === param.time) : undefined);
      if (hit) cb(hit.id);
    };
    main.subscribeClick(onClick);
    unsubs.push(() => main.unsubscribeClick(onClick));

    api.current = { main, candle, mas: maSeries, vol, rsi, macd, panes, lines: [], key: "" };
    return () => {
      unsubs.forEach((u) => u());
      api.current = null;
      panes.forEach((p) => p.chart.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, paneKey]);

  // 자료 채우기. 같은 종목·기간에서 자료만 바뀌면(자동 새로고침) 보던 범위를 지킨다
  const dataKey = `${name}|${period}|${bars[0]?.time ?? ""}`;
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.candle.setData(bars.map((b) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
    a.panes[0]!.values = new Map(bars.map((b) => [b.time, b.close]));
    mas.forEach((m, k) => a.mas[k]?.setData(toggles.ma ? maPoints(bars, m.n).map((p) => ({ time: p.time as Time, value: p.value })) : []));
    if (a.vol) {
      const vData = toggles.volume || volPane
        ? bars.map((b, i) => ({ time: b.time as Time, value: b.volume, color: hexA(i > 0 && b.close < bars[i - 1]!.close ? colors.down : colors.up, volPane ? "B3" : "66") }))
        : [];
      a.vol.setData(vData);
      const vp = a.panes.find((p) => p.series === a.vol);
      if (vp) vp.values = new Map(bars.map((b) => [b.time, b.volume]));
    }
    if (a.rsi) {
      const r = rsiPoints(bars);
      a.rsi.setData(r.map((p) => ({ time: p.time as Time, value: p.value })));
      const rp = a.panes.find((p) => p.series === a.rsi);
      if (rp) rp.values = new Map(r.map((p) => [p.time, p.value]));
    }
    if (a.macd) {
      const m = macdPoints(bars);
      a.macd.hist.setData(m.hist.map((p) => ({ time: p.time as Time, value: p.value, color: hexA(p.value >= 0 ? colors.up : colors.down, "99") })));
      a.macd.line.setData(m.macd.map((p) => ({ time: p.time as Time, value: p.value })));
      a.macd.signal.setData(m.signal.map((p) => ({ time: p.time as Time, value: p.value })));
      const mp = a.panes.find((p) => p.series === a.macd!.line);
      if (mp) mp.values = new Map(m.macd.map((p) => [p.time, p.value]));
    }
    if (a.key !== dataKey) {
      const n = bars.length;
      const range = { from: Math.max(0, n - INITIAL_BARS[period]), to: n + 3 } as LogicalRange;
      a.panes.forEach((p) => p.chart.timeScale().setVisibleLogicalRange(range));
      a.key = dataKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, toggles.ma, toggles.volume, colors, paneKey, dataKey]);

  // 신호 표식(선택한 표식은 크게)
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    // 이름표가 겹치면 최근·고른 표식만 이름표를 단다(화살표는 모두 남긴다). 처음 보이는 봉 간격으로 이름표 하나(약 36px)에 드는 봉 수를 잡는다
    const width = mainEl.current?.clientWidth || 400;
    const perBar = Math.max(1, (width - 72) / Math.max(1, Math.min(bars.length, INITIAL_BARS[period])));
    const gap = Math.max(3, Math.ceil(36 / perBar));
    const list: SeriesMarker<Time>[] = declutterLabels(markers, bars, selectedId, gap).map((m) => ({
      time: m.time as Time,
      id: m.id,
      position: m.side === "buy" ? "belowBar" : "aboveBar",
      shape: m.side === "buy" ? "arrowUp" : "arrowDown",
      color: m.side === "buy" ? colors.accent : colors.muted,
      text: m.text,
      size: m.id === selectedId ? 2 : 1,
    }));
    a.candle.setMarkers(list);
  }, [markers, bars, period, selectedId, colors, paneKey, dataKey]);

  // 손절가·목표가 가로선(주문 미리 보기 값)
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.lines.forEach((l) => a.candle.removePriceLine(l));
    a.lines = lines
      .filter((l) => Number.isFinite(l.price) && l.price > 0)
      .map((l) =>
        a.candle.createPriceLine({
          price: l.price, title: l.title, lineWidth: 1, axisLabelVisible: true,
          color: l.kind === "stop" ? colors.warn : colors.muted,
          lineStyle: l.kind === "stop" ? LineStyle.Dashed : LineStyle.Dotted,
        }),
      );
  }, [lines, colors, paneKey, dataKey]);

  const shown = hover ?? bars.at(-1) ?? null;
  const prev = shown ? bars[bars.indexOf(shown) - 1] : undefined;
  const px = (n: number) => fmtPrice(n, region);

  return (
    <figure className="stk-chart">
      <figcaption className="stk-chart-legend">
        {shown && (
          <span className="stk-ohlc num">
            <span className="t-medium">{barLabel(shown.time, period)}</span>
            <span><span className="k">시</span>{px(shown.open)}</span>
            <span><span className="k">고</span>{px(shown.high)}</span>
            <span><span className="k">저</span>{px(shown.low)}</span>
            <span><span className="k">종</span><span className={prev ? (shown.close > prev.close ? "up" : shown.close < prev.close ? "down" : "") : ""}>{px(shown.close)}</span></span>
            <span><span className="k">거래량</span>{fmtBig(shown.volume)}</span>
          </span>
        )}
        {toggles.ma && (
          <span className="stk-keys" aria-label="이동평균">
            {mas.map((m) => (
              <span key={m.n}>
                <i className="stk-key" style={{ background: colors[m.color] }} aria-hidden="true" />
                {m.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <div ref={mainEl} className="stk-chart-main" role="img" aria-label={`${summary}. 차트 아래 신호 목록에서 신호를 고를 수 있어요`} style={{ height }} />
      {volPane && (
        <div className="stk-subpane">
          <span className="stk-subpane-lbl t-cap">거래량</span>
          <div ref={volEl} className="stk-subpane-box" style={{ height: 72 }} aria-hidden="true" />
        </div>
      )}
      {toggles.rsi && (
        <div className="stk-subpane">
          <span className="stk-subpane-lbl t-cap">RSI 14 · 70 과매수 · 30 과매도</span>
          <div ref={rsiEl} className="stk-subpane-box" style={{ height: 96 }} aria-hidden="true" />
        </div>
      )}
      {toggles.macd && (
        <div className="stk-subpane">
          <span className="stk-subpane-lbl t-cap">MACD 12·26·9</span>
          <div ref={macdEl} className="stk-subpane-box" style={{ height: 96 }} aria-hidden="true" />
        </div>
      )}
      <span className="sr-only">{PERIOD_NAME[period]}</span>
    </figure>
  );
}
