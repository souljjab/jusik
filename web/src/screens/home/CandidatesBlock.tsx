import { ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { ScanResult } from "@jusik/shared";
import { startScan } from "../../api";
import { useApp } from "../../app/AppContext";
import { Link } from "../../app/router";
import { CandidateList } from "../../features/candidates/CandidateList";
import { Button, Chip, EmptyState, errorText, fmtInt, fmtWhen, Notice, useToast } from "../../ui";
import { nextScanText } from "../discover/logic";
import { candidateFilters, filterCandidates, scheduleSentence, zeroCandidatesText } from "./homeModel";

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
    } catch (e) {
      // 무엇이 일어났는지 + 어떻게 하는지(errorText가 연결 오류면 서버 확인 문장을 준다)
      toast(`스캔을 시작하지 못했어요. ${errorText(e)}`, "warn");
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

/** 스캔 기준 시각과 자동 스캔 안내(발굴과 같은 문장: 꺼져 있으면 꺼져 있다고, 장이 닫혀 있으면 열리면 찾는다고) */
export function ScanMeta({ scan }: { scan: ScanResult }) {
  const { server, now } = useApp();
  return (
    <span className="t-cap">
      <span className="num">{fmtWhen(scan.at, now)} 기준</span>
      {server && <> · {nextScanText(server.status.scheduler, server.settings)}</>}
    </span>
  );
}

/**
 * 후보 0개(지도서 9.2): 가장 많이 걸러낸 조건을 말하고, 같은 조건으로 다시 스캔하는 대신 스크리너로 보낸다.
 * 자동 스캔 문장은 서버 상태 그대로(꺼져 있거나 장이 닫혀 있으면 '계속 살펴본다'고 쓰지 않는다)
 */
export function NoCandidates({ scan, block = false }: { scan: ScanResult; block?: boolean }) {
  const { server } = useApp();
  return (
    <EmptyState
      title="조건에 맞는 후보가 없어요"
      action={
        <Link to="/discover/screener" className={`ui-btn secondary home-linkbtn ${block ? "block home-touch" : "sm"}`}>
          스크리너에서 조건 보기
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      }
    >
      <span className="t-2">
        {zeroCandidatesText(scan, server?.settings ?? {})}
        {server && ` ${scheduleSentence(server.status.scheduler, server.settings)}`}
      </span>
    </EmptyState>
  );
}

/**
 * 오늘의 후보(지도서 5.1 F): 근거 칸으로 만든 필터 칩, 후보 표(근거 스트립·충족 개수·점수), '후보 모두 보기'.
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
            후보 모두 보기
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
        empty={<NoCandidates scan={scan} />}
      />
      {scan.errors.length > 0 && (
        <Notice tone="warn">
          최근 스캔에서 {scan.errors.length}건을 읽지 못했어요. 일부 시장이나 종목이 빠졌을 수 있어요. 다음 스캔에서 다시 시도해요.
        </Notice>
      )}
    </section>
  );
}
