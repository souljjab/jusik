import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { DCA_DAYS, DCA_TARGETS, DCA_TARGET_MAX, DEFAULT_DCA, dcaNotes, dcaPlanToday, simulateDca, type Candle, type DcaResult, type Region } from "@jusik/shared";
import { useChartColors } from "../../theme";
import { Change, Chip, Field, NoteList, Notice, RuleTag, Section, Stat, Stats, Toggle, arrowOf, fmtInt, fmtMoney, fmtNum, fmtPct, fmtPnl, fmtPrice } from "../../ui";
import { ChartLegend, EquityChart, type ChartLine } from "./EquityChart";
import { periodLabel } from "./logic";
import { btCostText, btCosts, btDefaultCash, fmtYmd } from "./strategyRun";

const RULE = "M3-19 헬로마녀";

/** 적립식 분할 매수(적금주식) 시뮬레이터 — 규칙 M3-19 헬로마녀. 핸드폰은 요약 지표만 */
export function DcaSection({ candles, region, compact, name }: { candles: Candle[]; region: Region; compact: boolean; name: string }) {
  const colors = useChartColors();
  const [capitalInput, setCapital] = useState(() => btDefaultCash(region));
  const [daysInput, setDays] = useState(DCA_DAYS);
  const [targetInput, setTarget] = useState<number>(DCA_TARGETS.large);
  const [reinvest, setReinvest] = useState(DEFAULT_DCA.reinvest);
  const capital = useDeferredValue(capitalInput);
  const days = useDeferredValue(daysInput);
  const targetPct = useDeferredValue(targetInput);

  useEffect(() => setCapital(btDefaultCash(region)), [region]);

  const { feeRate, sellTaxRate } = btCosts(region);
  const invalid =
    !(capital > 0) ? "투자금을 0보다 크게 넣어 주세요." : !(days >= 1) ? "나눠 살 기간을 1일 이상으로 정해 주세요." : !(targetPct > 0) ? "목표 수익률을 0보다 크게 넣어 주세요." : null;
  const result = useMemo(
    () => (invalid ? null : simulateDca(candles, { capital, days, targetPct, reinvest, feeRate, sellTaxRate })),
    [invalid, candles, capital, days, targetPct, reinvest, feeRate, sellTaxRate],
  );
  const notes = useMemo(() => (result ? dcaNotes(result) : []), [result]);
  const lines = useMemo<ChartLine[]>(
    () =>
      result
        ? [
            {
              id: "dca", label: "적립식 자산", color: colors.accent, width: 2,
              data: result.equity.map((p) => ({ date: p.date, value: p.equity })),
              markers: result.cycles.flatMap((cy) => (cy.end ? [{ date: cy.end, color: colors.text }] : [])),
            },
            { id: "bh", label: "단순 보유", color: colors.muted, width: 1, style: "dashed", data: result.equity.map((p) => ({ date: p.date, value: p.buyHold })) },
          ]
        : [],
    [result, colors],
  );
  const unit = region === "US" ? "달러" : "원";

  return (
    <Section title="적립식 분할 매수" sub={<RuleTag rule={RULE} />}>
      <p className="t-2">
        매일 같은 금액을 나눠 사고, 평균 단가 대비 목표 수익률에 닿으면 전량 매도해요. 판 다음 날부터 새 사이클을 시작해요. 하루 한도 = 투자금 ÷ 나눌 기간(책 기준 약{" "}
        {DCA_DAYS}영업일). 목표는 대형주 약 {DCA_TARGETS.large}%, 중소형주 10~{DCA_TARGET_MAX}%가 책의 경험칙이에요. 손절은 넣지 않았어요 — 책은 떨어질 때 종목 악재인지 먼저
        점검하라고 해요.
      </p>
      <div className="disc-form">
        <Field label={`투자금(${unit})`} htmlFor="disc-dca-cap">
          <input id="disc-dca-cap" className="ui-input num" type="number" min={0} step={region === "US" ? 1000 : 1_000_000} value={capitalInput} onChange={(e) => setCapital(Math.max(0, +e.target.value || 0))} />
        </Field>
        <Field label="나눠 살 기간(영업일)" htmlFor="disc-dca-days">
          <input id="disc-dca-days" className="ui-input num" type="number" min={1} max={250} value={daysInput} onChange={(e) => setDays(Math.min(250, Math.max(0, Math.floor(+e.target.value || 0))))} />
        </Field>
        <Field label={`목표 수익률(%, 최대 ${DCA_TARGET_MAX})`} htmlFor="disc-dca-target">
          <input
            id="disc-dca-target"
            className="ui-input num"
            type="number"
            min={0.5}
            max={DCA_TARGET_MAX}
            step={0.5}
            value={targetInput}
            onChange={(e) => setTarget(Math.min(DCA_TARGET_MAX, Math.max(0, +e.target.value || 0)))}
          />
        </Field>
      </div>
      <div className="row wrap">
        <div className="disc-chips" role="group" aria-label="목표 수익률 빠른 선택">
          <Chip pressed={targetInput === DCA_TARGETS.large} onClick={() => setTarget(DCA_TARGETS.large)}>
            대형주 {DCA_TARGETS.large}%
          </Chip>
          <Chip pressed={targetInput === DCA_TARGETS.small} onClick={() => setTarget(DCA_TARGETS.small)}>
            중소형주 {DCA_TARGETS.small}%
          </Chip>
        </div>
        <Toggle checked={reinvest} onChange={setReinvest} label="수익까지 다시 투자" hint="끄면 원금만큼만 다시 넣어요" />
      </div>

      {invalid ? (
        <Notice tone="warn">{invalid}</Notice>
      ) : !result ? (
        <Notice tone="warn">시세 기간이 짧아 시뮬레이션을 돌리지 못했어요. 상장한 지 오래된 종목으로 해 보세요.</Notice>
      ) : (
        <>
          <p className="t-cap">
            {name} · {periodLabel(result.equity)} · 종가에 매수, 장중 고가가 목표가에 닿으면 매도 · {btCostText(region, false)} · 슬리피지 {fmtNum(result.params.slippagePct, 2)}% 반영
          </p>
          <Stats n={compact ? 2 : 4}>
            <Stat value={`${fmtInt(result.completedCycles)}회`} label="완료 사이클" />
            <Stat value={<Change pct={result.totalReturnPct} showAbs={false} />} label="총수익률" />
            <Stat value={<Change pct={result.buyHoldReturnPct} showAbs={false} />} label="단순 보유" />
            <Stat value={<Change pct={result.maxDrawdownPct} showAbs={false} />} label="최대 낙폭" />
            {!compact && <Stat value={result.avgDaysPerCycle == null ? "-" : `${fmtNum(result.avgDaysPerCycle, 1)}일`} label="평균 소요 거래일" />}
            {!compact && <Stat value={<Change pct={result.cagrPct} showAbs={false} />} label="연평균 수익률" />}
            {!compact && <Stat value={<span className="num">{fmtMoney(result.finalEquity, region)}</span>} label="최종 자산" />}
          </Stats>
          <OpenCycle r={result} region={region} />
          {!compact && (
            <>
              <NoteList notes={notes} />
              <EquityChart lines={lines} height={240} summary={`적립식 자산 ${fmtPct(result.totalReturnPct)}, 단순 보유 ${fmtPct(result.buyHoldReturnPct)}, 완료 사이클 ${result.completedCycles}회`} />
              <ChartLegend lines={[...lines, { id: "mk", label: "목표가 매도", color: colors.text, style: "dotted" }]} />
              <CycleTable r={result} region={region} />
            </>
          )}
        </>
      )}
    </Section>
  );
}

