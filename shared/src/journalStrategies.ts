import type { EvidenceStrategy } from "./evidence";
import { PAPER_STRATEGY } from "./paper";
import { STRATEGIES } from "./strategies";

/** 직접 판단한 매매(정해진 전략 없이) */
export const MANUAL_STRATEGY = "직접 판단";

/**
 * 매매일지 전략 이름 목록: 모의매매 단타 규칙, 책 기반 전략들, 직접 판단.
 * 주문 검토 시트·일지 입력·매매 화면이 이 이름만 기록한다(같은 전략이 여러 이름으로 남지 않게).
 */
export const JOURNAL_STRATEGIES: string[] = [...new Set([PAPER_STRATEGY, ...STRATEGIES.map((s) => s.name), MANUAL_STRATEGY])];

const STRATEGY_ID: Record<EvidenceStrategy, string> = { daytrade: "daytrade-breakout", weinstein: "weinstein", "candle-master": "candle-master" };

/** 근거 스트립의 전략 → 매매일지에 남길 전략 이름(단타는 모의매매와 같은 '단타 돌파') */
export function journalStrategyOf(s: EvidenceStrategy): string {
  if (s === "daytrade") return PAPER_STRATEGY;
  return STRATEGIES.find((x) => x.id === STRATEGY_ID[s])?.name ?? MANUAL_STRATEGY;
}
