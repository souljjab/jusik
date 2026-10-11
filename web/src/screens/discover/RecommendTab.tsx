import { useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { EXPOSURE_CAP_REASON, regionOf, type Currency, type Market, type ScanResult, type ServerState } from "@jusik/shared";
import { useApp } from "../../app/AppContext";
import { Link, navigate } from "../../app/router";
import { CandidateList } from "../../features/candidates/CandidateList";
import {
  Button, Chip, Disclaimer, EmptyState, Notice, RegimeGauge, RuleTag, Section, Segmented, Skeleton, SkeletonRows,
  fmtBig, fmtInt, useBreakpoint,
} from "../../ui";
import { FILTER_CHIPS, bindingRejection, filterCandidates, filterCounts, postureLine, rejectionAdvice, scanDraftOf, type FilterId, type MarketFilter } from "./logic";
import { ScanStatus } from "./ScanStatus";
import { useScan } from "./useScan";

const VERDICT_LABEL = { buy: "매수 신호", wait: "대기", avoid: "피함" } as const;
const CUR_LABEL: Record<Currency, string> = { KRW: "원화", USD: "달러" };

/** 추천 목록(지도서 7.2 A·5.1 F): 스캔 상태, 근거 칸 필터, 후보 목록, 고지 문구 */
export function RecommendTab() {
  const { server } = useApp();
  const bp = useBreakpoint();
  const scanCtl = useScan();
  const [filters, setFilters] = useState<Set<FilterId>>(() => new Set());
  const [market, setMarket] = useState<MarketFilter>("all");
  const scan = server?.latestScan ?? null;
  const all = useMemo(() => scan?.candidates ?? [], [scan]);
  const counts = useMemo(() => filterCounts(all), [all]);
  const regions = useMemo(() => new Set(all.map((c) => regionOf(c.market))), [all]);
  const list = useMemo(() => filterCandidates(all, filters, regions.size > 1 ? market : "all"), [all, filters, market, regions]);

  if (!server) return <RecommendSkeleton />;

  const toggle = (id: FilterId) =>
    setFilters((f) => {
      const n = new Set(f);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const scanButton = (
    <Button variant="primary" size={bp === "compact" ? "lg" : "md"} block={bp === "compact"} busy={scanCtl.scanning} onClick={() => void scanCtl.start()} icon={<RefreshCw size={16} aria-hidden="true" />}>
      {scanCtl.scanning ? "스캔 중" : "지금 스캔"}
    </Button>
  );
  const filtered = filters.size > 0 || (regions.size > 1 && market !== "all");

  return (
    <div className="disc-rec">
      <ScanStatus scanning={scanCtl.scanning} error={scanCtl.error} action={bp === "compact" || !scan ? undefined : scanButton} />

      <div className="disc-rec-grid">
        <div className="disc-rec-main">
          <Section
            title="추천 후보"
            sub={scan ? (filtered ? `${all.length}종목 중 ${list.length}종목` : `${all.length}종목`) : undefined}
            actions={
              regions.size > 1 ? (
                <Segmented
                  size="sm"
                  label="시장"
                  value={market}
                  onChange={setMarket}
                  options={[
                    { value: "all", label: "전체" },
                    { value: "KR", label: "국내" },
                    { value: "US", label: "미국" },
                  ]}
                />
              ) : undefined
            }
          >
            <p className="t-2">
              스캔은 <b className="t-medium">단타 돌파 규칙</b>(거래량 급증·20일 고점 돌파)으로만 후보를 찾아요. 와인스타인·캔들마스터 같은 책 전략은 종목마다{" "}
              <Link to="/discover/strategy">전략과 백테스트</Link>에서 시험해요.
            </p>
            {all.length > 0 && (
              <div className="disc-chips scroll" role="group" aria-label="근거로 거르기">
                <Chip pressed={filters.size === 0} onClick={() => setFilters(new Set())}>
                  전체 <span className="num">{all.length}</span>
                </Chip>
                {FILTER_CHIPS.map((f) => (
                  <Chip key={f.id} pressed={filters.has(f.id)} onClick={() => toggle(f.id)} disabled={counts[f.id] === 0 && !filters.has(f.id)}>
                    {f.label} <span className="num">{counts[f.id]}</span>
                  </Chip>
                ))}
              </div>
            )}
            <CandidateList
              candidates={list}
              empty={
                !scan ? (
                  <EmptyState title="아직 스캔 결과가 없어요" action={bp === "compact" ? undefined : scanButton}>
                    지금 스캔하면 단타 돌파 규칙에 맞는 후보를 찾아요. 장이 닫혀 있으면 마지막 종가 기준으로 찾아요.
                  </EmptyState>
                ) : all.length === 0 ? (
                  <EmptyState title="조건에 맞는 후보가 없어요" action={<Button onClick={() => navigate("/discover/screener")}>스크리너에서 조건 보기</Button>}>
                    {zeroSentence(scan, server.settings)}
                  </EmptyState>
                ) : (
                  <EmptyState title="고른 근거를 모두 충족한 후보가 없어요" action={<Button onClick={() => (setFilters(new Set()), setMarket("all"))}>필터 지우기</Button>}>
                    칩을 하나 빼면 더 많은 후보가 보여요.
                  </EmptyState>
                )
              }
            />
            {list.length > 0 && <Disclaimer />}
          </Section>
        </div>

        <aside className="disc-rec-side" aria-label="스캔 요약">
          {scan && <PostureBlock scan={scan} />}
          {scan && <PlanBlock server={server} scan={scan} />}
          {scan && (scan.minuteSkips?.length ?? 0) > 0 && <MinuteSkips scan={scan} />}
          {scan && <RejectedBlock scan={scan} />}
        </aside>
      </div>

      {bp === "compact" && <div className="disc-bottom-bar">{scanButton}</div>}
    </div>
  );
}

/** 조건 충족 0개일 때의 사실 문장(자세한 완화 제안은 스크리너에서) */
function zeroSentence(scan: ScanResult, settings: ServerState["settings"]): string {
  const top = bindingRejection(scan.rejected, scan.scannedCount);
  return top
    ? `모든 조건을 만족하는 종목이 없어요. 가장 많이 걸러낸 조건은 ${rejectionAdvice(top.reason, scanDraftOf(settings)).condition}(${fmtInt(top.count)}종목)이에요. 스크리너에서 완화 제안을 볼 수 있어요.`
    : "모든 조건을 만족하는 종목이 없어요. 장중에 다시 스캔해 보세요.";
}

/** 시장 국면(근거 스트립의 마지막 칸). 자세한 근거는 홈의 국면 상세 */
function PostureBlock({ scan }: { scan: ScanResult }) {
  const markets = scan.markets.length ? scan.markets : (Object.keys(scan.regimes) as Market[]);
  if (!markets.length) return null;
  return (
    <Section title="시장 국면" actions={<Link to="/?view=regime" className="disc-more">국면 자세히</Link>}>
      <ul className="disc-plain">
        {markets.map((m) => {
          const p = scan.postures?.[m] ?? null;
          return (
            <li key={m} className="disc-posture">
              <RegimeGauge posture={p?.posture ?? null} labels={false} />
              <span className="t-2">{postureLine(m, p)}</span>
            </li>
          );
        })}
      </ul>
      <p className="t-cap">약세 국면에서는 단타 점수에서 15점을 빼고, 국면 상한만큼만 계획에 담아요.</p>
    </Section>
  );
}

/** 오늘의 계획 요약: 예수금 안에서 살 수 있는 조합은 매매 > 오늘의 계획에서 본다 */
function PlanBlock({ server, scan }: { server: ServerState; scan: ScanResult }) {
  const s = server.settings;
  const curs = (["KRW", "USD"] as Currency[]).filter((c) => scan.plans[c]);
  const executed = scan.executed.length;
  const capHit = curs.some((c) => scan.plans[c]!.skipped.some((x) => x.reason === EXPOSURE_CAP_REASON));
  return (
    <Section title="오늘의 계획" actions={<Link to="/trade/plan" className="disc-more">계획 보기 <ArrowRight size={14} aria-hidden="true" /></Link>}>
      {curs.length === 0 ? (
        <p className="t-2">스캔하면 {s.paperEnabled ? "모의계좌 현금" : "예수금"}과 위험 한도 안에서 살 수 있는 조합을 만들어요.</p>
      ) : (
        <ul className="disc-plain">
          {curs.map((c) => {
            const p = scan.plans[c]!;
            const region = c === "USD" ? "US" : "KR";
            return (
              <li key={c} className="disc-kv">
                <span className="t-2">{CUR_LABEL[c]} 계획</span>
                <span className="num t-medium">
                  {p.items.length}종목{p.items.length > 0 && <> · 투자 {fmtBig(p.used, region)}{region === "KR" && <span className="unit">원</span>}</>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {capHit && (
        <p className="t-2">
          국면별 투자 상한에 닿아 더 담지 않은 후보가 있어요. <RuleTag rule="2.5 강동진" />
        </p>
      )}
      <p className="t-cap">
        이 앱은 실제 주문을 내지 않아요.{" "}
        {s.paperEnabled
          ? executed > 0
            ? `모의매매가 이번 스캔에서 ${executed}종목에 모의 진입했어요.`
            : "모의매매가 켜져 있어 장중에는 계획대로 모의계좌에 진입해요."
          : "모의매매 자동 실행은 설정에서 켤 수 있어요."}
      </p>
    </Section>
  );
}

/** 분봉 확인(4.7·M3-18)으로 모의 자동매매 진입을 미룬 종목 */
function MinuteSkips({ scan }: { scan: ScanResult }) {
  const { openStock } = useApp();
  const list = scan.minuteSkips ?? [];
  return (
    <Section title="분봉 확인으로 진입 보류" sub={`${list.length}종목`}>
      <p className="t-cap">
        계획에는 들었지만 모의 자동매매가 1분봉을 보고 이번 스캔에서는 들어가지 않은 종목이에요. 다음 스캔에서 다시 확인해요. <RuleTag rule="4.7·M3-18 강창권" />
      </p>
      <ul className="disc-plain">
        {list.map((x, i) => (
          <li key={`${x.code}-${i}`} className="disc-skip">
            <button type="button" className="ui-btn link" onClick={() => openStock(x.code)}>
              {x.name}
            </button>
            <span className={`disc-verdict ${x.verdict}`}>{VERDICT_LABEL[x.verdict] ?? x.verdict}</span>
            <span className="t-2 disc-skip-reason">{x.reason || "사유 없음"}</span>
          </li>
        ))}
      </ul>
      <Link to="/discover/screener" className="disc-more">분봉 확인 방식 바꾸기</Link>
    </Section>
  );
}

/** 걸러진 종목 요약(많은 순 3개)과 오류 */
function RejectedBlock({ scan }: { scan: ScanResult }) {
  const rows = Object.entries(scan.rejected).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, n]) => a + n, 0);
  return (
    <Section title="걸러진 종목" sub={`${fmtInt(total)}종목`} actions={<Link to="/discover/screener" className="disc-more">조건 보기</Link>}>
      <p className="t-2 num">
        후보 풀 {fmtInt(scan.universeCount)} → 분석 {fmtInt(scan.scannedCount)} → 조건 충족 {fmtInt(scan.candidates.length)}
      </p>
      {rows.length > 0 && (
        <ul className="disc-plain">
          {rows.slice(0, 4).map(([r, n]) => (
            <li key={r} className="disc-kv">
              <span className="t-2">{r}</span>
              <span className="num">{fmtInt(n)}</span>
            </li>
          ))}
        </ul>
      )}
      {scan.errors.length > 0 && (
        <Notice tone="warn" title={`일부 시장·종목을 읽지 못했어요(${scan.errors.length}건)`}>
          <details>
            <summary>읽지 못한 항목 보기</summary>
            <ul className="disc-plain t-cap">
              {scan.errors.slice(0, 8).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </details>
          다음 스캔에서 다시 읽어요.
        </Notice>
      )}
    </Section>
  );
}

function RecommendSkeleton() {
  return (
    <div className="disc-rec" aria-busy="true">
      <div className="disc-status">
        <div className="disc-status-text">
          <Skeleton w={180} h={16} />
          <Skeleton w={240} h={12} />
        </div>
      </div>
      <div className="disc-rec-grid">
        <div className="disc-rec-main stack-4">
          <Skeleton w={120} h={20} />
          <SkeletonRows rows={8} h={28} />
        </div>
        <div className="disc-rec-side stack-4">
          <SkeletonRows rows={4} />
        </div>
      </div>
    </div>
  );
}

