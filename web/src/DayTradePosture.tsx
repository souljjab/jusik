import { currencyOfRegion, POSTURE_LABEL, regionOf, type Currency, type GuardResult, type Market, type RegimeAssessment, type ScanResult, type Settings } from "@jusik/shared";
import { NoteList } from "./NoteList";
import { RuleTag } from "./DayTradeSettings";
import "./styles/daytrade.css";

const MARKET_LABEL: Record<Market, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "미국" };
const NEXT_SCAN = "다음 스캔부터 표시돼요";
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

function Breakdown({ b }: { b: RegimeAssessment["breakdown"] }) {
  const parts: [string, number][] = [["주봉 단계", b.stage], ["MACD", b.macd], ["RSI", b.rsi], ["매크로", b.macro]];
  return (
    <span className="dt-breakdown">
      {parts.map(([k, v]) => (
        <span key={k} className="dt-part">{k} <b className={v > 0 ? "up" : v < 0 ? "down" : "flat"}>{signed(v)}</b></span>
      ))}
    </span>
  );
}

function MarketPosture({ market, p }: { market: Market; p: RegimeAssessment | null | undefined }) {
  if (!p)
    return (
      <div className="dt-market">
        <div className="dt-market-head"><b>{MARKET_LABEL[market]}</b> <span className="chip">확인 불가</span></div>
        <p className="muted small">지수 데이터를 읽지 못해 국면을 판정하지 못했어요. 이 시장은 중립 상한으로 계산했어요.</p>
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
      <details className="dt-why">
        <summary className="muted small">근거 {p.notes.length}개 보기</summary>
        <NoteList notes={p.notes} />
      </details>
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
          {scan.markets.map((m) => <MarketPosture key={m} market={m} p={scan.postures?.[m]} />)}
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
