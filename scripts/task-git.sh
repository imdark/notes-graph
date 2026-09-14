#!/usr/bin/env bash
#
# Board-loop git helper: the two repetitive git steps of the task loop behind
# ONE entry point, so they can be allowlisted once (.claude/settings.json)
# instead of prompting for approval on every card.
#
#   scripts/task-git.sh branch <blockId> <task name words...>
#       -> git checkout -b "<blockId>-<kebab-slug>"  (off current HEAD)
#
#   scripts/task-git.sh commit "<message>" [path ...]
#       -> stage the given paths (or all changes if none) and commit,
#          appending the standard trailers
#
#   scripts/task-git.sh commit-only "<message>"
#       -> commit already-staged changes only (no add), + trailers
#
#   scripts/task-git.sh status
#       -> print current branch + `git status --short` (the "check the tree
#          before building/deploying" loop step, one allowlisted call)
#
# The commit message is passed verbatim; the Co-Authored-By / Claude-Session
# trailers are appended automatically.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

TRAILERS=$'\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01CLq8TEBVEBS5LynyNk8iUT'

slugify() {
  printf '%s' "$*" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c1-48
}

case "${1:-}" in
  branch)
    id="${2:?block id required}"
    shift 2
    branch="${id}-$(slugify "$*")"
    git checkout -b "$branch"
    echo "on branch $branch"
    ;;
  commit)
    msg="${2:?commit message required}"
    shift 2
    if [ "$#" -gt 0 ]; then
      git add -- "$@"
    else
      git add -A
    fi
    printf '%s%s' "$msg" "$TRAILERS" | git commit -F -
    ;;
  commit-only)
    msg="${2:?commit message required}"
    printf '%s%s' "$msg" "$TRAILERS" | git commit -F -
    ;;
  status)
    echo "branch: $(git branch --show-current)"
    git status --short
    ;;
  *)
    echo "usage: $0 {branch <blockId> <name...>|commit <message>|commit-only <message>|status}" >&2
    exit 2
    ;;
esac
