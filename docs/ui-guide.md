# 화면 구현 안내 (UI 지도서 → 코드)

원본: `docs/UI지도서.txt`(「주식 분석·매매 앱 UI 지도서」 본문). 이 문서는 그 지도서를 이 저장소의 코드로 옮길 때 지킬 규칙과
이미 만들어 둔 기반(토큰·껍데기·핵심 컴포넌트)을 정리한 것이다. 화면을 만들거나 고칠 때 먼저 읽는다.

## 1. 콘셉트와 원칙(지도서 1장)

규칙을 지키게 돕는 **차분한 계기판**. 흥분을 부추기지 않고, 시장 상태·신호의 근거·감수할 위험을 정확히 읽히게 한다.

1. **데이터가 주인공** — 위계는 여백·정렬·글자 굵기로. 화면마다 가장 중요한 숫자 하나(국면, 현재가, 예상 손실)만 크게(`.t-price`).
2. **근거 없이 신호를 보여주지 않는다** — 모든 신호·추천 옆에 근거 스트립(`EvidenceStrip`)과 '근거 보기'.
3. **위험을 버튼보다 먼저** — 주문 버튼 바로 위에 손절가·예상 손실·계좌 대비·비중 상한. 손절가 없는 주문은 만들 수 없다(`OrderReviewSheet`가 강제).
4. **상태를 숨기지 않는다** — 장 상태와 데이터 기준 시각(`MarketStatus`, `fmtAsOf`)을 시세 화면마다.
5. **기기마다 역할이 다르다** — 컴퓨터: 깊게 분석·설정 / 태블릿: 차트 검토·복기 / 핸드폰: 확인·신중한 주문·기록. 모든 기능을 모든 기기에 똑같이 넣지 않는다(지도서 부록 A).

**피할 것**: 모든 정보를 같은 모양의 둥근 카드로 쪼개기(→ 여백과 구분선, `Section`), 장식용 그라데이션·진한 그림자(그림자는 시트·메뉴·토스트에만),
상승·하락 색을 강조로 쓰기(강조는 보라 `--color-accent`), 체결 축하 효과·연속 매매 보상, '지금 안 사면 늦습니다' 같은 조급한 문장, 모노스페이스 숫자·영문 대문자 라벨.

## 2. 이 저장소의 결정 사항

- **말투는 해요체**로 통일한다(지도서 예시는 합쇼체지만 기존 앱 전체가 해요체).
- **실제 주문은 내지 않는다.** 증권사 연동이 없다. 주문 검토 시트의 '매수 확인'은 매매일지에 주문을 **기록**하고, 메시지도 "주문을 기록했어요. 실제 주문은 증권사 앱에서 내세요"처럼 사실대로 쓴다. '주문을 보냈습니다'라고 쓰지 않는다.
- 자동 매매는 **모의매매**(서버가 규칙대로 모의계좌로 진입·청산, 일지 자동 기록)뿐이다. 화면에서 '모의'임을 숨기지 않는다.
- 샘플 모드(`PROVIDER=mock`)면 상단 바에 '샘플 데이터'가 이미 보인다. 숫자를 실제 시세처럼 말하지 않는다.
- 휴장은 주말만 안다(공휴일 달력 없음). 지연 시세 분 수는 알 수 없으니 '실시간'이라고 쓰지 않고 'HH:mm 기준'만 쓴다.

## 3. 디자인 토큰(`web/src/styles/tokens.css`)

색은 **반드시 변수**로만 쓴다(16진수 색을 새로 쓰지 않는다).

