import { useCallback, useEffect, useState } from "react";
import { fetchHealth, type Health } from "./api";
import { BacktestTab } from "./BacktestTab";
import { ChartPanel } from "./ChartPanel";
import { FundamentalsTab } from "./FundamentalsTab";
import { RecommendationCard } from "./RecommendationCard";
import { SearchBox } from "./SearchBox";
import { Watchlist } from "./Watchlist";
import { num, pct, tone, won } from "./format";
import { loadWatchlist, saveWatchlist } from "./storage";
import { useStock } from "./useStock";

type Tab = "signal" | "fundamentals" | "backtest";
const TABS: [Tab, string][] = [["signal", "차트·신호"], ["fundamentals", "재무·가치"], ["backtest", "백테스트"]];

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState(false);
  const [watch, setWatch] = useState<string[]>(loadWatchlist);
  const [code, setCode] = useState<string | null>(() => loadWatchlist()[0] ?? "005930");
  const [tab, setTab] = useState<Tab>("signal");
  const { data, error, loading } = useStock(code);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealthErr(true));
  }, []);

  const update = useCallback((next: string[]) => {
    setWatch(next);
    saveWatchlist(next);
  }, []);

  const starred = !!code && watch.includes(code);
  const toggleStar = () => code && update(starred ? watch.filter((c) => c !== code) : [...watch, code]);

  return (
    <div className="app">
      <header className="top">
        <h1>📈 주식 분석 어시스턴트</h1>
        <SearchBox onPick={setCode} />
        {health?.sample && <span className="pill warn-pill" title="실제 시세가 아닌 임의로 만든 데이터예요">샘플 데이터</span>}
        {health && !health.sample && <span className="pill">실시간 연동: {health.provider.toUpperCase()}</span>}
      </header>

      {healthErr && (
        <div className="banner error">
          서버에 연결할 수 없어요. <code>npm run dev</code> 로 서버(포트 8787)가 켜져 있는지 확인해 주세요.
        </div>
      )}

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
                  <h2>{data.info.name} <small className="muted">{data.info.code} · {data.info.market}</small></h2>
                  <div className="price">
                    <b className={tone(data.quote.change)}>{won(data.quote.price)}</b>
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

              <nav className="tabs" role="tablist">
                {TABS.map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
                ))}
              </nav>

              {tab === "signal" && (
                <>
                  <RecommendationCard rec={data.rec} />
                  <div className="card"><ChartPanel candles={data.candles} /></div>
                </>
              )}
              {tab === "fundamentals" && <FundamentalsTab f={data.fundamentals} rec={data.rec} />}
              {tab === "backtest" && <BacktestTab candles={data.candles} />}
            </>
          )}
        </main>
      </div>

      <footer>
        본 앱의 신호는 정해진 규칙으로 계산한 참고 정보이며 투자 권유가 아니에요. 과거 성과가 미래 수익을 보장하지 않고, 투자 판단과 책임은 본인에게 있어요.
      </footer>
    </div>
  );
}
