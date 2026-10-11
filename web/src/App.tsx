import { useCallback, useEffect, useState } from "react";
import { regionOfCode, type JournalEntry } from "@jusik/shared";
import { fetchHealth, getJournal, type Health } from "./api";
import { AnalysisCard } from "./AnalysisCard";
import { BacktestTab } from "./BacktestTab";
import { ChartPanel } from "./ChartPanel";
import { DayTradeView } from "./DayTradeView";
import { FundamentalsTab } from "./FundamentalsTab";
import { JournalView } from "./JournalView";
import { MinutePanel } from "./MinutePanel";
import { ReviewView } from "./ReviewView";
import { RuleCheckView } from "./RuleCheckView";
import { SearchBox } from "./SearchBox";
import { Watchlist } from "./Watchlist";
import { moneyByCode, num, pct, tone } from "./format";
import { loadWatchlist, saveWatchlist } from "./storage";
import { useServerState } from "./useServerState";
import { useStock } from "./useStock";

type View = "daytrade" | "analysis" | "journal" | "review" | "rules";
type Tab = "signal" | "minute" | "fundamentals" | "backtest";
const VIEWS: [View, string][] = [["daytrade", "단타 추천"], ["analysis", "종목 분석"], ["journal", "매매일지"], ["review", "일일 복기"], ["rules", "규칙 점검"]];
const TABS: [Tab, string][] = [["signal", "차트·신호"], ["minute", "분봉"], ["fundamentals", "재무·스크리닝"], ["backtest", "백테스트"]];

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState(false);
  const [view, setView] = useState<View>("daytrade");
  const [watch, setWatch] = useState<string[]>(loadWatchlist);
  const [code, setCode] = useState<string | null>(() => loadWatchlist()[0] ?? "005930");
  const [tab, setTab] = useState<Tab>("signal");
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const { data, error, loading } = useStock(view === "analysis" ? code : null);
  const server = useServerState();

  const reloadJournal = useCallback(() => {
    getJournal().then(setJournal).catch(() => {});
  }, []);
  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealthErr(true));
    reloadJournal();
    const t = setInterval(reloadJournal, 20_000); // 모의매매가 자동으로 쓰는 기록을 따라간다
    return () => clearInterval(t);
  }, [reloadJournal]);

  const update = useCallback((next: string[]) => {
    setWatch(next);
    saveWatchlist(next);
  }, []);
  const openStock = (c: string) => {
    setCode(c);
    setTab("signal");
    setView("analysis");
  };

  const starred = !!code && watch.includes(code);
  const toggleStar = () => code && update(starred ? watch.filter((c) => c !== code) : [...watch, code]);
  const region = code ? regionOfCode(code) : "KR";

  return (
    <div className="app">
      <header className="top">
        <h1>📈 주식 분석 어시스턴트</h1>
        <SearchBox onPick={openStock} />
        {health?.sample && <span className="pill warn-pill" title="실제 시세가 아닌 임의로 만든 데이터예요">샘플 데이터</span>}
        {health && !health.sample && <span className="pill">{health.provider}</span>}
      </header>

      <nav className="tabs views jr-views" role="tablist">
        {VIEWS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{label}</button>
        ))}
      </nav>

      {healthErr && (
        <div className="banner error">
          서버에 연결할 수 없어요. <code>npm run dev</code> 로 서버(포트 8787)가 켜져 있는지 확인해 주세요.
        </div>
      )}

      {view === "daytrade" && <DayTradeView st={server.state} error={server.error} refresh={server.refresh} onOpen={openStock} />}

      {view === "journal" && <JournalView entries={journal} defaultCode={code} onChanged={() => { reloadJournal(); server.refresh(); }} />}

      {view === "review" && <ReviewView onOpen={openStock} />}

      {view === "rules" && <RuleCheckView currentMin={server.state?.settings.minScore ?? 55} refresh={server.refresh} />}

      {view === "analysis" && (
        <div className="body">
          <Watchlist codes={watch} selected={code} onSelect={setCode} onRemove={(c) => update(watch.filter((x) => x !== c))} />
          <main>
            {!code && <p className="muted">종목을 검색해 주세요.</p>}
            {code && error && <div className="banner error">데이터를 불러오지 못했어요: {error}</div>}
            {code && loading && !data && <p className="muted">불러오는 중…</p>}
            {data && (
              <>
                <div className="quote">
                  <div>
                    <h2>{data.info.name} <small className="muted">{data.info.code} · {data.info.market === "US" ? "미국" : data.info.market}</small></h2>
                    <div className="price">
                      <b className={tone(data.quote.change)}>{moneyByCode(data.quote.price, data.info.code)}</b>
                      <span className={tone(data.quote.change)}>
                        {data.quote.change > 0 ? "▲" : data.quote.change < 0 ? "▼" : "-"} {Math.abs(data.quote.change).toLocaleString()} ({pct(data.quote.changePct)})
                      </span>
                    </div>
                    {data.quote.marketCap != null && <div className="muted small">시가총액 {num(data.quote.marketCap, 0)}억원</div>}
                  </div>
                  <button className={starred ? "star on" : "star"} onClick={toggleStar} aria-pressed={starred} title={starred ? "관심종목에서 삭제" : "관심종목에 추가"}>
                    {starred ? "★ 관심종목" : "☆ 관심종목 추가"}
                  </button>
                </div>

                <nav className="tabs mn-tabs" role="tablist">
                  {TABS.map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
                  ))}
                </nav>

                {tab === "signal" && (
                  <>
                    <AnalysisCard a={data.analysis} code={data.info.code} journal={journal} region={region} settings={server.state?.settings ?? null} />
                    <div className="card"><ChartPanel candles={data.candles} /></div>
                  </>
                )}
                {tab === "minute" && <MinutePanel code={data.info.code} region={region} />}
                {tab === "fundamentals" && <FundamentalsTab f={data.fundamentals} a={data.analysis} region={region} />}
                {tab === "backtest" && <BacktestTab candles={data.candles} indexCandles={data.indexCandles} region={region} info={data.info} />}
              </>
            )}
          </main>
        </div>
      )}

      <footer>
        본 앱의 신호는 정해진 규칙으로 계산한 참고 정보이며 투자 권유가 아니에요. 과거 성과가 미래 수익을 보장하지 않고, 투자 판단과 책임은 본인에게 있어요.
      </footer>
    </div>
  );
}
