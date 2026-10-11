import type { ReactNode } from "react";
import {
  PER_BAND_PARAMS,
  VALUATION_RULES,
  type AmountUnit,
  type Analysis,
  type BandPosition,
  type Candle,
  type Fundamentals,
  type PerBand,
  type PsrResult,
  type Region,
  type ValuationBasis,
} from "@jusik/shared";
import { NoteList } from "./NoteList";
import { BAND_LEVELS, BandSwatch, PerBandChart, bandLevelLabel } from "./PerBandChart";
import { money, num, pct, tone } from "./format";
import { useChartColors } from "./theme";
import "./styles/valuation.css";

// ───────── 금액 표기(재무 탭과 같이 써요) ─────────

export const UNIT_TEXT: Record<AmountUnit, string> = { 억원: "억 원", 백만달러: "백만 달러" };

/**
 * amountUnit 단위 금액 → 원래 단위 표기("4,512,345억 원")와 읽기 쉬운 근사("약 451.2조 원").
 * 근사가 원래 표기와 같으면 approx는 null.
 */
export function amountText(v: number, unit: AmountUnit): { main: string; approx: string | null } {
  const main = `${num(v, unit === "억원" ? 0 : 1)}${UNIT_TEXT[unit]}`;
  const a = Math.abs(v);
  let approx: string | null = null;
  if (unit === "억원") {
    if (a >= 10_000) approx = `약 ${num(v / 10_000, 1)}조 원`;
  } else if (a >= 1_000_000) approx = `약 ${num(v / 1_000_000, 2)}조 달러`;
  else if (a >= 100) approx = `약 ${num(v / 100, 1)}억 달러`;
  return { main, approx };
}

function Amount({ v, unit }: { v: number; unit: AmountUnit }) {
  const t = amountText(v, unit);
  return (
    <>
      {t.main}
      {t.approx && <span className="muted small"> ({t.approx})</span>}
    </>
  );
}

// ───────── 표시 도우미 ─────────

