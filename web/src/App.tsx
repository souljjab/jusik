import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from "react";
import { ActionsProvider } from "./app/actions";
import { AppProvider } from "./app/AppContext";
import { applyPrefs, setPrefs, usePrefs } from "./app/prefs";
import { areaOf, useRoute } from "./app/router";
import { Shell } from "./shell/Shell";
import { Button, Notice, SkeletonRows, ToastProvider } from "./ui";

/*
 * 화면 구성(UI 지도서 2장): 홈·발굴·종목·매매·기록 다섯 영역 + 알림·설정.
 * 화면은 필요할 때 불러온다(핸드폰 첫 화면을 가볍게).
 */
const HomeScreen = lazy(() => import("./screens/home/HomeScreen"));
const DiscoverScreen = lazy(() => import("./screens/discover/DiscoverScreen"));
const StocksScreen = lazy(() => import("./screens/stocks/StocksScreen"));
const TradeScreen = lazy(() => import("./screens/trade/TradeScreen"));
const RecordsScreen = lazy(() => import("./screens/records/RecordsScreen"));
const AlertsScreen = lazy(() => import("./screens/alerts/AlertsScreen"));
const SettingsScreen = lazy(() => import("./screens/settings/SettingsScreen"));
const Onboarding = lazy(() => import("./screens/onboarding/Onboarding"));

/**
 * 한 화면이 그리다 오류가 나도 앱 전체(상단 바·메뉴)가 비지 않게 막는다. 경로가 바뀌면(key) 다시 그려 본다.
 */
class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("화면 오류", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Notice tone="warn" title="이 화면을 표시하지 못했어요" action={<Button onClick={() => location.reload()}>다시 불러오기</Button>}>
        메뉴에서 다른 화면으로 이동하거나 다시 불러오세요. 같은 문제가 계속되면 주소를 확인해 주세요.
      </Notice>
    );
  }
}

function Screen() {
  const route = useRoute();
  return (
    <ScreenBoundary key={route.path}>
      <AreaScreen />
    </ScreenBoundary>
  );
}

function AreaScreen() {
  const route = useRoute();
  switch (areaOf(route)) {
    case "discover":
      return <DiscoverScreen />;
    case "stocks":
      return <StocksScreen />;
    case "trade":
      return <TradeScreen />;
    case "records":
      return <RecordsScreen />;
    case "alerts":
      return <AlertsScreen />;
    case "settings":
      return <SettingsScreen />;
    default:
      return <HomeScreen />;
  }
}

export default function App() {
  const prefs = usePrefs();
  useEffect(() => {
    applyPrefs(prefs);
    // 기기 테마가 바뀌면 브라우저 테마 색도 맞춘다
    if (typeof matchMedia !== "function") return;
    const q = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyPrefs();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [prefs]);

  return (
    <ToastProvider>
      <AppProvider>
        <ActionsProvider>
          <Shell>
            <Suspense fallback={<SkeletonRows rows={6} />}>
              <Screen />
            </Suspense>
          </Shell>
          {!prefs.onboarded && (
            <Suspense fallback={null}>
              <Onboarding onDone={() => setPrefs({ onboarded: true })} />
            </Suspense>
          )}
        </ActionsProvider>
      </AppProvider>
    </ToastProvider>
  );
}