| 변수 | 쓰임 |
|---|---|
| `--color-bg` / `--color-surface` / `--color-surface-2` | 배경 / 표면(패널·시트) / 한 단계 낮은 면(입력·빈칸·막대 바탕) |
| `--color-border` | 얇은 선(구분선) |
| `--color-text` / `--color-text-2` | 글자 / 보조 글자 |
| `--color-up` / `--color-down` | 상승·매수 / 하락·매도 **면**(막대·칸). 설정에서 미국식이면 자동으로 바뀐다 |
| `--color-up-text` / `--color-down-text` | 상승·하락 **글자**와 매수·매도 버튼 바탕(대비 4.5:1 맞춤) |
| `--color-accent` (+`-soft`, `-line`) | 강조: 선택 상태, 근거 스트립, 국면 게이지, 링크, 포커스 링 **에만** |
| `--color-warn` / `--color-warn-text` / `--color-warn-soft` | 경고·오류(아이콘 + 문장과 함께). **오류·삭제에 빨강을 쓰지 않는다** |
| `--color-ok` / `--color-ok-text` | 정상(장중 점, 통과 표시 등) |

글자: `.t-price` `.t-title` `.t-section` `.t-body` `.t-table` `.t-2`(보조) `.t-cap`(캡션·단위). 크기는 창 너비(핸드폰·태블릿·컴퓨터)에 따라 토큰이 바뀐다.
숫자는 `.num`(고정폭 숫자 tnum, 줄바꿈 없음). 단위는 `.unit`(작고 옅게). 상승·하락 글자색은 `.up` `.down` `.flat`.
간격 `--space-1..7`(4·8·12·16·24·32·48)만. 모서리 `--radius-chip`(4, 칩·입력) `--radius-panel`(8) `--radius-sheet`(16) `--radius-pill`.
움직임 `--motion-fast`(150ms) `--motion-sheet`(240ms) — 동작 줄이기 설정이면 0이 된다. 숫자가 굴러가는 효과·반복 깜빡임·진입 효과는 쓰지 않는다.

## 4. 배치(지도서 4장)

| 구간 | 너비 | 내비게이션(이미 구현) | 화면 배치 |
|---|---|---|---|
| compact | < 600 | 하단 탭 5개 | 단일 화면. 상세는 다음 화면이나 하단 시트 |
| medium | 600~839 | 레일 | 단일 화면 또는 목록 위주 |
| expanded | 840~1199 | 레일 | 목록-상세 2분할 |
| large | ≥ 1200 | 사이드바 | 사이드바 + 목록 + 차트 + 근거·주문 패널 |

`useBreakpoint()`로 구조가 달라지는 곳을 나눈다(CSS로 숨기기만 하면 되는 곳은 미디어 쿼리). 좁아질 때 접히는 순서: ① 오른쪽 보조 패널(근거·주문) → 하단 시트 ② 목록 → 별도 화면 ③ 차트 보조 지표 패널.
핸드폰: 자주 누르는 요소는 화면 아래 절반, 주요 버튼은 아래 고정(높이 48 이상), 터치 대상 44~48 이상(칩·토글 포함 — 컴포넌트가 이미 맞춤). 표는 핸드폰에서 목록 행으로 바꾼다.
글이 많은 화면(설정·일지)은 `.reading`(최대 1,280)으로 묶는다. 페이지 가로 스크롤이 생기면 안 된다(표는 `.ui-table-wrap` 안에서만 가로 스크롤).

## 5. 이미 만든 기반(가져다 쓴다)

```ts
import { ... } from "../../ui";             // 핵심 컴포넌트·서식
import { useApp } from "../../app/AppContext"; // 공용 데이터
import { useActions } from "../../app/actions"; // 근거 보기·주문 검토·명령 검색 열기
import { navigate, href, useRoute, Link } from "../../app/router"; // 해시 라우터
import { usePrefs, setPrefs } from "../../app/prefs"; // 기기별 화면 설정
```

- **`useApp()`**: `health`, `offline`, `server`(ServerState: 설정·마지막 스캔·모의계좌·오늘 손익), `serverAt`(받은 시각), `refreshServer()`,
  `journal`, `refreshJournal()`, `watchlist`·`isWatched`·`toggleWatch`·`setWatchlist`, `alerts`·`unreadAlerts`·`markAlertsSeen()`, `indices`, `now`(30초마다), `openStock(code, tab?)`.
