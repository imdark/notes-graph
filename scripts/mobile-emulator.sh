#!/usr/bin/env bash
#
# Spin up an Android emulator (VM) to test the NotesGraph mobile app locally —
# no physical device needed. Idempotent: installs the emulator + system image
# and creates the AVD on first run, reuses them after.
#
#   scripts/mobile-emulator.sh up        # install/create + boot the emulator (headless)
#   scripts/mobile-emulator.sh install   # build-free: install the last-built APK + launch
#   scripts/mobile-emulator.sh shot [f]  # screenshot to f (default /tmp/ng-shot.png)
#   scripts/mobile-emulator.sh url       # print the WebView's current URL
#   scripts/mobile-emulator.sh down      # kill the emulator
#
# Debug/repro primitives (agent-friendly — see also .claude/settings.json):
#   scripts/mobile-emulator.sh tap X Y            # tap at device pixels
#   scripts/mobile-emulator.sh swipe X1 Y1 X2 Y2 [ms]
#   scripts/mobile-emulator.sh text "hello"       # type via key events (no IME)
#   scripts/mobile-emulator.sh key KEYCODE_HOME   # send a keyevent
#   scripts/mobile-emulator.sh logcat [pattern]   # dump logcat (filtered)
#   scripts/mobile-emulator.sh console            # dump WebView console lines
#   scripts/mobile-emulator.sh js 'location.href' # eval JS in the app WebView (CDP)
#   scripts/mobile-emulator.sh share URL [title]  # simulate an OS share into the app
#
# Requires the Android SDK from scripts/install-android-deps.sh.
# macOS / Apple Silicon (uses an arm64 system image).
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME" JAVA_HOME
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$JAVA_HOME/bin:$PATH"

AVD="${NG_AVD:-ng-test}"
IMAGE="system-images;android-34;google_apis;arm64-v8a"
APPID="app.notesgraph.pro"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="${NG_APK:-$REPO_ROOT/packages/frontend/apps/android/App/app/build/outputs/apk/stable/debug/app-stable-debug.apk}"

