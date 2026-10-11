import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { FlaskConical, Lock, RefreshCw, RotateCcw } from "lucide-react";
import { INTRADAY_PARAMS, STRATEGIES, dayTradeEvidence, regionOf, type DayTradeCandidate, type Market, type Region, type ScanResult, type Settings } from "@jusik/shared";
import { saveSettings } from "../../api";
import { useActions } from "../../app/actions";
import { useApp } from "../../app/AppContext";
import { Link, navigate } from "../../app/router";
import {
  Button, Change, Chip, EmptyState, EvidenceStrip, MarketStatus, Notice, RuleTag, ScoreBar, Section, Skeleton, SkeletonRows, Sparkline, Toggle,
  fmtBig, fmtInt, fmtNum, fmtPct, fmtPrice, fmtWhen, useBreakpoint, useToast,
} from "../../ui";
import {
  FIXED_RULES, MARKET_NAME, SCAN_DEFAULTS, bindingRejection, changedKeys, draftProblems, rejectionAdvice, scanDraftOf,
  type ScanDraft, type ScanKey,
} from "./logic";
import { useScan } from "./useScan";
import { useSparks } from "./useSparks";

const KEY_LABEL: Record<ScanKey, string> = {
  minScore: "최소 점수", minTradeValueKRW: "국내 최소 거래대금", minTradeValueUSD: "미국 최소 거래대금", markets: "대상 시장",
  maxScanPerMarket: "시장별 스캔 종목 수", scanIntervalMin: "스캔 주기", minuteMode: "분봉 확인",
};

const MINUTE_MODES: { id: Settings["minuteMode"]; label: string; help: string }[] = [
  { id: "off", label: "끔", help: "분봉을 보지 않고 매매 계획대로 모의 진입해요." },
  {
    id: "filter",
    label: "갭 추격·회피만 거름(기본)",
    help: `분봉 판단이 '피함'이거나, 시초가 갭 +${INTRADAY_PARAMS.gapCautionPct}% 이상에서 아직 '대기'면 이번 스캔에서는 들어가지 않아요. 분봉 자료가 없으면 막지 않아요.`,
  },
  { id: "strict", label: "분봉 매수 신호일 때만", help: "분봉 판단이 '매수'일 때만 들어가요. 분봉 자료가 없으면 들어가지 않아요." },
];

