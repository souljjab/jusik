import type { Fundamentals, Recommendation } from "@jusik/shared";
import { num } from "./format";

const ROWS: { key: keyof Fundamentals; label: string; unit: string; hint: string }[] = [
  { key: "per", label: "PER", unit: "배", hint: "주가 ÷ 주당순이익. 낮을수록 이익 대비 싸요(적자면 의미 없음)." },
  { key: "pbr", label: "PBR", unit: "배", hint: "주가 ÷ 주당순자산. 1 미만이면 장부가치보다 싸게 거래돼요." },
  { key: "eps", label: "EPS", unit: "원", hint: "주당순이익" },
  { key: "bps", label: "BPS", unit: "원", hint: "주당순자산" },
  { key: "roe", label: "ROE", unit: "%", hint: "자기자본이익률. 자본으로 얼마나 벌었는지." },
  { key: "revenueGrowth", label: "매출 증가율", unit: "%", hint: "전년 대비" },
  { key: "opIncomeGrowth", label: "영업이익 증가율", unit: "%", hint: "전년 대비" },
  { key: "debtRatio", label: "부채비율", unit: "%", hint: "높을수록 재무 부담이 커요." },
];

export function FundamentalsTab({ f, rec }: { f: Fundamentals; rec: Recommendation | null }) {
  return (
    <div className="card">
      <table className="kv">
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key}>
              <th>{r.label}</th>
              <td>{f[r.key] == null ? "-" : `${num(f[r.key], 1)}${r.unit}`}</td>
              <td className="muted small">{r.hint}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        단순 지표만으로 싸다/비싸다를 단정하면 안 돼요. 저성장 업종은 PER이 낮아도 이익이 줄면 저평가가 아니에요. 산업의 성장성과 실적 추세를 함께 보세요.
      </p>
      {rec && rec.valuationReasons.length > 0 && (
        <ul className="plain">
          {rec.valuationReasons.map((r, i) => (
            <li key={i}><span className={r.points > 0 ? "up" : "down"}>{r.points > 0 ? "▲" : "▼"}</span> {r.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
