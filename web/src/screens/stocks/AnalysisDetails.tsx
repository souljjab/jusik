import { AlertTriangle } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import {
  ACTION_LABEL, BUY_ACTIONS, expectancy, josa, POSTURE_LABEL, REGIME_LABEL, regionOfCode, screeningNotes, STAGE_LABEL, summarizeJournal,
  VALUATION_RULES, type Action, type Analysis, type BandPosition, type BreadthResponse, type DailySignal, type JournalEntry, type RegimeAssessment,
  type Region, type ScreeningResult, type Settings,
} from "@jusik/shared";
import { Link } from "../../app/router";
import { defaultBuyQty } from "../../features/orderMath";
import { fmtDate, fmtInt, fmtMoney, fmtNum, fmtPct, fmtPnl, fmtPrice, fmtRatio, NoteList, RegimeGauge, RuleTag } from "../../ui";
import { CandleMasterDetail, candleStatus } from "./CandleMasterDetail";

/*
 * 분석 자세히(예전 분석 카드의 4단계 파이프라인): 시장 국면 → 종목 스크리닝 → 진입·청산 타이밍 → 리스크·비중,
 * 그리고 별도 매매법인 캔들마스터 주봉. 근거 패널 아래에 접을 수 있는 구역으로 둔다(요약 한 줄 + 펼치면 자세히).
 */

const ACTION_HINT: Record<Action, string> = {
  STRONG_BUY: "신규 매수 가능 구간이에요. 나눠서 들어가는 걸 권해요",
  BUY: "신규 매수 가능 구간이에요. 나눠서 들어가는 걸 권해요",
  HOLD: "신규 매수는 기다려요. 보유 중이면 손절가만 지켜요",
  SELL: "보유 중이면 비중 축소·청산을 검토해요",
  STRONG_SELL: "신규 매수는 하지 않아요. 보유 중이면 청산을 검토해요",
};

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
/** 받침 유무로 '이라/라'(공격이라·중립이라·방어라) */
const ira = (word: string) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 !== 0 ? "이라" : "라";
};
const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");

/** 리스크·비중 계산의 계좌 기준(주문 상자·주문 검토 시트와 같은 기준) */
export interface AccountBase {
  /** 계좌 기준 금액(그 시장 통화): 모의매매를 켰으면 모의계좌 자산, 아니면 예수금 */
  capital: number;
  paper: boolean;
  /** 직접 기록한 보유 수량 */
  held: number;
}

function Step({ n, title, summary, children, open = false }: { n?: number; title: string; summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="stk-step" open={open}>
      <summary>
        <span className="stk-step-title">
          {n != null && <span className="stk-step-n" aria-hidden="true">{n}</span>}
          <span className="t-bold">{title}</span>
        </span>
        <span className="t-2 stk-step-sum">{summary}</span>
      </summary>
      <div className="stk-step-body">{children}</div>
    </details>
  );
}

export function ActionLabel({ action }: { action: Action }) {
  const cls = BUY_ACTIONS.includes(action) ? "buy" : action === "SELL" || action === "STRONG_SELL" ? "sell" : "";
  return <span className={`stk-action ${cls}`}>{ACTION_LABEL[action]}</span>;
}

const BREAKDOWN: [keyof RegimeAssessment["breakdown"], string][] = [["stage", "주봉 단계"], ["macd", "MACD"], ["rsi", "RSI"], ["macro", "매크로"], ["breadth", "시장 폭"]];

function PostureView({ p }: { p: RegimeAssessment }) {
  return (
    <div className="stack-3">
      <RegimeGauge posture={p.posture} />
      <dl className="stk-kv">
        <dt>국면 점수</dt>
        <dd className="num t-medium">{signed(p.score)}</dd>
        {BREAKDOWN.map(([k, label]) => (
          <div key={k} className="stk-kv-pair">
            <dt>{label}</dt>
            <dd className="num">{signed(p.breakdown[k] ?? 0)}</dd>
          </div>
        ))}
        <dt>주식 투자 상한</dt>
        <dd className="num t-medium">{fmtRatio(p.exposureCapPct, 0)}</dd>
      </dl>
      {p.choppy && (
        <p className="warn-text t-2 row">
          <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" /> 최근 MACD 교차가 잦아 횡보장일 수 있어요
        </p>
      )}
      <NoteList notes={p.notes} dense />
      <p className="t-cap">지수 기준일 {fmtDate(p.asOf)}</p>
    </div>
  );
}

