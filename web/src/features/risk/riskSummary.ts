import {
  consecutiveLosses, paperEquity, regionOfCode, summarizeJournal, weekdaysBetween,
  type Currency, type GuardReason, type GuardResult, type JournalEntry, type Note, type PaperPosition, type Region, type ServerState,
} from "@jusik/shared";
import { fmtRatio } from "../../ui/format";

/*
 * 리스크 요약(UI 지도서 5.1 E, 7.1 B, 9.3): 주식 비중과 상한, 오늘 손익과 일일 한도, 신규 매수 잠금, 손절가 근접 종목.
 * 모의계좌 기준이다(앱이 실제 계좌를 모른다). 모의매매를 꺼 두면 보유가 없어서 비중 0%로 보인다.
 * 잠금은 서버가 GET /api/state마다 지금 설정·오늘 날짜로 다시 계산한 server.guards를 쓴다(스캔 결과의 가드는 그 스캔 때 값).
 * 잠금 문구는 서버 노트에서 가져온다: 일일 손실 한도는 '다음 거래일에 풀려요', 연속 손실 휴식은 '마지막 손실이 난 날과 그다음 거래일까지 쉬어요'.
 */

/** 손절가까지 남은 거리가 이 비율(%) 이하면 '손절가 근접'(서버 알림 NEAR_STOP_PCT와 같은 값) */
export const NEAR_STOP_PCT = 2;

export interface NearStop {
  position: PaperPosition;
  currency: Currency;
  /** 손절가까지 남은 거리(%). 0 이하면 이미 손절가 아래 */
  leftPct: number;
  /** 현재가가 이미 손절가 아래(또는 같음) */
  breached: boolean;
}

export interface CurrencyRisk {
  currency: Currency;
  equity: number;
  heldValue: number;
  /** 주식 비중(%) */
  weightPct: number;
  /** 국면별 주식 비중 상한(%) — 마지막 스캔에서 적용한 값, 없으면 중립 상한 */
  capPct: number;
  /** 오늘 손익(%) — 하루 시작 자산 대비. 오늘 장 기록이 없으면 null */
  todayPct: number | null;
  todayPnl: number | null;
  /** 일일 손실 한도(%) — 음수로 돌려준다(예: −2). 0이면 끔 → null */
  dailyLimitPct: number | null;
  /** 리스크 가드를 점검한 결과가 있는지(없으면 '확인 전') */
  checked: boolean;
  /** 신규 매수가 잠겼는지(일일 손실 한도·연속 손실 휴식) */
  blocked: boolean;
  /** 잠긴 까닭(서버의 bad 노트 문장) */
  blockReason: string | null;
  /** 잠긴 까닭의 종류 */
  blockReasons: GuardReason[];
  /** 언제 풀리는지: 일일 손실 한도 '다음 거래일에 풀려요.', 연속 손실 휴식은 서버 문장('…그다음 거래일(3.18(월))까지 쉬어요.') */
  releaseText: string | null;
  /** 잠금 문장에 쓰지 않은 나머지 가드 노트(예: 휴식이 끝난 뒤 '다시 진입하되 규모를 줄이세요', 설정 경고) */
  notes: Note[];
  positions: PaperPosition[];
}

export interface RiskSummary {
  KRW: CurrencyRisk;
  USD: CurrencyRisk;
  nearStop: NearStop[];
}

export function leftToStopPct(p: PaperPosition): number | null {
  const px = p.lastPrice ?? p.entryPrice;
  if (!(px > 0) || !(p.stop > 0)) return null;
  return ((px - p.stop) / px) * 100;
}

/** 화면이 쓸 가드: 서버가 지금 계산한 server.guards, 이전 서버면 마지막 스캔의 가드 */
export function guardOf(st: Pick<ServerState, "guards" | "latestScan">, cur: Currency): GuardResult | null {
  return (st.guards ? st.guards[cur] : st.latestScan?.guards?.[cur]) ?? null;
}

const STREAK_REST_TEXT = "마지막 손실이 난 날과 그다음 거래일까지 쉬어요.";
const DAILY_RELEASE_TEXT = "다음 거래일에 풀려요.";

