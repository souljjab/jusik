import { AlertTriangle, Check, Minus, X } from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ColorType, CrosshairMode, LineStyle, createChart, type LineData, type LineWidth, type Time, type WhitespaceData } from "lightweight-charts";
import {
  PER_BAND_PARAMS, VALUATION_RULES,
  type AmountUnit, type Analysis, type BandLevel, type BandPosition, type Candle, type Check as ScreenCheck, type CheckStatus, type Fundamentals,
  type PerBand, type PeriodFinancials, type PsrResult, type Region, type ScreeningResult, type ValuationBasis,
} from "@jusik/shared";
import { CHART_FONT, CHART_LOCALE, useChartColors, type ChartColors } from "../../theme";
import { fmtNum, fmtPct, fmtPrice, kstDate, NoteList, RuleTag, Section, Stat, Stats } from "../../ui";
import { ScreeningTags } from "./AnalysisDetails";
import { markDate } from "./stocksModel";

/** 날짜(지도서 3.2 '10.12(월)', 해가 다르면 '25.3.14(금)'). 날짜 꼴이 아니면 그대로 */
const dateKo = (d: string | null | undefined) => (!d ? "-" : /^\d{4}-\d{2}-\d{2}/.test(d) ? markDate(d.slice(0, 10), kstDate(new Date())) : d);

/*
 * 재무 탭(예전 「재무·스크리닝」 탭 + 밸류에이션 패널 + PER 밴드 차트): 재무 체크리스트와 제외 기준,
 * 연간·분기 실적, PER 밴드(M2-09)·PSR(M2-10), 참고 지표. 의견을 바꾸지 않는 참고 정보가 대부분이다.
 */

const GROUPS = ["안정성", "저평가", "실적"] as const;
const STATUS_ICON = { pass: Check, fail: X, unknown: Minus } as const;
const STATUS_WORD: Record<CheckStatus, string> = { pass: "통과", fail: "미달", unknown: "데이터 없음" };
const EXCLUDE_WORD: Record<CheckStatus, string> = { pass: "통과", fail: "제외", unknown: "데이터 없음" };

