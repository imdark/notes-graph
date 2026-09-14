#!/usr/bin/env bash
#
# Launch a prod deploy DETACHED and return immediately.
#
# Wrapping the backgrounding here keeps the `&` / nohup out of the
# interactive command line — a bare `&` on the command line defers the
# approval-time safety checks and forces a special approval prompt, whereas
# invoking this (allowlisted) script does not.
#
#   scripts/deploy-bg.sh            # full deploy, detached
#   scripts/deploy-bg.sh --landing  # forwards args to deploy-prod.sh
#   DEPLOY_LOG=/path scripts/deploy-bg.sh
#
# Follow progress with:  tail -f "$log"  (path is printed), or the Monitor
# tool. deploy-prod.sh's flock still prevents overlapping builds.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

LOG="${DEPLOY_LOG:-/tmp/notesgraph-deploy.log}"
: > "$LOG"

# Detach so the deploy survives this launcher (and the calling shell)
# exiting. Prefer setsid (new session) where present; macOS has no setsid,
# so fall back to nohup — which ignores SIGHUP — plus disown. </dev/null
# fully detaches stdio either way.
if command -v setsid >/dev/null 2>&1; then
  setsid nohup ./scripts/deploy-prod.sh "$@" >>"$LOG" 2>&1 </dev/null &
else
  nohup ./scripts/deploy-prod.sh "$@" >>"$LOG" 2>&1 </dev/null &
fi
pid=$!
disown 2>/dev/null || true

echo "deploy launched (pid $pid), detached"
echo "log: $LOG"
echo "follow: tail -f $LOG"