function BreadthLine({ b }: { b: BreadthResponse | null }) {
  if (!b || b.pending) return <p className="t-cap">시장 폭을 계산하는 중이에요. 잠시 뒤 다시 열면 국면 점수에 더해져요.</p>;
  const x = b.analysis;
  if (!x) return <p className="t-cap">시장 폭을 계산하지 못해 국면 점수에서 뺐어요{b.errors.length ? `(받지 못한 항목 ${b.errors.length}개)` : ""}.</p>;
  return (
    <p className="t-cap">
      시장 폭: {x.basis} · {fmtDate(x.asOf)} 집계 {fmtInt(x.sampleSize)}종목{b.sample ? " · 샘플 자료" : ""}
    </p>
  );
}

const BAND_POSITION_LABEL: Record<BandPosition, string> = { below: "밴드 최저 이하", low: "밴드 하단 이하", mid: "밴드 중간", high: "밴드 상단 이상", above: "밴드 최고 이상" };

function ValuationLine({ v }: { v: Analysis["valuation"] }) {
  const b = v.band;
  const cur = b.current;
  const ps = v.psr;
  return (
    <dl className="stk-kv">
      <dt>
        PER <RuleTag rule="M2-09" />
      </dt>
      <dd>
        {!cur ? (
          <span className="t-2">- (확정 EPS 없음)</span>
        ) : cur.per == null ? (
          <span className="t-2">- (최근 12개월 적자)</span>
        ) : (
          <>
            <span className="num t-medium">{fmtNum(cur.per, 1)}배</span>
            <span className="t-cap">{b.position && b.stats ? `최근 ${b.years}년 ${BAND_POSITION_LABEL[b.position]}` : `밴드 표본 부족 · ${b.n}거래일`}</span>
          </>
        )}
      </dd>
      <dt>
        PSR <RuleTag rule="M2-10" />
      </dt>
      <dd>
        {ps ? (
          <span className={`num t-medium ${ps.psr >= VALUATION_RULES.psrBubble ? "warn-text" : ""}`}>{fmtNum(ps.psr, 1)}배</span>
        ) : (
          <span className="t-2">- (시가총액·매출 확인 불가)</span>
        )}
      </dd>
    </dl>
  );
}

