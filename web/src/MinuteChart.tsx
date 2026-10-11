import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { aggregateBars, INTRADAY_SESSIONS, smaOf, type IntradayBar, type Region } from "@jusik/shared";
import { useChartColors, type ChartColors, CHART_LOCALE } from "./theme";
import "./styles/minute.css";

/** 차트에 가로선으로 그릴 가격(판단 결과에서 온 값만) */
export interface MinuteLevel {
  price: number;
  title: string;
  kind: "split" | "stop";
}

const NO_LEVELS: MinuteLevel[] = [];

type Frame = 1 | 3;
const FRAMES: [Frame, string][] = [
  [1, "1분봉"],
  [3, "3분봉"],
];

/** 'N분선' = 그 분봉 차트의 N봉 단순이동평균. 1분봉은 20분선, 3분봉은 5·10·20분선 */
const MAS: Record<Frame, { period: number; color: keyof ChartColors }[]> = {
  1: [{ period: 20, color: "ma20" }],
  3: [
    { period: 5, color: "ma5" },
    { period: 10, color: "ma60" },
    { period: 20, color: "ma20" },
  ],
};

/** 거래소 현지 시각 'YYYY-MM-DDTHH:mm'을 UTC처럼 읽어 차트 눈금이 현지 시각으로 보이게 한다 */
const toTs = (t: string) => Date.parse(`${t}:00Z`) / 1000;
const hhmm = (time: Time) => (typeof time === "number" ? new Date(time * 1000).toISOString().slice(11, 16) : String(time));

/** 시간순 정렬 + 같은 시각 중복 제거(차트는 시각이 엄격히 증가해야 한다) */
function cleanBars(bars: IntradayBar[]): IntradayBar[] {
  const sorted = bars.filter((b) => Number.isFinite(toTs(b.t))).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return sorted.filter((b, i) => i === sorted.length - 1 || sorted[i + 1]!.t !== b.t);
}

/** 가격 눈금: 국내는 원 단위 정수, 미국은 달러 소수 둘째 자리 */
const priceText = (region: Region) => (p: number) =>
  region === "KR" ? Math.round(p).toLocaleString("ko-KR") : p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Chart {
  chart: IChartApi;
  candle: ISeriesApi<"Candlestick">;
  vol: ISeriesApi<"Histogram">;
  mas: ISeriesApi<"Line">[];
  lines: IPriceLine[];
  /** 마지막으로 그린 봉 수와 첫 봉 시각(세션이 바뀌면 다시 맞춘다) */
  count: number;
  first: string | null;
}

const time = (b: IntradayBar) => toTs(b.t) as UTCTimestamp;

/** 캔들·거래량·N봉 평균선 데이터를 채운다 */
function draw(a: Chart, shown: IntradayBar[], frame: Frame, colors: ChartColors) {
  a.candle.setData(shown.map((b) => ({ time: time(b), open: b.open, high: b.high, low: b.low, close: b.close })));
  a.vol.setData(shown.map((b) => ({ time: time(b), value: b.volume, color: (b.close >= b.open ? colors.up : colors.down) + "88" })));
  const closes = shown.map((b) => b.close);
  MAS[frame].forEach(({ period }, k) => {
    a.mas[k]?.setData(
      shown.flatMap((b, i) => {
        const v = smaOf(closes, period, i + 1);
        return v == null ? [] : [{ time: time(b), value: v }];
      }),
    );
  });
}

