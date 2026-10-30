import type { Disclosure, InvestorFlow, SectorRow } from "@jusik/shared";
import type { Http } from "./http";
import { NAVER_API, NAVER_API_OPTS, parseNaverDisclosures, parseNaverIndustries, parseNaverIndustryGroup, parseNaverIntegration, parseNaverTrend } from "./naverApi";

/*
 * 국내 종목의 외국인·기관 순매매, 공시 목록, 업종(네이버페이 증권 모바일 JSON API, naverApi.ts).
 * 예전 PC 페이지(item/frgn·news_notice, sise_group)는 새 사이트로 넘어가 HTML 표를 주지 않는다.
 */

const isKrCode = (code: string) => /^\d{6}$/.test(code);

/** 외국인·기관 순매매(날짜 오름차순). pages는 예전 PC 페이지 수(한 페이지 약 20일)와 같은 뜻으로, 20 × pages일을 받는다 */
export async function fetchInvestorFlows(http: Http, code: string, pages = 2): Promise<InvestorFlow[]> {
  if (!isKrCode(code)) return [];
  return parseNaverTrend(await http.get(NAVER_API.trend(code, 20 * Math.max(1, pages)), NAVER_API_OPTS));
}

/** 공시 목록(최신순) */
export async function fetchDisclosures(http: Http, code: string): Promise<Disclosure[]> {
  if (!isKrCode(code)) return [];
  return parseNaverDisclosures(await http.get(NAVER_API.disclosure(code), NAVER_API_OPTS));
}

/** 업종 목록과 등락률 */
export async function fetchSectors(http: Http): Promise<SectorRow[]> {
  return parseNaverIndustries(await http.get(NAVER_API.industries(), NAVER_API_OPTS));
}

/** 종목이 속한 업종 { no, name }: 종목 요약의 업종 번호 → 그 업종의 이름 */
export async function fetchItemSector(http: Http, code: string): Promise<{ no: string; name: string } | null> {
  if (!isKrCode(code)) return null;
  const no = parseNaverIntegration(await http.get(NAVER_API.integration(code), NAVER_API_OPTS)).industryCode;
  if (!no) return null;
  return parseNaverIndustryGroup(await http.get(NAVER_API.industry(no), NAVER_API_OPTS));
}
