import { CheckCircle2, ChevronRight, Lock } from "lucide-react";
import { useMemo } from "react";
import { currencyOfRegion, POSTURE_LABEL, regionOf, type Currency, type Market, type ScanResult, type ServerState } from "@jusik/shared";
import { useApp } from "../../app/AppContext";
import { Link, navigate } from "../../app/router";
import { riskSummary, type CurrencyRisk } from "../../features/risk/riskSummary";
import { Button, fmtInt, fmtMoneyByCurrency, fmtPct, fmtRatio, fmtTime, Notice, NoteList, RiskMeter, RuleTag, Section, useBreakpoint } from "../../ui";
import { AccountTitle, Pnl, StopDistance } from "./parts";
import { accountView, currenciesShown, manualLossStreak, paperLossStreak, regionOfCur, ruleLines, todayOf } from "./tradeModel";

/*
 * 비중과 손실 한도(지도서 2장 M4, 5.1 E 리스크 요약, 8장 리스크 미터, 9.3 과매매를 막는 장치).
 *  - 통화별 리스크 미터: 주식 비중 vs 국면 상한, 오늘 손익 vs 일일 손실 한도, 연속 손실 vs 휴식 기준
 *  - 잠금 상태: 한도에 닿으면 신규 매수를 잠그고 다음 거래일에 풀어요(모의 자동매매와 주문 검토 시트에 함께 적용)
 *  - 3회 연속 손실이면 '오늘은 기록만 하기' 제안
 *  - 지금 적용 중인 규칙 요약(한도는 설정에서 바꾼다)
 */

const MARKET_NAME: Record<Market, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "미국" };

/** 국면 상한이 어디서 왔는지 한 문장 */
function capNote(scan: ScanResult | null, cur: Currency, cap: number): string {
  if (!scan?.exposureCaps?.[cur]) return `스캔 기록이 없어 중립 상한(${fmtRatio(cap)})을 적용했어요.`;
  const mine = scan.markets.filter((m) => currencyOfRegion(regionOf(m)) === cur);
  const parts = mine.map((m) => {
    const p = scan.postures?.[m];
    return p ? `${MARKET_NAME[m]} ${POSTURE_LABEL[p.posture]}` : `${MARKET_NAME[m]} 판정 불가`;
  });
  const src = parts.length > 1 ? `${parts.join("·")} 중 낮은 쪽` : parts[0] ?? "중립";
  return `마지막 스캔(${fmtTime(scan.at)})의 국면 기준이에요(${src}).`;
}

function LockState({ r, hasGuard, paperOff }: { r: CurrencyRisk; hasGuard: boolean; paperOff: boolean }) {
  if (r.blocked)
    return (
      <div className="trd-lock is-warn" role="status">
        <p className="trd-lock-title">
          <Lock size={20} strokeWidth={1.75} aria-hidden="true" />
          신규 매수 잠김
        </p>
        <p className="t-2">
          {r.blockReason} 다음 거래일에 풀려요. 잠긴 동안에는 모의 자동매매가 들어가지 않고, 주문 검토의 '매수 확인'도 꺼져요.
          {paperOff ? " (모의매매가 꺼져 있어 참고용이에요)" : ""}
        </p>
      </div>
    );
  return (
    <div className="trd-lock is-ok" role="status">
      <p className="trd-lock-title">
        <CheckCircle2 size={20} strokeWidth={1.5} aria-hidden="true" />
        신규 매수 가능
      </p>
      <p className="t-2">{hasGuard ? "일일 손실 한도와 연속 손실 휴식에 걸리지 않았어요." : "아직 스캔 전이라 리스크 가드 점검 기록이 없어요. 다음 스캔부터 점검해요."}</p>
    </div>
  );
}

