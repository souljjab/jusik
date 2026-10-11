import { useState } from "react";
import { BREADTH_PARAMS, type BreadthAnalysis, type BreadthResponse, type Market } from "@jusik/shared";
import { Button, fmtDate, fmtInt, fmtNum, NoteList, Notice, RuleTag, Section, SkeletonRows } from "../../ui";
import { BREADTH_LOG_MIN_DAYS, signed, type BreadthState } from "./homeModel";
import { BreadthChart } from "./LazyCharts";
import { useBreadth, useIndexCandles } from "./useHomeData";

export const HILO_STATE_LABEL: Record<"GOOD" | "BAD" | "NEUTRAL", string> = { GOOD: "신고가 우세", BAD: "신저가 우세", NEUTRAL: "뚜렷하지 않음" };
const DIVERGENCE: Record<"BEARISH" | "BULLISH", string> = { BEARISH: "약세 괴리", BULLISH: "강세 괴리(참고)" };

/** 스캔에 남은 시장 폭 요약 한 덩어리(국면 점수에 실제로 쓴 값) */
export function BreadthBrief({ b }: { b: BreadthState }) {
  if (b === "old") return <p className="t-2">시장 폭은 다음 스캔부터 보여요.</p>;
  if (b === "none") return <p className="t-2">시장 폭 자료가 없어 국면 점수에서 빠졌어요.</p>;
  if (b === "pending") return <p className="t-2">시장 폭을 계산하는 중이었거나 표본 일봉을 받지 못해 이번 국면 점수에는 넣지 않았어요.</p>;
  return (
    <dl className="home-facts">
      <div>
        <dt>보조 점수</dt>
        <dd className="num">{signed(b.score)}점</dd>
      </div>
      <div>
        <dt>A/D선 괴리</dt>
        <dd className={b.divergence === "BEARISH" ? "warn-text" : ""}>{b.divergence ? DIVERGENCE[b.divergence] : "없음"}</dd>
      </div>
      <div>
        <dt>MI(200일)</dt>
        <dd className="num">
          {b.mi == null ? "집계일 부족" : `${b.mi > 0 ? "+" : ""}${fmtInt(b.mi)}`}
          {b.miSignal && <span className={b.miSignal.dir === "DOWN" ? "warn-text" : ""}> · 0선 {b.miSignal.dir === "UP" ? "상향" : "하향"} 교차 {fmtDate(b.miSignal.date)}</span>}
        </dd>
      </div>
      <div>
        <dt>52주 신고가−신저가</dt>
        <dd className="num">
          {fmtInt(b.hiLo.newHigh)} − {fmtInt(b.hiLo.newLow)}
          {b.hiLoState && <span className={b.hiLoState === "BAD" ? "warn-text" : "t-2"}> {HILO_STATE_LABEL[b.hiLoState]}</span>}
        </dd>
      </div>
    </dl>
  );
}

/** 52주 신고가·신저가 종목 수(분석에 일별 기록이 없어 최근 값만) */
function HiLo({ a }: { a: BreadthAnalysis }) {
  const h = a.hiLo;
  return (
    <div className="stack">
      <h4 className="home-sub">
        52주 신고가·신저가 <RuleTag rule="2.2 와인스타인" />
      </h4>
      <dl className="home-facts">
        <div>
          <dt>신고가 · {fmtDate(a.asOf)}</dt>
          <dd className="num">{fmtInt(h.newHigh)}종목</dd>
        </div>
        <div>
          <dt>신저가 · {fmtDate(a.asOf)}</dt>
          <dd className="num">{fmtInt(h.newLow)}종목</dd>
        </div>
        <div>
          <dt>최근 {BREADTH_PARAMS.hiLoAvgDays}일 평균 신고가</dt>
          <dd className="num">{fmtNum(h.avg10High, 1)}</dd>
        </div>
        <div>
          <dt>최근 {BREADTH_PARAMS.hiLoAvgDays}일 평균 신저가</dt>
          <dd className="num">{fmtNum(h.avg10Low, 1)}</dd>
        </div>
      </dl>
      <p className="t-cap">
        판정: {a.hiLoState ? HILO_STATE_LABEL[a.hiLoState] : "판정할 종목이 없어요"}. 한쪽 평균이 다른 쪽의 {BREADTH_PARAMS.hiLoRatio}배 이상이고 판정 가능 종목의{" "}
        {BREADTH_PARAMS.hiLoMinPct}% 이상일 때만 우세로 봐요(앱 기본값).
      </p>
    </div>
  );
}

