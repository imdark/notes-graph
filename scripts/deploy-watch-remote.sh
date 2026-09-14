#!/usr/bin/env bash
#
# Stream prod-deploy milestones from the REMOTE box's deploy log.
#
# deploy-prod.sh streams the remote build over one long-lived SSH session. If
# that connection drops -- the box goes unresponsive under build load, or a
# rotating IP falls out of the allowlist -- the *local* script dies while the
# remote build keeps running under its flock. In that case there is nothing
# left tailing /tmp/notesgraph-deploy.log, so scripts/deploy-watch.sh exits
# immediately (it keys off the local deploy-prod.sh process). This one polls
# the box instead and follows the build through to the end from the outside.
#
#   scripts/deploy-watch-remote.sh
#
# Meant as the command for the Monitor tool. Prints each new milestone/error
# line as it appears, then exactly one terminal line:
#   REMOTE-DEPLOY-DONE   -- build finished and the stack rolled
#   REMOTE-BUILD-GONE    -- the build process vanished without DEPLOY-DONE
#
# STALE LOGS: /home/ubuntu/deploy.log still holds the *previous* deploy's
# output, DEPLOY-DONE included, until redeploy.sh truncates it -- which does
# not happen until rsync finishes, minutes into a run. Reporting on it
# straight away claims success for a build that has barely started (observed:
# a watch armed seconds after launch printed the whole previous run and
# exited). So nothing is reported until the log has been written to since this
# watch began, using the box's own clock to avoid skew against this machine.
set -uo pipefail

HOST="${NOTESGRAPH_DEPLOY_HOST:-18.225.203.37}"
SSH_KEY="${NOTESGRAPH_DEPLOY_KEY:-$HOME/.ssh/notesgraph-prod.pem}"
REMOTE_LOG="${NOTESGRAPH_REMOTE_LOG:-/home/ubuntu/deploy.log}"
INTERVAL="${NOTESGRAPH_WATCH_INTERVAL:-30}"

# Milestones worth surfacing, plus the failure signatures we'd act on. Silence
# must never be the only signal a build died, so keep the failure side wide.
PATTERN='^=== |BUILD-ALL-DONE|DEPLOY-DONE|error TS|error\[|FAILED|Killed|OOM|No space left|Cannot connect'

ssh_run() {
  ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 \
    -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
    "ubuntu@$HOST" "$1" 2>/dev/null
}

# The box's clock, so a stale log is judged against the same clock that stamps
# it. Falls back to this machine's clock if the box is briefly unreachable.
START="$(ssh_run 'date +%s')"
[[ "$START" =~ ^[0-9]+$ ]] || START="$(date +%s)"

# Seconds since the log was last written, per the box's clock; empty if absent.
log_age() {
  ssh_run "if [ -f '$REMOTE_LOG' ]; then echo \$(( \$(date +%s) - \$(stat -c %Y '$REMOTE_LOG') )); fi"
}

# True once the log has been written to since this watch started, i.e. it
# belongs to the current run rather than the last one.
log_is_current() {
  local age now
  age="$(log_age)"
  [[ "$age" =~ ^[0-9]+$ ]] || return 1
  now="$(ssh_run 'date +%s')"
  [[ "$now" =~ ^[0-9]+$ ]] || return 1
  (( now - age >= START ))
}

matched_lines() {
  ssh_run "grep -aE '$PATTERN' '$REMOTE_LOG' 2>/dev/null || true"
}

seen=0
# A single failed poll means a blip (the box is busy building, SSH is flaky);
# only treat the build as gone after consecutive misses.
misses=0
fresh=false

while true; do
  if [ "$fresh" = false ] && log_is_current; then
    fresh=true
  fi

  if [ "$fresh" = true ]; then
    cur="$(matched_lines)"
    n="$(printf '%s' "$cur" | grep -c . || true)"
    n="${n:-0}"

    if [ "$n" -gt "$seen" ]; then
      printf '%s\n' "$cur" | tail -n "$((n - seen))"
      seen="$n"
    fi

    if printf '%s' "$cur" | grep -q 'DEPLOY-DONE'; then
      echo "REMOTE-DEPLOY-DONE"
      exit 0
    fi
  fi

  if ssh_run 'pgrep -f redeploy.sh >/dev/null 2>&1 && echo alive' | grep -q alive; then
    misses=0
  else
    misses=$((misses + 1))
    if [ "$misses" -ge 3 ]; then
      # Let the log flush before calling it: the process can exit a beat
      # before the final DEPLOY-DONE line lands on disk.
      sleep 5
      if [ "$fresh" = true ] && matched_lines | grep -q 'DEPLOY-DONE'; then
        echo "REMOTE-DEPLOY-DONE"
        exit 0
      fi
      echo "REMOTE-BUILD-GONE (no DEPLOY-DONE -- build died, was killed, or SSH is unreachable)"
      exit 1
    fi
  fi

  sleep "$INTERVAL"
done
