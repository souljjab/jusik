import { Bell, ChevronLeft, ChevronRight, Database, Info, Palette, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useApp } from "../../app/AppContext";
import { usePrefs } from "../../app/prefs";
import { href, navigate, useRoute } from "../../app/router";
import { IconButton, Skeleton, atLeast, useBreakpoint } from "../../ui";
import { useNotifyState } from "../alerts/NotifyControls";
import { AboutSection } from "./AboutSection";
import { AlertsSection } from "./AlertsSection";
import { DataSection } from "./DataSection";
import { DisplaySection } from "./DisplaySection";
import { LimitsSection } from "./LimitsSection";
import { PaperSection } from "./PaperSection";
import {
  SECTION_IDS, SECTION_LABEL, alertsSummary, dataSummary, displaySummary, ismDraftOf, limitsChanged, limitsDraftOf, limitsSummary, paperSummary, parseIsm, parseNum,
  sameIsm, sectionOf, type SectionId,
} from "./settingsModel";
import type { DraftProps, Drafts, SecProps } from "./types";
import "./settings.css";

/*
 * 설정(UI 지도서 2장 전역: 전략·한도·테마·색 관례, 3.1·11.2 모드, 7.2 방해 금지, 9.3).
 *  /settings            핸드폰·태블릿 세로: 구역 목록 / 넓은 화면: 왼쪽 목록 + 화면 구역
 *  /settings/:section   display(화면)·alerts(알림)·limits(매매 한도)·paper(모의계좌)·data(데이터·내보내기)·about(정보)
 * 화면·알림은 이 기기에만, 매매 한도·모의계좌·데이터는 서버에 저장한다(모든 기기 공통).
 * 편집 중인 값은 구역을 옮겨 다녀도 남는다(저장하지 않은 구역에는 점 표시).
 */

const ICON: Record<SectionId, LucideIcon> = { display: Palette, alerts: Bell, limits: ShieldCheck, paper: Wallet, data: Database, about: Info };
const WHERE: Record<SectionId, string> = {
  display: "이 기기", alerts: "이 기기", limits: "서버 · 모든 기기", paper: "서버 · 모든 기기", data: "서버 · 모든 기기", about: "",
};
const LEAD: Record<SectionId, string> = {
  display: "테마와 상승·하락 색, 투자 성향을 정해요.",
  alerts: "방해 금지 시간, 브라우저 알림, 장중 신호 요약을 정해요.",
  limits: "규칙을 어기는 순간 멈추게 하는 기준이에요. 1회 손실, 종목 비중, 하루 손실 한도를 정해요.",
  paper: "서버가 규칙대로 가상으로 사고파는 계좌예요. 실제 증권 계좌와는 연결되어 있지 않아요.",
  data: "데이터 출처와 자동 스캔 상태를 보고, ISM 값을 넣고, 기록을 내보내요.",
  about: "이 앱이 하는 일과 고지, 공개하기 전에 확인할 것을 담았어요.",
};

const BODY: Record<SectionId, ComponentType<SecProps & DraftProps>> = {
  display: DisplaySection, alerts: AlertsSection, limits: LimitsSection, paper: PaperSection, data: DataSection, about: AboutSection,
};

/** 목록에서 들어왔으면 뒤로 가기로 돌아간다(목록 스크롤을 지킨다). 링크로 바로 왔으면 목록으로 바꾼다 */
let cameFromList = false;

function useSummaries(): Record<SectionId, string | null> {
  const prefs = usePrefs();
  const { server, health } = useApp();
  const notify = useNotifyState();
  return {
    display: displaySummary(prefs),
    alerts: alertsSummary(prefs.dnd, notify === "on", prefs.digest),
    limits: server ? limitsSummary(server.settings) : null,
    paper: server ? paperSummary(server.settings) : null,
    data: health ? dataSummary(health.provider, health.sample) : null,
    about: "고지 · 공개하기 전에 확인할 것 · 첫 실행 안내",
  };
}

/** 저장하지 않은 편집이 남은 구역 */
function useDirty(drafts: Drafts): Record<SectionId, boolean> {
  const { server } = useApp();
  const s = server?.settings;
  const limits = !!(s && drafts.limits && limitsChanged(limitsDraftOf(s), drafts.limits).length > 0);
  const paper = !!(s && drafts.monitor != null && parseNum(drafts.monitor) !== s.monitorIntervalSec);
  let data = false;
  if (s && drafts.ism) {
    const p = parseIsm(drafts.ism);
    const saved = ismDraftOf(s.ismManual);
    data = p.ok ? !sameIsm(p.value ?? null, s.ismManual ?? null) : drafts.ism.value !== saved.value || drafts.ism.month !== saved.month;
  }
  return { display: false, alerts: false, limits, paper, data, about: false };
}

function DirtyMark({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <>
      <span className="glb-dirty" aria-hidden="true" />
      <span className="sr-only">, 저장하지 않은 변경 있음</span>
    </>
  );
}

