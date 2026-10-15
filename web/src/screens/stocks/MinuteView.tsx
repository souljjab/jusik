import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ColorType, CrosshairMode, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import {
  aggregateBars, INTRADAY_PARAMS, INTRADAY_SESSIONS, marketClock, smaOf,
  type IntradayAssessment, type IntradayBar, type IntradayVerdict, type MinuteResponse, type Note, type Region,
} from "@jusik/shared";
import { getMinute } from "../../api";
import { CHART_FONT, CHART_LOCALE, useChartColors, type ChartColors } from "../../theme";
import { Button, Change, EvidenceStrip, fmtDate, fmtPrice, Notice, NoteList, Segmented, Skeleton, Stat, Stats } from "../../ui";
import { minuteEvidence } from "./stocksModel";

/*
 * 분봉(1분봉·3분봉)과 강창권 장중 타점 판단(자료집 4.7·M3-18). 예전 분봉 탭을 종목 차트의 '분' 기간으로 옮겼다.
 * 그 시장 정규장이 열려 있고 화면이 보이는 동안만 30초마다 다시 받는다.
 */

const REFRESH_MS = 30_000;
const RULE = "4.7·M3-18 강창권";
const TZ_LABEL: Record<Region, string> = { KR: "한국 시각", US: "뉴욕 현지 시각" };

const VERDICT: Record<IntradayVerdict, { label: string; help: string }> = {
  buy: { label: "매수 가능", help: "규칙상 매수 조건을 갖췄다는 뜻이에요. 수익을 보장하지 않아요." },
  wait: { label: "대기", help: "아직 규칙상 매수 자리가 아니에요. 조건이 갖춰질 때까지 기다려요." },
  avoid: { label: "피하기", help: "규칙상 오늘은 사지 않는 자리예요." },
};

