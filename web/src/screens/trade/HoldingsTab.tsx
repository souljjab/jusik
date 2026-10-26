import { AlertTriangle, CheckCircle2, ChevronRight, MoreHorizontal } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { DEFAULT_PAPER_TRACKING, type Currency, type Region, type ServerState } from "@jusik/shared";
import { useActions } from "../../app/actions";
import { useApp } from "../../app/AppContext";
import { Link, navigate } from "../../app/router";
import {
  atLeast, Button, Change, EmptyState, fmtDate, fmtInt, fmtMoneyByCurrency, fmtPct, fmtPrice, fmtRatio, fmtWhen, IconButton, MarketStatus, Notice, NoteList, RuleTag, Section,
  Sheet, srQuote, useBreakpoint, type Breakpoint,
} from "../../ui";
import { AccountTitle, Pnl, Progress, REGION_NAME, StopDistance, type ManualBook, type QuoteInfo } from "./parts";
import {
  accountView, buyMoreRequest, CUR_NAME, currenciesShown, holdingPnl, NEAR_STOP_PCT, paperAsOf, regionOfCur, sellRequest, todayOf, type AccountView, type ManualHolding, type PositionView,
} from "./tradeModel";

/*
 * 보유(지도서 2장 매매 · 부록 A '보유 종목과 리스크').
 *  - 모의계좌(자동): 서버가 규칙대로 모의로 사고판 종목. 통화별 계좌 요약과 보유 표(핸드폰은 목록 행)
 *  - 내 기록(직접): 매매일지에 직접 쓴 매수·매도로 계산한 보유. '매도 주문 검토'로 매도 기록을 남긴다
 * 이 앱은 증권사에 주문을 내지 않는다(검토 시트에서 확인하면 매매일지에 기록만 한다).
 */

const isCtrlEnter = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.key === "Enter";

// ───────────────────────── 계좌 요약 ─────────────────────────