/** 진행 중 사이클 현황과 오늘 살 수량 */
function OpenCycle({ r, region }: { r: DcaResult; region: Region }) {
  const o = r.openCycle;
  const p = r.params;
  if (!o) return <p className="t-2">마지막 날 목표가에 닿아 전량 매도했어요. 다음 거래일에 새 사이클을 시작해요.</p>;
  const days = Math.max(1, Math.floor(p.days));
  // 시뮬레이션은 마지막 날까지 이미 샀다고 본다. 이월 금액 = 지금까지의 하루 한도 합 − 실제로 쓴 돈
  const bought = Math.min(o.tradingDays, days);
  const carry = Math.max(0, (o.budget / days) * bought - o.invested);
  const plan = o.tradingDays < days ? dcaPlanToday({ capital: o.budget, days, dayIndex: o.tradingDays, price: r.lastClose, carry, feeRate: p.feeRate }) : null;
  const target = o.avgCost * (1 + p.targetPct / 100);
  const gap = o.shares > 0 ? (r.lastClose / o.avgCost - 1) * 100 : null;
  return (
    <div className="disc-cycle">
      <h3 className="t-body t-bold">
        진행 중 사이클 <span className="t-2">{fmtYmd(o.start)} 시작 · {fmtInt(o.tradingDays)}영업일째</span>
      </h3>
      {o.shares === 0 ? (
        <p className="t-2">아직 산 주식이 없어요. 최근 종가가 하루 한도보다 비싸면 남은 금액을 다음 날로 넘겨 모아서 사요.</p>
      ) : (
        <dl className="disc-kvgrid">
          <div className="disc-kv">
            <dt className="t-2">투입액 / 예산</dt>
            <dd className="num">
              {fmtMoney(o.invested, region)} / {fmtMoney(o.budget, region)}
            </dd>
          </div>
          <div className="disc-kv">
            <dt className="t-2">보유 수량</dt>
            <dd className="num">{fmtInt(o.shares)}주</dd>
          </div>
          <div className="disc-kv">
            <dt className="t-2">평균 단가</dt>
            <dd className="num">{fmtPrice(o.avgCost, region)}</dd>
          </div>
          <div className="disc-kv">
            <dt className="t-2">목표가(평균 단가 +{fmtNum(p.targetPct, 1)}%)</dt>
            <dd className="num">{fmtPrice(target, region)}</dd>
          </div>
          <div className="disc-kv">
            <dt className="t-2">최근 종가 · 평균 단가 대비</dt>
            <dd className="num row" style={{ justifyContent: "flex-end" }}>
              {fmtPrice(r.lastClose, region)} {gap != null && <Change pct={gap} showAbs={false} />}
            </dd>
          </div>
        </dl>
      )}
      {plan ? (
        <p>
          <b>다음 매수 수량</b>{" "}
          {plan.shares > 0 ? (
            <>
              <b className="num">{fmtInt(plan.shares)}주</b> <span className="t-2">(약 {fmtMoney(plan.spend, region)})</span>
            </>
          ) : (
            <span className="t-2">없어요 — 한도로 1주를 못 사서 다음 날로 넘겨요</span>
          )}
          <span className="t-cap">
            {" "}
            · {o.tradingDays + 1}/{days}일째 매수분, 하루 한도 {fmtMoney(plan.dailyLimit, region)}
            {carry > 0 && ` + 이월 ${fmtMoney(carry, region)}`}, 최근 종가 기준. 시뮬레이션 결과이며 주문이 아니에요.
          </span>
        </p>
      ) : o.shares > 0 ? (
        <p className="t-2">매수 기간({days}영업일)이 끝나 목표가에 닿을 때까지 보유만 해요.</p>
      ) : (
        <p className="t-2">매수 기간({days}영업일) 동안 1주도 사지 못했어요. 투자금이나 나눌 기간을 다시 정해 주세요.</p>
      )}
    </div>
  );
}

