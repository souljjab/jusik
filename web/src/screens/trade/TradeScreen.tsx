import { AlertTriangle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useApp } from "../../app/AppContext";
import { navigate, useRoute } from "../../app/router";
import { riskSummary } from "../../features/risk/riskSummary";
import { Button, Notice, Skeleton, SkeletonRows, Tabs, useBreakpoint } from "../../ui";
import { HoldingsTab, nearStopCount } from "./HoldingsTab";
import { LimitsTab } from "./LimitsTab";
import { planEntries, PlanTab } from "./PlanTab";
import { currenciesShown } from "./tradeModel";
import "./trade.css";

/*
 * 매매(UI 지도서 2장: M3 신호 + M4 리스크 — 주문 검토, 보유 종목, 비중과 손실 한도).
 *  /trade          보유(모의계좌 자동 · 내 기록 직접)
 *  /trade/limits   비중과 손실 한도
 *  /trade/plan     오늘의 계획
 * 탭을 바꿔도 기록을 남기지 않는다(navigate replace). 주문은 어디서나 '주문 검토' 시트로만 연다.
 */

type TabId = "holdings" | "limits" | "plan";
const PATH: Record<TabId, string> = { holdings: "/trade", limits: "/trade/limits", plan: "/trade/plan" };

function tabOf(seg: string | undefined): TabId {
  return seg === "limits" ? "limits" : seg === "plan" ? "plan" : "holdings";
}

function LoadingShape() {
  return (
    <div className="stack-5" role="status" aria-label="불러오는 중">
      <div className="stack-3">
        <Skeleton w={140} h={18} />
        <Skeleton w={220} h={34} />
        <div className="trd-skel-kv">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={36} />
          ))}
        </div>
      </div>
      <SkeletonRows rows={5} h={22} />
    </div>
  );
}

export default function TradeScreen() {
  const { server, offline, refreshServer, now } = useApp();
  const route = useRoute();
  const bp = useBreakpoint();
  const tab = tabOf(route.segments[1]);
  const [retrying, setRetrying] = useState(false);

  // 탭 이름 옆 상태(색에만 기대지 않게 숫자·아이콘과 함께)
  const planCount = server ? planEntries(server).length : 0;
  const rs = server ? riskSummary(server) : null;
  const locked = !!server && !!rs && currenciesShown(server).some((c) => rs[c].blocked);
  const near = server ? nearStopCount(server, now) : 0;
  const items = [
    {
      value: "holdings" as const,
      label: (
        <span className="trd-tablbl">
          보유
          {near > 0 && (
            <>
              <span className="trd-tabmark is-warn" aria-hidden="true">
                <AlertTriangle size={12} strokeWidth={1.5} />
                {near}
              </span>
              <span className="sr-only">, 손절가 근접 {near}종목</span>
            </>
          )}
        </span>
      ),
    },
    {
      value: "limits" as const,
      label: (
        <span className="trd-tablbl">
          비중·한도
          {locked && (
            <>
              <span className="trd-tabmark is-warn" aria-hidden="true">
                <AlertTriangle size={12} strokeWidth={1.5} />
                잠김
              </span>
              <span className="sr-only">, 신규 매수 잠김</span>
            </>
          )}
        </span>
      ),
    },
    {
      value: "plan" as const,
      label: (
        <span className="trd-tablbl">
          오늘의 계획
          {planCount > 0 && (
            <>
              <span className="trd-tabmark" aria-hidden="true">
                {planCount}
              </span>
              <span className="sr-only">, {planCount}종목</span>
            </>
          )}
        </span>
      ),
    },
  ];

  let body;
  if (!server) {
    body = offline ? (
      <Notice
        tone="warn"
        title="보유 종목과 한도를 불러오지 못했어요"
        action={
          <Button
            variant="secondary"
            className="trd-touch-btn"
            busy={retrying}
            icon={<RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />}
            onClick={async () => {
              setRetrying(true);
              try {
                await refreshServer();
              } finally {
                setRetrying(false);
              }
            }}
          >
            다시 연결
          </Button>
        }
      >
        서버와 다시 연결되면 자동으로 받아요. 바로 다시 시도하려면 '다시 연결'을 누르세요.
      </Notice>
    ) : (
      <LoadingShape />
    );
  } else if (tab === "limits") body = <LimitsTab server={server} />;
  else if (tab === "plan") body = <PlanTab server={server} />;
  else body = <HoldingsTab server={server} />;

  return (
    <div className={`trd is-${bp}`}>
      <div className="trd-head">
        <h1 className={bp === "compact" ? "sr-only" : "t-title"}>매매</h1>
        {bp !== "compact" && <p className="t-2">보유 종목과 한도를 확인하고, 오늘의 계획에서 주문을 검토해요. 이 앱은 증권사에 주문을 내지 않아요.</p>}
      </div>
      <Tabs idBase="trd" label="매매 화면" value={tab} items={items} onChange={(v) => navigate(PATH[v], { replace: true })} className="trd-tabs" />
      <div id={`trd-${tab}`} role="tabpanel" aria-labelledby={`trd-tab-${tab}`} className="trd-panel">
        {body}
      </div>
    </div>
  );
}
