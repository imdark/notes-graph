#!/usr/bin/env bash
#
# Local web dev-server helper (:8080), so the recurring "is dev up? / start /
# wait / stop" checks are one allowlisted command instead of inline curl
# loops and backgrounded yarn commands.
#
#   scripts/debug-local-web-dev.sh status        # HTTP code + up/down (exit 1 if down)
#   scripts/debug-local-web-dev.sh start         # start the web dev server, detached
#   scripts/debug-local-web-dev.sh wait [secs]   # block until :8080 answers 200 (default 90s)
#   scripts/debug-local-web-dev.sh up            # start if needed, then wait
#   scripts/debug-local-web-dev.sh restart
#   scripts/debug-local-web-dev.sh stop
#   scripts/debug-local-web-dev.sh inspect [path]  # open the app in a Chrome with
#                                                  # remote debugging (CDP) so the
#                                                  # chrome-devtools MCP can attach
#   scripts/debug-local-web-dev.sh cdp             # print the CDP endpoint / status
#   scripts/debug-local-web-dev.sh eval '<js>'     # run JS in the app via CDP and
#                                                  # print the JSON result (DOM
#                                                  # assertions in the verify loop)
#   scripts/debug-local-web-dev.sh shot [out.png] [path]  # screenshot the app via
#                                                  # CDP (optionally navigate to a
#                                                  # sub-path first). Defaults to
#                                                  # .debug-screenshots/shot.png in
#                                                  # the repo so it can be Read
#                                                  # without an out-of-tree prompt.
#
# Overridable: DEV_PORT (8080), DEV_LOG (/tmp/notesgraph-dev.log),
# DEV_APP (@notesgraph/web), CDP_PORT (9222), CHROME (auto-detected),
# SHOT_DIR (.debug-screenshots).
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

PORT="${DEV_PORT:-8080}"
LOG="${DEV_LOG:-/tmp/notesgraph-dev.log}"
APP="${DEV_APP:-@notesgraph/web}"
# Screenshots land inside the repo (gitignored) so tools can Read them without
# a permission prompt for an outside path like /tmp.
SHOT_DIR="${SHOT_DIR:-.debug-screenshots}"
URL="http://localhost:${PORT}"
# Dedicated debug-Chrome port + profile. 9222 is often already taken by the
# chrome-devtools MCP's browser, so default to a separate one. We capture the
# browser WebSocket URL that Chrome prints to stderr at startup ("DevTools
# listening on ws://…") — the version-independent signal (current Chrome no
# longer reliably writes DevToolsActivePort, and the /json endpoints are gone).
CDP_PORT="${CDP_PORT:-9333}"
CHROME_PROFILE="${CHROME_PROFILE:-/tmp/notesgraph-chrome-debug}"
CHROME_LOG="${CHROME_LOG:-${CHROME_PROFILE}.log}"
WS_FILE="${CHROME_PROFILE}.ws"

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL" 2>/dev/null || echo 000
}
running() { [ "$(http_code)" = "200" ]; }

start_server() {
  if running; then echo "already up ($URL)"; return 0; fi
  : > "$LOG"
  # macOS has no setsid; nohup (ignores SIGHUP) + disown detaches there.
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup yarn notesgraph dev -p "$APP" >>"$LOG" 2>&1 </dev/null &
  else
    nohup yarn notesgraph dev -p "$APP" >>"$LOG" 2>&1 </dev/null &
  fi
  disown 2>/dev/null || true
  echo "starting dev server for $APP (log: $LOG)"
}

wait_up() {
  local tries="${1:-45}" i
  for ((i = 1; i <= tries; i++)); do
    running && { echo "up: $URL (~$((i * 2))s)"; return 0; }
    sleep 2
  done
  echo "timed out waiting for $URL" >&2
  return 1
}

stop_server() {
  # Match on the unique "dev -p <app>" invocation signature. The CLI entry is
  # run as `notesgraph.ts dev -p <app>` (tsx), so a `notesgraph dev` pattern
  # misses it (the `.ts` breaks the match) and restart never kills the server.
  if pkill -f "dev -p ${APP}" 2>/dev/null; then echo "stopped"; else echo "not running"; fi
  pkill -f "rspack.*${APP}" 2>/dev/null || true
}

