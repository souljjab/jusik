import { AlertTriangle, ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  dayTradeEvidence, EXPOSURE_CAP_REASON, PAPER_STRATEGY, regionOfCode, type Currency, type Evidence, type Plan, type PlanItem, type ScanResult, type ServerState,
} from "@jusik/shared";
import { useActions } from "../../app/actions";
import { useApp } from "../../app/AppContext";
import { Link, navigate } from "../../app/router";
import type { OrderRequest } from "../../features/OrderReviewSheet";
import { guardOf, guardView } from "../../features/risk/riskSummary";
import {
  atLeast, Button, Disclaimer, EmptyState, EvidenceStrip, EvidenceStripFull, fmtInt, fmtMoneyByCurrency, fmtPct, fmtPrice, fmtRatio, MARKET_LABEL, Notice, NoteList,
  RiskMeter, RuleTag, Section, useBreakpoint, type Breakpoint,
} from "../../ui";
import { nextScanText } from "../discover/logic";
import { AccountTitle, asOfText, Loss, ScanButton } from "./parts";
import { accountBase, amountText, capHit, CUR_NAME, currenciesShown, distPct, payoffText, planCashBase, planKey, planRisk, reasonCounts, regionOfCur } from "./tradeModel";

/*
 * 오늘의 계획(지도서 2장 매매 = M3 신호 + M4 리스크).
 * 마지막 스캔이 통화별로 예수금(또는 모의계좌 현금)과 위험 한도 안에서 짠 매수 계획.
 *  - 항목마다 근거 스트립(단타 돌파 칸 순서 고정)과 '근거 보기', 진입·손절·목표, 수량·투자금·비중, 손절 시 손실
 *  - '매수 주문 검토'는 검토 시트만 연다(손절가 필수·위험 상자·규칙 체크는 시트가 맡는다). Ctrl/Cmd+Enter도 시트만 연다
 *  - 리스크 가드(서버가 지금 계산한 server.guards)로 잠겼으면 경고 문장과 풀리는 때만 보이고 검토 버튼을 없앤다
 *  - 컴퓨터·태블릿 가로: 목록 + 오른쪽 상세(위험 먼저, 버튼은 그 아래). 핸드폰·태블릿 세로: 목록 + 아래 고정 버튼
 */

type MinuteSkip = NonNullable<ScanResult["minuteSkips"]>[number];
const VERDICT_LABEL: Record<MinuteSkip["verdict"], string> = { buy: "매수 신호", wait: "대기", avoid: "피함" };

