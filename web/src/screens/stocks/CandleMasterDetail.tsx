import { Check, X } from "lucide-react";
import {
  CANDLE_MASTER_PARAMS, CANDLE_MASTER_SIGNAL_LABEL, CANDLE_MASTER_SIZING, candleMaster244Note, candleMasterSizing,
  type CandleMasterExclusion, type CandleMasterResult, type Note, type Region,
} from "@jusik/shared";
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtRatio, NoteList, RuleTag } from "../../ui";

/*
 * 캔들마스터 주봉 캔들매매(자료집 4.5, M3-12·M3-13·M4-01·M4-03). 파동 → 캔들군 → 캔들 신호 3층을 차례로 보여 주고,
 * 유효하면 진입·손절·목표·본전 스탑을 보여 준다. 별도 매매법이라 종목 의견과는 무관하다.
 */

const P = CANDLE_MASTER_PARAMS;
const S = CANDLE_MASTER_SIZING;

const EXCLUSION_TEXT: Record<CandleMasterExclusion, [string, string]> = {
  SHORT_HISTORY: ["주봉 부족", `상장 기간이 짧아 주봉이 모자라요(기준 ${P.minWeeks}주)`],
  RUNUP: [`이미 ${P.maxRunupMultiple}배 상승`, `최저점에서 고점까지 이미 ${P.maxRunupMultiple}배 넘게 올랐어요`],
  DEEP_DRAWDOWN: ["고점 대비 큰 하락", `고점 대비 50%를 크게 넘게 내려 있어요(앱 기준 ${P.maxDrawdownPct}%)`],
  BROKEN_LOWS: ["저점 여러 번 이탈", `최근 ${P.breakWindowWeeks}주 동안 저점을 여러 번 하향 돌파했어요`],
};

const noteKey = (n: Note) => `${n.tone}|${n.text}`;

/** 한 줄 판정: 진입 근거가 있는지, 없다면 어느 층에서 막혔는지 */
export function candleStatus(r: CandleMasterResult): { label: string; ok: boolean } {
  if (r.valid) return { label: r.standard ? "진입 근거 있음 · 표준(목표 3배)" : "진입 근거 있음 · 비표준(목표 2배)", ok: true };
  if (r.waitPrice != null) return { label: "손절폭 초과 · 진입 대기", ok: false };
  if (r.wave.excluded) return { label: "해석 제외 구간", ok: false };
  if (r.signals.length) return { label: "신호는 있지만 파동이 해석 대상이 아니에요", ok: false };
  if (r.wave.ok) return { label: "파동은 해석 대상 · 신호 대기", ok: false };
  return { label: "아직 해석 대상이 아니에요", ok: false };
}

function Flag({ on, label, title }: { on: boolean; label: string; title?: string }) {
  const Icon = on ? Check : X;
  return (
    <span className={`stk-flag ${on ? "good" : "info"}`} title={title}>
      <Icon size={12} strokeWidth={1.5} aria-hidden="true" />
      {label}
      <span className="sr-only">{on ? " 충족" : " 미충족"}</span>
    </span>
  );
}

const p1 = (n: number) => `${fmtNum(n, 1)}%`;
const sp1 = (n: number) => `${n > 0 ? "+" : ""}${fmtNum(n, 1)}%`;

function WaveMetrics({ r }: { r: CandleMasterResult }) {
  const m = r.wave.metrics;
  if (!m) return null;
  const rows: [string, string, string][] = [
    [`수평 구간(최근 ${P.baseWeeks}주) 고저폭`, p1(m.baseRangePct), `${P.baseMaxRangePct}% 이하`],
    ["직전 파동 고저폭", p1(m.priorRangePct), "-"],
    ["수평 구간 ÷ 직전 파동", `${fmtNum(m.rangeRatio, 2)}배`, `${P.baseVsPriorMax}배 이하`],
    ["저점 흐름(뒤쪽 절반 ÷ 앞쪽 절반)", sp1(m.lowSlopePct), `${P.lowSlopeMinPct}~+${P.lowSlopeMaxPct}%, 서서히 상승은 +${P.risingMinPct}% 이상`],
    ["직전 파동 고점과 가격 간격", p1(m.gapPct), `${P.minGapPct}% 이상`],
    ["직전 파동 고점과 시간 간격", `${m.gapWeeks}주`, `${P.minGapWeeks}주 이상`],
    ["최저점 → 고점 배수", `${fmtNum(m.runupMultiple, 1)}배`, `${P.maxRunupMultiple}배 미만`],
    ["고점 대비 하락폭", p1(m.drawdownPct), `${P.maxDrawdownPct}% 이하`],
    [`최근 ${P.breakWindowWeeks}주 저점 이탈`, `${m.lowBreaks}번`, `${P.maxLowBreaks}번 미만`],
  ];
  return (
    <details className="stk-details">
      <summary>파동 수치 보기</summary>
      <div className="ui-table-wrap" tabIndex={0} role="region" aria-label="파동 수치 표">
        <table className="ui-table on-surface">
          <thead>
            <tr>
              <th>항목</th>
              <th className="r">값</th>
              <th>기준</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v, c]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="r num">{v}</td>
                <td className="t-2">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="t-cap">책은 몸통·꼬리·파동에 명확한 수치를 두지 않아요. 10배·50% 외의 기준은 앱 기본값이라 백테스트로 조정해요.</p>
    </details>
  );
}