- **`useActions()`**: `openEvidence({ title, evidence, code?, notes? })` — 근거 보기 시트(규칙별 충족·실제 값·출처 + 같은 신호의 과거 성과),
  `openOrderReview({ code, name?, side, price?, stop?, target?, strategy?, reason?, evidence? })` — 주문 검토 시트(손절가 필수, 위험 상자, 규칙 체크 3개, 계획 외 추가 매수 확인, 상한 초과 시 수량 줄이기 제안). 화면에서 주문 관련 폼을 따로 만들지 않는다.
  `openPalette()`, `openShortcuts()`.
- **컴포넌트(`ui/`)**: `EvidenceStrip`(목록용 작은 줄 + 개수 + 근거 보기) `EvidenceStripFull`(칸 이름까지) `EvidenceList`(규칙별 체크·값·출처), `RegimeGauge`(1·2·3칸),
  `MarketStatus`(장 상태 + 기준 시각), `RiskMeter`(정상·근접 90%·초과) `meterState`, `Price`(값이 바뀌면 0.3초 물들임) `Change`(▲ + 부호 + 색) `QuoteLine` `QuoteState`,
  `Button`(primary·secondary·ghost·link·buy·sell, busy) `IconButton`, `Segmented`(라디오) `Tabs`(탭) `Chip` `Toggle` `Field` `NumberStepper`,
  `Section`(카드 대신 제목 + 구분선) `Stat`/`Stats`(큰 숫자 + 설명) `ScoreBar` `Sparkline`(축 없는 추세선) `Skeleton`/`SkeletonRows`(불러오는 중) `EmptyState`(다음 행동 버튼과 함께) `Notice`(경고는 경고색 + 아이콘) `Disclaimer`(목록 끝·상세 하단에만) `Resizer`(끌어서 폭 조절, `prefs.panes`에 저장), `Sheet`(하단·오른쪽·가운데 시트, 포커스 가둠·Esc) `useToast()`, `NoteList`·`RuleTag`.
- **서식(`ui/format.ts`, 지도서 3.2)**: `fmtPrice(n, region, {unit})`(목록은 단위 없이, 주문 화면은 '원'), `fmtPct`(항상 부호·소수 둘째), `fmtBig`/`fmtEok`(억·조), `fmtPnl`(만 원 단위·부호), `fmtTime`/`fmtAsOf`("15:12 기준"), `fmtDate`("10.12(월)"), `fmtWhen`, `fmtRatio`, `fmtInt`, `fmtNum`, `srQuote`(화면 낭독 문장), `toneOf`.
- **근거 계산(`@jusik/shared`)**: `dayTradeEvidence(candidate)`, `weinsteinEvidence(analysis)`, `candleMasterEvidence(analysis.candleMaster)` — 칸 순서가 전략마다 고정. `signalStats(backtest)`.
  `features/EvidenceSheet`의 `SignalStatsView`(같은 신호의 과거 성과 세 숫자)와 `useSignalStats`.
- **공용 기능**: `features/candidates/CandidateList`(후보 표/목록 행, 정렬, 근거 보기), `features/risk/riskSummary`(주식 비중·상한, 오늘 손익·일일 한도, 손절가 근접).
- **API(`web/src/api.ts`)**: 기존 함수 + `getAlerts`, `checkJournal`(저장 없이 점검), `getIndexQuote`, `getCandles`, `getOverview`, `addJournal`(`selfCheck`, `plannedAdd`), `patchJournal`(`selfCheck`).
- **서버 추가**: `GET /api/alerts`(신호·리스크·공시·국면, 최신 순), `POST /api/journal/check`, 일지 `selfCheck`(손절가를 미리 정했다·비중 상한을 지켰다·계획에 없던 매수다), `ServerState.todayPnl`, `shared` `followedRules(entry)`(규칙 준수 판정), `marketSession`, `shortDateKo`.
- **차트**: `theme.ts`의 `useChartColors()`가 토큰을 읽어 테마·색 관례를 따른다. 모든 차트 옵션에 `localization: { locale: CHART_LOCALE }`와 `fontFamily: CHART_FONT`. 차트 바탕은 투명 또는 `colors.bg`, 격자는 옅게.

