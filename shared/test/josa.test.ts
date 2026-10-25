import { describe, expect, it } from "vitest";
import { JOURNAL_STRATEGIES, josa, journalStrategyOf, MANUAL_STRATEGY, PAPER_STRATEGY } from "../src";

describe("josa", () => {
  it("picks particles by the final consonant", () => {
    expect(josa("중립", "으로/로")).toBe("중립으로");
    expect(josa("방어", "으로/로")).toBe("방어로");
    expect(josa("서울", "으로/로")).toBe("서울로");
    expect(josa("공격", "으로/로")).toBe("공격으로");
    expect(josa("손절가", "을/를")).toBe("손절가를");
    expect(josa("상한", "을/를")).toBe("상한을");
    expect(josa("한도", "은/는")).toBe("한도는");
    expect(josa("AAPL", "이/가")).toBe("AAPL가");
  });
  it("lists journal strategies and maps evidence strategies onto them", () => {
    expect(JOURNAL_STRATEGIES[0]).toBe(PAPER_STRATEGY);
    expect(JOURNAL_STRATEGIES).toContain(MANUAL_STRATEGY);
    expect(journalStrategyOf("daytrade")).toBe(PAPER_STRATEGY);
    for (const s of ["weinstein", "candle-master"] as const) expect(JOURNAL_STRATEGIES).toContain(journalStrategyOf(s));
    expect(new Set(JOURNAL_STRATEGIES).size).toBe(JOURNAL_STRATEGIES.length);
  });
});
