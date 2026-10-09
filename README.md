# 주식 분석 어시스턴트

종목 검색 · 차트 · 재무/가치 분석 · 매수/매도 추천 신호 · 관심종목 · 백테스트를 제공하는 앱입니다.
PC 웹앱으로 먼저 만들고, 같은 코드를 Capacitor로 감싸 APK로 배포하는 것을 전제로 설계했습니다.
**추천 신호는 정해진 규칙으로 계산한 참고 정보이며 투자 권유가 아닙니다. 주문 기능은 없습니다(조회 전용).**

## 구조

```
shared/  분석 로직(지표·신호·가치평가·백테스트). 순수 TypeScript — 웹/서버/APK가 함께 사용
server/  시세 프록시 API(Fastify). 증권사 앱키를 클라이언트에 노출하지 않기 위해 필요
web/     React + Vite 화면(PWA 매니페스트 포함)
```

## 실행

```bash
npm install
npm run dev        # 서버 :8787 + 웹 :5173 동시 실행 → http://localhost:5173
npm test           # 단위 테스트
npm run typecheck
npm run build      # web/dist 생성
```

기본값은 **샘플 데이터**(가짜 시세, 화면에 "샘플 데이터" 표시)라 키 없이 바로 실행됩니다.

## 한국투자증권 API 연동

1. https://apiportal.koreainvestment.com 에서 앱키/시크릿 발급
2. `server/.env.example` → `server/.env` 복사 후 입력
   ```
   PROVIDER=kis
   KIS_APP_KEY=...
   KIS_APP_SECRET=...
   KIS_BASE_URL=https://openapi.koreainvestment.com:9443   # 모의투자는 https://openapivts.koreainvestment.com:29443
   ```
3. `npm run dev`

`.env`와 `.kis-token.json`은 `.gitignore`에 들어 있습니다. 키는 절대 커밋하지 마세요.

> **키움증권 OpenAPI+는 쓸 수 없습니다.** Windows 전용 OCX(COM)라서 웹/APK 구조와 맞지 않습니다.
> REST 방식인 한국투자증권(KIS)을 사용합니다. 다른 증권사를 쓰려면 `server/src/provider.ts` 인터페이스를 구현하면 됩니다.

**검증 상태:** KIS 제공자는 응답 형식을 가짜 `fetch`로 흉내 낸 단위 테스트(토큰 발급·재발급, 100봉 단위 페이지 조회, 오류 처리)까지만 확인했습니다.
실제 계정으로는 아직 호출해 보지 않았으므로, 처음 연동할 때 필드명(특히 `finance/financial-ratio`의 성장률·부채비율)이 맞는지 확인이 필요합니다.
종목명 검색은 증권사 API에 없어서 `server/src/stocks.ts`의 내장 목록(40종목)을 씁니다. 전체 종목이 필요하면 KRX 종목 마스터로 교체하세요.

## 분석 로직 요약

| 구분 | 내용 |
|---|---|
| 기술 점수(-100~100) | 20/60/120일선 위치, 골든·데드크로스, MACD, RSI(과매수·과매도), 볼린저밴드, 거래량 급증 |
| 재무 점수(-100~100) | PER, PBR, ROE, 매출·영업이익 증가율, 부채비율 (확인된 지표만 정규화) |
| 종합 | 기술 60% + 재무 40% (재무 데이터 없으면 기술만). ≥50 강력매수, ≥20 매수, 그 사이 관망, ≤-20 매도, ≤-50 강력매도 |
| 참고 손절/목표 | 종가 ∓ ATR(14)×2 / ×3 |
| 백테스트 | 전일 종가 신호 → **다음날 시가** 체결, 수수료 0.015% + 매도세 0.18%, 단순보유와 비교. 재무 점수는 과거 데이터가 없어 제외 |

점수 가중치와 기준값은 임의로 정한 출발점이며 검증된 수익 전략이 아닙니다. 백테스트로 확인하면서 조정하세요.

## APK로 배포하기 (다음 단계)

APK에서는 `localhost`의 서버를 쓸 수 없으므로 **서버를 어딘가에 배포**해야 합니다(키는 서버에만 둡니다).

```bash
# 1) 서버를 배포한 뒤 그 주소로 웹을 빌드
VITE_API_BASE=https://your-server.example.com npm run build

# 2) Capacitor로 Android 프로젝트 생성
cd web
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init jusik com.example.jusik --web-dir=dist
npx cap add android && npx cap sync android
npx cap open android      # Android Studio에서 APK/AAB 빌드
```

서버에 CORS 허용 도메인을 제한하고(`server/src/app.ts`), 가능하면 간단한 인증을 붙이세요.
