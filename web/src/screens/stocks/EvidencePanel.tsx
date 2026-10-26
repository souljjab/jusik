import { Check, Minus, X } from "lucide-react";
import type { EvidenceCell, JournalEntry, Settings } from "@jusik/shared";
import { regionOf } from "@jusik/shared";
import type { StockData } from "../../api";
import { useActions } from "../../app/actions";
import { SignalStatsView } from "../../features/EvidenceSheet";
import { Button, EvidenceList, EvidenceStrip, EvidenceStripFull, evidenceSummary, fmtNum, NoteList, Stat, Stats } from "../../ui";
import { AnalysisDetails, DailySignalList, type AccountBase } from "./AnalysisDetails";
import type { Signals, SignalView } from "./useSignals";

/*
 * 신호 근거(UI 지도서 5.2 E·F, 6.1 D, 7.1 D): 전략 이름과 신호, 규칙별 충족 여부(체크·빈칸·점선), 규칙 이름과 출처,
 * 부분 충족·미충족은 경고색 표시와 문장, '근거 보기'(시트), 같은 신호의 과거 성과. 그 아래 분석 자세히.
 */

const MARK = { met: Check, unmet: X, na: Minus } as const;
/** 신호 블록 위 작은 글: 어느 매매법의 신호인지(전략 이름 '2단계 돌파'가 4단계 종목 위에 붙어 헷갈리지 않게) */
const FAMILY: Record<SignalView["strategy"], string> = { weinstein: "와인스타인 주봉 단계", daytrade: "단타 돌파 후보", "candle-master": "캔들마스터 주봉" };
const WORD = { met: "충족", unmet: "미충족", na: "데이터 없음" } as const;