const isOpenNow = (region: Region) => marketClock(region, new Date()).isOpen;
const elapsed = (m: number) => (m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`);
const clockText = (ms: number) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);

// ───────── 차트 ─────────

type Frame = 1 | 3;
const MAS: Record<Frame, { period: number; color: keyof ChartColors }[]> = {
  1: [{ period: 20, color: "ma20" }],
  3: [
    { period: 5, color: "ma5" },
    { period: 10, color: "ma60" },
    { period: 20, color: "ma20" },
  ],
};

export interface MinuteLevel {
  price: number;
  title: string;
  kind: "split" | "stop";
}

/** 거래소 현지 시각 'YYYY-MM-DDTHH:mm'을 UTC처럼 읽어 눈금이 현지 시각으로 보이게 한다 */
const toTs = (t: string) => Date.parse(`${t}:00Z`) / 1000;
const hhmm = (time: Time) => (typeof time === "number" ? new Date(time * 1000).toISOString().slice(11, 16) : String(time));
const ts = (b: IntradayBar) => toTs(b.t) as UTCTimestamp;

function cleanBars(bars: IntradayBar[]): IntradayBar[] {
  const sorted = bars.filter((b) => Number.isFinite(toTs(b.t))).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return sorted.filter((b, i) => i === sorted.length - 1 || sorted[i + 1]!.t !== b.t);
}
const priceText = (region: Region) => (p: number) =>
  region === "KR" ? Math.round(p).toLocaleString("ko-KR") : p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hexA = (color: string, alpha: string) => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color);

function MinuteChart({ bars, region, levels, height }: { bars: IntradayBar[]; region: Region; levels: MinuteLevel[]; height: number }) {
  const colors = useChartColors();
  const [frame, setFrame] = useState<Frame>(1);
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{ chart: IChartApi; candle: ISeriesApi<"Candlestick">; vol: ISeriesApi<"Histogram">; mas: ISeriesApi<"Line">[]; lines: IPriceLine[]; count: number; first: string | null } | null>(null);
  const shown = useMemo(() => {
    const c = cleanBars(bars);
    return frame === 1 ? c : aggregateBars(c, 3, INTRADAY_SESSIONS[region].open);
  }, [bars, frame, region]);
  const has = shown.length > 0;

  useEffect(() => {
    const box = el.current;
    if (!box || !has) return;
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: colors.text, fontSize: 11, fontFamily: CHART_FONT },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.grid, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false, minimumWidth: 72 },
      timeScale: { borderColor: colors.grid, rightOffset: 3, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: CHART_LOCALE, priceFormatter: priceText(region), timeFormatter: hhmm },
    });
    const candle = chart.addCandlestickSeries({
      upColor: colors.up, downColor: colors.down, borderUpColor: colors.up, borderDownColor: colors.down, wickUpColor: colors.up, wickDownColor: colors.down,
    });
    const mas = MAS[frame].map(({ color }) => chart.addLineSeries({ color: colors[color], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }));
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    api.current = { chart, candle, vol, mas, lines: [], count: 0, first: null };
    return () => {
      api.current = null;
      chart.remove();
    };
  }, [colors, frame, has, region]);

  // 자료: 새로고침 때 보던 범위를 지키고, 전체를 보고 있었으면 다시 전체, 오른쪽 끝이면 최신 봉을 따라간다
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const t = a.chart.timeScale();
    const r = t.getVisibleLogicalRange();
    const fresh = a.first !== (shown[0]?.t ?? null);
    const sawAll = fresh || (r != null && r.from <= 0.5 && r.to >= a.count - 1.5);
    const atEdge = r != null && r.to >= a.count - 1.5;
    a.candle.setData(shown.map((b) => ({ time: ts(b), open: b.open, high: b.high, low: b.low, close: b.close })));
    a.vol.setData(shown.map((b) => ({ time: ts(b), value: b.volume, color: hexA(b.close >= b.open ? colors.up : colors.down, "66") })));
    const closes = shown.map((b) => b.close);
    MAS[frame].forEach(({ period }, k) =>
      a.mas[k]?.setData(shown.flatMap((b, i) => {
        const v = smaOf(closes, period, i + 1);
        return v == null ? [] : [{ time: ts(b), value: v }];
      })),
    );
    if (shown.length && sawAll) t.fitContent();
    else if (shown.length && atEdge) t.scrollToRealTime();
    a.count = shown.length;
    a.first = shown[0]?.t ?? null;
  }, [shown, colors, frame, has, region]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.lines.forEach((l) => a.candle.removePriceLine(l));
    a.lines = levels
      .filter((l) => Number.isFinite(l.price) && l.price > 0)
      .map((l) =>
        a.candle.createPriceLine({
          price: l.price, title: l.title, lineWidth: 1, axisLabelVisible: true,
          color: l.kind === "stop" ? colors.warn : colors.accent,
          lineStyle: l.kind === "stop" ? LineStyle.Solid : LineStyle.Dashed,
        }),
      );
  }, [levels, colors, frame, has, region]);

  return (
    <div className="stack">
      <div className="row between wrap">
        <Segmented
          label="분봉 종류"
          size="sm"
          value={String(frame) as "1" | "3"}
          onChange={(v) => setFrame(Number(v) as Frame)}
          options={[{ value: "1", label: "1분봉" }, { value: "3", label: "3분봉" }]}
        />
        <span className="stk-keys t-cap">
          {MAS[frame].map(({ period, color }) => (
            <span key={period}>
              <i className="stk-key" style={{ background: colors[color] }} aria-hidden="true" />
              {period}분선
            </span>
          ))}
          {levels.some((l) => l.kind === "split") && (
            <span>
              <i className="stk-key dashed" style={{ borderColor: colors.accent }} aria-hidden="true" />
              분할 매수가
            </span>
          )}
          {levels.some((l) => l.kind === "stop") && (
            <span>
              <i className="stk-key" style={{ background: colors.warn }} aria-hidden="true" />
              손절 기준가
            </span>
          )}
        </span>
      </div>
      {has ? (
        <div ref={el} className="stk-chart-main" style={{ height }} role="img" aria-label={`${frame}분봉 차트, 봉 ${shown.length}개, 마지막 종가 ${priceText(region)(shown.at(-1)!.close)}`} />
      ) : (
        <div className="stk-chart-empty" style={{ height: Math.min(height, 200) }}>
          <span className="t-2">표시할 분봉이 없어요.</span>
        </div>
      )}
      {has && (
        <p className="t-cap">
          시각은 거래소 현지 시각이에요. {frame === 1 ? "20분선 = 1분봉 20개 평균" : "5·10·20분선 = 3분봉 5·10·20개 평균"}이고, 차트 평균선은 오늘 봉으로만 계산해서 장 초반에는 판단 값(전일 분봉부터 이어 계산)과 다를 수 있어요.
          {frame === 3 && " 마지막 3분봉은 아직 진행 중일 수 있어요(판단은 완성된 봉만 써요)."}
        </p>
      )}
    </div>
  );
}

// ───────── 판단 ─────────

/** 분할 매수가 이름: 3분봉 첫 캔들이 양봉이면 종가 기준 1/3선이 몸통 중심선보다 높고, 음봉이면 반대 */
function splitLabels(prices: number[], bars: IntradayBar[], region: Region): string[] {
  const open = INTRADAY_SESSIONS[region].open;
  const first = aggregateBars(bars, 3, open)[0];
  const firstOk = first && first.t.slice(11) === open;
  if (prices.length === 1) return ["몸통 중심선(=1/3선)"];
  if (prices.length !== 2 || !firstOk) return prices.map((_, i) => `${i + 1}차`);
  return first.close >= first.open ? ["종가 기준 1/3선", "몸통 중심선"] : ["몸통 중심선", "종가 기준 1/3선"];
}
const shortLabel = (label: string | undefined) => (!label ? "분할" : label.startsWith("몸통") ? "중심선" : label.includes("1/3") ? "1/3선" : label);

/** 상태 꼬리표: 좋음은 강조색, 주의·위험은 경고색(빨강을 쓰지 않는다) */
function Flag({ tone, children }: { tone: Note["tone"]; children: string }) {
  return <span className={`stk-flag ${tone === "good" ? "good" : tone === "info" ? "info" : "warn"}`}>{children}</span>;
}

function Step({ title, flag, children }: { title: string; flag: ReactNode; children: ReactNode }) {
  return (
    <div className="stk-mstep">
      <div className="row between wrap">
        <h4 className="t-body t-bold">{title}</h4>
        {flag}
      </div>
      {children}
    </div>
  );
}

function Assessment({ a, region, stale, sessionDate, labels }: { a: IntradayAssessment; region: Region; stale: boolean; sessionDate: string | null; labels: string[] }) {
  const v = VERDICT[a.entry.verdict];
  const m = (n: number | null | undefined) => (n == null ? "-" : fmtPrice(n, region));
  const P = INTRADAY_PARAMS;
  return (
    <section className="stack-3" aria-labelledby="stk-minute-h">
      <div className="row between wrap">
        <h3 id="stk-minute-h" className="t-section">
          분봉 타점 판단
        </h3>
        <span className="row wrap">
          {a.asOf && <EvidenceStrip evidence={minuteEvidence(a)} size="md" />}
          <span className={`stk-verdict ${a.entry.verdict}`}>{v.label}</span>
          {stale && <span className="stk-tag warn">{fmtDate(sessionDate)} 마감 기준</span>}
          {a.asOf && <span className="t-cap">{a.asOf.slice(11)} 봉까지 반영</span>}
        </span>
      </div>
      <p className="t-2">
        {v.help}
        {stale && " 지난 장 마감 기준이라 지금 매매 판단으로 쓰지 마세요."}
      </p>
      <NoteList notes={a.entry.notes} />
      {a.asOf && (
        <>
          <Stats n={4}>
            <Stat value={a.gapPct == null ? "-" : <Change pct={a.gapPct} showAbs={false} />} label="시초가 갭" />
            <Stat value={elapsed(a.minutesSinceOpen)} label="장 시작 후 경과" />
            <Stat value={m(a.sessionLow)} label="당일 저가" />
            <Stat value={m(a.last)} label="마지막 1분봉 종가" />
          </Stats>
          <dl className="stk-kv">
            <dt>분할 매수가</dt>
            <dd>
              {a.entry.splitPrices.length ? (
                a.entry.splitPrices.map((p, i) => (
                  <span key={i} className="row base">
                    <span className="num t-medium">{m(p)}</span>
                    <span className="t-cap">{labels[i]}</span>
                  </span>
                ))
              ) : (
                <span className="t-2">첫 3분봉이 완성되면 계산해요</span>
              )}
            </dd>
            <dt>손절 기준가</dt>
            <dd>{a.entry.stop != null ? <span className="num t-medium">{m(a.entry.stop)}</span> : <span className="t-2">매수 가능 판단일 때만 정해요</span>}</dd>
          </dl>
          <p className="t-cap">시장가로 한 번에 사지 말고 2~3회 나눠 사요. 처음 정한 손절가는 꼭 지켜요.</p>
          <div className="stk-msteps">
            <Step
              title="보유 기준선"
              flag={
                a.hold.ma20on1m == null && a.hold.ma10on3m == null ? <Flag tone="info">계산 전</Flag>
                  : a.hold.below1m20 || a.hold.below3m10 ? <Flag tone="warn">이탈</Flag>
                  : <Flag tone="good">유지</Flag>
              }
            >
              <dl className="stk-kv">
                <dt>1분봉 20분선</dt>
                <dd>{a.hold.ma20on1m == null ? <span className="t-2">봉 부족({P.ma1mHold}개 필요)</span> : <span className="num">{m(a.hold.ma20on1m)} {a.hold.below1m20 ? "이탈" : "위"}</span>}</dd>
                <dt>3분봉 10분선</dt>
                <dd>{a.hold.ma10on3m == null ? <span className="t-2">봉 부족({P.ma3mHold}개 필요)</span> : <span className="num">{m(a.hold.ma10on3m)} {a.hold.below3m10 ? "이탈" : "위"}</span>}</dd>
              </dl>
              <NoteList notes={[a.hold.note]} dense />
            </Step>
            <Step
              title="3분봉 첫 눌림"
              flag={
                a.pullback3m.signal ? <Flag tone="good">매수 타점</Flag>
                  : a.pullback3m.firstTouchAt ? (a.pullback3m.note.tone === "warn" ? <Flag tone="warn">닿은 뒤 이탈</Flag> : <Flag tone="info">지난 눌림</Flag>)
                  : <Flag tone="info">아직 없음</Flag>
              }
            >
              <p className="t-2">20분선 첫 닿음: {a.pullback3m.firstTouchAt ? `${a.pullback3m.firstTouchAt.slice(11)} 3분봉` : "아직 없어요"}</p>
              <NoteList notes={[a.pullback3m.note]} dense />
            </Step>
            <Step title="5·20분선 동시 이탈 손절" flag={a.stop3m.signal ? <Flag tone="bad">손절 신호</Flag> : <Flag tone="info">이탈 없음</Flag>}>
              <NoteList notes={[a.stop3m.note]} dense />
            </Step>
            <Step
              title="전일 고가 돌파·지지"
              flag={
                a.breakout.supportConfirmed ? <Flag tone={a.breakout.note.tone}>{a.breakout.note.tone === "good" ? "매수 조건" : "지지 확인"}</Flag>
                  : a.breakout.prevHighBroken ? (a.breakout.note.tone === "warn" ? <Flag tone="warn">돌파 실패</Flag> : <Flag tone="info">지지 확인 대기</Flag>)
                  : <Flag tone="info">돌파 전</Flag>
              }
            >
              <p className="t-2">
                전일 고가 종가 돌파 {a.breakout.prevHighBroken ? "있었어요" : "아직 없어요"} · 그 위 지지 {a.breakout.supportConfirmed ? "확인됐어요" : "아직 아니에요"}
              </p>
              <NoteList notes={[a.breakout.note]} dense />
            </Step>
          </div>
        </>
      )}
    </section>
  );
}

function RulesCaption() {
  const P = INTRADAY_PARAMS;
  return (
    <details className="stk-details">
      <summary>
        강창권 장중 타점 요약 <span className="t-cap">{RULE}</span>
      </summary>
      <ul className="stk-bullets t-2">
        <li>시초가 +{P.gapNoChasePct}% 이상 갭: 시초가 매수 금지. 약 {P.gapWaitMinutes}분 기다려 1분봉 20분선 지지를 확인한 뒤 나눠 사고, 당일 저점을 깨면 손절해요.</li>
        <li>전일 시간외 급등 종목: +{P.gapNoChasePct}% 이상 갭은 추격 금지, +{P.gapCautionPct}% 이상 갭도 원칙적으로 패스해요.</li>
        {P.cautionGapWaits && <li>앱 해석: 시간외 급등 여부를 모를 때 +{P.gapCautionPct}~{P.gapNoChasePct}% 갭도 +{P.gapNoChasePct}% 갭처럼 기다려 지지를 확인해요.</li>}
        <li>전일 상한가 종목이 갭 없이 출발하면 {P.limitUpDigestFrom}~{P.limitUpDigestTo}분 매물을 소화한 뒤 한 번 더 시세가 나오는 경향이 있어요.</li>
        <li>보유: 1분봉은 20분선, 3분봉은 10분선을 이탈하기 전까지 들고 가요.</li>
        <li>3분봉 눌림: 급등 뒤 첫 눌림에서 20분선에 처음 닿을 때 하루 1회만 사고, 종가가 5분선·20분선을 함께 이탈하면 즉시 손절해요.</li>
        <li>돌파: 전일 고가를 뚫고 그 위에서 지지가 확인돼야 하고, 일봉 5·20·60일선 정배열 우상향 종목만 해당해요.</li>
        <li>매수 실행: 3분봉 첫 캔들 몸통 중심선 또는 종가 기준 1/3선에서 2~3회 나눠 사요.</li>
      </ul>
      <p className="t-cap">
        &lsquo;N분선&rsquo;은 그 분봉 차트의 N봉 평균이에요(1분봉 20분선 = 1분봉 20개 평균). 판단에는 이미 끝난 봉만 써요. 책의 경험칙을 옮긴 참고 판단이라 맞지 않을 수 있고,
        수익을 보장하지 않아요. 모의매매로 먼저 확인해 보세요.
      </p>
    </details>
  );
}

interface MinState {
  code: string;
  data: MinuteResponse | null;
  error: string | null;
  loading: boolean;
  at: number | null;
}

/** 분봉 차트 + 장중 타점 판단 */
export function MinuteView({ code, region, height }: { code: string; region: Region; height: number }) {
  const [st, setSt] = useState<MinState>({ code, data: null, error: null, loading: true, at: null });
  const [open, setOpen] = useState(() => isOpenNow(region));
  const seq = useRef(0);

  const load = useCallback(() => {
    const id = ++seq.current;
    setSt((s) => (s.code === code ? { ...s, loading: true } : { code, data: null, error: null, loading: true, at: null }));
    getMinute(code)
      .then((data) => id === seq.current && setSt({ code, data, error: null, loading: false, at: Date.now() }))
      .catch((e: Error) => id === seq.current && setSt((s) => ({ ...s, code, error: e.message, loading: false })));
  }, [code]);

  useEffect(() => load(), [load]);
  useEffect(() => () => void ++seq.current, []);
  useEffect(() => {
    setOpen(isOpenNow(region));
    const t = setInterval(() => {
      const o = isOpenNow(region);
      setOpen(o);
      if (o && (typeof document === "undefined" || document.visibilityState !== "hidden")) load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [region, load]);

  const data = st.code === code ? st.data : null;
  const a = data?.assessment ?? null;
  const reg = data?.region ?? region;
  const stale = !!data?.sessionDate && data.sessionDate !== marketClock(reg, new Date()).date;
  const labels = useMemo(() => (a && data ? splitLabels(a.entry.splitPrices, data.bars, data.region) : []), [a, data]);
  const levels = useMemo<MinuteLevel[]>(() => {
    if (!a) return [];
    const out: MinuteLevel[] = a.entry.splitPrices.map((p, i) => ({ price: p, title: shortLabel(labels[i]), kind: "split" }));
    if (a.entry.stop != null) out.push({ price: a.entry.stop, title: "손절", kind: "stop" });
    return out;
  }, [a, labels]);

  return (
    <div className="stack-4">
      <div className="row between wrap">
        <span className="t-2">
          {data?.sessionDate ? `${fmtDate(data.sessionDate)} · ${TZ_LABEL[reg]}` : "분봉"}
          {data?.sample && <span className="stk-tag warn">샘플</span>}
        </span>
        <span className="row wrap">
          <span className="t-cap">
            {open ? "장중 · 30초마다 다시 받아요" : "장 시간이 아니라 자동으로 다시 받지 않아요"}
            {st.at != null && ` · ${clockText(st.at)} 기준`}
          </span>
          <Button size="sm" variant="secondary" busy={st.loading} onClick={load} icon={<RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />}>
            분봉 다시 받기
          </Button>
        </span>
      </div>
      {st.error && (
        <Notice tone="warn" title="분봉을 받지 못했어요" action={<Button size="sm" onClick={load}>다시 불러오기</Button>}>
          {st.error}. 서버 연결을 확인한 뒤 다시 불러오세요.
        </Notice>
      )}
      {data?.message && <Notice tone="info">{data.message.replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtDate(d))}</Notice>}
      {!data && st.loading && <Skeleton h={height} />}
      {data && <MinuteChart bars={data.bars} region={data.region} levels={levels} height={height} />}
      {data && a && <Assessment a={a} region={data.region} stale={stale} sessionDate={data.sessionDate} labels={labels} />}
      {data && !a && !data.message && <p className="t-2">분봉 판단 자료가 없어요.</p>}
      <RulesCaption />
    </div>
  );
}
