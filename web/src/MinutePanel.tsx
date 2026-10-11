import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  aggregateBars, INTRADAY_PARAMS, INTRADAY_SESSIONS, marketClock,
  type IntradayAssessment, type IntradayBar, type IntradayVerdict, type MinuteResponse, type Note, type Region,
} from "@jusik/shared";
import { getMinute } from "./api";
import { money, pct, tone } from "./format";
import { MinuteChart, type MinuteLevel } from "./MinuteChart";
import { NoteList } from "./NoteList";
import "./styles/minute.css";

/** 장중 자동 새로고침 간격(서버도 분봉을 30초 캐시한다) */
const REFRESH_MS = 30_000;
const RULE = "4.7·M3-18 강창권";

const VERDICT: Record<IntradayVerdict, { label: string; help: string }> = {
  buy: { label: "매수 가능", help: "규칙상 매수 조건을 갖췄다는 뜻이에요. 수익을 보장하지 않아요." },
  wait: { label: "대기", help: "아직 규칙상 매수 자리가 아니에요. 조건이 갖춰질 때까지 기다려요." },
  avoid: { label: "피하기", help: "규칙상 오늘은 사지 않는 자리예요." },
};

const TZ_LABEL: Record<Region, string> = { KR: "한국 시각", US: "뉴욕 현지 시각" };

interface State {
  code: string;
  data: MinuteResponse | null;
  error: string | null;
  loading: boolean;
  /** 마지막으로 받아 온 시각(이 기기 시계) */
  at: number | null;
}

const idle = (code: string): State => ({ code, data: null, error: null, loading: true, at: null });

