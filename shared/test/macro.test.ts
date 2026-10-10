import { describe, expect, it } from "vitest";
import {
  buildMacroSnapshot, MACRO_PARAMS, MACRO_RELEASE_LAG_DAYS, MACRO_SERIES_IDS, MACRO_SERIES_LABEL, macroNotes, macroPressure,
  type IsmReading, type MacroSeriesPoint, type MacroSnapshot,
} from "../src/macro";

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

describe("series list", () => {
  it("includes the two regional Fed ISM proxies with labels and release lags", () => {
    expect(MACRO_SERIES_IDS).toHaveLength(8);
    expect(MACRO_SERIES_IDS).toContain("GACDFSA066MSFRBPHI");
    expect(MACRO_SERIES_IDS).toContain("GACDINA066MSFRBNY");
    for (const id of MACRO_SERIES_IDS) {
      expect(MACRO_SERIES_LABEL[id]).toBeTruthy();
      expect(MACRO_RELEASE_LAG_DAYS[id]).toBeGreaterThanOrEqual(1);
    }
    expect(MACRO_SERIES_LABEL.GACDFSA066MSFRBPHI).toContain("ISM 대용");
    expect(MACRO_PARAMS.ismLine).toBe(50);
    expect(MACRO_PARAMS.rateRisingPp).toBe(0.5);
    expect(MACRO_PARAMS.rateLookback).toBe(126);
  });
});

/** 2023-03-15로 끝나는 평일 10년물: 앞 (n-1)개는 from, 마지막은 to */
const rates = (n: number, from: number, to: number) => dailyEnding("2023-03-15", [...Array(n - 1).fill(from), to]);
const L = MACRO_PARAMS.rateLookback;

describe("10-year rate trend (us10yChange6m / rateRising)", () => {
  it("compares the latest 10y yield with the one rateLookback observations earlier", () => {
    const s = buildMacroSnapshot({ DGS10: rates(L + 1, 3.5, 4.1) });
    expect(s.us10y).toEqual({ value: 4.1, date: "2023-03-15" });
    expect(s.us10yChange6m!).toBeCloseTo(0.6, 9);
    expect(s.rateRising).toBe(true);
  });

  it("uses the rateRisingPp threshold inclusively", () => {
    expect(buildMacroSnapshot({ DGS10: rates(L + 1, 3.5, 4.0) }).rateRising).toBe(true); // 정확히 +0.5%p
    expect(buildMacroSnapshot({ DGS10: rates(L + 1, 3.5, 3.99) }).rateRising).toBe(false);
    expect(buildMacroSnapshot({ DGS10: rates(L + 1, 4.5, 3.5) })).toMatchObject({ rateRising: false });
    expect(buildMacroSnapshot({ DGS10: rates(L + 1, 4.5, 3.5) }).us10yChange6m!).toBeCloseTo(-1, 9);
  });

  it("measures exactly rateLookback observations back, skipping missing values", () => {
    // 맨 앞 값만 다르다: 관측치가 L+2개면 비교 대상은 두 번째 값
    const pts = dailyEnding("2023-03-15", [9, ...Array(L).fill(3.5), 3.6]);
    expect(buildMacroSnapshot({ DGS10: pts }).us10yChange6m!).toBeCloseTo(0.1, 9);
    // 결측(NaN)은 세지 않는다 → 하나 빠지면 맨 앞 값과 비교
    const withGap = [...pts.slice(0, 5), { ...pts[5]!, value: Number.NaN }, ...pts.slice(6)];
    expect(buildMacroSnapshot({ DGS10: withGap }).us10yChange6m!).toBeCloseTo(3.6 - 9, 9);
  });

  it("leaves the trend out when there is not enough history", () => {
    const s = buildMacroSnapshot({ DGS10: rates(L, 3.5, 4.5) });
    expect(s.us10y?.value).toBe(4.5);
    expect(s.us10yChange6m).toBeUndefined();
    expect(s.rateRising).toBeUndefined();
  });

  it("asOf uses only yields known by then (no look-ahead)", () => {
    const pts = rates(L + 1, 3.5, 4.1);
    const asOf = "2023-03-15"; // 3/15 값은 하루 지연으로 아직 모름 → 3/14 기준
    const base = buildMacroSnapshot({ DGS10: pts }, { asOf });
    expect(base.us10y?.date).toBe("2023-03-14");
    expect(base.us10yChange6m).toBeUndefined(); // 3/14까지는 L개뿐
    // 미래 값을 붙여도 결과가 같다
    expect(buildMacroSnapshot({ DGS10: [...pts, { date: "2023-03-16", value: 9 }] }, { asOf })).toEqual(base);
    const later = buildMacroSnapshot({ DGS10: [...pts, { date: "2023-03-16", value: 9 }] }, { asOf: "2023-03-16" });
    expect(later.us10y?.value).toBe(4.1);
    expect(later.rateRising).toBe(true);
  });
});

