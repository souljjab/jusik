import { describe, expect, it } from "vitest";
import type { AlertItem } from "@jusik/shared";
import { digestSlot, digestSummary, digestText, fixParticles, mergeQueue, planNotifications } from "../src/app/notify";
import { DEFAULT_PREFS, normDigest } from "../src/app/prefs";

let n = 0;
const al = (category: AlertItem["category"], extra: Partial<AlertItem> = {}): AlertItem => ({ id: `a${++n}`, key: `k${n}`, at: "2026-10-15T13:00:00Z", category, text: `${category} ${n}`, ...extra });
const NIGHT = new Date("2026-10-15T14:00:00Z"); // 23:00 KST
const DAY = new Date("2026-10-15T02:00:00Z"); // 11:00 KST
const prefs = (dnd: Partial<typeof DEFAULT_PREFS.dnd> = {}, digest = false) => ({ dnd: { ...DEFAULT_PREFS.dnd, ...dnd }, digest: { enabled: digest, times: ["12:00", "15:40"] } });

describe("planNotifications", () => {
  it("방해 금지로 먼저 거른 뒤 최대 3개: 앞선 공시·신호가 리스크 알림을 밀어내지 않는다", () => {
    const list = [al("disclosure"), al("disclosure"), al("signal"), al("risk")];
    const plan = planNotifications(list, prefs({ enabled: true, allowRisk: true }), NIGHT);
    expect(plan.now.map((a) => a.category)).toEqual(["risk"]);
  });
  it("방해 금지가 아니면 리스크를 먼저 세워 3개", () => {
    const list = [al("disclosure"), al("signal"), al("disclosure"), al("risk")];
    const plan = planNotifications(list, prefs({ enabled: true }), DAY);
    expect(plan.now.map((a) => a.category)).toEqual(["risk", "disclosure", "signal"]);
  });
  it("방해 금지 시간에 리스크 예외가 꺼져 있으면 아무것도 띄우지 않는다", () => {
    expect(planNotifications([al("risk")], prefs({ enabled: true, allowRisk: false }), NIGHT).now).toEqual([]);
  });
  it("신호 요약을 켜면 신호는 바로 띄우지 않고 모은다", () => {
    const s = al("signal");
    const plan = planNotifications([s, al("risk")], prefs({ enabled: false }, true), DAY);
    expect(plan.now.map((a) => a.category)).toEqual(["risk"]);
    expect(plan.queue).toEqual([s]);
  });
});

describe("신호 요약", () => {
  it("가장 최근에 지난 요약 시각(한국 시간)", () => {
    const t = ["12:00", "15:40"];
    expect(digestSlot(t, new Date("2026-10-15T02:00:00Z"))).toBe("2026-10-14 15:40"); // 11:00 → 어제 마지막
    expect(digestSlot(t, new Date("2026-10-15T03:00:00Z"))).toBe("2026-10-15 12:00"); // 12:00 정각
    expect(digestSlot(t, new Date("2026-10-15T07:00:00Z"))).toBe("2026-10-15 15:40"); // 16:00
    expect(digestSlot([], DAY)).toBeNull();
  });
  it("요약 문장", () => {
    const items = ["기아", "KB금융", "크래프톤", "한국전력", "기아"].map((name) => al("signal", { name }));
    expect(digestText(items.slice(0, 2))).toEqual({ title: "신호 요약", body: "신호 2건: 기아, KB금융" });
    expect(digestText(items).body).toBe("신호 5건: 기아, KB금융, 크래프톤 외 2건");
    expect(digestSummary({ enabled: false, times: ["12:00"] })).toBe("꺼짐");
    expect(digestSummary({ enabled: true, times: ["12:00", "15:40"] })).toBe("12:00·15:40에 묶어서 받아요");
  });
  it("모아 둔 신호는 같은 알림 한 번, 하루 지난 것은 버린다", () => {
    const a = al("signal", { at: "2026-10-15T01:00:00Z" });
    const old = al("signal", { at: "2026-10-13T01:00:00Z" });
    expect(mergeQueue([a], [a, old], DAY)).toEqual([a]);
  });
  it("저장된 요약 설정 다듬기", () => {
    expect(normDigest(undefined)).toEqual({ enabled: false, times: ["12:00", "15:40"] });
    expect(normDigest({ enabled: true, times: ["15:40", "9:00", "12:00", "12:00", "25:00"] })).toEqual({ enabled: true, times: ["12:00", "15:40"] });
  });
});

describe("fixParticles", () => {
  it("조사 자리표시를 앞 낱말에 맞게 고른다", () => {
    expect(fixParticles("코스닥 국면이 방어에서 중립(으)로 바뀌었어요")).toBe("코스닥 국면이 방어에서 중립으로 바뀌었어요");
    expect(fixParticles("국면이 중립에서 방어(으)로")).toBe("국면이 중립에서 방어로");
    expect(fixParticles("원화 예수금을(를) 숫자로")).toBe("원화 예수금을 숫자로");
    expect(fixParticles("이미 고른 문장은 그대로예요")).toBe("이미 고른 문장은 그대로예요");
  });
});