function CheckRows({ checks, exclude = false }: { checks: ScreenCheck[]; exclude?: boolean }) {
  return (
    <ul className="stk-checks">
      {checks.map((c) => {
        const Icon = STATUS_ICON[c.status];
        return (
          <li key={c.id} className={c.status}>
            <Icon size={16} strokeWidth={1.5} className="mk" role="img" aria-label={(exclude ? EXCLUDE_WORD : STATUS_WORD)[c.status]} />
            <span className="stack" style={{ gap: 0, minWidth: 0 }}>
              {/* 값이 '영업이익·순이익 감소·정체(B그룹)'처럼 문장일 수 있어 줄바꿈을 막지 않는다(글자 200%에서도 가로로 밀리지 않게) */}
              <span className="row between top wrap">
                <span className="t-medium">{c.label}</span>
                <span className="stk-check-val">{c.value}</span>
              </span>
              <span className="t-cap">
                {exclude ? "제외 기준" : "기준"} {c.rule}
                {c.hint ? ` · ${c.hint}` : ""} {c.ruleId && <RuleTag rule={c.ruleId} />}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Screening({ s }: { s: ScreeningResult }) {
  const { epsYoY, epsGrowth, peg } = s.metrics;
  return (
    <Section title="재무 체크리스트" sub={`등급 ${s.grade}`} as="h3">
      {s.excluded && (
        <p className="warn-text t-2 stk-warnline">
          <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>제외 기준에 걸려 추천 후보에서 빼요. 아래 제외 기준을 확인하세요.</span>
        </p>
      )}
      <p className="t-2">
        {s.known}개 확인 중 {s.passed}개 통과. 확인 못 한 항목은 감점하지 않고 등급 계산에서 빼요.
      </p>
      <ScreeningTags s={s} />
      <Stats n={3}>
        <Stat value={epsYoY == null ? "-" : fmtPct(epsYoY, 1)} label="분기 EPS 전년 대비" />
        <Stat value={epsGrowth == null ? "-" : fmtPct(epsGrowth, 1)} label="연간 EPS 증가율" />
        <Stat value={peg == null ? "-" : fmtNum(peg, 2)} label="PEG" />
      </Stats>
      <p className="t-cap">
        <RuleTag rule="M2-05 박용선(오닐)" /> · <RuleTag rule="M2-08 박병창(린치)" />
      </p>
      <h4 className="stk-sub">제외 기준(하드 필터) {s.excluded ? "· 추천 후보 제외" : "· 걸린 항목 없음"}</h4>
      <CheckRows checks={s.exclusions} exclude />
      <p className="t-cap">데이터가 없는 항목은 제외하지 않아요. 제외 기준에 걸리면 등급과 상관없이 추천 후보에서 빠져요.</p>
      {GROUPS.map((g) => {
        const list = s.checks.filter((c) => c.group === g);
        if (!list.length) return null;
        return (
          <div key={g} className="stack">
            <h4 className="stk-sub">{g}</h4>
            <CheckRows checks={list} />
          </div>
        );
      })}
    </Section>
  );
}

// ───────── 실적 표 ─────────

type PeriodRow = PeriodFinancials & { derived?: boolean };
const amountDigits = (unit: AmountUnit | undefined, region: Region) => (unit === "억원" ? 0 : unit === "백만달러" ? 1 : region === "US" ? 2 : 0);
function unitCaption(unit: AmountUnit | undefined, region: Region): string {
  if (unit === "백만달러") return "단위: 백만 달러(EPS는 달러)";
  if (unit === "억원") return "단위: 억 원(EPS는 원)";
  return region === "US" ? "단위: 원자료(출처 단위 그대로, EPS는 달러)" : "단위: 억 원(EPS는 원)";
}

function PeriodTable({ title, rows, region, unit, compact }: { title: string; rows: PeriodRow[]; region: Region; unit: AmountUnit | undefined; compact: boolean }) {
  if (!rows.length) return null;
  const d = amountDigits(unit, region);
  const amt = (v: number | undefined) => (v == null ? "-" : fmtNum(v, d));
  const neg = (v: number | undefined, est: boolean) => (!est && v != null && v < 0 ? "warn-text" : "");
  // 핸드폰: 표 대신 목록 행(기간 + 네 값)
  if (compact)
    return (
      <div className="stack">
        <h4 className="stk-sub">{title}</h4>
        <ul className="stk-finrows">
          {[...rows].reverse().map((p) => (
            <li key={p.period} className={p.estimate ? "stk-est" : ""}>
              <span className="row between">
                <span className="t-medium">
                  {p.period}
                  {p.estimate && " (추정)"}
                  {p.derived && <span className="t-cap"> (계산)</span>}
                </span>
                <span className="t-cap num">제출 {dateKo(p.filed)}</span>
              </span>
              <dl className="stk-fingrid">
                <div>
                  <dt>매출</dt>
                  <dd className="num">{amt(p.revenue)}</dd>
                </div>
                <div>
                  <dt>영업이익</dt>
                  <dd className={`num ${neg(p.opIncome, p.estimate)}`}>{amt(p.opIncome)}</dd>
                </div>
                <div>
                  <dt>순이익</dt>
                  <dd className={`num ${neg(p.netIncome, p.estimate)}`}>{amt(p.netIncome)}</dd>
                </div>
                <div>
                  <dt>EPS</dt>
                  <dd className={`num ${neg(p.eps, p.estimate)}`}>{p.eps == null ? "-" : fmtNum(p.eps, region === "US" ? 2 : 0)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="stack">
      <h4 className="stk-sub">{title}</h4>
      <div className="ui-table-wrap">
        <table className="ui-table on-surface">
          <thead>
            <tr>
              <th>기간</th>
              <th className="r">매출</th>
              <th className="r">영업이익</th>
              <th className="r">순이익</th>
              <th className="r">EPS</th>
              <th className="r" title="실제 공시(제출)일. 모르면 -">제출일</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((p) => (
              <tr key={p.period} className={p.estimate ? "stk-est" : ""}>
                <td className="nowrap">
                  {p.period}
                  {p.estimate && " (추정)"}
                  {p.derived && <span className="t-cap" title="연간에서 1~3분기를 빼서 계산한 4분기"> (계산)</span>}
                </td>
                <td className="r num">{amt(p.revenue)}</td>
                <td className={`r num ${neg(p.opIncome, p.estimate)}`}>{amt(p.opIncome)}</td>
                <td className={`r num ${neg(p.netIncome, p.estimate)}`}>{amt(p.netIncome)}</td>
                <td className={`r num ${neg(p.eps, p.estimate)}`}>{p.eps == null ? "-" : fmtNum(p.eps, region === "US" ? 2 : 0)}</td>
                <td className="r num t-2">{dateKo(p.filed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Financials({ f, region, compact }: { f: Fundamentals; region: Region; compact: boolean }) {
  const annual: PeriodRow[] = f.annual ?? [];
  const quarterly: PeriodRow[] = f.quarterly ?? [];
  return (
    <Section title="연간·분기 실적" as="h3">
      {!annual.length && !quarterly.length ? (
        <p className="t-2">연간·분기 실적 데이터가 없어요.</p>
      ) : (
        <>
          <p className="t-cap">
            {unitCaption(f.amountUnit, region)} · 최신 기간이 위에 있어요. 추정치는 스크리닝 판단에서 빼요. 적자는 경고색으로 표시해요.
            {quarterly.some((p) => p.derived) && " (계산)은 공시에 4분기 단독 값이 없어 연간에서 1~3분기를 빼서 구한 값이에요."}
          </p>
          <PeriodTable title="연간" rows={annual} region={region} unit={f.amountUnit} compact={compact} />
          <PeriodTable title="분기" rows={quarterly} region={region} unit={f.amountUnit} compact={compact} />
        </>
      )}
    </Section>
  );
}

// ───────── 밸류에이션 ─────────

const UNIT_TEXT: Record<AmountUnit, string> = { 억원: "억 원", 백만달러: "백만 달러" };
function amountText(v: number, unit: AmountUnit): { main: string; approx: string | null } {
  const main = `${fmtNum(v, unit === "억원" ? 0 : 1)}${UNIT_TEXT[unit]}`;
  const a = Math.abs(v);
  let approx: string | null = null;
  if (unit === "억원") {
    if (a >= 10_000) approx = `약 ${fmtNum(v / 10_000, 1)}조 원`;
  } else if (a >= 1_000_000) approx = `약 ${fmtNum(v / 1_000_000, 2)}조 달러`;
  else if (a >= 100) approx = `약 ${fmtNum(v / 100, 1)}억 달러`;
  return { main, approx };
}
function Amount({ v, unit }: { v: number; unit: AmountUnit }) {
  const t = amountText(v, unit);
  return (
    <>
      <span className="num">{t.main}</span>
      {t.approx && <span className="t-cap"> ({t.approx})</span>}
    </>
  );
}

const P = PER_BAND_PARAMS;
const POSITION: Record<BandPosition, { label: string; hint: string }> = {
  below: { label: "밴드 최저 이하", hint: "기간 최저 PER을 새로 쓰는 중이에요" },
  low: { label: "밴드 하단", hint: `하위 ${P.lowPct}% 안쪽이에요` },
  mid: { label: "밴드 중간", hint: `하단 ${P.lowPct}%와 상단 ${P.highPct}% 사이예요` },
  high: { label: "밴드 상단", hint: `상위 ${100 - P.highPct}% 안쪽이에요` },
  above: { label: "밴드 최고 이상", hint: "기간 최고 PER 수준이에요" },
};
const basisText = (basis: ValuationBasis, period: string) => (basis === "TTM" ? `최근 4분기 합(${period}까지)` : `${period} 연간`);

function bandMissing(band: PerBand): string {
  if (!band.from) return "주가 기록이 없어 PER 밴드를 만들 수 없어요.";
  if (band.n === 0 && !band.current) return "확정 EPS가 없어 과거 PER을 계산할 수 없어요. 그래서 PER 밴드도 없어요.";
  if (band.n === 0) return "기간 안에 EPS가 0보다 큰 날이 없어(적자) PER 밴드를 만들 수 없어요.";
  return `PER을 계산한 날이 ${fmtNum(band.n, 0)}거래일뿐이라 밴드를 만들지 않았어요(최소 ${fmtNum(P.minPoints, 0)}거래일 필요).`;
}
function positionMissing(band: PerBand): string {
  if (!band.current) return "확정 EPS가 없어 밴드가 없어요";
  if (band.current.per == null) return "지금 EPS가 0 이하(적자)라 위치를 정하지 않아요";
  return `밴드가 없어요(PER 기록 ${fmtNum(band.n, 0)}/${fmtNum(P.minPoints, 0)}거래일)`;
}
function shortWindow(band: PerBand): boolean {
  if (!band.from || !band.to) return false;
  const [y, m, d] = band.to.split("-").map(Number) as [number, number, number];
  const expected = Date.UTC(y, m - 1 - Math.round(band.years * 12), d);
  return Date.parse(band.from) - expected > 92 * 86_400_000;
}
function psrMissing(f: Fundamentals): string {
  if (f.marketCap == null || !(f.marketCap > 0)) return "시가총액이 없어 PSR을 계산하지 않아요.";
  if (!f.amountUnit) return "시가총액·매출 금액 단위를 몰라 PSR을 계산하지 않아요(엉뚱한 배수를 막으려고요).";
  return "확정 매출(최근 4분기 합이나 연간)이 없거나 0 이하라 PSR을 계산하지 않아요.";
}

function Cell({ label, rule, value, sub }: { label: string; rule?: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stk-cell">
      <span className="t-2">
        {label} {rule && <RuleTag rule={rule} />}
      </span>
      <span className="v num">{value}</span>
      {sub != null && <span className="t-cap">{sub}</span>}
    </div>
  );
}

function ValSummary({ band, ps, f, region }: { band: PerBand; ps: PsrResult | null; f: Fundamentals; region: Region }) {
  const cur = band.current;
  const t = band.target;
  return (
    <div className="stk-cells">
      {!cur ? (
        <Cell label="현재 PER" value="-" sub="확정 EPS가 없어 계산하지 못했어요" />
      ) : cur.per == null ? (
        <Cell label="현재 PER" value="적자" sub={`EPS ${fmtPrice(cur.eps, region, { unit: true })} · ${basisText(cur.basis, cur.period)} · 0 이하라 PER을 쓰지 않아요`} />
      ) : (
        <Cell label="현재 PER" value={`${fmtNum(cur.per, 1)}배`} sub={`EPS ${fmtPrice(cur.eps, region, { unit: true })} · ${basisText(cur.basis, cur.period)}`} />
      )}
      <Cell label="밴드 위치" rule="M2-09" value={band.position ? POSITION[band.position].label : "-"} sub={band.position ? POSITION[band.position].hint : positionMissing(band)} />
      <Cell
        label="중앙 PER 회귀 가격"
        rule="3.3 최병운"
        value={t ? fmtPrice(t.price, region) : "-"}
        sub={t ? `${fmtPct(t.upsidePct, 1)} · 중앙 PER ${fmtNum(t.multiple, 1)}배 × EPS` : "현재 PER이나 밴드가 없어 계산하지 않아요"}
      />
      <Cell label="PSR" rule="M2-10" value={ps ? `${fmtNum(ps.psr, 2)}배` : "-"} sub={ps ? `시가총액 ÷ ${ps.basis === "TTM" ? "최근 4분기 매출" : "연간 매출"}` : psrMissing(f)} />
    </div>
  );
}

export const BAND_LEVELS: readonly BandLevel[] = ["max", "p80", "median", "p20", "min"];
function bandLevelLabel(level: BandLevel): string {
  return { min: "최저", p20: `하단 ${P.lowPct}%`, median: "중앙", p80: `상단 ${P.highPct}%`, max: "최고" }[level];
}
/** 밴드선 색: 상승·하락 색이 아니라 차트 계열 색(바깥 최고·최저, 안쪽 상·하단, 중앙). 위아래는 자리와 선 모양으로 구분한다 */
function bandColor(c: ChartColors, level: BandLevel): string {
  return { min: c.line3, p20: c.line2, median: c.line1, p80: c.line2, max: c.line3 }[level];
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

function Swatch({ level, colors }: { level: BandLevel; colors: ChartColors }) {
  return <i className={`stk-swatch ${BAND_LINE[level].dash}`} style={{ borderColor: bandColor(colors, level) }} aria-hidden="true" />;
}

function Gauge({ s, per }: { s: NonNullable<PerBand["stats"]>; per: number }) {
  const span = s.max - s.min;
  const at = (x: number) => (span > 0 ? Math.min(100, Math.max(0, ((x - s.min) / span) * 100)) : 50);
  return (
    <div className="stk-band-gauge" role="img" aria-label={`PER 밴드 안 현재 위치: 최저 ${fmtNum(s.min, 1)}배, 최고 ${fmtNum(s.max, 1)}배, 현재 ${fmtNum(per, 1)}배`}>
      <div className="track" aria-hidden="true">
        <span className="zone" style={{ left: 0, width: `${at(s.p20)}%` }} />
        <span className="zone" style={{ left: `${at(s.p80)}%`, right: 0 }} />
        <span className="tick" style={{ left: `${at(s.median)}%` }} />
        <span className="dot" style={{ left: `${at(per)}%` }} />
      </div>
      <div className="row between t-cap" aria-hidden="true">
        <span>최저 {fmtNum(s.min, 1)}배</span>
        <span className="t-medium">현재 {fmtNum(per, 1)}배</span>
        <span>최고 {fmtNum(s.max, 1)}배</span>
      </div>
    </div>
  );
}

function BandStats({ band, region }: { band: PerBand; region: Region }) {
  const colors = useChartColors();
  const s = band.stats;
  if (!s) return <p className="t-2">{bandMissing(band)}</p>;
  const eps = band.current?.eps;
  const per = band.current?.per;
  const lineOf = new Map(band.bands.map((b) => [b.level, b.multiple]));
  return (
    <>
      {per != null && <Gauge s={s} per={per} />}
      <div className="stk-band-tiles">
        {[...BAND_LEVELS].reverse().map((l) => {
          const line = lineOf.get(l);
          const m = line ?? s[l];
          return (
            <div key={l} className="stk-cell">
              <span className="t-2 row" style={{ gap: 4 }}>
                <Swatch level={l} colors={colors} /> {bandLevelLabel(l)}
              </span>
              <span className="v num">{fmtNum(s[l], 1)}배</span>
              {eps != null && eps > 0 && (
                <span className="t-cap num">
                  ≈ {fmtPrice(eps * m, region)}
                  {line != null && fmtNum(line, 1) !== fmtNum(s[l], 1) && ` (${fmtNum(line, 1)}배 선)`}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="t-cap">
        {dateKo(band.from)} ~ {dateKo(band.to)}(최근 {fmtNum(band.years, 1)}년) 중 PER을 계산한 {fmtNum(band.n, 0)}거래일의 분포예요.
        {shortWindow(band) && " 주가 기록이 짧아 실제 기간이 더 짧아요."} 하단 {P.lowPct}%·상단 {P.highPct}%는 PER을 낮은 순으로 세웠을 때의 위치예요. 날마다 그날까지 공시된 확정 실적만 쓰고 적자인 날은 빼요.
        {eps != null && eps > 0 && " ≈ 가격은 지금 EPS에 차트 선 배수(유효숫자 두 자리)를 곱한 값이에요."}
      </p>
    </>
  );
}

/** PER 밴드 차트: 밴드 기간의 종가와 밴드선(그날 EPS × 기간 PER 배수). EPS가 0 이하인 날은 선을 끊는다 */
function PerBandChart({ candles, band, region }: { candles: Candle[]; band: PerBand; region: Region }) {
  const colors = useChartColors();
  const el = useRef<HTMLDivElement>(null);
  const { from, to } = band;
  const win = useMemo(() => (from && to ? candles.filter((c) => c.date >= from && c.date <= to) : []), [candles, from, to]);
  const lines = useMemo(() => BAND_LEVELS.flatMap((level) => band.bands.filter((b) => b.level === level)), [band.bands]);

  useEffect(() => {
    const node = el.current;
    if (!node || !win.length || !lines.length) return;
    const chart = createChart(node, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: colors.text, fontSize: 11, fontFamily: CHART_FONT },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.grid, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderColor: colors.grid },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: CHART_LOCALE, priceFormatter: (p: number) => (region === "US" || Math.abs(p) < 1000 ? p.toFixed(2) : Math.round(p).toLocaleString("ko-KR")) },
    });
    for (const b of lines) {
      const byDate = new Map(b.points.map((p) => [p.date, p.price]));
      const data: (LineData | WhitespaceData)[] = win.map((c) => {
        const v = byDate.get(c.date);
        return v == null ? { time: c.date as Time } : { time: c.date as Time, value: v };
      });
      const st = BAND_LINE[b.level];
      chart.addLineSeries({ color: bandColor(colors, b.level), lineWidth: st.width, lineStyle: LINE_STYLE[st.dash], priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(data);
    }
    chart.addLineSeries({ color: colors.text, lineWidth: 2, priceLineVisible: false }).setData(win.map((c) => ({ time: c.date as Time, value: c.close })));
    chart.timeScale().fitContent();
    // 출처 링크(TradingView)는 그림 밖 보통 링크로 두고, 캔버스 표는 낭독에서 뺀다(요약은 숨긴 문장으로)
    node.querySelectorAll("table").forEach((t) => t.setAttribute("aria-hidden", "true"));
    node.querySelectorAll("a").forEach((a) => a.getAttribute("aria-label") || a.setAttribute("aria-label", "차트 라이브러리 TradingView 사이트(새 탭)"));
    return () => chart.remove();
  }, [win, lines, colors, region]);

  if (!win.length || !lines.length) return null;
  return (
    <figure className="stk-band-chart">
      <figcaption className="stk-keys t-cap">
        <span>
          <i className="stk-key thick" style={{ background: colors.text }} aria-hidden="true" />
          종가
        </span>
        {lines.map((b) => (
          <span key={b.level}>
            <Swatch level={b.level} colors={colors} />
            {bandLevelLabel(b.level)} {fmtNum(b.multiple, 1)}배
          </span>
        ))}
      </figcaption>
      <p className="sr-only">PER 밴드 차트, {dateKo(band.from)}부터 {dateKo(band.to)}까지 종가와 밴드선 {lines.length}개</p>
      <div ref={el} style={{ height: 240 }} />
      <p className="t-cap">밴드선은 그날까지 공시된 최근 12개월 EPS에 기간 PER 배수를 곱한 가격이에요. 배수는 유효숫자 두 자리로 반올림했고, EPS가 0 이하인 날은 선을 끊어요.</p>
    </figure>
  );
}

function PsrDetail({ ps, f }: { ps: PsrResult | null; f: Fundamentals }) {
  const R = VALUATION_RULES;
  return (
    <div className="stack">
      <h4 className="stk-sub">
        PSR(주가매출비율) <RuleTag rule="M2-10 강영현" /> <RuleTag rule="3.3 김연수" />
      </h4>
      {ps ? (
        <dl className="stk-kv">
          <dt>PSR</dt>
          <dd>
            <span className={`num t-medium ${ps.psr >= R.psrBubble ? "warn-text" : ""}`}>{fmtNum(ps.psr, 2)}배</span>
            <span className="t-cap">= 시가총액 ÷ 매출</span>
          </dd>
          <dt>매출({ps.basis === "TTM" ? "TTM" : "연간"})</dt>
          <dd>
            <span>
              <Amount v={ps.revenue} unit={ps.unit} />
            </span>
            <span className="t-cap">{basisText(ps.basis, ps.period)}</span>
          </dd>
          <dt>시가총액</dt>
          <dd>
            <span>
              <Amount v={ps.marketCap} unit={ps.unit} />
            </span>
          </dd>
        </dl>
      ) : (
        <p className="t-2">{psrMissing(f)}</p>
      )}
      <p className="t-cap">
        책의 기준: {R.psrHigh}배 이상은 산업 태동기에만 용인된 사례가 있어요. 금리 상승기에 {R.psrBubble}배 이상이면 거품 경고예요.
      </p>
    </div>
  );
}

function Valuation({ a, f, candles, region, sample }: { a: Analysis | null; f: Fundamentals; candles: Candle[]; region: Region; sample: boolean }) {
  const v = a?.valuation;
  return (
    <Section title="밸류에이션" sub={`PER 밴드·PSR${sample ? " · 샘플 자료" : ""}`} as="h3">
      {!v ? (
        <p className="t-2">주가 기록이 부족해 분석을 만들지 못했어요. 밸류에이션도 함께 빠져요.</p>
      ) : (
        <>
          <p className="t-2">과거 {fmtNum(v.band.years, 1)}년 PER 분포에서 지금 위치예요. 싸다는 이유만으로 사지 않아요(이익 성장도 함께 봐요).</p>
          <ValSummary band={v.band} ps={v.psr} f={f} region={region} />
          {v.notes.length > 0 && <NoteList notes={v.notes} dense />}
          <h4 className="stk-sub">
            PER 밴드 <RuleTag rule="M2-09 강영현·최병운" />
          </h4>
          <BandStats band={v.band} region={region} />
          {candles.length > 0 && v.band.bands.length > 0 && <PerBandChart candles={candles} band={v.band} region={region} />}
          <PsrDetail ps={v.psr} f={f} />
        </>
      )}
    </Section>
  );
}

function RefFigures({ f, region, sample }: { f: Fundamentals; region: Region; sample: boolean }) {
  const rows: [string, ReactNode, string | null][] = [
    ["EPS", f.eps == null ? "-" : fmtPrice(f.eps, region, { unit: true }), null],
    ["BPS", f.bps == null ? "-" : fmtPrice(f.bps, region, { unit: true }), null],
    ["ROE", f.roe == null ? "-" : `${fmtNum(f.roe, 1)}%`, null],
    ["동일업종 PER", f.sectorPer == null ? "-" : `${fmtNum(f.sectorPer, 1)}배`, null],
  ];
  if (f.marketCap != null) rows.push(["시가총액", f.amountUnit ? <Amount v={f.marketCap} unit={f.amountUnit} /> : fmtNum(f.marketCap, 0), f.amountUnit ? (sample ? "샘플 실적으로 만든 값" : null) : "금액 단위를 몰라요"]);
  if (f.sharesOutstanding != null) rows.push(["상장주식수", `${fmtNum(f.sharesOutstanding, 0)}주`, sample ? "샘플 실적으로 만든 값" : null]);
  return (
    <Section title="참고 지표" as="h3">
      <dl className="stk-kv">
        {rows.map(([k, v, note]) => (
          <div key={k} className="stk-kv-pair">
            <dt>{k}</dt>
            <dd>
              <span className="num">{v}</span>
              {note && <span className="t-cap">{note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <NoteList
        dense
        notes={[
          { tone: "info", text: "기준값(PER 10 이하, 부채비율 150% 이하 등)은 책 저자의 경험 기준이고 한국 시장에서 검증된 통계가 아니에요. 업종 PER은 네이버 동일업종 PER과 비교하지만, 업종 PBR 비교는 아직 없어요." },
          { tone: "warn", text: "저성장 업종은 PER·PBR이 낮아도 이익이 줄면 저평가가 아니에요. 매출·영업이익 증가율을 같이 보세요." },
        ]}
      />
    </Section>
  );
}

export function FinTab({ f, a, candles, region, sample, compact = false }: { f: Fundamentals; a: Analysis | null; candles: Candle[]; region: Region; sample: boolean; compact?: boolean }) {
  return (
    <div className="stk-tabbody">
      {a ? <Screening s={a.screening} /> : <p className="t-2">분석 데이터가 부족해 체크리스트를 만들지 못했어요.</p>}
      <Financials f={f} region={region} compact={compact} />
      <Valuation a={a} f={f} candles={candles} region={region} sample={sample} />
      <RefFigures f={f} region={region} sample={sample} />
    </div>
  );
}
