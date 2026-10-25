import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useBreakpoint } from "./useBreakpoint";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 열려 있는 떠 있는 층(시트·명령 검색)의 쌓인 순서. Esc와 Tab 가둠은 맨 위 층만 처리하고,
 * 전역 단축키(Ctrl K, ?)는 층이 하나라도 열려 있으면 또 층을 열지 않는다(시트 안에서 또 시트를 열지 않는다, 지도서 7.3).
 */
const stack: string[] = [];
/** 첫 층이 열리기 전의 body overflow(마지막 층이 닫힐 때 되돌린다) */
let bodyOverflow = "";

/** 떠 있는 층(시트·명령 검색)이 하나라도 열려 있는가 */
export const overlayOpen = () => stack.length > 0;

/**
 * Tab을 층 안에 가둔다. 포커스가 층 자체(빈 곳을 눌렀을 때)나 탭 순서에 없는 요소에 있어도 밖으로 나가지 않게
 * 문서 순서로 다음·이전 요소를 찾아 옮긴다.
 */
function trapTab(e: KeyboardEvent, el: HTMLElement) {
  const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
  const act = document.activeElement as HTMLElement | null;
  if (!items.length) {
    e.preventDefault();
    el.focus();
    return;
  }
  const a = items[0]!, z = items.at(-1)!;
  const i = act ? items.indexOf(act) : -1;
  if (i >= 0) {
    if (e.shiftKey && i === 0) (e.preventDefault(), z.focus());
    else if (!e.shiftKey && i === items.length - 1) (e.preventDefault(), a.focus());
    return;
  }
  e.preventDefault();
  if (!act || !el.contains(act)) return (e.shiftKey ? z : a).focus();
  const after = items.filter((x) => act.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
  const before = items.filter((x) => act.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_PRECEDING);
  (e.shiftKey ? (before.at(-1) ?? z) : (after[0] ?? a)).focus();
}

/**
 * 떠 있는 층 하나를 쌓는다: 열리면 맨 위 층이 되어 포커스를 안으로 옮기고(initialFocus 또는 첫 입력), Tab을 가두고,
 * Esc로 닫는다. 닫히면 연 요소로 포커스를 돌려준다. 열려 있는 동안 뒤 화면은 스크롤하지 않는다.
 */
export function useOverlayLayer(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void, initialFocus?: string) {
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!stack.length) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    stack.push(id);
    const el = ref.current;
    const first = (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) || el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack.at(-1) !== id || !el) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      } else if (e.key === "Tab") trapTab(e, el);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) document.body.style.overflow = bodyOverflow;
      if (opener?.isConnected) opener.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/**
 * 시트(떠 있는 층): 핸드폰·태블릿은 아래에서 올라오는 하단 시트, 컴퓨터는 오른쪽 시트 또는 가운데 창.
 * 열리면 첫 입력에 포커스를 두고 Tab이 시트 밖으로 나가지 않으며, Esc나 바깥(어두운 막)을 누르면 닫힌다.
 * 닫히면 연 버튼으로 포커스를 돌려준다. 그림자는 이런 떠 있는 층에만 쓴다.
 * 위치 클래스는 ui-sheet--bottom|right|center(전역 도우미 .right 같은 이름과 겹치지 않게).
 */
export function Sheet({ open, onClose, title, children, footer, side = "auto", wide = false, initialFocus, labelledBy }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** auto: 컴퓨터는 오른쪽, 그 밖은 아래 */
  side?: "auto" | "bottom" | "right" | "center";
  wide?: boolean;
  /** 열릴 때 포커스할 요소 선택자 */
  initialFocus?: string;
  labelledBy?: string;
}) {
  const bp = useBreakpoint();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const titleId = labelledBy ?? `${id}-title`;
  const resolved = side === "auto" ? (bp === "large" ? "right" : "bottom") : side;
  useOverlayLayer(open, ref, onClose, initialFocus);

  if (!open) return null;
  return createPortal(
    <>
      <div className="ui-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className={`ui-sheet ui-sheet--${resolved}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={wide && resolved !== "bottom" ? { width: "min(640px, 100vw)" } : undefined}>
        {resolved === "bottom" && <div className="ui-sheet-grip" aria-hidden="true" />}
        <div className="ui-sheet-head">
          <h2 id={titleId} className="t-section">
            {title}
          </h2>
          <button type="button" className="ui-iconbtn sm" aria-label="닫기" onClick={onClose}>
            <X size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <div className="ui-sheet-body">{children}</div>
        {footer && <div className="ui-sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

// ───────────────────────── 토스트 ─────────────────────────

interface ToastItem {
  id: number;
  text: string;
  tone: "info" | "warn" | "ok";
}
const ToastCtx = createContext<(text: string, tone?: ToastItem["tone"]) => void>(() => {});

/** 짧은 확인 메시지(기록 완료·규칙 준수에만 피드백. 축하 효과는 쓰지 않는다) */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((text: string, tone: ToastItem["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {createPortal(
        <div className="ui-toasts" role="status" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`ui-toast ${t.tone}`}>
              {t.tone === "warn" ? <AlertTriangle className="ico" size={16} strokeWidth={1.5} aria-hidden="true" /> : t.tone === "ok" ? <CheckCircle2 className="ico" size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
              <span>{t.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
