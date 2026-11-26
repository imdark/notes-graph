#!/usr/bin/env bash
# The source hash of a sidecar image: what decides whether it needs building.
#
#   scripts/prod/sidecar-hash.sh linkcard|plugin-server|agent-runner
#
# deploy-prod.yml builds each sidecar in CI and pushes it to ECR as
# notesgraph:<name>-<hash>; redeploy.sh on the box computes the same hash and
# pulls that image (building it there only when the pull fails). Both run
# this script, so the hash must come out the same in both places: it covers
# only git-tracked files (the box's checkout is reused and may hold untracked
# leftovers) in a fixed order (LC_ALL=C, not the machine's locale).
#
# Each image's inputs are its own folders plus the root yarn.lock, package.json
# and .yarnrc.yml (its Dockerfile installs from them): the closures the
# per-sidecar hashes in redeploy.sh used before.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/../.."

case "${1:-}" in
  linkcard) dirs=(tools/link-card-server packages/common/link-card) ;;
  plugin-server) dirs=(tools/notesgraph-plugin-server packages/common/plugin-sdk tools/plugin-template) ;;
  agent-runner) dirs=(tools/agent-runner) ;;
  *)
    echo "usage: $0 linkcard|plugin-server|agent-runner" >&2
    exit 2
    ;;
esac

files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files -z -- "${dirs[@]}"
  else
    # An rsynced tree (scripts/deploy-prod.sh) has no git: list the folders,
    # less what builds and installs leave in them.
    find "${dirs[@]}" -type f -not -path '*/node_modules/*' -not -path '*/dist/*' -print0
  fi
}

{
  files | sort -z | xargs -0 sha256sum
  sha256sum yarn.lock package.json .yarnrc.yml
} | sha256sum | cut -d' ' -f1
