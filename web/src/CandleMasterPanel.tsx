import {
  CANDLE_MASTER_PARAMS, CANDLE_MASTER_SIGNAL_LABEL, CANDLE_MASTER_SIZING, candleMaster244Note, candleMasterSizing,
  type CandleMasterExclusion, type CandleMasterResult, type Note, type Region,
} from "@jusik/shared";
import { NoteList } from "./NoteList";
import { money, num } from "./format";
import "./styles/analysis2.css";

const P = CANDLE_MASTER_PARAMS;
const S = CANDLE_MASTER_SIZING;

/** 해석 제외 사유(4.5 "해석 대상과 제외 대상"): [짧은 이름, 풀어 쓴 이유] */
const EXCLUSION_TEXT: Record<CandleMasterExclusion, [string, string]> = {
  SHORT_HISTORY: ["주봉 부족", `상장 기간이 짧아 주봉이 모자라요(기준 ${P.minWeeks}주)`],
  RUNUP: [`이미 ${P.maxRunupMultiple}배 상승`, `최저점에서 고점까지 이미 ${P.maxRunupMultiple}배 넘게 올랐어요`],
  DEEP_DRAWDOWN: ["고점 대비 큰 하락", `고점 대비 50%를 크게 넘게 내려 있어요(앱 기준 ${P.maxDrawdownPct}%)`],
  BROKEN_LOWS: ["저점 여러 번 이탈", `최근 ${P.breakWindowWeeks}주 동안 저점을 여러 번 하향 돌파했어요`],
};

const noteKey = (n: Note) => `${n.tone}|${n.text}`;

type Tone = "good" | "warn" | "bad" | "info";

/** 한 줄 판정: 진입 근거가 있는지, 없다면 어느 층에서 막혔는지 */
function statusOf(r: CandleMasterResult): { label: string; tone: Tone } {
  if (r.valid) return r.standard ? { label: "진입 근거 있음 · 표준(목표 3배)", tone: "good" } : { label: "진입 근거 있음 · 비표준(목표 2배)", tone: "good" };
  if (r.waitPrice != null) return { label: "손절폭 초과 · 진입 대기", tone: "warn" };
  if (r.wave.excluded) return { label: "해석 제외 구간", tone: "bad" };
  if (r.signals.length) return { label: "신호는 있지만 파동이 해석 대상이 아니에요", tone: "info" };
  if (r.wave.ok) return { label: "파동은 해석 대상 · 신호 대기", tone: "info" };
  return { label: "아직 해석 대상이 아니에요", tone: "info" };
}

function Src({ rule }: { rule: string }) {
  return (
    <span className="an2-rule" title="근거 규칙(자료집 부록 A·4.5)">
      {rule}
    </span>
  );
}

function Flag({ on, label, title }: { on: boolean; label: string; title?: string }) {
  return (
    <span className={`an2-flag${on ? " an2-flag-on" : ""}`} title={title}>
      {on ? "✔" : "✖"} {label}
    </span>
  );
}

const p1 = (n: number) => `${num(n, 1)}%`;
const sp1 = (n: number) => `${n > 0 ? "+" : ""}${num(n, 1)}%`;

/** 파동 수치 표(펼쳐 보기). 기준값은 CANDLE_MASTER_PARAMS(대부분 앱 기본값) */
function WaveMetrics({ r }: { r: CandleMasterResult }) {
  const m = r.wave.metrics;
  if (!m) return null;
  const rows: [string, string, string][] = [
    [`수평 구간(최근 ${P.baseWeeks}주) 고저폭`, p1(m.baseRangePct), `${P.baseMaxRangePct}% 이하`],
    ["직전 파동 고저폭", p1(m.priorRangePct), "-"],
    ["수평 구간 ÷ 직전 파동", `${num(m.rangeRatio, 2)}배`, `${P.baseVsPriorMax}배 이하`],
    ["저점 흐름(뒤쪽 절반 ÷ 앞쪽 절반)", sp1(m.lowSlopePct), `${P.lowSlopeMinPct}~+${P.lowSlopeMaxPct}%, 서서히 상승은 +${P.risingMinPct}% 이상`],
    ["직전 파동 고점과 가격 간격", p1(m.gapPct), `${P.minGapPct}% 이상`],
    ["직전 파동 고점과 시간 간격", `${m.gapWeeks}주`, `${P.minGapWeeks}주 이상`],
    ["최저점 → 고점 배수", `${num(m.runupMultiple, 1)}배`, `${P.maxRunupMultiple}배 미만`],
    ["고점 대비 하락폭", p1(m.drawdownPct), `${P.maxDrawdownPct}% 이하`],
    [`최근 ${P.breakWindowWeeks}주 저점 이탈`, `${m.lowBreaks}번`, `${P.maxLowBreaks}번 미만`],
  ];
  return (
    <details className="small">
      <summary className="muted">파동 수치 보기</summary>
      <div className="table-wrap">
        <table className="trades an2-metrics">
          <thead>
            <tr>
              <th className="left">항목</th>
              <th>값</th>
              <th className="left">기준</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v, c]) => (
              <tr key={k}>
                <td className="left">{k}</td>
                <td>{v}</td>
                <td className="left muted">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">책은 몸통·꼬리·파동에 명확한 수치를 두지 않아요. 10배·50% 외의 기준은 앱 기본값이라 백테스트로 조정해요.</p>
    </details>
  );
}

