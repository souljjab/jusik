import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, createChart, LineStyle, type Time } from "lightweight-charts";
import { BREADTH_PARAMS, BREADTH_SERIES_LABEL, type BreadthAnalysis, type BreadthPoint, type BreadthResponse, type Candle } from "@jusik/shared";
import { CHART_FONT, CHART_LOCALE, useChartColors, type ChartColors } from "../../theme";
import { fmtDate, RuleTag, Segmented, Toggle } from "../../ui";
import { BREADTH_LOG_MIN_DAYS } from "./homeModel";

type Kind = "ad" | "mi" | "mc" | "log";
type LogRow = BreadthResponse["log"][number];


const KIND_LABEL: Record<Kind, string> = { ad: "A/D선", mi: "MI(200일)", mc: "맥클렐런(보조)", log: "거래소 A/D" };

/**
 * 쌓아 둔 거래소 전체 등락 종목 수 → 누적 (상승+상한) − (하락+하한). 서버 엑셀 「시장폭」 시트와 같은 식이다.
 * 기록을 시작한 날을 기준으로 누적하므로 높이가 아니라 모양을 본다
 */
export function logAdLine(log: LogRow[]): BreadthPoint[] {
  const rows = [...log].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let acc = 0;
  return rows.map((r) => ({ date: r.date, value: (acc += r.up + r.upperLimit - (r.down + r.lowerLimit)) }));
}

/** A/D선과 같은 기간의 지수 종가(날짜 오름차순·중복 제거) */
function indexPoints(index: Candle[] | null | undefined, from: string, to: string): BreadthPoint[] {
  if (!index?.length) return [];
  const byDate = new Map<string, number>();
  for (const c of index) if (c.date >= from && c.date <= to && Number.isFinite(c.close)) byDate.set(c.date, c.close);
  return [...byDate].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

const fmtAxis = (p: number) => (Math.abs(p) >= 100 ? Math.round(p).toLocaleString("ko-KR") : p.toFixed(1));

function chartOptions(c: ChartColors, width: number, left: boolean) {
  return {
    width,
    height: 240,
    layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text, fontSize: 11, fontFamily: CHART_FONT },
    grid: { vertLines: { visible: false }, horzLines: { color: c.grid, style: LineStyle.Dotted } },
    rightPriceScale: { borderVisible: false },
    leftPriceScale: { visible: left, borderVisible: false },
    timeScale: { borderVisible: false },
    localization: { locale: CHART_LOCALE, priceFormatter: fmtAxis },
  };
}

/** 고른 시리즈의 설명(규칙 출처 포함) */
function Explain({ kind, a, overlay }: { kind: Kind; a: BreadthAnalysis; overlay: boolean }) {
  const P = BREADTH_PARAMS;
  if (kind === "ad")
    return (
      <p className="t-2">
        <RuleTag rule="M1-04 와인스타인" /> 지수는 고점을 높이는데 A/D선은 고점을 낮추면(약세 괴리) 하락장을 먼저 알려 주는 경고예요.
        {overlay ? " 옅은 선이 지수 종가(왼쪽 눈금)예요." : ""} 최근 {P.divRecent}일과 그 앞 {P.divPrior}일의 고점·저점을 지수와 비교해요(기간은 앱 기본값).
        첫 집계일을 0으로 놓고 누적해서 높이보다 모양을 봐요.
        {a.divergence === "BEARISH" && <strong className="warn-text"> 지금 약세 괴리예요.</strong>}
        {a.divergence === "BULLISH" && <strong> 지금 강세 괴리예요(참고만 하고 점수에는 넣지 않아요).</strong>}
      </p>
    );
  if (kind === "mi")
    return (
      <p className="t-2">
        <RuleTag rule="M1-05 와인스타인" /> 순상승 종목 수의 {P.miPeriod}일 합계예요. 0선 위·아래 깊숙이 오래 있다가 0선을 가로지를 때만 신호로 봐요.
        |MI|가 평균 집계 종목 수의 {P.miDeepPct / 100}배 이상인 날이 {P.miMinDeepDays}일 넘게 이어진 뒤 최근 {P.miCrossRecent}일 안에 교차했을 때만 신호로 봐요(앱 기본값).
        {a.miSignal && (
          <strong className={a.miSignal.dir === "DOWN" ? "warn-text" : ""}>
            {" "}
            {fmtDate(a.miSignal.date)}에 0선 {a.miSignal.dir === "UP" ? "위로" : "아래로"} 교차했어요(화살표).
          </strong>
        )}
      </p>
    );
  if (kind === "mc")
    return (
      <p className="t-2">
        책 밖 보조 지표예요. {BREADTH_SERIES_LABEL.mcclellan}. 널리 쓰이는 관례값(EMA {P.mcFast}·{P.mcSlow})으로 계산했고, 국면 점수에는 넣지 않아요.
      </p>
    );
  return (
    <p className="t-2">
      <RuleTag rule="M1-04 와인스타인" /> 네이버 지수 페이지의 그날 등락 종목 수를 하루 한 줄씩 쌓아 그린 거래소 전체 A/D선이에요. 앱이 꺼져 있던 날은 빠지고,
      상한·하한은 상승·하락에 더했어요. 아직 국면 점수에는 쓰지 않아요.
    </p>
  );
}

