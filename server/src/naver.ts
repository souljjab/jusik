import * as cheerio from "cheerio";
import type { Candle, Fundamentals, Market, PeriodFinancials, Quote } from "@jusik/shared";
import type { UniverseRow } from "./provider";

/*
 * 네이버 금융(국내) 수집 — 공식 API가 아니라 웹페이지/비공식 엔드포인트를 읽는다.
 * 사이트 구조가 바뀌면 깨질 수 있으니 `npm run check:sources -w server`로 주기적으로 확인하세요.
 */

export const NAVER = {
  chart: (code: string, count: number) => `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=${count}&requestType=0`,
  ranking: (kind: "quant" | "rise", market: Market) => `https://finance.naver.com/sise/sise_${kind}.naver?sosok=${market === "KOSDAQ" ? 1 : 0}`,
  realtime: (codes: string[]) => `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${codes.join(",")}`,
  main: (code: string) => `https://finance.naver.com/item/main.naver?code=${code}`,
};

const toNum = (s: string | undefined | null): number | undefined => {
  if (s == null) return undefined;
  const t = s.replace(/[,\s%원배]/g, "");
  if (t === "" || t === "-" || t === "N/A") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/** fchart XML: <item data="YYYYMMDD|시가|고가|저가|종가|거래량" /> */
export function parseFchart(xml: string): Candle[] {
  const out: Candle[] = [];
  for (const m of xml.matchAll(/<item\s+data="(\d{8})\|([\d.]+)\|([\d.]+)\|([\d.]+)\|([\d.]+)\|(\d+)"/g)) {
    const [, d, o, h, l, c, v] = m;
    const close = Number(c);
    if (!(close > 0)) continue;
    out.push({ date: `${d!.slice(0, 4)}-${d!.slice(4, 6)}-${d!.slice(6, 8)}`, open: Number(o) || close, high: Number(h) || close, low: Number(l) || close, close, volume: Number(v) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 거래량 상위 / 상승률 상위 표. 헤더 이름으로 열을 찾으므로 열 순서가 바뀌어도 견딘다. */
export function parseRankingTable(html: string, market: Market): UniverseRow[] {
  const $ = cheerio.load(html);
  const table = $("table.type_2").first();
  const heads = table.find("tr").first().find("th").map((_, e) => $(e).text().replace(/\s+/g, "")).get();
  const col = (name: string) => heads.findIndex((h) => h.startsWith(name));
  const iPrice = col("현재가"), iPct = col("등락률"), iVol = col("거래량"), iVal = col("거래대금");
  if (iPrice < 0 || iPct < 0 || iVol < 0) return [];
  const rows: UniverseRow[] = [];
  table.find("tr").each((_, tr) => {
    const a = $(tr).find('a[href*="code="]').first();
    const code = /code=(\d{6})/.exec(a.attr("href") ?? "")?.[1];
    const tds = $(tr).find("td");
    if (!code || tds.length <= Math.max(iPrice, iPct, iVol)) return;
    const price = toNum($(tds[iPrice]).text());
    let pct = toNum($(tds[iPct]).text());
    const volume = toNum($(tds[iVol]).text());
    if (price == null || pct == null || volume == null) return;
    // 부호가 없는 값은 하락(파랑) 클래스로 방향을 판단
    const cell = $(tds[iPct]);
    if (pct > 0 && !/\+/.test(cell.text()) && (cell.find('[class*="nv"]').length > 0 || /nv0/.test(cell.attr("class") ?? ""))) pct = -pct;
    const value = iVal >= 0 ? toNum($(tds[iVal]).text()) : undefined; // 백만원 단위
    rows.push({ code, name: a.text().trim(), market, price, changePct: pct, volume, tradeValue: value != null ? value * 1_000_000 : price * volume });
  });
  return rows;
}

/** polling.finance.naver.com 실시간 JSON → { 종목코드: 현재가 } 와 상세 */
export interface RealtimeItem {
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
}

export function parseRealtime(text: string): RealtimeItem[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const areas = (json as { result?: { areas?: { datas?: Record<string, unknown>[] }[] } })?.result?.areas ?? [];
  const out: RealtimeItem[] = [];
  for (const area of areas)
    for (const d of area.datas ?? []) {
      const price = Number(d.nv);
      if (!(price > 0)) continue;
      out.push({ code: String(d.cd), name: String(d.nm ?? ""), price, change: Number(d.cv ?? 0), changePct: Number(d.cr ?? 0), volume: Number(d.aq ?? 0) });
    }
  return out;
}

export function realtimeToQuote(r: RealtimeItem): Quote {
  return { code: r.code, price: r.price, change: r.change, changePct: r.changePct, volume: r.volume };
}

/*
 * ⚠ 아래 재무·업종 PER 파서는 네이버 종목 메인 페이지 마크업을 기억대로 가정해 짰고, 실제 응답과 대조하지 못했다(이 환경은 외부 접속 불가).
 *   - '기업실적분석' 표: div.cop_analysis table, 첫 머리행의 첫 colspan 칸 = 연간 열 개수, 기간 머리행 "2023.12", 추정치 "2024.12(E)"
 *   - 실제 페이지는 기간 행 아래 'IFRS연결' 같은 머리행이 더 있을 수 있어, 날짜가 가장 많은 머리행을 기간 행으로 쓴다
 *   - 동일업종 PER: 라벨 문구("동일업종 PER")만 믿고 가장 가까운 숫자를 읽는다
 *   `npm run check:sources -w server`로 실제 페이지에서 annual·quarterly·sectorPer가 채워지는지 확인하세요.
 */

const squash = (s: string) => s.replace(/\s+/g, "");
const PERIOD = /\d{4}[./-]\d{1,2}/;

/** 괄호 속(날짜 등)은 건너뛰고 첫 숫자를 읽는다 */
const firstNumber = (s: string): number | undefined => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(s.replace(/\([^)]*\)/g, ""));
  return m ? toNum(m[0]) : undefined;
};

function sectorPerFrom($: cheerio.CheerioAPI): number | undefined {
  // 1) 표·정의 목록: 라벨 칸(th/dt) 바로 옆 값 칸(td/dd)
  for (const el of $("th, dt").toArray()) {
    if (!squash($(el).text()).includes("동일업종PER")) continue;
    const n = firstNumber($(el).nextAll("td, dd").first().text());
    if (n !== undefined) return n;
  }
  // 2) 그 밖의 마크업: 라벨 바로 뒤에 붙은 '숫자배'(설명 문구 속 라벨은 숫자가 바로 붙지 않아 걸리지 않는다)
  const m = /동일업종PER(?:\([^)]*\))?[:：]?(-?\d[\d,]*(?:\.\d+)?)배/.exec(squash($.root().text()));
  return m ? toNum(m[1]) : undefined;
}

/** 종목 메인 페이지의 '동일업종 PER'(배). 못 찾으면 undefined */
export function parseNaverSectorPer(html: string): number | undefined {
  return sectorPerFrom(cheerio.load(html));
}

/**
 * 종목 메인 페이지 '기업실적분석' 표.
 * 단일 값(PER·부채비율 등)은 가장 최근 확정(비추정) 연간 값, annual·quarterly는 기간별 매출액·영업이익·당기순이익·EPS(금액은 억 원).
 * 동일업종 PER(sectorPer)도 같은 페이지에서 읽는다.
 */
export function parseNaverFundamentals(html: string): Fundamentals {
  const $ = cheerio.load(html);
  const sectorPer = sectorPerFrom($);
  const table = $("div.cop_analysis table").first();
  if (!table.length) return sectorPer !== undefined ? { sectorPer } : {};
  const headRows = table.find("thead tr").toArray();
  const annualCount = Number($(headRows[0]).find("th[colspan]").first().attr("colspan")) || 4;
  // 기간 머리행: 날짜 칸이 가장 많은 행(없으면 예전처럼 마지막 머리행). 앞쪽에 날짜 아닌 칸이 있으면 떼어 td 위치와 맞춘다
  const dated = (texts: string[]) => texts.filter((t) => PERIOD.test(t)).length;
  const heads = headRows.map((tr) => $(tr).find("th").toArray().map((e) => squash($(e).text())));
  const best = heads.reduce<string[]>((b, r) => (dated(r) > dated(b) ? r : b), []);
  const periodRow = dated(best) > 0 ? best : (heads.at(-1) ?? []);
  const firstDate = periodRow.findIndex((t) => PERIOD.test(t));
  const periods = firstDate > 0 ? periodRow.slice(firstDate) : periodRow;
  const rows = new Map<string, (number | undefined)[]>();
  table.find("tbody tr").each((_, tr) => {
    const label = squash($(tr).find("th").first().text());
    // cheerio의 map()은 undefined를 버려서 '-' 칸이 있으면 열이 밀린다 → toArray()로 위치를 유지한다
    if (label && !rows.has(label)) rows.set(label, $(tr).find("td").toArray().map((td) => toNum($(td).text())));
  });
  const isEstimate = (p: string) => /\(E\)/.test(p);
  const confirmed = periods.slice(0, annualCount).map((p, i) => ({ i, ok: !isEstimate(p) })).filter((x) => x.ok).map((x) => x.i);
  // 같은 접두어 행(영업이익/영업이익률)이 있어 정확히 같은 라벨을 먼저 쓴다
  const row = (name: string) => rows.get(name) ?? [...rows.entries()].find(([k]) => k.startsWith(name))?.[1];
  const latest = (prefix: string): number | undefined => {
    const r = row(prefix);
    if (!r) return undefined;
    for (let k = confirmed.length - 1; k >= 0; k--) {
      const v = r[confirmed[k]!];
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const growth = (prefix: string): number | undefined => {
    const r = row(prefix);
    if (!r) return undefined;
    const vals = confirmed.map((i) => r[i]).filter((v): v is number => v !== undefined);
    if (vals.length < 2) return undefined;
    const prev = vals[vals.length - 2]!, cur = vals[vals.length - 1]!;
    return prev > 0 ? ((cur - prev) / prev) * 100 : undefined;
  };
  const ITEMS = [["revenue", "매출액"], ["opIncome", "영업이익"], ["netIncome", "당기순이익"], ["eps", "EPS"]] as const;
  const series = (from: number, to: number): PeriodFinancials[] => {
    const out: PeriodFinancials[] = [];
    for (let i = from; i < Math.min(to, periods.length); i++) {
      const p: PeriodFinancials = { period: periods[i]!.replace(/\(E\)/g, ""), estimate: isEstimate(periods[i]!) };
      for (const [k, label] of ITEMS) {
        const v = row(label)?.[i];
        if (v !== undefined) p[k] = v;
      }
      if (ITEMS.some(([k]) => p[k] !== undefined)) out.push(p); // 값이 하나도 없는 기간('-'뿐인 추정 열 등)은 뺀다
    }
    return out;
  };
  const annual = series(0, annualCount);
  const quarterly = series(annualCount, periods.length);
  const f: Fundamentals = {
    per: latest("PER"), pbr: latest("PBR"), eps: latest("EPS"), bps: latest("BPS"), roe: latest("ROE"),
    debtRatio: latest("부채비율"), quickRatio: latest("당좌비율"), reserveRatio: latest("유보율"),
    revenueGrowth: growth("매출액"), opIncomeGrowth: growth("영업이익"), sectorPer,
    annual: annual.length ? annual : undefined, quarterly: quarterly.length ? quarterly : undefined,
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Fundamentals;
}