function CurrencyLimits({ r, server, streak, manualStreak }: { r: CurrencyRisk; server: ServerState; streak: number; manualStreak: number }) {
  const { serverAt, now, openStock } = useApp();
  const s = server.settings;
  const scan = server.latestScan;
  const guard = scan?.guards?.[r.currency];
  const max = s.maxConsecutiveLosses;
  const view = accountView(server.paper[r.currency], r.currency, todayOf(regionOfCur(r.currency), now));
  const region = regionOfCur(r.currency);
  // 서버 노트 중 잠금 사유(bad)는 위 상태 문장에 이미 썼으니 나머지만
  const notes = (guard?.notes ?? []).filter((n) => !(r.blocked && n.tone === "bad" && n.text === r.blockReason));
  return (
    <div className="trd-limit">
      <AccountTitle currency={r.currency} asOf={serverAt} />
      <LockState r={r} hasGuard={!!guard} paperOff={!s.paperEnabled} />

      <div className="trd-meters">
        <div className="stack" style={{ gap: 4 }}>
          <RiskMeter label="주식 비중" value={r.weightPct} limit={r.capPct} format={(n) => fmtRatio(n)} limitLabel={`국면 상한 ${fmtRatio(r.capPct)}`} overText="상한 초과" />
          <span className="t-cap">{capNote(scan, r.currency, r.capPct)} 상한에 닿으면 오늘의 계획에서 더 사지 않아요.</span>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <RiskMeter
            label="오늘 손익"
            value={r.todayPct}
            limit={r.dailyLimitPct}
            format={fmtPct}
            limitLabel={r.dailyLimitPct != null ? `일일 손실 한도 ${fmtPct(r.dailyLimitPct)}` : "일일 손실 한도 꺼짐"}
            nearText="한도 근접"
            overText="한도 도달"
          />
          <span className="t-cap">
            {r.todayPnl != null ? (
              <>
                하루 시작 자산 대비 · 금액 <Pnl value={r.todayPnl} currency={r.currency} />.
              </>
            ) : (
              "오늘 장 기록이 아직 없어요."
            )}{" "}
            한도에 닿으면 신규 매수를 잠그고 다음 거래일에 풀어요.
          </span>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <RiskMeter
            label="연속 손실(모의)"
            value={max > 0 ? streak : null}
            limit={max > 0 ? max : null}
            format={(n) => `${fmtInt(n)}회`}
            limitLabel={max > 0 ? `휴식 기준 ${max}회` : "연속 손실 휴식 꺼짐"}
            nearText={streak >= max ? "휴식 기준 도달" : "휴식 기준 근접"}
            overText="휴식 기준 넘음"
          />
          <span className="t-cap">{max > 0 ? `${max}번 연속 손실이면 그날과 다음 거래일까지 신규 매수를 쉬어요.` : "설정에서 연속 손실 휴식을 켤 수 있어요."}</span>
        </div>
      </div>

      {notes.length > 0 && (
        <div className="stack">
          <h4 className="trd-h4">리스크 가드 메모</h4>
          <NoteList notes={notes} dense />
        </div>
      )}

      {max > 0 && streak >= max && (
        <Notice tone="warn" title="오늘은 기록만 하기를 권해요" action={<Button size="sm" variant="secondary" onClick={() => navigate("/records")}>매매일지 쓰기</Button>}>
          모의 자동매매가 최근 {streak}번 연속 손실이에요. 새로 사기보다 기록과 복기로 규칙을 점검해요. 다시 시작할 때는 규모를 줄여요.
        </Notice>
      )}
      {max > 0 && manualStreak >= max && (
        <Notice tone="warn" title="오늘은 기록만 하기를 권해요" action={<Button size="sm" variant="secondary" onClick={() => navigate("/records/review")}>복기 보기</Button>}>
          직접 기록한 매매가 최근 {manualStreak}번 연속 손실이에요. 오늘은 새로 사지 말고 기록과 복기만 해 보세요.
        </Notice>
      )}

      {view.positions.length > 0 && (
        <div className="stack">
          <h4 className="trd-h4">종목 비중 <span className="t-cap">상한 {fmtRatio(s.maxWeightPct)}</span></h4>
          <ul className="trd-weights">
            {view.positions.map((x) => (
              <li key={x.position.code} className="trd-weight">
                <RiskMeter label={x.position.name} value={x.weightPct} limit={s.maxWeightPct} format={(n) => fmtRatio(n)} limitLabel={`상한 ${fmtRatio(s.maxWeightPct)}`} overText="상한 초과" />
                <span className="row between">
                  <StopDistance leftPct={x.leftToStopPct} />
                  <Button variant="link" className="trd-touchlink" onClick={() => openStock(x.position.code)} aria-label={`${x.position.name} 종목 상세 보기`}>
                    종목 보기
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <span className="t-cap">
            보유 평가 <span className="num">{fmtMoneyByCurrency(view.heldValue, r.currency)}</span> · 총자산 <span className="num">{fmtMoneyByCurrency(view.equity, r.currency)}</span>
            {region === "US" ? " · 달러 계좌" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function Rules({ server }: { server: ServerState }) {
  const s = server.settings;
  const lines = ruleLines(s, (n, c) => fmtMoneyByCurrency(n, c));
  return (
    <Section
      title="지금 적용 중인 규칙"
      as="h2"
      actions={
        <Link to="/settings" className="trd-more">
          설정에서 바꾸기
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      }
    >
      <dl className="trd-rules">
        {lines.map((l) => (
          <div key={l.label}>
            <dt>
              {l.label}
              {l.hint && <span className="t-cap">{l.hint}</span>}
            </dt>
            <dd className="num">{l.value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="trd-h3">한도에 닿으면</h3>
      <ul className="trd-howto">
        <li>
          일일 손실 한도: 오늘 손실이 하루 시작 자산의 {s.dailyLossLimitPct > 0 ? fmtRatio(s.dailyLossLimitPct) : "한도"}에 닿으면 신규 매수를 잠그고 다음 거래일에 풀어요. <RuleTag rule="M4-04 슈웨거" />
        </li>
        <li>
          연속 손실 휴식: {s.maxConsecutiveLosses > 0 ? `${s.maxConsecutiveLosses}번` : "정한 횟수만큼"} 연속 손실이면 그날과 다음 거래일까지 쉬고, '오늘은 기록만 하기'를 권해요. <RuleTag rule="5.5 박용선·슈웨거" />
        </li>
        <li>
          종목 비중 상한: 주문 검토에서 상한을 넘으면 '매수 확인'이 꺼지고 수량을 줄여 제안해요. <RuleTag rule="M4-03 강영현" />
        </li>
        <li>
          국면별 주식 비중 상한: 상한에 닿으면 오늘의 계획에서 더 사지 않아요. <RuleTag rule="2.5 강동진" />
        </li>
        <li>
          손절가 필수와 계획 외 추가 매수: 손절가가 없으면 확인할 수 없고, 손실 중인 종목을 더 살 때는 계획이었는지 먼저 물어요. <RuleTag rule="M4-02 캔들마스터" />
        </li>
      </ul>
      <p className="t-cap">잠금은 모의 자동매매와 주문 검토 시트에 함께 적용돼요. 이 앱은 증권사에 주문을 내지 않아요.</p>
    </Section>
  );
}

export function LimitsTab({ server }: { server: ServerState }) {
  const { journal } = useApp();
  const bp = useBreakpoint();
  const rs = riskSummary(server);
  const currencies = currenciesShown(server);
  const streaks = useMemo(
    () => Object.fromEntries(currencies.map((c) => [c, { paper: paperLossStreak(journal, regionOfCur(c)), manual: manualLossStreak(journal, regionOfCur(c)) }])) as Record<Currency, { paper: number; manual: number }>,
    [journal, currencies.join(",")], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const large = bp === "large";
  return (
    <div className={`trd-split ${large ? "large" : ""}`}>
      <div className="trd-split-main">
        <Section title="비중과 손실 한도" as="h2" sub="모의계좌 기준">
          <p className="t-2 trd-lead">앱은 실제 증권 계좌를 몰라요. 모의계좌의 비중과 손익으로 한도를 점검하고, 같은 잠금을 주문 검토 시트에도 적용해요.</p>
          <div className={`trd-accts cols n${currencies.length}`}>
            {currencies.map((c) => (
              <CurrencyLimits key={c} r={rs[c]} server={server} streak={streaks[c]?.paper ?? 0} manualStreak={streaks[c]?.manual ?? 0} />
            ))}
          </div>
        </Section>
        {!large && <Rules server={server} />}
      </div>
      {large && (
        <aside className="trd-split-side" aria-label="적용 중인 규칙">
          <Rules server={server} />
        </aside>
      )}
    </div>
  );
}
