import { ChevronLeft, Star } from "lucide-react";
import { regionOf, type Market } from "@jusik/shared";
import type { StockData } from "../../api";
import { useApp } from "../../app/AppContext";
import { href } from "../../app/router";
import { Change, IconButton, MarketStatus, Price, srQuote, useToast } from "../../ui";
import { objParticle } from "./stocksModel";
import { useExtras } from "./useExtras";

const MARKET_LABEL: Record<Market, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", US: "미국" };

/** 핸드폰·태블릿 세로: 관심종목 목록으로 돌아가기 */
export function BackLink() {
  return (
    <a className="stk-back" href={href("/stocks")}>
      <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
      관심종목
    </a>
  );
}

/**
 * 가격 머리말(UI 지도서 5.2 B): 현재가를 가장 크게, 등락은 색·삼각형·부호를 함께. 장 상태와 기준 시각, 관심종목 별.
 * 핸드폰·태블릿 세로에서는 위에 '관심종목'으로 돌아가는 단추를 둔다.
 */
export function StockHeader({ data, at, back = false }: { data: StockData; at: number | null; back?: boolean }) {
  const { now, isWatched, toggleWatch } = useApp();
  const toast = useToast();
  const { info, quote } = data;
  const region = regionOf(info.market);
  const extras = useExtras(region === "KR" ? info.code : null);
  const sector = extras.data?.sector?.name;
  const watched = isWatched(info.code);

  return (
    <header className="stk-head">
      {back && <BackLink />}
      <div className="stk-head-top">
        <div className="stk-head-name">
          <h1 className="t-title ellipsis">{info.name}</h1>
          <span className="t-2 ellipsis">
            {info.code} · {MARKET_LABEL[info.market]}
            {sector ? ` · ${sector}` : ""}
          </span>
        </div>
        <div className="stk-head-actions">
          <MarketStatus region={region} now={now} asOf={at} />
          <IconButton
            label={watched ? "관심종목에서 빼기" : "관심종목에 추가"}
            aria-pressed={watched}
            className={watched ? "stk-star on" : "stk-star"}
            onClick={() => {
              toggleWatch(info.code);
              toast(`${info.name}${objParticle(info.name)} 관심종목${watched ? "에서 뺐어요" : "에 추가했어요"}`, "ok");
            }}
          >
            <Star size={20} strokeWidth={watched ? 2 : 1.5} fill={watched ? "currentColor" : "none"} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <div className="stk-head-quote">
        <span className="sr-only">{srQuote(info.name, quote.price, quote.changePct, region)}</span>
        <span aria-hidden="true" className="row base wrap">
          <Price value={quote.price} region={region} size="lg" />
          <Change change={quote.change} pct={quote.changePct} region={region} />
        </span>
      </div>
    </header>
  );
}
