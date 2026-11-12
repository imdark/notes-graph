#!/usr/bin/env bash
#
# Type-check a package with tsc and report a clean pass/fail + error count,
# so the loop's "verify types" step is one allowlisted call instead of an
# ad-hoc `npx tsc --noEmit ... | grep -c 'error TS'` pipeline each time.
#
#   scripts/typecheck.sh [--changed] [dir-or-tsconfig]
#
# Arg may be a package directory (uses its tsconfig.json) or a tsconfig path,
# relative to the repo root. Defaults to the root tsconfig.json. Exits non-zero
# if tsc reports any error (so it gates a commit/deploy).
#
# --changed: only errors in files this branch changed (against its merge-base
# with origin/main, plus uncommitted and untracked files) fail the check. Main
# carries some errors of its own; those are counted but not listed.
#
# In a fresh worktree the referenced projects have no dist/*.d.ts yet (tsc
# reports TS6305); the script then builds them once with `tsc -b` and retries.
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

changed_only=0
if [ "${1:-}" = "--changed" ]; then
  changed_only=1
  shift
fi

target="${1:-tsconfig.json}"
if [ -d "$target" ]; then
  tsconfig="$target/tsconfig.json"
else
  tsconfig="$target"
fi

if [ ! -f "$tsconfig" ]; then
  echo "no tsconfig at: $tsconfig" >&2
  exit 2
fi

log="$(mktemp -t ng-tsc.XXXXXX)"
trap 'rm -f "$log" "$log.changed"' EXIT

npx tsc --noEmit -p "$tsconfig" >"$log" 2>&1
rc=$?
if grep -q 'error TS6305' "$log"; then
  echo "building referenced projects first (tsc -b $tsconfig)..."
  npx tsc -b "$tsconfig" >/dev/null 2>&1
  npx tsc --noEmit -p "$tsconfig" >"$log" 2>&1
  rc=$?
fi

errors="$(grep -c 'error TS' "$log" || true)"
if [ "$rc" -eq 0 ] && [ "$errors" -eq 0 ]; then
  echo "typecheck OK: $tsconfig (0 errors)"
  exit 0
fi

if [ "$changed_only" -eq 1 ] && [ "$errors" -gt 0 ]; then
  base="$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)"
  {
    git diff --name-only "$base"
    git ls-files --others --exclude-standard
  } | sort -u >"$log.changed"
  # tsc prints `path/to/file.ts(line,col): error TS...`
  mine="$(grep 'error TS' "$log" | awk -F'(' 'NR==FNR { f[$0]; next } ($1 in f)' "$log.changed" - || true)"
  count="$(printf '%s' "$mine" | grep -c 'error TS' || true)"
  others=$((errors - count))
  if [ "$count" -eq 0 ]; then
    echo "typecheck OK in changed files: $tsconfig ($others errors elsewhere, not from this branch)"
    exit 0
  fi
  echo "typecheck FAILED in changed files: $tsconfig ($count errors; $others more elsewhere)"
  printf '%s\n' "$mine" | head -40
  exit 1
fi

echo "typecheck FAILED: $tsconfig ($errors errors)"
grep 'error TS' "$log" | head -40
exit "$rc"