function Levels({ r, region }: { r: CandleMasterResult; region: Region }) {
  const m = (n: number) => fmtPrice(n, region, { unit: true });
  if (r.valid && r.entry != null && r.stop != null && r.stopPct != null)
    return (
      <dl className="stk-kv">
        <dt>
          진입가(종가·손절가 사이 1/3) <RuleTag rule="M3-12" />
        </dt>
        <dd>
          <span className="num t-medium">{m(r.entry)}</span>
          {r.entryMid != null && <span className="t-cap">중간 지점 {m(r.entryMid)}도 가능 · 지정가로 기다려요</span>}
        </dd>
        <dt>
          손절가 <RuleTag rule="M4-01" />
        </dt>
        <dd>
          <span className="num t-medium">{m(r.stop)}</span>
          <span className="t-cap">진입가 대비 {fmtPct(-r.stopPct)} (기본 {fmtRatio(-P.defaultStopPct, 0)}, 최대 {fmtRatio(-P.maxStopPct, 0)})</span>
        </dd>
        {r.target != null && (
          <>
            <dt>
              목표가 ×{r.targetMultiple} <RuleTag rule="M3-13" />
            </dt>
            <dd>
              <span className="num t-medium">{m(r.target)}</span>
              <span className="t-cap">{r.standard ? "파동·캔들군·신호가 모두 표준이에요" : "표준이 아닌 요소가 있어 2배로 잡아요 · +100%에 닿으면 목표 달성"}</span>
            </dd>
          </>
        )}
        {r.breakevenTrigger != null && (r.target == null || r.breakevenTrigger < r.target) && (
          <>
            <dt>
              본전 스탑 발동가 <RuleTag rule="M3-13" />
            </dt>
            <dd>
              <span className="num t-medium">{m(r.breakevenTrigger)}</span>
              <span className="t-cap">+100%에 닿은 뒤 밀리면 진입가(본전)에 팔아요</span>
            </dd>
          </>
        )}
      </dl>
    );
  if (r.waitPrice != null && r.stop != null && r.stopPct != null)
    return (
      <dl className="stk-kv">
        <dt>
          신호 손절가 <RuleTag rule="M4-01" />
        </dt>
        <dd>
          <span className="num t-medium">{m(r.stop)}</span>
          <span className="t-cap">1/3 지점 기준 {fmtPct(-r.stopPct)}로 최대 {fmtRatio(-P.maxStopPct, 0)}를 넘어요</span>
        </dd>
        <dt>진입 대기 가격</dt>
        <dd>
          <span className="num t-medium">{m(r.waitPrice)}</span>
          <span className="t-cap">진입가가 이 가격 이하로 내려와야 손절폭이 {fmtRatio(-P.maxStopPct, 0)} 안에 들어와요</span>
        </dd>
      </dl>
    );
  return null;
}

/** M4-03 비중. 1,000만 원 소액 기준은 원화 자금에만 쓴다 */
function Sizing({ capital, region }: { capital: number; region: Region }) {
  const sz = candleMasterSizing(region === "US" ? 0 : capital);
  const split = sz.notes.filter((n) => n.rule === "5.2 캔들마스터");
  if (region === "US") {
    const per = Math.min(S.perStockPct, S.hardCapPct);
    return (
      <div className="stack">
        <p className="t-2">
          종목당 <b>{per}%</b>, 최대 <b>{S.maxPositions}종목</b>
          {capital > 0 && <> — 예수금 {fmtMoney(capital, "US")} 기준 종목당 약 <b>{fmtMoney((capital * per) / 100, "US")}</b></>} <RuleTag rule="M4-03" />
        </p>
        <p className="t-cap">어떤 경우도 종목당 {S.hardCapPct}%를 넘기지 않아요. 1,000만 원 이하 소액 기준은 원화 자금 기준이라 달러 계좌에는 쓰지 않았어요.</p>
        <NoteList notes={split} dense />
      </div>
    );
  }
  if (!(capital > 0))
    return (
      <div className="stack">
        <p className="t-2">
          자금 1,000만 원 이하면 종목당 {S.smallPerStockPct}%(최대 {S.smallMaxPositions}종목), 넘으면 {S.perStockPct}%(최대 {S.maxPositions}종목), 어떤 경우도 {S.hardCapPct}% 이하 <RuleTag rule="M4-03" />
        </p>
        <p className="t-cap">설정에서 예수금을 넣으면 종목당 금액을 계산해 줘요.</p>
        <NoteList notes={split} dense />
      </div>
    );
  return (
    <div className="stack">
      <NoteList notes={sz.notes} dense />
      <p className="t-cap">어떤 경우도 종목당 {S.hardCapPct}%를 넘기지 않아요.</p>
    </div>
  );
}