function CycleTable({ r, region }: { r: DcaResult; region: Region }) {
  return (
    <div className="ui-table-wrap disc-table-scroll">
      <table className="ui-table">
        <caption className="sr-only">적립식 사이클 기록</caption>
        <thead>
          <tr>
            <th>시작</th>
            <th>종료</th>
            <th className="r">거래일</th>
            <th className="r">투입</th>
            <th className="r">평균 단가</th>
            <th className="r">매도가</th>
            <th className="r">손익</th>
            <th className="r">수익률</th>
          </tr>
        </thead>
        <tbody>
          {[...r.cycles].reverse().map((cy) => {
            const live = cy.end == null && cy.shares > 0 ? (r.lastClose / cy.avgCost - 1) * 100 : null;
            return (
              <tr key={cy.start}>
                <td className="num">{fmtYmd(cy.start)}</td>
                <td className="num">{cy.end ? fmtYmd(cy.end) : <span className="t-2">진행 중</span>}</td>
                <td className="r num">{fmtInt(cy.tradingDays)}일</td>
                <td className="r num">{fmtMoney(cy.invested, region)}</td>
                <td className="r num">{cy.shares > 0 ? fmtPrice(cy.avgCost, region) : "-"}</td>
                <td className="r num">{cy.exitPrice == null ? "-" : fmtPrice(cy.exitPrice, region)}</td>
                <td className={`r num ${cy.pnl == null ? "flat" : cy.pnl > 0 ? "up" : cy.pnl < 0 ? "down" : "flat"}`}>{cy.pnl == null ? "-" : `${arrowOf(cy.pnl)} ${fmtPnl(cy.pnl, region)}`.trim()}</td>
                <td className="r">
                  {cy.returnPct != null ? (
                    <Change pct={cy.returnPct} showAbs={false} />
                  ) : live != null ? (
                    <span className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                      <span className="t-cap">평가</span>
                      <Change pct={live} showAbs={false} />
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            );
          })}
          {r.cycles.length === 0 && (
            <tr>
              <td colSpan={8} className="t-2">
                사이클이 없어요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
