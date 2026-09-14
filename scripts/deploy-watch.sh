#!/usr/bin/env bash
#
# Stream prod-deploy milestones and errors from the deploy log, exiting when
# the deploy finishes. Meant as the command for the Monitor tool (or a plain
# `tail`-follow) so the tail|grep|wait pipeline isn't hand-written each time.
#
#   scripts/deploy-watch.sh [logfile]   # default /tmp/notesgraph-deploy.log
#
# Each printed line is a milestone/error worth surfacing; the script exits
# (prints DEPLOY-EXITED) once no deploy-prod.sh process is running.
set -uo pipefail

LOG="${1:-/tmp/notesgraph-deploy.log}"
PATTERN='build lock|already building|^=== |BUILD-ALL-DONE|DEPLOY-DONE|error TS|error\[|FAILED|Timeout|not responding|Killed|OOM|HTTP [0-9]'

# -F keeps following across truncation/rotation (deploy-bg.sh truncates the log)
tail -n0 -F "$LOG" 2>/dev/null | grep --line-buffered -E "$PATTERN" &
grep_pid=$!

while pgrep -f "deploy-prod.sh" >/dev/null; do sleep 15; done
sleep 3
kill "$grep_pid" 2>/dev/null || true
echo "DEPLOY-EXITED"
