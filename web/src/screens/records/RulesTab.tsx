import { Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MIN_RELIABLE, type Evaluation, type Market, type ReplayRun, type Stats } from "@jusik/shared";
import { getPaperEval, getReplay, runReplay, saveSettings } from "../../api";
import { useApp } from "../../app/AppContext";
import { navigate } from "../../app/router";
import { Button, Chip, EmptyState, fmtDate, fmtInt, fmtNum, fmtWhen, Notice, Section, Segmented, Sheet, Skeleton, SkeletonRows, Stat, Stats as StatRow, useBreakpoint, useToast } from "../../ui";
import { Ret } from "./parts";

/*
 * 규칙 점검: 단타 규칙(최소 점수 기준)이 실제로 통했는지 본다.
 *  ① 모의매매 실적 — 모의매매가 남긴 매수·매도를 짝지어 진입 당시 점수·거래량·상승률·국면별로 결과를 나눈다
 *  ② 과거 재현 — 과거 일봉에 지금 규칙을 그대로 적용(참고용)
 * 기준 제안은 앞 절반에서 고른 기준이 뒤 절반에서도 나았을 때만 나온다. 적용은 확인 시트를 거친다.
 */

const MARKET_LABEL: Record<Market, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "미국" };
const COUNTS = [
  { value: "250", label: "약 1년" },
  { value: "500", label: "약 2년" },
  { value: "1000", label: "약 4년" },
];

const winText = (s: Stats) => (s.winRate == null ? "-" : `${Math.round(s.winRate * 100)}%`);

function StatCells({ s }: { s: Stats }) {
  return (
    <>
      <td className="r num">
        {fmtInt(s.n)}
        {!s.reliable && (
          <span className="t-cap" title={`${MIN_RELIABLE}건 미만은 우연일 수 있어요`}>
            {" "}
            *
          </span>
        )}
      </td>
      <td className="r num">{winText(s)}</td>
      <td className="r">
        <Ret pct={s.expectancyPct} />
      </td>
      <td className="r">
        <Ret pct={s.lowerBoundPct} />
      </td>
      <td className="r num">{s.profitFactor == null ? "-" : fmtNum(s.profitFactor, 2)}</td>
    </>
  );
}

function StatHead() {
  return (
    <>
      <th scope="col" className="r">
        거래
      </th>
      <th scope="col" className="r">
        승률
      </th>
      <th scope="col" className="r" title="거래당 평균 순수익률(비용 반영)">
        기대값
      </th>
      <th scope="col" className="r" title="기대값의 95% 신뢰구간 하단. 0보다 커야 우연이 아닐 가능성이 높아요">
        기대값 하한
      </th>
      <th scope="col" className="r" title="총이익 ÷ 총손실">
        PF
      </th>
    </>
  );
}

