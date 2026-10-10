import * as cheerio from "cheerio";
import type { Disclosure, InvestorFlow, SectorRow } from "@jusik/shared";
import type { GetOptions, Http } from "./http";
import { NAVER } from "./naver";

/*
 * 네이버 금융 추가 수집: 외국인·기관 순매매, 공시 목록, 업종 시세, 종목의 업종.
 *
 * ⚠ 미검증: 이 파일의 파서는 네이버 금융 페이지 구조를 기억에 기대어 짰다. 작성 환경에서 외부 접속이 막혀 있어
 * 실제 응답과 대조하지 못했고, 테스트 샘플도 형식을 흉내 낸 것일 뿐 실제 응답·실제 수치가 아니다.
 * 그래서 열 위치 대신 머리글 이름으로 열을 찾고, 못 찾으면 빈 배열을 돌려준다(틀린 값보다 없는 값).
 * 운영 전에 실제 페이지로 한 번 확인하세요.
 */

export const NAVER_EXTRA = {
  /** 외국인·기관 순매매 거래량(일별, 한 페이지 약 20일) */
  investor: (code: string, page = 1) => `https://finance.naver.com/item/frgn.naver?code=${code}&page=${page}`,
  /** 종목 공시 목록(뉴스·공시 탭 안의 iframe 페이지) */
  notice: (code: string, page = 1) => `https://finance.naver.com/item/news_notice.naver?code=${code}&page=${page}`,
  /** 업종별 시세 */
  sectors: () => "https://finance.naver.com/sise/sise_group.naver?type=upjong",
  sectorDetail: (no: string) => `https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no=${no}`,
};

const isKrCode = (code: string) => /^\d{6}$/.test(code);

// iframe 페이지가 직접 요청을 거부할 수 있어 종목 메인을 referer로 붙인다(필요한지는 미검증)
const opts = (code?: string): GetOptions => ({
  encoding: "auto",
  headers: { referer: code ? NAVER.main(code) : "https://finance.naver.com/" },
});

// ───────────────────────── 공통 헬퍼 ─────────────────────────

type $T = cheerio.CheerioAPI;
type Sel = ReturnType<$T>;

const squashText = (s: string) => s.replace(/\s+/g, "");

