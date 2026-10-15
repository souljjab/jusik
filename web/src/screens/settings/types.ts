import type { Breakpoint } from "../../ui";
import type { IsmDraft, LimitsDraft } from "./settingsModel";

/** 구역 컴포넌트가 받는 값. gh: 구역 안 소제목 수준(넓은 화면 h3, 핸드폰 상세 h2) */
export interface SecProps {
  gh: "h2" | "h3";
  bp: Breakpoint;
}

/** 구역을 옮겨 다녀도 남는 편집 중인 값(null이면 서버 값을 그대로 따른다) */
export interface Drafts {
  limits: LimitsDraft | null;
  monitor: string | null;
  ism: IsmDraft | null;
}

export interface DraftProps {
  drafts: Drafts;
  setDraft: <K extends keyof Drafts>(k: K, v: Drafts[K]) => void;
}
