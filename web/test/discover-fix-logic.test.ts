import { describe, expect, it } from "vitest";
import {
  PREFILTER_REASON, SCAN_DEFAULTS, draftSummary, halfTradeValue, nextScanText, postureLine, rejectionAdvice, scanDoneToast, scanErrorText, scanFinished, scanMarkOf,
  zeroScanSentence,
} from "../src/screens/discover/logic";
import { PRESET_MAX, cleanPresetName, normalizePresets, presetMatches, presetNameProblem, removePreset, renamePreset, upsertPreset } from "../src/screens/discover/presets";
import { fmtYmd } from "../src/features/strategyRun";

describe("R080 최소 거래대금 절반으로", () => {
  it("1억·$1M에서도 실제로 반이 된다(반올림으로 그대로 남지 않는다)", () => {
    expect(halfTradeValue({ minTradeValueKRW: 1e8, minTradeValueUSD: 1e6 })).toEqual({ minTradeValueKRW: 5e7, minTradeValueUSD: 5e5 });
    const a = rejectionAdvice(PREFILTER_REASON, { ...SCAN_DEFAULTS, minTradeValueKRW: 1e8, minTradeValueUSD: 1e6 });
    expect(a.fix?.patch).toEqual({ minTradeValueKRW: 5e7, minTradeValueUSD: 5e5 });
    // 안내 문장도 바뀐 값을 말한다(현재 값과 같은 숫자를 말하지 않는다)
    expect(a.text).toContain("국내 5,000만");
    expect(a.text).toContain("미국 $500,000으로");
  });
  it("홀수 억도 반으로 내림(3억 → 1.5억)하고, 더 줄일 수 없으면 버튼을 숨긴다", () => {
    expect(halfTradeValue({ minTradeValueKRW: 3e8, minTradeValueUSD: 3e6 })).toEqual({ minTradeValueKRW: 1.5e8, minTradeValueUSD: 1.5e6 });
    const zero = rejectionAdvice("거래대금 부족", { ...SCAN_DEFAULTS, minTradeValueKRW: 0, minTradeValueUSD: 0 });
    expect(zero.fix).toBeUndefined();
    expect(zero.text).toContain("이미 가장 낮아요");
    // 한쪽만 줄일 수 있어도 버튼은 남는다
    expect(rejectionAdvice("거래대금 부족", { ...SCAN_DEFAULTS, minTradeValueKRW: 0, minTradeValueUSD: 2e6 }).fix?.patch).toEqual({ minTradeValueKRW: 0, minTradeValueUSD: 1e6 });
  });
});

describe("R072 지금 스캔이 끝났는지", () => {
  const before = scanMarkOf({ lastScanAt: "2026-10-26T01:00:00.000Z", lastAttemptAt: "2026-10-26T01:00:00.000Z" });
  it("실패한 스캔(lastScanAt 그대로, lastAttemptAt만 바뀜)도 끝난 것으로 본다", () => {
    expect(scanFinished(before, { scanning: false, lastScanAt: before.lastScanAt, lastAttemptAt: "2026-10-26T01:05:00.000Z" })).toBe(true);
    expect(scanFinished(before, { scanning: true, lastScanAt: before.lastScanAt, lastAttemptAt: "2026-10-26T01:05:00.000Z" })).toBe(false);
    expect(scanFinished(before, { scanning: false, lastScanAt: before.lastScanAt, lastAttemptAt: before.lastAttemptAt })).toBe(false);
    // 성공하면 lastScanAt이 바뀐다. lastAttemptAt이 없는 이전 서버도 그대로 동작한다
    expect(scanFinished(scanMarkOf(null), { scanning: false, lastScanAt: "2026-10-26T01:05:00.000Z" })).toBe(true);
  });
  it("실패 알림은 영어 예외 메시지를 그대로 쓰지 않고 다음 할 일을 말한다", () => {
    const t = scanDoneToast({ lastError: "EROFS: read-only file system" }, 0);
    expect(t.tone).toBe("warn");
    expect(t.text).not.toMatch(/EROFS/);
    expect(t.text).toMatch(/^스캔을 마치지 못했어요\. .*서버 기록.* 잠시 뒤 다시 스캔해 보세요\.$/);
    expect(scanErrorText("시세 제공처에 연결하지 못했어요")).toBe("시세 제공처에 연결하지 못했어요.");
    expect(scanDoneToast({ lastError: null }, 9)).toEqual({ text: "스캔을 마쳤어요. 조건 충족 9종목이에요.", tone: "ok" });
  });
});

describe("다음 스캔 문장(홈·매매도 같은 함수를 쓴다)", () => {
  const s = { markets: { KOSPI: true, KOSDAQ: true, US: false }, scanIntervalMin: 10 };
  it("스케줄러가 꺼졌거나 장이 닫혔으면 시각을 말하지 않는다", () => {
    expect(nextScanText({ running: false, nextScanAt: null, marketOpen: { KR: true, US: true } }, s)).toMatch(/꺼져/);
    expect(nextScanText({ running: true, nextScanAt: "2026-10-26T01:10:00.000Z", marketOpen: { KR: false, US: true } }, s)).toBe("장이 열리면 10분마다 자동으로 찾아요");
    expect(nextScanText({ running: true, nextScanAt: "2026-10-26T01:10:00.000Z", marketOpen: { KR: true, US: false } }, s)).toBe("다음 스캔 10:10");
  });
});

