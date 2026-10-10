import { describe, expect, it } from "vitest";
import type { Candle, Fundamentals, Note, PeriodFinancials } from "../src/types";
import {
  PER_BAND_PARAMS,
  VALUATION_RULES,
  perBand,
  perHistory,
  psr,
  roundMultiple,
  sampleMarketFields,
  trailingEpsAt,
  trailingRevenueAt,
  valuationNotes,
  type PerBand,
  type PsrResult,
} from "../src/valuation";

// 아래 실적·주가는 모두 테스트용으로 만든 값이다(실제 종목 데이터 아님).

const q = (period: string, eps?: number, extra: Partial<PeriodFinancials> = {}): PeriodFinancials => ({ period, estimate: false, ...(eps != null ? { eps } : {}), ...extra });

/** 평일만 n개(YYYY-MM-DD) */
function weekdays(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (out.length < n) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const bar = (date: string, close: number): Candle => ({ date, open: close, high: close, low: close, close, volume: 1000 });
/** PER 목록 → EPS 100 고정일 때의 일봉 */
const fromPers = (pers: number[], start = "2024-01-02") => weekdays(start, pers.length).map((d, i) => bar(d, Math.round(pers[i]! * 10_000) / 100));
/** 아주 오래전에 공시된 연간 EPS 하나(밴드 테스트용) */
const flatEps = (eps = 100): Fundamentals => ({ annual: [{ period: "2020.12", estimate: false, eps, filed: "2021-03-01" }] });

// 12월 결산. 공시 지연: 분기 45일, 4분기·연간 90일(자료집 3.6)
const base: Fundamentals = {
  annual: [q("2022.12", 1000, { revenue: 4000 }), q("2023.12", 1210, { revenue: 4500 })],
  quarterly: [
    q("2023.03", 280, { revenue: 1000 }),
    q("2023.06", 300, { revenue: 1100 }),
    q("2023.09", 310, { revenue: 1150 }),
    q("2023.12", 310, { revenue: 1250 }),
    q("2024.03", 350, { revenue: 1300 }),
    { period: "2024.06", estimate: true, eps: 999, revenue: 9999 },
  ],
};

describe("trailingEpsAt — TTM·연간 선택과 공시 시점", () => {
  it("sums the last four consecutive confirmed quarters (TTM)", () => {
    // 2024.03 분기는 45일 뒤(2024-05-15)부터 확정
    expect(trailingEpsAt(base, "2024-06-30")).toEqual({ eps: 300 + 310 + 310 + 350, basis: "TTM", period: "2024.03" });
    expect(trailingEpsAt(base, "2024-05-15")?.period).toBe("2024.03");
    expect(trailingEpsAt(base, "2024-05-14")).toEqual({ eps: 1200, basis: "TTM", period: "2023.12" });
  });
  it("prefers TTM over an annual figure that ends in the same month", () => {
    expect(trailingEpsAt(base, "2024-04-30")).toEqual({ eps: 280 + 300 + 310 + 310, basis: "TTM", period: "2023.12" }); // 연간 1,210이 아니라 분기 합
  });
  it("falls back to the latest confirmed annual EPS when fewer than four quarters are confirmed", () => {
    // 4분기(결산월)는 사업보고서라 90일 지연 → 2024-03-30 전에는 2023.12 분기·연간 모두 미확정
    expect(trailingEpsAt(base, "2024-03-01")).toEqual({ eps: 1000, basis: "연간", period: "2022.12" });
    expect(trailingEpsAt(base, "2023-03-30")).toBeNull(); // 2022.12 사업보고서도 아직(2023-03-31)
    expect(trailingEpsAt(base, "2023-03-31")).toEqual({ eps: 1000, basis: "연간", period: "2022.12" });
  });
  it("never uses estimates, even far in the future or without a date", () => {
    expect(trailingEpsAt(base, "2030-01-01")!.eps).toBe(1270);
    expect(trailingEpsAt(base)!.eps).toBe(1270);
  });
  it("uses the actual filed date instead of the lag estimate", () => {
    const f: Fundamentals = {
      ...base,
      quarterly: base.quarterly!.map((p) => (p.period === "2024.03" ? { ...p, filed: "2024-05-10" } : p.period === "2023.12" ? { ...p, filed: "2024-02-15" } : p)),
      annual: base.annual!.map((p) => (p.period === "2023.12" ? { ...p, filed: "2024-03-12" } : p)),
    };
    expect(trailingEpsAt(f, "2024-05-09")!.period).toBe("2023.12"); // 2024.03은 제출 전이라 쓰지 않는다
    expect(trailingEpsAt(f, "2024-05-10")!.period).toBe("2024.03");
    // 지연 추정(2024-03-30)보다 일찍 제출됐으면 그날부터 쓴다
    expect(trailingEpsAt(f, "2024-02-20")).toEqual({ eps: 1200, basis: "TTM", period: "2023.12" });
    expect(trailingEpsAt(f, "2024-02-14")).toEqual({ eps: 1000, basis: "연간", period: "2022.12" });
  });
  it("falls back to annual when the last four quarters with EPS are not consecutive", () => {
    const f: Fundamentals = { annual: [q("2023.12", 1500)], quarterly: [q("2023.06", 300), q("2023.09", 340), q("2023.12"), q("2024.03", 360), q("2024.06", 450)] };
    expect(trailingEpsAt(f)).toEqual({ eps: 1500, basis: "연간", period: "2023.12" });
  });
  it("uses a newer annual figure when the quarterly series stops earlier", () => {
    const f: Fundamentals = { annual: [q("2022.12", 900), q("2023.12", 1100)], quarterly: [q("2022.03", 200), q("2022.06", 220), q("2022.09", 230), q("2022.12", 250)] };
    expect(trailingEpsAt(f)).toEqual({ eps: 1100, basis: "연간", period: "2023.12" });
  });
  it("handles negative quarters, float noise and missing data", () => {
    const f: Fundamentals = { quarterly: [q("2023.09", 0.1), q("2023.12", 0.2), q("2024.03", -0.05), q("2024.06", 0.15)] };
    expect(trailingEpsAt(f)).toEqual({ eps: 0.4, basis: "TTM", period: "2024.06" });
    expect(trailingEpsAt(undefined, "2024-01-01")).toBeNull();
    expect(trailingEpsAt({}, "2024-01-01")).toBeNull();
    expect(trailingEpsAt({ eps: 5000 })).toBeNull(); // 기간 정보 없는 단일 EPS는 시점을 알 수 없어 쓰지 않는다
  });
  it("trailingRevenueAt follows the same rules", () => {
    expect(trailingRevenueAt(base, "2024-06-30")).toEqual({ revenue: 1100 + 1150 + 1250 + 1300, basis: "TTM", period: "2024.03" });
    expect(trailingRevenueAt(base, "2024-03-01")).toEqual({ revenue: 4000, basis: "연간", period: "2022.12" });
  });
});

describe("perHistory — 봉마다 그날 알 수 있었던 EPS", () => {
  const dates = weekdays("2023-03-27", 400);
  const candles = dates.map((d, i) => bar(d, 10_000 + i * 10));

  it("matches trailingEpsAt on every bar and changes EPS only on disclosure dates", () => {
    const h = perHistory(candles, base);
    expect(h).toHaveLength(candles.length);
    for (const p of h) {
      const t = trailingEpsAt(base, p.date);
      expect(p.eps).toBe(t?.eps ?? null);
      expect(p.per).toBe(t && t.eps > 0 ? p.close / t.eps : null);
    }
    expect(h[0]).toMatchObject({ date: "2023-03-27", eps: null, per: null }); // 2022.12 공시(2023-03-31) 전
    expect(h.find((p) => p.date === "2023-03-31")!.eps).toBe(1000);
    expect(h.find((p) => p.date === "2024-05-14")!.eps).toBe(1200);
    expect(h.find((p) => p.date === "2024-05-15")!.eps).toBe(1270);
  });
  it("matches per-bar evaluation with many filings, out-of-order filed dates and unsorted candles", () => {
    const quarters: PeriodFinancials[] = [];
    for (let y = 2019; y <= 2024; y++)
      for (const m of [3, 6, 9, 12]) {
        const period = `${y}.${String(m).padStart(2, "0")}`;
        // 일부는 제출일이 있고(앞 분기보다 먼저 제출된 경우 포함) 일부는 공시 지연으로 추정
        const filed = (y + m) % 3 === 0 ? `${y + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-${String(5 + ((y * m) % 20)).padStart(2, "0")}` : undefined;
        quarters.push(q(period, 100 + ((y * 7 + m) % 40) - 10, filed ? { filed } : {}));
      }
    // 2024.03 분기가 2023.12(사업보고서, 2024-03-30 추정)보다 먼저 제출된 경우
    quarters.find((p) => p.period === "2024.03")!.filed = "2024-03-20";
    const f: Fundamentals = { annual: [2018, 2019, 2020, 2021, 2022, 2023].map((y) => q(`${y}.12`, 400 + y - 2018)), quarterly: quarters };
    expect(trailingEpsAt(f, "2024-03-25")).toEqual({ eps: 404, basis: "연간", period: "2022.12" }); // 분기가 이어지지 않아 연간
    const cs = weekdays("2019-01-01", 1500).map((d, i) => bar(d, 5000 + (i % 50) * 10));
    const check = (list: Candle[]) => {
      const h = perHistory(list, f);
      h.forEach((p, i) => {
        expect(p.date).toBe(list[i]!.date);
        expect(p.eps).toBe(trailingEpsAt(f, p.date)?.eps ?? null);
      });
      return h;
    };
    const h = check(cs);
    expect(new Set(h.map((p) => p.eps)).size).toBeGreaterThan(10); // 실제로 여러 번 바뀐다
    check([...cs].reverse());
    check([cs[900]!, cs[10]!, cs[1400]!, cs[10]!]);
    expect(perHistory([], f)).toEqual([]);
  });
  it("gives a null PER when trailing EPS is zero or negative", () => {
    const f: Fundamentals = { annual: [q("2022.12", -50, { filed: "2023-02-01" }), q("2023.12", 0, { filed: "2024-02-01" })] };
    const h = perHistory([bar("2023-06-01", 5000), bar("2024-06-03", 5000)], f);
    expect(h.map((p) => [p.eps, p.per])).toEqual([[-50, null], [0, null]]);
  });
  it("has no look-ahead: a later filing never changes earlier bars, and truncating candles changes nothing", () => {
    const later: Fundamentals = { ...base, quarterly: [...base.quarterly!, q("2024.06", 5000, { filed: "2024-08-14" })] };
    const a = perHistory(candles, base), b = perHistory(candles, later);
    const cut = a.findIndex((p) => p.date >= "2024-08-14");
    expect(cut).toBeGreaterThan(0);
    expect(b.slice(0, cut)).toEqual(a.slice(0, cut));
    expect(b[cut]!.eps).not.toBe(a[cut]!.eps);
    expect(perHistory(candles.slice(0, 100), base)).toEqual(a.slice(0, 100));
  });
});

describe("perBand — 분포·위치·밴드선", () => {
  const ten = [10, 11, 12, 13, 14, 15, 16, 17, 18];
  const band = (last: number) => perBand(fromPers([...ten, last]), flatEps(), { minPoints: 5 });

  it("computes min / percentiles / median / max with linear interpolation", () => {
    const pers = Array.from({ length: 200 }, (_, i) => 10 + i * 0.05);
    const b = perBand(fromPers(pers), flatEps());
    expect(b.n).toBe(200);
    expect(b.stats!.min).toBeCloseTo(10);
    expect(b.stats!.p20).toBeCloseTo(10 + 0.05 * 199 * 0.2);
    expect(b.stats!.median).toBeCloseTo(10 + 0.05 * 199 * 0.5);
    expect(b.stats!.p80).toBeCloseTo(10 + 0.05 * 199 * 0.8);
    expect(b.stats!.max).toBeCloseTo(19.95);
    expect(b.current).toMatchObject({ eps: 100, price: 1995, basis: "연간", period: "2020.12" });
    expect(b.current!.per).toBeCloseTo(19.95);
    expect(b.position).toBe("above");
    expect(b.from).toBe("2024-01-02");
    expect(b.to).toBe(fromPers(pers).at(-1)!.date);
  });
  it("classifies the current PER into below / low / mid / high / above", () => {
    expect(band(9).position).toBe("below"); // 기간 최저를 새로 씀
    expect(band(10.5).position).toBe("low"); // p20 = 10.9
    expect(band(10.5).stats!.p20).toBeCloseTo(10.9);
    expect(band(14.5).position).toBe("mid");
    expect(band(17.5).position).toBe("high"); // p80 = 17.1
    expect(band(17.5).stats!.p80).toBeCloseTo(17.1);
    expect(band(19).position).toBe("above");
  });
  it("respects custom percentile params", () => {
    const b = perBand(fromPers([...ten, 11.5]), flatEps(), { minPoints: 5, lowPct: 30 });
    expect(b.stats!.p20).toBeCloseTo(11.85); // 30백분위: 위치 9×0.3=2.7 → 정렬값[2]=11.5와 [3]=12 사이 → 11.5 + 0.5×0.7
    expect(b.position).toBe("low");
    expect(b.bands[1]!.label).toBe("하단 30% 12배");
  });
  it("draws band lines as EPS-as-of-date × rounded multiple, skipping dates without positive EPS", () => {
    const dates = weekdays("2024-01-02", 12);
    const candles = dates.map((d, i) => bar(d, 1000 + i * 100));
    // 1월 9일에 EPS 100 공시, 1월 15일에 200으로 바뀜(그 전 날짜엔 EPS 없음)
    const f: Fundamentals = { annual: [q("2022.12", 100, { filed: "2024-01-09" }), q("2023.12", 200, { filed: "2024-01-15" })] };
    const b = perBand(candles, f, { minPoints: 3 });
    const h = perHistory(candles, f);
    const valid = h.filter((p) => p.per != null);
    expect(b.n).toBe(valid.length);
    expect(b.bands.map((x) => x.level)).toEqual(["min", "p20", "median", "p80", "max"]);
    for (const line of b.bands) {
      expect(line.multiple).toBe(roundMultiple(b.stats![line.level]));
      expect(line.points.map((p) => p.date)).toEqual(valid.map((p) => p.date));
      for (const p of line.points) {
        const eps = p.date >= "2024-01-15" ? 200 : 100;
        expect(p.price).toBeCloseTo(eps * line.multiple, 2);
      }
    }
    // EPS가 두 배가 되는 날 밴드 가격도 두 배
    const med = b.bands[2]!;
    const i = med.points.findIndex((p) => p.date === "2024-01-15");
    expect(med.points[i]!.price).toBeCloseTo(med.points[i - 1]!.price * 2, 2);
    expect(b.bands[0]!.label).toBe(`최저 ${b.bands[0]!.multiple}배`);
    expect(b.bands[2]!.label).toBe(`중앙 ${med.multiple}배`);
  });
  it("rounds multiples to two significant digits", () => {
    expect([7.34, 12.4, 12.6, 123, 0.567, 9.96].map(roundMultiple)).toEqual([7.3, 12, 13, 120, 0.57, 10]);
  });
  it("estimates a mean-reversion target from the median multiple", () => {
    const b = band(10.5);
    const m = roundMultiple(b.stats!.median);
    expect(b.target).toEqual({ multiple: m, price: 100 * m, upsidePct: ((100 * m) / 1050 - 1) * 100 });
  });
  it("uses only the last params.years of bars", () => {
    const dates = weekdays("2019-01-01", 1500); // 약 5.7년
    const candles = dates.map((d) => bar(d, 1000));
    const three = perBand(candles, flatEps(100), {});
    expect(PER_BAND_PARAMS.years).toBe(3);
    const last = dates.at(-1)!;
    const y = Number(last.slice(0, 4));
    expect(three.from! > `${y - 3}${last.slice(4)}`).toBe(true);
    expect(three.from! <= `${y - 3}-12-31`).toBe(true);
    expect(three.n).toBe(candles.filter((c) => c.date >= three.from!).length);
    const one = perBand(candles, flatEps(100), { years: 1 });
    expect(one.years).toBe(1);
    expect(one.n).toBeLessThan(three.n);
    expect(one.from! > `${y - 1}${last.slice(4)}`).toBe(true);
    // 기간 앞쪽 봉은 EPS 공시(2021-03-01) 전이라 표본에서 빠진다
    const all = perBand(candles, flatEps(100), { years: 10 });
    expect(all.from).toBe("2019-01-01");
    expect(all.n).toBe(candles.filter((c) => c.date >= "2021-03-01").length);
  });
  it("returns null stats (and no bands) when there are fewer than minPoints samples", () => {
    const b = perBand(fromPers([...ten, 12]), flatEps());
    expect(PER_BAND_PARAMS.minPoints).toBeGreaterThan(10);
    expect(b).toMatchObject({ n: 10, stats: null, bands: [], position: null, target: null });
    expect(b.current!.per).toBeCloseTo(12);
  });
  it("handles empty candles, missing EPS and losses", () => {
    expect(perBand([], flatEps())).toEqual({ years: 3, n: 0, from: null, to: null, current: null, stats: null, bands: [], position: null, target: null });
    const noEps = perBand(fromPers([10, 11, 12]), {}, { minPoints: 1 });
    expect(noEps).toMatchObject({ n: 0, current: null, stats: null, position: null });
    // 과거엔 흑자, 지금은 적자 → 분포는 있지만 현재 PER·위치는 없다
    const dates = weekdays("2024-01-02", 10);
    const f: Fundamentals = { annual: [q("2022.12", 100, { filed: "2023-03-01" }), q("2023.12", -20, { filed: "2024-01-10" })] };
    const loss = perBand(dates.map((d) => bar(d, 1000)), f, { minPoints: 3 });
    expect(loss.current).toMatchObject({ per: null, eps: -20 });
    expect(loss.n).toBe(dates.filter((d) => d < "2024-01-10").length);
    expect(loss.stats).not.toBeNull();
    expect(loss.position).toBeNull();
    expect(loss.target).toBeNull();
    for (const line of loss.bands) expect(line.points.every((p) => p.date < "2024-01-10")).toBe(true);
  });
  it("has no look-ahead: the band as of bar i ignores later bars and filings", () => {
    const dates = weekdays("2023-01-02", 400);
    const candles = dates.map((d, i) => bar(d, 8000 + Math.round(Math.sin(i / 15) * 1500)));
    const i = 250;
    const cut = candles.slice(0, i + 1);
    const asOf = cut.at(-1)!.date;
    const later: Fundamentals = { ...base, quarterly: [...base.quarterly!, q("2024.06", 9999, { filed: dates[i + 1]! })] };
    expect(perBand(cut, later, { minPoints: 20 })).toEqual(perBand(cut, base, { minPoints: 20 }));
    expect(perBand(cut, base, { minPoints: 20 }).to).toBe(asOf);
    // 미래 봉을 붙이면 결과가 달라질 수 있지만, 잘라 낸 결과는 그 이후 데이터와 무관하다
    expect(perBand(candles, later, { minPoints: 20 }).current!.eps).not.toBe(perBand(cut, later, { minPoints: 20 }).current!.eps);
  });
});

describe("psr — 시가총액 ÷ 최근 12개월 매출", () => {
  const f: Fundamentals = { ...base, marketCap: 96_000, amountUnit: "억원" };
  it("uses TTM revenue from four confirmed quarters", () => {
    expect(psr(f, { asOf: "2024-06-30" })).toEqual({ psr: 96_000 / 4800, revenue: 4800, basis: "TTM", period: "2024.03", marketCap: 96_000, unit: "억원" });
    expect(psr(f)!.psr).toBe(20);
  });
  it("falls back to the latest confirmed annual revenue", () => {
    expect(psr(f, { asOf: "2024-03-01" })).toEqual({ psr: 24, revenue: 4000, basis: "연간", period: "2022.12", marketCap: 96_000, unit: "억원" });
    const annualOnly: Fundamentals = { annual: base.annual, marketCap: 9000, amountUnit: "백만달러" };
    expect(psr(annualOnly)).toMatchObject({ psr: 2, basis: "연간", period: "2023.12", unit: "백만달러" });
  });
  it("accepts a market cap override in the same unit", () => {
    expect(psr(f, { marketCap: 48_000 })!.psr).toBe(10);
  });
  it("returns null rather than a wrong multiple when data or the unit is missing", () => {
    expect(psr({ ...f, amountUnit: undefined })).toBeNull(); // 단위를 모르면 계산하지 않는다
    expect(psr({ ...f, marketCap: undefined })).toBeNull();
    expect(psr({ ...f, marketCap: 0 })).toBeNull();
    expect(psr({ marketCap: 1000, amountUnit: "억원", annual: [q("2023.12", 10, { revenue: 0 })] })).toBeNull();
    expect(psr({ marketCap: 1000, amountUnit: "억원" })).toBeNull();
    expect(psr(f, { asOf: "2023-01-01" })).toBeNull(); // 그 시점엔 확정 매출이 없음
    expect(psr(undefined)).toBeNull();
  });
});

describe("sampleMarketFields — 샘플 모드 시가총액", () => {
  it("derives shares from net income ÷ EPS and the market cap from the price", () => {
    const f: Fundamentals = { annual: [q("2023.12", 5000, { netIncome: 750, revenue: 10_000 }), { period: "2024.12", estimate: true, eps: 9, netIncome: 9 }] };
    const s = sampleMarketFields(f, 50_000, "억원");
    expect(s).toEqual({ sharesOutstanding: 15_000_000, marketCap: 7500, amountUnit: "억원" });
    expect(psr({ ...f, ...s })!.psr).toBeCloseTo(0.75);
    expect(sampleMarketFields(f, 100, "백만달러")).toEqual({ sharesOutstanding: 150_000, marketCap: 15, amountUnit: "백만달러" });
  });
  it("returns {} when it cannot derive the fields", () => {
    expect(sampleMarketFields({}, 1000, "억원")).toEqual({});
    expect(sampleMarketFields({ annual: [q("2023.12", -10, { netIncome: -5 })] }, 1000, "억원")).toEqual({});
    expect(sampleMarketFields({ annual: [q("2023.12", 10, { netIncome: 5 })] }, 0, "억원")).toEqual({});
  });
});

describe("valuationNotes", () => {
  const stats = { min: 8, p20: 9, median: 11, p80: 13, max: 15 };
  const mk = (per: number | null, position: PerBand["position"], extra: Partial<PerBand> = {}): PerBand => ({
    years: 3, n: 500, from: "2021-07-01", to: "2024-06-28",
    current: { per, eps: per == null ? -100 : 1000, price: per == null ? 10_000 : per * 1000, basis: "TTM", period: "2024.03" },
    stats, bands: [], position,
    target: per == null ? null : { multiple: 11, price: 11_000, upsidePct: (11_000 / (per * 1000) - 1) * 100 },
    ...extra,
  });
  const ps = (x: number): PsrResult => ({ psr: x, revenue: 100, basis: "TTM", period: "2024.03", marketCap: x * 100, unit: "억원" });
  const rules = (ns: Note[]) => ns.map((n) => `${n.tone}:${n.rule}`);
  const CHEAP = "warn:3.3 강영현·최병운·와인스타인·강동진";

  it("flags a value candidate (M2-09) at or below the lower band, with a mean-reversion target", () => {
    const ns = valuationNotes({ band: mk(8.5, "low"), psr: null, epsGrowthPositive: true, growthGroup: "A" });
    expect(rules(ns)).toEqual(["good:M2-09 강영현·최병운", "info:3.3 최병운"]);
    expect(ns[0]!.text).toContain("8.5배");
    expect(ns[0]!.text).toContain("하위 20% 9배");
    expect(ns[1]!.text).toContain("중앙값 11배");
    expect(ns[1]!.text).toContain("29%"); // 11 / 8.5 - 1
    const below = valuationNotes({ band: mk(8, "below"), psr: null, epsGrowthPositive: true });
    expect(below[0]!.tone).toBe("good");
    expect(below[0]!.text).toContain("최저(8배)");
  });
  it("adds the common warning when growth is negative or unknown", () => {
    const neg = valuationNotes({ band: mk(8.5, "low"), psr: null, epsGrowthPositive: false });
    expect(rules(neg)).toEqual(["good:M2-09 강영현·최병운", "info:3.3 최병운", CHEAP]);
    expect(neg[2]!.text).toContain("이익 성장이 받쳐주지 않는데");
    expect(neg[2]!.text).toContain("PER이 낮다는 이유만으로 사지 마세요");
    const groupB = valuationNotes({ band: mk(8.5, "low"), psr: null, epsGrowthPositive: true, growthGroup: "B" });
    expect(groupB.at(-1)!.text).toContain("이익 성장이 받쳐주지 않는데");
    const unknown = valuationNotes({ band: mk(8.5, "low"), psr: null });
    expect(unknown.at(-1)).toMatchObject({ tone: "warn", rule: "3.3 강영현·최병운·와인스타인·강동진" });
    expect(unknown.at(-1)!.text).toContain("이익 성장을 확인하지 못했어요");
    expect(valuationNotes({ band: mk(8.5, "low"), psr: null, growthGroup: "A" }).some((n) => n.tone === "warn")).toBe(false);
  });
  it("warns at or above the upper band and stays informational in the middle", () => {
    const high = valuationNotes({ band: mk(13.5, "high"), psr: null });
    expect(rules(high)).toEqual(["warn:3.3 강영현"]);
    expect(high[0]!.text).toContain("상위 20% 13배");
    expect(high[0]!.text).toContain("유동성 장세");
    expect(valuationNotes({ band: mk(15, "above"), psr: null })[0]!.text).toContain("최고(15배)");
    const mid = valuationNotes({ band: mk(11, "mid"), psr: null, epsGrowthPositive: false });
    expect(rules(mid)).toEqual(["info:3.3 강영현"]); // 싸지 않으면 공통 경고도 없다
    expect(mid[0]!.text).toContain("9~13배");
  });
  it("explains losses and short histories", () => {
    expect(rules(valuationNotes({ band: mk(null, null), psr: null }))).toEqual(["info:3.3 강영현"]);
    const short = valuationNotes({ band: mk(9, null, { stats: null, n: 40 }), psr: null });
    expect(rules(short)).toEqual(["info:M2-09 강영현·최병운"]);
    expect(short[0]!.text).toContain("40거래일");
    expect(valuationNotes({ band: null, psr: null })).toEqual([]);
    expect(valuationNotes({ band: { ...mk(9, "low"), current: null, position: null }, psr: null })).toEqual([]);
  });
  it("notes a safety margin below the market-average PER, with a single common warning", () => {
    const ns = valuationNotes({ band: mk(8.5, "low"), psr: null, marketPer: 9, epsGrowthPositive: false });
    expect(rules(ns)).toEqual(["good:M2-09 강영현·최병운", "info:3.3 최병운", "good:3.3 최병운", CHEAP]);
    expect(ns[2]!.text).toContain("안전마진");
    expect(rules(valuationNotes({ band: mk(11, "mid"), psr: null, marketPer: 12, epsGrowthPositive: true }))).toEqual(["info:3.3 강영현", "good:3.3 최병운"]);
    expect(valuationNotes({ band: mk(11, "mid"), psr: null, marketPer: 9 }).some((n) => n.text.includes("안전마진"))).toBe(false);
  });
  it("PSR: bubble warning in a rising-rate period (M2-10), softer without rate info, and the 10x note", () => {
    const R = VALUATION_RULES;
    expect(R).toEqual({ psrBubble: 20, psrHigh: 10 });
    expect(valuationNotes({ band: null, psr: ps(25), rateRising: true })).toEqual([{ tone: "bad", text: "PSR 25배 — 금리 상승기에 PSR 20배 이상은 거품 경고예요", rule: "M2-10 강영현" }]);
    expect(rules(valuationNotes({ band: null, psr: ps(20), rateRising: null }))).toEqual(["warn:M2-10 강영현"]);
    expect(rules(valuationNotes({ band: null, psr: ps(20) }))).toEqual(["warn:M2-10 강영현"]);
    expect(rules(valuationNotes({ band: null, psr: ps(30), rateRising: false }))).toEqual(["info:M2-10 강영현"]);
    const ten = valuationNotes({ band: null, psr: ps(12.3), rateRising: true });
    expect(rules(ten)).toEqual(["info:3.3 김연수"]);
    expect(ten[0]!.text).toContain("산업 태동기");
    expect(valuationNotes({ band: null, psr: ps(9.9), rateRising: true })).toEqual([]);
  });
  it("writes every note in polite Korean with a rule id and author", () => {
    const all = [
      ...valuationNotes({ band: mk(8.5, "low"), psr: ps(25), rateRising: true, marketPer: 9 }),
      ...valuationNotes({ band: mk(13.5, "high"), psr: ps(25) }),
      ...valuationNotes({ band: mk(11, "mid"), psr: ps(25), rateRising: false }),
      ...valuationNotes({ band: mk(null, null), psr: ps(12) }),
      ...valuationNotes({ band: mk(9, null, { stats: null }), psr: null, epsGrowthPositive: false }),
    ];
    expect(all.length).toBeGreaterThan(8);
    for (const n of all) {
      expect(n.text).toMatch(/요(\([^)]*\))?$/);
      expect(n.rule).toMatch(/^(M2-\d{2}|3\.3) \S+/);
    }
  });
  it("works end to end with perBand and psr", () => {
    const pers = [...Array.from({ length: 150 }, (_, i) => 10 + (i % 30) * 0.2), 9.5];
    const b = perBand(fromPers(pers), flatEps());
    expect(b.position).toBe("below");
    const p = psr({ ...flatEps(), annual: [q("2020.12", 100, { revenue: 50, filed: "2021-03-01" })], marketCap: 1100, amountUnit: "억원" });
    const ns = valuationNotes({ band: b, psr: p, rateRising: true, epsGrowthPositive: true });
    expect(rules(ns)).toEqual(["good:M2-09 강영현·최병운", "info:3.3 최병운", "bad:M2-10 강영현"]);
  });
});
