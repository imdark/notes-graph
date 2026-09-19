#!/usr/bin/env bash
#
# Run a command on the prod box over the deploy SSH key, opening the port-22
# ingress first if this machine's IP has fallen out of the allowlist — the same
# access path deploy-prod.sh uses, behind ONE entry point so it can be
# allowlisted once instead of prompting per ad-hoc ssh.
#
#   scripts/prod-exec.sh 'docker ps --format "{{.Names}}"'
#   scripts/prod-exec.sh 'tail -5 /home/ubuntu/deploy.log'
#   scripts/prod-exec.sh --file local.yml /opt/notesgraph/compose.yml
#       -> copy a local file to the box (backing up any existing one first)
#   scripts/prod-exec.sh --cat /opt/notesgraph/compose.yml
#       -> print a remote file
#
# The command runs as `ubuntu`; use sudo inside it where the box needs it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/prod-ssh.sh
. "$REPO_ROOT/scripts/lib/prod-ssh.sh"

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

[ $# -ge 1 ] || usage 1

ensure_ssh_access

case "$1" in
  -h|--help)
    usage 0
    ;;
  --cat)
    [ $# -eq 2 ] || { echo "!! --cat takes exactly one remote path" >&2; exit 2; }
    exec "${SSH[@]}" "cat -- '$2'"
    ;;
  --file)
    [ $# -eq 3 ] || { echo "!! --file takes <local> <remote>" >&2; exit 2; }
    local_file="$2"; remote_path="$3"
    [ -f "$local_file" ] || { echo "!! no such local file: $local_file" >&2; exit 2; }
    # Back up whatever is there now. These are hand-maintained files that live
    # only on the box (compose.yml, Caddyfile) — there is no other copy.
    "${SSH[@]}" "test -f '$remote_path' && cp -a '$remote_path' '$remote_path.bak-$(date +%Y%m%d-%H%M%S)' && echo '==> backed up existing $remote_path' || true"
    scp -i "$SSH_KEY" -o ConnectTimeout=10 "$local_file" "ubuntu@$HOST:$remote_path"
    echo "==> copied $local_file -> $remote_path"
    ;;
  *)
    exec "${SSH[@]}" "$*"
    ;;
esac
