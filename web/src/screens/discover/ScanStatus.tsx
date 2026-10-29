import type { ReactNode } from "react";
import { regionOf, type Market, type Region } from "@jusik/shared";
import { useApp } from "../../app/AppContext";
import { MarketStatus, Notice } from "../../ui";
import { lastScanText, nextScanText, scanErrorText } from "./logic";

/**
 * 스캔 상태 줄: 마지막 스캔 기준 시각, 다음 스캔, 켠 시장의 장 상태(지도서 9.1 — 상태를 숨기지 않는다).
 * action에는 '지금 스캔' 버튼을 넣는다(핸드폰에서는 화면 아래 고정 막대로 옮기므로 비운다).
 */
export function ScanStatus({ scanning, error, action }: { scanning: boolean; error: string | null; action?: ReactNode }) {
  const { server, now } = useApp();
  if (!server) return null;
  const sch = server.status.scheduler;
  const s = server.settings;
  const scan = server.latestScan;
  const regions = [...new Set((Object.keys(s.markets) as Market[]).filter((m) => s.markets[m]).map(regionOf))] as Region[];
  // 다시 스캔하는 동안에는 지난 시도의 오류를 띄우지 않는다(끝나면 결과를 알림으로 알린다)
  const lastError = scanning ? null : sch.lastError;
  return (
    <div className="disc-status" aria-live="polite">
      <div className="disc-status-text">
        <span className="t-medium">{scanning ? "스캔 중이에요. 끝나면 목록이 바뀌어요" : lastScanText(sch.lastScanAt ?? scan?.at, now)}</span>
        <span className="t-2">{nextScanText(sch, s)}</span>
        <span className="disc-status-markets">
          {(regions.length ? regions : (["KR"] as Region[])).map((r) => (
            <MarketStatus key={r} region={r} now={now} asOf={scan?.at} />
          ))}
        </span>
      </div>
      {action && <div className="disc-status-action">{action}</div>}
      {(error || lastError) && (
        <Notice tone="warn" title={error ? "스캔을 마치지 못했어요" : "최근 스캔에서 오류가 났어요"} className="disc-status-notice">
          {error ?? `${scanErrorText(lastError)} 다음 스캔에서 다시 시도해요. 계속되면 서버 기록을 확인하세요.`}
        </Notice>
      )}
    </div>
  );
}
