import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBreakpoint } from "./useBreakpoint";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 열려 있는 시트 수(시트 안에서 또 시트를 열지 않도록 확인용, 그리고 Esc는 맨 위 시트만 닫는다) */
const stack: string[] = [];

/**
 * 시트(떠 있는 층): 핸드폰·태블릿은 아래에서 올라오는 하단 시트, 컴퓨터는 오른쪽 시트 또는 가운데 창.
 * 열리면 첫 입력에 포커스를 두고 Tab이 시트 밖으로 나가지 않으며, Esc나 바깥(어두운 막)을 누르면 닫힌다.
 * 닫히면 연 버튼으로 포커스를 돌려준다. 그림자는 이런 떠 있는 층에만 쓴다.
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
  const opener = useRef<Element | null>(null);
  const resolved = side === "auto" ? (bp === "large" ? "right" : "bottom") : side;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    stack.push(id);
    const el = ref.current;
    const first = (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) || el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack.at(-1) !== id) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab" && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const a = items[0]!, z = items.at(-1)!;
        if (e.shiftKey && document.activeElement === a) (e.preventDefault(), z.focus());
        else if (!e.shiftKey && document.activeElement === z) (e.preventDefault(), a.focus());
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) document.body.style.overflow = prevOverflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="ui-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className={`ui-sheet ${resolved}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={wide && resolved !== "bottom" ? { width: "min(640px, 100vw)" } : undefined}>
        {resolved === "bottom" && <div className="ui-sheet-grip" aria-hidden="true" />}
        <div className="ui-sheet-head">
          <h2 id={titleId} className="t-section">
            {title}
          </h2>
          <button type="button" className="ui-iconbtn sm" aria-label="닫기" onClick={onClose}>
            <X size={18} aria-hidden="true" />
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
              {t.tone === "warn" ? <AlertTriangle className="ico" size={16} aria-hidden="true" /> : t.tone === "ok" ? <CheckCircle2 className="ico" size={16} aria-hidden="true" /> : null}
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
