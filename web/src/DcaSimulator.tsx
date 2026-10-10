import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { LineStyle, createChart, type Time } from "lightweight-charts";
import {
  DCA_DAYS,
  DCA_TARGETS,
  DCA_TARGET_MAX,
  DEFAULT_DCA,
  dcaNotes,
  dcaPlanToday,
  simulateDca,
  type Candle,
  type DcaResult,
  type Region,
} from "@jusik/shared";
import { money, num, pct, tone } from "./format";
import { NoteList } from "./NoteList";
import { Metric, RuleTag, btChartOptions, btCostText, btCosts, btDefaultCash, btPrice } from "./StrategyCompare";
import { useChartColors } from "./theme";
import "./styles/backtest.css";

const RULE = "M3-19 헬로마녀";
const PRESETS: [label: string, value: number][] = [
  ["대형주", DCA_TARGETS.large],
  ["중소형주", DCA_TARGETS.small],
];

/** 적립식 분할 매수(적금주식) 시뮬레이터 — 규칙 M3-19 헬로마녀 */
export function DcaSimulator({ candles, region }: { candles: Candle[]; region: Region }) {
  const colors = useChartColors();
  const [capitalInput, setCapital] = useState(() => btDefaultCash(region));
  const [daysInput, setDays] = useState(DCA_DAYS);
  const [targetInput, setTarget] = useState<number>(DCA_TARGETS.large);
  const [reinvest, setReinvest] = useState(DEFAULT_DCA.reinvest);
  const capital = useDeferredValue(capitalInput);
  const days = useDeferredValue(daysInput);
  const targetPct = useDeferredValue(targetInput);
  const chartEl = useRef<HTMLDivElement>(null);

  useEffect(() => setCapital(btDefaultCash(region)), [region]);

  const { feeRate, sellTaxRate } = btCosts(region);
  const result = useMemo(
    () => simulateDca(candles, { capital, days, targetPct, reinvest, feeRate, sellTaxRate }),
    [candles, capital, days, targetPct, reinvest, feeRate, sellTaxRate],
  );
  const notes = useMemo(() => (result ? dcaNotes(result) : []), [result]);

  useEffect(() => {
    const el = chartEl.current;
    if (!el || !result) return;
    const chart = createChart(el, btChartOptions(colors, 260));
    const eq = chart.addLineSeries({ color: colors.accent, lineWidth: 2, priceLineVisible: false });
    eq.setData(result.equity.map((p) => ({ time: p.date as Time, value: p.equity })));
    // 목표가에 닿아 전량 매도한 날
    eq.setMarkers(
      result.cycles.flatMap((cy) => (cy.end ? [{ time: cy.end as Time, position: "aboveBar" as const, shape: "circle" as const, color: colors.up, size: 0.6 }] : [])),
    );
    chart
      .addLineSeries({ color: colors.muted, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
      .setData(result.equity.map((p) => ({ time: p.date as Time, value: p.buyHold })));
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [result, colors]);

  const won = (n: number) => money(n, region);
  const invalid =
    !(capital > 0) ? "투자금을 0보다 크게 넣어 주세요." : !(days >= 1) ? "나눠 살 기간을 1일 이상으로 정해 주세요." : !(targetPct > 0) ? "목표 수익률을 0보다 크게 넣어 주세요." : null;

  return (
    <>
      <p className="bt-intro">
        매일 같은 금액을 나눠 사고, 평균 단가 대비 목표 수익률에 닿으면 전량 매도해요. 판 다음 날부터 새 사이클을 시작해요. <RuleTag rule={RULE} />
      </p>
      <p className="muted small">
        하루 한도 = 투자금 ÷ 나눌 기간(책 기준 약 {DCA_DAYS}영업일). 목표는 대형주 약 {DCA_TARGETS.large}%, 중소형주 10~{DCA_TARGET_MAX}%가 책의 경험칙이에요.
        손절은 넣지 않았어요 — 책은 떨어질 때 종목 악재인지 먼저 점검하라고 해요.
      </p>
      <div className="form">
        <label>
          투자금({region === "US" ? "달러" : "원"})
          <input type="number" min={0} step={region === "US" ? 1000 : 1000000} value={capitalInput} onChange={(e) => setCapital(Math.max(0, +e.target.value || 0))} />
        </label>
        <label>
          나눠 살 기간(영업일)
          <input type="number" min={1} max={250} value={daysInput} onChange={(e) => setDays(Math.min(250, Math.max(0, Math.floor(+e.target.value || 0))))} />
        </label>
        <label>
          목표 수익률(%, 최대 {DCA_TARGET_MAX})
          <input type="number" min={0.5} max={DCA_TARGET_MAX} step={0.5} value={targetInput} onChange={(e) => setTarget(Math.min(DCA_TARGET_MAX, Math.max(0, +e.target.value || 0)))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={reinvest} onChange={(e) => setReinvest(e.target.checked)} />
          수익까지 다시 투자(끄면 원금만큼만 다시 넣어요)
        </label>
      </div>
      <div className="bt-presets">
        <span className="muted small">목표 빠른 선택</span>
        <div className="seg" role="radiogroup" aria-label="목표 수익률 빠른 선택">
          {PRESETS.map(([label, v]) => (
            <button key={label} role="radio" aria-checked={targetInput === v} className={targetInput === v ? "on" : ""} onClick={() => setTarget(v)}>
              {label} {v}%
            </button>
          ))}
        </div>
      </div>

      {invalid ? (
        <p className="muted">{invalid}</p>
      ) : !result ? (
        <p className="muted">데이터가 부족해 시뮬레이션을 돌리지 못했어요.</p>
      ) : (
        <>
          <p className="muted small">
            {result.equity[0]!.date} ~ {result.equity.at(-1)!.date} · 종가에 매수, 장중 고가가 목표가에 닿으면 매도 · {btCostText(region)} · 슬리피지 {num(result.params.slippagePct, 2)}% 반영
          </p>
          <div className="metrics">
            <Metric label="완료 사이클" value={`${result.completedCycles}회`} />
            <Metric label="평균 소요 거래일" value={result.avgDaysPerCycle == null ? "-" : `${num(result.avgDaysPerCycle, 1)}일`} />
            <Metric label="총수익률" value={pct(result.totalReturnPct)} cls={tone(result.totalReturnPct)} />
            <Metric label="단순 보유" value={pct(result.buyHoldReturnPct)} cls={tone(result.buyHoldReturnPct)} />
            <Metric label="연환산(CAGR)" value={pct(result.cagrPct)} cls={tone(result.cagrPct)} />
            <Metric label="최대 낙폭(MDD)" value={pct(result.maxDrawdownPct)} cls={tone(result.maxDrawdownPct)} />
            <Metric label="최종 자산" value={won(result.finalEquity)} />
          </div>
          <OpenCycle r={result} region={region} />
          <NoteList notes={notes} />
          <div ref={chartEl} className="bt-chart" />
          <div className="legend">
            <span><i className="bt-swatch" style={{ background: colors.accent }} aria-hidden /> 적립식 자산</span>
            <span><i className="bt-swatch bt-swatch-dash" style={{ borderColor: colors.muted }} aria-hidden /> 단순 보유</span>
            <span><i className="bt-dot" style={{ background: colors.up }} aria-hidden /> 목표가 매도</span>
          </div>
          <CycleTable r={result} region={region} />
        </>
      )}
    </>
  );
}

/** 진행 중 사이클 현황과 다음 매수 수량 */
function OpenCycle({ r, region }: { r: DcaResult; region: Region }) {
  const won = (n: number) => money(n, region);
  const o = r.openCycle;
  const p = r.params;
  if (!o) {
    return <p className="muted small bt-open-cycle">마지막 날 목표가에 닿아 전량 매도했어요. 다음 거래일에 새 사이클을 시작해요.</p>;
  }
  const days = Math.max(1, Math.floor(p.days));
  // 시뮬레이션은 마지막 날까지 이미 샀다고 봐요. 이월 금액 = 지금까지의 하루 한도 합 − 실제로 쓴 돈
  const bought = Math.min(o.tradingDays, days);
  const carry = Math.max(0, (o.budget / days) * bought - o.invested);
  const plan = o.tradingDays < days ? dcaPlanToday({ capital: o.budget, days, dayIndex: o.tradingDays, price: r.lastClose, carry, feeRate: p.feeRate }) : null;
  const target = o.avgCost * (1 + p.targetPct / 100);
  const gap = o.shares > 0 ? (r.lastClose / o.avgCost - 1) * 100 : null;

  return (
    <div className="bt-open-cycle">
      <h4 className="h3">
        진행 중 사이클 <span className="muted small">{o.start} 시작 · {o.tradingDays}영업일째</span>
      </h4>
      {o.shares === 0 ? (
        <p className="muted small">아직 산 주식이 없어요. 최근 종가가 하루 한도보다 비싸면 남은 금액을 다음 날로 넘겨 모아서 사요.</p>
      ) : (
        <div className="levels">
          <div><span className="muted small">투입액 / 예산</span><b>{won(o.invested)} / {won(o.budget)}</b></div>
          <div><span className="muted small">보유 수량</span><b>{o.shares.toLocaleString()}주</b></div>
          <div><span className="muted small">평균 단가</span><b>{btPrice(o.avgCost, region)}</b></div>
          <div>
            <span className="muted small">목표가(평균 단가 +{num(p.targetPct, 1)}%)</span>
            <b className="up">{btPrice(target, region)}</b>
          </div>
          <div>
            <span className="muted small">최근 종가 · 평균 단가 대비</span>
            <b>{btPrice(r.lastClose, region)} <span className={gap == null ? "muted" : tone(gap)}>{gap == null ? "" : pct(gap)}</span></b>
          </div>
        </div>
      )}
      {plan ? (
        <p className="bt-plan">
          <b>오늘 살 수량</b>{" "}
          {plan.shares > 0 ? (
            <><b>{plan.shares.toLocaleString()}주</b> (약 {won(plan.spend)})</>
          ) : (
            <>없어요 — 한도로 1주를 못 사서 다음 날로 넘겨요</>
          )}
          <span className="muted small">
            {" "}· {o.tradingDays + 1}/{days}일째 매수분, 하루 한도 {won(plan.dailyLimit)}{carry > 0 && ` + 이월 ${won(carry)}`}, 최근 종가 기준
          </span>
        </p>
      ) : o.shares > 0 ? (
        <p className="muted small">매수 기간({days}영업일)이 끝나 목표가에 닿을 때까지 보유만 해요.</p>
      ) : (
        <p className="muted small">매수 기간({days}영업일) 동안 1주도 사지 못했어요. 투자금이나 나눌 기간을 다시 정해 주세요.</p>
      )}
    </div>
  );
}

function CycleTable({ r, region }: { r: DcaResult; region: Region }) {
  const won = (n: number) => money(n, region);
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${won(Math.abs(n))}`;
  return (
    <div className="table-wrap">
      <table className="trades">
        <thead>
          <tr>
            <th>시작</th><th>종료</th><th>거래일</th><th>투입</th><th>평균 단가</th><th>매도가</th><th>손익</th><th>수익률</th>
          </tr>
        </thead>
        <tbody>
          {[...r.cycles].reverse().map((cy) => {
            const live = cy.end == null && cy.shares > 0 ? (r.lastClose / cy.avgCost - 1) * 100 : null;
            return (
              <tr key={cy.start}>
                <td>{cy.start}</td>
                <td>{cy.end ?? <span className="pill">진행 중</span>}</td>
                <td>{cy.tradingDays}일</td>
                <td>{won(cy.invested)}</td>
                <td>{cy.shares > 0 ? btPrice(cy.avgCost, region) : "-"}</td>
                <td>{cy.exitPrice == null ? "-" : btPrice(cy.exitPrice, region)}</td>
                <td className={cy.pnl == null ? "muted" : tone(cy.pnl)}>{cy.pnl == null ? "-" : signed(cy.pnl)}</td>
                <td className={cy.returnPct != null ? tone(cy.returnPct) : "muted"}>
                  {cy.returnPct != null ? pct(cy.returnPct) : live != null ? `평가 ${pct(live)}` : "-"}
                </td>
              </tr>
            );
          })}
          {r.cycles.length === 0 && <tr><td colSpan={8} className="muted">사이클이 없어요.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
