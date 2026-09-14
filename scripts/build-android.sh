#!/bin/bash
# Build the NotesGraph Android APK end to end: web bundle -> prune -> capacitor
# sync -> gradle. One command, so agent sessions (and humans) don't have to
# re-derive the sequence — and NOTE: `yarn notesgraph @notesgraph/android build`
# does NOT work (the repo CLI chokes on the `&&` inside the package script).
#
#   scripts/build-android.sh            # stable channel (app.notesgraph.com)
#   BUILD_TYPE=canary scripts/build-android.sh
#
# Output: packages/frontend/apps/android/App/app/build/outputs/apk/<channel>/debug/
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$HOME/.cargo/bin:$JAVA_HOME/bin:$PATH"
export BUILD_TYPE="${BUILD_TYPE:-stable}"
export PUBLIC_PATH="${PUBLIC_PATH:-/}"

echo "==> web bundle (BUILD_TYPE=$BUILD_TYPE)"
yarn notesgraph bundle -p @notesgraph/android

echo "==> prune + sync"
( cd packages/frontend/apps/android && node prune-dist.mjs && yarn sync )

FLAVOR="$(echo "$BUILD_TYPE" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')"
echo "==> gradle assemble${FLAVOR}Debug"
( cd packages/frontend/apps/android/App && ./gradlew "assemble${FLAVOR}Debug" )

APK="packages/frontend/apps/android/App/app/build/outputs/apk/$BUILD_TYPE/debug/app-$BUILD_TYPE-debug.apk"
echo "==> done: $APK ($(du -h "$APK" | cut -f1))"
