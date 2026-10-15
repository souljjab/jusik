import { useMemo, useState, type ReactNode } from "react";
import { marketSession, regionOf } from "@jusik/shared";
import type { StockData } from "../../api";
import { useApp } from "../../app/AppContext";
import { Chip, fmtAsOf, fmtDate, kstDate, Segmented, type Breakpoint } from "../../ui";
import { MinuteView } from "./MinuteView";
import { PriceChart, type ChartLine, type ChartToggles } from "./PriceChart";
import { SignalList } from "./SignalList";
import { chartMarkers, marksForPeriod, PERIOD_LABEL, sortMarksDesc, toBars, type Period } from "./stocksModel";
import type { Signals } from "./useSignals";

/*
 * 기간과 지표(지도서 5.2 C) + 차트 + 신호 표식(D) + 신호 목록 + 시세 기준 시각.
 * 기간: 분·일·주·월(키 1·2·3 = 일·주·월은 화면이 단다). 지표: 이동평균·거래량·RSI·MACD 켜고 끄기.
 * 보조 지표 패널 2개 이상은 컴퓨터에서만 — 그보다 좁으면 거래량은 가격 패널에 겹치고 RSI·MACD는 하나만 연다.
 */

const TOGGLE_KEY = "jusik.stocks.chart.v1";
/** 차트 켜고 끄기: 지표 + 일봉 보조 신호 표식(자주 나와 기본은 끈다) */
type Toggles = ChartToggles & { daily: boolean };
function loadToggles(large: boolean): Toggles {
  const base: Toggles = { ma: true, volume: true, rsi: large, macd: false, daily: false };
  try {
    const raw = JSON.parse(localStorage.getItem(TOGGLE_KEY) ?? "null") as Partial<Toggles> | null;
    return raw && typeof raw === "object" ? { ...base, ...raw } : base;
  } catch {
    return base;
  }
}
function saveToggles(t: Toggles) {
  try {
    localStorage.setItem(TOGGLE_KEY, JSON.stringify(t));
  } catch {
    /* 저장할 수 없으면 이번 실행에서만 */
  }
}

export function ChartArea({ data, at, period, onPeriod, signals, onSelect, lines, bp, height, afterChart }: {
  data: StockData;
  at: number | null;
  period: Period;
  onPeriod: (p: Period) => void;
  signals: Signals;
  /** 신호를 골랐을 때(오른쪽 패널을 근거 탭으로 바꾸는 일은 부모가) */
  onSelect: (id: string) => void;
  lines: ChartLine[];
  bp: Breakpoint;
  height: number;
  /** 차트 바로 아래에 둘 내용(태블릿 가로: 신호 근거 D와 포지션 계산 E) */
  afterChart?: ReactNode;
}) {
  const large = bp === "large";
  const region = regionOf(data.info.market);
  const { now } = useApp();
  const [toggles, setToggles] = useState<Toggles>(() => loadToggles(large));
  // 컴퓨터가 아니면 보조 지표 패널은 하나만(RSI가 우선)
  const effective: ChartToggles = large ? toggles : { ...toggles, macd: toggles.macd && !toggles.rsi };
  const set = (k: keyof Toggles) => {
    const next = { ...toggles, [k]: !toggles[k] };
    if (!large && next[k] && (k === "rsi" || k === "macd")) next[k === "rsi" ? "macd" : "rsi"] = false;
    setToggles(next);
    saveToggles(next);
  };

  const barPeriod = period === "m" ? "D" : period;
  const bars = useMemo(() => toBars(data.candles, barPeriod), [data.candles, barPeriod]);
  // 일봉 보조 신호는 자주 나와서 '일봉 신호'를 켰을 때만 표식·목록에 넣는다(지금 고른 신호는 늘 보인다)
  const visible = useMemo(
    () => signals.marks.filter((m) => m.kind !== "daily" || toggles.daily || m.id === signals.selectedId),
    [signals.marks, toggles.daily, signals.selectedId],
  );
  const markers = useMemo(() => chartMarkers(visible, bars, barPeriod), [visible, bars, barPeriod]);
  const marks = useMemo(() => sortMarksDesc(marksForPeriod(visible, barPeriod)), [visible, barPeriod]);
  const today = kstDate(now);
  const open = marketSession(region, now).state === "open";
  const last = data.candles.at(-1);

  return (
    <section className="stk-chartarea" aria-label="차트">
      <div className="stk-chart-bar">
        <Segmented
          label="차트 기간"
          size="sm"
          value={period}
          onChange={onPeriod}
          options={(["m", "D", "W", "M"] as const).map((v) => ({ value: v, label: PERIOD_LABEL[v] }))}
        />
        {period !== "m" && (
          <div className="stk-toggles" role="group" aria-label="지표 켜고 끄기">
            <Chip pressed={toggles.ma} onClick={() => set("ma")}>이동평균</Chip>
            <Chip pressed={toggles.volume} onClick={() => set("volume")}>거래량</Chip>
            <Chip pressed={effective.rsi} onClick={() => set("rsi")}>RSI</Chip>
            <Chip pressed={effective.macd} onClick={() => set("macd")}>MACD</Chip>
            {period === "D" && (
              <Chip pressed={toggles.daily} onClick={() => set("daily")}>
                일봉 신호
              </Chip>
            )}
          </div>
        )}
      </div>

      {period === "m" ? (
        <>
          <MinuteView code={data.info.code} region={region} height={height} />
          {afterChart}
        </>
      ) : (
        <>
          <PriceChart
            bars={bars}
            period={barPeriod}
            region={region}
            name={data.info.name}
            toggles={effective}
            separateVolume={large}
            height={height}
            markers={markers}
            selectedId={signals.selectedId}
            onMarker={onSelect}
            lines={lines}
          />
          <p className="t-cap stk-asof">
            {open ? `시세 ${at ? fmtAsOf(at) : "-"}` : `시세 ${last ? fmtDate(last.date) : "-"} 종가 기준`}
            {open && last ? ` · 일봉 ${fmtDate(last.date)}` : ""} · 주봉 신호는 마감된 주 기준이에요
          </p>
          {afterChart}
          <SignalList signals={signals} marks={marks} today={today} wide={bp === "large" || bp === "expanded"} onSelect={onSelect} />
          {period === "D" && !toggles.daily && bp !== "compact" && <p className="t-cap">일봉 보조 신호(골든크로스·5일선 이탈 등)는 자주 나와서 '일봉 신호'를 켜면 표시해요.</p>}
        </>
      )}
    </section>
  );
}
