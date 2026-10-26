import { describe, expect, it } from "vitest";
import { fmtIndex, fmtWhen, readKo, srChange, srQuote } from "../src/ui/format";

describe("readKo: 낭독기가 자연스럽게 읽는 숫자", () => {
  it("만·억 묶음은 숫자 그대로, 마지막 묶음만 천·백·십(1은 뺀다)", () => {
    expect(readKo(84300)).toBe("8만 4천3백");
    expect(readKo(120959)).toBe("12만 9백5십9");
    expect(readKo(1_234_567)).toBe("123만 4천5백6십7");
    expect(readKo(1100)).toBe("천백");
    expect(readKo(10)).toBe("십");
    expect(readKo(123_400_000_000)).toBe("1234억");
    expect(readKo(-5000)).toBe("마이너스 5천");
    expect(srQuote("KB금융", 120959, 3.6)).toBe("KB금융, 12만 9백5십9 원, 3.60% 상승");
  });
});

describe("지수·등락·시각", () => {
  it("지수는 소수 둘째 자리 고정", () => {
    expect([2731.52, 812.4, 5800].map(fmtIndex)).toEqual(["2,731.52", "812.40", "5,800.00"]);
    expect(fmtIndex(null)).toBe("-");
  });
  it("등락 낭독 문장은 변동폭과 등락률을 함께", () => {
    expect(srChange(1740, 6.4)).toBe("1,740원 6.40% 상승");
    expect(srChange(-0.85, -0.42, "US")).toBe("0.85달러 0.42% 하락");
    expect(srChange(1740, 6.4, "KR", false)).toBe("6.40% 상승");
    expect(srChange(0, 0)).toBe("0원 0.00% 보합");
  });
  it("fmtWhen은 오늘이 아니면 날짜를 붙인다", () => {
    const now = new Date("2026-10-16T01:30:00Z"); // 10.16(금) 10:30 KST
    expect(fmtWhen("2026-10-16T01:20:00Z", now)).toBe("10:20");
    expect(fmtWhen("2026-10-15T10:53:00Z", now)).toBe("10.15(목) 19:53");
  });
});