interface PlanEntry {
  cur: Currency;
  key: string;
  item: PlanItem;
  ev: Evidence;
  executed: boolean;
  minuteHeld: boolean;
  blocked: boolean;
  /** 잠긴 이유(리스크 가드의 '걸림' 문장) */
  blockReason: string | null;
  /** 언제 풀리는지(일일 손실 한도 '다음 거래일에 풀려요.', 연속 손실 휴식은 서버 문장) */
  releaseText: string | null;
  /** 손절 시 손실의 계좌 대비(%) — 모의매매를 켜면 모의계좌 총자산, 끄면 예수금 기준 */
  lossPct: number | null;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

function orderRequest(x: PlanEntry): OrderRequest {
  const c = x.item.candidate;
  return { code: c.code, name: c.name, side: "BUY", price: c.entry, stop: c.stop, target: c.target, strategy: PAPER_STRATEGY, reason: x.ev.headline, evidence: x.ev, qty: x.item.qty };
}

// ───────────────────────── 계획 행 ─────────────────────────

function PlanRow({ x, selected, onSelect, onKey }: { x: PlanEntry; selected: boolean; onSelect: () => void; onKey: (e: KeyboardEvent<HTMLButtonElement>) => void }) {
  const { openEvidence } = useActions();
  const { openStock } = useApp();
  const c = x.item.candidate;
  const region = regionOfCur(x.cur);
  return (
    <li className={`trd-plan-row ${selected ? "sel" : ""}`} onClick={onSelect}>
      <div className="trd-plan-line">
        <button type="button" className="trd-plan-name" data-plan-key={x.key} aria-pressed={selected} onClick={(e) => (e.stopPropagation(), onSelect())} onKeyDown={onKey}>
          <span className="t-bold ellipsis">{c.name}</span>
          <span className="t-cap">{c.code}</span>
        </button>
        <span className="row wrap trd-tags">
          {x.executed && <span className="trd-tag">모의 진입함</span>}
          {!x.executed && x.minuteHeld && (
            <span className="trd-tag is-warn" title="분봉 확인으로 이번 스캔에서는 모의 진입을 미뤘어요">
              분봉 보류
            </span>
          )}
        </span>
        <span className="trd-plan-loss">
          <span className="t-cap">손절 시</span> <Loss value={x.item.riskAmount} currency={x.cur} className="t-medium" />
        </span>
      </div>
      <div className="trd-plan-line">
        <EvidenceStrip evidence={x.ev} onOpen={() => openEvidence({ title: `${c.name} 근거`, evidence: x.ev, code: c.code, notes: c.notes })} />
        <span className="t-2 num nowrap">
          {fmtInt(x.item.qty)}주 · {amountText(x.item.amount, x.cur)} · {fmtRatio(x.item.weightPct)}
        </span>
      </div>
      <div className="trd-plan-line t-2">
        <span className="num trd-plan-px">
          진입 {fmtPrice(c.entry, region)} · 손절 {fmtPrice(c.stop, region)} <span className="t-cap">({fmtPct(distPct(c.entry, c.stop))})</span> · 목표 {fmtPrice(c.target, region)}{" "}
          <span className="t-cap">({fmtPct(distPct(c.entry, c.target))})</span>
        </span>
        <Button variant="link" className="trd-touchlink" onClick={(e) => (e.stopPropagation(), openStock(c.code))} aria-label={`${c.name} 종목 분석 열기`}>
          종목 분석 열기
        </Button>
      </div>
    </li>
  );
}

// ───────────────────────── 오른쪽 상세(위험 먼저, 버튼은 그 아래) ─────────────────────────

function PlanDetail({ x, server }: { x: PlanEntry | null; server: ServerState }) {
  const { openEvidence, openOrderReview } = useActions();
  const { openStock } = useApp();
  if (!x)
    return (
      <div className="trd-plan-detail">
        <EmptyState title="고른 계획이 없어요">
          <span className="t-2">왼쪽 목록에서 종목을 고르면 근거와 위험을 여기서 봐요.</span>
        </EmptyState>
      </div>
    );
  const c = x.item.candidate;
  const region = regionOfCur(x.cur);
  const cap = server.settings.maxWeightPct;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <section className="trd-plan-detail" aria-labelledby="trd-detail-h">
      <div className="stack" style={{ gap: 2 }}>
        <div className="row between wrap">
          <h3 id="trd-detail-h" className="t-section">
            {c.name}
          </h3>
          <Button variant="link" className="trd-touchlink" onClick={() => openStock(c.code)}>
            종목 분석 열기
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </div>
        <span className="t-2">
          {c.code} · {MARKET_LABEL[c.market] ?? c.market} · {x.ev.strategyName} · 점수 <span className="num">{c.score}</span>
        </span>
      </div>

      <div className="stack">
        <EvidenceStripFull evidence={x.ev} />
        <div className="row between wrap">
          <span className="t-2">{x.ev.headline}</span>
          <Button variant="link" onClick={() => openEvidence({ title: `${c.name} 근거`, evidence: x.ev, code: c.code, notes: c.notes })}>
            근거 보기
          </Button>
        </div>
      </div>

      <dl className="trd-kv trd-kv-plan">
        <div>
          <dt>진입가</dt>
          <dd className="num">{fmtPrice(c.entry, region, { unit: true })}</dd>
        </div>
        <div>
          <dt>손절가</dt>
          <dd className="num">
            {fmtPrice(c.stop, region, { unit: true })} <span className="t-cap">{fmtPct(distPct(c.entry, c.stop))}</span>
          </dd>
        </div>
        <div>
          <dt>목표가</dt>
          <dd className="num">
            {fmtPrice(c.target, region, { unit: true })} <span className="t-cap">{fmtPct(distPct(c.entry, c.target))}</span>
          </dd>
        </div>
        <div>
          <dt>수량</dt>
          <dd className="num">{fmtInt(x.item.qty)}주</dd>
        </div>
        <div>
          <dt>투자금</dt>
          <dd className="num">{fmtMoneyByCurrency(x.item.amount, x.cur)}</dd>
        </div>
        <div>
          <dt>최대 보유 · 순손익비</dt>
          <dd className="num">
            {c.maxHoldDays}거래일 · {payoffText(c.netRR)}
          </dd>
        </div>
      </dl>

      <div className="ui-panel flat stack-3" role="group" aria-label="위험 상자">
        <div className="row between base">
          <span className="t-2">손절 시 예상 손실</span>
          <span className="t-cap">계좌의 {fmtRatio(x.lossPct)}</span>
        </div>
        <Loss value={x.item.riskAmount} currency={x.cur} className="t-price" />
        <RiskMeter label="계획 비중" value={x.item.weightPct} limit={cap} format={(n) => fmtRatio(n)} limitLabel={`종목 비중 상한 ${fmtRatio(cap)}`} overText="상한 초과" />
      </div>

      {x.blocked ? (
        <Notice tone="warn" title="오늘은 신규 매수가 잠겼어요">
          {x.blockReason ?? "리스크 한도에 닿았어요."} {x.releaseText} 계획은 참고로만 보여요.
        </Notice>
      ) : (
        <div className="stack">
          <Button variant="buy" size="lg" block onClick={() => openOrderReview(orderRequest(x))} aria-keyshortcuts={mac ? "Meta+Enter" : "Control+Enter"}>
            매수 주문 검토
          </Button>
          <span className="t-cap">
            검토 시트에서 손절가와 수량을 다시 확인해요. 증권사에 주문을 보내지 않고 매매일지에 기록해요. 단축키 {mac ? "Cmd" : "Ctrl"} Enter도 시트만 열어요.
          </span>
        </div>
      )}
      {x.executed && <Notice>이 종목은 이번 스캔에서 모의계좌로 들어갔어요. 보유 탭에서 볼 수 있어요.</Notice>}
    </section>
  );
}

