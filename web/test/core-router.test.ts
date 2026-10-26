import { describe, expect, it } from "vitest";
import { parseRoute } from "../src/app/router";
import { screenTitle } from "../src/shell/nav";

describe("parseRoute", () => {
  it("잘못된 % 표기가 있어도 예외 없이 원래 글자를 쓴다", () => {
    expect(() => parseRoute("/stocks/%E0%A4%A")).not.toThrow();
    expect(parseRoute("/stocks/%E0%A4%A").segments).toEqual(["stocks", "%E0%A4%A"]);
    expect(parseRoute("/records/%").segments).toEqual(["records", "%"]);
  });
  it("정상 경로와 검색어", () => {
    const r = parseRoute("/stocks/005930/fin?x=1");
    expect(r.segments).toEqual(["stocks", "005930", "fin"]);
    expect(r.path).toBe("/stocks/005930/fin");
    expect(r.query.get("x")).toBe("1");
  });
});

describe("screenTitle: 화면마다 다른 창 제목", () => {
  const t = (raw: string, name?: string) => screenTitle(parseRoute(raw), name);
  it("영역과 하위 화면 이름", () => {
    expect(t("/")).toBe("홈 · 주식 분석 어시스턴트");
    expect(t("/?view=regime")).toBe("시장 국면 · 홈 · 주식 분석 어시스턴트");
    expect(t("/discover/screener")).toBe("발굴 · 스크리너 조건 · 주식 분석 어시스턴트");
    expect(t("/trade/limits")).toBe("매매 · 비중과 한도 · 주식 분석 어시스턴트");
    expect(t("/settings/display")).toBe("설정 · 화면(테마·색 관례) · 주식 분석 어시스턴트");
    expect(t("/alerts")).toBe("알림 센터 · 주식 분석 어시스턴트");
  });
  it("종목 화면은 종목 이름(모르면 코드)", () => {
    expect(t("/stocks/005930", "삼성전자")).toBe("삼성전자 · 종목 · 주식 분석 어시스턴트");
    expect(t("/stocks/005930/fin")).toBe("005930 · 종목 · 주식 분석 어시스턴트");
    expect(t("/stocks")).toBe("관심종목 · 주식 분석 어시스턴트");
  });
});
