import { Bell } from "lucide-react";
import { navigate } from "../../app/router";
import { Button, Section } from "../../ui";
import { AlertSources, BrowserNotify, DndEditor } from "../alerts/NotifyControls";
import type { SecProps } from "./types";

/** 알림(이 기기): 방해 금지 시간과 리스크 예외, 브라우저 알림, 알림이 생기는 때 */
export function AlertsSection({ gh }: SecProps) {
  return (
    <>
      <Section title="방해 금지" as={gh}>
        <DndEditor />
      </Section>
      <Section title="브라우저 알림" as={gh}>
        <BrowserNotify />
      </Section>
      <Section title="알림이 생기는 때" as={gh}>
        <AlertSources />
        <div>
          <Button variant="secondary" icon={<Bell size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={() => navigate("/alerts")}>
            알림 센터 열기
          </Button>
        </div>
      </Section>
      <p className="t-cap">알림 설정은 이 기기(브라우저)에만 저장돼요.</p>
    </>
  );
}
