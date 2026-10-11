import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { DEFAULT_RUN, STRATEGIES, TRADE_REASON_LABEL, compareStrategies, isValidCode, regionOf, type Market, type Region } from "@jusik/shared";
import { loadStock, type StockData } from "../../api";
import { useActions } from "../../app/actions";
import { useApp } from "../../app/AppContext";
import { navigate, useRoute } from "../../app/router";
import { useChartColors, type ChartColors } from "../../theme";
import {
  Button, Change, Chip, EvidenceStrip, Field, MarketStatus, Notice, QuoteLine, RuleTag, Section, Skeleton, Stat, Stats, Toggle,
  fmtInt, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtRatio, useBreakpoint,
} from "../../ui";
import { DcaSection } from "./DcaSection";
import { ChartLegend, EquityChart, type ChartLine } from "./EquityChart";
import { StockPicker } from "./StockPicker";
import { MIN_SAMPLE, indexEquity, periodLabel, summarizeBacktest } from "./logic";
import {
  ALL_STRATEGIES, APP_STRATEGIES, BOOK_STRATEGIES, DEFAULT_STRATEGY_ID, btCostText, btCosts, defaultParams, fmtYmd, hasRegimeToggle, runSelected, signalEvidenceFor, strategyMeta,
  type AnyBacktest, type BtParams, type StrategyMeta,
} from "./strategyRun";

const INDEX_NAME: Record<Market, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "S&P 500" };
const TF: Record<StrategyMeta["timeframe"], string> = { daily: "일봉", weekly: "주봉" };

type Loaded = { code: string; data: StockData | null; error: string | null; at: string | null };

