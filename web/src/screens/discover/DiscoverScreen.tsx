import { useApp } from "../../app/AppContext";
import { navigate, useRoute } from "../../app/router";
import { Button, EmptyState, Tabs, useBreakpoint } from "../../ui";
import { RecommendTab } from "./RecommendTab";
import { ScreenerTab } from "./ScreenerTab";
import { StrategyTab } from "./StrategyTab";
import "./discover.css";

/*
 * 발굴(지도서 2장·5.3·7.2): 추천 목록 /discover, 스크리너 /discover/screener, 전략과 백테스트 /discover/strategy?id=&code=.
 * 시장 전체 스캔은 서버가 단타 돌파 규칙(scoreDayTrade)으로만 돌린다. 책 전략은 종목 하나로 시험한다(전략과 백테스트).
 */

type Tab = "recommend" | "screener" | "strategy";
const PATH: Record<Tab, string> = { recommend: "/discover", screener: "/discover/screener", strategy: "/discover/strategy" };

export default function DiscoverScreen() {
  const route = useRoute();
  const bp = useBreakpoint();
  const { offline, server, refreshServer } = useApp();
  const seg = route.segments[1];
  const tab: Tab = seg === "screener" ? "screener" : seg === "strategy" ? "strategy" : "recommend";
  const compact = bp === "compact";

  return (
    <div className="disc">
      {compact ? (
        <h1 className="sr-only">발굴</h1>
      ) : (
        <header className="screen-head disc-head">
          <h1>발굴</h1>
        </header>
      )}
      <Tabs
        className="disc-tabs"
        label="발굴 화면"
        idBase="disc"
        value={tab}
        onChange={(v) => navigate(PATH[v], { replace: true })}
        items={[
          { value: "recommend", label: "추천" },
          { value: "screener", label: "스크리너" },
          { value: "strategy", label: compact ? "전략" : "전략과 백테스트" },
        ]}
      />
      <div className="disc-panel" role="tabpanel" id={`disc-${tab}`} aria-labelledby={`disc-tab-${tab}`}>
        {offline && !server && tab !== "strategy" ? (
          <EmptyState title="스캔 결과를 받지 못했어요" action={<Button onClick={() => void refreshServer()}>다시 연결</Button>}>
            서버에 연결되면 후보와 스캔 조건이 여기에 나와요. 전략과 백테스트도 서버에서 시세를 받아야 돌릴 수 있어요.
          </EmptyState>
        ) : tab === "screener" ? (
          <ScreenerTab />
        ) : tab === "strategy" ? (
          <StrategyTab />
        ) : (
          <RecommendTab />
        )}
      </div>
    </div>
  );
}