/** 진입·손절·목표(유효할 때) 또는 진입 대기 가격(손절폭이 최대를 넘을 때) */
function Levels({ r, region }: { r: CandleMasterResult; region: Region }) {
  const m = (n: number) => money(n, region);
  if (r.valid && r.entry != null && r.stop != null && r.stopPct != null) {
    return (
      <div className="levels">
        <div>
          <span className="muted">진입가(종가·손절가 사이 1/3) <Src rule="M3-12" /></span>
          <b>{m(r.entry)}</b>
          {r.entryMid != null && <span className="an2-sub">중간 지점 {m(r.entryMid)}도 가능해요 · 지정가로 기다려요</span>}
        </div>
        <div>
          <span className="muted">손절가 <Src rule="M4-01" /></span>
          <b className="down">{m(r.stop)}</b>
          <span className="an2-sub">
            진입가 대비 −{num(r.stopPct, 1)}% (기본 −{P.defaultStopPct}%, 최대 −{P.maxStopPct}%)
          </span>
        </div>
        {r.target != null && (
          <div>
            <span className="muted">목표가 ×{r.targetMultiple} <Src rule="M3-13" /></span>
            <b className="up">{m(r.target)}</b>
            <span className="an2-sub">
              {r.standard ? "파동·캔들군·신호가 모두 표준이에요" : "표준이 아닌 요소가 있어 2배로 잡아요 · +100%에 닿으면 목표 달성이에요"}
            </span>
          </div>
        )}
        {/* 본전 스탑은 목표(3배)보다 먼저 닿는 +100% 지점에서만 의미가 있다. 2배 목표면 같은 가격이라 따로 보여 주지 않는다 */}
        {r.breakevenTrigger != null && (r.target == null || r.breakevenTrigger < r.target) && (
          <div>
            <span className="muted">본전 스탑 발동가 <Src rule="M3-13" /></span>
            <b>{m(r.breakevenTrigger)}</b>
            <span className="an2-sub">+100%에 닿은 뒤 밀리면 진입가(본전)에 팔아요</span>
          </div>
        )}
      </div>
    );
  }
  if (r.waitPrice != null && r.stop != null && r.stopPct != null) {
    return (
      <div className="levels">
        <div>
          <span className="muted">신호 손절가 <Src rule="M4-01" /></span>
          <b className="down">{m(r.stop)}</b>
          <span className="an2-sub">1/3 지점 기준 −{num(r.stopPct, 1)}%로 최대 −{P.maxStopPct}%를 넘어요</span>
        </div>
        <div>
          <span className="muted">진입 대기 가격</span>
          <b>{m(r.waitPrice)}</b>
          <span className="an2-sub">진입가가 이 가격 이하로 내려와야 손절폭이 −{P.maxStopPct}% 안에 들어와요</span>
        </div>
      </div>
    );
  }
  return null;
}

/** M4-03 비중. 1,000만 원 소액 기준은 원화 자금에만 쓴다 */
function Sizing({ capital, region }: { capital: number; region: Region }) {
  const sz = candleMasterSizing(region === "US" ? 0 : capital);
  const split = sz.notes.filter((n) => n.rule === "5.2 캔들마스터");
  if (region === "US") {
    const per = Math.min(S.perStockPct, S.hardCapPct);
    return (
      <div className="an2-size">
        <p className="small">
          종목당 <b>{per}%</b>, 최대 <b>{S.maxPositions}종목</b>
          {capital > 0 && <> — 예수금 {money(capital, "US")} 기준 종목당 약 <b>{money((capital * per) / 100, "US")}</b></>}
          {" "}<Src rule="M4-03" />
        </p>
        <p className="muted small">어떤 경우도 종목당 {S.hardCapPct}%를 넘기지 않아요. 자금 1,000만 원 이하면 20%로 올리는 소액 기준은 원화 자금 기준이라 달러 계좌에는 쓰지 않았어요.</p>
        <NoteList notes={split} />
      </div>
    );
  }
  if (!(capital > 0)) {
    return (
      <div className="an2-size">
        <p className="small">
          자금 1,000만 원 이하면 종목당 {S.smallPerStockPct}%(최대 {S.smallMaxPositions}종목), 넘으면 {S.perStockPct}%(최대 {S.maxPositions}종목), 어떤 경우도 {S.hardCapPct}% 이하 <Src rule="M4-03" />
        </p>
        <p className="muted small">예수금을 입력하면 종목당 금액을 계산해 줘요.</p>
        <NoteList notes={split} />
      </div>
    );
  }
  return (
    <div className="an2-size">
      <NoteList notes={sz.notes} />
      <p className="muted small">어떤 경우도 종목당 {S.hardCapPct}%를 넘기지 않아요.</p>
    </div>
  );
}

