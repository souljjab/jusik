import { describe, expect, it } from "vitest";
import { fmtBig, fmtDate, fmtEok, fmtPct, fmtPnl, fmtPnlKrw, fmtPrice, fmtTime, readKo, srQuote } from "../src/ui/format";

describe("number formats (UI 지도서 3.2)", () => {
  it("prices: commas, unit only on order screens", () => {
    expect(fmtPrice(84300)).toBe("84,300");
    expect(fmtPrice(84300, "KR", { unit: true })).toBe("84,300원");
    expect(fmtPrice(172.5, "US")).toBe("172.50");
    expect(fmtPrice(172.5, "US", { unit: true })).toBe("$172.50");
    expect(fmtPrice(null)).toBe("-");
  });
  it("percent always signed with two decimals", () => {
    expect(fmtPct(3.18)).toBe("+3.18%");
    expect(fmtPct(-1.42)).toBe("-1.42%");
    expect(fmtPct(0)).toBe("0.00%");
    expect(fmtPct(-0.001)).toBe("0.00%");
  });
  it("large amounts in 억·조 with one decimal", () => {
    expect(fmtBig(1.2e12)).toBe("1.2조");
    expect(fmtBig(345_020_000_000)).toBe("3,450.2억");
    expect(fmtEok(12_000)).toBe("1.2조");
    expect(fmtBig(2.5e9, "US")).toBe("$2.5B");
  });
  it("P&L in 만 원 with sign", () => {
    expect(fmtPnlKrw(-81_000)).toBe("-8만 1천 원");
    expect(fmtPnlKrw(1_234_567)).toBe("+123만 5천 원");
    expect(fmtPnlKrw(-5_400)).toBe("-5천 원");
    expect(fmtPnlKrw(800)).toBe("+800원");
    expect(fmtPnlKrw(123_456_789)).toBe("+1억 2,346만 원");
    expect(fmtPnl(-81.2, "US")).toBe("-$81.20");
  });
  it("time and date", () => {
    expect(fmtTime("2026-10-12T06:12:00Z")).toBe("15:12");
    expect(fmtDate("2026-10-12")).toBe("10.12(월)");
  });
  it("screen-reader phrasing", () => {
    expect(readKo(84300)).toBe("8만 4천3백");
    expect(srQuote("한빛반도체", 84300, 3.18)).toBe("한빛반도체, 8만 4천3백 원, 3.18% 상승");
  });
});

describe("errorText and market labels", () => {
  it("turns browser network errors into an actionable Korean sentence and keeps server messages", async () => {
    const { errorText, MARKET_LABEL } = await import("../src/ui/format");
    expect(errorText(new TypeError("Failed to fetch"))).toContain("서버에 연결하지 못했어요");
    expect(errorText(new Error("가격은 0보다 커야 해요."))).toBe("가격은 0보다 커야 해요.");
    expect(errorText(new Error("요청 실패 (502)"))).toContain("서버에서 오류가 났어요");
    expect(errorText(new Error("Unexpected token <"))).toContain("처리하지 못했어요");
    expect(MARKET_LABEL.KOSDAQ).toBe("코스닥");
  });
});
