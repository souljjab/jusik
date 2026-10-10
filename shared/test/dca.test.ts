import { describe, expect, it } from "vitest";
import {
  DCA_NOTE_PARAMS,
  DCA_TARGETS,
  DEFAULT_DCA,
  dcaNotes,
  dcaPlanToday,
  dividendSchedule,
  simulateDca,
  type DcaParams,
} from "../src/dca";
import type { Candle } from "../src/types";

const day = (i: number) => new Date(Date.UTC(2023, 0, 2) + i * 86_400_000).toISOString().slice(0, 10);

/** [시가, 고가, 저가, 종가] 목록으로 일봉을 만든다 */
function bars(rows: [number, number, number, number][]): Candle[] {
  return rows.map(([open, high, low, close], i) => ({ date: day(i), open, high, low, close, volume: 1000 }));
}

/** 종가 목록으로 일봉을 만든다(시가=전일 종가, 고가·저가는 종가 ±0.5%) */
function fromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => {
    const o = i > 0 ? closes[i - 1]! : c;
    return { date: day(i), open: o, high: Math.max(o, c) * 1.005, low: Math.min(o, c) * 0.995, close: c, volume: 1000 };
  });
}

/** 재현 가능한 의사 난수 걷기 */
function randomWalk(n: number, seed: number, drift = 0): number[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const out = [10_000];
  for (let i = 1; i < n; i++) out.push(Math.max(100, out[i - 1]! * (1 + drift + (rnd() - 0.5) * 0.04)));
  return out;
}

const NO_COST: Partial<DcaParams> = { feeRate: 0, sellTaxRate: 0, slippagePct: 0 };
const flat = (n: number, px = 10_000): [number, number, number, number][] => Array.from({ length: n }, () => [px, px, px, px]);

describe("dcaPlanToday", () => {
  it("책 예시: 50만 원을 20일에 나누면 하루 2만 5,000원", () => {
    const r = dcaPlanToday({ capital: 500_000, days: 20, dayIndex: 0, price: 10_000, carry: 0 });
    expect(r.dailyLimit).toBe(25_000);
    expect(r.shares).toBe(2);
    expect(r.spend).toBe(20_000);
    expect(r.carry).toBe(5_000);
  });

  it("한도보다 비싼 주식은 자투리를 모아 다음 날 산다", () => {
    const d0 = dcaPlanToday({ capital: 500_000, days: 20, dayIndex: 0, price: 30_000, carry: 0 });
    expect(d0).toMatchObject({ shares: 0, spend: 0, carry: 25_000 });
    const d1 = dcaPlanToday({ capital: 500_000, days: 20, dayIndex: 1, price: 30_000, carry: d0.carry });
    expect(d1).toMatchObject({ shares: 1, spend: 30_000, carry: 20_000 });
  });

  it("수수료를 넣으면 그만큼 덜 산다", () => {
    const r = dcaPlanToday({ capital: 200_000, days: 20, dayIndex: 0, price: 5_000, carry: 0, feeRate: 0.01 });
    expect(r.shares).toBe(1); // 10,000 / 5,050
    expect(r.spend).toBeCloseTo(5_050);
    expect(r.carry).toBeCloseTo(4_950);
  });

  it("매수 기간이 끝나면 사지 않고 자투리는 그대로 둔다", () => {
    expect(dcaPlanToday({ capital: 500_000, days: 20, dayIndex: 20, price: 1_000, carry: 7_000 })).toMatchObject({ shares: 0, spend: 0, carry: 7_000 });
  });

  it("시세가 없으면 오늘 한도를 자투리로 넘긴다", () => {
    expect(dcaPlanToday({ capital: 500_000, days: 20, dayIndex: 3, price: 0, carry: 1_000 })).toMatchObject({ shares: 0, carry: 26_000 });
  });
});

describe("dividendSchedule", () => {
  it("기준일 2영업일 전까지 살 수 있는 날로 나눈다", () => {
    // 기준일이 11영업일 뒤 → 오늘 포함 10일 동안 살 수 있다
    expect(dividendSchedule(1_000_000, 11)).toBe(100_000);
    // 모레가 기준일이면 오늘이 마지막 매수일
    expect(dividendSchedule(1_000_000, 2)).toBe(1_000_000);
  });
  it("이미 늦었으면 0", () => {
    expect(dividendSchedule(1_000_000, 1)).toBe(0);
    expect(dividendSchedule(1_000_000, 0)).toBe(0);
    expect(dividendSchedule(0, 10)).toBe(0);
  });
});

