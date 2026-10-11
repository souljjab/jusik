import { useEffect, useState } from "react";
import { MACRO_PARAMS, type MacroResponse, type MacroSnapshot, type Region } from "@jusik/shared";
import { getMacro } from "./api";
import { kst } from "./format";
import "./styles/analysis.css";
import "./styles/analysis2.css";

type Level = "bad" | "warn" | "";

interface Item {
  label: string;
  value: string;
  date: string;
  level: Level;
  title?: string;
  /** 날짜 줄을 통째로 바꿀 때(예: ISM 'YYYY-MM분 · 발표 날짜') */
  when?: string;
  /** 작은 꼬리표(ISM 대용·수동 입력·금리 상승기) */
  tag?: string;
  tagWarn?: boolean;
}

const signed = (n: number, d: number) => `${n > 0 ? "+" : ""}${n.toFixed(d)}`;
const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/** 스냅숏 → 화면 칸. 값이 없는 지표는 '-'로 두고 색을 칠하지 않는다 */
function items(s: MacroSnapshot, region?: Region): Item[] {
  const P = MACRO_PARAMS;
  const out: Item[] = [];

  const sp = s.yieldSpread;
  out.push({
    label: "장단기 금리차(10년-2년)",
    value: sp ? `${signed(sp.value, 2)}%p${sp.value < P.yieldSpreadInverted ? " 역전" : ""}` : "-",
    date: sp?.date ?? "",
    level: sp && sp.value < P.yieldSpreadInverted ? "bad" : "",
    title: "0 아래면 수익률곡선 역전(M1-06)",
  });

  const vix = s.vix;
  out.push({
    label: "VIX",
    value: vix ? vix.value.toFixed(1) : "-",
    date: vix?.date ?? "",
    level: vix ? (vix.value >= P.vixPanic ? "bad" : vix.value >= P.vixHigh ? "warn" : "") : "",
    title: `${P.vixHigh} 이상 경계, ${P.vixPanic} 이상 공포(관행값)`,
  });

  const t10 = s.us10y;
  out.push({ label: "미 10년물 금리", value: t10 ? `${t10.value.toFixed(2)}%` : "-", date: t10?.date ?? "", level: "" });

  // 금리 추세: 약 6개월(rateLookback개 관측치) 전 대비 변화. 금리 상승기면 PSR 과열 경고(M2-10)의 조건이 된다
  const ch6 = s.us10yChange6m;
  out.push({
    label: "미 10년물 6개월 변화",
    value: ch6 != null ? `${signed(ch6, 2)}%p` : "-",
    date: ch6 != null ? (t10?.date ?? "") : "",
    level: s.rateRising ? "warn" : "",
    tag: s.rateRising ? "금리 상승기" : undefined,
    tagWarn: true,
    title: `${P.rateLookback}개 관측치(약 6개월) 전 대비. +${P.rateRisingPp}%p 이상이면 금리 상승기(앱 기본값) — PSR 과열 경고(M2-10) 조건`,
  });

  const ex = s.excessLiquidity;
  out.push({
    label: "초과 유동성(M2-GDP 증가율 차)",
    value: ex != null ? `${signed(ex, 1)}%p` : "-",
    date: s.m2YoY && s.gdpYoY ? `M2 ${s.m2YoY.date.slice(0, 7)} · GDP ${quarterOf(s.gdpYoY.date)}` : "",
    level: ex != null && ex < P.excessLiquidityNegative ? "warn" : "",
    title: "0 아래면 유동성 축소(M1-07)",
  });

  const krw = s.krwPerUsd;
  const ch = s.krwChange20dPct;
  out.push({
    label: `원/달러(${P.krwLookback}개 관측 변화율)`,
    value: krw ? `${Math.round(krw.value).toLocaleString("ko-KR")}원${ch != null ? ` (${signed(ch, 1)}%)` : ""}` : "-",
    date: krw?.date ?? "",
    // 원화 약세 경고는 국내 시장에만 의미가 있다
    level: region !== "US" && ch != null && ch >= P.krwWeakPct ? "warn" : "",
    title: `+${P.krwWeakPct}% 이상이면 원화 약세 경고(관행값, 국내 종목에만 반영)`,
  });

  // ISM 제조업지수(2.3 강영현·강동진). 없으면 지역 연준 제조업 지수 두 개를 대용으로 보여 준다
  const ism = s.ism;
  const proxy = s.ismProxy;
  if (ism) {
    out.push({
      label: "ISM 제조업지수",
      value: `${ism.value.toFixed(1)}${ism.value < P.ismLine ? " 수축" : " 확장"}`,
      date: ism.date,
      when: `${ism.month}분 · 발표 ${ism.date}`,
      level: ism.value < P.ismLine ? "warn" : "",
      tag: ism.source === "수동" ? "수동 입력" : "ISM 발표",
      title: `${P.ismLine} 아래면 미국 제조업 수축(2.3 강영현·강동진)`,
    });
  } else if (proxy?.philly || proxy?.empire) {
    const regional: [string, typeof proxy.philly][] = [
      ["필라델피아 연준 제조업", proxy.philly],
      ["뉴욕 연준 제조업", proxy.empire],
    ];
    for (const [label, x] of regional) {
      out.push({
        label,
        value: x ? `${signed(x.value, 1)}${x.value < P.ismProxyLine ? " 수축" : " 확장"}` : "-",
        date: x?.date ?? "",
        level: x && x.value < P.ismProxyLine ? "warn" : "",
        tag: "ISM 대용",
        title: `ISM 값이 없어 대신 봐요. 확산지수라 ${P.ismProxyLine} 아래면 수축(둘 다 수축일 때만 매크로 감점)`,
      });
    }
  } else {
    out.push({ label: "ISM 제조업지수", value: "-", date: "", level: "", title: `${P.ismLine} 아래면 미국 제조업 수축(2.3 강영현·강동진)` });
  }
  return out;
}

