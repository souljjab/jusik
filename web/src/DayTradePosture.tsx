import {
  currencyOfRegion, MACRO_PARAMS, POSTURE_LABEL, regionOf,
  type BreadthSummary, type Currency, type GuardResult, type Market, type RegimeAssessment, type ScanResult, type Settings,
} from "@jusik/shared";
import { NoteList } from "./NoteList";
import { RuleTag } from "./DayTradeSettings";
import { BreadthScore, HILO_STATE_LABEL, hiLoTone } from "./BreadthPanel";
import "./styles/daytrade.css";
import "./styles/market.css";

const MARKET_LABEL: Record<Market, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "미국" };
const NEXT_SCAN = "다음 스캔부터 표시돼요";
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

function Breakdown({ b }: { b: RegimeAssessment["breakdown"] }) {
  const parts: [string, number][] = [["주봉 단계", b.stage], ["MACD", b.macd], ["RSI", b.rsi], ["매크로", b.macro]];
  // 이전 버전에서 저장한 스캔에는 시장 폭 점수가 없다
  if (typeof b.breadth === "number") parts.push(["시장 폭", b.breadth]);
  return (
    <span className="dt-breakdown">
      {parts.map(([k, v]) => (
        <span key={k} className="dt-part" title={k === "시장 폭" ? "A/D선·MI·신고가-신저가 보조 신호(-1~+1점)" : undefined}>
          {k} <b className={v > 0 ? "up" : v < 0 ? "down" : "flat"}>{signed(v)}</b>
        </span>
      ))}
    </span>
  );
}

/** 스캔에 남은 시장 폭 상태: old(이전 버전 스캔) · none(시장 폭 공급자 없음) · pending(계산 중이거나 못 함) · 요약 */
type BreadthState = "old" | "none" | "pending" | BreadthSummary;

function breadthStateOf(scan: ScanResult, m: Market): BreadthState {
  if (scan.breadth === undefined) return "old";
  const b = scan.breadth[m];
  return b === undefined ? "none" : b === null ? "pending" : b;
}

const fmtCount = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("ko-KR")}`;

const DIVERGENCE: Record<"BEARISH" | "BULLISH", [string, string]> = { BEARISH: ["약세 괴리", "note-bad"], BULLISH: ["강세 괴리(참고)", "note-info"] };

/** 국면 상자 안 시장 폭 요약(2.2 와인스타인, M1-04·05) */
function BreadthBrief({ b }: { b: BreadthState }) {
  if (b === "old") return <p className="muted small mk-bsum">시장 폭은 {NEXT_SCAN}.</p>;
  if (b === "none") return <p className="muted small mk-bsum">시장 폭 자료가 없어 국면 점수에서 빠졌어요.</p>;
  if (b === "pending")
    return <p className="muted small mk-bsum">시장 폭 계산 중이에요(또는 표본 일봉을 받지 못했어요). 이번 국면 점수에는 넣지 않았어요. 아래 「시장 폭」 카드에서 확인할 수 있어요.</p>;
  const div = b.divergence ? DIVERGENCE[b.divergence] : null;
  return (
    <div className="small mk-bsum">
      <div className="mk-bsum-head">
        <b>시장 폭</b> <BreadthScore score={b.score} /> <RuleTag rule="2.2 와인스타인" />
        <span className="muted">{b.asOf} 집계 {b.sampleSize.toLocaleString("ko-KR")}종목</span>
      </div>
      <div className="mk-facts">
        <span className="mk-fact" title="M1-04: 지수 고점↑·A/D선 고점↓면 약세 괴리">
          {div ? <b className={div[1]}>{div[0]}</b> : <span className="muted">A/D 괴리 없음</span>}
        </span>
        <span className="mk-fact" title="M1-05: 순상승 종목 수 200일 합계">
          <span className="muted">MI </span>
          {b.mi == null ? <span className="muted">집계일 부족</span> : <b className={b.mi > 0 ? "up" : b.mi < 0 ? "down" : "flat"}>{fmtCount(b.mi)}</b>}
          {b.miSignal && (
            <b className={b.miSignal.dir === "UP" ? "note-good" : "note-bad"}> · 0선 {b.miSignal.dir === "UP" ? "상향" : "하향"} 교차({b.miSignal.date.slice(5)})</b>
          )}
        </span>
        <span className="mk-fact">
          <span className="muted">신고가 </span><b className="up">{b.hiLo.newHigh.toLocaleString("ko-KR")}</b>
          <span className="muted"> / 신저가 </span><b className="down">{b.hiLo.newLow.toLocaleString("ko-KR")}</b>
          {b.hiLoState && <span className={hiLoTone(b.hiLoState)}> ({HILO_STATE_LABEL[b.hiLoState]})</span>}
        </span>
      </div>
      <div className="muted mk-basis">{b.basis}</div>
    </div>
  );
}

function MarketPosture({ market, p, breadth }: { market: Market; p: RegimeAssessment | null | undefined; breadth: BreadthState }) {
  if (!p)
    return (
      <div className="dt-market">
        <div className="dt-market-head"><b>{MARKET_LABEL[market]}</b> <span className="chip">확인 불가</span></div>
        <p className="muted small">지수 데이터를 읽지 못해 국면을 판정하지 못했어요. 이 시장은 중립 상한으로 계산했어요.</p>
        <BreadthBrief b={breadth} />
      </div>
    );
  return (
    <div className="dt-market">
      <div className="dt-market-head">
        <b>{MARKET_LABEL[market]}</b>
        <span className={`chip dt-posture-${p.posture}`}>{POSTURE_LABEL[p.posture]}</span>
        <span className="dt-cap">투자 상한 <b>{p.exposureCapPct}%</b></span>
      </div>
      <div className="small">
        국면 점수 <b className={p.score > 0 ? "up" : p.score < 0 ? "down" : "flat"}>{signed(p.score)}</b> <span className="muted">= </span>
        <Breakdown b={p.breakdown} />
      </div>
      <div className="small muted">
        지수 기준일 {p.asOf}
        {p.rsi != null && <> · RSI {p.rsi.toFixed(0)}</>}
        {p.choppy && <> · <span className="note-warn">횡보장 가능성</span></>}
      </div>
      <BreadthBrief b={breadth} />
      <details className="dt-why">
        <summary className="muted small">근거 {p.notes.length}개 보기</summary>
        <NoteList notes={p.notes} />
      </details>
    </div>
  );
}

const fmtPp = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%p`;

