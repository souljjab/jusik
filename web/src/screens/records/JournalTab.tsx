import { ChevronDown, Download, NotebookPen, PenLine, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { regionOfCode, type JournalEntry } from "@jusik/shared";
import { deleteJournal, patchJournal } from "../../api";
import { useApp } from "../../app/AppContext";
import {
  Button, EmptyState, Field, fmtDate, fmtInt, fmtNum, fmtPct, fmtPrice, fmtRatio, kstDate, Notice, Segmented, Sheet, Skeleton, SkeletonRows, Stat, Stats, Toggle, useBreakpoint, useToast,
} from "../../ui";
import { emptyForm, JournalFields, SaveResult, useJournalForm, useSaveJournal, type Saved } from "./JournalForm";
import { EmotionPicker, Pnl, Ret, Side, sourceText, StrategyField, Verdict, downloadText } from "./parts";
import {
  breaches, composeEmotion, EXIT_REASONS, exitValue, groupByDate, inRange, journalCsv, parseEmotion, parseExit, pct0, periodRange, periodStats, ruleVerdict, SELF_CHECK_LABEL,
  sellResults, sourceOf, type SelfCheck, type SellResult,
} from "./recordsModel";

/*
 * 매매일지(지도서 7.2 기록, 부록 A '매매일지 작성' 세 기기 모두 ●).
 *  - 위: 이번 주 요약(거래 수·승률·규칙 준수율 — 규칙 준수율에만 강조색)
 *  - 새 일지: 컴퓨터·태블릿 가로는 오른쪽 패널, 핸드폰·태블릿 세로는 아래 고정 버튼 → 하단 시트
 *  - 기록: 날짜별, 최신 먼저. 행을 누르면 상세(복기 메모·감정·청산 사유·전략·규칙 체크 고치기, 삭제)
 * 모의매매 기록은 서버가 자동으로 남긴다(출처 '자동(모의)'). 삭제는 확인 시트를 거친다.
 */

type SourceFilter = "all" | "manual" | "auto";

export function JournalTab({ loaded }: { loaded: boolean }) {
  const { journal, now, offline } = useApp();
  const bp = useBreakpoint();
  const wide = bp === "large" || bp === "expanded";
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [confirmDel, setConfirmDel] = useState<JournalEntry | null>(null);

  const results = useMemo(() => sellResults(journal), [journal]);
  const week = useMemo(() => periodRange("week", kstDate(now)), [now]);
  const weekStats = useMemo(() => periodStats(journal.filter((e) => inRange(e.date, week)), results), [journal, week, results]);
  const shown = useMemo(() => journal.filter((e) => filter === "all" || (filter === "auto") === (sourceOf(e) === "자동(모의)")), [journal, filter]);
  const groups = useMemo(() => groupByDate(shown), [shown]);
  const counts = useMemo(() => ({ auto: journal.filter((e) => sourceOf(e) === "자동(모의)").length }), [journal]);

  const detailEntry = open ? journal.find((e) => e.id === open) ?? null : null;

  const summary = (
    <section className="rec-week" aria-labelledby="rec-week-h">
      <div className="row between base wrap">
        <h2 id="rec-week-h" className="t-section">
          이번 주
        </h2>
        <span className="t-cap num">
          {fmtDate(week.from)} ~ {fmtDate(week.to)}
        </span>
      </div>
      {!loaded && !journal.length ? (
        <div className="rec-skel-stats" role="status" aria-label="불러오는 중">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={44} />
          ))}
        </div>
      ) : (
        <>
          <Stats n={3}>
            <Stat value={`${fmtInt(weekStats.trades)}건`} label="이번 주 거래" />
            <Stat value={pct0(weekStats.winRate)} label="승률" />
            <Stat value={pct0(weekStats.compliance)} label="규칙 준수" accent />
          </Stats>
          <p className="t-cap">
            승률은 청산 {fmtInt(weekStats.closed)}건, 규칙 준수는 판단할 수 있는 기록 {fmtInt(weekStats.judged)}건 기준이에요.
            {weekStats.judged === 0 && " 규칙 체크를 표시한 기록이 생기면 계산돼요."}
          </p>
        </>
      )}
    </section>
  );

  const list = (
    <section className="rec-list" aria-labelledby="rec-list-h">
      <div className="rec-list-head">
        <h2 id="rec-list-h" className="t-section">
          기록 {(loaded || journal.length > 0) && <span className="t-cap num">{fmtInt(shown.length)}건</span>}
        </h2>
        <div className="row wrap">
          <Segmented
            size="sm"
            label="출처"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "전체" },
              { value: "manual", label: "직접" },
              { value: "auto", label: `자동(모의)` },
            ]}
          />
          {bp !== "compact" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={!journal.length}
              icon={<Download size={16} strokeWidth={1.5} aria-hidden="true" />}
              onClick={() => downloadText(`매매일지_${kstDate(now)}.csv`, journalCsv(groupByDate(journal).flatMap((g) => g.items), results))}
            >
              CSV 내보내기
            </Button>
          )}
        </div>
      </div>
      {offline && !journal.length ? (
        <Notice tone="warn" title="기록을 불러오지 못했어요">
          서버와 연결되지 않았어요. 연결되면 자동으로 다시 받아요.
        </Notice>
      ) : !loaded && !journal.length ? (
        <SkeletonRows rows={6} h={40} />
      ) : groups.length === 0 ? (
        journal.length === 0 ? (
          <EmptyState
            icon={<NotebookPen size={24} strokeWidth={1.5} aria-hidden="true" />}
            title="아직 기록이 없어요"
            action={
              <Button variant="primary" onClick={() => (wide ? document.getElementById("rec-new-code")?.focus() : setSheet(true))}>
                일지 쓰기
              </Button>
            }
          >
            {wide ? "오른쪽 '새 일지'에 증권사에서 낸 매매를 적어 보세요. " : "증권사에서 낸 매매를 적어 보세요. "}
            모의매매를 켜면 진입·청산이 이유와 함께 자동으로 쌓여요.
          </EmptyState>
        ) : (
          <EmptyState title={filter === "auto" ? "자동(모의) 기록이 없어요" : "직접 쓴 기록이 없어요"} action={<Button onClick={() => setFilter("all")}>전체 기록 보기</Button>}>
            {filter === "auto" ? "설정에서 모의매매를 켜면 장중에 진입·청산이 자동으로 기록돼요." : `자동(모의) 기록 ${fmtInt(counts.auto)}건이 있어요.`}
          </EmptyState>
        )
      ) : (
        <div className="rec-groups">
          {groups.map((g) => (
            <section key={g.date} className="rec-group" aria-label={fmtDate(g.date)}>
              <h3 className="rec-date num">{fmtDate(g.date)}</h3>
              <ul className="rec-entries">
                {g.items.map((e) => (
                  <EntryRow
                    key={e.id}
                    e={e}
                    result={results.get(e.id)}
                    expanded={bp !== "compact" && open === e.id}
                    onToggle={() => setOpen((x) => (x === e.id ? null : e.id))}
                    onDelete={() => setConfirmDel(e)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className={`rec-journal ${wide ? "is-wide" : ""}`}>
      <div className="rec-journal-main">
        {summary}
        {list}
      </div>
      {wide ? (
        <aside className="rec-journal-side" aria-labelledby="rec-new-h">
          <NewJournalPanel />
        </aside>
      ) : (
        <>
          <div className={`rec-actionbar is-${bp}`} role="region" aria-label="새 일지">
            <Button variant="primary" size="lg" block icon={<PenLine size={18} strokeWidth={1.5} aria-hidden="true" />} onClick={() => setSheet(true)}>
              새 일지 쓰기
            </Button>
          </div>
          <NewJournalSheet open={sheet} onClose={() => setSheet(false)} />
        </>
      )}

      {bp === "compact" && (
        <Sheet open={!!detailEntry} onClose={() => setOpen(null)} title={detailEntry ? `${detailEntry.name} ${detailEntry.side === "BUY" ? "매수" : "매도"}` : ""}>
          {detailEntry && (
            <EntryDetail
              e={detailEntry}
              result={results.get(detailEntry.id)}
              onDelete={() => {
                const target = detailEntry;
                setOpen(null);
                setConfirmDel(target);
              }}
            />
          )}
        </Sheet>
      )}
      <DeleteSheet entry={confirmDel} onClose={() => setConfirmDel(null)} onDeleted={(id) => setOpen((x) => (x === id ? null : x))} />
    </div>
  );
}

// ───────────────────────── 기록 행 ─────────────────────────

function EntryRow({ e, result, expanded, onToggle, onDelete }: { e: JournalEntry; result: SellResult | undefined; expanded: boolean; onToggle: () => void; onDelete: () => void }) {
  const region = regionOfCode(e.code);
  const v = ruleVerdict(e);
  const emo = parseEmotion(e.emotion);
  const emos = [...emo.chips, ...(emo.text ? [emo.text] : [])];
  const detailId = `rec-detail-${e.id}`;
  return (
    <li className={`rec-entry ${expanded ? "is-open" : ""}`}>
      <button type="button" className="rec-entry-btn" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} onClick={onToggle}>
        <span className="rec-e-side">
          <Side side={e.side} />
        </span>
        <span className="rec-e-name">
          <span className="t-medium ellipsis">{e.name}</span>
          <span className="t-cap">{e.code}</span>
        </span>
        <span className="rec-e-qty num t-2">
          {fmtInt(e.qty)}주 × {fmtPrice(e.price, region)}
        </span>
        <span className="rec-e-result">
          {e.side === "SELL" ? (
            result?.pnl != null ? (
              <Pnl value={result.pnl} currency={result.currency} />
            ) : result?.pct != null ? (
              <Ret pct={result.pct} />
            ) : (
              <span className="t-cap">결과 모름</span>
            )
          ) : e.stop != null ? (
            <span className="t-cap num">손절 {fmtPrice(e.stop, region)}</span>
          ) : (
            <span className="t-cap">손절가 없음</span>
          )}
        </span>
        <span className="rec-e-meta">
          <span className="rec-e-emo t-2 ellipsis">{emos.join(" · ")}</span>
          <span className="rec-e-verdict">
            <Verdict v={v} />
          </span>
          <span className="rec-e-src t-cap">{sourceText(e)}</span>
        </span>
        <ChevronDown size={16} strokeWidth={1.5} className="rec-e-chev" aria-hidden="true" />
      </button>
      {expanded && (
        <div id={detailId} className="rec-entry-detail">
          <EntryDetail e={e} result={result} onDelete={onDelete} />
        </div>
      )}
    </li>
  );
}

// ───────────────────────── 상세와 복기 고치기 ─────────────────────────

const fmtR = (r: number) => `${r > 0 ? "+" : r < 0 ? "-" : ""}${Math.abs(r).toFixed(2)}R`;

function EntryDetail({ e, result, onDelete }: { e: JournalEntry; result: SellResult | undefined; onDelete: () => void }) {
  const { refreshJournal } = useApp();
  const toast = useToast();
  const region = regionOfCode(e.code);
  const sell = e.side === "SELL";
  const issues = breaches(e);

  const init = () => {
    const emo = parseEmotion(e.emotion);
    const ex = parseExit(e.exitReason);
    return {
      review: e.review ?? "", chips: emo.chips, text: emo.text, exitReason: ex.reason, exitDetail: ex.detail, strategy: e.strategy ?? "",
      check: e.selfCheck ?? null,
    };
  };
  const [d, setD] = useState(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 다른 곳에서 고쳐 서버 값이 바뀌면(20초마다 다시 받음) 고치는 중이 아닐 때만 따라간다
  const base = useMemo(init, [e]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  useEffect(() => {
    if (!dirty) setD(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const defaultCheck: SelfCheck = { stopSet: e.stop != null, weightOk: !(e.violations ?? []).some((x) => x.includes("비중")), unplanned: false };
  const check = d.check ?? defaultCheck;

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await patchJournal(e.id, {
        review: d.review,
        emotion: composeEmotion(d.chips, d.text),
        strategy: d.strategy.trim(),
        ...(sell ? { exitReason: exitValue(d.exitReason, d.exitDetail) } : {}),
        ...(!sell && sourceOf(e) !== "자동(모의)" && JSON.stringify(d.check) !== JSON.stringify(base.check) ? { selfCheck: d.check } : {}),
      });
      await refreshJournal();
      toast("복기를 저장했어요", "ok");
    } catch (x) {
      setErr(`복기를 저장하지 못했어요. ${x instanceof Error ? x.message : String(x)}`);
    } finally {
      setBusy(false);
    }
  };

  const idb = `rec-ed-${e.id}`;
  return (
    <div className="rec-detail stack-4">
      <dl className="rec-kv">
        <div>
          <dt>가격 × 수량</dt>
          <dd className="num">
            {fmtPrice(e.price, region, { unit: true })} × {fmtInt(e.qty)}주
          </dd>
        </div>
        {!sell && (
          <div>
            <dt>손절가</dt>
            <dd className="num">{e.stop != null ? fmtPrice(e.stop, region, { unit: true }) : "-"}</dd>
          </div>
        )}
        {!sell && (
          <div>
            <dt>목표가</dt>
            <dd className="num">{e.target != null ? fmtPrice(e.target, region, { unit: true }) : "-"}</dd>
          </div>
        )}
        {!sell && (
          <div>
            <dt>비중</dt>
            <dd className="num">{e.weightPct != null ? fmtRatio(e.weightPct) : "-"}</dd>
          </div>
        )}
        {sell && (
          <div>
            <dt>{result?.net ? "손익(비용 반영)" : "손익(수수료 제외)"}</dt>
            <dd>{result?.pnl != null ? <Pnl value={result.pnl} currency={result.currency} /> : "-"}</dd>
          </div>
        )}
        {sell && (
          <div>
            <dt>수익률</dt>
            <dd>
              <Ret pct={result?.pct} />
            </dd>
          </div>
        )}
        {sell && (
          <div>
            <dt title="R = (청산가 − 진입가) ÷ (진입가 − 계획 손절가). 1R은 계획한 1회 손실만큼이에요">R 배수</dt>
            <dd className="rec-tnum">
              {result?.r != null ? fmtR(result.r) : "-"}
              {result?.r != null && result.rDerived && <span className="t-cap"> 매수 손절가로 계산</span>}
            </dd>
          </div>
        )}
        {e.regime && (
          <div>
            <dt>진입 때 시장 국면</dt>
            <dd>{e.regime === "BULL" ? "강세" : e.regime === "BEAR" ? "약세" : e.regime === "NEUTRAL" ? "중립" : e.regime}</dd>
          </div>
        )}
        <div>
          <dt>출처</dt>
          <dd>{sourceText(e)}</dd>
        </div>
      </dl>

      {e.reason && (
        <div className="stack" style={{ gap: 2 }}>
          <span className="rec-lbl">{sell ? "매도 이유" : "진입 근거"}</span>
          <p className="rec-prose">{e.reason}</p>
        </div>
      )}
      {e.meta && (
        <div className="stack" style={{ gap: 2 }}>
          <span className="rec-lbl">진입 당시 신호(모의매매 규칙)</span>
          <p className="t-2 rec-tnum">
            점수 {fmtInt(e.meta.score)}점 · 거래량 {fmtNum(e.meta.volumeRatio, 1)}배 · 당일 {fmtPct(e.meta.changePct)} · 손절폭 {fmtRatio(e.meta.stopPct)}
          </p>
        </div>
      )}

      {issues.length > 0 && (
        <Notice tone="warn" title={`규칙 위반 ${issues.length}건`}>
          <ul className="rec-issues">
            {issues.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Notice>
      )}
      {sell && result?.stopLate && <Notice tone="warn" title="손절 지연">계획한 손절가보다 1% 넘게 아래에서 팔았어요. 손절가에 닿았을 때 바로 정리했는지 돌아봐요.</Notice>}

      <div className="rec-edit">
        <h4 className="rec-lbl rec-edit-h">복기</h4>
        <Field label="복기 메모" htmlFor={`${idb}-review`}>
          <textarea id={`${idb}-review`} className="ui-textarea" rows={3} maxLength={1000} value={d.review} onChange={(x) => setD({ ...d, review: x.target.value })} placeholder="계획대로 했나요? 다음엔 무엇을 바꿀까요?" />
        </Field>
        {e.source === "자동(모의)" && sell && <span className="t-cap">순손익은 따로 보관돼 있어서 메모를 고쳐도 집계는 바뀌지 않아요.</span>}
        <div className="stack" style={{ gap: 4 }}>
          <span className="rec-lbl" id={`${idb}-emo-lbl`}>
            감정
          </span>
          <EmotionPicker idBase={`${idb}-emo`} chips={d.chips} text={d.text} onChips={(chips) => setD({ ...d, chips })} onText={(text) => setD({ ...d, text })} />
        </div>
        <div className="rec-edit-grid">
          {sell && (
            <Field label="청산 사유" htmlFor={`${idb}-exit`}>
              <div className="stack">
                <select id={`${idb}-exit`} className="ui-select" value={d.exitReason} onChange={(x) => setD({ ...d, exitReason: x.target.value })}>
                  <option value="">고르지 않음</option>
                  {EXIT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {d.exitReason === "기타" && <input className="ui-input" aria-label="기타 청산 사유" value={d.exitDetail} maxLength={50} onChange={(x) => setD({ ...d, exitDetail: x.target.value })} />}
              </div>
            </Field>
          )}
          <Field label="전략" htmlFor={`${idb}-strategy`}>
            <StrategyField id={`${idb}-strategy`} value={d.strategy} onChange={(strategy) => setD({ ...d, strategy })} />
          </Field>
        </div>
        {!sell && sourceOf(e) === "자동(모의)" && <span className="t-cap">모의매매 규칙이 낸 주문이라, 서버가 찾은 위반이 없으면 규칙을 지킨 것으로 봐요.</span>}
        {!sell && sourceOf(e) !== "자동(모의)" && (
          <fieldset className="rec-checks">
            <legend className="rec-lbl">
              규칙 체크{" "}
              {!d.check && <span className="t-cap">아직 표시하지 않았어요. 바꾸면 함께 저장돼요</span>}
            </legend>
            {(Object.keys(SELF_CHECK_LABEL) as (keyof SelfCheck)[]).map((k) => (
              <Toggle key={k} className="rec-toggle" checked={check[k]} onChange={(val) => setD({ ...d, check: { ...check, [k]: val } })} label={SELF_CHECK_LABEL[k]} />
            ))}
            {d.check && base.check && (
              <Button variant="link" className="rec-touchlink" onClick={() => setD({ ...d, check: null })}>
                규칙 체크 지우기
              </Button>
            )}
          </fieldset>
        )}
        {err && <Notice tone="warn">{err}</Notice>}
        <div className="rec-edit-actions">
          <Button variant="primary" disabled={!dirty} busy={busy} onClick={save}>
            복기 저장
          </Button>
          {dirty && !busy && (
            <Button variant="ghost" onClick={() => setD(base)}>
              되돌리기
            </Button>
          )}
          <span className="grow" />
          <Button variant="ghost" icon={<Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={onDelete}>
            기록 삭제
          </Button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 삭제 확인 ─────────────────────────

function DeleteSheet({ entry, onClose, onDeleted }: { entry: JournalEntry | null; onClose: () => void; onDeleted: (id: string) => void }) {
  const { refreshJournal } = useApp();
  const toast = useToast();
  const bp = useBreakpoint();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setErr(""), [entry]);
  const del = async () => {
    if (!entry) return;
    setBusy(true);
    try {
      await deleteJournal(entry.id);
      await refreshJournal();
      onDeleted(entry.id);
      toast("기록을 삭제했어요", "info");
      onClose();
    } catch (x) {
      setErr(`삭제하지 못했어요. ${x instanceof Error ? x.message : String(x)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={!!entry}
      onClose={onClose}
      title="기록 삭제"
      side={bp === "compact" ? "bottom" : "center"}
      initialFocus=".rec-del-cancel"
      footer={
        <div className="rec-del-actions">
          <Button variant="ghost" className="rec-del-cancel" onClick={onClose}>
            취소
          </Button>
          <Button variant="secondary" busy={busy} icon={<Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={del}>
            기록 삭제
          </Button>
        </div>
      }
    >
      {entry && (
        <div className="stack-3">
          <p>
            <span className="t-medium">{fmtDate(entry.date)} {entry.name} {entry.side === "BUY" ? "매수" : "매도"}</span>{" "}
            <span className="num t-2">
              {fmtInt(entry.qty)}주 × {fmtPrice(entry.price, regionOfCode(entry.code))}
            </span>
          </p>
          <p className="t-2">삭제하면 되돌릴 수 없고, 승률과 규칙 준수율 계산에서도 빠져요.</p>
          {sourceOf(entry) === "자동(모의)" && <p className="t-2">자동(모의) 기록만 지워지고 모의계좌 잔고와 보유 종목은 그대로예요.</p>}
          {err && <Notice tone="warn">{err}</Notice>}
        </div>
      )}
    </Sheet>
  );
}

// ───────────────────────── 새 일지(패널·시트) ─────────────────────────

const SCOPE_NOTE = "증권사에서 이미 낸 매매를 적는 곳이에요. 새로 살 종목은 종목 화면의 '매수 주문 검토'에서 위험부터 확인하세요.";

function NewJournalPanel() {
  const { now } = useApp();
  const api = useJournalForm(() => emptyForm(kstDate(now)));
  const [saved, setSaved] = useState<Saved | null>(null);
  const top = useRef<HTMLDivElement>(null);
  // 저장 결과는 패널 맨 위에 나오므로, 저장하면 패널을 위로 올려 결과(위반 문장)를 보여 준다
  const { busy, err, save } = useSaveJournal(api, (r) => {
    setSaved(r);
    top.current?.closest(".rec-journal-side")?.scrollTo({ top: 0 });
  });
  return (
    <div className="rec-new stack-4" ref={top}>
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="rec-new-h" className="t-section">
          새 일지
        </h2>
        <p className="t-cap">{SCOPE_NOTE}</p>
      </div>
      {saved && <SaveResult saved={saved} onClose={() => setSaved(null)} />}
      <JournalFields api={api} idBase="rec-new" />
      {err && <Notice tone="warn">{err}</Notice>}
      <div className="stack" style={{ gap: 4 }}>
        <Button variant="primary" size="lg" block busy={busy} disabled={!!api.missing} onClick={save}>
          일지 저장
        </Button>
        {api.missing && <span className="t-cap rec-center">{api.missing}</span>}
      </div>
    </div>
  );
}

function NewJournalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { now } = useApp();
  const api = useJournalForm(() => emptyForm(kstDate(now)));
  const [saved, setSaved] = useState<Saved | null>(null);
  const { busy, err, save } = useSaveJournal(api, setSaved);
  const close = () => {
    setSaved(null);
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={close}
      title="새 일지"
      initialFocus="#rec-sheet-code"
      footer={
        saved ? (
          <div className="rec-del-actions">
            <Button variant="secondary" onClick={() => setSaved(null)}>
              이어서 쓰기
            </Button>
            <Button variant="primary" onClick={close}>
              닫기
            </Button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 4 }}>
            {api.missing && <span className="t-cap rec-center">{api.missing}</span>}
            <Button variant="primary" size="lg" block busy={busy} disabled={!!api.missing} onClick={save}>
              일지 저장
            </Button>
          </div>
        )
      }
    >
      {saved ? (
        <SaveResult saved={saved} />
      ) : (
        <div className="stack-4">
          <p className="t-cap">{SCOPE_NOTE}</p>
          <JournalFields api={api} idBase="rec-sheet" />
          {err && <Notice tone="warn">{err}</Notice>}
        </div>
      )}
    </Sheet>
  );
}
