import { Keyboard, PlayCircle } from "lucide-react";
import { useActions } from "../../app/actions";
import { setPrefs } from "../../app/prefs";
import { Button, Notice, Section } from "../../ui";
import type { SecProps } from "./types";

/** 정보: 이 앱이 하는 일, 고지, 공개하기 전에 확인할 것(지도서 9.3), 첫 실행 안내 다시 보기 */
export function AboutSection({ gh, bp }: SecProps) {
  const { openShortcuts } = useActions();
  return (
    <>
      <Section title="이 앱이 하는 일" as={gh}>
        <p>
          규칙을 지키게 돕는 도구예요. 책의 규칙에 맞는 후보를 근거와 함께 보여 주고, 주문 전에 손절가와 예상 손실을 먼저 확인하게 하고, 결정을 매매일지에 기록해 돌아보게 도와요.
        </p>
        <ul className="glb-bullets t-2">
          <li>실제 주문은 내지 않아요. 증권사와 연결되어 있지 않아서, 주문 검토에서 확인하면 매매일지에 기록만 해요. 실제 주문은 증권사 앱에서 내요.</li>
          <li>자동으로 사고파는 것은 모의매매뿐이에요. 설정 · 모의계좌에서 켜면 서버가 규칙대로 가상 체결하고 일지에 적어요.</li>
        </ul>
      </Section>

      <Section title="고지" as={gh}>
        <p className="t-medium">규칙에 맞는 후보 목록이며 투자 권유가 아니에요. 투자 판단과 책임은 본인에게 있어요.</p>
        <ul className="glb-bullets t-2">
          <li>책의 규칙은 저자의 경험칙이고, 이 앱의 단타 규칙은 수익이 검증되지 않았어요. 모의매매 결과가 충분히 쌓이기 전에는 실제 자금으로 따라 하지 마세요.</li>
          <li>모의매매는 실제 체결이 아니라 규칙을 시험하는 가상 체결이에요(수수료·세금·슬리피지 반영).</li>
          <li>데이터는 네이버 금융·야후 파이낸스 웹페이지에서 개인 용도로 읽어와요. 늦거나 틀릴 수 있으니 화면의 기준 시각을 확인하세요.</li>
          <li>장 상태는 주말만 휴장으로 표시해요. 공휴일과 대체거래소(넥스트레이드) 시간은 반영하지 않아요.</li>
        </ul>
      </Section>

      <Section title="공개하기 전에 확인할 것" as={gh}>
        <Notice title="다른 사람에게 보여 주거나 배포하려면">
          종목 추천을 다른 사람에게 제공하면 투자자문업·유사투자자문업 규제를 검토해야 해요. 고지 문구('규칙에 맞는 후보 목록이며 투자 권유가 아니에요')는 법적 판단을 대신하지 못하므로, 공개
          범위를 정한 뒤 따로 확인하세요.
        </Notice>
      </Section>

      <Section title="도움말" as={gh}>
        <div className="row wrap">
          <Button variant="secondary" icon={<PlayCircle size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={() => setPrefs({ onboarded: false })}>
            첫 실행 안내 다시 보기
          </Button>
          {bp !== "compact" && (
            <Button variant="ghost" icon={<Keyboard size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={openShortcuts}>
              단축키 보기
            </Button>
          )}
        </div>
        <p className="t-cap">투자 성향·테마·색 관례를 고르는 첫 실행 안내를 다시 열어요. 고른 값은 언제든 설정 · 화면에서 바꿀 수 있어요.</p>
      </Section>
    </>
  );
}