## 6. 문장(지도서 7.4·9.2)

- 버튼은 무엇이 일어나는지 동사로: '매수 주문 검토', '일지 저장', '지금 스캔', '전략으로 저장'('확인', '저장'만 쓰지 않는다). 같은 동작은 처음부터 끝까지 같은 이름.
- 알림·안내는 사실 문장: 무엇이, 얼마나, 다음에 할 일. 예: "누리에너지 손절가까지 1.8% 남았어요", "시장 국면이 공격에서 중립으로 바뀌었어요. 비중 상한 60%".
- 빈 화면은 다음 행동 버튼과 함께: "관심종목이 없어요. 발굴에서 후보를 찾아 추가하세요." + '발굴로 이동'.
- 오류는 사과하지 않고 무엇이 일어났고 어떻게 고치는지: "시세 연결이 끊겼어요. 표시된 가격은 15:12 기준이에요."
- 불러오는 중은 문장 없이 실제 배치와 같은 모양의 스켈레톤. 1초가 넘으면 진행 표시.

## 7. 접근성(지도서 10장)

본문 대비 4.5:1(토큰이 맞춰 둠, 새 색을 만들지 않는다), 색에만 의존하지 않기(삼각형·부호·채움 + 개수), 글자 200%에서도 깨지지 않게(숫자는 줄바꿈하지 않고 표는 가로 스크롤),
화면 낭독(`srQuote`, 근거 스트립 aria-label, 차트에는 요약 문장), 키보드로 모든 기능, 포커스는 2px 강조색 테두리(기본 제공). 아이콘만 있는 버튼은 `IconButton label`.

## 8. 화면 목록(지도서 부록 A)

| 화면 | 영역(경로) | 컴퓨터 | 태블릿 | 핸드폰 |
|---|---|---|---|---|
| 홈 대시보드 | 홈 `/` | ● | ● | ● |
| 시장 국면 상세 | 홈 `/?view=regime` | ● | ● | ○ 요약과 근거 문장만 |
| 추천 목록 | 발굴 `/discover` | ● | ● | ● |
| 스크리너 조건 편집 | 발굴 `/discover/screener` | ● | ○ | ○ 프리셋 실행과 값 수정만 |
| 백테스트 결과·전략 | 발굴 `/discover/strategy` | ● | ● | ○ 요약 지표만 |
| 관심종목 | 종목 `/stocks` | ● | ● | ● |
| 종목 상세(차트·근거·재무·공시·메모) | 종목 `/stocks/:code/:tab?` | ● | ● | ● |
| 주문 검토 | 시트(어디서나) | ● | ● | ● |
| 보유 종목과 리스크 | 매매 `/trade` | ● | ● | ● |
| 알림 센터·방해 금지 | `/alerts` | ● | ● | ● |
| 매매일지 작성 | 기록 `/records` | ● | ● | ● |
| 주간·월간 복기 | 기록 `/records/review` | ● | ● | ○ |
| 설정(테마·색 관례·한도) | `/settings` | ● | ● | ● |
| 첫 실행 안내(투자 성향·고지) | 시트 | ● | ● | ● |

## 9. 출시 전 점검표(지도서 부록 B)

모든 신호·추천에 근거 스트립과 '근거 보기' / 손절가 없이 주문을 확정할 경로가 없음(단축키 포함) / 시장 상태와 기준 시각이 시세 화면마다 /
빨강을 상승·매수 외(오류·삭제)에 쓰지 않음 / 색 없이도 상승·하락 구분 / 숫자 tnum 정렬 / 핸드폰 주요 버튼은 아래 엄지 영역 /
창을 좁히면 태블릿·핸드폰 배치로 / 빈 화면·불러오기·연결 끊김·주문 거부 문장 / 알림 문장은 사실 중심, 같은 신호 하루 한 번 / 일일 손실 한도·연속 손실 쉬기 동작 / 두 테마 대비 4.5:1.
