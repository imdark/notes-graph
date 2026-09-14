#!/usr/bin/env bash
#
# Type-check a package with tsc and report a clean pass/fail + error count,
# so the loop's "verify types" step is one allowlisted call instead of an
# ad-hoc `npx tsc --noEmit ... | grep -c 'error TS'` pipeline each time.
#
#   scripts/typecheck.sh [dir-or-tsconfig]
#
# Arg may be a package directory (uses its tsconfig.json) or a tsconfig path.
# Defaults to ./tsconfig.json in the current directory. Exits non-zero if tsc
# reports any error (so it gates a commit/deploy).
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

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
npx tsc --noEmit -p "$tsconfig" >"$log" 2>&1
rc=$?

errors="$(grep -c 'error TS' "$log" || true)"
if [ "$rc" -eq 0 ] && [ "$errors" -eq 0 ]; then
  echo "typecheck OK: $tsconfig (0 errors)"
else
  echo "typecheck FAILED: $tsconfig ($errors errors)"
  grep 'error TS' "$log" | head -40
fi
rm -f "$log"
exit "$rc"
