import { useEffect, useState } from "react";
import { paperEquity, regionOfCode, type Currency, type DayTradeCandidate, type PaperAccount, type PlanItem, type ServerState, type Settings } from "@jusik/shared";
import { excelUrl, resetPaper, saveSettings, startScan, syncExport } from "./api";
import { kst, moneyByCurrency, num, pct, tone } from "./format";
import { NoteList } from "./NoteList";

const CUR_LABEL: Record<Currency, string> = { KRW: "원화(국내)", USD: "달러(해외)" };
const REGIME_LABEL: Record<string, string> = { BULL: "강세", NEUTRAL: "중립", BEAR: "약세" };

function Num({ label, value, onChange, min, max, step, unit }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; unit?: string }) {
  return (
    <label>
      {label}
      <input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      {unit && <span className="muted small">{unit}</span>}
    </label>
  );
}

function SettingsPanel({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const [draft, setDraft] = useState<Settings>(s);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  // 다른 곳에서 바뀐 값은 편집 중이 아닐 때만 반영한다
  useEffect(() => {
    if (!dirty) setDraft(s);
  }, [s, dirty]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };
  const save = async () => {
    try {
      await saveSettings(draft);
      setDirty(false);
      setMsg("저장했어요");
      onSaved();
    } catch (e) {
      setMsg(`저장 실패: ${e instanceof Error ? e.message : e}`);
    }
    setTimeout(() => setMsg(""), 3000);
  };
  return (
    <details className="card" open>
      <summary><b>설정</b> <span className="muted small">— 예수금과 위험 한도를 정하면 그 안에서 살 수 있는 매매만 추천해요</span></summary>
      <h4 className="group">예수금</h4>
      <div className="form compact">
        <Num label="원화 예수금(원)" value={draft.depositKRW} step={100000} min={0} onChange={(v) => set("depositKRW", v)} />
        <Num label="달러 예수금($)" value={draft.depositUSD} step={100} min={0} onChange={(v) => set("depositUSD", v)} />
      </div>
      <h4 className="group">위험 관리</h4>
      <div className="form compact">
        <Num label="1회 손절 허용 손실(예수금 대비 %)" value={draft.riskPct} min={0.1} max={10} step={0.1} onChange={(v) => set("riskPct", v)} />
        <Num label="한 종목 최대 비중(%)" value={draft.maxWeightPct} min={1} max={100} onChange={(v) => set("maxWeightPct", v)} />
        <Num label="최대 보유 종목 수" value={draft.maxPositions} min={1} max={10} onChange={(v) => set("maxPositions", v)} />
        <Num label="항상 남길 현금(%)" value={draft.reservePct} min={0} max={90} onChange={(v) => set("reservePct", v)} />
      </div>
      <h4 className="group">스캔</h4>
      <div className="form compact">
        <Num label="최소 점수(0~100)" value={draft.minScore} min={0} max={100} onChange={(v) => set("minScore", v)} />
        <Num label="스캔 주기(분)" value={draft.scanIntervalMin} min={1} max={240} onChange={(v) => set("scanIntervalMin", v)} />
        <Num label="보유 종목 점검 주기(초)" value={draft.monitorIntervalSec} min={15} max={3600} onChange={(v) => set("monitorIntervalSec", v)} />
        <Num label="시장별 스캔 종목 수" value={draft.maxScanPerMarket} min={5} max={100} onChange={(v) => set("maxScanPerMarket", v)} />
        <Num label="최소 거래대금(국내, 원)" value={draft.minTradeValueKRW} step={100000000} min={0} onChange={(v) => set("minTradeValueKRW", v)} />
        <Num label="최소 거래대금(해외, $)" value={draft.minTradeValueUSD} step={1000000} min={0} onChange={(v) => set("minTradeValueUSD", v)} />
      </div>
      <div className="checks">
        {(["KOSPI", "KOSDAQ", "US"] as const).map((m) => (
          <label key={m} className="check">
            <input type="checkbox" checked={draft.markets[m]} onChange={(e) => set("markets", { ...draft.markets, [m]: e.target.checked })} />
            {m === "US" ? "미국" : m}
          </label>
        ))}
        <label className="check strong">
          <input type="checkbox" checked={draft.paperEnabled} onChange={(e) => set("paperEnabled", e.target.checked)} />
          규칙대로 모의매매 자동 실행 + 매매일지 자동 작성
        </label>
      </div>
      <button className="primary" disabled={!dirty} onClick={save}>설정 저장</button> <span className="muted small">{msg}</span>
    </details>
  );
}

function PlanTable({ cur, st, onOpen }: { cur: Currency; st: ServerState; onOpen: (code: string) => void }) {
  const scan = st.latestScan;
  const plan = scan?.plans[cur];
  const s = st.settings;
  const cash = s.paperEnabled ? st.paper[cur].cash : cur === "KRW" ? s.depositKRW : s.depositUSD;
  const executed = new Set(scan?.executed ?? []);
  const m = (n: number) => moneyByCurrency(n, cur);
  return (
    <div className="card">
      <h3 className="h3">매매 계획 · {CUR_LABEL[cur]} <span className="muted small">— {s.paperEnabled ? "모의계좌 현금" : "예수금"} {m(cash)} 기준</span></h3>
      {!plan ? (
        <p className="muted">아직 스캔 결과가 없어요. 「지금 스캔」을 눌러 보세요.</p>
      ) : plan.items.length === 0 ? (
        <p className="muted">지금 예수금과 위험 한도 안에서 살 만한 종목이 없어요.{plan.skipped.length > 0 && ` (후보 ${plan.skipped.length}개는 아래 사유로 제외)`}</p>
      ) : (
        <div className="table-wrap">
          <table className="trades">
            <thead><tr><th className="left">종목</th><th>점수</th><th>진입가</th><th>손절가</th><th>목표가</th><th>수량</th><th>투자금</th><th>최대 손실</th><th>비중</th><th /></tr></thead>
            <tbody>
              {plan.items.map((it: PlanItem) => (
                <tr key={it.candidate.code}>
                  <td className="left"><button className="link" onClick={() => onOpen(it.candidate.code)}>{it.candidate.name}</button> <span className="muted small">{it.candidate.code}</span></td>
                  <td>{it.candidate.score}</td>
                  <td>{m(it.candidate.entry)}</td>
                  <td className="down">{m(it.candidate.stop)}</td>
                  <td className="up">{m(it.candidate.target)}</td>
                  <td>{it.qty.toLocaleString()}주</td>
                  <td>{m(it.amount)}</td>
                  <td>{m(it.riskAmount)}</td>
                  <td>{num(it.weightPct, 1)}%</td>
                  <td>{executed.has(it.candidate.code) && <span className="chip grade-A">모의 진입</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plan && plan.items.length > 0 && (
        <p className="small">합계 투자 {m(plan.used)} · 남는 현금 {m(plan.remainingCash)} (예비 현금 {s.reservePct}% 포함) · 최대 손실 합계 {m(plan.items.reduce((a, i) => a + i.riskAmount, 0))}</p>
      )}
      {plan && plan.skipped.length > 0 && (
        <details>
          <summary className="muted small">제외된 후보 {plan.skipped.length}개</summary>
          <ul className="notes">{plan.skipped.map((x) => <li key={x.candidate.code} className="note-info">{x.candidate.name}({x.candidate.code}) — {x.reason}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function CandidateTable({ list, onOpen }: { list: DayTradeCandidate[]; onOpen: (code: string) => void }) {
  if (list.length === 0) return <p className="muted">조건에 맞는 후보가 없어요. 장이 열린 동안 계속 찾고 있어요.</p>;
  return (
    <div className="table-wrap tall">
      <table className="trades">
        <thead><tr><th className="left">종목</th><th>시장</th><th>점수</th><th>현재가</th><th>등락</th><th>거래량배수</th><th>손절폭</th><th>순손익비</th></tr></thead>
        <tbody>
          {list.map((c) => {
            const cur: Currency = regionOfCode(c.code) === "US" ? "USD" : "KRW";
            return (
              <tr key={c.code}>
                <td className="left">
                  <details>
                    <summary><button className="link" onClick={(e) => { e.preventDefault(); onOpen(c.code); }}>{c.name}</button> <span className="muted small">{c.code}</span></summary>
                    <NoteList notes={c.notes} />
                  </details>
                </td>
                <td>{c.market}</td>
                <td><b>{c.score}</b></td>
                <td>{moneyByCurrency(c.price, cur)}</td>
                <td className={tone(c.changePct)}>{pct(c.changePct, 1)}</td>
                <td>{num(c.volumeRatio, 1)}배</td>
                <td>{num(c.stopPct, 1)}%</td>
                <td>{num(c.netRR, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PaperPanel({ cur, acct, deposit, onReset }: { cur: Currency; acct: PaperAccount; deposit: number; onReset: () => void }) {
  const m = (n: number) => moneyByCurrency(n, cur);
  const equity = paperEquity(acct);
  return (
    <div className="card">
      <h3 className="h3">모의계좌 · {CUR_LABEL[cur]}</h3>
      <div className="metrics">
        <div className="metric"><span className="muted small">현금</span><b>{m(acct.cash)}</b></div>
        <div className="metric"><span className="muted small">총자산(평가 포함)</span><b>{m(equity)}</b></div>
        <div className="metric"><span className="muted small">실현손익(수수료·세금 반영)</span><b className={tone(acct.realizedPnl)}>{m(acct.realizedPnl)}</b></div>
        <div className="metric"><span className="muted small">청산 / 승</span><b>{acct.closed} / {acct.wins}</b></div>
      </div>
      {acct.positions.length > 0 ? (
        <div className="table-wrap">
          <table className="trades">
            <thead><tr><th className="left">종목</th><th>체결일</th><th>체결가</th><th>수량</th><th>현재가</th><th>평가손익</th><th>손절</th><th>목표</th></tr></thead>
            <tbody>
              {acct.positions.map((p) => {
                const last = p.lastPrice ?? p.entryPrice;
                const r = (last / p.entryPrice - 1) * 100;
                return (
                  <tr key={p.code}>
                    <td className="left">{p.name} <span className="muted small">{p.code}</span></td>
                    <td>{p.entryDate}</td><td>{m(p.entryPrice)}</td><td>{p.qty.toLocaleString()}</td><td>{m(last)}</td>
                    <td className={tone(r)}>{pct(r)}</td><td className="down">{m(p.stop)}</td><td className="up">{m(p.target)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">보유 중인 모의 포지션이 없어요.</p>
      )}
      <button className="link" onClick={() => confirm(`모의계좌를 예수금(${m(deposit)})으로 초기화할까요? 보유 중인 모의 포지션은 기록 없이 사라져요(매매일지는 유지).`) && onReset()}>모의계좌 초기화</button>
    </div>
  );
}

export function DayTradeView({ st, error, refresh, onOpen }: { st: ServerState | null; error: string | null; refresh: () => void; onOpen: (code: string) => void }) {
  const [busy, setBusy] = useState("");
  if (!st) return <div className={error ? "banner error" : "muted"}>{error ? `서버에 연결할 수 없어요: ${error}` : "불러오는 중…"}</div>;
  const { scheduler: sch, export: ex } = st.status;
  const scan = st.latestScan;
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy("");
      refresh();
    }
  };

  return (
    <div>
      {st.status.sample && <div className="banner warn-banner">샘플 데이터 모드예요. 아래 종목·가격은 실제 시세가 아니라 임의로 만든 값이에요.</div>}
      <div className="card statusbar">
        <div>
          <b>{sch.scanning ? "스캔 중…" : "대기 중"}</b>
          <span className="muted small"> · 마지막 스캔 {kst(sch.lastScanAt)} · 다음 {kst(sch.nextScanAt)} (한국시간)</span>
          <div className="small">
            <span className={`chip ${sch.marketOpen.KR ? "regime-BULL" : ""}`}>국내장 {sch.marketOpen.KR ? "열림" : "닫힘"}</span>{" "}
            <span className={`chip ${sch.marketOpen.US ? "regime-BULL" : ""}`}>미국장 {sch.marketOpen.US ? "열림" : "닫힘"}</span>{" "}
            <span className="muted">장이 열린 동안 {st.settings.scanIntervalMin}분마다 자동으로 새로 찾아요 (공휴일은 구분하지 못해요)</span>
          </div>
          {sch.lastError && <div className="note-bad small">최근 오류: {sch.lastError}</div>}
        </div>
        <button className="primary" disabled={sch.scanning || busy === "scan"} onClick={() => run("scan", startScan)}>{sch.scanning ? "스캔 중…" : "지금 스캔"}</button>
      </div>

      <SettingsPanel s={st.settings} onSaved={refresh} />

      {scan && (
        <div className="card small">
          <b>최근 스캔 요약</b> · 후보 풀 {scan.universeCount}종목 → 분석 {scan.scannedCount}종목 → <b>조건 충족 {scan.candidates.length}종목</b>
          <div className="muted">
            시장 국면: {Object.entries(scan.regimes).map(([k, v]) => `${k} ${v ? REGIME_LABEL[v] : "확인 불가"}`).join(" · ") || "-"}
            {Object.keys(scan.rejected).length > 0 && <> · 탈락 사유: {Object.entries(scan.rejected).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}</>}
          </div>
          {scan.errors.length > 0 && (
            <details open><summary className="note-bad">오류 {scan.errors.length}건 (일부 시장/종목을 읽지 못했어요)</summary><ul className="notes">{scan.errors.slice(0, 8).map((e, i) => <li key={i} className="note-bad">{e}</li>)}</ul></details>
          )}
        </div>
      )}

      <PlanTable cur="KRW" st={st} onOpen={onOpen} />
      <PlanTable cur="USD" st={st} onOpen={onOpen} />

      <div className="card">
        <h3 className="h3">후보 전체 <span className="muted small">— 점수 순 · 종목명을 누르면 상세 분석</span></h3>
        <CandidateTable list={scan?.candidates ?? []} onOpen={onOpen} />
      </div>

      <PaperPanel cur="KRW" acct={st.paper.KRW} deposit={st.settings.depositKRW} onReset={() => run("reset", resetPaper)} />
      <PaperPanel cur="USD" acct={st.paper.USD} deposit={st.settings.depositUSD} onReset={() => run("reset", resetPaper)} />

      <div className="card">
        <h3 className="h3">저장 · 내보내기</h3>
        <ul className="notes">
          <li className={ex.excel.ok === false ? "note-bad" : "note-info"}>
            1차 · 로컬 엑셀: {ex.excel.path} — {ex.excel.at ? `${kst(ex.excel.at)} ${ex.excel.ok ? "저장됨" : `실패: ${ex.excel.error}`}` : "아직 저장 전"}
          </li>
          <li className={ex.sheets.ok === false ? "note-bad" : "note-info"}>
            2차 · 구글 스프레드시트: {!ex.sheets.configured ? "설정 안 됨(server/.env.example 참고)" : ex.sheets.at ? `${kst(ex.sheets.at)} ${ex.sheets.ok ? `동기화됨(${ex.sheets.rows}행)` : `실패: ${ex.sheets.error}`}` : "아직 동기화 전"}
          </li>
        </ul>
        <a className="primary linkbtn" href={excelUrl}>엑셀 다운로드</a>{" "}
        <button className="link" disabled={busy === "sync"} onClick={() => run("sync", syncExport)}>지금 내보내기</button>
      </div>

      <p className="muted small">
        모의매매는 실제 주문이 아니라 규칙을 시험하는 가상 체결이에요(수수료·세금·슬리피지 반영). 데이터는 네이버 금융·야후 파이낸스 웹페이지에서 개인 용도로 낮은 빈도로 읽어오며, 사이트 이용약관·접근 정책은 사용자가 확인해야 해요.
        단타 규칙은 경험칙이고 수익이 검증되지 않았어요. 모의매매 결과가 충분히 쌓이기 전에는 실제 자금으로 따라 하지 마세요.
      </p>
    </div>
  );
}
