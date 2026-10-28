#!/usr/bin/env bash
#
# Release: ship everything merged into `stage` to prod in one deploy.
#
#   scripts/release.sh           # list what ships, confirm, release + deploy
#   scripts/release.sh --plan    # only list what would ship
#   scripts/release.sh --yes     # no confirmation (agents, scripts)
#
# PRs target `stage` (the repo's default branch), so work batches there. A
# release fast-forwards `main` to `stage` and starts the GitHub deploy
# (.github/workflows/deploy-prod.yml), which only runs from `main`.
#
# Fast-forward, not a merge commit: `main` then carries stage's own
# "Merge pull request #N" commits on its first-parent line, which is how the
# deploy record (scripts/prod/deploy-info.mjs) finds the PRs a deploy ships.
#
# A hotfix merged straight into `main` makes the fast-forward impossible;
# merge main into stage first (git merge origin/main on stage, then push).
set -euo pipefail

PLAN=0
YES=0
for arg in "$@"; do
  case "$arg" in
    --plan) PLAN=1 ;;
    --yes|-y) YES=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(cd "$(dirname "$0")/.." && pwd)"
git fetch -q origin main stage

if ! git merge-base --is-ancestor origin/main origin/stage; then
  echo "!! main has commits stage doesn't (a hotfix?). Merge origin/main into stage first." >&2
  git log --oneline origin/stage..origin/main >&2
  exit 1
fi

if [[ "$(git rev-parse origin/main)" == "$(git rev-parse origin/stage)" ]]; then
  echo "nothing to release: main is already at stage ($(git rev-parse --short origin/stage))"
  exit 0
fi

echo "==> releasing $(git rev-parse --short origin/main)..$(git rev-parse --short origin/stage)"
PRS="$(git log --first-parent --merges --format=%s origin/main..origin/stage \
  | sed -nE 's/^Merge pull request #([0-9]+) from [^/]+\/(.*)$/  #\1 \2/p')"
echo "${PRS:-  (no pull requests; direct commits only)}"
echo "$(git rev-list --count origin/main..origin/stage) commits"

if [[ "$PLAN" == "1" ]]; then
  echo "--plan: nothing released"
  exit 0
fi
if [[ "$YES" != "1" ]]; then
  read -r -p "Release and deploy to prod? [y/N] " answer
  [[ "$answer" == [yY]* ]] || { echo "not released"; exit 1; }
fi

# Pushing the exact commit, so a stage that moved since the fetch isn't
# released unseen; the push is refused unless it fast-forwards main.
SHA="$(git rev-parse origin/stage)"
git push -q origin "$SHA:refs/heads/main"
echo "==> main -> ${SHA:0:8}"

gh workflow run deploy-prod.yml --ref main
echo "==> deploy started: gh run list --workflow deploy-prod.yml --limit 1"
