import { useState } from "react";
import { useApp } from "../../app/AppContext";
import { Button, Notice, Skeleton } from "../../ui";

/** 불러오는 중: 실제 배치(소제목 + 입력 칸 두 줄씩)와 같은 모양 */
export function SectionLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="glb-loading" role="status" aria-label="불러오는 중">
      <Skeleton w={120} h={18} />
      <div className="glb-grid">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="stack">
            <Skeleton w={96} h={12} />
            <Skeleton h={40} />
            <Skeleton w={`${60 + (i % 3) * 12}%`} h={12} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 서버에 연결하지 못해 서버 설정을 보여 줄 수 없을 때 */
export function ServerMissing() {
  const { refreshServer } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Notice
      tone="warn"
      title="서버 설정을 불러오지 못했어요"
      action={
        <Button
          variant="secondary"
          busy={busy}
          onClick={() => {
            setBusy(true);
            void refreshServer().finally(() => setBusy(false));
          }}
        >
          다시 받기
        </Button>
      }
    >
      앱 서버가 켜져 있는지 확인해 주세요. 연결되면 자동으로 다시 받아요. 화면·알림 설정은 서버 없이도 바꿀 수 있어요.
    </Notice>
  );
}