/**
 * 캔들마스터 주봉 캔들매매(자료집 4.5, M3-12·M3-13·M4-01·M4-03) 결과.
 * 파동 → 캔들군 → 캔들 신호 3층을 차례로 보여 주고, 유효하면 진입·손절·목표·본전 스탑을 보여 준다.
 * 별도 매매법이라 종목 의견(Analysis.action)과는 무관하다.
 */
export function CandleMasterPanel({ r, capital, region }: { r: CandleMasterResult | null; capital: number; region: Region }) {
  if (!r) return <p className="muted small">주봉이 모자라거나 신호가 없어요.</p>;
  const st = statusOf(r);
  const w = r.wave;
  const m = w.metrics;
  const g = r.group;
  // r.notes = 파동 + 캔들군 + 신호 근거 + 결론. 층마다 제 근거를 보여 주고 결론만 따로 모은다(같은 문장을 두 번 그리지 않는다)
  const signalNotes = r.signals.flatMap((s) => s.notes);
  const layered = new Set([...w.notes, ...(g?.notes ?? []), ...signalNotes].map(noteKey));
  const rest = r.notes.filter((n) => !layered.has(noteKey(n)));

  return (
    <div className="an2-cm-body">
      <div className="an2-cm-head small">
        <span className={`an2-status an2-status-${st.tone}`}>{st.label}</span>
        <span className="muted">
          {r.date} 마감 주봉 기준 · 종가 {money(r.close, region)} · 주봉 {w.weeks}개
        </span>
      </div>

      <div className="an2-layer">① 파동</div>
      <div className="an2-flags">
        {w.exclusions.map((x) => (
          <span key={x} className="an2-flag an2-flag-bad" title={EXCLUSION_TEXT[x][1]}>
            ✖ 해석 제외 · {EXCLUSION_TEXT[x][0]}
          </span>
        ))}
        {m && (
          <>
            <Flag
              on={w.horizontal}
              label="수평 파동"
              title={`최근 ${P.baseWeeks}주 고저폭 ${p1(m.baseRangePct)} · 직전 파동 ${p1(m.priorRangePct)} · 저점 흐름 ${sp1(m.lowSlopePct)}`}
            />
            <Flag on={w.spaced} label="직전 파동과 간격" title={`직전 고점보다 ${p1(m.gapPct)} 아래 · ${m.gapWeeks}주 지남`} />
            <Flag on={w.rising} label="저점 서서히 상승" title={`저점 흐름 ${sp1(m.lowSlopePct)}(기준 +${P.risingMinPct}% 이상)`} />
          </>
        )}
      </div>
      <NoteList notes={w.notes} />
      <WaveMetrics r={r} />

      <div className="an2-layer">② 캔들군</div>
      {g ? (
        <>
          <div className="an2-flags">
            <Flag on={g.compact} label="수평 횡보 캔들군" title={`직전 ${g.weeks}주 고저폭 ${p1(g.rangePct)} · 평균 몸통 ${p1(g.avgBodyPct)}`} />
          </div>
          <NoteList notes={g.notes} />
        </>
      ) : (
        <p className="muted small">캔들군을 볼 주봉이 모자라요.</p>
      )}

      <div className="an2-layer">③ 캔들 신호</div>
      {r.signals.length ? (
        <>
          <div className="an2-flags">
            {r.signals.map((s) => (
              <span
                key={s.id}
                className={`chip an2-sig${s.id === r.primary ? " an2-sig-primary" : ""}`}
                title={s.id === r.primary ? "이 신호의 저점으로 손절가를 정했어요" : undefined}
              >
                {CANDLE_MASTER_SIGNAL_LABEL[s.id]}
                {s.weeks > 1 ? ` ${s.weeks}주` : ""}
                {s.id === r.primary ? " · 손절 기준" : ""}
              </span>
            ))}
          </div>
          <NoteList notes={signalNotes} />
        </>
      ) : (
        <p className="muted small">이번 주(마감 기준) 매수 신호 캔들이 없어요. 파동이 좋아도 신호가 나와야 진입 근거가 생겨요.</p>
      )}

      <div className="an2-layer">진입·손절·목표</div>
      <Levels r={r} region={region} />
      {rest.length > 0 ? <NoteList notes={rest} /> : !r.valid && r.waitPrice == null && <p className="muted small">진입 근거가 없어 진입가·목표가를 계산하지 않았어요.</p>}

      <div className="an2-layer">비중</div>
      <Sizing capital={capital} region={region} />
      <NoteList notes={[candleMaster244Note()]} />
    </div>
  );
}