/**
 * 시장 폭 시계열 차트: A/D선(지수 겹쳐 보기) · MI(0선) · 맥클렐런(책 밖 보조) · 거래소 전체 기록 A/D선.
 * 신고가·신저가는 분석에 일별 기록이 없어 차트 대신 숫자로만 보여 준다
 */
export function BreadthChart({ analysis: a, log, index }: { analysis: BreadthAnalysis; log: LogRow[]; index?: Candle[] | null }) {
  const colors = useChartColors();
  const [pick, setPick] = useState<Kind>("ad");
  const [withIndex, setWithIndex] = useState(true);
  const el = useRef<HTMLDivElement>(null);

  const logLine = useMemo(() => logAdLine(log), [log]);
  const kinds: Kind[] = logLine.length >= BREADTH_LOG_MIN_DAYS ? ["ad", "mi", "mc", "log"] : ["ad", "mi", "mc"];
  const kind: Kind = kinds.includes(pick) ? pick : "ad";
  const data: BreadthPoint[] = kind === "ad" ? a.adLine : kind === "mi" ? a.mi : kind === "mc" ? a.mcclellan : logLine;
  const idxAll = useMemo(() => (a.adLine.length ? indexPoints(index, a.adLine[0]!.date, a.adLine.at(-1)!.date) : []), [index, a.adLine]);
  const overlay = kind === "ad" && withIndex && idxAll.length > 1 ? idxAll : null;
  const lineColor = kind === "ad" ? colors.accent : kind === "mi" ? colors.ma60 : kind === "mc" ? colors.ma5 : colors.ma20;

  useEffect(() => {
    const box = el.current;
    if (!box || data.length === 0) return;
    const chart = createChart(box, chartOptions(colors, box.clientWidth, overlay != null));
    if (overlay) {
      const ix = chart.addLineSeries({ color: colors.muted, lineWidth: 1, priceScaleId: "left", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      ix.setData(overlay.map((p) => ({ time: p.date as Time, value: p.value })));
    }
    const s = chart.addLineSeries({ color: lineColor, lineWidth: 2, priceLineVisible: false });
    s.setData(data.map((p) => ({ time: p.date as Time, value: p.value })));
    if (kind === "mi" || kind === "mc") s.createPriceLine({ price: 0, color: colors.muted, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "0선" });
    const sig = a.miSignal;
    if (kind === "mi" && sig && data.some((p) => p.date === sig.date)) {
      const up = sig.dir === "UP";
      s.setMarkers([{ time: sig.date as Time, position: up ? "belowBar" : "aboveBar", color: colors.accent, shape: up ? "arrowUp" : "arrowDown", text: "0선 교차" }]);
    }
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: box.clientWidth }));
    ro.observe(box);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [kind, data, overlay, colors, lineColor, a.miSignal]);

  const days = a.adLine.length;
  const empty =
    kind === "mi"
      ? `MI는 ${BREADTH_PARAMS.miPeriod}거래일 합계라 집계일이 더 필요해요(지금 ${days}일).`
      : kind === "mc"
        ? "맥클렐런 오실레이터를 계산할 집계일이 모자라요."
        : kind === "log"
          ? "거래소 전체 기록이 아직 없어요."
          : "A/D선을 그릴 집계일이 없어요.";
  const label = kind === "ad" ? BREADTH_SERIES_LABEL.adLine : kind === "mi" ? BREADTH_SERIES_LABEL.mi : kind === "mc" ? BREADTH_SERIES_LABEL.mcclellan : `거래소 전체 A/D선(기록 ${logLine.length}일)`;
  const last = data.at(-1);

  return (
    <div className="home-bchart">
      <div className="home-bchart-bar">
        <Segmented label="시장 폭 차트" size="sm" value={kind} onChange={setPick} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        {kind === "ad" && idxAll.length > 1 && <Toggle checked={withIndex} onChange={setWithIndex} label="지수 함께 보기" />}
      </div>
      {data.length === 0 ? (
        <div className="home-chart-empty" style={{ height: 120 }}>
          <span className="t-2">{empty}</span>
        </div>
      ) : (
        <figure className="home-chart">
          <div
            ref={el}
            className="home-chart-box"
            style={{ height: 240 }}
            role="img"
            aria-label={`${label} 차트, ${fmtDate(data[0]!.date)}부터 ${fmtDate(last!.date)}까지, 마지막 값 ${fmtAxis(last!.value)}`}
          />
          <figcaption className="home-legend t-cap">
            <span>
              <i className="home-key" style={{ background: lineColor }} aria-hidden="true" />
              {label}
            </span>
            {overlay && (
              <span>
                <i className="home-key" style={{ background: colors.muted }} aria-hidden="true" />
                지수 종가(왼쪽 눈금)
              </span>
            )}
            <span className="num">
              {fmtDate(data[0]!.date)} ~ {fmtDate(last!.date)}
            </span>
          </figcaption>
        </figure>
      )}
      {kind === "ad" && index === null && <p className="t-cap">지수 일봉을 받지 못해 A/D선만 그렸어요.</p>}
      <Explain kind={kind} a={a} overlay={overlay != null} />
    </div>
  );
}
