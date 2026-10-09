import type { Fundamentals, Reason, ScoreResult } from "./types";

/** 재무 지표로 가치/성장 점수(-100~100)를 낸다. 데이터가 하나도 없으면 null. */
export function valuationScore(f: Fundamentals | undefined): ScoreResult | null {
  if (!f) return null;
  const reasons: Reason[] = [];
  const add = (points: number, text: string) => reasons.push({ points, text });
  let maxAbs = 0;
  const use = (n: number) => (maxAbs += n);

  if (f.per != null) {
    use(20);
    if (f.per <= 0) add(-20, `PER ${f.per.toFixed(1)}: 적자`);
    else if (f.per < 10) add(20, `PER ${f.per.toFixed(1)}: 저평가 구간`);
    else if (f.per < 15) add(10, `PER ${f.per.toFixed(1)}: 무난`);
    else if (f.per > 30) add(-15, `PER ${f.per.toFixed(1)}: 고평가(성장 근거 필요)`);
  }
  if (f.pbr != null) {
    use(15);
    if (f.pbr < 1) add(15, `PBR ${f.pbr.toFixed(2)}: 청산가치 이하`);
    else if (f.pbr < 2) add(5, `PBR ${f.pbr.toFixed(2)}: 무난`);
    else if (f.pbr > 4) add(-10, `PBR ${f.pbr.toFixed(2)}: 자산 대비 고평가`);
  }
  if (f.roe != null) {
    use(20);
    if (f.roe >= 15) add(20, `ROE ${f.roe.toFixed(1)}%: 높은 수익성`);
    else if (f.roe >= 8) add(10, `ROE ${f.roe.toFixed(1)}%: 양호`);
    else if (f.roe < 0) add(-20, `ROE ${f.roe.toFixed(1)}%: 적자`);
    else if (f.roe < 5) add(-10, `ROE ${f.roe.toFixed(1)}%: 낮은 수익성`);
  }
  if (f.revenueGrowth != null) {
    use(15);
    if (f.revenueGrowth >= 20) add(15, `매출 증가율 ${f.revenueGrowth.toFixed(1)}%: 고성장`);
    else if (f.revenueGrowth >= 5) add(5, `매출 증가율 ${f.revenueGrowth.toFixed(1)}%: 성장`);
    else if (f.revenueGrowth < 0) add(-10, `매출 증가율 ${f.revenueGrowth.toFixed(1)}%: 역성장`);
  }
  if (f.opIncomeGrowth != null) {
    use(15);
    if (f.opIncomeGrowth >= 20) add(15, `영업이익 증가율 ${f.opIncomeGrowth.toFixed(1)}%: 실적 개선`);
    else if (f.opIncomeGrowth >= 5) add(5, `영업이익 증가율 ${f.opIncomeGrowth.toFixed(1)}%: 소폭 개선`);
    else if (f.opIncomeGrowth < 0) add(-10, `영업이익 증가율 ${f.opIncomeGrowth.toFixed(1)}%: 실적 악화`);
  }
  if (f.debtRatio != null) {
    use(15);
    if (f.debtRatio > 200) add(-15, `부채비율 ${f.debtRatio.toFixed(0)}%: 재무 부담`);
    else if (f.debtRatio < 100) add(5, `부채비율 ${f.debtRatio.toFixed(0)}%: 안정적`);
  }

  if (maxAbs === 0) return null;
  const raw = reasons.reduce((a, r) => a + r.points, 0);
  // 확인된 지표의 만점 대비 비율로 정규화
  const score = Math.max(-100, Math.min(100, Math.round((raw / maxAbs) * 100)));
  return { score, reasons };
}
