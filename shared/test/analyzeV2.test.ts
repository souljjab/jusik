import { describe, expect, it } from "vitest";
import { analyze, marketRegime, type Candle, type Fundamentals, type MacroSnapshot } from "../src";

const ramp = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 1)) / n);

/** 주별 종가 수준 배열 -> 월~금 5일짜리 일봉 */
function fromWeeks(levels: number[], vol = 1000): Candle[] {
  const out: Candle[] = [];
  levels.forEach((L, w) => {
    for (let d = 0; d < 5; d++) {
      const t = Date.UTC(2022, 0, 3) + (w * 7 + d) * 86_400_000;
      out.push({ date: new Date(t).toISOString().slice(0, 10), open: L, high: L * 1.01, low: L * 0.99, close: L, volume: vol });
    }
  });
  return out;
}

const bull = fromWeeks(ramp(100, 160, 80));
/** 지수보다 조금 더 올라 상대강도가 플러스(M3-01: RS > 0일 때만 매수) */
const stockUp = fromWeeks(ramp(100, 175, 80));
/** 30주선이 평평한 횡보 끝에 최근 몇 주 밀린 지수(중립 국면 + MACD 약세) */
const sideways = fromWeeks([...ramp(100, 130, 30), ...Array.from({ length: 46 }, (_, i) => (i % 2 ? 131 : 129)), ...ramp(129, 124, 4)]);
const badMacro: MacroSnapshot = { asOf: "2023-07-01", yieldSpread: { value: -0.8, date: "2023-07-01" }, vix: { value: 42, date: "2023-07-01" } };

describe("analyze — posture, daily signals, hard exclusions", () => {
  it("reports the regime posture and its exposure cap", () => {
    const a = analyze({ candles: stockUp, indexCandles: bull, postureCaps: { ATTACK: 70, NEUTRAL: 40, DEFENSE: 10 } })!;
    expect(a.posture).not.toBeNull();
    expect(a.posture!.exposureCapPct).toBe({ ATTACK: 70, NEUTRAL: 40, DEFENSE: 10 }[a.posture!.posture]);
    expect(analyze({ candles: stockUp })!.posture).toBeNull();
  });

  it("drops a buy to HOLD when the fundamentals hit a hard exclusion (M2-01)", () => {
    const ok = analyze({ candles: stockUp, indexCandles: bull })!;
    expect(["BUY", "STRONG_BUY"]).toContain(ok.action);
    const f: Fundamentals = { debtRatio: 450, currentRatio: 120, per: 8 };
    const a = analyze({ candles: stockUp, indexCandles: bull, fundamentals: f })!;
    expect(a.screening.excluded).toBe(true);
    expect(a.action).toBe("HOLD");
    expect(a.gates.some((g) => g.rule === "M2-01 설춘환" && g.tone === "bad")).toBe(true);
  });

  it("downgrades a buy one step in a defensive posture even when the index is not bearish", () => {
    expect(marketRegime(sideways)!.regime).not.toBe("BEAR");
    const calm = analyze({ candles: stockUp, indexCandles: sideways })!;
    const tense = analyze({ candles: stockUp, indexCandles: sideways, macro: badMacro, region: "US" })!;
    expect(calm.posture!.posture).not.toBe("DEFENSE");
    expect(calm.action).toBe("BUY");
    expect(tense.posture!.posture).toBe("DEFENSE");
    expect(tense.posture!.breakdown.macro).toBe(-2);
    expect(tense.timingAction).toBe("BUY");
    expect(tense.action).toBe("HOLD");
    expect(tense.gates.some((g) => g.rule === "2.5 강동진")).toBe(true);
  });

  it("adds daily signals with rule ids and never changes the action because of them", () => {
    const a = analyze({ candles: stockUp, indexCandles: bull })!;
    expect(Array.isArray(a.dailySignals)).toBe(true);
    for (const s of a.dailySignals) expect(s.id).toMatch(/^(M\d-\d{2}|\d\.\d)/);
    const b = analyze({ candles: stockUp, indexCandles: bull })!;
    expect(b.action).toBe(a.action);
  });

  it("adds the valuation block (PER band·PSR) and the candle-master weekly result without changing the action", () => {
    const f: Fundamentals = {
      amountUnit: "억원", marketCap: 30_000,
      annual: [
        { period: "2022.12", estimate: false, revenue: 9_000, eps: 900 },
        { period: "2023.12", estimate: false, revenue: 10_000, eps: 1_000 },
      ],
    };
    const a = analyze({ candles: stockUp, indexCandles: bull, fundamentals: f, macro: { asOf: "2023-07-01", rateRising: true } })!;
    expect(a.valuation.psr).toMatchObject({ psr: 3, basis: "연간" });
    expect(a.valuation.band.n).toBeGreaterThan(0);
    expect(Array.isArray(a.valuation.notes)).toBe(true);
    expect(a.candleMaster === null || typeof a.candleMaster.valid === "boolean").toBe(true);
    expect(a.action).toBe(analyze({ candles: stockUp, indexCandles: bull })!.action);
  });
});
