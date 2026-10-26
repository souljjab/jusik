import { ALERT_CATEGORY_LABEL, type AlertCategory, type AlertItem } from "@jusik/shared";
import { fixParticles } from "../../app/notify";
import { fmtDate, kstDate } from "../../ui/format";

/*
 * 알림 센터 계산(UI 지도서 7.2·7.4). 화면과 떨어진 순수 함수라 시험할 수 있다.
 *  - 범주 거르기(전체·신호·리스크·공시·국면)와 범주별 개수
 *  - 날짜 묶음(오늘·어제·10.12(월)) — 한국 시간 기준
 *  - 행 제목과 문장: 서버 문장은 종목명으로 시작하므로 제목(종목명)과 겹치지 않게 떼어 낸다
 *  - 예전에 저장된 알림의 조사 자리표시('중립(으)로')는 브라우저 알림과 같은 fixParticles(app/notify)로 고른다
 */

export type AlertFilter = "all" | AlertCategory;
export const ALERT_FILTERS: AlertFilter[] = ["all", "signal", "risk", "disclosure", "regime"];
export const filterLabel = (f: AlertFilter) => (f === "all" ? "전체" : ALERT_CATEGORY_LABEL[f]);

export function isAlertFilter(v: string | null | undefined): v is AlertFilter {
  return !!v && (ALERT_FILTERS as string[]).includes(v);
}