const elapsed = (m: number) => (m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`);
const clockText = (ms: number) => new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const isOpenNow = (region: Region) => marketClock(region, new Date()).isOpen;

/** 판단 상태 꼬리표 */
function Flag({ tone: t, children }: { tone: Note["tone"]; children: ReactNode }) {
  return <span className={`chip mn-flag mn-tone-${t}`}>{children}</span>;
}

/**
 * 분할 매수가 이름 붙이기: 3분봉 첫 캔들이 양봉이면 종가 기준 1/3선이 몸통 중심선보다 높고, 음봉이면 반대다.
 * 판단(assessment)의 값은 그대로 쓰고, 이름만 같은 분봉에서 첫 3분봉 방향을 보고 정한다.
 */
function splitLabels(prices: number[], bars: IntradayBar[], region: Region): string[] {
  const open = INTRADAY_SESSIONS[region].open;
  const first = aggregateBars(bars, 3, open)[0];
  const firstOk = first && first.t.slice(11) === open;
  if (prices.length === 1) return ["몸통 중심선(=1/3선)"];
  if (prices.length !== 2 || !firstOk) return prices.map((_, i) => `${i + 1}차`);
  return first.close >= first.open ? ["종가 기준 1/3선", "몸통 중심선"] : ["몸통 중심선", "종가 기준 1/3선"];
}

/** 차트 가로선에 붙일 짧은 이름 */
const shortLabel = (label: string | undefined) => (!label ? "분할" : label.startsWith("몸통") ? "중심선" : label.includes("1/3") ? "1/3선" : label);

/** 분봉 탭: 1분봉·3분봉 차트와 강창권 장중 타점 판단(4.7·M3-18) */
export function MinutePanel({ code, region }: { code: string; region: Region }) {
  const [st, setSt] = useState<State>(() => idle(code));
  const [open, setOpen] = useState(() => isOpenNow(region));
  const seq = useRef(0);

  const load = useCallback(() => {
    const id = ++seq.current;
    setSt((s) => (s.code === code ? { ...s, loading: true } : idle(code)));
    getMinute(code)
      .then((data) => id === seq.current && setSt({ code, data, error: null, loading: false, at: Date.now() }))
      .catch((e: Error) => id === seq.current && setSt((s) => ({ ...s, code, error: e.message, loading: false })));
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);
  // 탭을 떠난 뒤 도착한 응답은 버린다
  useEffect(() => () => void ++seq.current, []);

  // 그 시장 정규장이 열려 있고 이 탭이 떠 있는 동안만 30초마다 새로 받는다
  useEffect(() => {
    setOpen(isOpenNow(region));
    const t = setInterval(() => {
      const o = isOpenNow(region);
      setOpen(o);
      if (o && (typeof document === "undefined" || document.visibilityState !== "hidden")) load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [region, load]);

  const data = st.code === code ? st.data : null;
  const a = data?.assessment ?? null;
  // 봉 시각·금액 표기는 응답의 시장 기준(종목 코드에서 정한 값과 같다)
  const reg = data?.region ?? region;
  const today = marketClock(reg, new Date()).date;
  const stale = !!data?.sessionDate && data.sessionDate !== today;

  const labels = useMemo(() => (a && data ? splitLabels(a.entry.splitPrices, data.bars, data.region) : []), [a, data]);
  const levels = useMemo<MinuteLevel[]>(() => {
    if (!a) return [];
    const out: MinuteLevel[] = a.entry.splitPrices.map((p, i) => ({ price: p, title: shortLabel(labels[i]), kind: "split" }));
    if (a.entry.stop != null) out.push({ price: a.entry.stop, title: "손절", kind: "stop" });
    return out;
  }, [a, labels]);

  return (
    <>
      <div className="card mn-panel">
        <div className="mn-head">
          <h3 className="h3 mn-title">
            분봉
            {data?.sessionDate && <small className="muted">{data.sessionDate} · {TZ_LABEL[reg]}</small>}
          </h3>
          {data?.sample && <span className="pill warn-pill" title="실제 시세가 아닌 임의로 만든 분봉이에요">샘플</span>}
          <span className={open ? "mn-live on" : "mn-live"}>
            {open ? "● 장중 · 30초마다 자동 새로고침" : "장 시간이 아니라 자동 새로고침은 쉬어요"}
          </span>
          <button className="primary small-btn mn-refresh" onClick={load} disabled={st.loading}>
            {st.loading ? "불러오는 중…" : "새로고침"}
          </button>
        </div>
        {st.at != null && <p className="muted small mn-meta">마지막 갱신 {clockText(st.at)}(이 기기 시각)</p>}

        {st.error && <div className="banner error">분봉을 불러오지 못했어요: {st.error}</div>}
        {data?.message && <div className="banner warn-banner mn-msg">{data.message}</div>}
        {!data && st.loading && <p className="muted">분봉을 불러오는 중이에요…</p>}
        {data && <MinuteChart bars={data.bars} region={data.region} levels={levels} />}
      </div>

      {data && a && <AssessmentCard a={a} region={data.region} stale={stale} sessionDate={data.sessionDate} labels={labels} />}
      {data && !a && !data.message && <p className="muted small">분봉 판단 자료가 없어요.</p>}

      <RulesCaption />
    </>
  );
}

function AssessmentCard({ a, region, stale, sessionDate, labels }: {
  a: IntradayAssessment; region: Region; stale: boolean; sessionDate: string | null; labels: string[];
}) {
  const v = VERDICT[a.entry.verdict];
  return (
    <div className="card mn-assess">
      <div className="mn-verdict-row">
        <h3 className="h3 mn-title">분봉 타점 판단</h3>
        <span className={`chip mn-verdict mn-verdict-${a.entry.verdict}`}>{v.label}</span>
        {stale && <span className="pill warn-pill" title="오늘 장 분봉이 아니에요">{sessionDate} 마감 기준</span>}
        {a.asOf && <span className="muted small">{a.asOf.slice(11)} 봉까지 반영</span>}
      </div>
      <p className="muted small mn-help">
        {v.help}
        {stale && " 지난 장 마감 기준이라 지금 매매 판단으로 쓰지 마세요."}
      </p>
      <NoteList notes={a.entry.notes} />
      {a.asOf && <AssessmentDetail a={a} region={region} labels={labels} />}
    </div>
  );
}

/** 판단 근거 수치와 항목별 상태(보유·눌림·손절·돌파). 오늘 분봉이 하나라도 있을 때만 */
function AssessmentDetail({ a, region, labels }: { a: IntradayAssessment; region: Region; labels: string[] }) {
  const m = (n: number | null | undefined) => (n == null ? "-" : money(n, region));
  const P = INTRADAY_PARAMS;
  return (
    <>
      <div className="metrics mn-metrics">
        <div className="metric">
          <span className="muted small">시초가 갭</span>
          <b className={a.gapPct == null ? "flat" : tone(a.gapPct)}>{a.gapPct == null ? "-" : pct(a.gapPct)}</b>
        </div>
        <div className="metric">
          <span className="muted small">장 시작 후 경과</span>
          <b>{elapsed(a.minutesSinceOpen)}</b>
        </div>
        <div className="metric">
          <span className="muted small">당일 저가</span>
          <b>{m(a.sessionLow)}</b>
        </div>
        <div className="metric">
          <span className="muted small">마지막 1분봉 종가</span>
          <b>{m(a.last)}</b>
        </div>
      </div>

      <div className="mn-plan">
        <div className="mn-plan-item">
          <span className="muted small">분할 매수가 <span className="mn-sub">3분봉 첫 캔들 몸통 중심선·종가 기준 1/3선</span></span>
          {a.entry.splitPrices.length ? (
            <ul className="mn-prices">
              {a.entry.splitPrices.map((p, i) => (
                <li key={i}><b>{m(p)}</b> <span className="muted small">{labels[i]}</span></li>
              ))}
            </ul>
          ) : (
            <span className="muted small">첫 3분봉이 완성되면 계산해요.</span>
          )}
        </div>
        <div className="mn-plan-item">
          <span className="muted small">손절 기준가</span>
          {a.entry.stop != null ? <b className="mn-stop">{m(a.entry.stop)}</b> : <span className="muted small">매수 가능 판단일 때만 정해요.</span>}
        </div>
      </div>
      <p className="muted small mn-help">시장가로 한 번에 사지 말고 2~3회 나눠 사요. 처음 정한 손절가는 꼭 지켜요.</p>

      <div className="steps mn-steps">
        <div className="step">
          <h4>
            보유 기준선
            {a.hold.ma20on1m == null && a.hold.ma10on3m == null ? (
              <Flag tone="info">계산 전</Flag>
            ) : a.hold.below1m20 || a.hold.below3m10 ? (
              <Flag tone={a.hold.below1m20 && a.hold.below3m10 ? "bad" : "warn"}>이탈</Flag>
            ) : (
              <Flag tone="good">유지</Flag>
            )}
          </h4>
          <dl className="mn-kv">
            <dt>1분봉 20분선</dt>
            <dd>{a.hold.ma20on1m == null ? <span className="muted">봉 부족({P.ma1mHold}개 필요)</span> : <>{m(a.hold.ma20on1m)} <Below on={a.hold.below1m20} /></>}</dd>
            <dt>3분봉 10분선</dt>
            <dd>{a.hold.ma10on3m == null ? <span className="muted">봉 부족({P.ma3mHold}개 필요)</span> : <>{m(a.hold.ma10on3m)} <Below on={a.hold.below3m10} /></>}</dd>
          </dl>
          <NoteList notes={[a.hold.note]} />
        </div>

        <div className="step">
          <h4>
            3분봉 첫 눌림
            {a.pullback3m.signal ? (
              <Flag tone="good">매수 타점</Flag>
            ) : a.pullback3m.firstTouchAt ? (
              a.pullback3m.note.tone === "warn" ? <Flag tone="warn">닿은 뒤 이탈</Flag> : <Flag tone="info">지난 눌림</Flag>
            ) : (
              <Flag tone="info">아직 없음</Flag>
            )}
          </h4>
          <dl className="mn-kv">
            <dt>20분선 첫 닿음</dt>
            <dd>{a.pullback3m.firstTouchAt ? `${a.pullback3m.firstTouchAt.slice(11)} 3분봉` : <span className="muted">아직 없어요</span>}</dd>
          </dl>
          <NoteList notes={[a.pullback3m.note]} />
        </div>

        <div className="step">
          <h4>
            5·20분선 동시 이탈 손절
            {a.stop3m.signal ? <Flag tone="bad">손절 신호</Flag> : <Flag tone="info">이탈 없음</Flag>}
          </h4>
          <NoteList notes={[a.stop3m.note]} />
        </div>

        <div className="step">
          <h4>
            전일 고가 돌파·지지
            {a.breakout.supportConfirmed ? (
              <Flag tone={a.breakout.note.tone}>{a.breakout.note.tone === "good" ? "매수 조건" : "지지 확인"}</Flag>
            ) : a.breakout.prevHighBroken ? (
              a.breakout.note.tone === "warn" ? <Flag tone="warn">돌파 실패</Flag> : <Flag tone="info">지지 확인 대기</Flag>
            ) : (
              <Flag tone="info">돌파 전</Flag>
            )}
          </h4>
          <dl className="mn-kv">
            <dt>전일 고가 종가 돌파</dt>
            <dd>{a.breakout.prevHighBroken ? "있었어요" : "아직 없어요"}</dd>
            <dt>그 위 지지 확인</dt>
            <dd>{a.breakout.supportConfirmed ? "확인됐어요" : "아직 아니에요"}</dd>
          </dl>
          <NoteList notes={[a.breakout.note]} />
        </div>
      </div>
    </>
  );
}

function Below({ on }: { on: boolean }) {
  return on ? <span className="mn-below">이탈</span> : <span className="mn-above">위</span>;
}

/** 규칙 요약(자료집 4.7 장중·단기 매매 타점, 부록 A M3-18) */
function RulesCaption() {
  const P = INTRADAY_PARAMS;
  return (
    <div className="card mn-rules">
      <h4 className="mn-rules-title">
        강창권 장중 타점 요약 <span className="mn-rule">{RULE}</span>
      </h4>
      <ul className="small">
        <li>시초가 +{P.gapNoChasePct}% 이상 갭: 시초가 매수 금지. 약 {P.gapWaitMinutes}분 기다려 1분봉 20분선 지지를 확인한 뒤 나눠 사고, 당일 저점을 깨면 손절해요.</li>
        <li>전일 시간외 급등 종목: +{P.gapNoChasePct}% 이상 갭은 추격 금지, +{P.gapCautionPct}% 이상 갭도 원칙적으로 패스해요.</li>
        {P.cautionGapWaits && (
          <li className="muted">앱 해석: 시간외 급등 여부를 모를 때 +{P.gapCautionPct}~{P.gapNoChasePct}% 갭도 +{P.gapNoChasePct}% 갭처럼 기다려 지지를 확인해요.</li>
        )}
        <li>전일 상한가 종목이 갭 없이 출발하면 {P.limitUpDigestFrom}~{P.limitUpDigestTo}분 매물을 소화한 뒤 한 번 더 시세가 나오는 경향이 있어요.</li>
        <li>보유: 1분봉은 20분선, 3분봉은 10분선을 이탈하기 전까지 들고 가요.</li>
        <li>3분봉 눌림: 급등 뒤 첫 눌림에서 20분선에 처음 닿을 때 하루 1회만 사고, 종가가 5분선·20분선을 함께 이탈하면 즉시 손절해요.</li>
        <li>돌파: 전일 고가를 뚫고 그 위에서 지지가 확인돼야 하고, 일봉 5·20·60일선 정배열 우상향 종목만 해당해요.</li>
        <li>매수 실행: 3분봉 첫 캔들 몸통 중심선 또는 종가 기준 1/3선에서 2~3회 나눠 사요.</li>
      </ul>
      <p className="muted small">
        &lsquo;N분선&rsquo;은 그 분봉 차트의 N봉 평균으로 읽어요(1분봉 20분선 = 1분봉 20개 평균, 3분봉 10분선 = 3분봉 10개 평균). 판단에는 이미 끝난 봉만 써요.
        책의 경험칙을 옮긴 참고 판단이라 맞지 않을 수 있고, 수익을 보장하지 않아요. 모의매매로 먼저 확인해 보세요.
      </p>
    </div>
  );
}
