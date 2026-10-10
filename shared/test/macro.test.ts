import { describe, expect, it } from "vitest";
import { buildMacroSnapshot, MACRO_PARAMS, macroNotes, macroPressure, type MacroSeriesPoint, type MacroSnapshot } from "../src/macro";

// 모든 값은 계산 확인용으로 만든 가짜 숫자다(실제 통계 아님)

/** start(YYYY-MM)부터 매월 1일 */
const monthly = (y: number, m: number, values: number[]): MacroSeriesPoint[] =>
  values.map((value, k) => ({ date: new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 10), value }));
/** start(YYYY-MM)부터 분기마다 */
const quarterly = (y: number, m: number, values: number[]): MacroSeriesPoint[] =>
  values.map((value, k) => ({ date: new Date(Date.UTC(y, m - 1 + 3 * k, 1)).toISOString().slice(0, 10), value }));
/** end로 끝나는 평일 일간 시리즈 */
function dailyEnding(end: string, values: number[]): MacroSeriesPoint[] {
  const out: MacroSeriesPoint[] = [];
  let t = Date.parse(end);
  for (let k = values.length - 1; k >= 0; k--) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t -= 86_400_000;
    out.unshift({ date: new Date(t).toISOString().slice(0, 10), value: values[k]! });
    t -= 86_400_000;
  }
  return out;
}

// 2022-03 100 → 2023-03 103: M2 +3%
const m2 = monthly(2022, 1, [99, 99.5, 100, 100.2, 100.5, 101, 101, 101.5, 102, 102, 102.5, 102.8, 102.9, 103, 103]);
// 2022-01 100 → 2023-01 105: GDP +5%
const gdp = quarterly(2022, 1, [100, 101, 102, 103, 105]);
// 21개 관측치: 1300 → 1350 (+3.85%, 원화 약세)
const krw = dailyEnding("2023-03-15", [1300, ...Array(19).fill(1320), 1350]);

const full = {
  // 일부러 순서를 뒤섞고 결측(NaN)을 넣는다
  T10Y2Y: [{ date: "2023-03-15", value: -0.35 }, { date: "2023-03-13", value: 0.1 }, { date: "2023-03-14", value: Number.NaN }],
  VIXCLS: [{ date: "2023-03-15", value: 26.1 }],
  DGS10: [{ date: "2023-03-14", value: 3.6 }],
  M2SL: m2,
  GDP: gdp,
  DEXKOUS: krw,
};

describe("buildMacroSnapshot", () => {
  it("computes latest values, YoY growth, excess liquidity and the 20-observation KRW change", () => {
    const s = buildMacroSnapshot(full);
    expect(s.asOf).toBe("2023-03-15");
    expect(s.yieldSpread).toEqual({ value: -0.35, date: "2023-03-15" });
    expect(s.vix?.value).toBe(26.1);
    expect(s.us10y).toEqual({ value: 3.6, date: "2023-03-14" });
    expect(s.m2YoY!.date).toBe("2023-03-01");
    expect(s.m2YoY!.value).toBeCloseTo(3, 9);
    expect(s.gdpYoY!.date).toBe("2023-01-01");
    expect(s.gdpYoY!.value).toBeCloseTo(5, 9);
    expect(s.excessLiquidity!).toBeCloseTo(-2, 9);
    expect(s.krwPerUsd?.value).toBe(1350);
    expect(s.krwChange20dPct!).toBeCloseTo((1350 / 1300 - 1) * 100, 9);
  });

  it("leaves out what cannot be computed", () => {
    expect(buildMacroSnapshot({})).toEqual({ asOf: null });
    // 1년 전 같은 달이 없으면 증가율도, 초과 유동성도 없다
    const s = buildMacroSnapshot({ M2SL: m2.slice(-6), GDP: gdp, DEXKOUS: krw.slice(-5) });
    expect(s.m2YoY).toBeUndefined();
    expect(s.gdpYoY).toBeDefined();
    expect(s.excessLiquidity).toBeUndefined();
    expect(s.krwPerUsd?.value).toBe(1350);
    expect(s.krwChange20dPct).toBeUndefined();
  });

  it("asOf uses only values published by then (no look-ahead)", () => {
    const asOf = "2023-03-15";
    const base = buildMacroSnapshot(full, { asOf });
    // GDP 2023-01-01 값은 공표 지연(약 120일) 때문에 아직 모른다 → 2022-10 vs 2021-10이 없으니 증가율 없음
    expect(base.gdpYoY).toBeUndefined();
    // M2 2023-03·02 값도 아직 미공표 → 2023-01 vs 2022-01
    expect(base.m2YoY!.date).toBe("2023-01-01");
    expect(base.m2YoY!.value).toBeCloseTo((102.9 / 99 - 1) * 100, 9);
    // 일간 금리차는 하루 지연 → 3/15 값은 3/16부터
    expect(base.yieldSpread?.date).toBe("2023-03-13");
    // 미래 값을 붙여도 asOf 결과는 같다
    const future = {
      ...full,
      T10Y2Y: [...full.T10Y2Y, { date: "2023-04-03", value: 1.5 }],
      M2SL: [...m2, ...monthly(2023, 4, [90, 80])],
      GDP: [...gdp, ...quarterly(2023, 4, [50])],
      DEXKOUS: [...krw, { date: "2023-03-20", value: 1600 }],
    };
    expect(buildMacroSnapshot(future, { asOf })).toEqual(base);
    // 지연을 0으로 두면 그날 값까지 쓴다
    expect(buildMacroSnapshot(full, { asOf, releaseLagDays: { T10Y2Y: 0 } }).yieldSpread?.date).toBe("2023-03-15");
  });
});

