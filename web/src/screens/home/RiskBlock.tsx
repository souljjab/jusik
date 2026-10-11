import { ChevronRight } from "lucide-react";
import type { Currency, ServerState } from "@jusik/shared";
import { useApp } from "../../app/AppContext";
import { Link } from "../../app/router";
import { riskSummary, type CurrencyRisk, type RiskSummary } from "../../features/risk/riskSummary";
import { arrowOf, fmtPct, fmtPnlByCurrency, fmtRatio, Notice, RiskMeter, toneOf } from "../../ui";

const CUR_NAME: Record<Currency, string> = { KRW: "원화 계좌", USD: "달러 계좌" };

/** 손익 금액: 색 + 삼각형 + 부호 */
export function Pnl({ value, currency, className = "" }: { value: number | null | undefined; currency: Currency; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={`num flat ${className}`}>-</span>;
  const t = toneOf(value);
  return (
    <span className={`num ${t} ${className}`} aria-label={`${fmtPnlByCurrency(value, currency)}${t === "up" ? " 이익" : t === "down" ? " 손실" : ""}`}>
      <span aria-hidden="true">
        {arrowOf(value)} {fmtPnlByCurrency(value, currency)}
      </span>
    </span>
  );
}

function CurrencyMeters({ r, title }: { r: CurrencyRisk; title?: string }) {
  return (
    <div className="home-risk-cur">
      {title && <h3 className="home-sub">{title}</h3>}
      <RiskMeter label="주식 비중" value={r.weightPct} limit={r.capPct} format={(n) => fmtRatio(n)} limitLabel={`상한 ${fmtRatio(r.capPct)}`} />
      <RiskMeter
        label="오늘 손익"
        value={r.todayPct}
        limit={r.dailyLimitPct}
        format={fmtPct}
        limitLabel={r.dailyLimitPct != null ? `일일 한도 ${fmtPct(r.dailyLimitPct)}` : "일일 손실 한도 꺼짐"}
        nearText="한도 근접"
        overText="한도 도달"
      />
      {r.todayPnl != null ? (
        <p className="t-cap">
          오늘 손익 금액 <Pnl value={r.todayPnl} currency={r.currency} />
        </p>
      ) : (
        <p className="t-cap">오늘 장 기록이 아직 없어요.</p>
      )}
      {r.blocked && (
        <Notice tone="warn" title="신규 매수가 잠겼어요(모의 자동매매)">
          {r.blockReason} 다음 거래일에 풀려요.
        </Notice>
      )}
    </div>
  );
}

/** 손절가까지 2% 안쪽으로 다가온 보유 종목 */
function NearStopList({ rs }: { rs: RiskSummary }) {
  const { openStock } = useApp();
  const n = rs.nearStop.length;
  return (
    <div className="home-nearstop">
      <p className={`home-nearstop-head ${n ? "warn-text" : "t-2"}`}>{n ? `손절가 근접 ${n}종목` : "손절가 근접 종목 없음"}</p>
      {n > 0 && (
        <ul className="home-plain-list">
          {rs.nearStop.slice(0, 4).map((x) => (
            <li key={`${x.currency}-${x.position.code}`}>
              <button type="button" className="home-rowbtn" onClick={() => openStock(x.position.code)}>
                <span className="t-medium ellipsis">{x.position.name}</span>
                <span className="t-2 num">손절가까지 {fmtRatio(Math.max(0, x.leftPct))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 리스크 요약(지도서 5.1 E): 주식 비중과 상한, 오늘 손익과 일일 한도, 손절가 근접 종목.
 * 한도에 닿으면 미터가 경고색과 문장으로 바뀐다. 모의계좌 기준(앱은 실제 계좌를 모른다).
 */
export function RiskBlock({ server, currencies, headingId }: { server: ServerState; currencies: Currency[]; headingId?: string }) {
  const rs = riskSummary(server);
  return (
    <section className="home-risk" aria-labelledby={headingId}>
      <div className="home-block-head">
        <h2 id={headingId} className="t-section">
          리스크
        </h2>
        <Link to="/trade/limits" className="home-more">
          비중과 한도
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </div>
      {currencies.map((c) => (
        <CurrencyMeters key={c} r={rs[c]} title={currencies.length > 1 ? CUR_NAME[c] : undefined} />
      ))}
      <NearStopList rs={rs} />
      <p className="t-cap">
        모의계좌 기준이에요. 실제 증권 계좌와는 연결되어 있지 않아요.
        {!server.settings.paperEnabled && " 모의매매가 꺼져 있어 보유가 쌓이지 않아요."}
      </p>
    </section>
  );
}
