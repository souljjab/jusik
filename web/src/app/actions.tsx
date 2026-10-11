import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { EvidenceSheet, type EvidenceRequest } from "../features/EvidenceSheet";
import { OrderReviewSheet, type OrderRequest } from "../features/OrderReviewSheet";

/*
 * 어느 화면에서나 여는 떠 있는 층: 근거 보기, 주문 검토, 명령 검색, 단축키 도움말.
 * 시트 안에서 또 시트를 열지 않는다(근거 보기에서 주문으로 갈 때는 근거 시트를 닫고 연다).
 */
export interface Actions {
  openEvidence: (r: EvidenceRequest) => void;
  /** 주문 검토 시트만 연다(단축키로도 바로 체결되지 않는다) */
  openOrderReview: (r: OrderRequest) => void;
  openPalette: () => void;
  openShortcuts: () => void;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  closePalette: () => void;
  closeShortcuts: () => void;
}

const Ctx = createContext<Actions | null>(null);

export function useActions(): Actions {
  const v = useContext(Ctx);
  if (!v) throw new Error("ActionsProvider 안에서 써야 해요");
  return v;
}

export function ActionsProvider({ children }: { children: ReactNode }) {
  const [evidence, setEvidence] = useState<EvidenceRequest | null>(null);
  const [order, setOrder] = useState<OrderRequest | null>(null);
  const [paletteOpen, setPalette] = useState(false);
  const [shortcutsOpen, setShortcuts] = useState(false);

  const openOrderReview = useCallback((r: OrderRequest) => {
    setEvidence(null);
    setPalette(false);
    setOrder(r);
  }, []);
  const value = useMemo<Actions>(
    () => ({
      openEvidence: (r) => (setOrder(null), setEvidence(r)),
      openOrderReview,
      openPalette: () => setPalette(true),
      openShortcuts: () => setShortcuts(true),
      paletteOpen,
      shortcutsOpen,
      closePalette: () => setPalette(false),
      closeShortcuts: () => setShortcuts(false),
    }),
    [openOrderReview, paletteOpen, shortcutsOpen],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <EvidenceSheet req={evidence} onClose={() => setEvidence(null)} />
      <OrderReviewSheet req={order} onClose={() => setOrder(null)} />
    </Ctx.Provider>
  );
}