describe("simulateDca", () => {
  it("입력이 부족하거나 파라미터가 잘못되면 null", () => {
    expect(simulateDca(bars(flat(1)))).toBeNull();
    expect(simulateDca(bars(flat(5)), { capital: 0 })).toBeNull();
    expect(simulateDca(bars(flat(5)), { days: 0 })).toBeNull();
    expect(simulateDca(bars(flat(5)), { targetPct: 0 })).toBeNull();
  });

  it("손으로 계산한 사이클: 4일 분할 매수 후 목표가에 전량 매도", () => {
    // 10만 원 / 4일 = 하루 2만 5,000원, 주가 1만 원 → 2·3·2·3주(자투리 이월), 평균 단가 1만 원
    const cs = bars([...flat(4), [10_000, 10_800, 10_000, 10_500], ...flat(2, 10_500)]);
    const r = simulateDca(cs, { ...NO_COST, capital: 100_000, days: 4, targetPct: 7 })!;
    const c1 = r.cycles[0]!;
    expect(c1).toMatchObject({ start: day(0), end: day(4), tradingDays: 5, shares: 10, invested: 100_000, avgCost: 10_000 });
    expect(c1.exitPrice).toBeCloseTo(10_700); // max(시가 10,000, 목표가 10,700)
    expect(c1.pnl).toBeCloseTo(7_000);
    expect(c1.returnPct).toBeCloseTo(7);
    // 매도 다음 날 새 사이클 시작
    expect(r.cycles[1]!.start).toBe(day(5));
    expect(r.openCycle).toBe(r.cycles[1]);
    expect(r.completedCycles).toBe(1);
    expect(r.avgDaysPerCycle).toBe(5);
  });

  it("시가가 목표가 위로 갭 상승하면 시가에 판다", () => {
    const cs = bars([...flat(2), [11_000, 11_200, 10_900, 11_100], ...flat(1, 11_100)]);
    const r = simulateDca(cs, { ...NO_COST, capital: 100_000, days: 4, targetPct: 7 })!;
    expect(r.cycles[0]!.exitPrice).toBe(11_000);
  });

  it("같은 날 산 수량은 그날 매도 판단에 넣지 않는다", () => {
    // 0일 10,000에 2주. 1일: 고가 10,500(<10,700)이고 종가 9,000에 추가 매수 → 평균 단가 약 9,400
    // 같은 날 매수분을 넣으면 1일에 이미 목표(약 10,060)를 넘지만, 규칙상 2일에야 판다
    const cs = bars([
      [10_000, 10_000, 10_000, 10_000],
      [9_000, 10_500, 9_000, 9_000],
      [9_000, 10_500, 9_000, 9_000],
      [9_000, 9_000, 9_000, 9_000],
    ]);
    const r = simulateDca(cs, { ...NO_COST, capital: 100_000, days: 4, targetPct: 7 })!;
    const c1 = r.cycles[0]!;
    expect(c1.end).toBe(day(2));
    // 0일 2주(20,000) + 1일 3주(27,000, 자투리 5,000 포함 30,000 한도)
    expect(c1.shares).toBe(5);
    expect(c1.avgCost).toBeCloseTo(9_400);
    expect(c1.exitPrice).toBeCloseTo(9_400 * 1.07);
  });

  it("상승장에서는 사이클을 여러 번 반복한다", () => {
    const closes = Array.from({ length: 250 }, (_, i) => 10_000 * 1.004 ** i);
    const r = simulateDca(fromCloses(closes), { capital: 10_000_000 })!;
    expect(r.completedCycles).toBeGreaterThanOrEqual(5);
    for (const cy of r.cycles.filter((c) => c.end)) {
      expect(cy.returnPct!).toBeGreaterThan(6); // 목표 7%에서 비용만큼 덜
      expect(cy.returnPct!).toBeLessThan(7.5);
    }
    expect(r.totalReturnPct).toBeGreaterThan(0);
    expect(r.avgDaysPerCycle).not.toBeNull();
  });

  it("하락장에서는 예산을 다 쓴 뒤 목표까지 보유만 한다", () => {
    const closes = Array.from({ length: 120 }, (_, i) => 10_000 * 0.995 ** i);
    const cs = fromCloses(closes);
    const r = simulateDca(cs, { capital: 1_000_000, days: 20 })!;
    expect(r.completedCycles).toBe(0);
    const o = r.openCycle!;
    expect(o.end).toBeNull();
    expect(o.tradingDays).toBe(120);
    expect(o.invested).toBeLessThanOrEqual(o.budget);
    // 남은 돈은 마지막 매수일 주가 1주 값보다 적다(사실상 소진)
    expect(o.budget - o.invested).toBeLessThan(closes[19]! * 1.01);
    // 20일 이후로는 현금이 그대로 → 자산 변화는 보유 주식 평가액 변화뿐
    const cashAt = (i: number) => r.equity[i]!.equity - o.shares * cs[i]!.close;
    for (let i = 20; i < cs.length; i++) expect(cashAt(i)).toBeCloseTo(cashAt(19), 6);
    expect(r.maxDrawdownPct).toBeLessThan(0);
    expect(r.totalReturnPct).toBeGreaterThan(r.buyHoldReturnPct); // 분할 매수가 낙폭을 줄인다
  });

  it("비용(수수료·세금·슬리피지)을 반영한다", () => {
    const cs = bars([...flat(4), [10_000, 10_800, 10_000, 10_500], ...flat(2, 10_500)]);
    const base = { capital: 100_000, days: 4, targetPct: 7 };
    const free = simulateDca(cs, { ...base, ...NO_COST })!;
    const paid = simulateDca(cs, { ...base, feeRate: 0.001, sellTaxRate: 0.002, slippagePct: 0.1 })!;
    const c = paid.cycles[0]!;
    // 매수: 체결가 10,010, 단가(수수료 포함) 10,020.01 → 하루 2·2·3·2주 = 9주
    expect(c.shares).toBe(9);
    expect(c.avgCost).toBeCloseTo(10_010);
    expect(c.invested).toBeCloseTo(9 * 10_010 * 1.001);
    // 매도: 목표가 10,010×1.07에서 슬리피지 0.1%, 수수료·세금 0.3%
    const px = 10_010 * 1.07 * 0.999;
    expect(c.exitPrice).toBeCloseTo(px);
    expect(c.pnl).toBeCloseTo(9 * px * (1 - 0.003) - 9 * 10_010 * 1.001);
    expect(c.returnPct!).toBeLessThan(free.cycles[0]!.returnPct!);
    expect(paid.finalEquity).toBeLessThan(free.finalEquity);
  });

  it("reinvest를 켜면 원금+수익으로, 끄면 원금만으로 재시작한다", () => {
    const closes = Array.from({ length: 200 }, (_, i) => 10_000 * 1.004 ** i);
    const cs = fromCloses(closes);
    const on = simulateDca(cs, { capital: 1_000_000, reinvest: true })!;
    const off = simulateDca(cs, { capital: 1_000_000, reinvest: false })!;
    expect(on.completedCycles).toBeGreaterThanOrEqual(2);
    expect(off.completedCycles).toBeGreaterThanOrEqual(2);
    // 첫 사이클은 같다
    expect(on.cycles[0]).toEqual(off.cycles[0]);
    expect(on.cycles[1]!.budget).toBeGreaterThan(1_000_000);
    expect(off.cycles[1]!.budget).toBe(1_000_000);
    for (const cy of off.cycles) expect(cy.budget).toBeLessThanOrEqual(1_000_000);
    expect(on.finalEquity).toBeGreaterThan(off.finalEquity);
  });

  it("단순 보유와 비교하고 성과 지표를 낸다", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 10_000 * 1.004 ** i);
    const r = simulateDca(fromCloses(closes))!;
    expect(r.equity).toHaveLength(300);
    expect(r.buyHoldReturnPct).toBeGreaterThan(r.totalReturnPct); // 꾸준한 상승장에선 전액 보유가 낫다
    expect(r.cagrPct).toBeGreaterThan(0);
    expect(r.maxDrawdownPct).toBeLessThanOrEqual(0);
    expect(r.params).toEqual(DEFAULT_DCA);
  });

  it("미래 데이터를 바꿔도 i일까지의 결과는 같다(미래 참조 없음)", () => {
    const closes = randomWalk(300, 7, 0.0005);
    const full = fromCloses(closes);
    const k = 180;
    const altered = [...full.slice(0, k + 1), ...fromCloses(randomWalk(300, 99, -0.002)).slice(k + 1)].map((c, i) => ({ ...c, date: day(i) }));
    const truncated = full.slice(0, k + 1);
    for (const reinvest of [false, true]) {
      const a = simulateDca(full, { reinvest })!;
      const b = simulateDca(altered, { reinvest })!;
      const t = simulateDca(truncated, { reinvest })!;
      expect(a.equity.slice(0, k + 1)).toEqual(b.equity.slice(0, k + 1));
      expect(a.equity.slice(0, k + 1)).toEqual(t.equity);
      // k일 이전에 끝난 사이클은 똑같다
      const closedBy = (r: typeof a) => r.cycles.filter((c) => c.end != null && c.end <= day(k));
      expect(closedBy(a).length).toBeGreaterThan(0);
      expect(closedBy(a)).toEqual(closedBy(b));
      expect(closedBy(a)).toEqual(closedBy(t));
    }
  });
});