/** 짧은 근거 목록(태블릿·핸드폰): 아이콘 + 규칙 이름, 실제 값은 툴팁과 화면 낭독으로 */
export function CompactEvidence({ cells, onlyUnmet = false }: { cells: EvidenceCell[]; onlyUnmet?: boolean }) {
  const list = onlyUnmet ? cells.filter((c) => c.state !== "met") : cells;
  if (!list.length) return null;
  return (
    <ul className="stk-evmini">
      {list.map((c) => {
        const Icon = MARK[c.state];
        return (
          <li key={c.id} className={c.state} title={c.detail}>
            <Icon size={14} strokeWidth={1.5} aria-hidden="true" className="mk" />
            <span>
              {c.label}
              <span className="sr-only">
                {" "}
                {WORD[c.state]}, {c.detail}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 신호 한 덩어리. full: 칸 이름까지 보이는 스트립 + 규칙별 목록 + 근거 문장, brief: 작은 스트립 + 짧은 목록(onlyUnmet이면 미충족만 경고색으로),
 * mini: 머리 + 스트립 + 근거 보기(다른 신호 목록)
 */
export function SignalBlock({ view, name, code, variant, headingLevel = "h3", onlyUnmet = false }: {
  view: SignalView;
  name: string;
  code: string;
  variant: "full" | "brief" | "mini";
  headingLevel?: "h2" | "h3" | "h4";
  onlyUnmet?: boolean;
}) {
  const { openEvidence } = useActions();
  const ev = view.evidence;
  const H = headingLevel;
  const open = () => ev && openEvidence({ title: `${name} 근거`, evidence: ev, code, notes: view.notes });
  return (
    <div className="stk-sigblock">
      <div className="stk-sigblock-head">
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <span className="t-2">
            {view.daily ? "일봉 보조 신호" : FAMILY[view.strategy]}
            {view.when ? ` · ${view.when}` : ""}
          </span>
          <H className="t-section">{view.title}</H>
        </div>
        {ev && variant !== "full" && <EvidenceStrip evidence={ev} size="md" />}
      </div>
      {view.historical && variant !== "mini" && <p className="t-cap">지난 신호예요. 단계·국면 칸은 그 주 기준으로 다시 계산했고(매크로·시장 폭 제외), 실적 칸은 지금 공시 기준이에요.</p>}
      {variant === "mini" ? null : ev ? (
        variant === "full" ? (
          <>
            <EvidenceStripFull evidence={ev} />
            <EvidenceList cells={ev.cells} />
          </>
        ) : (
          <>
            <span className="t-2">{evidenceSummary(ev)}</span>
            <CompactEvidence cells={ev.cells} onlyUnmet={onlyUnmet} />
          </>
        )
      ) : (
        !view.daily && <p className="t-2">분석에 필요한 주봉(약 34주 이상)이 모자라 근거를 만들지 못했어요.</p>
      )}
      {view.daily && variant !== "mini" && (
        <div className="stack">
          <span className="t-2">이 날의 일봉 보조 신호(참고 신호예요. 주봉 의견을 바꾸지 않아요){ev ? " · 위 칸은 그 주 주봉 근거예요" : ""}</span>
          <DailySignalList signals={view.daily} />
        </div>
      )}
      {variant === "full" && view.notes.length > 0 && (
        <details className="stk-details">
          <summary>근거 문장 {view.notes.length}개</summary>
          <NoteList notes={view.notes} dense />
        </details>
      )}
      {ev && (
        <Button variant="link" className="stk-evopen" onClick={open}>
          근거 보기
        </Button>
      )}
    </div>
  );
}

/** 핵심 숫자(지도서 그림 9 가운데: PER·PBR·부채비율·상대강도) */
export function KeyFigures({ data }: { data: StockData }) {
  const f = data.fundamentals;
  const rs = data.analysis?.timing.rs;
  return (
    <Stats n={4}>
      <Stat value={f.per == null ? "-" : fmtNum(f.per, 1)} label="PER" />
      <Stat value={f.pbr == null ? "-" : fmtNum(f.pbr, 2)} label="PBR" />
      <Stat value={f.debtRatio == null ? "-" : `${fmtNum(f.debtRatio, 0)}%`} label="부채비율" />
      <Stat value={rs == null ? "-" : `${rs > 0 ? "+" : ""}${fmtNum(rs, 1)}`} label="상대강도" />
    </Stats>
  );
}

/** '같은 신호의 과거 성과'를 보여 주지 않는 까닭(진입 신호가 아닐 때) */
function noStatsReason(v: SignalView): string {
  if (v.daily) return "일봉 보조 신호는 의견을 바꾸지 않는 참고 신호라 같은 신호의 과거 성과를 계산하지 않아요.";
  if (v.mark?.side === "sell") return "매도 쪽 신호는 전략의 진입 신호가 아니라 같은 신호의 과거 성과를 계산하지 않아요.";
  return "지금은 이 전략의 매수 신호가 아니라 같은 신호의 과거 성과를 보여 주지 않아요.";
}

/** 신호 근거 탭 전체(컴퓨터 오른쪽 패널·태블릿·핸드폰 근거 탭) */
export function EvidencePanel({ data, signals, settings, journal, account, brief = false, onSelect }: {
  data: StockData;
  signals: Signals;
  settings: Settings | null;
  journal: JournalEntry[];
  /** 주문 상자와 같은 계좌 기준 금액·모의계좌 여부·직접 기록한 보유 수량(리스크·비중 계산) */
  account: AccountBase;
  /** 핸드폰: 짧은 신호 블록 + 핵심 숫자 */
  brief?: boolean;
  /** 다른 신호를 고를 때(근거가 바뀐 곳으로 화면을 옮기는 일은 부모가) */
  onSelect?: (id: string) => void;
}) {
  const { info, analysis } = data;
  const sel = signals.selected;
  const others = signals.current.filter((v) => v.id !== sel.id);
  const pick = onSelect ?? signals.select;
  return (
    <div className="stk-evpanel">
      <SignalBlock view={sel} name={info.name} code={info.code} variant={brief ? "brief" : "full"} onlyUnmet={brief} />
      {brief && <KeyFigures data={data} />}
      <div className="stk-stats">
        {sel.entry ? (
          <SignalStatsView code={info.code} strategy={sel.strategy} />
        ) : (
          <p className="t-cap">{noStatsReason(sel)}</p>
        )}
      </div>
      {others.length > 0 && (
        <section className="stk-others" aria-labelledby="stk-others-h">
          <h3 id="stk-others-h" className="t-body t-bold">
            다른 매매법의 근거
          </h3>
          {others.map((v) => (
            <div key={v.id} className="stk-other">
              <SignalBlock view={v} name={info.name} code={info.code} variant="mini" headingLevel="h4" />
              {!v.quiet && (
                <Button variant="secondary" size="sm" onClick={() => pick(v.id)}>
                  이 신호로 근거 보기
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      {analysis ? (
        <AnalysisDetails a={analysis} journal={journal} region={regionOf(info.market)} settings={settings} breadth={data.breadth} account={account} />
      ) : (
        <p className="t-2">분석에 필요한 데이터(주봉 약 34주 이상)가 부족해요.</p>
      )}
    </div>
  );
}
