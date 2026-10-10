import {
  assessIntraday, barDate, INTRADAY_PARAMS, INTRADAY_SESSIONS, isDailyAligned, marketClock, regionOfCode,
  type IntradayAssessment, type MinuteResponse, type Settings,
} from "@jusik/shared";
import { sessionBars, type MinuteSource } from "./minute";
import type { MarketDataProvider } from "./provider";

/** 전일 상한가로 볼 등락률(국내 가격제한폭 30%, 호가 단위 반올림 여유) */
const LIMIT_UP_RATIO = 1.295;

/**
 * 종목의 분봉 판단(4.7·M3-18 강창권). 오늘 정규장 1분봉과 직전 장 1분봉(이동평균 이어 붙이기), 완료된 일봉으로
 * 전일 종가·고가·정배열을 구한다. 장 시작 전이면 직전 거래일 분봉을 그날 마감 기준으로 보여 준다.
 */
export async function minuteFor(deps: { provider: MarketDataProvider; minute: MinuteSource }, code: string, now: Date): Promise<MinuteResponse> {
  const region = regionOfCode(code);
  const clock = marketClock(region, now);
  const out: MinuteResponse = { code, region, sessionDate: null, bars: [], assessment: null, message: null, sample: deps.minute.sample };
  const bars = await deps.minute.getMinuteBars(code, 2);
  const dates = [...new Set(bars.map((b) => barDate(b.t)))].sort();
  const sessionDate = dates.includes(clock.date) ? clock.date : dates.at(-1);
  if (!sessionDate) {
    out.message = "분봉 자료가 없어요.";
    return out;
  }
  out.sessionDate = sessionDate;
  out.bars = sessionBars(bars, sessionDate);
  const prevDate = dates.filter((d) => d < sessionDate).at(-1);
  const prevBars = prevDate ? sessionBars(bars, prevDate) : [];
  if (sessionDate !== clock.date) out.message = `오늘 장 분봉이 아직 없어요. 직전 거래일(${sessionDate}) 분봉을 마감 기준으로 보여 줘요.`;

  // 일봉: 분봉 날짜와 같거나 뒤의 봉(진행 중인 봉)은 빼고 '완료된 전일'을 기준으로 삼는다
  const daily = (await deps.provider.getCandles(code, 80)).filter((c) => c.date < sessionDate);
  const prevDay = daily.at(-1);
  if (!prevDay) {
    out.message = "전일 일봉이 없어 분봉 판단을 할 수 없어요.";
    return out;
  }
  const prevPrev = daily.at(-2);
  out.assessment = assessIntraday({
    bars1m: out.bars,
    prevBars1m: prevBars,
    prevClose: prevDay.close,
    prevHigh: prevDay.high,
    dailyAligned: isDailyAligned(daily.map((c) => c.close)),
    prevLimitUp: region === "KR" && prevPrev ? prevDay.close >= prevPrev.close * LIMIT_UP_RATIO : undefined,
    sessionOpen: INTRADAY_SESSIONS[region].open,
    nowMinutes: sessionDate === clock.date ? clock.minutes : undefined,
  });
  return out;
}

/**
 * 모의 자동매매 진입 전 분봉 확인.
 * - filter: 회피 신호, 또는 갭 +7% 이상에서 아직 '대기'면 건너뛴다(시초가 갭 추격 금지)
 * - strict: 분봉 매수 신호(buy)일 때만 들어간다
 * 분봉 자료가 없으면 filter는 들어가고(막지 않음) strict는 건너뛴다.
 */
export function minuteDecision(mode: Settings["minuteMode"], a: IntradayAssessment | null): { enter: boolean; reason: string } {
  if (mode === "off") return { enter: true, reason: "" };
  if (!a) return mode === "strict" ? { enter: false, reason: "분봉 자료가 없어 확인하지 못했어요" } : { enter: true, reason: "" };
  const notes = a.entry.notes;
  const why = (notes.find((n) => n.tone === "bad") ?? notes.find((n) => n.tone === "warn") ?? notes[0])?.text ?? "";
  // 갭 때문에 미룬 경우에는 갭 규칙(M3-18) 문구를 사유로 남긴다
  const gapWhy = notes.find((n) => n.rule?.startsWith("M3-18"))?.text;
  if (a.entry.verdict === "avoid") return { enter: false, reason: gapWhy ?? (why || "분봉 기준으로 피할 자리예요") };
  if (mode === "strict") return a.entry.verdict === "buy" ? { enter: true, reason: "" } : { enter: false, reason: why || "분봉 매수 신호를 기다려요" };
  if (a.entry.verdict === "wait" && a.gapPct != null && a.gapPct >= INTRADAY_PARAMS.gapCautionPct)
    return { enter: false, reason: gapWhy ?? `시초가 갭 ${a.gapPct.toFixed(1)}% — 추격 매수 금지` };
  return { enter: true, reason: "" };
}
