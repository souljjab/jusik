import { Sheet } from "../ui";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "Cmd" : "Ctrl";

/** 키보드 단축키(UI 지도서 5.4). 단축키로도 주문이 바로 체결되지 않고 검토 시트만 열린다 */
export const SHORTCUTS: [string, string][] = [
  ["종목, 전략, 화면 검색", `${MOD} K`],
  ["차트 기간 바꾸기", "1 일봉 · 2 주봉 · 3 월봉"],
  ["관심종목 위아래 이동", "↑ ↓"],
  ["주문 검토 열기(검토 시트만 열림)", `${MOD} Enter`],
  ["시트·창 닫기", "Esc"],
  ["단축키 목록 보기", "?"],
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="키보드 단축키" side="center">
      <table className="keys">
        <tbody>
          {SHORTCUTS.map(([what, keys]) => (
            <tr key={what}>
              <td>{what}</td>
              <td>
                <span className="kbd">{keys}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-cap" style={{ marginTop: 12 }}>
        단축키로도 주문은 바로 기록되지 않아요. 항상 검토 시트에서 한 번 더 확인해요.
      </p>
    </Sheet>
  );
}