/** 매크로 지표 한 줄 요약. 처음 그릴 때 한 번만 받아 온다(api가 캐시) */
export function MacroStrip({ region }: { region?: Region }) {
  // undefined = 불러오는 중, null = 요청 실패
  const [m, setM] = useState<MacroResponse | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getMacro().then((r) => {
      if (alive) setM(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (m === undefined) return <p className="muted small an-macro">매크로 지표를 불러오는 중…</p>;

  const head = (
    <div className="an-macro-head small">
      <b>매크로(미 FRED)</b>
      {m?.sample && <span className="pill warn-pill" title="실제 값이 아닌 임의로 만든 매크로 자료예요">샘플</span>}
      {m?.snapshot?.asOf && <span className="muted">최근 관측 {m.snapshot.asOf}</span>}
      {m?.fetchedAt && <span className="muted">· 받은 시각 {kst(m.fetchedAt)}</span>}
    </div>
  );
  const errors = m?.errors.length ? (
    <details className="muted small">
      <summary>받지 못한 항목 {m.errors.length}개</summary>
      <ul className="notes">
        {m.errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </details>
  ) : null;

  if (!m?.snapshot) {
    return (
      <div className="an-macro">
        {head}
        <p className="muted small">매크로 데이터를 받지 못했어요(FRED 접속을 확인하세요). 국면 점수에서 매크로는 빠졌어요.</p>
        {errors}
      </div>
    );
  }

  return (
    <div className="an-macro">
      {head}
      <div className="an-macro-grid">
        {items(m.snapshot, region).map((it) => (
          <div key={it.label} className={`an-macro-item${it.level ? ` an-${it.level}` : ""}`} title={it.title}>
            <span className="an-label">{it.label}</span>
            <b>{it.value}</b>
            <span className="an-date">{it.when ?? (it.date ? `관측 ${it.date}` : "데이터 없음")}</span>
            {it.tag && <span className={`an2-mtag${it.tagWarn ? " an2-mtag-warn" : ""}`}>{it.tag}</span>}
          </div>
        ))}
      </div>
      <p className="muted small">
        색이 들어간 값은 경고 기준을 넘었다는 뜻이에요(VIX 30·원화 3%는 책에 수치가 없어 관행값을, 금리 상승기 +{MACRO_PARAMS.rateRisingPp}%p는 앱 기본값을 썼어요).
      </p>
      {!m.snapshot.ism && (
        <p className="muted small">
          {m.snapshot.ismProxy
            ? `ISM 제조업지수를 받지 못해 지역 연준 제조업 지수(${MACRO_PARAMS.ismProxyLine} 기준)로 대신 봐요.`
            : "ISM 제조업지수와 대용 지표를 모두 받지 못했어요."}{" "}
          설정에서 ISM 발표값을 직접 넣으면 그 값을 먼저 써요.
        </p>
      )}
      {errors}
    </div>
  );
}
