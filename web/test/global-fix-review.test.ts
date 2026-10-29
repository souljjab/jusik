import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type AlertItem } from "@jusik/shared";
import {
  DIGEST_MAX_TIMES, HOUR_OPTIONS, alertHeadline, digestTimesProblem, minuteOptions, nextDigestTime, sortNewest, splitTime,
} from "../src/screens/alerts/alertsModel";
import {
  DEFAULT_LIMITS, alertsSummary, failText, ismNotes, limitsDraftOf, limitsErrors, monthText,
} from "../src/screens/settings/settingsModel";

/* 리뷰 수정(알림·설정·첫 실행 안내) */

let seq = 0;
const al = (p: Partial<AlertItem> & Pick<AlertItem, "at" | "category" | "text">): AlertItem => ({ id: `g${++seq}`, key: `gk${seq}`, ...p });

describe("R117 24시 시각 고르기", () => {
  it("시는 00~23, 분은 5분 단위", () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toBe("00");
    expect(HOUR_OPTIONS.at(-1)).toBe("23");
    expect(minuteOptions()).toEqual(["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  });
  it("5분 단위가 아닌 저장값도 고를 수 있게 남긴다", () => {
    expect(minuteOptions("07")).toContain("07");
    expect(minuteOptions("07").indexOf("07")).toBe(2);
    expect(minuteOptions("40")).toHaveLength(12);
  });
  it("splitTime", () => {
    expect(splitTime("22:05")).toEqual(["22", "05"]);
    expect(splitTime("7:00")).toEqual(["00", "00"]);
  });
});

describe("R059 장중 신호 요약 시각", () => {
  it("새 시각은 아직 없는 흔한 시각", () => {
    expect(nextDigestTime(["12:00", "15:40"])).toBe("10:00");
    expect(nextDigestTime([])).toBe("12:00");
    expect(DIGEST_MAX_TIMES).toBeGreaterThanOrEqual(2);
  });
  it("같은 시각을 두 번 고르면 안내", () => {
    expect(digestTimesProblem(["12:00", "12:00"])).toMatch("두 번");
    expect(digestTimesProblem(["12:00", "15:40"])).toBeNull();
  });
  it("설정 목록 요약: 켰을 때만 시각을 붙인다", () => {
    const dnd = { enabled: true, start: "22:00", end: "07:00" };
    expect(alertsSummary(dnd, true, { enabled: true, times: ["12:00", "15:40"] })).toBe("방해 금지 22:00~07:00 · 브라우저 알림 켜짐 · 신호 요약 12:00·15:40");
    expect(alertsSummary(dnd, true, { enabled: false, times: ["12:00"] })).toBe("방해 금지 22:00~07:00 · 브라우저 알림 켜짐");
    expect(alertsSummary({ ...dnd, enabled: false }, false)).toBe("방해 금지 꺼짐 · 브라우저 알림 꺼짐");
  });
});

describe("R116 조사", () => {
  it("한도 칸 오류는 받침에 맞는 조사", () => {
    const e = limitsErrors({ ...DEFAULT_LIMITS, depositKRW: "", maxPositions: "", riskPct: "" });
    expect(e.depositKRW).toBe("원화 예수금을 숫자로 넣어 주세요.");
    expect(e.maxPositions).toBe("최대 보유 종목 수를 숫자로 넣어 주세요.");
    expect(e.riskPct).toBe("1회 손실 비율을 숫자로 넣어 주세요.");
    for (const msg of Object.values(limitsErrors(Object.fromEntries(Object.keys(limitsDraftOf(DEFAULT_SETTINGS)).map((k) => [k, ""])) as typeof DEFAULT_LIMITS)))
      expect(msg).not.toMatch(/\(를\)|\(는\)|\(으\)/);
  });
  it("ISM 안내: 달은 2026년 10월 형식, 조사는 읽는 소리에 맞게", () => {
    const now = new Date("2026-10-15T01:00:00Z");
    expect(ismNotes({ value: 50, month: "2026-10" }, now)[0]).toMatch(/^2026년 10월은 아직 끝나지 않은 달이라/);
    expect(ismNotes({ value: 50, month: "2026-05" }, now)[0]).toMatch(/^2026년 5월 값은/);
    expect(monthText("2026-09")).toBe("2026년 9월");
    expect(monthText("bad")).toBe("bad");
  });
  it("R050 예전에 저장된 국면 알림도 알림 센터에서 바른 조사(브라우저 알림과 같은 fixParticles)", () => {
    const h = alertHeadline(al({ at: "2026-10-15T01:00:00Z", category: "regime", text: "코스피 국면이 공격에서 중립(으)로 바뀌었어요" }));
    expect(h.body).toBe("국면이 공격에서 중립으로 바뀌었어요");
  });
});

describe("R115 실패 문장", () => {
  it("연결 실패는 영어 원문 대신 까닭과 고칠 방법(덧붙이는 방법은 빼서 두 번 말하지 않는다)", () => {
    const t = failText("매매 한도를 저장하지 못했어요", new TypeError("Failed to fetch"), "값을 확인하고 다시 저장하세요.");
    expect(t).toBe("매매 한도를 저장하지 못했어요. 서버에 연결하지 못했어요. 앱 서버가 켜져 있는지 확인해 주세요.");
    expect(t).not.toMatch(/fetch/i);
  });
  it("서버의 한국어 문장은 그대로 쓰고 고칠 방법을 붙인다", () => {
    expect(failText("ISM 값을 저장하지 못했어요", new Error("값이 범위를 벗어났어요"), "값을 확인하고 다시 저장하세요.")).toBe(
      "ISM 값을 저장하지 못했어요. 값이 범위를 벗어났어요. 값을 확인하고 다시 저장하세요.",
    );
  });
  it("영어 오류는 쓰지 않는다", () => {
    expect(failText("기록을 내보내지 못했어요", new Error("EBUSY: resource busy"), "잠시 뒤 다시 해 주세요.")).not.toMatch(/EBUSY/);
  });
});

describe("R139 같은 시각 알림의 순서", () => {
  it("시각이 같으면 서버가 준 순서(가장 높은 점수 먼저)를 지킨다", () => {
    const at = "2026-10-15T01:00:00Z";
    const list = [al({ at, category: "signal", text: "기아 82" }), al({ at, category: "signal", text: "KB금융 80" }), al({ at: "2026-10-14T01:00:00Z", category: "risk", text: "x" })];
    expect(sortNewest(list).map((a) => a.text)).toEqual(["기아 82", "KB금융 80", "x"]);
  });
});
