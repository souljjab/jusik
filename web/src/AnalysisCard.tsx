import { useMemo } from "react";
import {
  ACTION_LABEL, expectancy, positionSize, POSTURE_LABEL, REGIME_LABEL, regionOfCode, screeningNotes, STAGE_LABEL, summarizeJournal,
  type Action, type Analysis, type DailySignal, type JournalEntry, type Region, type RegimeAssessment, type ScreeningResult, type Settings,
} from "@jusik/shared";
import { ExtrasPanel } from "./ExtrasPanel";
import { MacroStrip } from "./MacroStrip";
import { NoteList, RuleTag } from "./NoteList";
import { money, num, tone } from "./format";
import "./styles/analysis.css";

export function ActionBadge({ action }: { action: Action }) {
  return <span className={`badge ${action}`}>{ACTION_LABEL[action]}</span>;
}

function Step({ n, title, children, badge }: { n: number; title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section className="step">
      <h4>
        <span className="step-n">{n}</span> {title} {badge}
      </h4>
      {children}
    </section>
  );
}

const ACTION_HINT: Record<Action, string> = {
  STRONG_BUY: "신규 매수 가능 구간 — 분할 진입을 권장해요",
  BUY: "신규 매수 가능 구간 — 분할 진입을 권장해요",
  HOLD: "신규 매수는 대기 · 보유 중이면 유지하며 손절가만 지켜요",
  SELL: "보유 중이면 비중 축소·청산을 검토하세요",
  STRONG_SELL: "신규 매수 금지 · 보유 중이면 청산을 검토하세요",
};

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

/** 받침 유무로 '이라/라'를 고른다(공격이라·중립이라·방어라) */
const ira = (word: string) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 !== 0 ? "이라" : "라";
};

const BREAKDOWN: [keyof RegimeAssessment["breakdown"], string][] = [["stage", "주봉 단계"], ["macd", "MACD"], ["rsi", "RSI"], ["macro", "매크로"]];

/** ① 국면 점수·구성·투자 상한 */
function PostureView({ p }: { p: RegimeAssessment }) {
  return (
    <>
      <div className="an-score small">
        <span>
          국면 점수 <b className={tone(p.score)}>{signed(p.score)}</b>
        </span>
        <span className="an-breakdown" title="점수 구성(합이 국면 점수)">
          {BREAKDOWN.map(([k, label]) => (
            <span key={k}>
              {label} <b className={tone(p.breakdown[k])}>{signed(p.breakdown[k])}</b>
            </span>
          ))}
        </span>
        <span>
          주식 투자 상한 <b>{p.exposureCapPct}%</b>
        </span>
        {p.choppy && <span className="pill warn-pill" title="최근 MACD 교차가 잦아요">횡보장 주의</span>}
      </div>
      <NoteList notes={p.notes} />
      <p className="muted small">지수 기준일 {p.asOf}</p>
    </>
  );
}

