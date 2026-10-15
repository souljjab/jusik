import { ArrowLeftRight, Compass, House, NotebookPen, Settings, Star, type LucideIcon } from "lucide-react";
import type { Area } from "../app/router";

/**
 * 다섯 영역(UI 지도서 2장). 이름은 시스템 구조가 아니라 사용자의 행동으로 짓는다.
 * 핸드폰 하단 탭에서는 '종목'을 '관심'으로 부른다(지도서 표).
 */
export interface NavArea {
  id: Area;
  label: string;
  /** 핸드폰 하단 탭 이름 */
  tabLabel: string;
  path: string;
  icon: LucideIcon;
}

export const AREAS: NavArea[] = [
  { id: "home", label: "홈", tabLabel: "홈", path: "/", icon: House },
  { id: "discover", label: "발굴", tabLabel: "발굴", path: "/discover", icon: Compass },
  { id: "stocks", label: "종목", tabLabel: "관심", path: "/stocks", icon: Star },
  { id: "trade", label: "매매", tabLabel: "매매", path: "/trade", icon: ArrowLeftRight },
  { id: "records", label: "기록", tabLabel: "기록", path: "/records", icon: NotebookPen },
];

export const SETTINGS_AREA: NavArea = { id: "settings", label: "설정", tabLabel: "설정", path: "/settings", icon: Settings };

/** 화면 제목(핸드폰 앱 바) */
export const AREA_TITLE: Record<Area, string> = {
  home: "오늘", discover: "발굴", stocks: "관심종목", trade: "매매", records: "기록", alerts: "알림", settings: "설정",
};

/** 명령 검색에 나오는 화면 목록 */
export const SCREENS: { label: string; path: string; keywords: string }[] = [
  { label: "홈", path: "/", keywords: "home 대시보드 국면 오늘" },
  { label: "발굴 · 추천 목록", path: "/discover", keywords: "추천 후보 단타 스캔" },
  { label: "발굴 · 스크리너 조건", path: "/discover/screener", keywords: "조건 스크리너 필터 점수 거래대금" },
  { label: "발굴 · 전략과 백테스트", path: "/discover/strategy", keywords: "전략 백테스트 와인스타인 캔들마스터 적립식" },
  { label: "관심종목", path: "/stocks", keywords: "관심 종목 watchlist" },
  { label: "매매 · 보유 종목", path: "/trade", keywords: "보유 포지션 모의계좌" },
  { label: "매매 · 비중과 한도", path: "/trade/limits", keywords: "리스크 한도 손실 비중" },
  { label: "매매 · 오늘의 계획", path: "/trade/plan", keywords: "계획 예수금 주문" },
  { label: "기록 · 매매일지", path: "/records", keywords: "일지 기록 매매" },
  { label: "기록 · 복기", path: "/records/review", keywords: "복기 주간 월간 일일" },
  { label: "기록 · 규칙 점검", path: "/records/rules", keywords: "규칙 점검 준수 재현" },
  { label: "알림 센터", path: "/alerts", keywords: "알림 방해 금지" },
  { label: "설정", path: "/settings", keywords: "설정" },
  { label: "설정 · 화면(테마·색 관례)", path: "/settings/display", keywords: "테마 다크 라이트 색 관례 미국식 한국식 투자 성향" },
  { label: "설정 · 알림과 방해 금지", path: "/settings/alerts", keywords: "알림 방해 금지 브라우저" },
  { label: "설정 · 매매 한도", path: "/settings/limits", keywords: "한도 예수금 손실 비중 국면 상한 연속 손실" },
  { label: "설정 · 모의계좌", path: "/settings/paper", keywords: "모의계좌 초기화 자동 실행 점검 주기" },
  { label: "설정 · 데이터·내보내기", path: "/settings/data", keywords: "데이터 엑셀 구글 시트 내보내기 ISM 스케줄러" },
  { label: "설정 · 정보", path: "/settings/about", keywords: "정보 고지 첫 실행 안내 단축키" },
];
