import { useEffect, useId, useMemo, useRef, useState } from "react";
import { followedRules, regionOfCode } from "@jusik/shared";
import { useApp } from "../../app/AppContext";
import { Link } from "../../app/router";
import { EmptyState, fmtDate, fmtInt, fmtPrice, Section } from "../../ui";
import { loadMemo, saveMemo } from "./stocksModel";

/*
 * 메모 탭: 이 종목의 매매일지(직접 기록·모의 자동 기록)와 이 기기에만 저장되는 종목 메모.
 * 일지 작성·복기는 기록 화면에서 한다(여기서는 읽기만).
 */

const ROWS = 20;

function StockMemo({ code }: { code: string }) {
  const id = useId();
  const [text, setText] = useState(() => loadMemo(code));
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setText(loadMemo(code));
    setState("idle");
  }, [code]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const change = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(saveMemo(code, v) ? "saved" : "failed"), 400);
  };
  return (
    <div className="ui-field">
      <label className="lbl" htmlFor={`${id}-memo`}>
        메모 내용
      </label>
      <textarea
        id={`${id}-memo`}
        className="ui-textarea"
        rows={5}
        value={text}
        placeholder="예: 30주선 돌파 뒤 첫 풀백을 기다려요. 실적 발표 11월 둘째 주."
        onChange={(e) => change(e.target.value)}
        aria-describedby={`${id}-hint`}
      />
      <span id={`${id}-hint`} className={state === "failed" ? "err" : "hint"} role={state === "failed" ? "alert" : undefined}>
        {state === "failed" ? "이 브라우저에서는 저장할 수 없어요(사생활 보호 창 등). 창을 닫으면 사라져요." : state === "saved" ? "이 기기에 저장했어요. 다른 기기와 공유되지 않아요." : "쓰면 이 기기에 자동으로 저장돼요."}
      </span>
    </div>
  );
}

export function MemoTab({ code }: { code: string }) {
  const { journal } = useApp();
  const region = regionOfCode(code);
  const entries = useMemo(() => journal.filter((e) => e.code === code).sort((a, b) => b.date.localeCompare(a.date)).slice(0, ROWS), [journal, code]);
  return (
    <div className="stk-tabbody">
      <Section as="h3" title="종목 메모">
        <StockMemo code={code} />
      </Section>
      <Section as="h3" title="매매일지" sub={entries.length ? `${entries.length}건` : undefined} actions={<Link to="/records" className="stk-link">기록에서 보기</Link>}>
        {entries.length === 0 ? (
          <EmptyState title="이 종목의 일지가 아직 없어요">
            <span className="t-2">주문 검토에서 확인하면 일지에 남고, 모의 자동매매 기록도 여기에 보여요.</span>
          </EmptyState>
        ) : (
          <ul className="stk-journal">
            {entries.map((e) => {
              const ok = followedRules(e);
              return (
                <li key={e.id}>
                  <div className="row between top">
                    <span className="row wrap">
                      <span className={`stk-side ${e.side === "BUY" ? "buy" : "sell"}`}>{e.side === "BUY" ? "매수" : "매도"}</span>
                      <span className="t-medium">{fmtDate(e.date)}</span>
                      <span className="t-cap">{e.source ?? "수동"}</span>
                    </span>
                    <span className="num">
                      {fmtPrice(e.price, region, { unit: true })} × {fmtInt(e.qty)}주
                    </span>
                  </div>
                  {e.reason && <p className="t-2">{e.reason}</p>}
                  {(e.stop != null || e.target != null) && (
                    <p className="t-cap num">
                      {e.stop != null && `손절 ${fmtPrice(e.stop, region)}`}
                      {e.stop != null && e.target != null && " · "}
                      {e.target != null && `목표 ${fmtPrice(e.target, region)}`}
                      {e.strategy && ` · ${e.strategy}`}
                    </p>
                  )}
                  {e.review && <p className="t-2">복기: {e.review}</p>}
                  {ok === false && <p className="warn-text t-cap">규칙 위반{e.violations?.length ? `: ${e.violations.join(", ")}` : ""}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