export function CandleMasterDetail({ r, capital, region }: { r: CandleMasterResult | null; capital: number; region: Region }) {
  if (!r) return <p className="t-2">주봉이 모자라거나 신호가 없어요.</p>;
  const w = r.wave;
  const m = w.metrics;
  const g = r.group;
  const signalNotes = r.signals.flatMap((s) => s.notes);
  const layered = new Set([...w.notes, ...(g?.notes ?? []), ...signalNotes].map(noteKey));
  const rest = r.notes.filter((n) => !layered.has(noteKey(n)));

  return (
    <div className="stack-3">
      <p className="t-cap">
        {fmtDate(r.date)} 마감 주봉 기준 · 종가 {fmtPrice(r.close, region)} · 주봉 {w.weeks}개. 이동평균·거래량·보조지표 없이 파동 → 캔들군 → 캔들 신호만 보는 별도 매매법이에요.
      </p>
      <h4 className="stk-layer">① 파동</h4>
      <div className="stk-flags">
        {w.exclusions.map((x) => (
          <span key={x} className="stk-flag warn" title={EXCLUSION_TEXT[x][1]}>
            해석 제외 · {EXCLUSION_TEXT[x][0]}
          </span>
        ))}
        {m && (
          <>
            <Flag on={w.horizontal} label="수평 파동" title={`최근 ${P.baseWeeks}주 고저폭 ${p1(m.baseRangePct)} · 직전 파동 ${p1(m.priorRangePct)}`} />
            <Flag on={w.spaced} label="직전 파동과 간격" title={`직전 고점보다 ${p1(m.gapPct)} 아래 · ${m.gapWeeks}주 지남`} />
            <Flag on={w.rising} label="저점 서서히 상승" title={`저점 흐름 ${sp1(m.lowSlopePct)}(기준 +${P.risingMinPct}% 이상)`} />
          </>
        )}
      </div>
      <NoteList notes={w.notes} dense />
      <WaveMetrics r={r} />

      <h4 className="stk-layer">② 캔들군</h4>
      {g ? (
        <>
          <div className="stk-flags">
            <Flag on={g.compact} label="수평 횡보 캔들군" title={`직전 ${g.weeks}주 고저폭 ${p1(g.rangePct)} · 평균 몸통 ${p1(g.avgBodyPct)}`} />
          </div>
          <NoteList notes={g.notes} dense />
        </>
      ) : (
        <p className="t-2">캔들군을 볼 주봉이 모자라요.</p>
      )}

      <h4 className="stk-layer">③ 캔들 신호</h4>
      {r.signals.length ? (
        <>
          <div className="stk-flags">
            {r.signals.map((s) => (
              <span key={s.id} className={`stk-flag ${s.id === r.primary ? "good" : "info"}`} title={s.id === r.primary ? "이 신호의 저점으로 손절가를 정했어요" : undefined}>
                {CANDLE_MASTER_SIGNAL_LABEL[s.id]}
                {s.weeks > 1 ? ` ${s.weeks}주` : ""}
                {s.id === r.primary ? " · 손절 기준" : ""}
              </span>
            ))}
          </div>
          <NoteList notes={signalNotes} dense />
        </>
      ) : (
        <p className="t-2">이번 주(마감 기준) 매수 신호 캔들이 없어요. 파동이 좋아도 신호가 나와야 진입 근거가 생겨요.</p>
      )}

      <h4 className="stk-layer">진입·손절·목표</h4>
      <Levels r={r} region={region} />
      {rest.length > 0 ? <NoteList notes={rest} dense /> : !r.valid && r.waitPrice == null && <p className="t-2">진입 근거가 없어 진입가·목표가를 계산하지 않았어요.</p>}

      <h4 className="stk-layer">비중</h4>
      <Sizing capital={capital} region={region} />
      <NoteList notes={[candleMaster244Note()]} dense />
    </div>
  );
}
