import { describe, expect, it } from "vitest";
import { prepareStage, relativeStrength, runStrategy, stageAt, toWeekly, weinsteinStrategy, type Candle } from "../src";

/** 주별 종가 수준 → 월~금 일봉(고가 +1%, 저가 −1%). volAt[주] = 그 주 일 거래량 */
function fromWeeks(levels: number[], volAt: Record<number, number> = {}, vol = 1000): Candle[] {
  const out: Candle[] = [];
  levels.forEach((L, w) => {
    for (let d = 0; d < 5; d++) {
      const t = Date.UTC(2022, 0, 3) + (w * 7 + d) * 86_400_000;
      out.push({ date: new Date(t).toISOString().slice(0, 10), open: L, high: L * 1.01, low: L * 0.99, close: L, volume: volAt[w] ?? vol });
    }
  });
  return out;
}
const geo = (a: number, r: number, n: number) => Array.from({ length: n }, (_, i) => a * r ** i);
const ramp = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 1)) / n);
const noCost = { feeRate: 0, sellTaxRate: 0, slippagePct: 0 };

describe("stage rules — M3-01 RS > 0 and M2-11 rising 30-week MA", () => {
  it("does not buy a stage-2 volume breakout when relative strength is not positive (M3-01)", () => {
    const index = fromWeeks(geo(100, 1.015, 72));
    const levels = geo(100, 1.006, 72);
    levels[70] = levels[69]! * 1.06;
    levels[71] = levels[70]!;
    const stock = fromWeeks(levels, { 70: 3000 });
    const weekly = toWeekly(stock);
    const rs = relativeStrength(weekly, toWeekly(index));
    const r = stageAt(prepareStage(weekly), 70, rs)!;
    expect(r.stage).toBe(2);
    expect(r.breakout && r.volumeBasis).toBeTruthy();
    expect(r.rs!).toBeLessThan(0);
    expect(r.action).toBe("HOLD");
    expect(r.notes.some((n) => n.rule === "M3-01 와인스타인" && n.text.includes("상대강도가 0 이하"))).toBe(true);
    // 같은 종목이 지수보다 강하면 돌파 매수
    const strong = stageAt(prepareStage(weekly), 70, rs.map((x) => (x == null ? x : Math.abs(x) + 1)))!;
    expect(strong.action).toBe("STRONG_BUY");
    // 전략도 그 주 마감 봉(70주 금요일)에 진입 주문을 내지 않는다
    const strat = weinsteinStrategy();
    expect(strat.entry(70 * 5 + 4, strat.prepare(stock, { index }))).toBeNull();
  });

  it("does not buy a stage-1 breakout or a pullback while the 30-week MA is still falling (M2-11)", () => {
    const levels = [...ramp(200, 100, 40), ...Array(20).fill(100), 112, 113, 105, 106];
    const stock = fromWeeks(levels, { 60: 3000 });
    const ctx = prepareStage(toWeekly(stock));
    const b = stageAt(ctx, 60)!;
    expect(b.slopePct).toBeLessThan(-0.5);
    expect(b.breakout && b.volumeBasis).toBeTruthy();
    expect(b.action).toBe("HOLD");
    expect(b.notes.some((n) => n.rule === "M2-11 와인스타인")).toBe(true);
    expect(stageAt(ctx, 62)!.pullbackBuy).toBe(false);
    const bt = runStrategy(weinsteinStrategy({ useRegime: false }), stock, {}, noCost)!;
    expect(bt.tradeCount + (bt.openPosition ? 1 : 0)).toBe(0);
  });
});
