import { useCallback, useEffect, useMemo, useState } from "react";
import { INDEX_TREND_DAYS, REVIEW_RULE, type DailyReview, type MarketRowLike, type Region } from "@jusik/shared";
import { buildReview, getReviews, saveReviewComment } from "./api";
import { money, num, pct, tone } from "./format";
import "./styles/journal.css";

type Filter = "ALL" | Region;
const FILTERS: [Filter, string][] = [["ALL", "전체"], ["KR", "국내"], ["US", "미국"]];
const REGION_LABEL: Record<Region, string> = { KR: "국내", US: "미국" };
const PAGE = 6;

/** 거래대금(현지 통화 원 단위) → 국내 억 원, 미국 백만 달러 */
const tradeValue = (x: number, region: Region) => (region === "KR" ? `${num(x / 1e8, 0)}억 원` : `${num(x / 1e6, 1)}백만 달러`);

type Open = ((code: string) => void) | undefined;

function StockName({ code, name, onOpen }: { code: string; name: string; onOpen: Open }) {
  if (!onOpen) return <span className="jr-name" title={code}>{name}</span>;
  return <button className="link jr-name jr-name-btn" title={`${code} 종목 분석 열기`} onClick={() => onOpen(code)}>{name}</button>;
}

function Movers({ title, rows, region, onOpen }: { title: string; rows: MarketRowLike[]; region: Region; onOpen: Open }) {
  return (
    <div className="jr-rv-sec">
      <h5>{title}</h5>
      {rows.length === 0 ? (
        <p className="muted small">해당 종목이 없어요.</p>
      ) : (
        <ul className="jr-rows">
          {rows.map((r) => (
            <li key={r.code}>
              <StockName code={r.code} name={r.name} onOpen={onOpen} />
              <span className="jr-val">
                <span className={tone(r.changePct)}>{pct(r.changePct)}</span>
                <span className="muted small"> · {tradeValue(r.tradeValue, region)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Memo({ r }: { r: DailyReview }) {
  const [saved, setSaved] = useState(r.userComment ?? "");
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // 서버 값이 바뀌었을 때(다시 불러오기) 고치는 중이 아니면 따라간다
  useEffect(() => {
    const v = r.userComment ?? "";
    setText((t) => (t === saved ? v : t));
    setSaved(v);
  }, [r.userComment]);

  const dirty = text !== saved;
  const save = async () => {
    setBusy(true);
    try {
      const res = await saveReviewComment(r.region, r.date, text);
      const v = res.review.userComment ?? "";
      setSaved(v);
      setText(v);
      setMsg("저장했어요");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="jr-memo">
      <label className="jr-field">
        메모 — 오늘 시장을 내 말로 정리하고, 빠진 항목(섹터·실적·뉴스)을 채워요
        <textarea
          className="jr-textarea"
          value={text}
          maxLength={2000}
          onChange={(e) => {
            setText(e.target.value);
            setMsg("");
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && dirty && !busy) void save();
          }}
          placeholder="예: 반도체 강세는 수출 실적 기대 때문. 내일은 2차전지 반등 여부를 볼 것."
        />
      </label>
      <div className="jr-actions">
        <button className="primary small-btn" onClick={save} disabled={!dirty || busy}>{busy ? "저장 중…" : "메모 저장"}</button>
        {dirty && !busy && <span className="muted small">저장하지 않은 변경이 있어요 (Ctrl+Enter로도 저장돼요)</span>}
        {!dirty && msg && <span className="muted small">{msg}</span>}
        {dirty && msg && <span className="note-bad small">{msg}</span>}
      </div>
    </div>
  );
}

export function ReviewCard({ r, onOpen }: { r: DailyReview; onOpen: Open }) {
  const p = r.paper;
  return (
    <article className="card">
      <h4 className="jr-rv-head">
        {r.date} · {REGION_LABEL[r.region]}
        <span className="muted small">근거 {r.rule}</span>
      </h4>
      <p className="jr-rv-comment">{r.comment}</p>

      <div className="jr-rv-grid">
        <div className="jr-rv-sec">
          <h5>지수 흐름</h5>
          {r.indexMoves.length === 0 ? (
            <p className="muted small">지수 데이터가 없어요.</p>
          ) : (
            <table className="trades jr-mini">
              <thead><tr><th className="left">지수</th><th>종가</th><th>등락</th><th title={`${INDEX_TREND_DAYS}거래일 전 종가 대비`}>{INDEX_TREND_DAYS}일 전 대비</th></tr></thead>
              <tbody>
                {r.indexMoves.map((m) => (
                  <tr key={m.name}>
                    <td className="left">{m.name}{m.asOf !== r.date && <div className="muted small">{m.asOf} 기준</div>}</td>
                    <td>{num(m.close, 2)}</td>
                    <td className={tone(m.changePct)}>{pct(m.changePct)}</td>
                    <td className={m.vs20dPct == null ? "muted" : tone(m.vs20dPct)}>{m.vs20dPct == null ? "-" : pct(m.vs20dPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {r.sectorMoves && (
          <div className="jr-rv-sec">
            <h5>섹터 흐름 <span className="muted small">업종 등락률</span></h5>
            <p className="muted small">강세</p>
            <div className="jr-chips">
              {r.sectorMoves.top.map((x) => <span key={x.no} className="jr-chip">{x.name} <b className={tone(x.changePct)}>{pct(x.changePct)}</b></span>)}
            </div>
            <p className="muted small">약세</p>
            <div className="jr-chips">
              {r.sectorMoves.bottom.map((x) => <span key={x.no} className="jr-chip">{x.name} <b className={tone(x.changePct)}>{pct(x.changePct)}</b></span>)}
            </div>
          </div>
        )}

        <div className="jr-rv-sec">
          <h5>신고가 <span className="muted small">{r.newHighs.length}개</span></h5>
          {r.newHighs.length === 0 ? (
            <p className="muted small">신고가·고점 돌파 종목이 없어요.</p>
          ) : (
            <ul className="jr-rows">
              {r.newHighs.map((h) => (
                <li key={h.code}>
                  <StockName code={h.code} name={h.name} onOpen={onOpen} />
                  <span className="jr-val muted small">{h.basis}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="jr-rv-sec">
          <h5>단타 후보 상위</h5>
          {r.candidatesTop.length === 0 ? (
            <p className="muted small">이날 단타 후보가 없었어요.</p>
          ) : (
            <ul className="jr-rows">
              {r.candidatesTop.map((c) => (
                <li key={c.code}>
                  <StockName code={c.code} name={c.name} onOpen={onOpen} />
                  <span className="jr-val">{c.score}점</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="jr-rv-sec">
          <h5>모의매매 요약 <span className="muted small">수수료·세금·슬리피지 반영</span></h5>
          {p.buys + p.sells === 0 ? (
            <p className="muted small">이날 모의매매 기록이 없어요.</p>
          ) : (
            <ul className="jr-rows">
              <li><span>매수 / 매도</span><span className="jr-val">{p.buys}건 / {p.sells}건</span></li>
              <li><span>순손익</span><b className={`jr-val ${tone(p.realizedPnl)}`}>{money(p.realizedPnl, r.region)}</b></li>
              <li><span>승 / 패</span><span className="jr-val">{p.wins}승 {p.losses}패</span></li>
            </ul>
          )}
        </div>
      </div>

      <div className="jr-rv-grid">
        <Movers title="특징주 · 상승 상위" rows={r.topGainers} region={r.region} onOpen={onOpen} />
        <Movers title="특징주 · 하락 상위" rows={r.topLosers} region={r.region} onOpen={onOpen} />
        <Movers title="특징주 · 거래대금 상위" rows={r.mostTraded} region={r.region} onOpen={onOpen} />
      </div>

      {r.missing.length > 0 && (
        <div className="jr-missing">
          <span className="small">직접 확인할 항목</span>
          {r.missing.map((m) => <span key={m} className="pill warn-pill">{m}</span>)}
        </div>
      )}

      <Memo r={r} />
    </article>
  );
}

export function ReviewView({ onOpen }: { onOpen?: (code: string) => void }) {
  const [reviews, setReviews] = useState<DailyReview[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busy, setBusy] = useState<Region | null>(null);
  const [built, setBuilt] = useState<{ review: DailyReview; errors: string[] } | null>(null);
  const [buildErr, setBuildErr] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const reload = useCallback(() => {
    getReviews()
      .then((rs) => {
        setReviews(rs);
        setLoadErr("");
      })
      .catch((e: Error) => setLoadErr(e.message));
  }, []);
  useEffect(reload, [reload]);

  const make = async (region: Region) => {
    setBusy(region);
    setBuildErr("");
    setBuilt(null);
    try {
      setBuilt(await buildReview(region));
      reload();
    } catch (e) {
      setBuildErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // 최신 날짜 먼저(같은 날은 서버 순서 유지)
  const shown = useMemo(
    () => (reviews ?? []).filter((r) => filter === "ALL" || r.region === filter).sort((a, b) => b.date.localeCompare(a.date)),
    [reviews, filter],
  );

  return (
    <div>
      <div className="card">
        <h3 className="h3">일일 복기 <span className="muted small">— 지수·섹터·신고가·특징주·실적·코멘트 6항목 ({REVIEW_RULE})</span></h3>
        <p className="muted small">장 마감 후 30분 안에 서버가 자동으로 작성해요(서버가 켜져 있을 때). 섹터·실적·뉴스 등 빠진 항목은 직접 확인해 채워 주세요.</p>
        <div className="jr-bar">
          <div className="seg" role="group" aria-label="지역">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          <div className="jr-bar-btns">
            {(["KR", "US"] as Region[]).map((rg) => (
              <button key={rg} className="primary small-btn" disabled={busy != null} onClick={() => make(rg)}>
                {busy === rg ? `만드는 중… — ${REGION_LABEL[rg]}` : `지금 복기 만들기 — ${REGION_LABEL[rg]}`}
              </button>
            ))}
          </div>
        </div>
        {buildErr && <p className="warn jr-msg">{buildErr}</p>}
        {built && (
          <div className="jr-msg small" role="status">
            {REGION_LABEL[built.review.region]} {built.review.date} 복기를 만들었어요.
            {built.errors.length > 0 && (
              <div className="muted">
                일부 데이터를 받지 못했어요:
                <ul>{built.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>

      {loadErr && <div className="banner error">복기를 불러오지 못했어요: {loadErr}</div>}
      {!loadErr && reviews == null && <p className="muted">불러오는 중…</p>}
      {reviews != null && reviews.length === 0 && (
        <div className="card">
          <p className="muted">아직 복기가 없어요. 장이 끝난 뒤 서버가 자동으로 만들거나, 위 버튼으로 지금 만들 수 있어요.</p>
        </div>
      )}
      {reviews != null && reviews.length > 0 && shown.length === 0 && (
        <div className="card"><p className="muted">{filter !== "ALL" ? REGION_LABEL[filter] : ""} 복기가 아직 없어요.</p></div>
      )}

      {shown.slice(0, limit).map((r) => <ReviewCard key={`${r.region}-${r.date}`} r={r} onOpen={onOpen} />)}
      {shown.length > limit && (
        <button className="link" onClick={() => setLimit((n) => n + PAGE)}>이전 복기 더 보기 ({shown.length - limit}개 남음)</button>
      )}
    </div>
  );
}