function AccountSummary({ v, today, big }: { v: AccountView; today: { pnl: number; pct: number } | null; big: boolean }) {
  const c = v.currency;
  return (
    <div className="trd-acct-sum">
      <div className="trd-acct-main">
        <span className="t-2">총자산(평가 포함)</span>
        <span className={`${big ? "t-price" : "trd-big"} num`}>{fmtMoneyByCurrency(v.equity, c)}</span>
        {today ? (
          <span className="row wrap t-2" style={{ gap: 6 }}>
            오늘 <Change pct={today.pct} showAbs={false} /> <Pnl value={today.pnl} currency={c} />
          </span>
        ) : (
          <span className="t-cap">오늘 장 기록이 아직 없어요</span>
        )}
      </div>
      <dl className="trd-kv">
        <div>
          <dt>현금</dt>
          <dd className="num">{fmtMoneyByCurrency(v.cash, c)}</dd>
        </div>
        <div>
          <dt>평가 손익</dt>
          <dd>
            <Pnl value={v.positions.length ? v.unrealized : 0} currency={c} />
          </dd>
        </div>
        <div>
          <dt>실현 손익</dt>
          <dd>
            <Pnl value={v.realized} currency={c} />
            <span className="t-cap">수수료·세금 반영</span>
          </dd>
        </div>
        <div>
          <dt>청산 · 이익</dt>
          <dd>
            <span className="num">
              {fmtInt(v.closed)}건 · {fmtInt(v.wins)}건
            </span>
            {v.winRate != null && <span className="t-cap num">승률 {fmtRatio(v.winRate * 100, 0)}</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ───────────────────────── 모의 보유 표·행 ─────────────────────────

function HoldText({ p }: { p: PositionView }) {
  const max = p.position.maxHoldDays;
  const due = p.heldDays >= max;
  return (
    <span className="stack" style={{ gap: 0 }}>
      <span className="num">{fmtDate(p.position.entryDate)} 진입</span>
      <span className={`t-cap num ${due ? "trd-strong" : ""}`}>
        {p.heldDays}/{max}거래일{due ? " · 기한 도달" : ""}
      </span>
    </span>
  );
}

function PositionsTable({ v }: { v: AccountView }) {
  const { openStock } = useApp();
  const region = regionOfCur(v.currency);
  return (
    <div className="ui-table-wrap tall">
      <table className="ui-table trd-table">
        <caption className="sr-only">{CUR_NAME[v.currency]} 모의계좌 보유 종목. 행을 누르면 종목 분석을 열어요</caption>
        <thead>
          <tr>
            <th>종목</th>
            <th className="r">수량</th>
            <th className="r">진입가</th>
            <th className="r">현재가</th>
            <th className="r">평가 손익</th>
            <th className="r">손절가</th>
            <th className="r">목표가</th>
            <th>보유 기간</th>
          </tr>
        </thead>
        <tbody>
          {v.positions.map((x) => {
            const p = x.position;
            return (
              <tr key={p.code} className={`click ${x.nearStop ? "trd-warnrow" : ""}`} tabIndex={0} onClick={() => openStock(p.code)} onKeyDown={(e) => e.key === "Enter" && !isCtrlEnter(e) && openStock(p.code)}>
                <td>
                  <span className="trd-namecell">
                    <span className="t-medium" title={p.name}>
                      {p.name}
                    </span>
                    <span className="t-cap">{p.code}</span>
                  </span>
                </td>
                <td className="r num">
                  {fmtInt(p.qty)}
                  <span className="unit">주</span>
                </td>
                <td className="r num">{fmtPrice(p.entryPrice, region)}</td>
                <td className="r num">{fmtPrice(x.last, region)}</td>
                <td className="r">
                  <span className="trd-cell-stack">
                    <Pnl value={x.pnl} currency={v.currency} />
                    <Change pct={x.pnlPct} showAbs={false} className="t-cap" />
                  </span>
                </td>
                <td className="r">
                  <span className="trd-cell-stack">
                    <span className="num">{fmtPrice(p.stop, region)}</span>
                    <StopDistance leftPct={x.leftToStopPct} />
                  </span>
                </td>
                <td className="r">
                  <span className="trd-cell-stack">
                    <span className="num">{fmtPrice(p.target, region)}</span>
                    <span className="t-cap num">{x.toTargetPct != null ? `목표까지 ${fmtPct(x.toTargetPct)}` : ""}</span>
                  </span>
                </td>
                <td>
                  <HoldText p={x} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PositionRows({ v }: { v: AccountView }) {
  const { openStock } = useApp();
  const region = regionOfCur(v.currency);
  return (
    <ul className="ui-rows trd-rows" aria-label={`${CUR_NAME[v.currency]} 모의계좌 보유 종목`}>
      {v.positions.map((x) => {
        const p = x.position;
        return (
          <li key={p.code}>
            <button type="button" className="trd-row" onClick={() => openStock(p.code)}>
              <span className="sr-only">
                {srQuote(p.name, x.last, null, region)}, {p.qty}주, 평가 손익 {fmtPct(x.pnlPct)}
              </span>
              <span className="trd-row-line" aria-hidden="true">
                <span className="t-bold ellipsis">{p.name}</span>
                <Pnl value={x.pnl} currency={v.currency} className="t-medium" />
              </span>
              <span className="trd-row-line t-2" aria-hidden="true">
                <span className="num ellipsis">
                  {fmtInt(p.qty)}주 · {fmtPrice(p.entryPrice, region)} → {fmtPrice(x.last, region)}
                </span>
                <Change pct={x.pnlPct} showAbs={false} />
              </span>
              <span className="trd-row-line t-cap">
                <span className="row" style={{ gap: 6, minWidth: 0 }}>
                  <StopDistance leftPct={x.leftToStopPct} />
                  <span className="num">손절 {fmtPrice(p.stop, region)} · 목표 {fmtPrice(p.target, region)}</span>
                </span>
                <span className="num nowrap">
                  {x.heldDays}/{p.maxHoldDays}거래일
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PaperAccountBlock({ v, today, big, bp, asOf }: { v: AccountView; today: { pnl: number; pct: number } | null; big: boolean; bp: Breakpoint; asOf: string | null }) {
  const near = v.positions.filter((x) => x.nearStop).length;
  return (
    <div className="trd-acct">
      <AccountTitle currency={v.currency} asOf={asOf} />
      <AccountSummary v={v} today={today} big={big} />
      {v.positions.length === 0 ? (
        // 모든 계좌가 비었으면 아래에 빈 화면 안내를 한 번만 둔다
        <p className="t-2">보유 중인 모의 종목이 없어요.</p>
      ) : (
        <>
          <p className="t-2">
            {v.positions.length}종목 보유 · 보유 평가 <span className="num">{fmtMoneyByCurrency(v.heldValue, v.currency)}</span>
            {near > 0 && (
              <span className="warn-text">
                {" "}
                · <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" className="trd-inline-ico" />
                손절가 근접 {near}종목
              </span>
            )}
          </p>
          {atLeast(bp, "expanded") ? <PositionsTable v={v} /> : <PositionRows v={v} />}
        </>
      )}
    </div>
  );
}

// ───────────────────────── 내 기록(직접) ─────────────────────────

interface HoldingRow {
  h: ManualHolding;
  q: QuoteInfo | undefined;
  r: ReturnType<typeof holdingPnl>;
}

function HoldingMenu({ row, onClose }: { row: HoldingRow | null; onClose: () => void }) {
  const { openStock } = useApp();
  const { openOrderReview } = useActions();
  const bp = useBreakpoint();
  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const h = row?.h;
  return (
    <Sheet open={!!row} onClose={onClose} title={h ? `${h.name} 동작` : ""} side={bp === "compact" ? "bottom" : "center"}>
      {h && (
        <ul className="trd-menu" aria-label={`${h.name} 동작`}>
          <li>
            <button type="button" className="trd-menu-item" onClick={go(() => openStock(h.code))}>
              종목 분석 열기
            </button>
          </li>
          <li>
            <button type="button" className="trd-menu-item" onClick={go(() => openOrderReview(sellRequest(row!)))}>
              매도 주문 검토
              <span className="t-cap">보유 {fmtInt(h.qty)}주 · 확인하면 매매일지에 매도를 기록해요</span>
            </button>
          </li>
          <li>
            <button type="button" className="trd-menu-item" onClick={go(() => openOrderReview(buyMoreRequest(row!)))}>
              추가 매수 주문 검토
              <span className="t-cap">손실 중인 종목이면 처음부터 계획한 분할 매수였는지 물어요</span>
            </button>
          </li>
          <li>
            <button type="button" className="trd-menu-item" onClick={go(() => navigate("/records"))}>
              매매일지 열기
            </button>
          </li>
        </ul>
      )}
    </Sheet>
  );
}

function ManualTable({ rows, onMenu, bp }: { rows: HoldingRow[]; onMenu: (r: HoldingRow) => void; bp: Breakpoint }) {
  const { openStock } = useApp();
  const { openOrderReview } = useActions();
  // 태블릿은 손가락으로 누르니 버튼을 터치 크기로(컴퓨터는 표 밀도를 지키려고 작게)
  const small = bp === "large";
  return (
    <div className="ui-table-wrap tall">
      <table className="ui-table trd-table">
        <caption className="sr-only">직접 기록한 보유 종목. Ctrl+Enter(맥은 Cmd+Enter)로 매도 주문 검토를 열어요</caption>
        <thead>
          <tr>
            <th>종목</th>
            <th className="r">수량</th>
            <th className="r">평균 단가</th>
            <th className="r">현재가</th>
            <th className="r">평가 손익</th>
            <th className="r">손절가</th>
            <th>첫 매수</th>
            <th className="r">
              <span className="sr-only">동작</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { h, q, r } = row;
            const near = r.leftToStopPct != null && r.leftToStopPct <= NEAR_STOP_PCT;
            return (
              <tr
                key={h.code}
                className={`click ${near ? "trd-warnrow" : ""}`}
                tabIndex={0}
                onClick={() => openStock(h.code)}
                onKeyDown={(e) => {
                  if (isCtrlEnter(e)) (e.preventDefault(), openOrderReview(sellRequest(row)));
                  else if (e.key === "Enter" && e.target === e.currentTarget) openStock(h.code);
                }}
              >
                <td>
                  <span className="trd-namecell">
                    <span className="t-medium" title={h.name}>
                      {h.name}
                    </span>
                    <span className="t-cap" title={h.strategy ? `${h.code} · ${h.strategy}` : undefined}>
                      {h.code}
                      {h.strategy ? ` · ${h.strategy}` : ""}
                    </span>
                  </span>
                </td>
                <td className="r num">
                  {fmtInt(h.qty)}
                  <span className="unit">주</span>
                </td>
                <td className="r num">{fmtPrice(h.avgPrice, h.region)}</td>
                <td className="r">
                  <span className="trd-cell-stack">
                    <span className="num">{fmtPrice(q?.price, h.region)}</span>
                    {q?.changePct != null && <Change pct={q.changePct} showAbs={false} className="t-cap" />}
                  </span>
                </td>
                <td className="r">
                  <span className="trd-cell-stack">
                    <Pnl value={r.pnl} currency={h.currency} />
                    {r.pct != null && <Change pct={r.pct} showAbs={false} className="t-cap" />}
                  </span>
                </td>
                <td className="r">
                  {h.stop ? (
                    <span className="trd-cell-stack">
                      <span className="num">{fmtPrice(h.stop, h.region)}</span>
                      {r.leftToStopPct != null && <StopDistance leftPct={r.leftToStopPct} />}
                    </span>
                  ) : (
                    <span className="t-cap">기록 없음</span>
                  )}
                </td>
                <td className="num">{fmtDate(h.since)}</td>
                <td className="r">
                  <span className="row end" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <Button size={small ? "sm" : "md"} variant="secondary" className={small ? "" : "trd-touch-btn"} onClick={() => openOrderReview(sellRequest(row))}>
                      매도 주문 검토
                    </Button>
                    <IconButton size={small ? "sm" : "md"} label={`${h.name} 더 보기`} onClick={() => onMenu(row)}>
                      <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden="true" />
                    </IconButton>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ManualRows({ rows, onMenu }: { rows: HoldingRow[]; onMenu: (r: HoldingRow) => void }) {
  const { openStock } = useApp();
  const { openOrderReview } = useActions();
  return (
    <ul className="ui-rows trd-rows" aria-label="직접 기록한 보유 종목">
      {rows.map((row) => {
        const { h, q, r } = row;
        return (
          <li key={h.code}>
            <button type="button" className="trd-row" onClick={() => openStock(h.code)}>
              <span className="sr-only">
                {q ? srQuote(h.name, q.price, q.changePct, h.region) : h.name}, {h.qty}주, 평균 단가 {fmtPrice(h.avgPrice, h.region)}
                {r.pct != null ? `, 평가 손익 ${fmtPct(r.pct)}` : ""}
              </span>
              <span className="trd-row-line" aria-hidden="true">
                <span className="t-bold ellipsis">{h.name}</span>
                <Pnl value={r.pnl} currency={h.currency} className="t-medium" />
              </span>
              <span className="trd-row-line t-2" aria-hidden="true">
                <span className="num ellipsis">
                  {fmtInt(h.qty)}주 · 평균 {fmtPrice(h.avgPrice, h.region)} → {fmtPrice(q?.price, h.region)}
                </span>
                {r.pct != null && <Change pct={r.pct} showAbs={false} />}
              </span>
              <span className="trd-row-line t-cap">
                {h.stop ? <StopDistance leftPct={r.leftToStopPct} /> : <span>손절가 기록 없음</span>}
                <span className="num nowrap">{fmtDate(h.since)} 첫 매수</span>
              </span>
            </button>
            <div className="trd-row-actions">
              <Button variant="secondary" className="trd-touch-btn" onClick={() => openOrderReview(sellRequest(row))}>
                매도 주문 검토
              </Button>
              <IconButton label={`${h.name} 더 보기`} onClick={() => onMenu(row)}>
                <MoreHorizontal size={20} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ManualSection({ bp, book }: { bp: Breakpoint; book: ManualBook }) {
  const { journal, now } = useApp();
  const { holdings, oversold, quotes, at, failed } = book;
  const [menu, setMenu] = useState<HoldingRow | null>(null);
  const rows: HoldingRow[] = holdings.map((h) => ({ h, q: quotes[h.code], r: holdingPnl(h, quotes[h.code]?.price) }));
  const oversoldNames = oversold.map((c) => journal.find((e) => e.code === c)?.name ?? c);
  const regions = [...new Set(holdings.map((h) => h.region))].sort() as Region[];
  return (
    <Section title="내 기록(직접)" sub={holdings.length ? `${holdings.length}종목` : undefined}>
      <p className="t-2 trd-lead">
        매매일지에 직접 쓴 매수·매도로 계산한 보유예요. 이 앱은 증권사에 주문을 내지 않아요. 실제 주문은 증권사 앱에서 내고, 여기서 매도 주문을 검토해 확인하면 매매일지에
        기록돼요.
      </p>
      {oversold.length > 0 && (
        <Notice tone="warn" title="보유보다 많이 판 기록이 있어요" action={<Link to="/records" className="trd-link">매매일지 열기</Link>}>
          {oversoldNames.join(", ")}의 매도 수량이 매수보다 많아요. 매매일지에서 수량을 확인해 주세요.
        </Notice>
      )}
      {holdings.length > 0 && (
        <div className="row wrap trd-status-row">
          {/* 시세 자료에 시각이 없어 받은 시각을 '받음'으로 적는다(데이터 기준 시각처럼 쓰지 않는다) */}
          {regions.map((r) => (
            <MarketStatus key={r} region={r} now={now} receivedAt={at} />
          ))}
          {at && <span className="t-cap">현재가 {fmtWhen(at, now)} 받음 · 1분마다 다시 받아요</span>}
        </div>
      )}
      {failed && holdings.length > 0 && <Notice tone="warn">현재가를 받지 못했어요. 평가 손익은 비워 두고 1분 뒤에 다시 받아요. 계속되면 서버 연결을 확인하세요.</Notice>}
      {holdings.length === 0 ? (
        <EmptyState
          title="직접 기록한 보유 종목이 없어요"
          action={
            <Button variant="secondary" className="trd-touch-btn" onClick={() => navigate("/records")}>
              매매일지 열기
            </Button>
          }
        >
          <span className="t-2">증권사에서 산 종목을 매매일지에 기록하면 여기서 평균 단가와 손익을 볼 수 있어요.</span>
        </EmptyState>
      ) : !atLeast(bp, "expanded") ? (
        <ManualRows rows={rows} onMenu={setMenu} />
      ) : (
        <ManualTable rows={rows} onMenu={setMenu} bp={bp} />
      )}
      <HoldingMenu row={menu} onClose={() => setMenu(null)} />
    </Section>
  );
}

// ───────────────────────── 모의투자 기간·계좌 관리 ─────────────────────────

/** 모의투자 기간 추적(M5-02 캔들마스터): 기간·청산 건수·기대값 */
function PaperTracking({ server, currencies, side }: { server: ServerState; currencies: Currency[]; side: boolean }) {
  const regions = currencies.map(regionOfCur);
  const rows = regions.flatMap((r) => (server.paperTracking?.[r] ? [{ r, t: server.paperTracking[r] }] : []));
  return (
    <Section title="모의투자 기간" as="h2" sub={<RuleTag rule="M5-02 캔들마스터" />}>
      <p className="t-2">실전 전에 최소 3개월은 모의투자로 연습하길 권해요. 자동 모의매매 기록만 세고, 거래당 기대값은 청산 거래의 평균 순수익률이에요.</p>
      {rows.length === 0 ? (
        <p className="t-2">서버가 아직 모의투자 기간을 계산하지 않았어요.</p>
      ) : (
        <div className={`trd-tracks ${side ? "" : "cols"}`}>
          {rows.map(({ r, t }) => (
            <div key={r} className="trd-track">
              <div className="row between wrap">
                <span className="t-medium">{REGION_NAME[r]}</span>
                <span className="t-cap">{t.startedAt ? `첫 기록 ${fmtDate(t.startedAt)}` : "아직 기록 없음"}</span>
              </div>
              {t.ready && (
                <span className="trd-ready">
                  <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden="true" />
                  기간과 청산 건수를 채웠어요. 소액 실전을 검토할 수 있어요
                </span>
              )}
              <Progress label="모의투자 기간" value={t.days} max={DEFAULT_PAPER_TRACKING.minDays} unit="일" />
              <Progress label="청산 거래" value={t.closedTrades} max={DEFAULT_PAPER_TRACKING.minClosedTrades} unit="건" />
              <div className="row between t-2">
                <span>거래당 기대값</span>
                {t.expectancyPct == null ? <span className="t-cap">청산 거래가 없어 아직 몰라요</span> : <Change pct={t.expectancyPct} showAbs={false} />}
              </div>
              <div className="t-2">
                <NoteList notes={[t.note]} dense />
              </div>
            </div>
          ))}
        </div>
      )}
      {!server.settings.paperEnabled && <p className="t-cap">모의매매 자동 실행이 꺼져 있어 기록이 늘지 않아요.</p>}
    </Section>
  );
}

/** 모의계좌 초기화·기록 내보내기는 설정에서 한곳으로 관리한다(같은 동작을 두 곳에 두지 않는다) */
function AccountLinks() {
  return (
    <Section title="계좌·기록 관리" as="h2">
      <ul className="ui-rows">
        <li>
          <Link to="/settings/paper" className="ui-rowbtn">
            <span className="grow">모의계좌 초기화·자동 실행</span>
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link to="/settings/data" className="ui-rowbtn">
            <span className="grow">기록 내보내기(엑셀·구글 시트)</span>
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </li>
      </ul>
    </Section>
  );
}

// ───────────────────────── 탭 ─────────────────────────

export function HoldingsTab({ server, book }: { server: ServerState; book: ManualBook }) {
  const { now } = useApp();
  const bp = useBreakpoint();
  const currencies = currenciesShown(server);
  const views = currencies.map((c) => accountView(server.paper[c], c, todayOf(regionOfCur(c), now)));
  const large = bp === "large";
  const paperOff = !server.settings.paperEnabled;
  const allEmpty = views.every((v) => v.positions.length === 0);
  const side = (
    <>
      <PaperTracking server={server} currencies={currencies} side={large} />
      <AccountLinks />
    </>
  );
  return (
    <div className={`trd-split ${large ? "large" : ""}`}>
      <div className="trd-split-main">
        <Section title="모의계좌(자동)" as="h2" sub={paperOff ? "자동 실행 꺼짐" : undefined}>
          <p className="t-2 trd-lead">서버가 규칙대로 모의로 사고판 종목이에요. 손절가·목표가·보유 기한에 닿으면 자동으로 청산해요. 실제 증권 계좌와는 연결되어 있지 않아요.</p>
          {paperOff && !allEmpty && (
            <Notice tone="info" action={<Link to="/settings/paper" className="trd-link">설정 열기</Link>}>
              모의매매 자동 실행이 꺼져 있어요. 지금 보유는 그대로 관리하고, 새로 들어가지는 않아요. 설정에서 켤 수 있어요.
            </Notice>
          )}
          <div className={`trd-accts n${views.length}`}>
            {views.map((v) => {
              const t = server.todayPnl?.[v.currency];
              return <PaperAccountBlock key={v.currency} v={v} today={t ? { pnl: t.pnl, pct: t.pct } : null} big={views.length === 1} bp={bp} asOf={paperAsOf(server, v.currency)} />;
            })}
          </div>
          {allEmpty && (
            <EmptyState
              title="보유 중인 모의 종목이 없어요"
              action={
                paperOff ? (
                  <Button variant="secondary" className="trd-touch-btn" onClick={() => navigate("/settings/paper")}>
                    설정에서 모의매매 켜기
                  </Button>
                ) : (
                  <Button variant="secondary" className="trd-touch-btn" onClick={() => navigate("/trade/plan", { replace: true })}>
                    오늘의 계획 보기
                  </Button>
                )
              }
            >
              <span className="t-2">
                {paperOff
                  ? "모의매매 자동 실행이 꺼져 있어요. 켜면 장이 열린 동안 서버가 오늘의 계획대로 모의로 사고팔아요."
                  : "장이 열린 동안 서버가 오늘의 계획대로 모의로 들어가요. 계획에서 무엇을 살지 미리 볼 수 있어요."}
              </span>
            </EmptyState>
          )}
        </Section>
        <ManualSection bp={bp} book={book} />
        {!large && side}
      </div>
      {large && <aside className="trd-split-side" aria-label="모의계좌 보조 정보">{side}</aside>}
    </div>
  );
}

/** 이 탭의 손절가 근접 종목 수(탭 이름 옆 표시) */
export function nearStopCount(server: ServerState, now: Date): number {
  return currenciesShown(server).reduce(
    (n, c) => n + accountView(server.paper[c], c, todayOf(regionOfCur(c), now)).positions.filter((x) => x.nearStop).length,
    0,
  );
}

