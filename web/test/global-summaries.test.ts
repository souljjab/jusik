import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@jusik/shared";
import {
  STYLE_OPTIONS, alertsSummary, dataSummary, displaySummary, limitsSummary, paperSummary, providerLabel, styleLabel,
} from "../src/screens/settings/settingsModel";

describe("설정 목록 요약", () => {
  it("화면·알림", () => {
    expect(displaySummary({ theme: "system", convention: "KR" })).toBe("기기 설정 따름 · 한국식 색");
    expect(displaySummary({ theme: "dark", convention: "US" })).toBe("다크 · 미국식 색");
    expect(alertsSummary({ enabled: true, start: "22:00", end: "07:00" }, false)).toBe("방해 금지 22:00~07:00 · 브라우저 알림 꺼짐");
    expect(alertsSummary({ enabled: false, start: "22:00", end: "07:00" }, true)).toBe("방해 금지 꺼짐 · 브라우저 알림 켜짐");
  });
  it("매매 한도: 비율은 소수 첫째 자리까지, 하루 손실 0은 끔", () => {
    expect(limitsSummary(DEFAULT_SETTINGS)).toBe("1회 손실 1% · 종목 비중 30% · 하루 손실 4%");
    expect(limitsSummary({ riskPct: 1.25, maxWeightPct: 10, dailyLossLimitPct: 0 })).toBe("1회 손실 1.3% · 종목 비중 10% · 하루 손실 끔");
  });
  it("모의계좌", () => {
    expect(paperSummary({ paperEnabled: false, monitorIntervalSec: 60 })).toBe("자동 실행 꺼짐");
    expect(paperSummary({ paperEnabled: true, monitorIntervalSec: 1200 })).toBe("자동 실행 켜짐 · 1,200초마다 점검");
  });
  it("데이터 출처: 샘플이면 숫자를 실제 시세처럼 말하지 않는다", () => {
    expect(providerLabel("mock", true)).toMatch("샘플");
    expect(providerLabel("web (네이버 금융 + 야후 파이낸스)", false)).toBe("네이버 금융 · 야후 파이낸스");
    expect(providerLabel(null, null)).toBe("확인 중");
    expect(dataSummary("mock", true)).toMatch(/^샘플.* · 엑셀 내보내기$/);
  });
});

describe("투자 성향", () => {
  it("세 가지이고 먼저 볼 곳은 앱 경로", () => {
    expect(STYLE_OPTIONS.map((o) => o.id)).toEqual(["daytrade", "swing", "long"]);
    for (const o of STYLE_OPTIONS) for (const s of o.start) expect(s.path.startsWith("/")).toBe(true);
    expect(styleLabel("swing")).toBe("스윙");
    expect(styleLabel(null)).toBe("고르지 않음");
  });
});