/** 'YYYY.MM.DD', 'YYYY-MM-DD', 'YY.MM.DD', 'YYYYMMDD'(뒤에 시각이 붙어도 됨) → 'YYYY-MM-DD'. 못 읽으면 undefined */
export function normalizeNaverDate(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  const m =
    /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/.exec(t) ??
    /(?<!\d)(\d{2})\.(\d{1,2})\.(\d{1,2})(?!\d)/.exec(t) ??
    /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/.exec(t);
  if (!m) return undefined;
  const y = m[1]!.length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  const mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 셀 숫자 읽기(naver.ts의 toNum과 같은 방식: 숫자·부호·소수점만 남긴다). 못 읽으면 undefined */
function num(cell: Sel | undefined): number | undefined {
  if (!cell || !cell.length) return undefined;
  const t = cell.text().replace(/[^\d.+-]/g, "");
  if (t === "" || t === "-" || t === "+" || t === ".") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 부호가 있는 값(순매매량·등락률). 부호가 적혀 있으면 그대로 쓰고, 부호가 없는데 하락 표시
 * (파란 nv 클래스, ▼, '하락' 이미지)가 있으면 음수로 본다. 종가·거래량처럼 색만 칠해진 값에는 쓰지 않는다.
 */
function signedNum(cell: Sel | undefined): number | undefined {
  const n = num(cell);
  if (n == null || n === 0 || /[+-]/.test(cell!.text())) return n;
  const down =
    /▼|하락/.test(cell!.text()) ||
    /\bnv\d*\b|\bdown\b/.test(cell!.attr("class") ?? "") ||
    cell!.find('[class*="nv"], [class*="down"]').length > 0 ||
    cell!.find('img[alt*="하락"]').length > 0;
  return down ? -n : n;
}

/** 이 표에 직접 속한 행만(안쪽에 끼인 다른 표의 행 제외) */
function ownRows($: $T, table: Sel) {
  const el = table.get(0);
  return table.find("tr").toArray().filter((tr) => $(tr).closest("table").get(0) === el);
}

/**
 * 머리글(td 없이 th만 있는 행들)을 rowspan/colspan까지 펼쳐 열별 이름을 만든다.
 * 2줄 머리글(예: 위 '외국인' colspan=3, 아래 '순매매량|보유주수|보유율')은 위아래 이름을 이어 '외국인순매매량'이 된다.
 */
function headerLabels($: $T, table: Sel): string[] {
  const grid: string[][] = [];
  let r = 0;
  for (const tr of ownRows($, table)) {
    const cells = $(tr).children("th,td").toArray();
    if (!cells.length) continue;
    if (cells.some((c) => $(c).is("td"))) {
      if (!grid.length && !squashText($(tr).text())) continue; // 머리글 앞 빈 구분 행
      break; // 데이터 행 시작
    }
    const row = (grid[r] ??= []);
    let c = 0;
    for (const cell of cells) {
      while (row[c] !== undefined) c++;
      const text = squashText($(cell).text());
      const cs = Math.max(1, Number($(cell).attr("colspan")) || 1);
      const rs = Math.max(1, Number($(cell).attr("rowspan")) || 1);
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) (grid[r + dr] ??= [])[c + dc] = text;
      c += cs;
    }
    r++;
  }
  const width = Math.max(0, ...grid.map((g) => g.length));
  return Array.from({ length: width }, (_, c) => {
    const parts: string[] = [];
    for (const g of grid) {
      const t = g[c];
      if (t && parts.at(-1) !== t) parts.push(t);
    }
    return parts.join("");
  });
}

/** 데이터 행(td가 있는 행)의 칸을 열 번호에 맞춰 펼친다(colspan이 있으면 같은 칸이 여러 열을 차지) */
function dataRows($: $T, table: Sel): Sel[][] {
  const out: Sel[][] = [];
  for (const tr of ownRows($, table)) {
    const cells = $(tr).children("th,td").toArray();
    if (!cells.some((c) => $(c).is("td"))) continue;
    const row: Sel[] = [];
    for (const cell of cells) {
      const cs = Math.max(1, Number($(cell).attr("colspan")) || 1);
      for (let k = 0; k < cs; k++) row.push($(cell));
    }
    out.push(row);
  }
  return out;
}

// ───────────────────────── 외국인·기관 ─────────────────────────

/**
 * frgn.naver 표 → 일별 수급(날짜 오름차순). 머리글 이름(날짜·종가·거래량·기관 순매매량·외국인 순매매량·보유율)으로 열을 찾는다.
 * 같은 페이지의 '거래원' 표처럼 필요한 열이 없는 표는 건너뛴다. 못 찾으면 [].
 */
export function parseInvestorFlows(html: string): InvestorFlow[] {
  const $ = cheerio.load(html);
  for (const t of $("table").toArray()) {
    const table = $(t);
    const heads = headerLabels($, table);
    const col = (ok: (h: string) => boolean) => heads.findIndex(ok);
    const iDate = col((h) => /^(날짜|일자)/.test(h));
    const iClose = col((h) => h.startsWith("종가"));
    const iVol = col((h) => h.startsWith("거래량") && !h.includes("순매"));
    const iInst = col((h) => h.includes("기관") && h.includes("순매"));
    const iFrgn = col((h) => h.includes("외국인") && h.includes("순매"));
    const iHold = col((h) => h.includes("보유율"));
    if ([iDate, iClose, iVol, iInst, iFrgn].some((i) => i < 0)) continue;

    const byDate = new Map<string, InvestorFlow>();
    for (const cells of dataRows($, table)) {
      const date = normalizeNaverDate(cells[iDate]?.text());
      const close = num(cells[iClose]);
      const volume = num(cells[iVol]);
      const institutionNet = signedNum(cells[iInst]);
      const foreignNet = signedNum(cells[iFrgn]);
      if (!date || close == null || !(close > 0) || volume == null || !(volume >= 0) || institutionNet == null || foreignNet == null) continue;
      const f: InvestorFlow = { date, close, volume, institutionNet, foreignNet };
      const hold = iHold >= 0 ? num(cells[iHold]) : undefined;
      if (hold != null) f.foreignHoldPct = hold;
      if (!byDate.has(date)) byDate.set(date, f);
    }
    if (byDate.size) return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  return [];
}

/** 여러 페이지를 읽어 합친다(날짜 오름차순). 첫 페이지 실패는 그대로 던지고, 뒤 페이지 실패는 그때까지 모은 것을 돌려준다 */
export async function fetchInvestorFlows(http: Http, code: string, pages = 2): Promise<InvestorFlow[]> {
  if (!isKrCode(code)) return [];
  const byDate = new Map<string, InvestorFlow>();
  for (let p = 1; p <= Math.max(1, pages); p++) {
    let rows: InvestorFlow[];
    try {
      rows = parseInvestorFlows(await http.get(NAVER_EXTRA.investor(code, p), opts(code)));
    } catch (e) {
      if (p === 1) throw e;
      break;
    }
    const before = byDate.size;
    for (const r of rows) if (!byDate.has(r.date)) byDate.set(r.date, r);
    // 마지막 페이지를 넘기면 같은 내용이 다시 올 수 있다 → 새 날짜가 없으면 멈춘다
    if (byDate.size === before) break;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────────────────── 공시 ─────────────────────────

const cleanTitle = (s: string) => s.replace(/\s+/g, " ").trim();

/** 제목 칸: 링크의 title 속성(잘리지 않은 전체 제목)을 먼저, 없으면 글자 */
function titleOf(cell: Sel | undefined): string {
  if (!cell) return "";
  const a = cell.find("a").first();
  return cleanTitle((a.length ? a.attr("title") || a.text() : cell.text()) ?? "");
}

/** news_notice.naver 공시 목록 → [{ date: YYYY-MM-DD, title }] (최신순). 머리글(제목·날짜)로 열을 찾고, 없으면 td.title/td.date 클래스로 찾는다 */
export function parseDisclosures(html: string): Disclosure[] {
  const $ = cheerio.load(html);
  let out: Disclosure[] = [];
  for (const t of $("table").toArray()) {
    const table = $(t);
    const heads = headerLabels($, table);
    const iTitle = heads.findIndex((h) => h.startsWith("제목") || h.startsWith("공시제목"));
    const iDate = heads.findIndex((h) => /^(날짜|일자|공시일)/.test(h));
    if (iTitle < 0 || iDate < 0) continue;
    for (const cells of dataRows($, table)) {
      const title = titleOf(cells[iTitle]);
      const date = normalizeNaverDate(cells[iDate]?.text());
      if (title && date) out.push({ date, title });
    }
    if (out.length) break;
  }
  if (!out.length) {
    $("tr").each((_, tr) => {
      const title = titleOf($(tr).find("td.title").first());
      const date = normalizeNaverDate($(tr).find("td.date").first().text());
      if (title && date) out.push({ date, title });
    });
  }
  const seen = new Set<string>();
  out = out.filter((d) => {
    const k = `${d.date}|${d.title}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  // 같은 날짜 안에서는 페이지 순서를 유지(안정 정렬)
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchDisclosures(http: Http, code: string): Promise<Disclosure[]> {
  if (!isKrCode(code)) return [];
  return parseDisclosures(await http.get(NAVER_EXTRA.notice(code, 1), opts(code)));
}

// ───────────────────────── 업종 ─────────────────────────

const upjongNo = (href: string | undefined): string | undefined =>
  href && /sise_group_detail/.test(href) && /type=upjong/.test(href) ? /[?&]no=(\d+)/.exec(href)?.[1] : undefined;

/** sise_group.naver?type=upjong → 업종 목록(페이지 순서). 등락률은 '전일대비' 열, 없으면 그 행의 첫 % 칸 */
export function parseSectors(html: string): SectorRow[] {
  const $ = cheerio.load(html);
  for (const t of $("table").toArray()) {
    const table = $(t);
    const heads = headerLabels($, table);
    const iPct = heads.findIndex((h) => (h.startsWith("전일대비") || h.startsWith("등락률")) && !h.includes("등락현황"));
    const rows: SectorRow[] = [];
    const seen = new Set<string>();
    for (const cells of dataRows($, table)) {
      const a = cells.map((c) => c.find('a[href*="sise_group_detail"]').first()).find((x) => x.length);
      const no = upjongNo(a?.attr("href"));
      const name = a ? cleanTitle(a.text()) : "";
      if (!no || !name || seen.has(no)) continue;
      let cell = iPct >= 0 ? cells[iPct] : undefined;
      if (!cell || !/%/.test(cell.text())) cell = cells.find((c) => /%/.test(c.text()));
      const changePct = signedNum(cell);
      if (changePct == null) continue;
      seen.add(no);
      rows.push({ no, name, changePct });
    }
    if (rows.length) return rows;
  }
  return [];
}

export async function fetchSectors(http: Http): Promise<SectorRow[]> {
  return parseSectors(await http.get(NAVER_EXTRA.sectors(), opts()));
}

/** 종목 메인 페이지의 업종 링크(sise_group_detail.naver?type=upjong&no=NNN) → { no, name }. 테마 링크(type=theme)는 무시 */
export function parseItemSector(html: string): { no: string; name: string } | null {
  const $ = cheerio.load(html);
  for (const a of $('a[href*="sise_group_detail"]').toArray()) {
    const no = upjongNo($(a).attr("href"));
    const name = cleanTitle($(a).text());
    if (no && name) return { no, name };
  }
  return null;
}

export async function fetchItemSector(http: Http, code: string): Promise<{ no: string; name: string } | null> {
  if (!isKrCode(code)) return null;
  return parseItemSector(await http.get(NAVER.main(code), opts(code)));
}