function VaRule({ rule }: { rule: string }) {
  return (
    <span className="va-rule" title="근거(자료집 3.3·부록 A 규칙)">
      {rule}
    </span>
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

const basisText = (basis: ValuationBasis, period: string) =>
  basis === "TTM" ? `최근 4분기 합(${period}까지)` : `${period} 연간`;

/** 밴드 통계가 없을 때의 이유 */
function bandMissing(band: PerBand): string {
  if (!band.from) return "주가 기록이 없어 PER 밴드를 만들 수 없어요.";
  if (band.n === 0 && !band.current) return "확정 EPS가 없어 과거 PER을 계산할 수 없어요(EPS 부족). 그래서 PER 밴드도 없어요.";
  if (band.n === 0) return "기간 안에 EPS가 0보다 큰 날이 없어(적자) PER 밴드를 만들 수 없어요.";
  return `PER을 계산한 날이 ${num(band.n, 0)}거래일뿐이라 밴드를 만들지 않았어요(최소 ${num(P.minPoints, 0)}거래일 필요).`;
}

/** 밴드 위치를 정하지 못한 이유(요약 칸용 짧은 문구) */
function positionMissing(band: PerBand): string {
  if (!band.current) return "확정 EPS가 없어 밴드가 없어요(EPS 부족)";
  if (band.current.per == null) return "지금 EPS가 0 이하(적자)라 위치를 정하지 않아요";
  return `밴드가 없어요(PER 기록 ${num(band.n, 0)}/${num(P.minPoints, 0)}거래일)`;
}

/** 실제 밴드 기간이 설정 기간보다 한 분기 넘게 짧은지(주가 기록이 짧은 종목). 일봉 750개(약 3년)는 짧다고 보지 않아요 */
function shortWindow(band: PerBand): boolean {
  if (!band.from || !band.to) return false;
  const [y, m, d] = band.to.split("-").map(Number) as [number, number, number];
  const expected = Date.UTC(y, m - 1 - Math.round(band.years * 12), d);
  return Date.parse(band.from) - expected > 92 * 86_400_000;
}

/** PSR이 없을 때의 이유. psr()과 같은 순서로 확인한다 */
function psrMissing(f: Fundamentals): string {
  if (f.marketCap == null || !(f.marketCap > 0)) return "시가총액이 없어 PSR을 계산하지 않아요.";
  if (!f.amountUnit) return "시가총액·매출 금액 단위를 몰라 PSR을 계산하지 않아요(엉뚱한 배수를 막으려고요).";
  return "확정 매출(최근 4분기 합이나 연간)이 없거나 0 이하라 PSR을 계산하지 않아요.";
}

// ───────── 요약 칸 ─────────

function Cell({ label, rule, children, sub }: { label: string; rule?: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="metric">
      <span className="muted small">
        {label}
        {rule && <> <VaRule rule={rule} /></>}
      </span>
      <b>{children}</b>
      {sub != null && <span className="va-note">{sub}</span>}
    </div>
  );
}

function Summary({ band, ps, f, region }: { band: PerBand; ps: PsrResult | null; f: Fundamentals; region: Region }) {
  const cur = band.current;
  const per = cur?.per ?? null;
  const t = band.target;
  return (
    <div className="metrics va-summary">
      {!cur ? (
        <Cell label="현재 PER" sub="확정 EPS가 없어 계산하지 못했어요(EPS 부족)">
          <span className="muted">-</span>
        </Cell>
      ) : per == null ? (
        <Cell label="현재 PER" sub={`EPS ${money(cur.eps, region)} · ${basisText(cur.basis, cur.period)} · 0 이하라 PER을 쓰지 않아요`}>
          <span className="muted">적자</span>
        </Cell>
      ) : (
        <Cell label="현재 PER" sub={`EPS ${money(cur.eps, region)} · ${basisText(cur.basis, cur.period)}`}>
          {num(per, 1)}배
        </Cell>
      )}

      <Cell
        label="밴드 위치"
        rule="M2-09"
        sub={band.position ? POSITION[band.position].hint : positionMissing(band)}
      >
        {band.position ? (
          <span className={`chip va-pos va-pos-${band.position}`}>{POSITION[band.position].label}</span>
        ) : (
          <span className="muted">-</span>
        )}
      </Cell>

      <Cell
        label="중앙 PER 회귀 가격"
        rule="3.3 최병운"
        sub={
          t ? (
            <>
              <span className={tone(t.upsidePct)}>{pct(t.upsidePct, 1)}</span> · 중앙 PER {num(t.multiple, 1)}배 × EPS
            </>
          ) : (
            "현재 PER이나 밴드가 없어 계산하지 않아요"
          )
        }
      >
        {t ? money(t.price, region) : <span className="muted">-</span>}
      </Cell>

      <Cell label="PSR" rule="M2-10" sub={ps ? `시가총액 ÷ ${ps.basis === "TTM" ? "최근 4분기 매출" : "연간 매출"}` : psrMissing(f)}>
        {ps ? `${num(ps.psr, 2)}배` : <span className="muted">-</span>}
      </Cell>
    </div>
  );
}

// ───────── PER 밴드 통계 ─────────

function Gauge({ s, per }: { s: NonNullable<PerBand["stats"]>; per: number }) {
  const span = s.max - s.min;
  const at = (x: number) => (span > 0 ? Math.min(100, Math.max(0, ((x - s.min) / span) * 100)) : 50);
  return (
    <div className="va-gauge" role="img" aria-label={`PER 밴드 안 현재 위치: 최저 ${num(s.min, 1)}배, 최고 ${num(s.max, 1)}배, 현재 ${num(per, 1)}배`}>
      <div className="va-track">
        <span className="va-zone va-zone-low" style={{ width: `${at(s.p20)}%` }} />
        <span className="va-zone va-zone-high" style={{ left: `${at(s.p80)}%` }} />
        <span className="va-tick" style={{ left: `${at(s.median)}%` }} title={`중앙 ${num(s.median, 1)}배`} />
        <span className="va-dot" style={{ left: `${at(per)}%` }} title={`현재 ${num(per, 1)}배`} />
      </div>
      <div className="va-scale">
        <span>최저 {num(s.min, 1)}배</span>
        <span>
          현재 <b>{num(per, 1)}배</b>
        </span>
        <span>최고 {num(s.max, 1)}배</span>
      </div>
    </div>
  );
}

/** 통계 칸의 ≈ 가격: 차트 선과 같은 반올림 배수를 써요. 표시 배수와 다르면 선 배수를 같이 적어요 */
function TilePrice({ eps, raw, line, region }: { eps: number; raw: number; line: number | undefined; region: Region }) {
  const m = line ?? raw;
  return (
    <span className="va-note">
      ≈ {money(eps * m, region)}
      {line != null && num(line, 1) !== num(raw, 1) && ` (${num(line, 1)}배 선)`}
    </span>
  );
}

function BandStats({ band, region }: { band: PerBand; region: Region }) {
  const colors = useChartColors();
  const s = band.stats;
  if (!s) return <p className="muted small va-missing">{bandMissing(band)}</p>;
  const eps = band.current?.eps;
  const per = band.current?.per;
  const lineOf = new Map(band.bands.map((b) => [b.level, b.multiple]));
  return (
    <>
      {per != null && <Gauge s={s} per={per} />}
      <div className="va-band">
        {[...BAND_LEVELS].reverse().map((l) => (
          <div key={l} className="va-tile">
            <span className="muted small">
              <BandSwatch level={l} colors={colors} /> {bandLevelLabel(l)}
            </span>
            <b>{num(s[l], 1)}배</b>
            {eps != null && eps > 0 && <TilePrice eps={eps} raw={s[l]} line={lineOf.get(l)} region={region} />}
          </div>
        ))}
      </div>
      <p className="va-caption">
        {band.from} ~ {band.to}(최근 {num(band.years, 1)}년 기준) 중 PER을 계산한 {num(band.n, 0)}거래일의 분포예요.
        {shortWindow(band) && " 주가 기록이 짧아 실제 기간이 더 짧아요."} 하단 {P.lowPct}%·상단 {P.highPct}%는 PER을 낮은 순으로 세웠을 때의
        위치예요. 날마다 그날까지 공시된 확정 실적만 쓰고, 적자인 날은 빼요.
        {eps != null && eps > 0 && " ≈ 가격은 지금 EPS에 차트 선 배수(유효숫자 두 자리)를 곱한 값이에요."}
      </p>
    </>
  );
}

// ───────── PSR ─────────

function PsrDetail({ ps, f }: { ps: PsrResult | null; f: Fundamentals }) {
  const R = VALUATION_RULES;
  return (
    <>
      <h5 className="va-sub">
        PSR(주가매출비율) <VaRule rule="M2-10 강영현" /> <VaRule rule="3.3 김연수" />
      </h5>
      {ps ? (
        <table className="kv va-kv">
          <tbody>
            <tr>
              <th>PSR</th>
              <td>
                <b>{num(ps.psr, 2)}배</b> <span className="muted small">= 시가총액 ÷ 매출</span>
              </td>
            </tr>
            <tr>
              <th>매출({ps.basis === "TTM" ? "TTM" : "연간"})</th>
              <td>
                <Amount v={ps.revenue} unit={ps.unit} />
                <span className="muted small"> · {basisText(ps.basis, ps.period)}</span>
              </td>
            </tr>
            <tr>
              <th>시가총액</th>
              <td>
                <Amount v={ps.marketCap} unit={ps.unit} />
              </td>
            </tr>
            <tr>
              <th>책의 기준</th>
              <td className="muted small">
                {R.psrHigh}배 이상은 산업 태동기에만 용인된 사례가 있어요. 금리 상승기에 {R.psrBubble}배 이상이면 거품 경고예요.
              </td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="muted small va-missing">{psrMissing(f)}</p>
      )}
    </>
  );
}

// ───────── 본문 ─────────

/**
 * 밸류에이션 — PER 밴드(M2-09)·PSR(M2-10). 분석(a.valuation)을 그대로 보여 주고, 의견은 바꾸지 않는다.
 * candles가 있으면 PER 밴드 차트도 그린다.
 */
export function ValuationPanel({
  a,
  f,
  candles,
  region,
  sample,
}: {
  a: Analysis | null;
  f: Fundamentals;
  candles?: Candle[];
  region: Region;
  /** 샘플 데이터(PROVIDER=mock)면 true — 시가총액·상장주식수가 만들어 낸 값이에요 */
  sample?: boolean;
}) {
  const v = a?.valuation;
  return (
    <section className="va" aria-label="밸류에이션">
      <h4 className="group va-title">
        밸류에이션 — PER 밴드·PSR
        {sample && (
          <span className="pill warn-pill" title="샘플 데이터라 실적·시가총액이 실제 값이 아니에요">
            샘플
          </span>
        )}
      </h4>
      {!v ? (
        <p className="muted small">주가 기록이 부족해 분석을 만들지 못했어요. 밸류에이션도 함께 빠져요.</p>
      ) : (
        <>
          <p className="va-lead">
            과거 {num(v.band.years, 1)}년 PER 분포에서 지금 위치예요. 싸다는 이유만으로 사지 않아요(이익 성장도 함께 봐요).
          </p>
          <Summary band={v.band} ps={v.psr} f={f} region={region} />
          {v.notes.length > 0 && <NoteList notes={v.notes} />}
          <h5 className="va-sub">
            PER 밴드 <VaRule rule="M2-09 강영현·최병운" />
          </h5>
          <BandStats band={v.band} region={region} />
          {candles && candles.length > 0 && v.band.bands.length > 0 && <PerBandChart candles={candles} band={v.band} region={region} />}
          <PsrDetail ps={v.psr} f={f} />
        </>
      )}
    </section>
  );
}