/** 넓은 화면: 왼쪽 구역 목록 */
function SectionNav({ current, dirty, summaries }: { current: SectionId; dirty: Record<SectionId, boolean>; summaries: Record<SectionId, string | null> }) {
  return (
    <nav className="glb-set-nav" aria-label="설정 구역">
      <ul>
        {SECTION_IDS.map((id) => {
          const Icon = ICON[id];
          const on = id === current;
          return (
            <li key={id}>
              <a className={`glb-set-navitem ${on ? "on" : ""}`} href={href(`/settings/${id}`)} aria-current={on ? "page" : undefined}>
                <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
                <span className="glb-set-navtxt">
                  <span className="glb-set-navlbl">
                    {SECTION_LABEL[id]}
                    <DirtyMark on={dirty[id]} />
                  </span>
                  {summaries[id] && <span className="t-cap glb-set-navsum">{summaries[id]}</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 핸드폰·태블릿 세로: 구역 목록(한 열) */
function SectionList({ dirty, summaries }: { dirty: Record<SectionId, boolean>; summaries: Record<SectionId, string | null> }) {
  return (
    <ul className="glb-set-list">
      {SECTION_IDS.map((id) => {
        const Icon = ICON[id];
        return (
          <li key={id}>
            <a className="glb-set-row" href={href(`/settings/${id}`)} onClick={() => (cameFromList = true)}>
              <Icon className="glb-set-rowico" size={22} strokeWidth={1.5} aria-hidden="true" />
              <span className="glb-set-rowtxt">
                <span className="t-medium">
                  {SECTION_LABEL[id]}
                  <DirtyMark on={dirty[id]} />
                </span>
                {summaries[id] ? <span className="t-2 glb-set-rowsum">{summaries[id]}</span> : <Skeleton w={160} h={12} />}
              </span>
              <ChevronRight className="glb-set-chev" size={18} strokeWidth={1.5} aria-hidden="true" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export default function SettingsScreen() {
  const route = useRoute();
  const bp = useBreakpoint();
  const wide = atLeast(bp, "expanded");
  const slug = route.segments[1];
  const sec = sectionOf(slug);
  const current: SectionId | null = sec ?? (wide ? "display" : null);
  const [drafts, setDrafts] = useState<Drafts>({ limits: null, monitor: null, ism: null });
  const setDraft = useCallback(<K extends keyof Drafts>(k: K, v: Drafts[K]) => setDrafts((d) => ({ ...d, [k]: v })), []);
  const dirty = useDirty(drafts);
  const summaries = useSummaries();
  const headRef = useRef<HTMLHeadingElement>(null);

  // 설정을 떠나면 '목록에서 들어옴' 표시를 지운다(다음에 링크로 바로 들어오면 뒤로가 목록으로 가게)
  useEffect(
    () => () => {
      cameFromList = false;
    },
    [],
  );
  // 모르는 구역 주소는 설정 첫 화면으로
  useEffect(() => {
    if (slug && !sec) navigate("/settings", { replace: true });
  }, [slug, sec]);
  // 구역을 바꾸면 맨 위로(좁은 화면은 제목에 포커스해 화면 낭독기가 새 화면을 읽게 한다)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    if (!wide && current) headRef.current?.focus();
  }, [current, wide]);

  const back = () => {
    if (cameFromList) {
      cameFromList = false;
      history.back();
    } else navigate("/settings", { replace: true });
  };

  // 좁은 화면 · 목록
  if (!wide && !current)
    return (
      <div className={`glb-set reading is-${bp}`}>
        <h1 className={bp === "compact" ? "sr-only" : "t-title"}>설정</h1>
        {bp !== "compact" && <p className="t-2">화면·알림은 이 기기에만, 매매 한도·모의계좌·데이터는 서버에 저장해 모든 기기가 같이 써요.</p>}
        <SectionList dirty={dirty} summaries={summaries} />
      </div>
    );

  const id = current!;
  const Body = BODY[id];
  const where = WHERE[id];

  // 좁은 화면 · 구역 하나
  if (!wide)
    return (
      <div className={`glb-set reading is-${bp}`}>
        <div className="glb-set-back">
          <IconButton label="설정 목록으로" onClick={back}>
            <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
          <div className="stack" style={{ gap: 0 }}>
            <h1 ref={headRef} tabIndex={-1} className="t-title">
              {SECTION_LABEL[id]}
            </h1>
            {where && <span className="t-cap">{where}에 저장</span>}
          </div>
        </div>
        <p className="t-2">{LEAD[id]}</p>
        <div className="glb-set-body">
          <Body gh="h2" bp={bp} drafts={drafts} setDraft={setDraft} />
        </div>
      </div>
    );

  // 넓은 화면 · 왼쪽 목록 + 구역
  return (
    <div className={`glb-set reading is-${bp}`}>
      <div className="glb-set-head">
        <h1 className="t-title">설정</h1>
      </div>
      <div className="glb-set-cols">
        <SectionNav current={id} dirty={dirty} summaries={summaries} />
        <div className="glb-set-main">
          <div className="glb-set-mainhead">
            <h2 ref={headRef} tabIndex={-1} className="t-section glb-set-h2">
              {SECTION_LABEL[id]}
            </h2>
            {where && <span className="t-cap">{where}에 저장</span>}
          </div>
          <p className="t-2">{LEAD[id]}</p>
          <div className="glb-set-body">
            <Body gh="h3" bp={bp} drafts={drafts} setDraft={setDraft} />
          </div>
        </div>
      </div>
    </div>
  );
}
