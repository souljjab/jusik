import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { navigate, useRoute } from "../../app/router";
import { Tabs, useBreakpoint } from "../../ui";
import { JournalTab } from "./JournalTab";
import { breaches, inRange, periodRange } from "./recordsModel";
import { ReviewTab } from "./ReviewTab";
import { RulesTab } from "./RulesTab";
import { kstDate } from "../../ui";
import "./records.css";

/*
 * 기록(UI 지도서 2장 M5 복기·기록 — 매매일지, 주간·월간 복기, 규칙 준수율).
 *  /records          매매일지(이번 주 요약·새 일지·기록)
 *  /records/review   복기(일·주·월 요약, 거래별 결과, 감정별 결과, 위반, 일일 복기)
 *  /records/rules    규칙 점검(모의매매 실적·과거 재현으로 점수 기준 점검)
 * 탭을 바꿔도 기록을 남기지 않는다(navigate replace). 기록 완료와 규칙 준수에만 피드백한다(지도서 1.4).
 */

type TabId = "journal" | "review" | "rules";
const PATH: Record<TabId, string> = { journal: "/records", review: "/records/review", rules: "/records/rules" };
const tabOf = (seg: string | undefined): TabId => (seg === "review" ? "review" : seg === "rules" ? "rules" : "journal");

export default function RecordsScreen() {
  const { journal, refreshJournal, now } = useApp();
  const route = useRoute();
  const bp = useBreakpoint();
  const tab = tabOf(route.segments[1]);

  // 공용 일지는 처음에 빈 목록이라, 이 화면에서 한 번 받아 본 뒤에야 '기록 없음'을 보여 준다
  const [loaded, setLoaded] = useState(journal.length > 0);
  useEffect(() => {
    let alive = true;
    void refreshJournal().finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [refreshJournal]);

  // 이번 주 위반 수(탭 이름 옆, 색에만 기대지 않게 아이콘 + 숫자)
  const weekBreaches = useMemo(() => {
    const w = periodRange("week", kstDate(now));
    return journal.filter((e) => inRange(e.date, w) && breaches(e).length > 0).length;
  }, [journal, now]);

  const items = [
    { value: "journal" as const, label: "매매일지" },
    {
      value: "review" as const,
      label: (
        <span className="rec-tablbl">
          복기
          {weekBreaches > 0 && (
            <>
              <span className="rec-tabmark" aria-hidden="true">
                <AlertTriangle size={12} strokeWidth={1.5} />
                {weekBreaches}
              </span>
              <span className="sr-only">, 이번 주 위반 {weekBreaches}건</span>
            </>
          )}
        </span>
      ),
    },
    { value: "rules" as const, label: "규칙 점검" },
  ];

  return (
    <div className={`rec reading is-${bp}`}>
      <div className="rec-head">
        <h1 className={bp === "compact" ? "sr-only" : "t-title"}>기록</h1>
        {bp !== "compact" && <p className="t-2">매매를 기록하고 규칙을 지켰는지 돌아봐요. 모의매매 기록은 서버가 자동으로 남겨요.</p>}
      </div>
      <Tabs idBase="rec" label="기록 화면" value={tab} items={items} onChange={(v) => navigate(PATH[v], { replace: true })} className="rec-tabs" />
      <div id={`rec-${tab}`} role="tabpanel" aria-labelledby={`rec-tab-${tab}`} className="rec-panel">
        {tab === "journal" ? <JournalTab loaded={loaded} /> : tab === "review" ? <ReviewTab loaded={loaded} /> : <RulesTab />}
      </div>
    </div>
  );
}
