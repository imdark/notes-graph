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
#       -> stage the given paths (or all changes if none) and commit
#
#   scripts/task-git.sh commit-only "<message>"
#       -> commit already-staged changes only (no add)
#
#   scripts/task-git.sh status
#       -> print current branch + `git status --short` (the "check the tree
#          before building/deploying" loop step, one allowlisted call)
#
# The commit message is passed verbatim, trailers included: end it with the
# attribution lines the committing session was given (Co-Authored-By, etc.).
# Nothing is appended here — this script can't know which model or session is
# committing, and a hard-coded trailer stamped every commit with the wrong one.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

# Commit `$1` as the message, read from stdin so it reaches git verbatim.
commit_with() {
  if ! printf '%s' "$1" | grep -qi '^Co-Authored-By:'; then
    echo "warning: message has no Co-Authored-By trailer" >&2
  fi
  printf '%s\n' "$1" | git commit -F -
}

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
    commit_with "$msg"
    ;;
  commit-only)
    commit_with "${2:?commit message required}"
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
