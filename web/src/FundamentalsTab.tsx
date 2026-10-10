import { type AmountUnit, type Analysis, type Candle, type CheckStatus, type Fundamentals, type PeriodFinancials, type Region, type ScreeningResult } from "@jusik/shared";
import { ScreeningChips } from "./AnalysisCard";
import { NoteList, RuleTag } from "./NoteList";
import { ValuationPanel, amountText } from "./ValuationPanel";
import { money, num, pct } from "./format";
import "./styles/analysis.css";
import "./styles/valuation.css";

const GROUPS = ["안정성", "저평가", "실적"] as const;
const MARK = { pass: "✔", fail: "✖", unknown: "?" } as const;
/** 하드 필터 결과 표기: pass는 제외 기준에 걸리지 않았다는 뜻 */
const EXCLUDE_STATUS: Record<CheckStatus, string> = { pass: "통과", fail: "제외", unknown: "데이터 없음" };

function Exclusions({ s }: { s: ScreeningResult }) {
  return (
    <>
      <h4 className="group">
        제외 기준(하드 필터)
        {s.excluded ? <span className="chip grade-D">추천 후보 제외</span> : <span className="muted small">걸린 항목이 없어요</span>}
      </h4>
      <table className="kv">
        <tbody>
          {s.exclusions.map((c) => (
            <tr key={c.id}>
              <th><span className={`mark ${c.status}`}>{MARK[c.status]}</span> {c.label}</th>
              <td>
                {c.value} <span className={`small an-status-${c.status}`}>· {EXCLUDE_STATUS[c.status]}</span>
              </td>
              <td className="muted small">
                제외 기준 {c.rule}{c.hint ? ` · ${c.hint}` : ""} <RuleTag rule={c.ruleId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="an-caption">데이터가 없는 항목은 제외하지 않아요. 제외 기준에 걸리면 등급과 상관없이 추천 후보에서 빠져요.</p>
    </>
  );
}

function Metrics({ s }: { s: ScreeningResult }) {
  const { epsYoY, epsGrowth, peg } = s.metrics;
  const cell = (label: string, v: number | undefined, fmt: (n: number) => string, rule: string) => (
    <div className="metric">
      <span className="muted small">{label} <RuleTag rule={rule} /></span>
      <b>{v == null ? <span className="muted">-</span> : fmt(v)}</b>
    </div>
  );
  return (
    <div className="metrics">
      {cell("분기 EPS 전년 대비", epsYoY, (n) => pct(n, 1), "M2-05 박용선(오닐)")}
      {cell("연간 EPS 증가율", epsGrowth, (n) => pct(n, 1), "M2-08 박병창(린치)")}
      {cell("PEG", peg, (n) => num(n, 2), "M2-08 박병창(린치)")}
    </div>
  );
}

/** SEC 분기 행은 4분기를 연간 − 1~3분기로 계산했으면 derived: true를 달고 와요(공용 타입에는 없는 필드) */
type PeriodRow = PeriodFinancials & { derived?: boolean };

/** 금액 소수 자릿수: 억 원은 정수, 백만 달러는 한 자리. 단위를 모르면 예전처럼 지역 기준 */
const amountDigits = (unit: AmountUnit | undefined, region: Region) => (unit === "억원" ? 0 : unit === "백만달러" ? 1 : region === "US" ? 2 : 0);

/** 표 단위 안내 */
function unitCaption(unit: AmountUnit | undefined, region: Region): string {
  if (unit === "백만달러") return "단위: 백만 달러(EPS는 달러)";
  if (unit === "억원") return "단위: 억 원(EPS는 원)";
  return region === "US" ? "단위: 원자료(출처 단위 그대로, EPS는 달러)" : "단위: 억 원(EPS는 원)";
}

/** 실적 표. 금액은 Fundamentals.amountUnit 단위(국내 억 원, 미국 백만 달러) */
function PeriodTable({ title, rows, region, unit }: { title: string; rows: PeriodRow[]; region: Region; unit: AmountUnit | undefined }) {
  if (!rows.length) return null;
  const d = amountDigits(unit, region);
  const amt = (v: number | undefined) => (v == null ? "-" : num(v, d));
  const neg = (v: number | undefined) => (v != null && v < 0 ? "down" : "");
  return (
    <div>
      <b className="small">{title}</b>
      <div className="table-wrap">
        <table className="trades an-fin">
          <thead>
            <tr>
              <th className="left">기간</th>
              <th>매출</th>
              <th>영업이익</th>
              <th>순이익</th>
              <th>EPS</th>
              <th title="실제 공시(제출)일. 모르면 -로 표시해요">제출일</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((p) => (
              <tr key={p.period} className={p.estimate ? "an-est" : ""}>
                <td className="left">
                  {p.period}
                  {p.estimate && " (추정)"}
                  {p.derived && (
                    <span className="va-derived" title="연간 − 1~3분기로 계산한 4분기">
                      (계산)
                    </span>
                  )}
                </td>
                <td>{amt(p.revenue)}</td>
                <td className={p.estimate ? "" : neg(p.opIncome)}>{amt(p.opIncome)}</td>
                <td className={p.estimate ? "" : neg(p.netIncome)}>{amt(p.netIncome)}</td>
                <td className={p.estimate ? "" : neg(p.eps)}>{p.eps == null ? "-" : num(p.eps, region === "US" ? 2 : 0)}</td>
                <td className="va-filed">{p.filed ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Financials({ f, region }: { f: Fundamentals; region: Region }) {
  const annual: PeriodRow[] = f.annual ?? [];
  const quarterly: PeriodRow[] = f.quarterly ?? [];
  const derived = quarterly.some((p) => p.derived);
  return (
    <>
      <h4 className="group">연간·분기 실적</h4>
      {!annual.length && !quarterly.length ? (
        <p className="muted small">연간·분기 실적 데이터가 없어요.</p>
      ) : (
        <>
          <p className="an-caption">
            {unitCaption(f.amountUnit, region)} · 최신 기간이 위에 있어요. 추정치(추정)는 스크리닝 판단에서 빼요.
            {derived && " (계산)은 공시에 4분기 단독 값이 없어 연간에서 1~3분기를 빼서 구한 값이에요."}
          </p>
          <div className="an-extras-grid">
            <PeriodTable title="연간" rows={annual} region={region} unit={f.amountUnit} />
            <PeriodTable title="분기" rows={quarterly} region={region} unit={f.amountUnit} />
          </div>
        </>
      )}
    </>
  );
}

/** 참고 지표 한 줄: [이름, 값, 보조 설명] */
type RefRow = [string, string | null, string | null];

function refRows(f: Fundamentals, region: Region): RefRow[] {
  const rows: RefRow[] = [
    ["EPS", f.eps == null ? null : money(f.eps, region), null],
    ["BPS", f.bps == null ? null : money(f.bps, region), null],
    ["ROE", f.roe == null ? null : `${num(f.roe, 1)}%`, null],
    ["동일업종 PER", f.sectorPer == null ? null : `${num(f.sectorPer, 1)}배`, null],
  ];
  if (f.marketCap != null) {
    if (f.amountUnit) {
      const t = amountText(f.marketCap, f.amountUnit);
      rows.push(["시가총액", t.main, t.approx]);
    } else {
      rows.push(["시가총액", num(f.marketCap, 0), "금액 단위를 몰라요"]);
    }
  }
  if (f.sharesOutstanding != null) rows.push(["상장주식수", `${num(f.sharesOutstanding, 0)}주`, null]);
  return rows;
}

export function FundamentalsTab({
  f,
  a,
  region,
  candles,
  sample,
}: {
  f: Fundamentals;
  a: Analysis | null;
  region: Region;
  /** 일봉(App의 data.candles). 있으면 PER 밴드 차트를 그려요. 없으면 밴드 통계만 보여요 */
  candles?: Candle[];
  /** 샘플 데이터(health.sample)면 true — 시가총액·상장주식수가 만들어 낸 값이라는 표시를 붙여요 */
  sample?: boolean;
}) {
  const s = a?.screening;
  const ref = refRows(f, region);
  return (
    <div className="card">
      <h3 className="h3">재무 체크리스트 {s && <span className={`chip grade-${s.grade.replace("/", "")}`}>{s.grade}</span>}</h3>
      {s ? (
        <>
          {s.excluded && <div className="banner error an-exclude small">제외 기준에 걸려 추천 후보에서 빼요. 아래 「제외 기준」 표를 확인하세요.</div>}
          <p className="small">{s.known}개 확인 중 {s.passed}개 통과. 확인 못 한 항목은 감점하지 않고 등급 계산에서 제외해요.</p>
          <ScreeningChips s={s} />
          <Metrics s={s} />
          <Exclusions s={s} />
          {GROUPS.map((g) => (
            <div key={g}>
              <h4 className="group">{g}</h4>
              <table className="kv">
                <tbody>
                  {s.checks.filter((c) => c.group === g).map((c) => (
                    <tr key={c.id}>
                      <th><span className={`mark ${c.status}`}>{MARK[c.status]}</span> {c.label}</th>
                      <td>{c.value}</td>
                      <td className="muted small">
                        기준 {c.rule}{c.hint ? ` · ${c.hint}` : ""} <RuleTag rule={c.ruleId} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      ) : (
        <p className="muted">분석 데이터가 부족해요.</p>
      )}
      <Financials f={f} region={region} />
      <ValuationPanel a={a} f={f} candles={candles} region={region} sample={sample} />
      <h4 className="group">참고 지표</h4>
      <table className="kv">
        <tbody>
          {ref.map(([l, v, note]) => (
            <tr key={l}>
              <th>{l}</th>
              <td>{v ?? <span className="muted">-</span>}</td>
              <td className="muted small">
                {note}
                {sample && (l === "시가총액" || l === "상장주식수") && (
                  <span className="pill warn-pill va-ref-sample" title="샘플 데이터라 샘플 실적으로 만들어 낸 값이에요(실제 값 아님)">
                    샘플
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NoteList
        notes={[
          { tone: "info", text: "기준값(PER 10 이하, 부채비율 150% 이하 등)은 책 저자의 경험 기준이고 한국 시장에서 검증된 통계가 아니에요. 업종 PER은 네이버 동일업종 PER과 비교하지만, 업종 PBR 비교는 아직 없어요." },
          { tone: "warn", text: "저성장 업종은 PER·PBR이 낮아도 이익이 줄면 저평가가 아니에요. 매출·영업이익 증가율을 같이 보세요." },
        ]}
      />
    </div>
  );
}