/** 최신 → 오래된 순(서버도 이 순서로 주지만 화면에서 한 번 더 맞춘다) */
export function sortNewest(list: AlertItem[]): AlertItem[] {
  return [...list].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function filterAlerts(list: AlertItem[], f: AlertFilter): AlertItem[] {
  return f === "all" ? list : list.filter((a) => a.category === f);
}

export function countByFilter(list: AlertItem[]): Record<AlertFilter, number> {
  const out: Record<AlertFilter, number> = { all: list.length, signal: 0, risk: 0, disclosure: 0, regime: 0 };
  for (const a of list) out[a.category] = (out[a.category] ?? 0) + 1;
  return out;
}

/** 오늘·어제·"10.12(월)" */
export function dayLabel(day: string, now: Date): string {
  const today = kstDate(now);
  const yesterday = kstDate(new Date(now.getTime() - 86_400_000));
  if (day === today) return "오늘";
  if (day === yesterday) return "어제";
  return fmtDate(day);
}

export interface AlertGroup {
  /** 한국 날짜 YYYY-MM-DD */
  day: string;
  label: string;
  items: AlertItem[];
}

/** 날짜(한국 시간)로 묶는다. 묶음과 묶음 안 모두 최신 순 */
export function groupByDay(list: AlertItem[], now: Date): AlertGroup[] {
  const groups: AlertGroup[] = [];
  for (const a of sortNewest(list)) {
    const t = new Date(a.at);
    if (!Number.isFinite(t.getTime())) continue;
    const day = kstDate(t);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(a);
    else groups.push({ day, label: dayLabel(day, now), items: [a] });
  }
  return groups;
}

const MARKET_PREFIX = ["코스피", "코스닥", "미국"];
const REGION_PREFIX = ["국내", "미국"];

/**
 * 행에 쓰는 제목과 문장(지도서 그림 10: 범주 → 종목명 → '무엇이 얼마나').
 *  - 종목 알림: 제목은 종목명, 문장은 종목명을 뗀 나머지
 *  - 국면 알림: "코스피 시장" / "국면이 공격에서 중립으로 바뀌었어요…"
 *  - 계좌(가드) 알림: "국내 계좌" / "신규 매수를 멈췄어요…"
 */
export function alertHeadline(a: AlertItem): { title: string; body: string } {
  const text = fixParticles(a.text.trim());
  if (a.name) {
    const body = text.startsWith(`${a.name} `) ? text.slice(a.name.length + 1) : text;
    return { title: a.name, body };
  }
  if (a.category === "regime") {
    const m = MARKET_PREFIX.find((p) => text.startsWith(`${p} `));
    return m ? { title: `${m} 시장`, body: text.slice(m.length + 1) } : { title: "시장", body: text };
  }
  if (a.category === "risk") {
    const r = REGION_PREFIX.find((p) => text.startsWith(`${p} `));
    return r ? { title: `${r} 계좌`, body: text.slice(r.length + 1) } : { title: "계좌", body: text };
  }
  return { title: ALERT_CATEGORY_LABEL[a.category], body: text };
}

/** 마지막으로 본 시각 뒤에 생긴 알림인가 */
export const isUnread = (a: AlertItem, seenAt: string | null) => !seenAt || a.at > seenAt;

/** 화면 낭독 한 문장: "리스크, 누리에너지, 손절가까지 1.8% 남았어요, 14:47" */
export function srAlert(a: AlertItem, time: string, unread: boolean): string {
  const h = alertHeadline(a);
  return `${unread ? "새 알림, " : ""}${ALERT_CATEGORY_LABEL[a.category]}, ${h.title}, ${h.body}, ${time}`;
}

// ───────────────────────── 방해 금지·브라우저 알림 ─────────────────────────

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validTime = (s: string) => TIME_RE.test(s);

// 24시 시각 고르기(지도서 3.2: 한국 시간 24시 표기). 브라우저의 시각 칸은 언어 설정에 따라 '오후 10:00'처럼 12시로 보여서 쓰지 않는다
const pad2 = (n: number) => String(n).padStart(2, "0");
export const HOUR_OPTIONS: string[] = Array.from({ length: 24 }, (_, i) => pad2(i));
/** 분은 5분 단위. 지금 값이 5분 단위가 아니면(예전에 직접 친 값) 그 값도 넣어 둔다 */
export function minuteOptions(current?: string): string[] {
  const list = Array.from({ length: 12 }, (_, i) => pad2(i * 5));
  return current && /^[0-5]\d$/.test(current) && !list.includes(current) ? [...list, current].sort() : list;
}
/** "22:05" → ["22", "05"] (올바르지 않으면 "00:00") */
export function splitTime(t: string): [string, string] {
  return validTime(t) ? [t.slice(0, 2), t.slice(3, 5)] : ["00", "00"];
}

export interface DndPref {
  enabled: boolean;
  start: string;
  end: string;
  allowRisk: boolean;
}

/** "방해 금지 22:00~07:00" / "방해 금지 꺼짐" (설정 목록의 알림 요약도 이것을 쓴다) */
export const dndSummary = (d: Pick<DndPref, "enabled" | "start" | "end">) => (d.enabled ? `방해 금지 ${d.start}~${d.end}` : "방해 금지 꺼짐");

/** 시작과 끝이 같으면 구간이 비어 동작하지 않는다 */
export function dndProblem(d: DndPref): string | null {
  if (!validTime(d.start) || !validTime(d.end)) return "시각은 00:00~23:59 사이로 넣어 주세요.";
  if (d.start === d.end) return "시작과 끝이 같으면 방해 금지가 동작하지 않아요. 끝나는 시각을 바꿔 주세요.";
  return null;
}

// ───────────────────────── 장중 신호 요약(지도서 7.4) ─────────────────────────

/** 요약 시각은 이만큼까지 */
export const DIGEST_MAX_TIMES = 4;
const DIGEST_CANDIDATES = ["12:00", "15:40", "10:00", "14:00", "09:30", "11:00", "13:00", "15:00"];
/** '시각 더하기'로 넣을 새 시각: 아직 없는 흔한 시각 중 첫 번째 */
export function nextDigestTime(times: string[]): string {
  return DIGEST_CANDIDATES.find((t) => !times.includes(t)) ?? HOUR_OPTIONS.map((h) => `${h}:00`).find((t) => !times.includes(t)) ?? "12:00";
}
/** 같은 시각을 두 번 골랐을 때 안내(저장은 하나로 합친다) */
export function digestTimesProblem(times: string[]): string | null {
  return new Set(times).size < times.length ? "같은 시각이 두 번 있어요. 한 번만 보내요." : null;
}

/** 브라우저 알림 상태 */
export type NotifyState = "unsupported" | "insecure" | "denied" | "ask" | "off" | "on";

export interface NotifyEnv {
  supported: boolean;
  secure: boolean;
  permission: "default" | "granted" | "denied" | null;
}

export function notifyState(env: NotifyEnv, pref: boolean): NotifyState {
  if (!env.supported) return "unsupported";
  if (!env.secure) return "insecure";
  if (env.permission === "denied") return "denied";
  if (!pref) return "off";
  return env.permission === "granted" ? "on" : "ask";
}

export const NOTIFY_TEXT: Record<NotifyState, string> = {
  unsupported: "이 브라우저는 알림을 지원하지 않아요. 알림 센터에서 확인하세요.",
  insecure: "브라우저 알림은 https 주소나 이 기기(localhost)에서 열 때만 쓸 수 있어요.",
  denied: "브라우저에서 이 사이트의 알림을 막아 두었어요. 주소창 왼쪽의 사이트 설정에서 알림을 허용한 뒤 다시 켜세요.",
  ask: "알림 권한이 아직 없어요. 다시 켜면 브라우저가 권한을 물어요.",
  off: "꺼져 있어요. 켜면 브라우저가 알림 권한을 물어요.",
  on: "켜져 있어요. 새 알림이 오면 브라우저 알림으로도 띄워요.",
};
