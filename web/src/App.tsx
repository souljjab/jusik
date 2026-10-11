import { lazy, Suspense, useEffect } from "react";
import { ActionsProvider } from "./app/actions";
import { AppProvider } from "./app/AppContext";
import { applyPrefs, setPrefs, usePrefs } from "./app/prefs";
import { areaOf, useRoute } from "./app/router";
import { Shell } from "./shell/Shell";
import { SkeletonRows, ToastProvider } from "./ui";

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

function Screen() {
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