// ───────────────────────── 통화별 계획 ─────────────────────────

/**
 * 계획의 돈 흐름. 모두 계획을 세울 때의 값이다(계획 당시 현금 − 계획 투자 = 남는 현금).
 * 모의매매가 계획대로 산 뒤의 지금 현금은 보유 탭에 있다(한 줄에 지금 값과 계획 값을 섞지 않는다).
 */
function CashLine({ server, cur, plan }: { server: ServerState; cur: Currency; plan: Plan }) {
  const base = planCashBase(server, cur, plan);
  return (
    <dl className="trd-cash">
      <div>
        <dt>{base.label}</dt>
        <dd>
          <span className="num">{fmtMoneyByCurrency(base.cash, cur)}</span>
          {base.snapshot && <span className="t-cap">{server.settings.paperEnabled ? "모의계좌" : "예수금"} 기준</span>}
        </dd>
      </div>
      <div>
        <dt>쓸 수 있는 돈</dt>
        <dd>
          <span className="num">{fmtMoneyByCurrency(plan.spendable, cur)}</span>
          <span className="t-cap">예비 현금·국면 상한 반영</span>
        </dd>
      </div>
      <div>
        <dt>계획 투자</dt>
        <dd className="num">{fmtMoneyByCurrency(plan.used, cur)}</dd>
      </div>
      <div>
        <dt>남는 현금</dt>
        <dd className="num">{fmtMoneyByCurrency(plan.remainingCash, cur)}</dd>
      </div>
      <div>
        <dt>손절 시 손실 합계</dt>
        <dd>
          <Loss value={planRisk(plan)} currency={cur} />
        </dd>
      </div>
    </dl>
  );
}

/** 리스크 가드: 서버가 지금 설정·오늘 날짜로 계산한 값(server.guards). 잠금 까닭과 풀리는 때는 서버 노트에서 */
function GuardBlock({ server, cur }: { server: ServerState; cur: Currency }) {
  const g = guardView(guardOf(server, cur));
  if (!g.checked) return <p className="t-cap">리스크 가드는 다음 스캔부터 점검해요.</p>;
  if (g.blocked)
    return (
      <Notice
        tone="warn"
        title="오늘은 신규 매수가 잠겼어요"
        action={
          <Link to="/trade/limits" className="trd-link nowrap">
            비중과 한도
          </Link>
        }
      >
        <span>
          {g.blockReason} {g.releaseText} 아래 계획은 참고로만 보여요.
        </span>
        {g.notes.length > 0 && <NoteList notes={g.notes} dense />}
      </Notice>
    );
  if (g.notes.length)
    return (
      <div className="stack" style={{ gap: 4 }}>
        <span className="t-2 t-medium">리스크 가드 메모</span>
        <NoteList notes={g.notes} dense />
      </div>
    );
  return null;
}

