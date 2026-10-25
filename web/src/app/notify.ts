import { ALERT_CATEGORY_LABEL, josa, type AlertItem } from "@jusik/shared";
import { inDnd, type Prefs } from "./prefs";

/*
 * 브라우저 알림 고르기(순수 함수 — AppContext가 쓰고 시험한다).
 *  - 방해 금지 시간에는 '리스크 알림은 받기'를 켠 경우의 리스크 알림만(지도서 7.2 C).
 *  - 거른 뒤 리스크를 먼저 세워 한 번에 최대 3개(같은 스캔의 공시·신호가 리스크 알림을 밀어내지 않게).
 *  - 신호 요약(prefs.digest)을 켜면 신호 알림은 바로 띄우지 않고 모아 두었다가 정한 시각에 한 번 '신호 N건: …'으로 띄운다(지도서 7.4).
 */

/** 한 번에 띄우는 브라우저 알림 수 */
export const NOTIFY_MAX = 3;

export interface NotifyPlan {
  /** 지금 띄울 알림(리스크 먼저, 최대 NOTIFY_MAX개) */
  now: AlertItem[];
  /** 요약으로 미룰 신호 알림 */
  queue: AlertItem[];
}

export function planNotifications(fresh: AlertItem[], p: Pick<Prefs, "dnd" | "digest">, now: Date = new Date(), max = NOTIFY_MAX): NotifyPlan {
  const queue = p.digest.enabled ? fresh.filter((a) => a.category === "signal") : [];
  const dnd = inDnd(p.dnd, now);
  const allowed = fresh.filter((a) => !queue.includes(a) && (!dnd || (p.dnd.allowRisk && a.category === "risk")));
  const risk = allowed.filter((a) => a.category === "risk");
  const rest = allowed.filter((a) => a.category !== "risk");
  return { now: [...risk, ...rest].slice(0, max), queue };
}

/** 한국 시간 "YYYY-MM-DD"와 자정부터의 분 */
function kst(now: Date): { date: string; min: number } {
  const t = new Date(now.getTime() + 9 * 3600_000);
  return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * 지금(한국 시간)까지 가장 최근에 지난 요약 시각의 키("2026-10-15 12:00"). 오늘 아직 지난 시각이 없으면 어제 마지막 시각.
 * 키가 바뀌면 그 사이에 요약 시각이 하나 지난 것이다. 시각이 없으면 null.
 */
export function digestSlot(times: string[], now: Date = new Date()): string | null {
  const list = [...times].sort();
  if (!list.length) return null;
  const { date, min } = kst(now);
  const today = list.filter((t) => toMin(t) <= min).at(-1);
  if (today) return `${date} ${today}`;
  const y = kst(new Date(now.getTime() - 86_400_000)).date;
  return `${y} ${list.at(-1)}`;
}

/** 요약 알림 문장: 제목 "신호 요약", 본문 "신호 3건: 기아, KB금융, 크래프톤" (4건 이상이면 "… 외 2건") */
export function digestText(items: AlertItem[]): { title: string; body: string } {
  const names = [...new Set(items.map((a) => a.name || a.code || "").filter(Boolean))];
  const shown = names.slice(0, 3);
  const more = items.length - shown.length;
  const list = shown.length ? `: ${shown.join(", ")}${more > 0 ? ` 외 ${more}건` : ""}` : "";
  return { title: "신호 요약", body: `신호 ${items.length}건${list}` };
}

/** 설정 화면에 쓰는 요약 설명: "꺼짐" / "12:00·15:40에 묶어서 받아요" */
export function digestSummary(d: Prefs["digest"]): string {
  if (!d.enabled) return "꺼짐";
  if (!d.times.length) return "시각을 정해 주세요";
  return `${d.times.join("·")}에 묶어서 받아요`;
}

/**
 * 서버 알림 문장에 남은 조사 자리표시('중립(으)로', '예수금을(를)')를 앞 낱말에 맞게 고른다.
 * 서버가 이미 고른 문장은 그대로 둔다(예전에 저장된 알림 대비).
 */
export function fixParticles(text: string): string {
  const pairs: [RegExp, Parameters<typeof josa>[1]][] = [
    [/(\S+?)\(으\)로/g, "으로/로"],
    [/(\S+?)을\(를\)/g, "을/를"],
    [/(\S+?)은\(는\)/g, "은/는"],
    [/(\S+?)이\(가\)/g, "이/가"],
    [/(\S+?)과\(와\)/g, "과/와"],
  ];
  return pairs.reduce((s, [re, pair]) => s.replace(re, (_, w: string) => josa(w, pair)), text);
}

/** 브라우저 알림 제목·본문 */
export function notificationOf(a: AlertItem): { title: string; body: string } {
  return { title: `${ALERT_CATEGORY_LABEL[a.category]} 알림`, body: fixParticles(a.text) };
}

/** 요약으로 모아 둔 신호(같은 알림은 한 번, 하루가 지난 것은 버린다, 최대 50개) */
export function mergeQueue(queue: AlertItem[], add: AlertItem[], now: Date = new Date()): AlertItem[] {
  const seen = new Set<string>();
  const cutoff = now.getTime() - 86_400_000;
  return [...queue, ...add]
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .filter((a) => !Number.isFinite(Date.parse(a.at)) || Date.parse(a.at) >= cutoff)
    .slice(-50);
}
