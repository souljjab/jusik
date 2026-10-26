import { describe, expect, it } from "vitest";
import type { StockInfo } from "@jusik/shared";
import { paletteItems } from "../src/shell/paletteModel";

const opened: string[] = [];
const base = { watchlist: ["005930", "000270", "AAPL"], names: { "005930": "삼성전자" } as Record<string, string>, openStock: (c: string) => void opened.push(c) };
const samsung: StockInfo[] = [
  { code: "005930", name: "삼성전자", market: "KOSPI" },
  { code: "005935", name: "삼성전자우", market: "KOSPI" },
];

describe("명령 검색 항목", () => {
  it("지금 입력과 다른 검색어로 받은 결과는 쓰지 않는다(Enter가 이전 결과를 열지 않게)", () => {
    const items = paletteItems({ ...base, q: "AAPL", results: { q: "삼성", list: samsung } });
    expect(items[0]!.label).toBe("AAPL");
    expect(items[0]!.sub).toBe("코드로 열기");
    expect(items.some((x) => x.label === "삼성전자")).toBe(false);
    items[0]!.go();
    expect(opened.at(-1)).toBe("AAPL");
  });
  it("같은 검색어 결과는 시장 이름을 한글로", () => {
    const items = paletteItems({ ...base, q: "삼성", results: { q: "삼성", list: samsung } });
    expect(items[0]!.label).toBe("삼성전자");
    expect(items[0]!.sub).toBe("005930 · 코스피");
  });
  it("올바른 종목코드는 '코드로 열기'가 맨 앞(검색 결과에 같은 코드가 없을 때)", () => {
    const items = paletteItems({ ...base, q: "035420", results: { q: "035420", list: [] } });
    expect(items[0]!.key).toBe("s:035420");
  });
  it("빈 입력: 관심종목은 이름 · 코드(이름을 모르면 코드만)", () => {
    const items = paletteItems({ ...base, q: "", results: null }).filter((x) => x.key.startsWith("w:"));
    expect(items.map((x) => [x.label, x.sub])).toEqual([
      ["삼성전자", "005930 · 관심종목"],
      ["000270", "관심종목"],
      ["AAPL", "관심종목"],
    ]);
  });
});
