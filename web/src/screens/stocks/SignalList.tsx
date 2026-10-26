import { useMemo, useState } from "react";
import { Button, EvidenceStrip } from "../../ui";
import { markWhen, SIGNAL_KIND_LABEL, type SignalMark } from "./stocksModel";
import type { Signals, SignalView } from "./useSignals";

/*
 * 차트 아래 신호 목록(UI 지도서 5.2 D). 차트 표식과 같은 신호를 최근 것부터 보여 주고, 누르면 신호 근거가 그 신호로 바뀐다.
 *  - 넓은 화면: 구분선으로 나눈 행(시점 · 신호 이름과 매매법 · 근거 스트립)
 *  - 좁은 화면: 가로로 넘기는 한 줄(탭과 근거가 차트 바로 아래에 오도록)
 * 일봉 보조 신호는 의견을 바꾸지 않는 참고 신호라 스트립 대신 '일봉 보조'라고만 쓴다.
 */

const SHOWN = { wide: 6, narrow: 8 } as const;

const STRATEGY_KIND: Record<SignalView["strategy"], string> = {
  daytrade: "단타 후보",
  weinstein: SIGNAL_KIND_LABEL.weinstein,
  "candle-master": SIGNAL_KIND_LABEL.candle,
};

interface Item {
  id: string;
  title: string;
  when: string;
  kind: string;
  /** 지금 신호(스캔·마감된 마지막 주) */
  now: boolean;
  side: "buy" | "sell";
  view: SignalView | null;
}

export function SignalList({ signals, marks, today, wide, onSelect }: {
  signals: Signals;
  /** 이 기간 차트에 보이는 지난 신호(최근순) */
  marks: SignalMark[];
  today: string;
  wide: boolean;
  onSelect: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const limit = wide ? SHOWN.wide : SHOWN.narrow;
  const current = useMemo(() => signals.current.filter((v) => !v.quiet), [signals.current]);
  const shownMarks = useMemo(() => (all || !wide ? marks : marks.slice(0, limit)), [all, wide, marks, limit]);
  const { viewOf } = signals;

  // 행마다 근거 스트립(과거 신호는 그 주 기준으로 다시 계산한다 — 보이는 행만)
  const items = useMemo<Item[]>(
    () => [
      ...current.map((v) => ({ id: v.id, title: v.title, when: v.when, kind: `지금 · ${STRATEGY_KIND[v.strategy]}`, now: true, side: "buy" as const, view: v })),
      ...shownMarks.map((m) => ({
        id: m.id, title: m.label, when: markWhen(m, today), kind: SIGNAL_KIND_LABEL[m.kind], now: false, side: m.side,
        view: m.kind === "daily" || !wide ? null : viewOf(m.id),
      })),
    ],
    [current, shownMarks, today, viewOf, wide],
  );

  if (!wide)
    return (
      <section className="stk-sigarea" aria-labelledby="stk-sig-h">
        <div className="stk-sigarea-head">
          <h2 id="stk-sig-h" className="t-body t-bold">
            신호 {marks.length + current.length > 0 && <span className="t-cap">{current.length + marks.length}개</span>}
          </h2>
          <span className="t-cap">누르면 아래 근거가 바뀌어요</span>
        </div>
        <ul className="stk-sigchips" aria-label="신호 목록">
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" className="stk-sigchip" aria-pressed={signals.selectedId === it.id} onClick={() => onSelect(it.id)}>
                <span className="t-medium ellipsis">{it.title}</span>
                <span className="t-cap ellipsis">
                  {it.now ? "지금 · " : ""}
                  {it.when}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <section className="stk-sigarea" aria-labelledby="stk-sig-h">
      <div className="stk-sigarea-head">
        <h2 id="stk-sig-h" className="t-body t-bold">
          신호
        </h2>
        <span className="t-cap">차트 표식이나 목록을 누르면 신호 근거가 그 신호로 바뀌어요</span>
      </div>
      <ul className="stk-siglist">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className="stk-sigrow" aria-pressed={signals.selectedId === it.id} onClick={() => onSelect(it.id)}>
              <span className="stk-sigrow-main">
                <span className="t-medium ellipsis">
                  {it.side === "sell" && <span className="sr-only">매도 쪽 신호, </span>}
                  {it.title}
                </span>
                <span className="t-cap ellipsis">
                  <span className="num">{it.when}</span> · {it.kind}
                </span>
              </span>
              <span className="stk-sigrow-ev">
                {it.view?.evidence ? <EvidenceStrip evidence={it.view.evidence} /> : <span className="t-cap">{it.view ? "근거 없음" : "일봉 보조"}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {marks.length > limit && (
        <Button variant="link" className="stk-more" onClick={() => setAll((v) => !v)}>
          {all ? "최근 신호만 보기" : `지난 신호 ${marks.length - limit}개 더 보기`}
        </Button>
      )}
      {!marks.length && <p className="t-2">이 기간 차트에 표시할 지난 신호가 없어요.</p>}
    </section>
  );
}