function Skipped({ plan, cap, paperEnabled, openInitially }: { plan: Plan; cap: number | undefined; paperEnabled: boolean; openInitially: boolean }) {
  const { openStock } = useApp();
  const { openEvidence } = useActions();
  const [open, setOpen] = useState(openInitially);
  if (!plan.skipped.length) return null;
  const counts = reasonCounts(plan);
  const id = `trd-skip-${plan.skipped[0]!.candidate.code}`;
  return (
    <div className="trd-skipped stack">
      <p className="t-2">
        <span className="t-medium">제외 사유</span> {counts.map(([r, n]) => `${r} ${n}개`).join(" · ")}
      </p>
      {capHit(plan) && (
        <Notice tone="warn">
          {paperEnabled ? "모의계좌 보유 평가액을 포함한 주식 비중이" : "예수금 대비 신규 매수액이"} 지금 국면의 상한{cap != null ? `(${fmtRatio(cap)})` : ""}에 닿아 더 사지 않았어요. 상한은 설정의 국면별 주식 비중 상한에서
          바꿀 수 있어요. <RuleTag rule="2.5 강동진" />
        </Notice>
      )}
      <Button variant="link" className="trd-touchlink" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        제외된 후보 {plan.skipped.length}개 {open ? "접기" : "보기"}
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" className={open ? "trd-rot" : ""} />
      </Button>
      {open && (
        <ul id={id} className="trd-skip-list ev">
          {plan.skipped.map((x) => {
            const capped = x.reason === EXPOSURE_CAP_REASON;
            const ev = dayTradeEvidence(x.candidate);
            return (
              <li key={x.candidate.code}>
                <button type="button" className="trd-skip-name" onClick={() => openStock(x.candidate.code)}>
                  <span className="t-medium">{x.candidate.name}</span> <span className="t-cap">{x.candidate.code}</span>
                </button>
                <EvidenceStrip evidence={ev} onOpen={() => openEvidence({ title: `${x.candidate.name} 근거`, evidence: ev, code: x.candidate.code, notes: x.candidate.notes })} />
                <span className={`t-2 ${capped ? "warn-text" : ""}`}>
                  {capped && <AlertTriangle size={12} strokeWidth={1.5} aria-hidden="true" className="trd-inline-ico" />}
                  {x.reason}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 분봉 확인(4.7·M3-18)으로 모의 자동매매 진입을 미룬 종목 */
function MinuteSkips({ list }: { list: MinuteSkip[] }) {
  const { openStock } = useApp();
  if (!list.length) return null;
  return (
    <div className="trd-minute stack">
      <h4 className="trd-h4">
        분봉 확인으로 진입 보류 <span className="t-cap">{list.length}종목</span> <RuleTag rule="4.7·M3-18 강창권" />
      </h4>
      <p className="t-cap">계획에는 들었지만 모의 자동매매가 1분봉을 보고 이번 스캔에서는 들어가지 않은 종목이에요. 다음 스캔에서 다시 확인해요. 확인 방식은 설정에서 바꿀 수 있어요.</p>
      <ul className="trd-skip-list">
        {list.map((x, i) => (
          <li key={`${x.code}-${i}`}>
            <button type="button" className="trd-skip-name" onClick={() => openStock(x.code)}>
              <span className="t-medium">{x.name}</span> <span className="t-cap">{x.code}</span>
            </button>
            <span className={`t-2 ${x.verdict === "avoid" ? "warn-text" : ""}`}>
              {x.verdict === "avoid" && <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" className="trd-inline-ico" />}
              <span className="t-medium">{VERDICT_LABEL[x.verdict] ?? x.verdict}</span> {x.reason || "사유 없음"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CurrencyPlan({ cur, server, entries, selKey, onSelect, onKey }: {
  cur: Currency;
  server: ServerState;
  entries: PlanEntry[];
  selKey: string | null;
  onSelect: (k: string) => void;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, k: string) => void;
}) {
  const scan = server.latestScan!;
  const plan = scan.plans[cur];
  const minute = (scan.minuteSkips ?? []).filter((x) => regionOfCode(x.code) === regionOfCur(cur));
  const hid = `trd-plan-${cur}`;
  return (
    <section className="trd-plan-cur stack-3" aria-labelledby={hid}>
      <AccountTitle currency={cur} asOf={scan.at} id={hid} />
      {!plan ? (
        <p className="t-2">이번 스캔에 {CUR_NAME[cur]} 시장이 없어요. 설정에서 스캔할 시장을 고를 수 있어요.</p>
      ) : (
        <>
          <CashLine server={server} cur={cur} plan={plan} />
          <GuardBlock server={server} cur={cur} />
          {entries.length === 0 ? (
            <EmptyState
              title="지금 한도 안에서 살 만한 종목이 없어요"
              action={
                <Button variant="secondary" className="trd-touch-btn" onClick={() => navigate("/discover")}>
                  후보 모두 보기
                </Button>
              }
            >
              <span className="t-2">{plan.skipped.length ? `후보 ${plan.skipped.length}개는 아래 사유로 제외했어요.` : "다음 스캔에서 다시 찾아요."}</span>
            </EmptyState>
          ) : (
            <ul className="trd-plan-list" aria-label={`${CUR_NAME[cur]} 매수 계획 ${entries.length}종목`}>
              {entries.map((x) => (
                <PlanRow key={x.key} x={x} selected={x.key === selKey} onSelect={() => onSelect(x.key)} onKey={(e) => onKey(e, x.key)} />
              ))}
            </ul>
          )}
          <Skipped plan={plan} cap={scan.exposureCaps?.[cur]} paperEnabled={server.settings.paperEnabled} openInitially={entries.length === 0} />
        </>
      )}
      <MinuteSkips list={minute} />
    </section>
  );
}

// ───────────────────────── 핸드폰·태블릿 세로: 아래 고정 버튼 ─────────────────────────

function ActionBar({ x, bp }: { x: PlanEntry; bp: Breakpoint }) {
  const { openOrderReview } = useActions();
  return (
    <div className={`trd-actionbar is-${bp}`} role="region" aria-label="고른 계획">
      <div className="trd-actionbar-info">
        <span className="t-medium ellipsis">
          {x.item.candidate.name} · <span className="num">{fmtInt(x.item.qty)}주</span>
        </span>
        <span className="t-cap">
          손절 시 <Loss value={x.item.riskAmount} currency={x.cur} /> · 계좌의 {fmtRatio(x.lossPct)}
        </span>
      </div>
      {x.blocked ? (
        <span className="trd-actionbar-lock">
          <Lock size={16} strokeWidth={1.5} aria-hidden="true" />
          신규 매수 잠김
        </span>
      ) : (
        <Button variant="buy" size="lg" onClick={() => openOrderReview(orderRequest(x))}>
          매수 주문 검토
        </Button>
      )}
    </div>
  );
}

// ───────────────────────── 탭 ─────────────────────────

function NoScan() {
  return (
    <EmptyState title="아직 스캔 기록이 없어요" action={<ScanButton variant="primary" size="md" />}>
      <span className="t-2">스캔하면 예수금과 위험 한도 안에서 살 수 있는 계획이 여기에 나와요. 장이 열린 동안에는 정해진 간격으로 자동 스캔해요.</span>
    </EmptyState>
  );
}

export function planEntries(server: ServerState): PlanEntry[] {
  const scan = server.latestScan;
  if (!scan) return [];
  const executed = new Set(scan.executed ?? []);
  const held = new Set((scan.minuteSkips ?? []).map((x) => x.code));
  return currenciesShown(server).flatMap((cur) => {
    const plan = scan.plans[cur];
    if (!plan) return [];
    const base = accountBase(server, cur);
    // 잠금은 서버가 지금 계산한 가드(마지막 스캔의 가드가 아니다)
    const { blocked, blockReason, releaseText } = guardView(guardOf(server, cur));
    return plan.items.map((item) => ({
      cur, key: planKey(cur, item.candidate.code), item, ev: dayTradeEvidence(item.candidate), executed: executed.has(item.candidate.code),
      minuteHeld: held.has(item.candidate.code), blocked, blockReason, releaseText, lossPct: base > 0 ? (item.riskAmount / base) * 100 : null,
    }));
  });
}

export function PlanTab({ server }: { server: ServerState }) {
  const { now } = useApp();
  const { openOrderReview } = useActions();
  const bp = useBreakpoint();
  const scan = server.latestScan;
  const entries = useMemo(() => planEntries(server), [server]);
  const [selKey, setSelKey] = useState<string | null>(null);
  const fallback = entries.find((x) => !x.executed && !x.blocked) ?? entries[0] ?? null;
  const selected = entries.find((x) => x.key === selKey) ?? fallback;
  const split = atLeast(bp, "expanded");

  // Ctrl/Cmd+Enter: 고른 계획의 주문 검토 시트만 연다(바로 기록하지 않는다)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter" || isTyping(e.target) || document.querySelector(".ui-sheet")) return;
      if (!selected || selected.blocked) return;
      e.preventDefault();
      openOrderReview(orderRequest(selected));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, openOrderReview]);

  if (!scan)
    return (
      <Section title="오늘의 계획" as="h2">
        <NoScan />
      </Section>
    );

  const currencies = currenciesShown(server);
  const total = scan.candidates.length;

  /** ↑↓로 계획 사이를 옮긴다(고른 종목도 함께 바뀐다) */
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = entries.findIndex((x) => x.key === key);
    const n = entries[(i + (e.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length];
    if (!n) return;
    setSelKey(n.key);
    document.querySelector<HTMLElement>(`[data-plan-key="${CSS.escape(n.key)}"]`)?.focus();
  };

  const list = (
    <div className="stack-5">
      {currencies.map((cur) => (
        <CurrencyPlan key={cur} cur={cur} server={server} entries={entries.filter((x) => x.cur === cur)} selKey={selected?.key ?? null} onSelect={setSelKey} onKey={onKey} />
      ))}
      <div className="stack" style={{ gap: "var(--space-2)" }}>
        <p className="t-cap trd-caveat">
          모의매매는 실제 주문이 아니라 규칙을 시험하는 가상 체결이에요(수수료·세금·슬리피지 반영). 단타 규칙은 경험칙이고 수익이 검증되지 않았어요. 모의매매 결과가 충분히
          쌓이기 전에는 실제 자금으로 따라 하지 마세요.
        </p>
        <Disclaimer />
      </div>
    </div>
  );

  return (
    <div className="trd-plan">
      <div className="trd-plan-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="t-section">오늘의 계획</h2>
          <span className="t-cap">
            마지막 스캔 <span className="num">{asOfText(scan.at, now)}</span> · 후보 <span className="num">{fmtInt(total)}</span>종목 중 <span className="num">{fmtInt(entries.length)}</span>종목 계획 ·{" "}
            {nextScanText(server.status.scheduler, server.settings)}
          </span>
        </div>
        <ScanButton />
      </div>
      <p className="t-2 trd-lead">
        점수 순으로 예수금과 위험 한도 안에서 살 수 있는 조합이에요.{" "}
        {server.settings.paperEnabled ? "모의매매가 켜져 있어 서버가 이 계획대로 모의로 들어가요." : "모의매매가 꺼져 있어 예수금 기준으로만 계산했어요."} 실제 주문은 증권사 앱에서 내요.
      </p>
      {server.status.scheduler.lastError && (
        <Notice tone="warn" title="최근 스캔에 오류가 있었어요">
          {server.status.scheduler.lastError} 다음 스캔에서 다시 시도해요. 계속되면 서버 기록을 확인하세요.
        </Notice>
      )}
      {scan.errors.length > 0 && (
        <Notice tone="warn" title={`일부 시장·종목을 읽지 못했어요(${scan.errors.length}건)`}>
          {scan.errors[0]} 다음 스캔에서 다시 읽어요.
        </Notice>
      )}

      {split && entries.length > 0 ? (
        <div className={`trd-plan-grid is-${bp}`}>
          <div className="trd-plan-listcol">{list}</div>
          <div className="trd-plan-detailcol">
            <PlanDetail x={selected} server={server} />
          </div>
        </div>
      ) : (
        // 계획이 하나도 없으면 오른쪽 상세 칸을 두지 않는다(고를 것이 없다). 통화마다 까닭과 다음 행동이 목록에 있다
        <>
          {list}
          {!split && selected && <ActionBar x={selected} bp={bp} />}
        </>
      )}
    </div>
  );
}