const ism = (value: number, month: string, date: string, source: IsmReading["source"] = "ISM"): IsmReading => ({ value, month, date, source });
const proxies = (philly: number | null, empire: number | null) => ({
  ...(philly != null && { GACDFSA066MSFRBPHI: monthly(2023, 1, [5, philly]) }),
  ...(empire != null && { GACDINA066MSFRBNY: monthly(2023, 1, [5, empire]) }),
});

describe("ISM in the snapshot", () => {
  it("attaches the ISM reading and the regional Fed proxies", () => {
    const s = buildMacroSnapshot({ ...proxies(-8.2, -3.1), DGS10: [{ date: "2023-03-14", value: 3.6 }] }, { ism: ism(47.7, "2023-02", "2023-03-01") });
    expect(s.ism).toEqual({ value: 47.7, month: "2023-02", date: "2023-03-01", source: "ISM" });
    expect(s.ismProxy).toEqual({ philly: { value: -8.2, date: "2023-02-01" }, empire: { value: -3.1, date: "2023-02-01" } });
    expect(s.asOf).toBe("2023-03-14");
    // 수동 입력 표시는 그대로
    expect(buildMacroSnapshot({}, { ism: ism(52, "2023-02", "2023-03-01", "수동") }).ism?.source).toBe("수동");
  });

  it("ISM alone is enough for a snapshot; its release date becomes asOf when newer", () => {
    expect(buildMacroSnapshot({}, { ism: ism(52, "2023-02", "2023-03-01") })).toEqual({ asOf: "2023-03-01", ism: ism(52, "2023-02", "2023-03-01") });
    expect(buildMacroSnapshot({}, { ism: null })).toEqual({ asOf: null });
  });

  it("asOf: uses ISM only once released (date ≤ asOf), picking the latest released reading", () => {
    const hist = [ism(47.7, "2023-02", "2023-03-01"), ism(46.3, "2023-03", "2023-04-03"), ism(47.1, "2023-04", "2023-05-01")];
    expect(buildMacroSnapshot({}, { ism: hist, asOf: "2023-04-02" }).ism?.month).toBe("2023-02");
    expect(buildMacroSnapshot({}, { ism: hist, asOf: "2023-04-03" }).ism?.month).toBe("2023-03"); // 발표 당일
    expect(buildMacroSnapshot({}, { ism: hist }).ism?.month).toBe("2023-04");
    expect(buildMacroSnapshot({}, { ism: hist[2], asOf: "2023-04-30" }).ism).toBeUndefined();
    // 하루 늦게 쓰도록 바꿀 수 있다(국내 장 마감 기준 재현)
    expect(buildMacroSnapshot({}, { ism: hist, asOf: "2023-04-03", ismReleaseLagDays: 1 }).ism?.month).toBe("2023-02");
  });

  it("asOf: proxies follow their release lag (no look-ahead)", () => {
    const series = { GACDFSA066MSFRBPHI: monthly(2023, 1, [-5, -10, -20]), GACDINA066MSFRBNY: monthly(2023, 1, [3, 4, 5]) };
    // 3/15: 3월분은 아직(필라 21일·엠파이어 20일 지연) → 2월분
    const s = buildMacroSnapshot(series, { asOf: "2023-03-15" });
    expect(s.ismProxy).toEqual({ philly: { value: -10, date: "2023-02-01" }, empire: { value: 4, date: "2023-02-01" } });
    expect(buildMacroSnapshot(series, { asOf: "2023-03-21" }).ismProxy?.empire?.value).toBe(5);
    expect(buildMacroSnapshot(series, { asOf: "2023-03-21" }).ismProxy?.philly?.value).toBe(-10);
    expect(buildMacroSnapshot(series, { asOf: "2023-01-10" }).ismProxy).toBeUndefined();
  });

  it("drops a stale ISM so the proxies take over", () => {
    const old = ism(45, "2022-11", "2022-12-01");
    const series = { ...proxies(4, 6), DGS10: [{ date: "2023-03-14", value: 3.6 }] };
    expect(buildMacroSnapshot(series, { ism: old }).ism).toBeUndefined(); // 103일 묵음
    expect(buildMacroSnapshot(series, { ism: old, asOf: "2023-02-14" }).ism).toEqual(old); // 그 시점엔 75일
    expect(buildMacroSnapshot(series, { ism: old, asOf: "2023-02-15" }).ism).toBeUndefined();
  });

  it("ignores malformed readings", () => {
    expect(buildMacroSnapshot({}, { ism: ism(Number.NaN, "2023-02", "2023-03-01") }).ism).toBeUndefined();
    expect(buildMacroSnapshot({}, { ism: ism(50, "2023-2", "2023-03-01") }).ism).toBeUndefined();
    expect(buildMacroSnapshot({}, { ism: ism(50, "2023-02", "March 1") }).ism).toBeUndefined();
  });
});