find_chrome() {
  if [ -n "${CHROME:-}" ]; then echo "$CHROME"; return 0; fi
  for c in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "$(command -v google-chrome 2>/dev/null)" \
    "$(command -v chromium 2>/dev/null)"; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

# The browser WebSocket URL, captured from Chrome's stderr at launch.
browser_ws() { [ -s "$WS_FILE" ] && cat "$WS_FILE"; }

profile_running() { pgrep -f -- "--user-data-dir=${CHROME_PROFILE}" >/dev/null 2>&1; }

# Scrape the "DevTools listening on ws://…" line out of the Chrome log into
# WS_FILE. Returns 0 once captured.
capture_ws() {
  local ws
  ws="$(grep -oE 'ws://(127\.0\.0\.1|\[::1\]):[0-9]+/devtools/browser/[a-f0-9-]+' "$CHROME_LOG" 2>/dev/null | head -1)"
  [ -n "$ws" ] || return 1
  printf '%s\n' "$ws" > "$WS_FILE"
}

# Our debug Chrome is "ready" when a process is running against our profile and
# we captured its browser ws URL.
cdp_ready() { profile_running && [ -s "$WS_FILE" ]; }

# Launch a dedicated Chrome with the DevTools Protocol open and point it at the
# local app (or a sub-path), so the scripted CDP commands (eval/shot) — and the
# chrome-devtools MCP — can drive it. Reuses an already-open debug Chrome
# (navigating it) instead of spawning a second one.
inspect() {
  local path="${1:-/}"
  local target="${URL}${path}"

  # Reuse a live debug Chrome. If one is running but we haven't stored its ws
  # yet (e.g. a prior launch timed out), recover it from the log first.
  if profile_running; then
    [ -s "$WS_FILE" ] || capture_ws || true
    if [ -s "$WS_FILE" ]; then
      echo "reusing debug Chrome (profile ${CHROME_PROFILE}); navigating to $target"
      CDP_WS="$(browser_ws)" node "$(dirname "$0")/lib/cdp-eval.mjs" \
        "(() => { location.assign('${target}'); return 'ok'; })()" >/dev/null || true
      return 0
    fi
    # Running but no ws even in the log → a broken instance; restart it clean.
    echo "debug Chrome running without a usable CDP endpoint — restarting it"
    pkill -f -- "--user-data-dir=${CHROME_PROFILE}" 2>/dev/null || true
    sleep 1
  fi

  local chrome; chrome="$(find_chrome)" || { echo "no Chrome/Chromium found; set CHROME=" >&2; return 2; }
  rm -f "$WS_FILE"
  : > "$CHROME_LOG"
  echo "launching Chrome (CDP :${CDP_PORT}, profile ${CHROME_PROFILE}) at $target"
  # Chrome prints "DevTools listening on ws://…" to stderr; keep it in the log.
  nohup "$chrome" \
    --remote-debugging-port="${CDP_PORT}" \
    --user-data-dir="${CHROME_PROFILE}" \
    --no-first-run --no-default-browser-check \
    "$target" >"$CHROME_LOG" 2>&1 </dev/null &
  disown 2>/dev/null || true
  # Cold start + loading the app can take a while; poll the log up to ~45s.
  for _ in $(seq 1 90); do capture_ws && break; sleep 0.5; done
  if [ -s "$WS_FILE" ]; then
    echo "debug Chrome up ($(browser_ws))"
  else
    echo "Chrome did not print a DevTools ws URL (see $CHROME_LOG)" >&2
    return 1
  fi
}

case "${1:-status}" in
  status)
    c="$(http_code)"
    echo "dev web $URL -> HTTP $c"
    [ "$c" = "200" ] || exit 1
    ;;
  start) start_server ;;
  wait) wait_up "${2:-45}" ;;
  up) start_server; wait_up "${2:-45}" ;;
  restart) stop_server; start_server ;;
  stop) stop_server ;;
  inspect) inspect "${2:-/}" ;;
  cdp)
    if cdp_ready; then echo "debug Chrome up ($(browser_ws))"; else
      echo "no debug Chrome (start with: $0 inspect)"; exit 1; fi
    ;;
  eval)
    expr="${2:?js expression required}"
    cdp_ready || { echo "no debug Chrome (run: $0 inspect)" >&2; exit 1; }
    CDP_WS="$(browser_ws)" node "$(dirname "$0")/lib/cdp-eval.mjs" "$expr"
    ;;
  type)
    txt="${2?text required}"
    cdp_ready || { echo "no debug Chrome (run: $0 inspect)" >&2; exit 1; }
    CDP_WS="$(browser_ws)" node "$(dirname "$0")/lib/cdp-type.mjs" "$txt" "${3:-}"
    ;;
  shot)
    mkdir -p "$SHOT_DIR"
    out="${2:-$SHOT_DIR/shot.png}"
    nav=""
    [ -n "${3:-}" ] && nav="${URL}${3}"
    cdp_ready || { echo "no debug Chrome (run: $0 inspect)" >&2; exit 1; }
    CDP_WS="$(browser_ws)" node "$(dirname "$0")/lib/cdp-shot.mjs" "$out" "$nav"
    ;;
  *) echo "usage: $0 {status|start|wait [secs]|up|restart|stop|inspect [path]|cdp|eval '<js>'|type '<text>' [sel]|shot [out.png] [path]}" >&2; exit 2 ;;
esac