/** ② 하드 필터에 걸린 항목 */
function ExcludedBanner({ s }: { s: ScreeningResult }) {
  const failed = s.exclusions.filter((c) => c.status === "fail");
  if (!s.excluded || !failed.length) return null;
  return (
    <div className="banner error an-exclude small">
      <b>제외 기준에 걸려 추천 후보에서 빼요</b>
      <ul>
        {failed.map((c) => (
          <li key={c.id}>
            {c.id === "x-loss" ? c.value : `${c.label} ${c.value}`} (제외 기준 {c.rule}) <RuleTag rule={c.ruleId} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScreeningChips({ s }: { s: ScreeningResult }) {
  if (!s.growthGroup && !s.tags.length) return null;
  return (
    <div className="an-chips">
      {s.growthGroup && (
        <span className={`chip an-group-${s.growthGroup}`} title="M2-03: 최근 3년 매출·영업이익·순이익이 모두 늘면 A그룹, 하나라도 줄거나 그대로면 B그룹">
          {s.growthGroup}그룹
        </span>
      )}
      {s.tags.map((t) => (
        <span key={t} className="chip an-tag">{t}</span>
      ))}
    </div>
  );
}

const SIDES: [DailySignal["side"], string, string][] = [
  ["buy", "매수", "note-good"],
  ["sell", "매도", "note-bad"],
  ["warn", "주의", "note-warn"],
  ["info", "참고", "note-info"],
];

/** ③ 일봉 보조 신호(의견을 바꾸지 않는 참고 신호) */
function DailySignals({ signals }: { signals: DailySignal[] }) {
  return (
    <div className="an-daily">
      <b className="small">일봉 보조 신호</b> <span className="muted small">참고 신호예요 — 주봉 의견을 바꾸지 않아요</span>
      {signals.length === 0 ? (
        <p className="muted small">마지막 일봉에서 잡힌 보조 신호가 없어요.</p>
      ) : (
        SIDES.map(([side, label, cls]) => {
          const list = signals.filter((s) => s.side === side);
          if (!list.length) return null;
          return (
            <div key={side} className="an-daily-group">
              <span className={`an-side an-side-${side}`}>{label}</span>
              <ul className="notes">
                {list.map((s, i) => (
                  <li key={`${s.key}-${i}`} className={cls}>
                    {s.text} <RuleTag rule={`${s.id} ${s.source}`} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}

export function AnalysisCard({ a, journal, region, settings, code }: { a: Analysis | null; journal: JournalEntry[]; region: Region; settings: Settings | null; code?: string }) {
  const capital = settings ? (region === "US" ? settings.depositUSD : settings.depositKRW) : 0;
  const won = (n: number) => money(n, region);

  const size = useMemo(
    () => (a && settings && capital > 0 ? positionSize({ capital, entry: a.price, stop: a.timing.stopLoss, riskPct: settings.riskPct, maxWeightPct: settings.maxWeightPct, feeRate: region === "US" ? 0.0025 : 0.00015 }) : null),
    [a, settings, capital, region],
  );
  const mine = useMemo(() => summarizeJournal(journal.filter((e) => regionOfCode(e.code) === region)), [journal, region]);
  const myEv = useMemo(
    () => (mine.closed.length >= 5 && mine.winRate != null && mine.avgWinPct != null && mine.avgLossPct != null ? expectancy({ winRate: mine.winRate, avgWinPct: mine.avgWinPct, avgLossPct: mine.avgLossPct }) : null),
    [mine],
  );

  if (!a) return <div className="card muted">분석에 필요한 데이터(주봉 약 34주 이상)가 부족해요.</div>;
  const t = a.timing;
  const s = a.screening;
  const p = a.posture;
  const changed = a.action !== a.timingAction;
  // 제외 사유(bad)는 배너로 따로 보여 준다
  const sNotes = screeningNotes(s).filter((n) => n.tone !== "bad");
  const stopCapped = t.stopLoss > t.supportLow;

  return (
    <div className="card analysis">
      <div className="rec-head">
        <ActionBadge action={a.action} />
        <div>
          <strong>{STAGE_LABEL[t.stage]}</strong>
          <div className="small">{ACTION_HINT[a.action]}</div>
          {changed && <div className="muted small">주봉 신호는 「{ACTION_LABEL[a.timingAction]}」이었지만 아래 조건 때문에 조정했어요</div>}
        </div>
      </div>
      <p className="muted small">기준일 {a.asOf} · 주봉 신호는 마감된 주({t.weekDate}) 기준이에요. 시장 → 종목 → 타이밍 → 리스크 순서로 확인해요.</p>
      {a.gates.length > 0 && <NoteList notes={a.gates} />}

      <div className="steps">
        <Step
          n={1}
          title="시장 국면"
          badge={
            <>
              {a.regime && <span className={`chip regime-${a.regime.regime}`} title="지수 주봉 30주선 단계로 본 국면">지수 {REGIME_LABEL[a.regime.regime]}</span>}
              {p && <span className={`chip an-posture-${p.posture}`} title="국면 점수로 정한 투자 자세">{POSTURE_LABEL[p.posture]} 국면</span>}
            </>
          }
        >
          {p ? <PostureView p={p} /> : a.regime ? <NoteList notes={a.regime.notes} /> : <p className="muted small">지수 데이터가 없어요.</p>}
          <MacroStrip region={region} />
        </Step>

        <Step n={2} title="종목 스크리닝" badge={<span className={`chip grade-${s.grade.replace("/", "")}`}>{s.grade}</span>}>
          <ExcludedBanner s={s} />
          <p className="small">
            체크리스트 <b>{s.passed}</b> / {s.known} 통과
            {s.known < s.total && <span className="muted"> (데이터 없음 {s.total - s.known})</span>}
          </p>
          <ScreeningChips s={s} />
          {sNotes.length > 0 && <NoteList notes={sNotes} />}
          <ul className="notes">
            {s.checks.filter((c) => c.status === "fail").map((c) => (
              <li key={c.id} className="note-bad">
                ✖ {c.label} {c.value} (기준 {c.rule}) <RuleTag rule={c.ruleId} />
              </li>
            ))}
            {s.checks.every((c) => c.status !== "fail") && <li className="note-good">✔ 확인된 항목에서 기준 미달이 없어요</li>}
          </ul>
          <p className="muted small">전체 항목은 「재무·스크리닝」 탭에서 볼 수 있어요.</p>
        </Step>

        <Step n={3} title="진입·청산 타이밍" badge={<ActionBadge action={a.timingAction} />}>
          <NoteList notes={t.notes} />
          <div className="levels">
            <div><span className="muted">현재가</span><b>{won(a.price)}</b></div>
            <div>
              <span className="muted">참고 손절가(8주 저점, 최대 10%)</span>
              <b className={a.belowStop ? "down" : ""}>{won(t.stopLoss)}{a.belowStop ? " · 이탈" : ""}</b>
              {stopCapped && <span className="an-sub">8주 저점({won(t.supportLow)})이 멀어 10% 상한을 썼어요</span>}
            </div>
            <div><span className="muted">참고 목표가(손익비 2:1)</span><b className="up">{won(a.target)}</b></div>
            <div><span className="muted">30주선 이격</span><b>{num(t.pctFromMa, 1)}%</b></div>
            {t.swingTarget != null && (
              <div>
                <span className="muted">스윙 목표 <RuleTag rule="M3-03 와인스타인" /></span>
                <b className="up">{won(t.swingTarget)}</b>
                <span className="an-sub">근처에서 일부 매도해요</span>
              </div>
            )}
            {t.pullbackBuy && (
              <div>
                <span className="muted">풀백 매수 구간 <RuleTag rule="M3-02 와인스타인" /></span>
                <b className="up">추가 매수 자리</b>
                <span className="an-sub">돌파 후 첫 풀백에서 돌파가 위를 지켰어요</span>
              </div>
            )}
          </div>
          {a.candlePatterns.length > 0 && (
            <div className="patterns">
              <b className="small">캔들 보조 신호(일봉)</b>
              <ul className="notes">
                {a.candlePatterns.map((cp) => (
                  <li key={cp.id} className={cp.direction === "bullish" ? "note-good" : "note-bad"}>
                    {cp.direction === "bullish" ? "▲" : "▼"} {cp.name} — {cp.note} (기준가 {won(cp.invalidation)})
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DailySignals signals={a.dailySignals} />
          <p className="muted small">일봉 단기 점수 {a.shortTerm.score > 0 ? "+" : ""}{a.shortTerm.score} (과열·눌림 참고용, 진입 판단에는 쓰지 않아요)</p>
        </Step>

        <Step n={4} title="리스크·비중">
          <p className="muted small">
            예수금 {won(capital)} · 1회 손절 허용 {settings?.riskPct ?? "-"}% · 종목당 최대 {settings?.maxWeightPct ?? "-"}% (「단타 추천」 화면의 설정에서 바꿔요)
          </p>
          {p && (
            <p className={`small ${p.posture === "DEFENSE" ? "note-warn" : ""}`}>
              국면이 {POSTURE_LABEL[p.posture]}{ira(POSTURE_LABEL[p.posture])} 주식 투자 상한이 <b>{p.exposureCapPct}%</b>예요
              {capital > 0 && <> — 예수금 {won(capital)} 중 최대 <b>{won((capital * p.exposureCapPct) / 100)}</b>까지</>}
            </p>
          )}
          {size && size.shares > 0 ? (
            <ul className="notes">
              {a.action !== "BUY" && a.action !== "STRONG_BUY" && <li className="note-warn">⚠ 지금은 매수 신호가 아니에요. 아래는 매수한다고 가정했을 때의 계산이에요</li>}
              <li className="note-info">참고 매수 수량 <b>{size.shares.toLocaleString()}주</b> ({won(size.amount)}, 비중 {num(size.weightPct, 1)}%)</li>
              <li className="note-info">손절가({won(a.timing.stopLoss)})까지 가면 약 {won(size.riskAmount)} 손실 (자본의 {num((size.riskAmount / capital) * 100, 2)}%)</li>
              {size.cappedByWeight && <li className="note-warn">⚠ 손절폭은 더 사도 되지만 비중 상한 때문에 수량을 줄였어요</li>}
              {size.riskPerSharePct > 15 && <li className="note-warn">⚠ 손절폭이 {num(size.riskPerSharePct, 0)}%로 커요. 손절가를 더 가깝게 잡을 수 있는지 보세요</li>}
            </ul>
          ) : (
            <p className="muted small">{capital > 0 ? "현재가가 손절가보다 낮거나 같아서 수량을 계산할 수 없어요." : "예수금이 0이라 수량을 계산할 수 없어요. 설정에서 예수금을 입력하세요."}</p>
          )}
          {myEv ? (
            <p className="small">내 매매일지 기준({mine.closed.length}회) 기대값 <b className={myEv.expectancyPct >= 0 ? "up" : "down"}>{myEv.expectancyPct >= 0 ? "+" : ""}{num(myEv.expectancyPct, 2)}%</b>/회 · 켈리 {num(myEv.kellyPct, 0)}% (절반 {num(myEv.halfKellyPct, 0)}%)</p>
          ) : (
            <p className="muted small">매매일지에 이 시장의 청산 거래가 5회 이상 쌓이면 내 승률로 기대값을 계산해 줘요.</p>
          )}
          <p className="muted small">올인보다 손절폭 기준 비중을 기본으로 해요. 한 종목에 몰아넣는 전략은 확신과 손실 감내가 있을 때만 상한을 직접 올리세요.</p>
        </Step>
      </div>

      <ExtrasPanel code={code} region={region} />
    </div>
  );
}
