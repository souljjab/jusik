import { setPrefs, usePrefs } from "../../app/prefs";
import { Section, Toggle } from "../../ui";
import { ConventionChoice, StyleChoice, ThemeChoice } from "./parts";
import type { SecProps } from "./types";

/** 화면(이 기기): 테마, 색 관례, 투자 성향, 메뉴 접기(컴퓨터) */
export function DisplaySection({ gh, bp }: SecProps) {
  const prefs = usePrefs();
  return (
    <>
      <Section title="테마" as={gh}>
        <ThemeChoice />
        <p className="t-2">기본값은 기기 설정을 따라요. 다크 테마는 차트를 오래 볼 때 눈부심이 덜해요.</p>
      </Section>
      <Section title="색 관례" as={gh}>
        <ConventionChoice />
        <p className="t-2">한국식은 상승 빨강·하락 파랑(기본), 미국식은 상승 초록·하락 빨강이에요. 어느 쪽이든 삼각형(▲▼)과 부호를 함께 써서 색 없이도 읽혀요.</p>
      </Section>
      <Section title="투자 성향" as={gh}>
        <p className="t-2">주로 하는 매매를 고르면 먼저 볼 화면을 알려 줘요. 앱이 종목을 대신 고르지는 않아요.</p>
        <StyleChoice />
      </Section>
      {bp === "large" && (
        <Section title="메뉴" as={gh}>
          <Toggle
            checked={prefs.sidebarCollapsed}
            onChange={(v) => setPrefs({ sidebarCollapsed: v })}
            label="왼쪽 메뉴를 아이콘만 보이게 접기"
            hint="메뉴 맨 아래 단추로도 접고 펼 수 있어요."
          />
        </Section>
      )}
      <p className="t-cap">화면 설정은 이 기기(브라우저)에만 저장돼요. 다른 기기에는 따로 정해요.</p>
    </>
  );
}
