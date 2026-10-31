#!/usr/bin/env bash
# 보고서 뷰어 + 실행파일(Windows/macOS/Linux) + 안드로이드 APK를 한 번에 만든다.
# 필요: node, go, JDK 17+, ANDROID_HOME(platforms;android-34, build-tools;34.0.0)
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
node build.mjs
mkdir -p release

# 1) 컴퓨터 실행파일
cp dist/index.html desktop/index.html
( cd desktop
  GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o "$ROOT/release/MyReports-windows.exe" .
  GOOS=darwin  GOARCH=arm64 go build -ldflags "-s -w" -o "$ROOT/release/MyReports-mac-arm64" .
  GOOS=darwin  GOARCH=amd64 go build -ldflags "-s -w" -o "$ROOT/release/MyReports-mac-intel" .
  GOOS=linux   GOARCH=amd64 go build -ldflags "-s -w" -o "$ROOT/release/MyReports-linux" . )

# 2) 안드로이드 APK (Gradle 없이 SDK 도구로 직접)
SDK=${ANDROID_HOME:?ANDROID_HOME을 안드로이드 SDK 경로로 지정하세요}
BT=$SDK/build-tools/34.0.0
JAR=$SDK/platforms/android-34/android.jar
B=$ROOT/.apkbuild
mkdir -p "$B/assets" "$B/classes" "$B/dex"
cp dist/index.html "$B/assets/"
"$BT/aapt2" compile --dir android/res -o "$B/res.zip"
"$BT/aapt2" link -o "$B/base.apk" -I "$JAR" --manifest android/AndroidManifest.xml -A "$B/assets" "$B/res.zip"
javac --release 8 -cp "$JAR" -d "$B/classes" $(find android/src -name '*.java')
"$BT/d8" --min-api 24 --lib "$JAR" --output "$B/dex" $(find "$B/classes" -name '*.class')
( cd "$B/dex" && zip -q "$B/base.apk" classes.dex )
"$BT/zipalign" -f 4 "$B/base.apk" "$B/aligned.apk"
KS=${KEYSTORE:-$ROOT/android/release.keystore}
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass reports -keypass reports -alias reports \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=MyReports" >/dev/null
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:reports --key-pass pass:reports --out release/MyReports.apk "$B/aligned.apk"
ls -la release
