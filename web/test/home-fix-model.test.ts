import { describe, expect, it } from "vitest";
import type { MacroSnapshot, PaperPosition, SchedulerStatus, Settings } from "@jusik/shared";
import {
  indexSeries, macroItems, marketFromQuery, monthKo, nearStopHead, nearStopNotice, scheduleSentence, scoreParts, seriesSummary, signedFixed, srIndex,
  zeroCandidatesText,
} from "../src/screens/home/homeModel";

/*
 * 홈 리뷰 수정(R015·R020·R023·R084·R110·R111·R129·R150)의 순수 계산 시험.
 */

const sch = (over: Partial<SchedulerStatus> = {}): SchedulerStatus => ({
  running: true, scanning: false, lastScanAt: "2026-10-26T01:00:00Z", nextScanAt: "2026-10-26T01:10:00Z", lastError: null,
  marketOpen: { KR: true, US: false }, ...over,
});
const settings: Pick<Settings, "markets" | "scanIntervalMin" | "minScore"> = { markets: { KOSPI: true, KOSDAQ: true, US: true }, scanIntervalMin: 10, minScore: 55 };

describe("scan schedule sentence (R015/R132)", () => {
  it("does not claim automatic scans when the scheduler is off", () => {
    expect(scheduleSentence(sch({ running: false, nextScanAt: null }), settings)).toBe("자동 스캔이 꺼져 있어요. '지금 스캔'으로만 찾아요.");
  });
  it("says scans resume when a market opens if every enabled market is closed", () => {
    expect(scheduleSentence(sch({ marketOpen: { KR: false, US: false }, nextScanAt: null }), settings)).toBe("장이 열리면 10분마다 자동으로 찾아요.");
  });
  it("gives the next time only while a scan will really run", () => {
    expect(scheduleSentence(sch(), settings)).toMatch(/^다음 스캔 \d\d:\d\d\.$/);
  });
});

describe("zero candidates (R020)", () => {
  it("names the condition that filtered the most, like the screener", () => {
    const t = zeroCandidatesText({ rejected: { "사전 필터(가격·등락률·거래대금)": 40, "점수 미달": 11, "RSI 과열": 2 }, scannedCount: 13, universeCount: 60 }, { ...settings, minScore: 100 });
    expect(t).toBe("가장 많이 걸러낸 조건은 최소 점수 100점(11종목)이에요. 스크리너에서 완화 제안을 볼 수 있어요.");
  });
  it("says the list was not received when nothing was scanned", () => {
    expect(zeroCandidatesText({ rejected: {}, scannedCount: 0, universeCount: 0 }, settings)).toMatch(/후보 목록을 받지 못했어요/);
  });
  it("never claims the market is being watched", () => {
    const t = zeroCandidatesText({ rejected: { "점수 미달": 3 }, scannedCount: 3, universeCount: 3 }, settings);
    expect(t).not.toMatch(/계속 살펴/);
  });
});

describe("regime alert market (R023/R058)", () => {
  it("reads a known market from the route query", () => {
    expect(marketFromQuery("KOSDAQ")).toBe("KOSDAQ");
    expect(marketFromQuery("US")).toBe("US");
  });
  it("ignores unknown or missing values", () => {
    expect(marketFromQuery("NASDAQ")).toBeNull();
    expect(marketFromQuery(null)).toBeNull();
    expect(marketFromQuery("")).toBeNull();
  });
});

describe("index chart summary (R084)", () => {
  it("does not end with a dangling '마지막 종가는' when the moving average is missing", () => {
    const candles = Array.from({ length: 12 }, (_, i) => ({ date: `2026-01-${String(i + 5).padStart(2, "0")}`, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 }));
    const s = indexSeries(candles, "W");
    expect(s.ma.length).toBe(0);
    const t = seriesSummary("코스피", s, "W");
    expect(t).not.toMatch(/마지막 종가는/);
    expect(t.endsWith(" ")).toBe(false);
    expect(t).toMatch(/^코스피 주봉, 기간 중 \+/);
  });
});