function ExcludedNotice({ s }: { s: ScreeningResult }) {
  const failed = s.exclusions.filter((c) => c.status === "fail");
  if (!s.excluded || !failed.length) return null;
  return (
    <div className="ui-notice warn" role="note">
      <AlertTriangle className="ico" size={16} strokeWidth={1.5} aria-hidden="true" />
      <div className="stack" style={{ gap: 2 }}>
        <span className="ttl">제외 기준에 걸려 추천 후보에서 빼요</span>
        <ul className="stk-bullets">
          {failed.map((c) => (
            <li key={c.id}>
              {c.id === "x-loss" ? c.value : `${c.label} ${c.value}`} (제외 기준 {c.rule}) <RuleTag rule={c.ruleId} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ScreeningTags({ s }: { s: ScreeningResult }) {
  if (!s.growthGroup && !s.tags.length) return null;
  return (
    <div className="stk-flags">
      {s.growthGroup && (
        <span className="stk-flag info" title="M2-03: 최근 3년 매출·영업이익·순이익이 모두 늘면 A그룹, 하나라도 줄거나 그대로면 B그룹">
          {s.growthGroup}그룹
        </span>
      )}
      {s.tags.map((t) => (
        <span key={t} className="stk-flag info">
          {t}
        </span>
      ))}
    </div>
  );
}

const SIDES: [DailySignal["side"], string][] = [
  ["buy", "매수"],
  ["sell", "매도"],
  ["warn", "주의"],
  ["info", "참고"],
];

/** 일봉 보조 신호(의견을 바꾸지 않는 참고 신호) */
export function DailySignalList({ signals }: { signals: DailySignal[] }) {
  if (!signals.length) return <p className="t-2">이 봉에서 잡힌 보조 신호가 없어요.</p>;
  return (
    <div className="stack">
      {SIDES.map(([side, label]) => {
        const list = signals.filter((s) => s.side === side);
        if (!list.length) return null;
        return (
          <div key={side} className="stk-daily">
            <span className={`stk-side ${side}`}>{label}</span>
            <NoteList dense notes={list.map((s) => ({ tone: side === "buy" ? "good" : side === "info" ? "info" : "warn", text: s.text, rule: `${s.id} ${s.source}` }))} />
          </div>
        );
      })}
    </div>
  );
}

export function AnalysisDetails({ a, journal, region, settings, breadth, account }: {
  a: Analysis;
  journal: JournalEntry[];
  region: Region;
  settings: Settings | null;
  breadth: BreadthResponse | null;
  account: AccountBase;
}) {
  // 리스크·비중은 주문 상자와 같은 계좌 기준·같은 식(defaultBuyQty: 1회 손실 한도 ÷ 손절폭, 보유 수량을 더해 비중 상한 이내)으로 계산한다
  const capital = account.capital;
  const baseWord = account.paper ? "모의계좌 자산" : "예수금";
  const deposit = settings ? (region === "US" ? settings.depositUSD : settings.depositKRW) : 0;
  const money = (n: number) => fmtMoney(n, region);
  const px = (n: number) => fmtPrice(n, region, { unit: true });
  const size = useMemo(() => {
    const stop = a.timing.stopLoss;
    const per = a.price - stop;
    if (!settings || !(capital > 0) || !(stop > 0) || !(per > 0)) return null;
    const d = defaultBuyQty({ capital, riskPct: settings.riskPct, maxWeightPct: settings.maxWeightPct, price: a.price, stop, held: account.held });
    const byRisk = Math.floor((capital * settings.riskPct) / 100 / per);
    return {
      qty: d.qty,
      overRisk: d.overRisk,
      overWeight: !!d.overWeight,
      amount: d.qty * a.price,
      weightAfter: (((account.held + d.qty) * a.price) / capital) * 100,
      loss: d.qty * per,
      cappedByWeight: !d.overRisk && !d.overWeight && d.qty < byRisk,
      riskPerSharePct: (per / a.price) * 100,
    };
  }, [a, settings, capital, account.held]);
  const mine = useMemo(() => summarizeJournal(journal.filter((e) => regionOfCode(e.code) === region)), [journal, region]);
  const myEv = useMemo(
    () => (mine.closed.length >= 5 && mine.winRate != null && mine.avgWinPct != null && mine.avgLossPct != null ? expectancy({ winRate: mine.winRate, avgWinPct: mine.avgWinPct, avgLossPct: mine.avgLossPct }) : null),
    [mine],
  );
  const t = a.timing;
  const s = a.screening;
  const p = a.posture;
  const sNotes = screeningNotes(s).filter((n) => n.tone !== "bad");
  const failed = s.checks.filter((c) => c.status === "fail");
  const stopCapped = t.stopLoss > t.supportLow;
  const cm = a.candleMaster;

  return (
    <section className="stk-analysis" aria-labelledby="stk-an-h">
      <div className="stack">
        <h3 id="stk-an-h" className="t-section">
          분석 자세히
        </h3>
        <div className="row wrap">
          <ActionLabel action={a.action} />
          <span className="t-medium">{STAGE_LABEL[t.stage]}</span>
        </div>
        <p className="t-2">{ACTION_HINT[a.action]}</p>
        {a.action !== a.timingAction && <p className="t-cap">주봉 신호는 「{ACTION_LABEL[a.timingAction]}」이었지만 아래 조건 때문에 조정했어요.</p>}
        {a.gates.length > 0 && <NoteList notes={a.gates} dense />}
        <p className="t-cap">
          기준일 {fmtDate(a.asOf)} · 주봉 신호는 마감된 주({fmtDate(t.weekDate)}) 기준. 시장 → 종목 → 타이밍 → 리스크 순서로 확인해요.
        </p>
      </div>

      <Step
        n={1}
        title="시장 국면"
        summary={[a.regime ? `지수 ${REGIME_LABEL[a.regime.regime]}` : null, p ? `${POSTURE_LABEL[p.posture]} 국면 · 상한 ${fmtRatio(p.exposureCapPct, 0)}` : "지수 자료 없음"].filter(Boolean).join(" · ")}
      >
        {p ? <PostureView p={p} /> : a.regime ? <NoteList notes={a.regime.notes} dense /> : <p className="t-2">지수 자료가 없어요.</p>}
        <BreadthLine b={breadth} />
        <Link to="/?view=regime" className="stk-link">
          국면 근거 보기
        </Link>
      </Step>

      <Step n={2} title="종목 스크리닝" summary={`등급 ${s.grade} · 체크리스트 ${s.passed}/${s.known} 통과${s.excluded ? " · 추천 제외" : ""}`}>
        <ExcludedNotice s={s} />
        <p className="t-2">
          체크리스트 {s.passed} / {s.known} 통과{s.known < s.total ? ` (데이터 없음 ${s.total - s.known})` : ""}
        </p>
        <ScreeningTags s={s} />
        {sNotes.length > 0 && <NoteList notes={sNotes} dense />}
        <NoteList
          dense
          notes={
            failed.length
              ? failed.map((c) => ({ tone: "warn" as const, text: `${c.label} ${c.value} (기준 ${c.rule})`, rule: c.ruleId }))
              : [{ tone: "good" as const, text: "확인된 항목에서 기준 미달이 없어요" }]
          }
        />
        {a.valuation && (
          <>
            <ValuationLine v={a.valuation} />
            {a.valuation.notes.length > 0 && <NoteList notes={a.valuation.notes} dense />}
          </>
        )}
        <p className="t-cap">밸류에이션은 의견을 바꾸지 않는 참고 정보예요. 체크리스트 전체와 PER 밴드는 재무 탭에 있어요.</p>
      </Step>

      <Step n={3} title="진입·청산 타이밍" summary={`${STAGE_LABEL[t.stage]} · 주봉 의견 ${ACTION_LABEL[a.timingAction]}`}>
        <NoteList notes={t.notes} dense />
        <dl className="stk-kv">
          <dt>현재가</dt>
          <dd className="num">{px(a.price)}</dd>
          <dt>참고 손절가(8주 저점, 최대 10%)</dt>
          <dd>
            <span className={`num t-medium ${a.belowStop ? "warn-text" : ""}`}>
              {px(t.stopLoss)}
              {a.belowStop ? " · 이탈" : ""}
            </span>
            {stopCapped && <span className="t-cap">8주 저점({px(t.supportLow)})이 멀어 10% 상한을 썼어요</span>}
          </dd>
          <dt>참고 목표가(손익비 2:1)</dt>
          <dd className="num">{px(a.target)}</dd>
          <dt>30주선 이격</dt>
          <dd className="num">{fmtPct(t.pctFromMa, 1)}</dd>
          {t.swingTarget != null && (
            <>
              <dt>
                스윙 목표 <RuleTag rule="M3-03 와인스타인" />
              </dt>
              <dd>
                <span className="num">{px(t.swingTarget)}</span>
                <span className="t-cap">근처에서 일부 매도해요</span>
              </dd>
            </>
          )}
          {t.pullbackBuy && (
            <>
              <dt>
                풀백 매수 구간 <RuleTag rule="M3-02 와인스타인" />
              </dt>
              <dd>
                <span>추가 매수 자리</span>
                <span className="t-cap">돌파 후 첫 풀백에서 돌파가 위를 지켰어요</span>
              </dd>
            </>
          )}
        </dl>
        {a.candlePatterns.length > 0 && (
          <div className="stack">
            <h4 className="stk-layer">캔들 보조 신호(일봉)</h4>
            <NoteList
              dense
              notes={a.candlePatterns.map((cp) => ({ tone: cp.direction === "bullish" ? "good" : "warn", text: `${cp.direction === "bullish" ? "▲" : "▼"} ${cp.name} — ${cp.note} (기준가 ${px(cp.invalidation)})` }))}
            />
          </div>
        )}
        <div className="stack">
          <h4 className="stk-layer">일봉 보조 신호</h4>
          <p className="t-cap">참고 신호예요. 주봉 의견을 바꾸지 않아요.</p>
          <DailySignalList signals={a.dailySignals} />
        </div>
        <p className="t-cap">
          일봉 단기 점수 {signed(a.shortTerm.score)}(과열·눌림 참고용, 진입 판단에는 쓰지 않아요)
        </p>
      </Step>

      <Step
        n={4}
        title="리스크·비중"
        summary={settings ? `1회 손절 ${fmtRatio(settings.riskPct)} · 종목당 최대 ${fmtRatio(settings.maxWeightPct, 0)}` : "설정을 불러오는 중"}
      >
        <p className="t-2">
          {baseWord} {money(capital)} · 1회 손절 허용 {settings ? fmtRatio(settings.riskPct) : "-"} · 종목당 최대 {settings ? fmtRatio(settings.maxWeightPct, 0) : "-"}(
          <Link to="/settings" className="stk-link">설정</Link>에서 바꿔요)
        </p>
        {p && (
          <p className={p.posture === "DEFENSE" ? "warn-text t-2" : "t-2"}>
            국면이 {POSTURE_LABEL[p.posture]}
            {ira(POSTURE_LABEL[p.posture])} 주식 투자 상한이 {fmtRatio(p.exposureCapPct, 0)}예요
            {capital > 0 && <> — {baseWord} {money(capital)} 중 최대 {money((capital * p.exposureCapPct) / 100)}까지</>}
          </p>
        )}
        {size && settings ? (
          <NoteList
            dense
            notes={[
              ...(BUY_ACTIONS.includes(a.action) ? [] : [{ tone: "warn" as const, text: "지금은 매수 신호가 아니에요. 아래는 매수한다고 가정한 계산이에요" }]),
              ...(size.overWeight
                ? [{ tone: "warn" as const, text: `이미 가진 ${fmtInt(account.held)}주로 종목 비중 상한 ${fmtRatio(settings.maxWeightPct, 0)}에 닿아 더 살 수 없어요` }]
                : [
                    {
                      tone: "info" as const,
                      text: `참고 매수 수량 ${fmtInt(size.qty)}주(${money(size.amount)}, 주문 후 비중 ${fmtRatio(size.weightAfter, 1)}) · 주문 상자와 같은 계산(${baseWord} 기준${account.held > 0 ? `, 보유 ${fmtInt(account.held)}주 포함` : ""})이에요`,
                    },
                    { tone: "info" as const, text: `손절가(${px(t.stopLoss)})까지 가면 손실 ${fmtPnl(-size.loss, region)}(${baseWord}의 ${fmtRatio((size.loss / capital) * 100, 1)})` },
                  ]),
              ...(size.overRisk ? [{ tone: "warn" as const, text: `1주만 사도 1회 손실 한도 ${fmtRatio(settings.riskPct)}를 넘어요` }] : []),
              ...(size.cappedByWeight ? [{ tone: "warn" as const, text: "손절폭으로는 더 살 수 있지만 비중 상한 때문에 수량을 줄였어요" }] : []),
              ...(size.riskPerSharePct > 15 ? [{ tone: "warn" as const, text: `손절폭이 ${fmtRatio(size.riskPerSharePct, 0)}로 커요. 손절가를 더 가깝게 잡을 수 있는지 보세요` }] : []),
            ]}
          />
        ) : (
          <p className="t-2">
            {capital > 0 ? "현재가가 손절가보다 낮거나 같아서 수량을 계산할 수 없어요." : `${josa(baseWord, "이/가")} 0이라 수량을 계산할 수 없어요. ${account.paper ? "설정의 모의매매에서 모의계좌를 확인해 주세요." : "설정에서 예수금을 넣어 주세요."}`}
          </p>
        )}
        {myEv ? (
          <p className="t-2">
            내 매매일지 기준({mine.closed.length}회) 기대값 <span className={`num t-medium ${tone(myEv.expectancyPct)}`}>{fmtPct(myEv.expectancyPct)}</span>/회 · 켈리 {fmtNum(myEv.kellyPct, 0)}%(절반 {fmtNum(myEv.halfKellyPct, 0)}%)
          </p>
        ) : (
          <p className="t-cap">매매일지에 이 시장의 청산 거래가 5회 이상 쌓이면 내 승률로 기대값을 계산해 줘요.</p>
        )}
        <p className="t-cap">올인보다 손절폭 기준 비중을 기본으로 해요. 한 종목에 몰아넣는 전략은 확신과 손실 감내가 있을 때만 상한을 직접 올리세요.</p>
      </Step>

      <Step title="캔들마스터 주봉(별도 매매법)" summary={cm ? candleStatus(cm).label : "주봉 부족"}>
        <CandleMasterDetail r={cm} capital={deposit} region={region} />
      </Step>
    </section>
  );
}
