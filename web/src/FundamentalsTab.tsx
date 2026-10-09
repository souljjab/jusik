import { type Analysis, type Fundamentals } from "@jusik/shared";
import { NoteList } from "./NoteList";
import { num } from "./format";

const GROUPS = ["안정성", "저평가", "실적"] as const;
const MARK = { pass: "✔", fail: "✖", unknown: "?" } as const;

export function FundamentalsTab({ f, a }: { f: Fundamentals; a: Analysis | null }) {
  const s = a?.screening;
  return (
    <div className="card">
      <h3 className="h3">재무 체크리스트 {s && <span className={`chip grade-${s.grade.replace("/", "")}`}>{s.grade}</span>}</h3>
      {s ? (
        <>
          <p className="small">{s.known}개 확인 중 {s.passed}개 통과. 확인 못 한 항목은 감점하지 않고 등급 계산에서 제외해요.</p>
          {GROUPS.map((g) => (
            <div key={g}>
              <h4 className="group">{g}</h4>
              <table className="kv">
                <tbody>
                  {s.checks.filter((c) => c.group === g).map((c) => (
                    <tr key={c.id}>
                      <th><span className={`mark ${c.status}`}>{MARK[c.status]}</span> {c.label}</th>
                      <td>{c.value}</td>
                      <td className="muted small">기준 {c.rule}{c.hint ? ` · ${c.hint}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      ) : (
        <p className="muted">분석 데이터가 부족해요.</p>
      )}
      <h4 className="group">참고 지표</h4>
      <table className="kv">
        <tbody>
          {([["EPS", f.eps, "원"], ["BPS", f.bps, "원"], ["ROE", f.roe, "%"]] as const).map(([l, v, u]) => (
            <tr key={l}><th>{l}</th><td>{v == null ? "-" : `${num(v, 1)}${u}`}</td><td /></tr>
          ))}
        </tbody>
      </table>
      <NoteList
        notes={[
          { tone: "info", text: "기준값(PER 10 이하, 부채비율 150% 이하 등)은 책 저자의 경험 기준이고 한국 시장에서 검증된 통계가 아니에요. 같은 업종 평균과 비교하는 게 원칙이지만 업종 평균 데이터는 아직 없어요." },
          { tone: "warn", text: "저성장 업종은 PER·PBR이 낮아도 이익이 줄면 저평가가 아니에요. 매출·영업이익 증가율을 같이 보세요." },
        ]}
      />
    </div>
  );
}
