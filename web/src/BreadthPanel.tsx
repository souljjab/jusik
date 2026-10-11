import { useCallback, useEffect, useRef, useState } from "react";
import { BREADTH_PARAMS, type BreadthAnalysis, type BreadthResponse, type Candle, type Market } from "@jusik/shared";
import { CANDLE_COUNT, getBreadth } from "./api";
import { num } from "./format";
import { NoteList } from "./NoteList";
import { RuleTag } from "./DayTradeSettings";
import { BREADTH_LOG_MIN_DAYS, BreadthChart } from "./BreadthChart";
import "./styles/market.css";

const MARKETS: [Market, string][] = [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"], ["US", "미국"]];

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const scoreTone = (n: number) => (n > 0 ? "note-good" : n < 0 ? "note-bad" : "muted");
const count = (n: number) => n.toLocaleString("ko-KR");

/** 시장 폭 보조 점수(-1·0·+1) */
export function BreadthScore({ score }: { score: number }) {
  return (
    <span className={`mk-score ${scoreTone(score)}`} title="국면 점수에 더하는 시장 폭 점수(-1~+1)">
      {signed(score)}
    </span>
  );
}

export const HILO_STATE_LABEL: Record<"GOOD" | "BAD" | "NEUTRAL", string> = { GOOD: "신고가 우세", BAD: "신저가 우세", NEUTRAL: "뚜렷하지 않음" };
export const hiLoTone = (s: "GOOD" | "BAD" | "NEUTRAL" | null) => (s === "GOOD" ? "note-good" : s === "BAD" ? "note-bad" : "muted");

function SamplePill() {
  return (
    <span className="pill warn-pill" title="실제 시세가 아닌 임의로 만든 자료예요">
      샘플
    </span>
  );
}

// 지수 일봉: A/D선과 겹쳐 그려 M1-04 괴리를 눈으로 확인한다. api.ts와 같은 개수를 받아 서버 캐시를 같이 쓴다
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const INDEX_TTL = 10 * 60_000;
const indexCache = new Map<Market, { at: number; p: Promise<Candle[] | null> }>();
function loadIndexCandles(market: Market): Promise<Candle[] | null> {
  const hit = indexCache.get(market);
  if (hit && Date.now() - hit.at < INDEX_TTL) return hit.p;
  const p = fetch(`${BASE}/api/index/${market}/candles?count=${CANDLE_COUNT}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ candles?: Candle[] }>) : null))
    .then((b) => (b && Array.isArray(b.candles) && b.candles.length > 0 ? b.candles : null))
    .catch(() => null);
  indexCache.set(market, { at: Date.now(), p });
  // 실패는 기억하지 않는다
  p.then((c) => {
    if (!c && indexCache.get(market)?.p === p) indexCache.delete(market);
  });
  return p;
}

/** 거래소 전체 오늘 등락 종목 수(국내, 네이버)와 쌓인 기록 일수 */
function TodayCounts({ res }: { res: BreadthResponse }) {
  if (res.market === "US")
    return <p className="muted small mk-help">미국은 거래소 전체 등락 종목 수를 읽지 않아요. 위의 표본 근사치만 봐요.</p>;
  const t = res.today;
  const n = res.log.length;
  return (
    <>
      <h4 className="mk-sub">
        거래소 전체 등락 종목 수 <span className="muted small">네이버 지수 페이지</span>
        {res.sample && t && <SamplePill />}
      </h4>
      {!t ? (
        <p className="muted small mk-help">오늘 등락 종목 수를 읽지 못했어요(장 시작 전이거나 페이지 형식이 바뀌었을 수 있어요).</p>
      ) : (
        <div className="mk-counts">
          {(
            [
              ["상한", t.upperLimit, "up"],
              ["상승", t.up, "up"],
              ["보합", t.unchanged, "flat"],
              ["하락", t.down, "down"],
              ["하한", t.lowerLimit, "down"],
            ] as const
          ).map(([k, v, c]) => (
            <div key={k} className="mk-count">
              <span className="muted small">{k}</span>
              <b className={c}>{count(v)}</b>
            </div>
          ))}
        </div>
      )}
      <p className="muted small mk-help">
        {t && "참고값이라 점수에는 쓰지 않아요. "}
        {n >= BREADTH_LOG_MIN_DAYS
          ? `거래소 전체 기록 ${n}일 — 차트의 「거래소 A/D」에서 실제 A/D선을 볼 수 있어요.`
          : `거래소 전체 기록 ${n}일 — 쌓이면 실제 A/D선을 그려요(${BREADTH_LOG_MIN_DAYS}일부터, 앱이 켜진 날만 쌓여요).`}
      </p>
    </>
  );
}

/** 52주 신고가·신저가 종목 수(분석에 일별 기록이 없어 최근 값만) */
function HiLo({ a }: { a: BreadthAnalysis }) {
  const h = a.hiLo;
  return (
    <>
      <h4 className="mk-sub">
        52주 신고가·신저가 <RuleTag rule="2.2 와인스타인" />
        <span className={`small ${hiLoTone(a.hiLoState)}`}>{a.hiLoState ? HILO_STATE_LABEL[a.hiLoState] : "판정할 종목이 없어요"}</span>
      </h4>
      <div className="mk-hilo">
        <div className="metric"><span className="muted small">신고가 · {a.asOf}</span><b className="up">{count(h.newHigh)}종목</b></div>
        <div className="metric"><span className="muted small">신저가 · {a.asOf}</span><b className="down">{count(h.newLow)}종목</b></div>
        <div className="metric"><span className="muted small">최근 {BREADTH_PARAMS.hiLoAvgDays}일 평균 신고가</span><b>{num(h.avg10High, 1)}</b></div>
        <div className="metric"><span className="muted small">최근 {BREADTH_PARAMS.hiLoAvgDays}일 평균 신저가</span><b>{num(h.avg10Low, 1)}</b></div>
      </div>
      <p className="muted small mk-help">
        중·단기 시장 건강도를 보는 수치라 이것만으로 판단하지 않아요. 한쪽 평균이 다른 쪽의 {BREADTH_PARAMS.hiLoRatio}배 이상이고 판정 가능 종목의 {BREADTH_PARAMS.hiLoMinPct}% 이상일 때만 우세로 봐요(앱 기본값).
        일별 추이는 아직 없어 최근 값만 보여 드려요.
      </p>
    </>
  );
}

function Loaded({ res, index, onRetry, busy }: { res: BreadthResponse; index: Candle[] | null | undefined; onRetry: () => void; busy: boolean }) {
  const a = res.analysis;
  return (
    <>
      <div className="mk-meta small">
        {res.sample && <SamplePill />}
        {a && (
          <>
            <span>기준 <b>{a.basis}</b></span>
            <span className="muted">집계 {count(a.sampleSize)}종목 · 기준일 {a.asOf} · 집계일 {count(a.adLine.length)}일</span>
          </>
        )}
        {res.basketSize > 0 && <span className="muted">표본 바스켓 {count(res.basketSize)}종목</span>}
      </div>
      {!a ? (
        <div className="mk-pending">
          <p className="small muted">시장 폭을 계산할 표본 일봉을 받지 못했어요. 잠시 뒤 다시 봐 주세요.</p>
          <button type="button" className="small-btn" disabled={busy} onClick={onRetry}>{busy ? "확인 중…" : "다시 보기"}</button>
        </div>
      ) : (
        <>
          <p className="small">
            보조 점수 <BreadthScore score={a.score} />{" "}
            <span className="muted">약세 괴리·MI 교차·신고가-신저가 신호를 더해 -1~+1로 자른 값이에요. 국면 점수에 이만큼만 더해요.</span>
          </p>
          <NoteList notes={a.signals} />
          <BreadthChart analysis={a} log={res.log} index={index} />
          <HiLo a={a} />
        </>
      )}
      <TodayCounts res={res} />
      {res.errors.length > 0 && (
        <details className="small mk-errors">
          <summary className="note-warn">받지 못한 자료 {res.errors.length}건</summary>
          <ul className="notes">
            {res.errors.slice(0, 8).map((e, i) => <li key={i} className="note-warn">{e}</li>)}
          </ul>
          {res.errors.length > 8 && <p className="muted">외 {res.errors.length - 8}건</p>}
        </details>
      )}
    </>
  );
}

/**
 * 시장 폭 카드(2.2 시장 내부 지표: M1-04 A/D선, M1-05 MI, 고점-저점 수치).
 * 처음 계산이 무거워 카드를 펼쳤을 때만 서버에 묻는다.
 */
export function BreadthPanel({ defaultMarket = "KOSPI" }: { defaultMarket?: Market }) {
  const [open, setOpen] = useState(false);
  const [market, setMarket] = useState<Market>(defaultMarket);
  const [got, setGot] = useState<{ market: Market; res: BreadthResponse | null } | null>(null);
  const [idx, setIdx] = useState<{ market: Market; candles: Candle[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const req = useRef(0);

  const load = useCallback((m: Market, fresh: boolean) => {
    const id = ++req.current;
    setBusy(true);
    getBreadth(m, fresh)
      .catch(() => null)
      .then((res) => {
        if (id !== req.current) return;
        setGot({ market: m, res });
        setBusy(false);
      });
  }, []);

  useEffect(() => {
    if (open) load(market, false);
  }, [open, market, load]);
  // 화면을 떠난 뒤 도착한 응답은 버린다
  useEffect(() => () => void req.current++, []);

  const res = got?.market === market ? got.res : undefined;
  const ready = !!res && !res.pending && !!res.analysis;
  // 분석이 나온 뒤에만 지수 일봉을 받는다(A/D선 겹쳐 보기용)
  useEffect(() => {
    if (!open || !ready) return;
    let live = true;
    loadIndexCandles(market).then((candles) => live && setIdx({ market, candles }));
    return () => {
      live = false;
    };
  }, [open, ready, market]);
  const index = idx?.market === market ? idx.candles : undefined;
  const retry = () => load(market, true);

  return (
    <details className="card mk-breadth" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <b>시장 폭 — A/D선·시장 탄력지수(MI)</b> <RuleTag rule="2.2 와인스타인" />
        <span className="muted small">국면 점수의 보조 신호(-1~+1점)</span>
      </summary>
      {open && (
        <>
          <div className="mk-bar">
            <div className="seg mk-seg" role="radiogroup" aria-label="시장">
              {MARKETS.map(([m, label]) => (
                <button key={m} type="button" role="radio" aria-checked={market === m} className={market === m ? "on" : ""} onClick={() => setMarket(m)}>
                  {label}
                </button>
              ))}
            </div>
            {ready && (
              <button type="button" className="link small" disabled={busy} onClick={retry}>
                {busy ? "불러오는 중…" : "새로 받기"}
              </button>
            )}
          </div>
          {res === undefined ? (
            <p className="muted small">불러오는 중…</p>
          ) : res === null ? (
            <div className="mk-pending">
              <p className="small note-bad">시장 폭을 불러오지 못했어요. 서버 연결을 확인해 주세요.</p>
              <button type="button" className="small-btn" disabled={busy} onClick={retry}>{busy ? "확인 중…" : "다시 보기"}</button>
            </div>
          ) : res.pending ? (
            <div className="mk-pending">
              <p className="small">
                계산 중이에요(처음 계산은 바스켓 종목 일봉을 모두 받아 1분 넘게 걸릴 수 있어요).
                {res.market !== "US" && res.log.length > 0 && <span className="muted"> 거래소 전체 기록은 {res.log.length}일 쌓였어요.</span>}
              </p>
              <button type="button" className="small-btn" disabled={busy} onClick={retry}>{busy ? "확인 중…" : "다시 보기"}</button>
            </div>
          ) : (
            <Loaded res={res} index={index} onRetry={retry} busy={busy} />
          )}
          <p className="muted small mk-help">
            거래소 전체가 아니라 대형주 표본 종목의 일봉으로 근사한 값이에요(무엇으로 계산했는지는 「기준」에 적었어요). 판정 기간·비율 중 책에 수치가 없는 것은 앱 기본값이라 조정 대상이에요.
          </p>
        </>
      )}
    </details>
  );
}
