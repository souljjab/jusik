import { ChevronRight } from "lucide-react";
import { ALERT_CATEGORY_LABEL, type AlertItem } from "@jusik/shared";
import { href, Link } from "../../app/router";
import { EmptyState, fmtWhen } from "../../ui";

/**
 * 알림(지도서 5.1 G): 범주(신호·리스크·공시·국면)를 글자 색으로 구분하고 카드 대신 구분선으로 나열한다.
 * 리스크 알림은 왼쪽 경고색 막대. 누르면 알림이 가리키는 화면으로 간다.
 */
export function AlertsBlock({ alerts, now, limit = 6, headingId }: { alerts: AlertItem[]; now: Date; limit?: number; headingId?: string }) {
  const list = alerts.slice(0, limit);
  return (
    <section className="home-alerts" aria-labelledby={headingId}>
      <div className="home-block-head">
        <h2 id={headingId} className="t-section">
          알림
        </h2>
        <Link to="/alerts" className="home-more">
          모두 보기
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </div>
      {list.length === 0 ? (
        <EmptyState title="아직 알림이 없어요" action={<Link to="/alerts" className="ui-btn secondary sm home-linkbtn">알림 설정 보기</Link>}>
          <span className="t-2">스캔과 보유 점검에서 신호·리스크·공시·국면 알림이 생기면 여기에 쌓여요.</span>
        </EmptyState>
      ) : (
        <ul className="home-alert-list">
          {list.map((a) => {
            const body = (
              <>
                <span className="home-alert-meta">
                  <span className={`cat ${a.category}`}>{ALERT_CATEGORY_LABEL[a.category]}</span>
                  <time className="t-cap num" dateTime={a.at}>
                    {fmtWhen(a.at, now)}
                  </time>
                </span>
                <span className="home-alert-text">{a.text}</span>
              </>
            );
            return (
              <li key={a.id} className={`home-alert ${a.category === "risk" ? "risk" : ""}`}>
                {a.route ? (
                  <a className="home-alert-link" href={href(a.route)}>
                    {body}
                  </a>
                ) : (
                  <div className="home-alert-link static">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