/** 스캔에 쓴 매크로 요약: ISM 제조업지수와 금리 추세(2.3 강영현·강동진, M2-10의 금리 상승기 조건) */
function MacroBrief({ scan }: { scan: ScanResult }) {
  const m = scan.macroSummary;
  if (!m) {
    // 새 버전 스캔인데 요약이 없으면 매크로를 받지 못한 것
    const newer = scan.breadth !== undefined || scan.minuteSkips !== undefined;
    return <p className="muted small mk-macro">{newer ? "매크로를 받지 못해 ISM·금리 추세가 없어요." : `ISM·금리 추세는 ${NEXT_SCAN}.`}</p>;
  }
  const i = m.ism;
  return (
    <div className="small mk-macro">
      <span>
        ISM 제조업{" "}
        {i ? (
          <>
            <b className={i.value >= MACRO_PARAMS.ismLine ? "note-good" : "note-warn"}>{i.value.toFixed(1)}</b>{" "}
            <span className="muted">({i.month} · {i.source === "수동" ? "직접 입력" : "ISM 사이트"} · {i.value >= MACRO_PARAMS.ismLine ? "확장" : "수축"})</span>
          </>
        ) : (
          <span className="muted">없음 — 지역 연준 제조업 지수가 있으면 대용으로 판단해요(설정에서 직접 넣을 수 있어요)</span>
        )}{" "}
        <RuleTag rule="2.3 강영현·강동진" />
      </span>
      <span>
        금리{" "}
        {m.rateRising == null ? (
          <span className="muted">추세 모름</span>
        ) : m.rateRising ? (
          <b className="note-warn">상승기</b>
        ) : (
          <span>상승기 아님</span>
        )}
        {m.us10yChange6m != null && (
          <span className="muted"> (미 10년물 약 6개월 {fmtPp(m.us10yChange6m)}, 기준 +{MACRO_PARAMS.rateRisingPp}%p)</span>
        )}{" "}
        <RuleTag rule="2.3·M2-10 강영현" />
      </span>
    </div>
  );
}

/** 통화별로 실제 적용한 상한이 어떤 시장에서 왔는지 */
function capSource(cur: Currency, markets: Market[]): string {
  const mine = markets.filter((m) => currencyOfRegion(regionOf(m)) === cur);
  if (mine.length === 0) return "이 지역은 스캔하지 않아 중립 상한";
  if (mine.length === 1) return `${MARKET_LABEL[mine[0]!]} 기준`;
  return `${mine.map((m) => MARKET_LABEL[m]).join("·")} 중 낮은 쪽`;
}

