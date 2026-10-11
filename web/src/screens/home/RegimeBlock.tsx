import { ChevronRight } from "lucide-react";
import { currencyOfRegion, POSTURE_LABEL, regionOf, type Candle, type Market, type RegimeAssessment, type ScanResult } from "@jusik/shared";
import { Link } from "../../app/router";
import { fmtDate, RegimeGauge, Segmented } from "../../ui";
import { capSource, lastMacdCross, MARKET_LABEL, regimeReasons, signed } from "./homeModel";

/** 고른 시장의 국면 판정과 그 상태(이전 버전 스캔·이번 스캔에 없음·판정 불가) */
export type PostureState =
  | { kind: "ok"; p: RegimeAssessment }
  | { kind: "old" }
  | { kind: "missing" }
  | { kind: "na" };

export function postureStateOf(scan: ScanResult, market: Market): PostureState {
  if (!scan.postures) return { kind: "old" };
  if (!scan.markets.includes(market)) return { kind: "missing" };
  const p = scan.postures[market];
  return p ? { kind: "ok", p } : { kind: "na" };
}

/** 이 시장의 통화 계좌에 실제로 적용한 상한(국내는 코스피·코스닥 중 낮은 쪽). 없으면 null */
export function appliedCap(scan: ScanResult, market: Market): { pct: number; source: string } | null {
  const cur = currencyOfRegion(regionOf(market));
  const pct = scan.exposureCaps?.[cur];
  return pct == null ? null : { pct, source: capSource(cur, scan.markets) };
}

const STATE_TEXT: Record<Exclude<PostureState["kind"], "ok">, string> = {
  old: "국면 점수는 다음 스캔부터 보여요.",
  missing: "이 시장은 마지막 스캔에 들어 있지 않아요. 다음 스캔부터 보여요.",
  na: "지수 자료를 읽지 못해 국면을 판정하지 못했어요. 이 시장은 중립 상한으로 계산했어요.",
};

/** 시장 고르기(설정에서 켠 시장이 둘 이상일 때만) */
export function MarketPicker({ market, markets, onChange, size = "sm" }: { market: Market; markets: Market[]; onChange: (m: Market) => void; size?: "sm" | "md" }) {
  if (markets.length < 2) return <span className="t-2">{MARKET_LABEL[market]}</span>;
  return <Segmented label="시장" size={size} value={market} onChange={onChange} options={markets.map((m) => ({ value: m, label: MARKET_LABEL[m] }))} />;
}

/** 지수 일봉 마지막 날이 판정 기준일과 같을 때만 MACD 교차 시점을 쓴다 */
function crossOf(p: RegimeAssessment, candles: Candle[] | null | undefined) {
  if (!candles?.length || candles.at(-1)!.date !== p.asOf) return null;
  return lastMacdCross(candles.map((c) => c.close));
}

/**
 * 시장 국면(지도서 5.1 D·7.1 A). 국면 이름이 화면에서 가장 큰 글자이고, 카드 없이 강조색 세로선 하나로 구분한다.
 * 아래에 채운 칸 수 게이지, 근거 문장(컴퓨터 두 줄·핸드폰 한 줄), 주식 비중 상한.
 */
export function RegimeBlock({ state, applied, market, markets, onMarket, candles, compact = false, headingId }: {
  state: PostureState;
  /** 계좌에 실제로 적용한 상한(시장 상한과 다를 때 함께 쓴다) */
  applied?: { pct: number; source: string } | null;
  market: Market;
  markets: Market[];
  onMarket: (m: Market) => void;
  candles?: Candle[] | null;
  compact?: boolean;
  headingId?: string;
}) {
  const p = state.kind === "ok" ? state.p : null;
  const reasons = p ? regimeReasons(p, crossOf(p, candles)) : [];
  return (
    <section className={`home-regime ${compact ? "compact" : ""}`} aria-labelledby={headingId}>
      <div className="home-regime-head">
        <h2 id={headingId} className="home-eyebrow">
          시장 국면{markets.length < 2 && <span className="sr-only"> {MARKET_LABEL[market]}</span>}
        </h2>
        <MarketPicker market={market} markets={markets} onChange={onMarket} size={compact ? "md" : "sm"} />
      </div>
      <p className="home-regime-label" aria-live="polite">
        {p ? POSTURE_LABEL[p.posture] : "판정 없음"}
      </p>
      <RegimeGauge posture={p?.posture ?? null} size="lg" />
      {p ? (
        <>
          {compact ? (
            <p className="home-reason">{reasons.map((r) => r.short).join(", ")}</p>
          ) : (
            <ul className="home-reasons">
              {reasons.map((r) => (
                <li key={r.short}>{r.long}</li>
              ))}
            </ul>
          )}
          <p className="home-cap">
            주식 비중 상한 <span className="num">{p.exposureCapPct}%</span>
          </p>
          {applied && applied.pct !== p.exposureCapPct && (
            <p className="t-2">
              계좌에는 <span className="num">{applied.pct}%</span>를 적용해요({applied.source}).
            </p>
          )}
          <p className="t-cap">
            국면 점수 <span className="num">{signed(p.score)}</span> · {fmtDate(p.asOf)} 지수 기준
          </p>
        </>
      ) : (
        <p className="t-2">{STATE_TEXT[state.kind as Exclude<PostureState["kind"], "ok">]}</p>
      )}
      <Link to="/?view=regime" className="home-more">
        국면 근거 보기
        <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
      </Link>
    </section>
  );
}
