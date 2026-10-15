import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans-kr/korean-400.css";
import "@fontsource/ibm-plex-sans-kr/korean-500.css";
import "@fontsource/ibm-plex-sans-kr/korean-700.css";
import "@fontsource/ibm-plex-sans-kr/latin-400.css";
import "@fontsource/ibm-plex-sans-kr/latin-500.css";
import "@fontsource/ibm-plex-sans-kr/latin-700.css";
import App from "./App";
import { applyPrefs } from "./app/prefs";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";

// 첫 그림 전에 테마·색 관례를 반영해 깜빡임을 막는다
applyPrefs();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
