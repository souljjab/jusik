import { ListChecks, NotebookPen, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Evidence } from "@jusik/shared";
import { useApp } from "../../app/AppContext";
import { Button, EvidenceStripFull, Notice, Sheet, useBreakpoint } from "../../ui";
import { ConventionChoice, StyleChoice, ThemeChoice } from "../settings/parts";
import "./onboarding.css";

/*
 * 첫 실행 안내(UI 지도서 부록 A: 투자 성향·고지). 네 단계의 짧은 시트(핸드폰은 하단 시트, 넓은 화면은 가운데 창).
 *  ① 이 앱이 하는 일 ② 투자 성향 ③ 화면(테마·색 관례) ④ 고지 → '시작하기'
 * '나중에'·닫기·Esc도 onDone을 불러 다시 뜨지 않는다(설정 · 정보에서 다시 볼 수 있다).
 */

const STEPS = ["이 앱이 하는 일", "투자 성향", "화면", "시작하기 전에"] as const;

/** 근거 스트립 설명용 예시(지도서 그림 1). 실제 신호가 아니다 */
const EXAMPLE: Pick<Evidence, "cells" | "met" | "total"> = {
  met: 4,
  total: 6,
  cells: [
    { id: "ma30", label: "30주선 상승", state: "met", detail: "" },
    { id: "vol", label: "거래량 2배", state: "met", detail: "" },
    { id: "rs", label: "상대강도", state: "met", detail: "" },
    { id: "sector", label: "업종 2단계", state: "met", detail: "" },
    { id: "resist", label: "위쪽 저항", state: "unmet", detail: "" },
    { id: "regime", label: "시장 국면", state: "na", detail: "" },
  ],
};

function StepIntro() {
  return (
    <div className="glb-ob-step">
      <p className="glb-ob-lead">규칙을 지키게 돕는 차분한 계기판이에요.</p>
      <ul className="glb-ob-points">
        <li>
          <ListChecks size={22} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <p className="t-medium">규칙에 맞는 후보를 근거와 함께 보여 줘요</p>
            <p className="t-2">규칙 하나가 한 칸이에요. 채운 칸은 충족, 빈칸은 미충족, 점선은 데이터 없음.</p>
          </div>
        </li>
        <li className="glb-ob-example">
          <span className="t-cap">근거 스트립 예시(가상의 신호)</span>
          <EvidenceStripFull evidence={EXAMPLE} />
        </li>
        <li>
          <ShieldAlert size={22} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <p className="t-medium">주문 전에 위험을 먼저 확인하게 해요</p>
            <p className="t-2">손절가, 손절 때 예상 손실, 계좌 대비 비율을 본 뒤에만 매수를 확인할 수 있어요.</p>
          </div>
        </li>
        <li>
          <NotebookPen size={22} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <p className="t-medium">결정을 기록하고 돌아보게 도와요</p>
            <p className="t-2">매매일지, 주간·월간 복기, 규칙 준수율로 내 매매를 점검해요.</p>
          </div>
        </li>
      </ul>
      <Notice>실제 주문은 내지 않아요. 증권사와 연결되어 있지 않고, 자동으로 사고파는 것은 서버의 모의매매뿐이에요(설정에서 켜요).</Notice>
    </div>
  );
}

function StepStyle() {
  return (
    <div className="glb-ob-step">
      <p className="t-2">주로 하는 매매를 골라 주세요. 먼저 볼 화면을 알려 드려요. 고르지 않아도 되고, 설정 · 화면에서 언제든 바꿀 수 있어요.</p>
      <StyleChoice />
    </div>
  );
}

function StepDisplay() {
  return (
    <div className="glb-ob-step">
      <div className="stack">
        <h3 className="t-body t-bold">테마</h3>
        <ThemeChoice />
        <p className="t-cap">기본값은 기기 설정을 따라요.</p>
      </div>
      <div className="stack">
        <h3 className="t-body t-bold">상승·하락 색</h3>
        <ConventionChoice />
      </div>
    </div>
  );
}

function StepNotice() {
  const { health } = useApp();
  return (
    <div className="glb-ob-step">
      <p className="glb-ob-lead">규칙에 맞는 후보 목록이며 투자 권유가 아니에요. 투자 판단과 책임은 본인에게 있어요.</p>
      <ul className="glb-ob-bullets t-2">
        <li>책의 규칙은 저자의 경험칙이고 수익이 검증되지 않았어요. 모의매매 결과가 충분히 쌓이기 전에는 실제 자금으로 따라 하지 마세요.</li>
        <li>시세는 실시간이 아닐 수 있어요. 화면마다 함께 적힌 'HH:mm 기준' 시각을 확인하세요.</li>
        <li>주문 검토에서 확인하면 매매일지에 기록만 해요. 실제 주문은 증권사 앱에서 내요.</li>
      </ul>
      {health?.sample && <Notice title="지금은 샘플 데이터 모드예요">종목·가격·지표는 실제 시세가 아니라 임의로 만든 값이에요.</Notice>}
    </div>
  );
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const bp = useBreakpoint();
  const compact = bp === "compact";
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const body = useRef<HTMLDivElement>(null);
  // 단계를 바꾸면 시트 본문을 맨 위로
  useEffect(() => {
    body.current?.closest(".ui-sheet-body")?.scrollTo({ top: 0 });
  }, [step]);
  const size = compact ? "lg" : "md";

  return (
    <Sheet
      open
      onClose={onDone}
      side={compact ? "bottom" : "center"}
      title={
        <span className="glb-ob-title">
          <span className="t-cap glb-ob-count">
            <span className="sr-only">단계 </span>
            {step + 1}/{STEPS.length}
          </span>
          {STEPS[step]}
        </span>
      }
      initialFocus=".glb-ob-next"
      footer={
        <div className="glb-ob-foot">
          <div className="glb-ob-dots" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s} className={i === step ? "on" : i < step ? "done" : ""} />
            ))}
          </div>
          <div className="glb-ob-btns">
            {!last && (
              <Button variant="ghost" size={size} className="glb-ob-later" onClick={onDone}>
                나중에
              </Button>
            )}
            {step > 0 && (
              <Button variant="secondary" size={size} onClick={() => setStep((s) => s - 1)}>
                이전
              </Button>
            )}
            <Button variant="primary" size={size} className="glb-ob-next" onClick={() => (last ? onDone() : setStep((s) => s + 1))}>
              {last ? "시작하기" : "다음"}
            </Button>
          </div>
        </div>
      }
    >
      <span className="sr-only" aria-live="polite">
        {STEPS.length}단계 중 {step + 1}단계, {STEPS[step]}
      </span>
      <div className="glb-ob" ref={body}>{step === 0 ? <StepIntro /> : step === 1 ? <StepStyle /> : step === 2 ? <StepDisplay /> : <StepNotice />}</div>
    </Sheet>
  );
}
