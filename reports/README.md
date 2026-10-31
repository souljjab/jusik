# 내 보고서함

`docs/`에 낸 보고서를 한곳에서 목차로 보고, 모든 보고서를 한 번에 검색하는 뷰어예요.
인터넷 없이 동작하고, 보고서 내용은 프로그램 안에 들어 있어요.

## 받아서 쓰기 (`release/`)

| 기기 | 파일 | 쓰는 법 |
|---|---|---|
| Windows | `MyReports-windows.exe` | 더블클릭 → 기본 브라우저로 열림. 다 보면 검은 창을 닫기. "Windows의 PC 보호" 창이 뜨면 '추가 정보 → 실행' |
| Mac (M1 이후) | `MyReports-mac-arm64` | 터미널에서 `chmod +x` 후 실행. 처음엔 Finder에서 우클릭 → 열기 |
| Mac (인텔) | `MyReports-mac-intel` | 위와 같음 |
| Linux | `MyReports-linux` | `chmod +x` 후 실행 |
| 안드로이드 | `MyReports.apk` | 폰으로 옮겨 설치('출처를 알 수 없는 앱' 허용 필요). 앱 이름 '내 보고서함' |

## 기능

- 보고서 목록(첫 화면) → 누르면 절 단위 목차, 목차 누르면 그 절로 이동
- 위 검색창: 모든 보고서에서 찾기, 띄어쓰기로 여러 단어(모두 들어간 절만), 찾은 곳 노란 표시. 컴퓨터는 Ctrl+F로 검색창
- 마지막에 보던 곳 기억, 밝게/어둡게(◐), 핸드폰은 ☰로 목차

## 보고서를 추가·수정했을 때

1. 파일을 `docs/`에 넣고 `reports/reports.json`에 한 줄 추가(이름·날짜·분류). `.txt`(PDF에서 옮긴 글)와 `.md` 지원
2. `reports/build-all.sh` 실행 → `release/`가 새로 만들어짐
   - 필요: Node, Go, JDK 17+, 안드로이드 SDK(`platforms;android-34`, `build-tools;34.0.0`)와 `ANDROID_HOME`
   - 뷰어 HTML만 필요하면 `node reports/build.mjs` → `reports/dist/index.html`(브라우저로 바로 열림)
3. APK 서명 키는 `android/release.keystore`(없으면 새로 만듦, 저장소에는 올리지 않음). 다른 키로 서명한 APK는 기존 앱 위에 덮어 설치가 안 되니,
   그때는 앱을 지우고 다시 설치하세요. 키를 고정하려면 `KEYSTORE=경로`로 지정하세요.