log(){ printf '\033[36m==>\033[0m %s\n' "$*"; }
die(){ printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

booted(){ [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; }

cmd_up() {
  command -v sdkmanager >/dev/null || die "Android SDK not found — run scripts/install-android-deps.sh"
  if [ ! -x "$ANDROID_HOME/emulator/emulator" ] || [ ! -d "$ANDROID_HOME/system-images/android-34/google_apis/arm64-v8a" ]; then
    log "Installing emulator + system image (~1GB, first run only)"
    yes | sdkmanager --licenses >/dev/null 2>&1 || true
    sdkmanager "emulator" "platform-tools" "platforms;android-34" "$IMAGE"
  fi
  if ! avdmanager list avd 2>/dev/null | grep -q "Name: $AVD"; then
    log "Creating AVD $AVD"
    echo "no" | avdmanager create avd -n "$AVD" -k "$IMAGE" -d pixel_6 --force
  fi
  if booted; then log "Emulator already booted"; return; fi
  log "Booting $AVD (headless)…"
  nohup emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot >/tmp/ng-emulator.log 2>&1 &
  adb wait-for-device
  local i=0; until booted || [ $i -ge 60 ]; do sleep 3; i=$((i+1)); done
  booted && log "Booted." || die "Emulator did not finish booting (see /tmp/ng-emulator.log)"
}

cmd_install() {
  booted || die "Emulator not running — run: $0 up"
  [ -f "$APK" ] || die "APK not found: $APK (build it first)"
  log "Installing $(basename "$APK") ($(du -h "$APK" | cut -f1))"
  adb install -r "$APK" | tail -1
  log "Launching $APPID"
  adb shell am start -n "$APPID/.MainActivity" >/dev/null
}

cmd_shot() {
  local out="${1:-/tmp/ng-shot.png}"
  adb exec-out screencap -p > "$out"
  log "Saved $out"
}

cmd_url() {
  local sock port=9333
  sock=$(adb shell cat /proc/net/unix 2>/dev/null | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
  [ -n "$sock" ] || die "No WebView devtools socket (is the app open?)"
  adb forward --remove tcp:$port >/dev/null 2>&1 || true
  adb forward tcp:$port "localabstract:$sock" >/dev/null
  curl -s --max-time 8 "http://localhost:$port/json" | python3 -c \
    "import sys,json;[print(p.get('url','')) for p in json.load(sys.stdin) if p.get('type')=='page']" 2>/dev/null
}

cmd_down() { adb emu kill 2>/dev/null && log "Emulator killed" || log "No emulator running"; }

cmd_tap()   { adb shell input tap "$1" "$2"; }
cmd_swipe() { adb shell input swipe "$1" "$2" "$3" "$4" "${5:-300}"; }
cmd_text()  { adb shell input text "$(printf '%s' "$1" | sed 's/ /%s/g')"; }
cmd_key()   { adb shell input keyevent "$1"; }

cmd_logcat() {
  if [ -n "${1:-}" ]; then
    adb logcat -d | grep -iE "$1" | tail -100
  else
    adb logcat -d | tail -100
  fi
}

cmd_console() { adb logcat -d | grep "Capacitor/Console" | tail -60; }

# Forward the WebView's devtools socket and print the first page's ws URL.
devtools_ws() {
  local sock port=9333
  sock=$(adb shell cat /proc/net/unix 2>/dev/null | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
  [ -n "$sock" ] || die "No WebView devtools socket (is the app open?)"
  adb forward --remove tcp:$port >/dev/null 2>&1 || true
  adb forward tcp:$port "localabstract:$sock" >/dev/null
  curl -s --max-time 8 "http://localhost:$port/json" | python3 -c \
    "import sys,json;print(json.load(sys.stdin)[0]['webSocketDebuggerUrl'])"
}

# Evaluate a JS expression in the app's WebView via CDP (node >=21 has a
# global WebSocket client). Invaluable for shadow-DOM/stacking/state bugs a
# screenshot can't explain.
cmd_js() {
  local ws expr="$1"
  ws=$(devtools_ws)
  NODE_WS="$ws" NODE_EXPR="$expr" node --input-type=module -e '
    const ws = new WebSocket(process.env.NODE_WS);
    const timer = setTimeout(() => { console.error("timeout"); process.exit(1); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1, method: "Runtime.evaluate",
      params: { expression: process.env.NODE_EXPR, returnByValue: true, awaitPromise: true },
    }));
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      const r = msg.result?.result;
      console.log(JSON.stringify(r?.value !== undefined ? r.value : r, null, 1));
      ws.close(); process.exit(0);
    };
  '
}

cmd_share() {
  local url="$1" title="${2:-}"
  booted || die "Emulator not running — run: $0 up"
  if [ -n "$title" ]; then
    adb shell "am start -a android.intent.action.SEND -t text/plain -n $APPID/.MainActivity --es android.intent.extra.TEXT '$url' --es android.intent.extra.SUBJECT '$title'"
  else
    adb shell "am start -a android.intent.action.SEND -t text/plain -n $APPID/.MainActivity --es android.intent.extra.TEXT '$url'"
  fi
}

case "${1:-up}" in
  up) cmd_up ;;
  install) cmd_install ;;
  shot) shift; cmd_shot "${1:-}" ;;
  url) cmd_url ;;
  down) cmd_down ;;
  tap) shift; cmd_tap "$@" ;;
  swipe) shift; cmd_swipe "$@" ;;
  text) shift; cmd_text "$@" ;;
  key) shift; cmd_key "$@" ;;
  logcat) shift; cmd_logcat "${1:-}" ;;
  console) cmd_console ;;
  js) shift; cmd_js "$@" ;;
  share) shift; cmd_share "$@" ;;
  *) echo "usage: $0 {up|install|shot [file]|url|down|tap X Y|swipe X1 Y1 X2 Y2 [ms]|text STR|key KEYCODE|logcat [pat]|console|js EXPR|share URL [title]}" >&2; exit 1 ;;
esac