/** 거래소 전체 오늘 등락 종목 수(국내, 네이버) — 참고값 */
function TodayCounts({ res }: { res: BreadthResponse }) {
  if (res.market === "US") return <p className="t-cap">미국은 거래소 전체 등락 종목 수를 읽지 않아요. 위의 표본 근사치만 봐요.</p>;
  const t = res.today;
  const n = res.log.length;
  return (
    <div className="stack">
      <h4 className="home-sub">거래소 전체 등락 종목 수</h4>
      {!t ? (
        <p className="t-2">오늘 등락 종목 수를 읽지 못했어요. 장 시작 전이거나 페이지 형식이 바뀌었을 수 있어요.</p>
      ) : (
        <dl className="home-counts">
          {(
            [
              ["상한", t.upperLimit],
              ["상승", t.up],
              ["보합", t.unchanged],
              ["하락", t.down],
              ["하한", t.lowerLimit],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="num">{fmtInt(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="t-cap">
        {t && "참고값이라 점수에는 쓰지 않아요. "}
        거래소 전체 기록 {n}일{n >= BREADTH_LOG_MIN_DAYS ? " — 차트의 '거래소 A/D'에서 실제 A/D선을 볼 수 있어요." : ` — ${BREADTH_LOG_MIN_DAYS}일부터 실제 A/D선을 그려요(앱이 켜진 날만 쌓여요).`}
      </p>
    </div>
  );
}

/** 서버에서 받은 시장 폭 전체: 근거 문장, 차트, 신고가·신저가, 거래소 전체 등락 종목 수 */
function BreadthFull({ market }: { market: Market }) {
  const { res, busy, retry } = useBreadth(market);
  const ready = !!res && !res.pending && !!res.analysis;
  const index = useIndexCandles(ready ? market : null);
  const a = res?.analysis ?? null;
  return (
    <>
      {res === undefined ? (
        <SkeletonRows rows={3} />
      ) : res === null ? (
        <Notice tone="warn" title="시장 폭을 불러오지 못했어요" action={<Button size="sm" busy={busy} onClick={retry}>다시 불러오기</Button>}>
          서버 연결을 확인한 뒤 다시 불러오세요.
        </Notice>
      ) : res.pending ? (
        <Notice tone="info" title="시장 폭을 계산하는 중이에요" action={<Button size="sm" busy={busy} onClick={retry}>다시 보기</Button>}>
          처음 계산은 표본 종목 일봉을 모두 받아 1분 넘게 걸릴 수 있어요. 15초마다 다시 확인해요.
        </Notice>
      ) : !a ? (
        <Notice tone="warn" title="시장 폭을 계산할 표본 일봉을 받지 못했어요" action={<Button size="sm" busy={busy} onClick={retry}>다시 불러오기</Button>}>
          잠시 뒤 다시 불러오세요. 그동안 국면 점수에서는 시장 폭이 빠져요.
        </Notice>
      ) : (
        <>
          <p className="t-cap">
            기준 {a.basis} · 집계 {fmtInt(a.sampleSize)}종목 · {fmtDate(a.asOf)} · 집계일 {fmtInt(a.adLine.length)}일
            {res.sample && " · 샘플 자료"}
          </p>
          <NoteList notes={a.signals} />
          <BreadthChart analysis={a} log={res.log} index={index} />
          <HiLo a={a} />
        </>
      )}
      {res && <TodayCounts res={res} />}
      {res && res.errors.length > 0 && (
        <details className="home-details">
          <summary className="warn-text">받지 못한 자료 {res.errors.length}건</summary>
          <ul className="home-plain-list t-2">
            {res.errors.slice(0, 8).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * 시장 폭(2.2 시장 내부 지표: M1-04 A/D선, M1-05 MI, 고점-저점 수치). 국면 점수의 보조 신호(−1~+1점).
 * 핸드폰은 스캔 요약만 보여 주고(근거 문장은 위 '판정 근거'에 이미 있다), 차트와 세부 수치는 눌러서 펼친다.
 */
export function BreadthSection({ market, brief, compact }: { market: Market; brief: BreadthState; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const full = !compact || open;
  return (
    <Section title="시장 폭" sub="A/D선·시장 탄력지수·신고가−신저가">
      <BreadthBrief b={brief} />
      {full ? (
        <BreadthFull market={market} />
      ) : (
        <Button variant="secondary" block className="home-touch" onClick={() => setOpen(true)}>
          시장 폭 차트와 세부 수치 펼치기
        </Button>
      )}
      <p className="t-cap">
        거래소 전체가 아니라 대형주 표본 종목의 일봉으로 근사한 값이에요. 판정 기간·비율 중 책에 수치가 없는 것은 앱 기본값이라 조정 대상이에요.
      </p>
    </Section>
  );
}