/** 전략과 백테스트(지도서 5.3 F): 전략 목록, 종목 고르기, 백테스트 미리보기, 전략 비교, 적립식 */
export function StrategyTab() {
  const route = useRoute();
  const bp = useBreakpoint();
  const { watchlist } = useApp();
  const compact = bp === "compact";
  const id = strategyMeta(route.query.get("id"))?.id ?? DEFAULT_STRATEGY_ID;
  const rawCode = (route.query.get("code") ?? "").trim().toUpperCase();
  const code = rawCode && isValidCode(rawCode) ? rawCode : (watchlist[0] ?? "005930");
  const meta = strategyMeta(id)!;

  const go = (next: { id?: string; code?: string }) =>
    navigate(`/discover/strategy?id=${encodeURIComponent(next.id ?? id)}&code=${encodeURIComponent(next.code ?? code)}`, { replace: true });

  // 종목 시세(일봉 750개 + 지수). api가 1분 동안 기억한다
  const [loaded, setLoaded] = useState<Loaded>({ code, data: null, error: null, at: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoaded({ code, data: null, error: null, at: null });
    loadStock(code)
      .then((d) => alive && setLoaded({ code, data: d, error: null, at: new Date().toISOString() }))
      .catch((e: unknown) => alive && setLoaded({ code, data: null, error: e instanceof Error ? e.message : String(e), at: null }));
    return () => {
      alive = false;
    };
  }, [code, reload]);
  const data = loaded.code === code ? loaded.data : null;
  const region: Region = data ? regionOf(data.info.market) : /^\d{6}$/.test(code) ? "KR" : "US";

  // 고친 값(draft)은 '백테스트 실행'을 눌러야 적용(applied)된다. 지역이 바뀌면 기본값으로
  const [draft, setDraft] = useState<BtParams>(() => defaultParams(region));
  const [applied, setApplied] = useState<BtParams>(() => defaultParams(region));
  useEffect(() => {
    setDraft(defaultParams(region));
    setApplied(defaultParams(region));
  }, [region]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const run = () => setApplied(draft);

  const result = useMemo(
    () => (data ? runSelected(id, data.candles, data.indexCandles, data.info, region, applied) : null),
    [id, data, region, applied],
  );

  const runBtn = (
    <Button variant="primary" size={compact ? "lg" : "md"} block={compact} disabled={!data || !(draft.initialCash > 0)} onClick={run} icon={<Play size={16} aria-hidden="true" />}>
      백테스트 실행
    </Button>
  );

  return (
    <div className="disc-st">
      {bp === "large" ? (
        <aside className="disc-st-list" aria-label="전략 목록">
          <StrategyList id={id} onPick={(x) => go({ id: x })} />
        </aside>
      ) : (
        <div className="disc-chips scroll" role="group" aria-label="전략 고르기">
          {ALL_STRATEGIES.map((s) => (
            <Chip key={s.id} pressed={s.id === id} onClick={() => go({ id: s.id })}>
              {s.name}
            </Chip>
          ))}
        </div>
      )}

      <div className="disc-st-main">
        <Section title={meta.name} sub={`${meta.source} · ${TF[meta.timeframe]}`}>
          <p className="t-2 disc-desc">{meta.description}</p>
          {meta.rules.length > 0 && (
            <p className="disc-rules">
              <span className="t-cap">근거 규칙</span>
              {meta.rules.map((r) => (
                <RuleTag key={r} rule={r} />
              ))}
            </p>
          )}
          {meta.id === "daytrade-breakout" && <p className="t-cap">발굴의 시장 스캔이 쓰는 규칙을 종목 하나의 과거 일봉으로 다시 돌린 결과예요.</p>}
        </Section>

        <Section title="종목과 조건">
          <StockPicker code={code} onPick={(c) => go({ code: c })} />
          <StockLine loaded={loaded} code={code} />
          {data && <SignalNow id={id} data={data} />}
          <div className="disc-form">
            <Field label={`투자금(${region === "US" ? "달러" : "원"})`} htmlFor="disc-bt-cash">
              <input
                id="disc-bt-cash"
                className="ui-input num"
                type="number"
                min={0}
                step={region === "US" ? 1000 : 1_000_000}
                value={draft.initialCash}
                onChange={(e) => setDraft((d) => ({ ...d, initialCash: Math.max(0, +e.target.value || 0) }))}
                onKeyDown={(e) => e.key === "Enter" && run()}
              />
            </Field>
            {id === "app-score" && (
              <>
                <Field label="매수 기준 점수(이상)" htmlFor="disc-bt-buy">
                  <input id="disc-bt-buy" className="ui-input num" type="number" min={-100} max={100} value={draft.buyThreshold} onChange={(e) => setDraft((d) => ({ ...d, buyThreshold: +e.target.value }))} />
                </Field>
                <Field label="매도 기준 점수(이하)" htmlFor="disc-bt-sell">
                  <input id="disc-bt-sell" className="ui-input num" type="number" min={-100} max={100} value={draft.sellThreshold} onChange={(e) => setDraft((d) => ({ ...d, sellThreshold: +e.target.value }))} />
                </Field>
                <Field label="손절 %" hint="0이면 쓰지 않아요" htmlFor="disc-bt-stop">
                  <input id="disc-bt-stop" className="ui-input num" type="number" min={0} max={50} value={draft.stopPct} onChange={(e) => setDraft((d) => ({ ...d, stopPct: Math.max(0, +e.target.value || 0) }))} />
                </Field>
              </>
            )}
          </div>
          {hasRegimeToggle(id) && (
            <Toggle
              checked={draft.useRegime}
              disabled={!!data && !data.indexCandles}
              onChange={(v) => setDraft((d) => ({ ...d, useRegime: v }))}
              label="지수 약세 국면에서는 매수 안 함"
              hint={data && !data.indexCandles ? "지수 자료가 없어 쓸 수 없어요" : "와인스타인 M1-02"}
            />
          )}
          {dirty && <p className="t-2">바꾼 값은 '백테스트 실행'을 누르면 반영돼요.</p>}
          {!compact && <div>{runBtn}</div>}
        </Section>

        {loaded.error && loaded.code === code ? (
          <Notice tone="warn" title="종목 시세를 받지 못했어요" action={<Button size="sm" onClick={() => setReload((n) => n + 1)}>다시 불러오기</Button>}>
            {loaded.error}. 종목 코드를 확인하거나 잠시 뒤 다시 불러오세요.
          </Notice>
        ) : !data ? (
          <PreviewSkeleton compact={compact} />
        ) : !result ? (
          <Notice tone="warn" title="백테스트를 돌리지 못했어요">
            {!(applied.initialCash > 0)
              ? "투자금을 0보다 크게 넣고 백테스트를 실행하세요."
              : `일봉 ${fmtInt(data.candles.length)}개로는 이 전략의 지표를 계산할 수 없어요${meta.timeframe === "weekly" ? "(주봉 전략은 30주 넘는 기간이 필요해요)" : ""}. 상장한 지 오래된 종목으로 해 보세요.`}
          </Notice>
        ) : (
          <Preview result={result} data={data} meta={meta} params={applied} region={region} compact={compact} />
        )}

        {data && !compact && <Comparison data={data} region={region} cash={applied.initialCash} selected={id} onPick={(x) => go({ id: x })} />}
        {data && <DcaSection candles={data.candles} region={region} compact={compact} name={data.info.name} />}
      </div>
      {compact && <div className="disc-bottom-bar">{runBtn}</div>}
    </div>
  );
}

/** 전략 목록(컴퓨터): 책 전략과 앱 기본 전략 */
function StrategyList({ id, onPick }: { id: string; onPick: (id: string) => void }) {
  const group = (title: string, list: StrategyMeta[]) => (
    <div className="disc-st-group">
      <h2 className="t-cap disc-st-group-title">{title}</h2>
      <ul className="disc-plain" role="list">
        {list.map((s) => (
          <li key={s.id}>
            <button type="button" className="disc-st-item" aria-current={s.id === id ? "true" : undefined} onClick={() => onPick(s.id)}>
              <span className="t-medium">{s.name}</span>
              <span className="t-cap">
                {s.source} · {TF[s.timeframe]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <>
      {group("책 전략", BOOK_STRATEGIES)}
      {group("앱 기본 전략", APP_STRATEGIES)}
      <p className="t-cap disc-st-note">시장 전체 스캔은 단타 돌파 규칙만 돌려요. 여기 전략은 종목 하나의 과거 일봉으로 시험해요.</p>
    </>
  );
}

/** 고른 종목 한 줄: 이름·현재가·등락, 장 상태와 기준 시각, 종목 분석 열기 */
function StockLine({ loaded, code }: { loaded: Loaded; code: string }) {
  const { now, openStock } = useApp();
  const d = loaded.code === code ? loaded.data : null;
  if (!d && loaded.error)
    return (
      <div className="disc-stockline">
        <span className="t-section">{code}</span>
        <span className="t-2">시세를 받지 못했어요</span>
      </div>
    );
  if (!d)
    return (
      <div className="disc-stockline" aria-busy={!loaded.error}>
        <Skeleton w={160} h={20} />
        <Skeleton w={120} h={14} />
      </div>
    );
  const region = regionOf(d.info.market);
  return (
    <div className="disc-stockline">
      <span className="row base wrap">
        <span className="t-section">{d.info.name}</span>
        <span className="t-cap">
          {d.info.code} · {d.info.market}
        </span>
      </span>
      <QuoteLine name={d.info.name} price={d.quote.price} change={d.quote.change} pct={d.quote.changePct} region={region} />
      <MarketStatus region={region} now={now} asOf={loaded.at} />
      <Button variant="link" onClick={() => openStock(d.info.code)} icon={<ExternalLink size={14} aria-hidden="true" />}>
        종목 분석 열기
      </Button>
    </div>
  );
}

/** 고른 전략으로 본 이 종목의 지금 신호(근거 스트립 + 근거 보기). 근거 칸이 없는 전략은 그렇다고 쓴다 */
function SignalNow({ id, data }: { id: string; data: StockData }) {
  const { server } = useApp();
  const { openEvidence } = useActions();
  const cand = server?.latestScan?.candidates.find((c) => c.code === data.info.code) ?? null;
  const ev = signalEvidenceFor(id, data.analysis, cand);
  if (!ev)
    return (
      <p className="t-cap">
        {id === "daytrade-breakout"
          ? "이 종목은 최근 스캔 후보가 아니라 지금 단타 돌파 근거를 보여 줄 수 없어요. 아래 과거 백테스트로 규칙을 확인하세요."
          : "이 전략은 근거 칸을 따로 정의하지 않아 지금 신호 대신 과거 백테스트만 보여 줘요."}
      </p>
    );
  return (
    <div className="disc-signal">
      <span className="t-2">지금 신호</span>
      <span className="t-medium">{ev.headline}</span>
      <EvidenceStrip
        evidence={ev}
        onOpen={() => openEvidence({ title: `${data.info.name} 근거`, evidence: ev, code: data.info.code, notes: cand?.notes })}
      />
    </div>
  );
}

/** F. 백테스트 미리보기: 기간·비용 반영을 제목 옆에, 연평균 수익률·최대 낙폭·승률·손익비, 전략 대 단순 보유·지수 */
function Preview({ result, data, meta, params, region, compact }: { result: AnyBacktest; data: StockData; meta: StrategyMeta; params: BtParams; region: Region; compact: boolean }) {
  const colors = useChartColors();
  const s = summarizeBacktest(result);
  const idxName = INDEX_NAME[data.info.market];
  const lines = useMemo<ChartLine[]>(() => {
    const out: ChartLine[] = [
      { id: "st", label: "전략", color: colors.accent, width: 2, data: result.equity.map((p) => ({ date: p.date, value: p.equity })) },
      { id: "bh", label: "단순 보유", color: colors.muted, width: 1, style: "dashed", data: result.equity.map((p) => ({ date: p.date, value: p.buyHold })) },
    ];
    const ix = indexEquity(result.equity, data.indexCandles, params.initialCash);
    if (ix.length > 1) out.push({ id: "ix", label: idxName, color: colors.ma60, width: 1, style: "dotted", data: ix });
    return out;
  }, [result, data.indexCandles, params.initialCash, colors, idxName]);
  const ixRet = lines.find((l) => l.id === "ix")?.data;
  const ixPct = ixRet && ixRet.length > 1 ? (ixRet.at(-1)!.value / ixRet[0]!.value - 1) * 100 : null;
  const period = periodLabel(result.equity);
  const summary = `${meta.name} 자산 ${fmtPct(s.totalReturnPct)}, 단순 보유 ${fmtPct(s.buyHoldReturnPct)}${ixPct != null ? `, ${idxName} ${fmtPct(ixPct)}` : ""}, 기간 ${period}`;

  return (
    <Section title="백테스트 미리보기" sub={`${period}, 수수료와 세금 반영`}>
      <p className="t-cap">
        {data.info.name} · {meta.name} · 다음 날 시가 체결 · {btCostText(region, meta.id !== "app-score" && meta.id !== "app-stage")}
        {!data.indexCandles && " · 지수 자료가 없어 지수 약세 국면 거르기 없이 돌렸어요"} · 재무 지표는 과거 시점 자료가 없어 넣지 않았어요
      </p>
      <Stats n={compact ? 2 : 4}>
        <Stat value={<Change pct={s.cagrPct} showAbs={false} />} label="연평균 수익률" />
        <Stat value={<Change pct={s.maxDrawdownPct} showAbs={false} />} label="최대 낙폭" />
        <Stat value={s.winRatePct == null ? "-" : fmtRatio(s.winRatePct, 0)} label={`승률 · ${fmtInt(s.tradeCount)}회`} />
        <Stat value={s.payoff == null ? "-" : s.payoff.toFixed(2)} label="손익비" />
      </Stats>
      {!compact && (
        <dl className="disc-kvrow">
          <div>
            <dt className="t-2">총수익률</dt>
            <dd>
              <Change pct={s.totalReturnPct} showAbs={false} />
            </dd>
          </div>
          <div>
            <dt className="t-2">단순 보유</dt>
            <dd>
              <Change pct={s.buyHoldReturnPct} showAbs={false} />
            </dd>
          </div>
          {ixPct != null && (
            <div>
              <dt className="t-2">{idxName}</dt>
              <dd>
                <Change pct={ixPct} showAbs={false} />
              </dd>
            </div>
          )}
          <div>
            <dt className="t-2">최종 평가금액</dt>
            <dd className="num">{fmtMoney(s.finalEquity, region)}</dd>
          </div>
          {s.expectancyPct != null && (
            <div>
              <dt className="t-2">거래당 기대값</dt>
              <dd>
                <Change pct={s.expectancyPct} showAbs={false} />
              </dd>
            </div>
          )}
          {s.kellyPct != null && (
            <div>
              <dt className="t-2">켈리 비중(절반)</dt>
              <dd className="num">
                {fmtRatio(s.kellyPct, 0)} ({fmtRatio(s.halfKellyPct, 0)})
              </dd>
            </div>
          )}
        </dl>
      )}
      {s.tradeCount < 10 && (
        <Notice tone="info">
          청산 거래가 {fmtInt(s.tradeCount)}회뿐이라 승률·손익비는 통계로서 의미가 약해요. 여러 종목, 더 긴 기간으로 확인하세요.
        </Notice>
      )}
      {!compact && s.totalReturnPct < s.buyHoldReturnPct && <p className="t-2">이 구간에서는 신호 매매가 단순 보유보다 수익이 낮았어요. 최대 낙폭(하락 방어)까지 같이 비교해 보세요.</p>}
      {s.openPosition && <p className="t-cap">마지막 날 보유 중인 포지션이 있어요. 거래 기록에는 청산한 거래만 있어요.</p>}
      {!compact && (
        <>
          <EquityChart lines={lines} summary={summary} />
          <ChartLegend lines={lines} />
          <TradeTable result={result} region={region} />
        </>
      )}
    </Section>
  );
}

function TradeTable({ result, region }: { result: AnyBacktest; region: Region }) {
  if (!result.trades.length) return <p className="t-2">이 구간에서는 청산한 거래가 없어요.</p>;
  const hasReasons = result.trades.some((t) => t.entryReason);
  return (
    <details className="disc-details" open={result.trades.length <= 12}>
      <summary className="t-medium">거래 기록 {fmtInt(result.trades.length)}건</summary>
      <div className="ui-table-wrap disc-table-scroll">
        <table className="ui-table">
          <caption className="sr-only">백테스트 거래 기록(최근 순)</caption>
          <thead>
            <tr>
              <th>매수일</th>
              <th className="r">매수가</th>
              <th>매도일</th>
              <th className="r">매도가</th>
              <th className="r">수량</th>
              <th className="r">수익률</th>
              {hasReasons && <th>진입 근거</th>}
              <th>청산</th>
            </tr>
          </thead>
          <tbody>
            {[...result.trades].reverse().map((t, i) => (
              <tr key={i}>
                <td className="num">{fmtYmd(t.buyDate)}</td>
                <td className="r num">{fmtPrice(t.buyPrice, region)}</td>
                <td className="num">{fmtYmd(t.sellDate)}</td>
                <td className="r num">{fmtPrice(t.sellPrice, region)}</td>
                <td className="r num">
                  {fmtInt(t.shares)}
                  {t.fraction != null && t.fraction < 0.999 && <span className="t-cap"> ({Math.round(t.fraction * 100)}%)</span>}
                </td>
                <td className="r">
                  <Change pct={t.returnPct} showAbs={false} />
                </td>
                {hasReasons && (
                  <td className="disc-reason">
                    {t.entryReason} <RuleTag rule={t.entryRule} />
                  </td>
                )}
                <td className="disc-reason">
                  <span className="t-medium">{TRADE_REASON_LABEL[t.reason]}</span>
                  {t.exitReason && <> · {t.exitReason}</>} <RuleTag rule={t.exitRule} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** 전략별 선 색과 모양: 상승·하락 색과 겹치지 않게 차트 전용 색 + 선 모양으로 나눈다 */
function lineStyleOf(c: ChartColors, i: number): Pick<ChartLine, "color" | "style"> {
  const colors = [c.accent, c.ma5, c.ma60, c.text];
  return { color: colors[i % colors.length]!, style: i < colors.length ? "solid" : "dashed" };
}

/** 전략 비교: 같은 종목·같은 기간·같은 비용으로 책 전략을 모두 돌린다. 행을 누르면 그 전략을 미리보기로 */
function Comparison({ data, region, cash, selected, onPick }: { data: StockData; region: Region; cash: number; selected: string; onPick: (id: string) => void }) {
  const colors = useChartColors();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const { feeRate, sellTaxRate } = btCosts(region);
  const rows = useMemo(
    () =>
      cash > 0
        ? compareStrategies(data.candles, { index: data.indexCandles ?? undefined, ref: { code: data.info.code, name: data.info.name, market: data.info.market } }, undefined, { initialCash: cash, feeRate, sellTaxRate })
        : [],
    [data, cash, feeRate, sellTaxRate],
  );
  const ran = rows.filter((r) => r.result);
  const best = useMemo(() => {
    const traded = ran.filter((r) => r.result!.tradeCount > 0 || r.result!.openPosition);
    const [a, b] = [...traded].sort((x, y) => y.result!.totalReturnPct - x.result!.totalReturnPct);
    return a && b && a.result!.totalReturnPct > b.result!.totalReturnPct ? a.id : null;
  }, [ran]);
  const lines = useMemo<ChartLine[]>(() => {
    if (!ran.length) return [];
    const out: ChartLine[] = ran.map((r, i) => ({ id: r.id, label: r.name, width: 2, ...lineStyleOf(colors, i), data: r.result!.equity.map((p) => ({ date: p.date, value: p.equity })) }));
    out.push({ id: "__bh", label: "단순 보유", color: colors.muted, width: 1, style: "dotted", data: ran[0]!.result!.equity.map((p) => ({ date: p.date, value: p.buyHold })) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, colors]);
  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const style = new Map(ran.map((r, i) => [r.id, lineStyleOf(colors, i)]));
  const first = ran[0]?.result?.equity;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);

  return (
    <Section title="전략 비교" sub={first ? `${periodLabel(first)}, 같은 종목·같은 비용` : undefined}>
      <p className="t-2">
        규칙이 다른 책 전략 {STRATEGIES.length}개를 같은 종목·같은 기간·같은 비용으로 돌려요. 각 전략의 기준값은 저자 경험칙이라 검증된 통계가 아니에요.
      </p>
      {lines.length > 0 && (
        <>
          <EquityChart lines={lines} hidden={hidden} height={260} summary={`전략 ${ran.length}개의 자산 곡선과 단순 보유 비교`} />
          <ChartLegend lines={lines} hidden={hidden} onToggle={toggle} />
        </>
      )}
      <div className="ui-table-wrap disc-table-scroll">
        <table className="ui-table">
          <caption className="sr-only">전략 비교(행을 누르면 그 전략을 미리보기로)</caption>
          <thead>
            <tr>
              <th>전략</th>
              <th className="r">총수익률</th>
              <th className="r">단순 보유</th>
              <th className="r">연평균</th>
              <th className="r">최대 낙폭</th>
              <th className="r">거래 수</th>
              <th className="r">승률</th>
              <th className="r">거래당 평균</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const res = r.result;
              const avg = res ? mean(res.trades.map((t) => t.returnPct)) : null;
              const st = style.get(r.id);
              return (
                <tr key={r.id} className={`click ${r.id === selected ? "sel" : ""}`} tabIndex={0} onClick={() => onPick(r.id)} onKeyDown={(e) => e.key === "Enter" && onPick(r.id)} aria-selected={r.id === selected}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      {st && <i className={`disc-swatch ${st.style}`} style={{ borderColor: st.color }} aria-hidden="true" />}
                      <div className="stack" style={{ gap: 0 }}>
                        <span className="t-medium">
                          {r.name}
                          {best === r.id && <span className="disc-tag">이 구간 최고</span>}
                        </span>
                        <span className="t-cap">
                          {r.source} · {TF[r.timeframe]}
                        </span>
                      </div>
                    </div>
                  </td>
                  {!res ? (
                    <td colSpan={7} className="t-2">
                      시세 기간이 짧아 돌리지 못했어요.
                    </td>
                  ) : (
                    <>
                      <td className="r">
                        <Change pct={res.totalReturnPct} showAbs={false} />
                      </td>
                      <td className="r">
                        <Change pct={res.buyHoldReturnPct} showAbs={false} />
                      </td>
                      <td className="r">
                        <Change pct={res.cagrPct} showAbs={false} />
                      </td>
                      <td className="r">
                        <Change pct={res.maxDrawdownPct} showAbs={false} />
                      </td>
                      <td className="r num">
                        {fmtInt(res.tradeCount)}회{res.tradeCount < MIN_SAMPLE && <span className="disc-tag warn">표본 부족</span>}
                      </td>
                      <td className="r num">{res.tradeCount ? fmtRatio(res.winRatePct, 0) : "-"}</td>
                      <td className="r">{avg == null ? <span className="t-2">-</span> : <Change pct={avg} showAbs={false} />}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="t-cap">
        모든 전략을 같은 기간·같은 비용으로 돌렸어요(다음 날 시가 체결, 수수료·세금·슬리피지 {fmtNum(DEFAULT_RUN.slippagePct, 2)}% 반영). '이 구간 최고'는 이 종목·이 구간에서 수익률이 가장
        높았다는 뜻일 뿐이에요. 한 종목의 과거 결과에 맞춰 전략을 고르면 과최적화되기 쉬우니 여러 종목·기간에서 같이 확인하세요. 거래가 {MIN_SAMPLE}회 미만이면 '표본 부족'으로 표시하고, 분할
        매도도 한 건으로 세요.
      </p>
    </Section>
  );
}

function PreviewSkeleton({ compact }: { compact: boolean }) {
  return (
    <section className="ui-section" aria-busy="true" aria-label="백테스트 불러오는 중">
      <Skeleton w={200} h={20} />
      <div className="ui-stats" style={{ ["--n" as string]: compact ? 2 : 4 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="stack" style={{ gap: 4 }}>
            <Skeleton w="70%" h={24} />
            <Skeleton w="40%" h={12} />
          </div>
        ))}
      </div>
      {!compact && <Skeleton h={280} />}
    </section>
  );
}
