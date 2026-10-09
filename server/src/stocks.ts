import type { StockInfo } from "@jusik/shared";

/**
 * 내장 종목 목록(검색용). 증권사 API에는 종목명 검색이 없어서 로컬 목록을 쓴다.
 * 전체 종목이 필요하면 KRX 종목 마스터 파일을 받아 이 배열을 대체하면 된다.
 */
export const STOCKS: StockInfo[] = [
  { code: "005930", name: "삼성전자", market: "KOSPI" },
  { code: "005935", name: "삼성전자우", market: "KOSPI" },
  { code: "000660", name: "SK하이닉스", market: "KOSPI" },
  { code: "373220", name: "LG에너지솔루션", market: "KOSPI" },
  { code: "207940", name: "삼성바이오로직스", market: "KOSPI" },
  { code: "005380", name: "현대차", market: "KOSPI" },
  { code: "000270", name: "기아", market: "KOSPI" },
  { code: "006400", name: "삼성SDI", market: "KOSPI" },
  { code: "051910", name: "LG화학", market: "KOSPI" },
  { code: "003670", name: "포스코퓨처엠", market: "KOSPI" },
  { code: "005490", name: "POSCO홀딩스", market: "KOSPI" },
  { code: "035420", name: "NAVER", market: "KOSPI" },
  { code: "035720", name: "카카오", market: "KOSPI" },
  { code: "068270", name: "셀트리온", market: "KOSPI" },
  { code: "105560", name: "KB금융", market: "KOSPI" },
  { code: "055550", name: "신한지주", market: "KOSPI" },
  { code: "012330", name: "현대모비스", market: "KOSPI" },
  { code: "028260", name: "삼성물산", market: "KOSPI" },
  { code: "009150", name: "삼성전기", market: "KOSPI" },
  { code: "015760", name: "한국전력", market: "KOSPI" },
  { code: "017670", name: "SK텔레콤", market: "KOSPI" },
  { code: "096770", name: "SK이노베이션", market: "KOSPI" },
  { code: "034020", name: "두산에너빌리티", market: "KOSPI" },
  { code: "012450", name: "한화에어로스페이스", market: "KOSPI" },
  { code: "000720", name: "현대건설", market: "KOSPI" },
  { code: "008770", name: "호텔신라", market: "KOSPI" },
  { code: "090430", name: "아모레퍼시픽", market: "KOSPI" },
  { code: "051900", name: "LG생활건강", market: "KOSPI" },
  { code: "128940", name: "한미약품", market: "KOSPI" },
  { code: "036570", name: "엔씨소프트", market: "KOSPI" },
  { code: "352820", name: "하이브", market: "KOSPI" },
  { code: "259960", name: "크래프톤", market: "KOSPI" },
  { code: "001820", name: "삼화콘덴서", market: "KOSPI" },
  { code: "020150", name: "일진머티리얼즈", market: "KOSPI" },
  { code: "247540", name: "에코프로비엠", market: "KOSDAQ" },
  { code: "028300", name: "HLB", market: "KOSDAQ" },
  { code: "066970", name: "엘앤에프", market: "KOSDAQ" },
  { code: "086900", name: "메디톡스", market: "KOSDAQ" },
  { code: "078340", name: "컴투스", market: "KOSDAQ" },
];

export function findStock(code: string): StockInfo | undefined {
  return STOCKS.find((s) => s.code === code);
}

export function searchStocks(q: string, limit = 10): StockInfo[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  return STOCKS.filter((s) => s.code.startsWith(query) || s.name.toLowerCase().includes(query)).slice(0, limit);
}
