import { useEffect, useState } from "react";
import { MACRO_PARAMS, type MacroResponse, type MacroSnapshot, type Region } from "@jusik/shared";
import { getMacro } from "./api";
import { kst } from "./format";
import "./styles/analysis.css";

type Level = "bad" | "warn" | "";

interface Item {
  label: string;
  value: string;
  date: string;
  level: Level;
  title?: string;
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
            <span className="an-date">{it.date ? `관측 ${it.date}` : "데이터 없음"}</span>
          </div>
        ))}
      </div>
      <p className="muted small">색이 들어간 값은 경고 기준을 넘었다는 뜻이에요(VIX 30·원화 3%는 책에 수치가 없어 관행값을 썼어요).</p>
      {errors}
    </div>
  );
}