/** 가드 결과를 잠금 문장(까닭·풀리는 때)과 나머지 노트로 나눈다 */
export function guardView(g: GuardResult | null): Pick<CurrencyRisk, "checked" | "blocked" | "blockReason" | "blockReasons" | "releaseText" | "notes"> {
  if (!g) return { checked: false, blocked: false, blockReason: null, blockReasons: [], releaseText: null, notes: [] };
  const notes = g.notes;
  if (!g.blocked) return { checked: true, blocked: false, blockReason: null, blockReasons: [], releaseText: null, notes };
  // 이전 서버는 까닭을 주지 않으니 노트의 규칙 번호로 고른다
  const reasons: GuardReason[] = g.reasons?.length
    ? g.reasons
    : notes.filter((n) => n.tone === "bad").map((n): GuardReason => (/연속 손실/.test(n.text) ? "streak" : "dailyLoss"));
  const bad = notes.filter((n) => n.tone === "bad");
  const restNote = reasons.includes("streak") ? notes.find((n) => n.tone === "info" && /쉬어요|그다음 거래일/.test(n.text)) : undefined;
  const releaseText = reasons.includes("streak") ? (restNote?.text ?? STREAK_REST_TEXT) : DAILY_RELEASE_TEXT;
  return {
    checked: true,
    blocked: true,
    blockReason: bad.length ? bad.map((n) => n.text).join(" ") : "리스크 한도에 닿았어요.",
    blockReasons: reasons,
    releaseText,
    notes: notes.filter((n) => n.tone !== "bad" && n !== restNote),
  };
}

export function riskSummary(st: ServerState): RiskSummary {
  const s = st.settings;
  const one = (cur: Currency): CurrencyRisk => {
    const acct = st.paper[cur];
    const equity = paperEquity(acct);
    const heldValue = equity - acct.cash;
    const t = st.todayPnl?.[cur] ?? null;
    return {
      currency: cur,
      equity,
      heldValue,
      weightPct: equity > 0 ? (heldValue / equity) * 100 : 0,
      capPct: st.latestScan?.exposureCaps?.[cur] ?? s.postureCaps.NEUTRAL,
      todayPct: t ? t.pct : null,
      todayPnl: t ? t.pnl : null,
      dailyLimitPct: s.dailyLossLimitPct > 0 ? -s.dailyLossLimitPct : null,
      ...guardView(guardOf(st, cur)),
      positions: acct.positions,
    };
  };
  const nearStop: NearStop[] = [];
  for (const cur of ["KRW", "USD"] as const)
    for (const p of st.paper[cur].positions) {
      const left = leftToStopPct(p);
      if (left != null && left <= NEAR_STOP_PCT) nearStop.push({ position: p, currency: cur, leftPct: left, breached: left <= 0 });
    }
  // 이미 손절가 아래인 종목이 가장 급하다
  nearStop.sort((a, b) => a.leftPct - b.leftPct);
  return { KRW: one("KRW"), USD: one("USD"), nearStop };
}

/** 손절가까지 거리 문구: "손절가까지 1.5%" / 이미 아래면 "손절가보다 44.4% 아래" */
export function stopDistanceText(n: Pick<NearStop, "position" | "leftPct">): string {
  if (n.leftPct > 0) return `손절가까지 ${fmtRatio(n.leftPct)}`;
  const px = n.position.lastPrice ?? n.position.entryPrice;
  const below = n.position.stop > 0 ? ((n.position.stop - px) / n.position.stop) * 100 : 0;
  return below > 0 ? `손절가보다 ${fmtRatio(below)} 아래` : "손절가에 닿음";
}

/** 핸드폰 '내 포지션' 같은 한 문장: "SK하이닉스 손절가까지 1.5% 남았어요" / "SK하이닉스 손절가보다 44.4% 아래예요" */
export function nearStopSentence(n: Pick<NearStop, "position" | "leftPct">): string {
  const t = stopDistanceText(n);
  return n.leftPct > 0 ? `${n.position.name} ${t} 남았어요` : `${n.position.name} ${t}${t.endsWith("아래") ? "예요" : "했어요"}`;
}

export interface ManualStreak {
  /** 직접 기록한 매매(그 지역)의 끝에서부터 이어진 손실 거래 수 */
  streak: number;
  /** 마지막 손실 매도일 */
  lastLossDate: string | null;
  /** 휴식 기준(max) 이상이고, 마지막 손실이 오늘이거나 바로 전 거래일이면 true(모의 자동매매의 연속 손실 휴식과 같은 기간) */
  resting: boolean;
}

/**
 * 직접 기록한 매매의 연속 손실(UI 지도서 9.3 '3회 연속 손절이면 오늘은 기록만 하기를 제안').
 * 서버 가드는 모의 자동매매만 보므로 직접 매매는 화면이 일지로 센다. 휴식 기간은 서버와 같다(마지막 손실일과 그다음 거래일).
 */
export function manualStreakOf(journal: JournalEntry[], region: Region, today: string, max: number): ManualStreak {
  const mine = journal.filter((e) => (e.source ?? "수동") === "수동" && regionOfCode(e.code) === region);
  const closed = summarizeJournal(mine).closed;
  const streak = consecutiveLosses(closed.map((t) => t.returnPct));
  const lastLossDate = streak > 0 ? closed.slice(-streak).reduce((a, t) => (t.sellDate > a ? t.sellDate : a), "") || null : null;
  const resting = max > 0 && streak >= max && lastLossDate != null && lastLossDate <= today && weekdaysBetween(lastLossDate, today) <= 1;
  return { streak, lastLossDate, resting };
}
