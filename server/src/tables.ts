import {
  currencyOfRegion, evaluateTrades, expectancy, paperEquity, paperTradesFromJournal, POSTURE_LABEL, regionOfCode, reviewToRows, summarizeJournal,
  type Currency, type Evaluation, type Stats,
} from "@jusik/shared";
import type { AppState } from "./state";

export type Cell = string | number;

export interface Table {
  name: string;
  headers: string[];
  rows: Cell[][];
}

const KST = 9 * 3600_000;
/** ISO 시각 → 한국 시간 'YYYY-MM-DD HH:mm' */
export const fmtKst = (iso: string) => new Date(Date.parse(iso) + KST).toISOString().slice(0, 16).replace("T", " ");
const r2 = (n: number) => Math.round(n * 100) / 100;
const curOf = (code: string): Currency => currencyOfRegion(regionOfCode(code));
/** 시트가 너무 커지지 않게 내보낼 최근 복기 수 */
const REVIEW_EXPORT_LIMIT = 120;

/** 저장 상태를 엑셀/구글 시트에 공통으로 쓰는 표(탭) 목록으로 바꾼다. 숫자는 숫자로 둔다. */
export function buildTables(state: AppState, meta: { provider: string; sample: boolean; now: Date }): Table[] {
  const { settings: s, paper, latestScan: scan, history, journal } = state;
  const tables: Table[] = [];

  // 1) 요약
  const rows: Cell[][] = [
    ["갱신 시각(한국)", fmtKst(meta.now.toISOString())],
    ["데이터 출처", meta.provider + (meta.sample ? " (샘플 데이터 — 실제 시세 아님)" : "")],
    ["마지막 스캔(한국)", scan ? fmtKst(scan.at) : "-"],
    ["시장 국면", scan ? (Object.entries(scan.regimes).map(([m, r]) => `${m}:${r ?? "?"}`).join("  ") || "-") : "-"],
    [
      "국면 점수(운용 태도)",
      scan?.postures
        ? Object.entries(scan.postures).map(([m, p]) => (p ? `${m}:${POSTURE_LABEL[p.posture]}(${p.score > 0 ? "+" : ""}${p.score}, 상한 ${p.exposureCapPct}%)` : `${m}:?`)).join("  ") || "-"
        : "-",
    ],
    ["적용 투자 상한(%)", scan?.exposureCaps ? (["KRW", "USD"] as const).map((c) => `${c}:${scan.exposureCaps?.[c] ?? "-"}`).join("  ") : "-"],
    ["매크로 기준일", scan?.macroAsOf ?? "-"],
    [
      "리스크 가드",
      scan?.guards
        ? (["KRW", "USD"] as const).map((c) => { const g = scan.guards?.[c]; return `${c}:${!g ? "-" : g.blocked ? "신규 진입 중지" : g.notes.length ? "경고" : "통과"}`; }).join("  ")
        : "-",
    ],
    ["모의 자동매매", s.paperEnabled ? "켜짐" : "꺼짐"],
  ];
  for (const cur of ["KRW", "USD"] as const) for (const n of scan?.guards?.[cur]?.notes ?? []) rows.push([`가드(${cur})`, `${n.text}${n.rule ? ` [${n.rule}]` : ""}`]);
  for (const cur of ["KRW", "USD"] as const) {
    const a = paper[cur];
    const deposit = cur === "KRW" ? s.depositKRW : s.depositUSD;
    rows.push(
      [`예수금 설정(${cur})`, deposit],
      [`모의 현금(${cur})`, r2(a.cash)],
      [`모의 총자산(${cur})`, r2(paperEquity(a))],
      [`모의 실현손익 순(${cur})`, r2(a.realizedPnl)],
      [`모의 청산 횟수 / 승(${cur})`, `${a.closed} / ${a.wins}`],
    );
  }
  tables.push({ name: "요약", headers: ["항목", "값"], rows });

  // 2) 추천(최신) + 예수금 기반 계획
  const planItems = new Map<string, { qty: number; amount: number; risk: number }>();
  const skipped = new Map<string, string>();
  for (const cur of ["KRW", "USD"] as const) {
    const p = scan?.plans[cur];
    p?.items.forEach((i) => planItems.set(i.candidate.code, { qty: i.qty, amount: r2(i.amount), risk: r2(i.riskAmount) }));
    p?.skipped.forEach((x) => skipped.set(x.candidate.code, x.reason));
  }
  tables.push({
    name: "추천(최신)",
    headers: ["순위", "시장", "종목코드", "종목명", "점수", "현재가", "등락률(%)", "거래량배수", "거래대금", "진입가", "손절가", "목표가", "손절폭(%)", "목표폭(%)", "순손익비", "최대보유일", "권장수량", "투자금액", "최대손실", "계획 제외 사유", "근거", "스캔시각"],
    rows: (scan?.candidates ?? []).map((c, i) => {
      const it = planItems.get(c.code);
      return [
        i + 1, c.market, c.code, c.name, c.score, c.price, r2(c.changePct), r2(c.volumeRatio), Math.round(c.tradeValue), c.entry, c.stop, c.target,
        r2(c.stopPct), r2(c.targetPct), r2(c.netRR), c.maxHoldDays, it?.qty ?? 0, it?.amount ?? 0, it?.risk ?? 0, it ? "" : (skipped.get(c.code) ?? ""),
        c.notes.map((n) => n.text).join(" / "), scan ? fmtKst(scan.at) : "",
      ];
    }),
  });

  // 3) 추천 이력
  tables.push({
    name: "추천이력",
    headers: ["스캔시각", "시장", "종목코드", "종목명", "점수", "현재가", "진입가", "손절가", "목표가"],
    rows: [...history].reverse().map((h) => [fmtKst(h.at), h.market, h.code, h.name, h.score, h.price, h.entry, h.stop, h.target]),
  });

  // 4) 모의 포지션
  const pos: Cell[][] = [];
  for (const cur of ["KRW", "USD"] as const)
    for (const p of paper[cur].positions) {
      const last = p.lastPrice ?? p.entryPrice;
      pos.push([cur, p.code, p.name, p.entryDate, p.entryPrice, p.qty, p.stop, p.target, last, r2((last / p.entryPrice - 1) * 100), r2((last - p.entryPrice) * p.qty), p.reason]);
    }
  tables.push({ name: "모의포지션", headers: ["통화", "종목코드", "종목명", "체결일", "체결가", "수량", "손절가", "목표가", "현재가", "평가손익(%)", "평가손익", "진입 근거"], rows: pos });

  // 5) 매매일지
  tables.push({
    name: "매매일지",
    headers: ["날짜", "통화", "종목코드", "종목명", "구분", "가격", "수량", "손절가", "목표가", "비중(%)", "전략", "국면", "청산 사유", "R 배수", "이유", "복기", "감정", "어긴 규칙", "출처"],
    rows: [...journal].sort((a, b) => b.date.localeCompare(a.date)).map((e) => [
      e.date, curOf(e.code), e.code, e.name, e.side === "BUY" ? "매수" : "매도", e.price, e.qty, e.stop ?? "", e.target ?? "", e.weightPct ?? "", e.strategy ?? "", e.regime ?? "",
      e.exitReason ?? "", e.rMultiple ?? "", e.reason, e.review ?? "", e.emotion ?? "", (e.violations ?? []).join(" / "), e.source ?? "수동",
    ]),
  });

  // 6) 성과(통화별)
  const perf: Cell[][] = [];
  for (const cur of ["KRW", "USD"] as const) {
    const sm = summarizeJournal(journal.filter((e) => curOf(e.code) === cur));
    const ev = sm.winRate != null && sm.avgWinPct != null && sm.avgLossPct != null ? expectancy({ winRate: sm.winRate, avgWinPct: sm.avgWinPct, avgLossPct: sm.avgLossPct }) : null;
    perf.push([
      cur, sm.closed.length, sm.winRate == null ? "" : r2(sm.winRate * 100), sm.avgWinPct == null ? "" : r2(sm.avgWinPct), sm.avgLossPct == null ? "" : r2(sm.avgLossPct),
      ev ? r2(ev.expectancyPct) : "", sm.avgR == null ? "" : r2(sm.avgR), sm.rCount ?? 0, r2(sm.totalPnl),
    ]);
  }
  tables.push({ name: "성과", headers: ["통화", "청산 거래", "승률(%)", "평균 이익(%)", "평균 손실(%)", "거래당 기대값(%)", "평균 R", "R 계산 거래", "실현손익(수수료·세금 제외)"], rows: perf });

  // 7) 규칙 점검: 모의매매 실적 + 과거 재현
  const evalRows: Cell[][] = [];
  const st = (x: Stats) => [x.n, x.winRate == null ? "" : r2(x.winRate * 100), x.expectancyPct == null ? "" : r2(x.expectancyPct), x.lowerBoundPct == null ? "" : r2(x.lowerBoundPct), x.profitFactor == null ? "" : r2(x.profitFactor), x.reliable ? "" : "표본 부족"];
  const dump = (source: string, ev: Evaluation) => {
    evalRows.push([source, "전체", `${ev.from ?? "-"}~${ev.to ?? "-"}`, ...st(ev.overall)]);
    for (const g of ev.groups) for (const b of g.buckets) evalRows.push([source, g.title, b.label, ...st(b.stats)]);
    for (const t of ev.thresholds) evalRows.push([source, "최소 점수(전체/앞/뒤 기대값)", `${t.minScore}점 이상`, ...st(t.all), `${t.firstHalf.expectancyPct == null ? "-" : r2(t.firstHalf.expectancyPct)} / ${t.secondHalf.expectancyPct == null ? "-" : r2(t.secondHalf.expectancyPct)}`]);
    evalRows.push([source, "제안", ev.suggestion.minScore == null ? "변경 없음" : `${ev.suggestion.minScore}점`, "", "", "", "", "", "", ev.suggestion.reason]);
  };
  dump("모의매매", evaluateTrades(paperTradesFromJournal(journal), s.minScore));
  if (state.lastReplay) dump(`과거 재현(${fmtKst(state.lastReplay.at)}, ${state.lastReplay.codesTested}종목)`, state.lastReplay.evaluation);
  tables.push({ name: "규칙점검", headers: ["출처", "구분", "조건", "거래 수", "승률(%)", "기대값(%)", "기대값 하한(%)", "손익비(PF)", "비고"], rows: evalRows });

  // 8) 일일 복기(M5-01): 최근 것부터, 한 복기를 (항목, 내용) 여러 줄로
  const reviewRows: Cell[][] = [];
  for (const r of [...state.reviews].reverse().slice(0, REVIEW_EXPORT_LIMIT))
    for (const [k, v] of reviewToRows(r).slice(2)) reviewRows.push([r.date, r.region === "KR" ? "국내" : "미국", k ?? "", v ?? ""]);
  tables.push({ name: "일일복기", headers: ["날짜", "지역", "항목", "내용"], rows: reviewRows });

  return tables;
}