describe("formats (R110/R111/R027)", () => {
  it("uses the ASCII minus and rounds before choosing the sign", () => {
    expect(signedFixed(-0.3, 2)).toBe("-0.30");
    expect(signedFixed(0.62, 2)).toBe("+0.62");
    expect(signedFixed(-0.001, 2)).toBe("0.00");
  });
  it("writes months with the year and observation dates as M.DD(요일)", () => {
    expect(monthKo("2026-09")).toBe("2026년 9월");
    expect(monthKo("2026-08-31")).toBe("2026년 8월");
    const s: MacroSnapshot = {
      asOf: "2026-10-23",
      yieldSpread: { value: -0.3, date: "2026-10-23" },
      m2YoY: { value: 4.1, date: "2026-08-01" },
      gdpYoY: { value: 4.6, date: "2026-04-01" },
      excessLiquidity: -0.5,
      ism: { value: 48.7, month: "2026-09", date: "2026-10-01", source: "ISM" },
    };
    const items = macroItems(s, "KR");
    const by = (l: string) => items.find((x) => x.label.startsWith(l))!;
    expect(by("장단기").when).toBe("관측 10.23(금)");
    expect(by("장단기").label).toBe("장단기 금리차(10년-2년)");
    expect(by("초과 유동성").value).toBe("-0.5%p");
    expect(by("초과 유동성").when).toBe("M2 2026년 8월 · GDP 2026년 2분기");
    expect(by("ISM").when).toBe("2026년 9월분 · 발표 10.01(목)");
    for (const it of items) expect(`${it.label}${it.value}${it.when}`).not.toMatch(/\u2212|\d{4}-\d{2}/);
  });
  it("score rules use the ASCII minus", () => {
    for (const p of scoreParts({})) expect(p.how).not.toMatch(/\u2212/);
  });
  it("reads an index with two fixed decimals and the close date when it is not today", () => {
    expect(srIndex("코스닥", 812.4, -0.31)).toBe("코스닥 812.40, 0.31% 하락");
    expect(srIndex("S&P 500", 5800, 0.5, "2026-10-23")).toBe("S&P 500 5,800.00, 0.50% 상승, 10.23(금) 종가");
  });
});

describe("near stop (R129/R150)", () => {
  const pos = (name: string, last: number, stop: number): PaperPosition =>
    ({ code: name, name, openedAt: "", entryDate: "", entryPrice: 100, qty: 1, stop, target: 200, maxHoldDays: 3, cost: 100, lastPrice: last, reason: "" }) as PaperPosition;
  const ns = (name: string, last: number, stop: number) => {
    const leftPct = ((last - stop) / last) * 100;
    return { position: pos(name, last, stop), currency: "KRW" as const, leftPct, breached: leftPct <= 0 };
  };
  it("does not say '0% 남았어요' for a position already under its stop", () => {
    const t = nearStopNotice([ns("SK하이닉스", 100_000, 180_000)]);
    expect(t).toBe("SK하이닉스 손절가보다 44.4% 아래예요.");
    expect(t).not.toMatch(/0% 남았어요/);
  });
  it("names the most urgent position and counts the rest", () => {
    expect(nearStopNotice([ns("A", 100, 101), ns("B", 100, 99)])).toBe("A 손절가보다 1% 아래예요. 다른 1종목도 손절가 가까이 있어요.");
    expect(nearStopNotice([ns("B", 100, 99)])).toBe("B 손절가까지 1% 남았어요.");
    expect(nearStopNotice([])).toBe("");
  });
  it("counts breached stops apart from near ones in the risk heading", () => {
    expect(nearStopHead([])).toBe("손절가 근접 종목 없음");
    expect(nearStopHead([{ breached: false }, { breached: false }])).toBe("손절가 근접 2종목");
    expect(nearStopHead([{ breached: true }, { breached: false }])).toBe("손절가 아래 1종목 · 근접 1종목");
    expect(nearStopHead([{ breached: true }])).toBe("손절가 아래 1종목");
  });
});
