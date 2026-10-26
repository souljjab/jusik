import { describe, expect, it } from "vitest";
import type { AlertItem } from "@jusik/shared";
import {
  alertHeadline, countByFilter, dayLabel, dndProblem, dndSummary, filterAlerts, groupByDay, isAlertFilter, isUnread, notifyState, srAlert,
} from "../src/screens/alerts/alertsModel";

let seq = 0;
const al = (p: Partial<AlertItem> & Pick<AlertItem, "at" | "category" | "text">): AlertItem => ({ id: `a${++seq}`, key: `k${seq}`, ...p });

// 2026-10-15 10:00 KST
const NOW = new Date("2026-10-15T01:00:00Z");

describe("groupByDay", () => {
  it("한국 날짜로 오늘·어제·날짜 묶음, 최신 순", () => {
    const list = [
      al({ at: "2026-10-13T05:00:00Z", category: "signal", text: "a" }),
      al({ at: "2026-10-14T16:30:00Z", category: "risk", text: "b" }), // KST 10-15 01:30 → 오늘
      al({ at: "2026-10-14T14:00:00Z", category: "regime", text: "c" }), // KST 10-14 23:00 → 어제
      al({ at: "2026-10-15T00:10:00Z", category: "disclosure", text: "d" }),
    ];
    const g = groupByDay(list, NOW);
    expect(g.map((x) => x.label)).toEqual(["오늘", "어제", "10.13(화)"]);
    expect(g[0]!.items.map((x) => x.text)).toEqual(["d", "b"]);
    expect(g[1]!.items.map((x) => x.text)).toEqual(["c"]);
  });
  it("시각이 잘못된 알림은 건너뛴다", () => {
    expect(groupByDay([al({ at: "nope", category: "signal", text: "x" })], NOW)).toEqual([]);
  });
  it("dayLabel", () => {
    expect(dayLabel("2026-10-15", NOW)).toBe("오늘");
    expect(dayLabel("2026-10-14", NOW)).toBe("어제");
    expect(dayLabel("2026-10-12", NOW)).toBe("10.12(월)");
  });
});

describe("filter·count", () => {
  const list = [
    al({ at: "2026-10-15T00:00:00Z", category: "signal", text: "a" }),
    al({ at: "2026-10-15T00:01:00Z", category: "risk", text: "b" }),
    al({ at: "2026-10-15T00:02:00Z", category: "risk", text: "c" }),
  ];
  it("범주별 개수와 거르기", () => {
    expect(countByFilter(list)).toEqual({ all: 3, signal: 1, risk: 2, disclosure: 0, regime: 0 });
    expect(filterAlerts(list, "risk").map((x) => x.text)).toEqual(["b", "c"]);
    expect(filterAlerts(list, "all")).toHaveLength(3);
  });
  it("isAlertFilter", () => {
    expect(isAlertFilter("risk")).toBe(true);
    expect(isAlertFilter("nope")).toBe(false);
    expect(isAlertFilter(null)).toBe(false);
  });
  it("isUnread: 본 시각 뒤만 새 알림", () => {
    expect(isUnread(list[0]!, null)).toBe(true);
    expect(isUnread(list[0]!, "2026-10-15T00:00:00Z")).toBe(false);
    expect(isUnread(list[1]!, "2026-10-15T00:00:00Z")).toBe(true);
  });
});

describe("alertHeadline", () => {
  it("종목 알림은 이름을 제목으로 떼어 낸다", () => {
    const h = alertHeadline(al({ at: NOW.toISOString(), category: "risk", code: "1", name: "누리에너지", text: "누리에너지 손절가까지 1.8% 남았어요" }));
    expect(h).toEqual({ title: "누리에너지", body: "손절가까지 1.8% 남았어요" });
  });
  it("이름으로 시작하지 않으면 문장을 그대로 둔다", () => {
    expect(alertHeadline(al({ at: NOW.toISOString(), category: "disclosure", name: "세온바이오", text: "단일판매 공급계약 체결" })).body).toBe("단일판매 공급계약 체결");
  });
  it("국면 알림: 시장 이름을 제목으로, 조사를 고친다", () => {
    const h = alertHeadline(al({ at: NOW.toISOString(), category: "regime", text: "코스피 국면이 공격에서 중립(으)로 바뀌었어요. 주식 비중 상한 50%" }));
    expect(h).toEqual({ title: "코스피 시장", body: "국면이 공격에서 중립으로 바뀌었어요. 주식 비중 상한 50%" });
    expect(alertHeadline(al({ at: NOW.toISOString(), category: "regime", text: "코스닥 국면이 중립에서 방어(으)로 바뀌었어요" })).body).toBe("국면이 중립에서 방어로 바뀌었어요");
    expect(alertHeadline(al({ at: NOW.toISOString(), category: "regime", text: "미국 국면이 방어에서 공격(으)로 바뀌었어요" })).body).toBe("국면이 방어에서 공격으로 바뀌었어요");
  });
  it("계좌(가드) 알림", () => {
    const h = alertHeadline(al({ at: NOW.toISOString(), category: "risk", text: "국내 신규 매수를 멈췄어요. 오늘 손실이 한도에 닿았어요" }));
    expect(h).toEqual({ title: "국내 계좌", body: "신규 매수를 멈췄어요. 오늘 손실이 한도에 닿았어요" });
  });
  it("화면 낭독 문장", () => {
    const a = al({ at: NOW.toISOString(), category: "signal", name: "한빛반도체", text: "한빛반도체 30주선 돌파" });
    expect(srAlert(a, "15:02", true)).toBe("새 알림, 신호, 한빛반도체, 30주선 돌파, 15:02");
  });
});

describe("방해 금지·브라우저 알림", () => {
  it("요약과 문제", () => {
    expect(dndSummary({ enabled: true, start: "22:00", end: "07:00", allowRisk: false })).toBe("방해 금지 22:00~07:00");
    expect(dndSummary({ enabled: false, start: "22:00", end: "07:00", allowRisk: false })).toBe("방해 금지 꺼짐");
    expect(dndProblem({ enabled: true, start: "22:00", end: "22:00", allowRisk: false })).toMatch("같으면");
    expect(dndProblem({ enabled: true, start: "25:00", end: "07:00", allowRisk: false })).toMatch("00:00");
    expect(dndProblem({ enabled: true, start: "22:00", end: "07:00", allowRisk: false })).toBeNull();
  });
  it("notifyState", () => {
    const env = { supported: true, secure: true, permission: "granted" as const };
    expect(notifyState({ ...env, supported: false }, true)).toBe("unsupported");
    expect(notifyState({ ...env, secure: false }, true)).toBe("insecure");
    expect(notifyState({ ...env, permission: "denied" }, true)).toBe("denied");
    expect(notifyState(env, false)).toBe("off");
    expect(notifyState(env, true)).toBe("on");
    expect(notifyState({ ...env, permission: "default" }, true)).toBe("ask");
  });
});
