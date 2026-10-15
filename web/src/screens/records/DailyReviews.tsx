import { ChevronDown, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { INDEX_TREND_DAYS, REVIEW_RULE, type DailyReview, type MarketRowLike, type Region } from "@jusik/shared";
import { buildReview, getReviews, saveReviewComment } from "../../api";
import { useApp } from "../../app/AppContext";
import { Button, Change, EmptyState, fmtBig, fmtDate, fmtInt, fmtNum, fmtWhen, Notice, RuleTag, Section, Segmented, SkeletonRows, useBreakpoint, useToast } from "../../ui";
import { Pnl, sentence } from "./parts";

/*
 * 일일 복기(M5-01 김연수 6항목: 지수·섹터·신고가·특징주·실적·코멘트).
 * 장 마감 뒤 서버가 자동으로 만들고(서버가 켜져 있을 때), '복기 만들기'로 지금 만들 수도 있다.
 * 섹터·실적·뉴스처럼 앱이 모으지 못한 항목은 '직접 확인할 항목'으로 보여 주고, 메모 칸에 내 말로 정리한다.
 * 핸드폰은 요약 문장과 메모만 펼쳐 두고 자료는 '자료 펼치기'로 연다(부록 A: 핸드폰 ○).
 */

type Filter = "ALL" | Region;
const REGION_LABEL: Record<Region, string> = { KR: "국내", US: "미국" };
const PAGE = 6;

export function DailyReviews() {
  const [reviews, setReviews] = useState<DailyReview[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busy, setBusy] = useState<Region | null>(null);
  const [built, setBuilt] = useState<{ review: DailyReview; errors: string[] } | null>(null);
  const [buildErr, setBuildErr] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [reloading, setReloading] = useState(false);

  const reload = useCallback(async () => {
    try {
      setReviews(await getReviews());
      setLoadErr("");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const make = async (region: Region) => {
    setBusy(region);
    setBuildErr("");
    setBuilt(null);
    try {
      setBuilt(await buildReview(region));
      await reload();
    } catch (e) {
      setBuildErr(`${REGION_LABEL[region]} 복기를 만들지 못했어요. ${sentence(e instanceof Error ? e.message : String(e))}`);
    } finally {
      setBusy(null);
    }
  };

  // 최신 날짜 먼저(같은 날은 서버 순서)
  const shown = useMemo(() => (reviews ?? []).filter((r) => filter === "ALL" || r.region === filter).sort((a, b) => b.date.localeCompare(a.date)), [reviews, filter]);

  return (
    <Section
      title="일일 복기"
      sub={`지수·섹터·신고가·특징주·실적·코멘트 6항목(${REVIEW_RULE})`}
      actions={
        <>
          {(["KR", "US"] as Region[]).map((rg) => (
            <Button key={rg} variant="secondary" size="sm" className="rec-touch-btn" busy={busy === rg} disabled={busy != null && busy !== rg} onClick={() => make(rg)}>
              {REGION_LABEL[rg]} 복기 만들기
            </Button>
          ))}
        </>
      }
    >
      <p className="t-2 rec-lead">장 마감 뒤 30분 안에 서버가 자동으로 만들어요(서버가 켜져 있을 때). 섹터·실적·뉴스처럼 빠진 항목은 직접 확인해 메모에 채워요.</p>
      <Segmented
        size="sm"
        label="지역"
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setLimit(PAGE);
        }}
        options={[
          { value: "ALL", label: "전체" },
          { value: "KR", label: "국내" },
          { value: "US", label: "미국" },
        ]}
      />
      {buildErr && <Notice tone="warn">{buildErr} 잠시 뒤 다시 눌러 보세요.</Notice>}
      {built && (
        <Notice tone="info" title={`${REGION_LABEL[built.review.region]} ${fmtDate(built.review.date)} 복기를 만들었어요`}>
          {built.errors.length > 0 ? (
            <>
              일부 자료를 받지 못했어요.
              <ul className="rec-issues">
                {built.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </>
          ) : undefined}
        </Notice>
      )}

      {loadErr ? (
        <Notice
          tone="warn"
          title="복기를 불러오지 못했어요"
          action={
            <Button
              variant="secondary"
              size="sm"
              busy={reloading}
              icon={<RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />}
              onClick={async () => {
                setReloading(true);
                await reload();
                setReloading(false);
              }}
            >
              다시 불러오기
            </Button>
          }
        >
          {sentence(loadErr)} 서버가 켜져 있는지 확인한 뒤 다시 불러오세요.
        </Notice>
      ) : reviews == null ? (
        <SkeletonRows rows={5} h={22} />
      ) : reviews.length === 0 ? (
        <EmptyState title="아직 일일 복기가 없어요" action={<Button variant="primary" busy={busy === "KR"} disabled={busy != null} onClick={() => make("KR")}>국내 복기 만들기</Button>}>
          장이 끝난 뒤 서버가 자동으로 만들어요. 지금 바로 만들 수도 있어요.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title={`${filter !== "ALL" ? REGION_LABEL[filter] : ""} 복기가 아직 없어요`} action={<Button onClick={() => setFilter("ALL")}>전체 보기</Button>} />
      ) : (
        <div className="rec-daily-list">
          {shown.slice(0, limit).map((r) => (
            <ReviewItem key={`${r.region}-${r.date}`} r={r} />
          ))}
          {shown.length > limit && (
            <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
              이전 복기 더 보기({fmtInt(shown.length - limit)}개 남음)
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

function StockName({ code, name }: { code: string; name: string }) {
  const { openStock } = useApp();
  return (
    <button type="button" className="rec-namebtn" title={`${code} 종목 화면 열기`} onClick={() => openStock(code)}>
      {name}
    </button>
  );
}

function Movers({ title, rows, region }: { title: string; rows: MarketRowLike[]; region: Region }) {
  return (
    <div className="rec-dsec">
      <h4 className="rec-h5">{title}</h4>
      {rows.length === 0 ? (
        <p className="t-cap">해당 종목이 없어요.</p>
      ) : (
        <ul className="rec-mini">
          {rows.map((r) => (
            <li key={r.code}>
              <StockName code={r.code} name={r.name} />
              <span className="rec-mini-v">
                <Change pct={r.changePct} showAbs={false} />
                <span className="t-cap num">{fmtBig(r.tradeValue, region)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewItem({ r }: { r: DailyReview }) {
  const bp = useBreakpoint();
  const [open, setOpen] = useState(bp !== "compact");
  const p = r.paper;
  const cur = r.region === "US" ? "USD" : "KRW";
  const dataId = `rec-daily-${r.region}-${r.date}`;
  return (
    <article className="rec-daily" aria-labelledby={`${dataId}-h`}>
      <div className="rec-daily-head">
        <h3 id={`${dataId}-h`} className="t-section">
          <span className="num">{fmtDate(r.date)}</span> {REGION_LABEL[r.region]}
        </h3>
        <span className="row wrap" style={{ gap: 8 }}>
          {r.builtAt && <span className="t-cap">{fmtWhen(r.builtAt)} 작성</span>}
          <RuleTag rule={r.rule} />
        </span>
      </div>
      {r.comment && <p className="rec-prose">{r.comment}</p>}

      <button type="button" className="ui-btn link rec-touchlink rec-expand" aria-expanded={open} aria-controls={dataId} onClick={() => setOpen((x) => !x)}>
        {open ? "자료 접기" : "자료 펼치기"}
        <ChevronDown size={14} strokeWidth={1.5} className={open ? "rec-rot" : ""} aria-hidden="true" />
      </button>

      {open && (
        <div id={dataId} className="stack-4">
          <div className="rec-dsec rec-dsec-index">
              <h4 className="rec-h5">지수 흐름</h4>
              {r.indexMoves.length === 0 ? (
                <p className="t-cap">지수 자료가 없어요.</p>
              ) : (
                <div className="ui-table-wrap">
                  <table className="ui-table rec-mini-table">
                    <thead>
                      <tr>
                        <th scope="col">지수</th>
                        <th scope="col" className="r">
                          종가
                        </th>
                        <th scope="col" className="r">
                          등락
                        </th>
                        <th scope="col" className="r" title={`${INDEX_TREND_DAYS}거래일 전 종가 대비`}>
                          {INDEX_TREND_DAYS}일 전 대비
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.indexMoves.map((m) => (
                        <tr key={m.name}>
                          <th scope="row" className="rec-cellname">
                            {m.name}
                            {m.asOf !== r.date && <span className="t-cap"> {fmtDate(m.asOf)} 기준</span>}
                          </th>
                          <td className="r num">{fmtNum(m.close, 2)}</td>
                          <td className="r">
                            <Change pct={m.changePct} showAbs={false} />
                          </td>
                          <td className="r">{m.vs20dPct == null ? <span className="t-cap">-</span> : <Change pct={m.vs20dPct} showAbs={false} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>

          <div className="rec-dcols">
            {r.sectorMoves && (
              <div className="rec-dsec">
                <h4 className="rec-h5">섹터 흐름</h4>
                <span className="t-cap">강세</span>
                <ul className="rec-mini">
                  {r.sectorMoves.top.map((x) => (
                    <li key={x.no}>
                      <span>{x.name}</span>
                      <Change pct={x.changePct} showAbs={false} />
                    </li>
                  ))}
                </ul>
                <span className="t-cap">약세</span>
                <ul className="rec-mini">
                  {r.sectorMoves.bottom.map((x) => (
                    <li key={x.no}>
                      <span>{x.name}</span>
                      <Change pct={x.changePct} showAbs={false} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rec-dsec">
              <h4 className="rec-h5">
                신고가 <span className="t-cap num">{fmtInt(r.newHighs.length)}개</span>
              </h4>
              {r.newHighs.length === 0 ? (
                <p className="t-cap">신고가·고점 돌파 종목이 없어요.</p>
              ) : (
                <ul className="rec-mini">
                  {r.newHighs.map((h) => (
                    <li key={h.code}>
                      <StockName code={h.code} name={h.name} />
                      <span className="t-cap">{h.basis}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rec-dsec">
              <h4 className="rec-h5">단타 후보 상위</h4>
              {r.candidatesTop.length === 0 ? (
                <p className="t-cap">이날 단타 후보가 없었어요.</p>
              ) : (
                <ul className="rec-mini">
                  {r.candidatesTop.map((c) => (
                    <li key={c.code}>
                      <StockName code={c.code} name={c.name} />
                      <span className="num">{fmtInt(c.score)}점</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rec-dsec">
              <h4 className="rec-h5">모의매매 요약</h4>
              {p.buys + p.sells === 0 ? (
                <p className="t-cap">이날 모의매매 기록이 없어요.</p>
              ) : (
                <ul className="rec-mini">
                  <li>
                    <span>매수 / 매도</span>
                    <span className="num">
                      {fmtInt(p.buys)}건 / {fmtInt(p.sells)}건
                    </span>
                  </li>
                  <li>
                    <span>순손익</span>
                    <Pnl value={p.realizedPnl} currency={cur} />
                  </li>
                  <li>
                    <span>승 / 패</span>
                    <span className="num">
                      {fmtInt(p.wins)}승 {fmtInt(p.losses)}패
                    </span>
                  </li>
                </ul>
              )}
              <span className="t-cap">수수료·세금·슬리피지 반영</span>
            </div>
          </div>

          <div className="rec-dgrid">
            <Movers title="특징주 · 상승 상위" rows={r.topGainers} region={r.region} />
            <Movers title="특징주 · 하락 상위" rows={r.topLosers} region={r.region} />
            <Movers title="특징주 · 거래대금 상위" rows={r.mostTraded} region={r.region} />
          </div>

          {r.missing.length > 0 && (
            <div className="row wrap rec-missing">
              <span className="t-2">직접 확인할 항목</span>
              {r.missing.map((m) => (
                <span key={m} className="rec-tag is-plain">
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <Memo r={r} />
    </article>
  );
}

/** 내 메모(복기 코멘트). Ctrl·Cmd+Enter는 앱 전체에서 주문 검토 단축키라 여기서는 쓰지 않는다 */
function Memo({ r }: { r: DailyReview }) {
  const toast = useToast();
  const [saved, setSaved] = useState(r.userComment ?? "");
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const id = `rec-memo-${r.region}-${r.date}`;

  // 서버 값이 바뀌었을 때(다시 불러오기) 고치는 중이 아니면 따라간다
  useEffect(() => {
    const v = r.userComment ?? "";
    setText((t) => (t === saved ? v : t));
    setSaved(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.userComment]);

  const dirty = text !== saved;
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await saveReviewComment(r.region, r.date, text);
      const v = res.review.userComment ?? "";
      setSaved(v);
      setText(v);
      toast("복기 메모를 저장했어요", "ok");
    } catch (e) {
      setErr(`메모를 저장하지 못했어요. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rec-memo stack">
      <label className="rec-lbl" htmlFor={id}>
        내 메모
      </label>
      <textarea
        id={id}
        className="ui-textarea"
        rows={3}
        value={text}
        maxLength={2000}
        onChange={(e) => {
          setText(e.target.value);
          setErr("");
        }}
        placeholder="오늘 시장을 내 말로 정리해요. 예: 반도체 강세는 수출 실적 기대 때문. 내일은 2차전지 반등 여부를 볼 것."
      />
      {err && <Notice tone="warn">{err}</Notice>}
      <div className="row wrap">
        <Button variant="secondary" size="sm" className="rec-touch-btn" disabled={!dirty} busy={busy} onClick={save}>
          메모 저장
        </Button>
        {dirty && !busy && <span className="t-cap">저장하지 않은 변경이 있어요.</span>}
      </div>
    </div>
  );
}