function EvaluationPanel({ ev, currentMin, onApply, idBase }: { ev: Evaluation; currentMin: number; onApply: (n: number) => void; idBase: string }) {
  const o = ev.overall;
  const s = ev.suggestion;
  const canApply = s.minScore != null && s.minScore !== currentMin;
  return (
    <div className="stack-4">
      <p className="t-cap">
        기간 {ev.from ? fmtDate(ev.from) : "-"} ~ {ev.to ? fmtDate(ev.to) : "-"} · 수익률은 모두 수수료·세금·슬리피지를 뺀 값 · * 표시는 표본 {MIN_RELIABLE}건 미만
      </p>
      <StatRow n={4}>
        <Stat value={`${fmtInt(o.n)}건`} label="거래" />
        <Stat value={winText(o)} label="승률" />
        <Stat value={<Ret pct={o.expectancyPct} />} label="거래당 기대값" />
        <Stat value={<Ret pct={o.lowerBoundPct} />} label="기대값 95% 하한" />
      </StatRow>
      <p className="t-2">
        평균 이익 <Ret pct={o.avgWinPct} /> · 평균 손실 <Ret pct={o.avgLossPct} />
      </p>

      <Notice
        tone="info"
        title={s.minScore != null ? `기준 제안: 최소 점수 ${s.minScore}점` : "기준 제안: 바꾸지 않음"}
        action={
          canApply ? (
            <Button variant="secondary" size="sm" className="rec-touch-btn" onClick={() => onApply(s.minScore!)}>
              이 기준 적용
            </Button>
          ) : undefined
        }
      >
        {s.reason}
      </Notice>

      <div className="stack">
        <h3 className="rec-lbl" id={`${idBase}-th`}>
          최소 점수 기준별 성과 <span className="t-cap">앞 절반에서 고른 기준이 뒤 절반에서도 통하는지 봐요. 지금 {currentMin}점</span>
        </h3>
        <div className="ui-table-wrap">
          <table className="ui-table rec-eval-table" aria-labelledby={`${idBase}-th`}>
            <thead>
              <tr>
                <th scope="col">기준</th>
                <StatHead />
                <th scope="col" className="r">
                  앞 절반 기대값
                </th>
                <th scope="col" className="r">
                  뒤 절반 기대값
                </th>
              </tr>
            </thead>
            <tbody>
              {ev.thresholds
                .filter((t) => t.all.n > 0)
                .map((t) => (
                  <tr key={t.minScore} className={t.minScore === currentMin ? "sel" : ""} aria-current={t.minScore === currentMin ? "true" : undefined}>
                    <th scope="row" className="rec-cellname num">
                      {t.minScore}점 이상{t.minScore === currentMin && <span className="t-cap"> 지금</span>}
                    </th>
                    <StatCells s={t.all} />
                    <td className="r">
                      <Ret pct={t.firstHalf.expectancyPct} /> <span className="t-cap num">({fmtInt(t.firstHalf.n)})</span>
                    </td>
                    <td className="r">
                      <Ret pct={t.secondHalf.expectancyPct} /> <span className="t-cap num">({fmtInt(t.secondHalf.n)})</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rec-eval-groups">
        {ev.groups.map((g) => (
          <div key={g.title} className="stack">
            <h3 className="rec-lbl" id={`${idBase}-g-${g.title}`}>
              {g.title}별
            </h3>
            <div className="ui-table-wrap">
              <table className="ui-table rec-eval-table" aria-labelledby={`${idBase}-g-${g.title}`}>
                <thead>
                  <tr>
                    <th scope="col">조건</th>
                    <StatHead />
                  </tr>
                </thead>
                <tbody>
                  {g.buckets.map((b) => (
                    <tr key={b.label}>
                      <th scope="row" className="rec-cellname">
                        {b.label}
                      </th>
                      <StatCells s={b.stats} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RulesTab() {
  const { server, refreshServer } = useApp();
  const toast = useToast();
  const bp = useBreakpoint();
  const currentMin = server?.settings.minScore ?? 55;
  const [paper, setPaper] = useState<{ evaluation: Evaluation; tradeCount: number } | null>(null);
  const [paperErr, setPaperErr] = useState("");
  const [replay, setReplay] = useState<ReplayRun | null>(null);
  const [replayLoaded, setReplayLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  /** 다른 화면에서 시작한 재현이 아직 도는 중(끝날 때까지 5초마다 확인) */
  const [remote, setRemote] = useState(false);
  const [markets, setMarkets] = useState<Record<Market, boolean>>({ KOSPI: true, KOSDAQ: true, US: true });
  const [count, setCount] = useState("500");
  const [err, setErr] = useState("");
  const [apply, setApply] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);

  const load = useCallback(() => {
    getPaperEval()
      .then((r) => (setPaper(r), setPaperErr("")))
      .catch((e: Error) => setPaperErr(e.message));
    getReplay()
      .then((r) => {
        setReplay(r.run);
        setRemote(r.running);
      })
      .catch(() => {})
      .finally(() => setReplayLoaded(true));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!remote || running) return;
    const t = setInterval(() => {
      getReplay()
        .then((r) => {
          setReplay(r.run);
          setRemote(r.running);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [remote, running]);

  const chosen = (Object.keys(markets) as Market[]).filter((m) => markets[m]);
  const run = async () => {
    setRunning(true);
    setErr("");
    try {
      const r = await runReplay({ markets: chosen, count: Number(count) });
      setReplay(r.run);
      toast(`과거 재현을 마쳤어요. 거래 ${fmtInt(r.run.tradeCount)}건`, "ok");
    } catch (e) {
      setErr(`재현하지 못했어요. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const doApply = async () => {
    if (apply == null) return;
    setApplying(true);
    try {
      await saveSettings({ minScore: apply });
      await refreshServer();
      toast(`최소 점수를 ${apply}점으로 바꿨어요`, "ok");
      setApply(null);
      load();
    } catch (e) {
      toast(`설정을 바꾸지 못했어요. ${e instanceof Error ? e.message : ""}`, "warn");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rec-rules stack-5">
      <Section title="모의매매 실적으로 점검" sub="가장 현실에 가까운 근거, 쌓이는 데 시간이 걸려요">
        <p className="t-2 rec-lead">모의매매가 자동으로 남긴 매수·매도 기록을 짝지어, 진입 당시 점수·거래량·상승률·시장 국면별로 실제 결과를 나눠 봐요.</p>
        {paperErr ? (
          <Notice tone="warn" title="모의매매 실적을 불러오지 못했어요" action={<Button variant="secondary" size="sm" icon={<RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={load}>다시 불러오기</Button>}>
            {paperErr} 서버가 켜져 있는지 확인해 주세요.
          </Notice>
        ) : !paper ? (
          <div className="stack-3" role="status" aria-label="불러오는 중">
            <div className="rec-skel-stats">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} h={44} />
              ))}
            </div>
            <SkeletonRows rows={4} h={20} />
          </div>
        ) : paper.evaluation.overall.n === 0 ? (
          <EmptyState
            title="점검할 모의매매 거래가 아직 없어요"
            action={
              <div className="row wrap">
                <Button variant="secondary" onClick={() => navigate("/settings")}>
                  모의매매 설정 열기
                </Button>
              </div>
            }
          >
            설정에서 모의매매를 켜 두면 장중에 기록이 쌓여요. 그 전에는 아래 과거 재현으로 먼저 확인할 수 있어요.
          </EmptyState>
        ) : (
          <EvaluationPanel ev={paper.evaluation} currentMin={currentMin} onApply={setApply} idBase="rec-paper" />
        )}
      </Section>

      <Section title="과거 데이터로 재현" sub="참고용">
        <p className="t-2 rec-lead">
          종목별 과거 일봉에 지금 규칙을 그대로 적용해요(신호 다음 날 시가 진입, 같은 날 손절가와 목표가에 모두 닿으면 손절로 처리). 대상은 내장 종목 목록과 지금까지 스캔에 나온 종목이라 매일 거래량 상위에서 고르는 실제 스캔과
          구성이 달라요(대형주 위주). 실제 스캔은 장중에 들어가므로 체결 가격도 달라요.
        </p>
        <div className="rec-replay-form">
          <div className="stack" style={{ gap: 4 }}>
            <span className="rec-lbl" id="rec-rp-mk">
              시장
            </span>
            <div className="ui-chips" role="group" aria-labelledby="rec-rp-mk">
              {(Object.keys(MARKET_LABEL) as Market[]).map((m) => (
                <Chip key={m} pressed={markets[m]} onClick={() => setMarkets({ ...markets, [m]: !markets[m] })}>
                  {MARKET_LABEL[m]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="rec-lbl">기간</span>
            <Segmented label="재현 기간" value={count} onChange={setCount} options={COUNTS} />
          </div>
          <Button variant="primary" busy={running || remote} disabled={!chosen.length} icon={<Play size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={run}>
            {running || remote ? "재현 중" : "재현 실행"}
          </Button>
        </div>
        <span className="t-cap" aria-live="polite">
          {!chosen.length ? "시장을 하나 이상 고르세요." : "종목 수에 따라 1~3분 걸려요. 그동안 다른 화면을 봐도 돼요."}
        </span>
        {err && <Notice tone="warn">{err} 잠시 뒤 다시 실행해 보세요.</Notice>}
        {!replayLoaded ? (
          <SkeletonRows rows={3} h={20} />
        ) : replay ? (
          <div className="stack-4">
            <p className="t-2">
              마지막 재현 {fmtWhen(replay.at)} · {replay.markets.map((m) => MARKET_LABEL[m]).join(", ")} · {fmtInt(replay.codesTested)}종목 · 거래 {fmtInt(replay.tradeCount)}건 · 일봉 {fmtInt(replay.candleCount)}개
            </p>
            {replay.errors.length > 0 && (
              <Notice tone="warn" title={`읽지 못한 항목 ${fmtInt(replay.errors.length)}건`}>
                <ul className="rec-issues">
                  {replay.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                {replay.errors.length > 5 && <span className="t-cap">그 밖에 {fmtInt(replay.errors.length - 5)}건</span>}
              </Notice>
            )}
            <EvaluationPanel ev={replay.evaluation} currentMin={currentMin} onApply={setApply} idBase="rec-replay" />
          </div>
        ) : (
          <p className="t-2">아직 재현한 적이 없어요. 시장과 기간을 고르고 '재현 실행'을 누르세요.</p>
        )}
      </Section>

      <p className="t-cap rec-foot">
        기대값이 플러스여도 하한이 0 아래면 우연일 수 있어요. 승률보다 기대값과 그 하한을 보세요. 기준을 자주 바꾸면 과거에만 맞는 규칙이 되기 쉬워서, 제안은 앞·뒤 기간 모두에서 나았을 때만 나와요.
      </p>

      <Sheet
        open={apply != null}
        onClose={() => setApply(null)}
        title="최소 점수 바꾸기"
        side={bp === "compact" ? "bottom" : "center"}
        footer={
          <div className="rec-del-actions">
            <Button variant="ghost" onClick={() => setApply(null)}>
              취소
            </Button>
            <Button variant="primary" busy={applying} onClick={doApply}>
              {apply != null ? `${apply}점으로 바꾸기` : "바꾸기"}
            </Button>
          </div>
        }
      >
        <p>
          단타 후보의 최소 점수를 <span className="num t-medium">{currentMin}점</span>에서 <span className="num t-medium">{apply ?? "-"}점</span>으로 바꿀까요?
        </p>
        <p className="t-2" style={{ marginTop: 8 }}>
          다음 스캔부터 적용돼요. 설정 화면에서 언제든 되돌릴 수 있어요.
        </p>
      </Sheet>
    </div>
  );
}