describe("macroNotes / macroPressure", () => {
  const notesFor = (s: MacroSnapshot) => macroNotes(s);

  it("flags curve inversion (M1-06), negative excess liquidity (M1-07) and KRW weakness (2.3)", () => {
    const s = buildMacroSnapshot(full);
    const n = notesFor(s);
    expect(n.find((x) => x.rule === "M1-06 강영현")?.tone).toBe("bad");
    expect(n.find((x) => x.rule === "M1-07 강영현")?.tone).toBe("warn");
    expect(n.find((x) => x.rule === "2.3 박병창")?.tone).toBe("warn");
    expect(n.find((x) => x.rule === "2.3 강영현")?.text).toContain("3.60%");
    expect(n.find((x) => x.rule === "2.4 강영현")?.tone).toBe("info"); // VIX 26은 보통
    for (const x of n) expect(x.rule).toBeTruthy();
    expect(macroPressure(s)).toBe(3);
  });

  it("VIX thresholds", () => {
    const vix = (value: number) => notesFor({ asOf: "2023-03-15", vix: { value, date: "2023-03-15" } })[0]!;
    expect(vix(MACRO_PARAMS.vixPanic + 5).tone).toBe("bad");
    expect(vix(MACRO_PARAMS.vixHigh + 2).tone).toBe("warn");
    expect(vix(MACRO_PARAMS.vixComplacent - 1)).toMatchObject({ tone: "info" });
    expect(vix(MACRO_PARAMS.vixComplacent - 1).text).toContain("안일");
    expect(vix(20).tone).toBe("info");
    expect(macroPressure({ asOf: null, vix: { value: 31, date: "x" } })).toBe(1);
    expect(macroPressure({ asOf: null, vix: { value: 12, date: "x" } })).toBe(0);
  });

  it("healthy readings are informational and add no pressure", () => {
    const s: MacroSnapshot = {
      asOf: "2023-03-15",
      yieldSpread: { value: 0.8, date: "2023-03-15" },
      m2YoY: { value: 6, date: "2023-02-01" },
      gdpYoY: { value: 4, date: "2022-10-01" },
      excessLiquidity: 2,
      krwPerUsd: { value: 1300, date: "2023-03-15" },
      krwChange20dPct: -1,
    };
    const n = notesFor(s);
    expect(n.every((x) => x.tone === "info")).toBe(true);
    expect(n.find((x) => x.rule === "M1-07 강영현")?.text).toContain("2022-Q4");
    expect(macroPressure(s)).toBe(0);
  });

  it("skips notes for missing data and ignores KRW for the US market", () => {
    expect(notesFor({ asOf: null })).toEqual([]);
    expect(macroPressure({ asOf: null })).toBe(0);
    const krwOnly: MacroSnapshot = { asOf: "2023-03-15", krwPerUsd: { value: 1400, date: "2023-03-15" }, krwChange20dPct: 4 };
    expect(macroPressure(krwOnly)).toBe(1);
    expect(macroPressure(krwOnly, "KR")).toBe(1);
    expect(macroPressure(krwOnly, "US")).toBe(0);
    expect(macroNotes(krwOnly, "US")).toEqual([]);
  });
});