describe("dcaNotes", () => {
  it("완료 사이클 수와 평균 소요일을 규칙 ID와 함께 알려준다", () => {
    const closes = Array.from({ length: 250 }, (_, i) => 10_000 * 1.004 ** i);
    const r = simulateDca(fromCloses(closes))!;
    const notes = dcaNotes(r);
    expect(notes.every((n) => n.rule)).toBe(true);
    expect(notes.some((n) => n.rule === "M3-19 헬로마녀" && n.text.includes(`사이클 ${r.completedCycles}회`))).toBe(true);
    expect(notes.some((n) => n.tone === "good" && n.text.includes("사이클 평균 수익"))).toBe(true);
  });

  it("목표에 오래 못 닿은 진행 중 사이클을 경고한다", () => {
    const closes = Array.from({ length: DCA_NOTE_PARAMS.staleDays + 20 }, (_, i) => 10_000 * 0.997 ** i);
    const r = simulateDca(fromCloses(closes))!;
    const notes = dcaNotes(r);
    expect(notes.some((n) => n.tone === "warn" && n.text.includes("아직 목표"))).toBe(true);
    expect(notes.some((n) => n.tone === "warn" && n.text.includes("영업일째 목표에 못 미쳐요"))).toBe(true);
    expect(notes.some((n) => n.rule === "4.9 헬로마녀" && n.text.includes("손절"))).toBe(true);
    // 둘 다 손실이면 "나았어요" 대신 "손실이 작았어요"
    expect(r.totalReturnPct).toBeLessThan(0);
    expect(notes.some((n) => n.tone === "info" && n.text.includes("손실이 작았어요"))).toBe(true);
  });

  it("목표에 너무 빨리 닿아 예산을 조금만 쓰면 알려준다", () => {
    const closes = Array.from({ length: 120 }, (_, i) => 10_000 * 1.004 ** i);
    const r = simulateDca(fromCloses(closes), { targetPct: 1 })!;
    expect(r.completedCycles).toBeGreaterThan(5);
    expect(dcaNotes(r).some((n) => n.text.includes("예산의 평균"))).toBe(true);
  });

  it("목표가 책 기준보다 높으면 경고하고, 1주도 못 사면 알려준다", () => {
    const r = simulateDca(bars(flat(30, 1_000_000)), { capital: 500_000, targetPct: DCA_TARGETS.small + 10 })!;
    expect(r.openCycle!.shares).toBe(0);
    const notes = dcaNotes(r);
    expect(notes.some((n) => n.text.includes("책 기준"))).toBe(true);
    expect(notes.some((n) => n.text.includes("1주도 사지 못했어요"))).toBe(true);
  });
});