describe("ISM / rate notes and pressure", () => {
  const base: MacroSnapshot = { asOf: "2023-03-15" };
  const withIsm = (value: number, extra: Partial<MacroSnapshot> = {}): MacroSnapshot => ({ ...base, ism: ism(value, "2023-02", "2023-03-01"), ...extra });
  const ismNote = (s: MacroSnapshot, region?: "KR" | "US") => macroNotes(s, region).filter((n) => n.rule === "2.3 강영현·강동진");

  it("ISM ≥ 50 is expansion (info), < 50 contraction (warn) and adds one pressure point", () => {
    const up = ismNote(withIsm(52.4));
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ tone: "info" });
    expect(up[0]!.text).toContain("ISM 제조업지수 52.4(2023-02)");
    expect(up[0]!.text).toContain("확장");
    expect(ismNote(withIsm(50))[0]!.tone).toBe("info");
    expect(macroPressure(withIsm(50))).toBe(0);

    const down = ismNote(withIsm(47.7));
    expect(down[0]).toMatchObject({ tone: "warn" });
    expect(down[0]!.text).toContain("수축");
    expect(macroPressure(withIsm(47.7))).toBe(1);
    expect(macroPressure(withIsm(47.7), "US")).toBe(1); // 미국 지표라 두 시장 모두 해당
    expect(ismNote({ ...base, ism: ism(48, "2023-02", "2023-03-01", "수동") })[0]!.text).toContain("수동 입력");
  });

  it("adds the semiconductor large-cap observation for KR only when ISM < 50", () => {
    const kr = ismNote(withIsm(47.7), "KR");
    expect(kr).toHaveLength(2);
    expect(kr[1]).toMatchObject({ tone: "info" });
    expect(kr[1]!.text).toContain("반도체 대형주");
    expect(ismNote(withIsm(47.7), "US")).toHaveLength(1);
    expect(ismNote(withIsm(47.7))).toHaveLength(1);
    expect(ismNote(withIsm(52), "KR")).toHaveLength(1);
  });

  it("falls back to the regional Fed proxies when ISM is missing and says so", () => {
    const both = buildMacroSnapshot(proxies(-8.2, -3.1));
    const n = ismNote(both);
    expect(n).toHaveLength(1);
    expect(n[0]!.tone).toBe("warn");
    expect(n[0]!.text).toContain("지역 연준 제조업 지수 수축(ISM 대용)");
    expect(n[0]!.text).toContain("필라델피아 -8.2(2023-02)");
    expect(macroPressure(both)).toBe(1);
    const kr = ismNote(both, "KR");
    expect(kr).toHaveLength(2);
    expect(kr[1]!.text).toContain("ISM 대용");
    expect(kr[1]!.text).toContain("반도체 대형주");

    const mixed = buildMacroSnapshot(proxies(-8.2, 3.1));
    expect(ismNote(mixed)[0]).toMatchObject({ tone: "info" });
    expect(ismNote(mixed)[0]!.text).toContain("엇갈려요");
    expect(macroPressure(mixed)).toBe(0);
    expect(ismNote(mixed, "KR")).toHaveLength(1);

    const up = buildMacroSnapshot(proxies(2, 0));
    expect(ismNote(up)[0]).toMatchObject({ tone: "info" });
    expect(ismNote(up)[0]!.text).toContain("확장(ISM 대용)");
    expect(macroPressure(up)).toBe(0);

    // 하나만 있으면 판단 보류
    const one = buildMacroSnapshot(proxies(-20, null));
    expect(ismNote(one)[0]).toMatchObject({ tone: "info" });
    expect(ismNote(one)[0]!.text).toContain("보류");
    expect(macroPressure(one)).toBe(0);
  });

  it("ISM takes precedence over the proxies", () => {
    const s = buildMacroSnapshot(proxies(-8.2, -3.1), { ism: ism(51, "2023-02", "2023-03-01") });
    expect(ismNote(s)).toHaveLength(1);
    expect(ismNote(s)[0]!.text).toContain("ISM 제조업지수 51.0");
    expect(macroPressure(s, "KR")).toBe(0);
    const t = buildMacroSnapshot(proxies(5, 7), { ism: ism(48, "2023-02", "2023-03-01") });
    expect(macroPressure(t)).toBe(1);
  });

  it("rate trend: notes the rising-rate period (2.3) without adding pressure", () => {
    const rising = buildMacroSnapshot({ DGS10: rates(L + 1, 3.5, 4.1) });
    const n = macroNotes(rising);
    const trend = n.find((x) => x.text.startsWith("금리 상승기: 같은 지수 레벨도 비싸게 평가돼요"));
    expect(trend).toMatchObject({ tone: "info", rule: "2.3 강영현" });
    expect(trend!.text).toContain("+0.60%p");
    expect(n.find((x) => x.text.startsWith("미 10년물 금리 4.10%"))?.text).toContain("약 6개월 +0.60%p");
    expect(macroPressure(rising)).toBe(0);

    const flat = macroNotes(buildMacroSnapshot({ DGS10: rates(L + 1, 3.5, 3.6) }));
    expect(flat.some((x) => x.text.startsWith("금리 상승기"))).toBe(false);
    expect(flat).toHaveLength(1);
  });

  it("all ISM / rate notes carry a rule and polite text", () => {
    const s = buildMacroSnapshot({ ...proxies(-1, -2), DGS10: rates(L + 1, 3, 4) }, { ism: ism(45, "2023-02", "2023-03-01") });
    const n = macroNotes(s, "KR");
    expect(n.length).toBeGreaterThanOrEqual(4);
    for (const x of n) {
      expect(x.rule).toBeTruthy();
      expect(x.text).toMatch(/요/);
    }
  });
});