/** 시장별 국면(공격·중립·방어)·국면 점수·투자 상한과 매크로 기준일 */
export function PosturePanel({ scan }: { scan: ScanResult }) {
  const caps = scan.exposureCaps;
  // 이전 버전에서 저장한 스캔에는 국면·상한·매크로 필드가 없다
  if (!scan.postures && !caps && scan.macroAsOf === undefined)
    return (
      <div className="card">
        <h3 className="h3">시장 국면과 투자 상한 <RuleTag rule="2.5 강동진" /></h3>
        <p className="muted small">국면 점수·투자 상한·매크로 기준일은 {NEXT_SCAN}.</p>
      </div>
    );
  return (
    <div className="card">
      <h3 className="h3">시장 국면과 투자 상한 <RuleTag rule="2.5 강동진" /></h3>
      {!scan.postures ? (
        <p className="muted small">국면 점수는 {NEXT_SCAN}.</p>
      ) : scan.markets.length === 0 ? (
        <p className="muted small">스캔한 시장이 없어요. 설정에서 시장을 골라 주세요.</p>
      ) : (
        <div className="dt-markets">
          {scan.markets.map((m) => <MarketPosture key={m} market={m} p={scan.postures?.[m]} breadth={breadthStateOf(scan, m)} />)}
        </div>
      )}
      <div className="small dt-caps">
        {!caps ? (
          <span className="muted">적용 투자 상한은 {NEXT_SCAN}</span>
        ) : (
          <span>
            적용 투자 상한{" "}
            {(["KRW", "USD"] as const).map((cur, i) => (
              <span key={cur}>
                {i > 0 && " / "}
                {cur === "KRW" ? "원화" : "달러"} <b>{caps[cur] != null ? `${caps[cur]}%` : "-"}</b> <span className="muted">({capSource(cur, scan.markets)})</span>
              </span>
            ))}
          </span>
        )}
        <span className="muted">
          {scan.macroAsOf === undefined ? `매크로 기준일은 ${NEXT_SCAN}` : scan.macroAsOf ? `매크로 기준일 ${scan.macroAsOf}` : "매크로 없음(국면 점수에서 매크로 감점은 빠졌어요)"}
        </span>
      </div>
      <MacroBrief scan={scan} />
      <p className="muted small dt-help">국면 점수와 상한은 저자 경험칙과 예시값으로 만든 기준이라 검증된 통계가 아니에요.</p>
    </div>
  );
}

/** 통화별 리스크 가드(M4-04 하루 손실 한도, 5.5 연속 손실 휴식) 상태 */
export function GuardStatus({ guard, settings, hasScan }: { guard: GuardResult | undefined; settings: Settings; hasScan: boolean }) {
  if (!hasScan) return null;
  if (!guard) return <p className="muted small dt-guard">리스크 가드는 {NEXT_SCAN}.</p>;
  const paperOff = !settings.paperEnabled && <span className="muted"> (모의매매가 꺼져 있어 참고용이에요)</span>;
  if (guard.blocked)
    return (
      <div className="dt-guard">
        <div className="banner error dt-guard-banner"><b>신규 진입 중지(모의 자동매매)</b>{paperOff}</div>
        <NoteList notes={guard.notes} />
      </div>
    );
  if (guard.notes.length > 0)
    return (
      <div className="dt-guard">
        <div className="small note-warn"><b>리스크 가드 경고</b>{paperOff}</div>
        <NoteList notes={guard.notes} />
      </div>
    );
  const off = !(settings.dailyLossLimitPct > 0) && !(settings.maxConsecutiveLosses > 0);
  return (
    <p className="small dt-guard">
      {off ? (
        <span className="muted">리스크 가드(하루 손실 한도·연속 손실 휴식)가 모두 꺼져 있어요.</span>
      ) : (
        <>
          <span className="note-good">✔ 리스크 가드 통과</span>{" "}
          <span className="muted">
            ({[settings.dailyLossLimitPct > 0 && `하루 손실 한도 ${settings.dailyLossLimitPct}%`, settings.maxConsecutiveLosses > 0 && `연속 손실 ${settings.maxConsecutiveLosses}회`].filter(Boolean).join(" · ")})
          </span>
        </>
      )}
    </p>
  );
}