/** 1분봉(또는 합친 3분봉) 캔들 + N봉 평균선 + 거래량. levels는 분할 매수가·손절 기준가 가로선 */
export function MinuteChart({ bars, region, levels = NO_LEVELS }: { bars: IntradayBar[]; region: Region; levels?: MinuteLevel[] }) {
  const colors = useChartColors();
  const [frame, setFrame] = useState<Frame>(1);
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Chart | null>(null);

  const shown = useMemo(() => {
    const clean = cleanBars(bars);
    return frame === 1 ? clean : aggregateBars(clean, 3, INTRADAY_SESSIONS[region].open);
  }, [bars, frame, region]);
  const hasBars = shown.length > 0;

  // 차트 만들기(색·봉 종류가 바뀔 때만 새로 만든다. 30초 새로고침은 아래에서 데이터만 바꿔 확대 상태를 지킨다)
  useEffect(() => {
    const box = el.current;
    if (!box || !hasBars) return;
    const chart = createChart(box, {
      width: box.clientWidth,
      height: 340,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: colors.text, fontSize: 12 },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid, rightOffset: 3, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: CHART_LOCALE, priceFormatter: priceText(region), timeFormatter: hhmm },
    });
    const candle = chart.addCandlestickSeries({
      upColor: colors.up, downColor: colors.down, borderUpColor: colors.up, borderDownColor: colors.down,
      wickUpColor: colors.up, wickDownColor: colors.down,
    });
    const mas = MAS[frame].map(({ period, color }) =>
      chart.addLineSeries({ color: colors[color], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: `${period}` }),
    );
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    api.current = { chart, candle, vol, mas, lines: [], count: 0, first: null };

    const ro = new ResizeObserver(() => chart.applyOptions({ width: box.clientWidth }));
    ro.observe(box);
    return () => {
      ro.disconnect();
      api.current = null;
      chart.remove();
    };
  }, [colors, frame, hasBars, region]);

  // 데이터·가로선 반영. 새로고침 때는 보던 범위를 지키되, 전체를 보고 있었으면 다시 전체를, 오른쪽 끝을 보고 있었으면 최신 봉을 따라간다
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const ts = a.chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    const fresh = a.first !== (shown[0]?.t ?? null);
    const sawAll = fresh || (r != null && r.from <= 0.5 && r.to >= a.count - 1.5);
    const atEdge = r != null && r.to >= a.count - 1.5;
    draw(a, shown, frame, colors);
    if (shown.length && sawAll) ts.fitContent();
    else if (shown.length && atEdge) ts.scrollToRealTime();
    a.count = shown.length;
    a.first = shown[0]?.t ?? null;
  }, [shown, colors, frame, hasBars, region]);

  // 분할 매수가·손절 기준가 가로선
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.lines.forEach((l) => a.candle.removePriceLine(l));
    a.lines = levels
      .filter((l) => Number.isFinite(l.price) && l.price > 0)
      .map((l) =>
        a.candle.createPriceLine({
          price: l.price,
          title: l.title,
          color: l.kind === "stop" ? colors.down : colors.accent,
          lineWidth: 1,
          lineStyle: l.kind === "stop" ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
        }),
      );
  }, [levels, colors, frame, hasBars, region]);

  const hasSplit = levels.some((l) => l.kind === "split");
  const hasStop = levels.some((l) => l.kind === "stop");

  return (
    <div className="mn-chart">
      <div className="mn-chart-bar">
        <div className="seg" role="radiogroup" aria-label="분봉 종류">
          {FRAMES.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={frame === k} className={frame === k ? "on" : ""} onClick={() => setFrame(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="legend mn-legend">
          {MAS[frame].map(({ period, color }) => (
            <span key={period} style={{ color: colors[color] }}>● {period}분선</span>
          ))}
          {hasSplit && <span style={{ color: colors.accent }}>┅ 분할 매수가</span>}
          {hasStop && <span style={{ color: colors.down }}>━ 손절 기준가</span>}
        </div>
      </div>
      {hasBars ? <div ref={el} className="mn-chart-box" /> : <p className="muted small">표시할 분봉이 없어요.</p>}
      {hasBars && (
        <p className="mn-caption">
          시각은 거래소 현지 시각이에요. {frame === 1 ? "20분선 = 1분봉 20개 평균" : "5·10·20분선 = 3분봉 5·10·20개 평균"}이고, 차트의 평균선은 오늘 봉으로만
          계산해서 장 초반에는 판단 값(전일 분봉부터 이어 계산)과 다를 수 있어요.
          {frame === 3 && " 마지막 3분봉은 아직 진행 중일 수 있어요(판단은 완성된 봉만 써요)."}
        </p>
      )}
    </div>
  );
}