/** 스크리너(지도서 5.3 A~E): 전략 프리셋, 조건 편집, 결과 수와 저장, 결과 표와 52주 추세 */
export function ScreenerTab() {
  const { server, refreshServer, now } = useApp();
  const bp = useBreakpoint();
  const toast = useToast();
  const scanCtl = useScan();
  const saved = useMemo(() => scanDraftOf(server?.settings ?? {}), [server?.settings]);
  const [draft, setDraft] = useState<ScanDraft>(saved);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const changed = changedKeys(saved, draft);
  const dirty = touched && changed.length > 0;

  // 다른 곳에서 바뀐 값은 편집 중이 아닐 때만 반영한다
  useEffect(() => {
    if (!touched || changed.length === 0) {
      setDraft(saved);
      setTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  if (!server) return <ScreenerSkeleton />;

  const set = (patch: Partial<ScanDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setTouched(true);
  };
  const problems = draftProblems(draft);
  const save = async (): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveSettings(draft);
      await refreshServer();
      setTouched(false);
      toast("조건을 저장했어요. 다음 스캔부터 적용돼요.", "ok");
      return true;
    } catch (e) {
      setSaveError(`조건을 저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}. 서버 연결을 확인하고 다시 저장하세요.`);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const scanNow = async () => {
    if (dirty && !(await save())) return;
    await scanCtl.start();
  };
  const noMarket = !draft.markets.KOSPI && !draft.markets.KOSDAQ && !draft.markets.US;

  const saveBtn = (
    <Button variant="secondary" size={bp === "compact" ? "lg" : "md"} disabled={!dirty || noMarket} busy={saving} onClick={() => void save()}>
      조건 저장
    </Button>
  );
  const scanBtn = (
    <Button variant="primary" size={bp === "compact" ? "lg" : "md"} busy={scanCtl.scanning} disabled={noMarket || saving} onClick={() => void scanNow()} icon={<RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />}>
      {scanCtl.scanning ? "스캔 중" : dirty ? "저장하고 스캔" : "지금 스캔"}
    </Button>
  );

  const scan = server.latestScan;
  const conditions = (
    <ConditionEditor
      draft={draft}
      set={set}
      dirty={dirty}
      onRevert={() => (setDraft(saved), setTouched(false))}
      onDefaults={() => set(SCAN_DEFAULTS)}
      compact={bp === "compact"}
    />
  );

  return (
    <div className="disc-scr">
      {bp === "large" && <aside className="disc-cond-pane" aria-label="스캔 조건">{conditions}</aside>}
      <div className="disc-scr-main">
        <Presets />
        {(bp === "medium" || bp === "expanded") && conditions}

        <section className="disc-result" aria-labelledby="disc-result-ttl">
          <div className="disc-result-head">
            <h2 id="disc-result-ttl" className="disc-result-count">
              <span className="t-section">조건 충족</span>
              {scan ? (
                <>
                  <span className="t-price num">{fmtInt(scan.candidates.length)}</span>
                  <span className="t-section">종목</span>
                </>
              ) : (
                <span className="t-section muted">스캔 전</span>
              )}
            </h2>
            {bp !== "compact" && (
              <div className="row wrap">
                {saveBtn}
                {scanBtn}
                {scan && scan.candidates.length > 0 && (
                  <Button variant="ghost" icon={<FlaskConical size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={() => navigate(`/discover/strategy?id=daytrade-breakout&code=${encodeURIComponent(scan.candidates[0]!.code)}`)}>
                    백테스트 실행
                  </Button>
                )}
              </div>
            )}
          </div>
          {scan && (
            <div className="disc-result-meta">
              <p className="t-2 num">
                {fmtWhen(scan.at, now)} 스캔 기준 · 후보 풀 {fmtInt(scan.universeCount)} → 분석 {fmtInt(scan.scannedCount)} → 조건 충족 {fmtInt(scan.candidates.length)}
              </p>
              <span className="disc-status-markets">
                {scanRegions(scan).map((r) => (
                  <MarketStatus key={r} region={r} now={now} asOf={scan.at} />
                ))}
              </span>
            </div>
          )}
          {dirty && (
            <Notice tone="info" title="저장하지 않은 조건이 있어요">
              바꾼 조건: {changed.map((k) => KEY_LABEL[k]).join(", ")}. 저장한 뒤 스캔해야 결과에 반영돼요.
            </Notice>
          )}
          {problems.length > 0 && (
            <Notice tone="warn" title="조건을 확인하세요">
              {problems.join(" ")}
            </Notice>
          )}
          {saveError && <Notice tone="warn">{saveError}</Notice>}
          {scanCtl.error && <Notice tone="warn">{scanCtl.error}</Notice>}
          {scan && scan.candidates.length === 0 && <ZeroResult scan={scan} draft={draft} onFix={set} />}
        </section>

        {bp === "compact" && conditions}
        {bp === "compact" ? (
          scan && scan.candidates.length > 0 && (
            <p className="t-2">
              결과 목록은 <Link to="/discover">추천</Link>에서 근거와 함께 봐요.
            </p>
          )
        ) : scan ? (
          scan.candidates.length > 0 && <ResultTable list={scan.candidates} />
        ) : (
          <EmptyState title="아직 스캔 결과가 없어요" action={scanBtn}>
            조건을 확인하고 지금 스캔하면 결과가 여기에 나와요.
          </EmptyState>
        )}
      </div>
      {bp === "compact" && (
        <div className="disc-bottom-bar two">
          {saveBtn}
          {scanBtn}
        </div>
      )}
    </div>
  );
}

/** 스캔한 시장의 지역(장 상태 표시용). 시장 목록이 없으면 국내 */
function scanRegions(scan: ScanResult): Region[] {
  const r = [...new Set(scan.markets.map(regionOf))];
  return r.length ? r : ["KR"];
}

/** A. 전략 프리셋: 스캔이 쓰는 단타 돌파 하나 + 종목별로 시험하는 책 전략 */
function Presets() {
  return (
    <div className="disc-presets">
      <div className="disc-chips scroll" role="group" aria-label="전략 프리셋">
        <span className="ui-chip on disc-preset-on" aria-current="true">
          단타 돌파(스캔)
        </span>
        {STRATEGIES.filter((s) => s.id !== "daytrade-breakout").map((s) => (
          <Chip key={s.id} onClick={() => navigate(`/discover/strategy?id=${s.id}`)}>
            <FlaskConical size={14} strokeWidth={1.5} aria-hidden="true" />
            {s.name}
          </Chip>
        ))}
      </div>
      <p className="t-cap">
        시장 전체 스캔은 단타 돌파 규칙만 돌려요. 책 전략(와인스타인·설춘환·캔들마스터 등)을 누르면 종목 하나로 시험하는 전략과 백테스트로 가요.
      </p>
    </div>
  );
}

/** B. 조건 편집: 대상·유동성·기술·분봉 확인으로 묶고, 고정 규칙은 읽기만 */
function ConditionEditor({ draft, set, dirty, onRevert, onDefaults, compact }: {
  draft: ScanDraft;
  set: (p: Partial<ScanDraft>) => void;
  dirty: boolean;
  onRevert: () => void;
  onDefaults: () => void;
  compact: boolean;
}) {
  const mode = MINUTE_MODES.find((m) => m.id === draft.minuteMode) ?? MINUTE_MODES[1]!;
  return (
    <div className="disc-cond">
      <div className="disc-cond-head">
        <h2 className="t-section">조건</h2>
        <div className="row">
          {dirty && (
            <Button variant="link" onClick={onRevert} icon={<RotateCcw size={14} strokeWidth={1.5} aria-hidden="true" />}>
              되돌리기
            </Button>
          )}
          <Button variant="link" onClick={onDefaults}>
            기본값으로
          </Button>
        </div>
      </div>

      <div className="disc-cond-groups">
        <Group title="대상">
          <div className="disc-toggles">
            {(["KOSPI", "KOSDAQ", "US"] as Market[]).map((m) => (
              <Toggle key={m} checked={draft.markets[m]} onChange={(v) => set({ markets: { ...draft.markets, [m]: v } })} label={MARKET_NAME[m]} />
            ))}
          </div>
          <ValueRow
            id="disc-maxscan"
            label="시장별 스캔 종목 수"
            hint="거래대금 상위부터"
            value={draft.maxScanPerMarket}
            onChange={(v) => set({ maxScanPerMarket: Math.round(v) })}
            chips={[20, 40, 60, 100].map((v) => ({ v, label: `${v}` }))}
            unit="개"
            min={5}
            max={100}
            step={5}
          />
          <ValueRow
            id="disc-interval"
            label="스캔 주기"
            hint="장이 열린 동안 자동으로"
            value={draft.scanIntervalMin}
            onChange={(v) => set({ scanIntervalMin: Math.round(v) })}
            chips={[5, 10, 30, 60].map((v) => ({ v, label: `${v}분` }))}
            unit="분"
            min={1}
            max={240}
          />
        </Group>

        <Group title="유동성">
          <ValueRow
            id="disc-tv-krw"
            label="최소 거래대금 · 국내"
            value={draft.minTradeValueKRW / 1e8}
            onChange={(v) => set({ minTradeValueKRW: Math.max(0, v) * 1e8 })}
            chips={[10, 50, 100, 300].map((v) => ({ v, label: `${v}억` }))}
            unit="억"
            min={0}
            step={10}
          />
          <ValueRow
            id="disc-tv-usd"
            label="최소 거래대금 · 미국"
            value={draft.minTradeValueUSD / 1e6}
            onChange={(v) => set({ minTradeValueUSD: Math.max(0, v) * 1e6 })}
            chips={[1, 5, 20, 50].map((v) => ({ v, label: `$${v}M` }))}
            unit="백만 달러"
            min={0}
            step={1}
          />
        </Group>

        <Group title="기술">
          <ValueRow
            id="disc-minscore"
            label="최소 점수"
            hint="거래량·돌파·정배열·종가 위치·상승폭·국면을 더한 점수(0~100)"
            value={draft.minScore}
            onChange={(v) => set({ minScore: Math.round(v) })}
            chips={[45, 55, 65, 75].map((v) => ({ v, label: `${v}점` }))}
            unit="점"
            min={0}
            max={100}
            step={5}
          />
          {compact ? (
            <details className="disc-fixed-details">
              <summary className="t-2">고정 규칙 {FIXED_RULES.length}개 보기</summary>
              <FixedRules />
            </details>
          ) : (
            <FixedRules />
          )}
        </Group>

        <Group title="분봉 확인" sub={<RuleTag rule="4.7·M3-18 강창권" />}>
          <div className="disc-radios" role="radiogroup" aria-label="분봉 확인 방식">
            {MINUTE_MODES.map((m) => (
              <label key={m.id} className="disc-radio">
                <input type="radio" name="disc-minute" checked={draft.minuteMode === m.id} onChange={() => set({ minuteMode: m.id })} />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
          <p className="t-cap">{mode.help} 모의 자동매매가 진입하기 직전에만 쓰고, 후보 목록에는 영향이 없어요.</p>
        </Group>
      </div>
    </div>
  );
}

function Group({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="disc-group" role="group" aria-labelledby={id}>
      <h3 id={id} className="disc-group-title">
        {title} {sub}
      </h3>
      {children}
    </div>
  );
}

/** 값 하나: 이름, 빠른 값 칩, 직접 입력 */
function ValueRow({ id, label, hint, value, onChange, chips, unit, min, max, step = 1 }: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  chips: { v: number; label: string }[];
  unit: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="disc-value">
      <div className="disc-value-top">
        <label className="disc-value-label" htmlFor={id}>
          <span className="t-medium">{label}</span>
          {hint && <span className="t-cap">{hint}</span>}
        </label>
        <span className="disc-input">
          <input
            id={id}
            className="ui-input num"
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(value) ? Number(value.toFixed(4)) : ""}
            onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          />
          <span className="unit">{unit}</span>
        </span>
      </div>
      <div className="disc-chips" role="group" aria-label={`${label} 빠른 값`}>
        {chips.map((c) => (
          <Chip key={c.v} pressed={Math.abs(value - c.v) < 1e-9} onClick={() => onChange(c.v)}>
            {c.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function FixedRules() {
  return (
    <div className="disc-fixed">
      <p className="t-cap row" style={{ gap: 4 }}>
        <Lock size={12} strokeWidth={1.5} aria-hidden="true" />
        고정 규칙 · 앱에 정해져 있어 바꿀 수 없어요
      </p>
      <dl className="disc-fixed-list">
        {FIXED_RULES.map((r) => (
          <div key={r.label} className="disc-kv">
            <dt className="t-2">{r.label}</dt>
            <dd className="num">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 조건 충족 0개(지도서 9.2): 가장 많이 걸러낸 조건과 완화 제안 */
function ZeroResult({ scan, draft, onFix }: { scan: ScanResult; draft: ScanDraft; onFix: (p: Partial<ScanDraft>) => void }) {
  const top = bindingRejection(scan.rejected, scan.scannedCount);
  if (!top) {
    return (
      <EmptyState title="모든 조건을 만족하는 종목이 없어요">
        {scan.universeCount === 0 ? "후보 목록을 받지 못했어요. 대상 시장과 서버 연결을 확인한 뒤 다시 스캔하세요." : "장중에 다시 스캔해 보세요."}
      </EmptyState>
    );
  }
  const a = rejectionAdvice(top.reason, draft);
  const others = Object.entries(scan.rejected).filter(([r]) => r !== top.reason).sort((x, y) => y[1] - x[1]).slice(0, 2);
  return (
    <div className="disc-zero">
      <p className="t-body">
        모든 조건을 만족하는 종목이 없어요. {top.stage === "analysis" ? `분석한 ${fmtInt(scan.scannedCount)}종목 중 ` : ""}가장 많이 걸러낸 조건은 <b>{a.condition}</b>
        <span className="num">({fmtInt(top.count)}종목)</span>이에요.
      </p>
      <p className="t-2">{a.text}</p>
      {others.length > 0 && <p className="t-cap">그다음으로 걸러낸 조건: {others.map(([r, n]) => `${r} ${fmtInt(n)}종목`).join(" · ")}</p>}
      {a.fix && (
        <div>
          <Button variant="secondary" onClick={() => onFix(a.fix!.patch)}>
            {a.fix.label}
          </Button>
        </div>
      )}
    </div>
  );
}

type SortKey = "score" | "changePct" | "volumeRatio" | "tradeValue" | "netRR";

/** D·E. 결과 표: 점수 막대, 열 머리로 정렬, 위쪽 10종목은 52주 추세선 */
function ResultTable({ list }: { list: DayTradeCandidate[] }) {
  const { openStock } = useApp();
  const { openEvidence } = useActions();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "score", desc: true });
  // 거래대금은 원과 달러를 섞어 비교할 수 없어 국내를 먼저 두고 같은 통화끼리 정렬한다
  const rows = useMemo(
    () =>
      [...list].sort((a, b) => {
        if (sort.key === "tradeValue" && regionOf(a.market) !== regionOf(b.market)) return regionOf(a.market) === "KR" ? -1 : 1;
        return (b[sort.key] - a[sort.key]) * (sort.desc ? 1 : -1);
      }),
    [list, sort],
  );
  const sparks = useSparks(useMemo(() => [...list].sort((a, b) => b.score - a.score).map((c) => c.code), [list]));
  const th = (key: SortKey, label: string) => (
    <th className="r" aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button type="button" className="ui-sort" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  return (
    <Section title="결과" sub={`${list.length}종목 · 행을 누르면 종목 분석`}>
      <div className="ui-table-wrap">
        <table className="ui-table disc-result-table">
          <thead>
            <tr>
              <th>종목</th>
              <th>근거</th>
              {th("score", "점수")}
              {th("changePct", "등락률")}
              {th("volumeRatio", "거래량")}
              {th("tradeValue", "거래대금")}
              {th("netRR", "손익비")}
              <th>52주 추세</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const ev = dayTradeEvidence(c);
              const region = regionOf(c.market);
              const sp = sparks[c.code];
              const spPct = sp && sp.length > 1 && sp[0]! > 0 ? (sp.at(-1)! / sp[0]! - 1) * 100 : null;
              return (
                <tr key={c.code} className="click" tabIndex={0} onClick={() => openStock(c.code)} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openStock(c.code)}>
                  <td>
                    <div className="stack" style={{ gap: 0 }}>
                      <span className="t-medium">{c.name}</span>
                      <span className="t-cap">
                        {c.code} · {MARKET_NAME[c.market]}
                      </span>
                    </div>
                  </td>
                  <td>
                    <EvidenceStrip evidence={ev} onOpen={() => openEvidence({ title: `${c.name} 근거`, evidence: ev, code: c.code, notes: c.notes })} />
                  </td>
                  <td className="r">
                    <ScoreBar value={c.score} />
                  </td>
                  <td className="r">
                    <div className="disc-cell2">
                      <Change pct={c.changePct} showAbs={false} />
                      <span className="t-cap num">{fmtPrice(c.price, region)}</span>
                    </div>
                  </td>
                  <td className="r num">{c.volumeRatio.toFixed(1)}배</td>
                  <td className="r num">{fmtBig(c.tradeValue, region)}</td>
                  <td className="r">
                    <div className="disc-cell2">
                      <span className="num">{c.netRR.toFixed(2)}</span>
                      <span className="t-cap num">손절 {fmtPct(-c.stopPct)}</span>
                    </div>
                  </td>
                  <td>
                    {sp ? (
                      <Sparkline values={sp} width={80} tone="muted" label={`52주 추세${spPct != null ? `, 52주 전 대비 ${fmtPct(spPct)}` : ""}`} />
                    ) : (
                      <span className="t-cap" aria-label="추세선 없음">
                        -
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="t-cap">등락률 아래는 현재가(목록이라 단위 생략), 손익비는 수수료·세금을 뺀 목표 수익 ÷ 손실, 그 아래는 진입가 대비 손절가까지의 거리예요. 추세선은 점수 위쪽 10종목만 그려요.</p>
    </Section>
  );
}

function ScreenerSkeleton() {
  return (
    <div className="disc-scr" aria-busy="true">
      <div className="disc-scr-main stack-4">
        <div className="row wrap">
          <Skeleton w={120} h={32} />
          <Skeleton w={140} h={32} />
          <Skeleton w={120} h={32} />
        </div>
        <Skeleton w={220} h={34} />
        <SkeletonRows rows={8} h={28} />
      </div>
    </div>
  );
}