describe("R020 조건 충족 0개 문장(홈에서도 쓴다)", () => {
  it("가장 많이 걸러낸 조건과 종목 수", () => {
    expect(zeroScanSentence({ rejected: { "점수 미달": 11, [PREFILTER_REASON]: 40 }, scannedCount: 15 }, { minScore: 100 })).toBe(
      "모든 조건을 만족하는 종목이 없어요. 가장 많이 걸러낸 조건은 최소 점수 100점(11종목)이에요. 스크리너에서 완화 제안을 볼 수 있어요.",
    );
    expect(zeroScanSentence({ rejected: {}, scannedCount: 0 }, {})).toMatch(/장중에 다시 스캔/);
  });
});

describe("R114 시장 이름", () => {
  it("영문 코드 대신 한국어 이름", () => {
    expect(postureLine("KOSDAQ", null)).toBe("코스닥 판정 불가");
    expect(draftSummary(SCAN_DEFAULTS)).toBe("최소 점수 55점 · 국내 10.0억 · 미국 $5.0M · 코스피·코스닥·미국");
  });
});

describe("R018 내 전략(저장한 조건 묶음)", () => {
  const ids = ["a", "b", "c"];
  let i = 0;
  const nextId = () => ids[i++]!;
  it("이름으로 저장하고, 같은 이름이면 조건을 바꾼다", () => {
    const now = new Date("2026-10-26T01:00:00Z");
    let l = upsertPreset([], "  거래대금   넉넉한 코스피 ", { ...SCAN_DEFAULTS, minScore: 65 }, now, nextId);
    expect(l).toEqual([{ id: "a", name: "거래대금 넉넉한 코스피", draft: { ...SCAN_DEFAULTS, minScore: 65 }, savedAt: now.toISOString() }]);
    l = upsertPreset(l, "거래대금 넉넉한 코스피", { ...SCAN_DEFAULTS, minScore: 75 }, now, nextId);
    expect(l).toHaveLength(1);
    expect(l[0]!.draft.minScore).toBe(75);
    expect(presetMatches(l[0]!, { ...SCAN_DEFAULTS, minScore: 75 })).toBe(true);
    expect(presetMatches(l[0]!, SCAN_DEFAULTS)).toBe(false);
    l = upsertPreset(l, "느슨하게", { ...SCAN_DEFAULTS, minScore: 45 }, now, nextId);
    expect(renamePreset(l, "b", "느슨한 조건").map((p) => p.name)).toEqual(["거래대금 넉넉한 코스피", "느슨한 조건"]);
    expect(removePreset(l, "a").map((p) => p.id)).toEqual(["b"]);
  });
  it("이름 점검: 빈 이름, 기본 프리셋 이름, 개수 상한, 이름 바꾸기의 중복", () => {
    const one = upsertPreset([], "A", SCAN_DEFAULTS, new Date(), () => "x");
    expect(presetNameProblem("   ", [])).toMatch(/적어/);
    expect(presetNameProblem("단타 돌파(스캔)", [])).toMatch(/기본 프리셋/);
    expect(presetNameProblem("A", one)).toBeNull(); // 덮어쓰기
    const full = Array.from({ length: PRESET_MAX }, (_, k) => ({ id: `p${k}`, name: `전략 ${k}`, draft: SCAN_DEFAULTS, savedAt: "" }));
    expect(presetNameProblem("새 전략", full)).toMatch(/개까지/);
    expect(presetNameProblem("전략 1", full)).toBeNull();
    expect(presetNameProblem("전략 1", full, "p2")).toMatch(/이미 있어요/);
    expect(cleanPresetName("가".repeat(30))).toHaveLength(20);
  });
  it("저장된 값 읽기: 망가진 항목은 버리고 이전 버전 조건은 기본값으로 채운다", () => {
    const l = normalizePresets([null, 1, { id: "a", name: "옛 전략", draft: { minScore: 70 } }, { id: "a", name: "중복", draft: {} }, { id: "b", name: "", draft: {} }]);
    expect(l).toHaveLength(1);
    expect(l[0]!.draft).toEqual({ ...SCAN_DEFAULTS, minScore: 70 });
    expect(normalizePresets("x")).toEqual([]);
  });
});

describe("R110 백테스트·적립식 표 날짜", () => {
  it("월.일(요일), 다른 해는 연도 두 자리", () => {
    expect(fmtYmd("2024-01-12", "2026-10-26")).toBe("24.1.12(금)");
    expect(fmtYmd("2026-01-12T00:00:00Z", "2026-10-26")).toBe("1.12(월)");
  });
});
