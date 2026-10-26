import { lazy, Suspense } from "react";
import { useApp } from "../../app/AppContext";
import { navigate, useRoute } from "../../app/router";
import { Button, EmptyState, ProgressLine, Skeleton, SkeletonRows, Tabs, useBreakpoint, useSlow } from "../../ui";
import { RecommendTab } from "./RecommendTab";
import { ScreenerTab } from "./ScreenerTab";
import "./discover.css";

/*
 * 발굴(지도서 2장·5.3·7.2): 추천 목록 /discover, 스크리너 /discover/screener, 전략과 백테스트 /discover/strategy?id=&code=.
 * 시장 전체 스캔은 서버가 단타 돌파 규칙(scoreDayTrade)으로만 돌린다. 책 전략은 종목 하나로 시험한다(전략과 백테스트).
 */

/** 전략과 백테스트는 차트 라이브러리를 쓰므로 그 탭을 열 때만 불러온다(핸드폰 첫 화면을 가볍게) */
const StrategyTab = lazy(() => import("./StrategyTab").then((m) => ({ default: m.StrategyTab })));

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
          <EmptyState title="스캔 결과를 받지 못했어요" action={<Button onClick={() => void refreshServer()}>다시 불러오기</Button>}>
            서버에 연결하지 못했어요. 앱 서버가 켜져 있는지 확인한 뒤 다시 불러오세요. 연결되면 후보와 스캔 조건이 여기에 나와요.
          </EmptyState>
        ) : tab === "screener" ? (
          <ScreenerTab />
        ) : tab === "strategy" ? (
          <Suspense fallback={<StrategySkeleton />}>
            <StrategyTab />
          </Suspense>
        ) : (
          <RecommendTab />
        )}
      </div>
    </div>
  );
}

function StrategySkeleton() {
  const slow = useSlow();
  return (
    <div className="stack-4" aria-busy="true">
      {slow && <ProgressLine text="전략과 백테스트 화면을 여는 중이에요" />}
      <div className="row wrap">
        <Skeleton w={120} h={32} />
        <Skeleton w={120} h={32} />
        <Skeleton w={120} h={32} />
      </div>
      <Skeleton w={200} h={20} />
      <SkeletonRows rows={3} />
      <Skeleton h={240} />
    </div>
  );
}
