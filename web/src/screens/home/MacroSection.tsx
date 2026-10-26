import { AlertTriangle } from "lucide-react";
import { MACRO_PARAMS, type Region, type ScanResult } from "@jusik/shared";
import { fmtDate, fmtWhen, Notice, RuleTag, Section, SkeletonRows } from "../../ui";
import { macroItems, monthKo, signedFixed } from "./homeModel";
import { useMacro } from "./useHomeData";

const pp = (n: number) => `${signedFixed(n, 2)}%p`;

/** 스캔에 쓴 매크로 요약: ISM 제조업지수와 금리 추세(2.3 강영현·강동진, M2-10 금리 상승기 조건) */
export function MacroBrief({ scan }: { scan: ScanResult }) {
  const m = scan.macroSummary;
  if (!m) {
    const newer = scan.breadth !== undefined || scan.minuteSkips !== undefined;
    return <p className="t-2">{newer ? "이번 스캔은 매크로를 받지 못해 ISM·금리 추세가 없어요." : "ISM·금리 추세는 다음 스캔부터 보여요."}</p>;
  }
  const i = m.ism;
  const contracting = i != null && i.value < MACRO_PARAMS.ismLine;
  return (
    <dl className="home-facts">
      <div>
        <dt>
          ISM 제조업지수 <RuleTag rule="2.3 강영현·강동진" />
        </dt>
        <dd className={contracting ? "warn-text" : ""}>
          {i ? (
            <>
              <span className="nowrap">
                {contracting && <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" className="home-warn-ic" />}
                <span className="num">{i.value.toFixed(1)}</span> {contracting ? "수축" : "확장"}
              </span>
              <span className="t-cap home-dd-sub">
                {monthKo(i.month)}분 · {i.source === "수동" ? "직접 입력" : "ISM 발표"}
              </span>
            </>
          ) : (
            <span className="t-2">없음 — 지역 연준 제조업 지수로 대신 판단해요(설정에서 직접 넣을 수 있어요)</span>
          )}
        </dd>
      </div>
      <div>
        <dt>
          금리 추세 <RuleTag rule="2.3·M2-10 강영현" />
        </dt>
        <dd className={m.rateRising ? "warn-text" : ""}>
          <span className="nowrap">
            {m.rateRising && <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" className="home-warn-ic" />}
            {m.rateRising == null ? "추세 모름" : m.rateRising ? "금리 상승기" : "상승기 아님"}
          </span>
          {m.us10yChange6m != null && (
            <span className="t-cap home-dd-sub">
              미 10년물 약 6개월 <span className="num">{pp(m.us10yChange6m)}</span>(기준 +{MACRO_PARAMS.rateRisingPp}%p)
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/**
 * 매크로(미국 FRED·ISM): 금리차·VIX·10년물·금리 추세·초과 유동성·원/달러·ISM.
 * 경고 기준을 넘은 값은 경고색 + 아이콘 + '경고' 낱말로 표시한다(색에만 기대지 않는다).
 */
export function MacroSection({ scan, region, compact }: { scan: ScanResult; region: Region; compact: boolean }) {
  const m = useMacro();
  return (
    <Section title="매크로" sub={scan.macroAsOf ? `국면 점수에 쓴 기준일 ${fmtDate(scan.macroAsOf)}` : scan.macroAsOf === null ? "이번 국면 점수에는 매크로가 빠졌어요" : undefined}>
      {compact && <MacroBrief scan={scan} />}
      {!compact &&
        (m === undefined ? (
          <SkeletonRows rows={4} />
        ) : !m?.snapshot ? (
          <Notice tone="warn" title="매크로 자료를 받지 못했어요">
            FRED 접속을 확인해 주세요. 그동안 국면 점수에서 매크로 감점은 빠져요.
          </Notice>
        ) : (
          <>
            <ul className="home-macro">
              {macroItems(m.snapshot, region).map((it) => (
                <li key={it.label} title={it.basis}>
                  <span className="t-2">{it.label}</span>
                  <span className={`home-macro-v num ${it.warn ? "warn-text" : ""}`}>
                    {it.warn && (
                      <>
                        <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
                        <span className="sr-only">경고 </span>
                      </>
                    )}
                    {it.value}
                  </span>
                  <span className="t-cap">
                    {it.when}
                    {it.tag && ` · ${it.tag}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="t-cap">
              경고 표시는 기준을 넘었다는 뜻이에요(VIX {MACRO_PARAMS.vixHigh}·원화 {MACRO_PARAMS.krwWeakPct}%는 책에 수치가 없어 관행값을, 금리 상승기 +{MACRO_PARAMS.rateRisingPp}%p는 앱 기본값을 썼어요).
              {m.snapshot.asOf && ` 최근 관측 ${fmtDate(m.snapshot.asOf)}`}
              {m.fetchedAt && ` · 받은 시각 ${fmtWhen(m.fetchedAt)}`}
              {m.sample && " · 샘플 자료"}
            </p>
            {m.errors.length > 0 && (
              <details className="home-details">
                <summary className="warn-text">받지 못한 항목 {m.errors.length}개</summary>
                <ul className="home-plain-list t-2">
                  {m.errors.map((e, idx) => (
                    <li key={idx}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ))}
    </Section>
  );
}
