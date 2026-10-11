import { ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { ScanResult } from "@jusik/shared";
import { startScan } from "../../api";
import { useApp } from "../../app/AppContext";
import { Link } from "../../app/router";
import { CandidateList } from "../../features/candidates/CandidateList";
import { Button, Chip, EmptyState, fmtInt, fmtTime, fmtWhen, Notice, useToast } from "../../ui";
import { candidateFilters, filterCandidates } from "./homeModel";

/** '지금 스캔': 서버가 스캔 중이면 처리 중 표시. 결과는 서버 상태를 다시 받아 반영한다 */
export function ScanButton({ variant = "secondary", size = "sm", block = false }: { variant?: "primary" | "secondary"; size?: "sm" | "md" | "lg"; block?: boolean }) {
  const { server, refreshServer } = useApp();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const scanning = pending || !!server?.status.scheduler.scanning;
  const run = async () => {
    setPending(true);
    try {
      const r = await startScan();
      toast(r.started ? "스캔을 시작했어요. 끝나면 후보가 바뀌어요." : r.message, r.started ? "info" : "warn");
      await refreshServer();
    } finally {
      setPending(false);
    }
  };
  return (
    <Button variant={variant} size={size} block={block} busy={scanning} icon={<RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={run}>
      {scanning ? "스캔 중" : "지금 스캔"}
    </Button>
  );
}

/** 스캔 기준 시각과 다음 자동 스캔 */
export function ScanMeta({ scan }: { scan: ScanResult }) {
  const { server, now } = useApp();
  const next = server?.status.scheduler.nextScanAt;
  return (
    <span className="t-cap">
      <span className="num">{fmtWhen(scan.at, now)} 기준</span>
      {next && <> · 다음 자동 스캔 <span className="num">{fmtTime(next)}</span></>}
    </span>
  );
}

/**
 * 오늘의 후보(지도서 5.1 F): 근거 칸으로 만든 필터 칩, 후보 표(근거 스트립·충족 개수·점수), '모두 보기'.
 * 행을 누르면 종목 분석, '근거 보기'는 근거 시트.
 */
export function CandidatesBlock({ scan, limit = 8, headingId }: { scan: ScanResult; limit?: number; headingId?: string }) {
  const [filter, setFilter] = useState<string | null>(null);
  const cands = scan.candidates;
  const chips = useMemo(() => candidateFilters(cands), [cands]);
  const active = filter && chips.some((c) => c.id === filter) ? filter : null;
  const shown = useMemo(() => filterCandidates(cands, active), [cands, active]);
  return (
    <section className="home-cands" aria-labelledby={headingId}>
      <div className="home-block-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 id={headingId} className="t-section">
            오늘의 후보 <span className="t-2 num">{fmtInt(cands.length)}종목</span>
          </h2>
          <ScanMeta scan={scan} />
        </div>
        <div className="row wrap">
          <ScanButton />
          <Link to="/discover" className="home-more">
            모두 보기
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="ui-chips" role="group" aria-label="후보 거르기">
          <Chip pressed={!active} onClick={() => setFilter(null)}>
            전체
          </Chip>
          {chips.map((c) => (
            <Chip key={c.id} pressed={active === c.id} onClick={() => setFilter(active === c.id ? null : c.id)}>
              {c.label} <span className="num t-2">{c.count}</span>
            </Chip>
          ))}
        </div>
      )}
      <CandidateList
        candidates={shown}
        limit={limit}
        empty={
          <EmptyState title="조건에 맞는 후보가 없어요" action={<ScanButton />}>
            <span className="t-2">장이 열린 동안 {fmtInt(scan.scannedCount)}종목을 계속 살펴보고 있어요. 발굴에서 조건을 바꿔 볼 수도 있어요.</span>
          </EmptyState>
        }
      />
      {scan.errors.length > 0 && (
        <Notice tone="warn">
          최근 스캔에서 {scan.errors.length}건을 읽지 못했어요. 일부 시장이나 종목이 빠졌을 수 있어요. 다음 스캔에서 다시 시도해요.
        </Notice>
      )}
    </section>
  );
}
