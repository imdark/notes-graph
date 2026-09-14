#!/usr/bin/env bash
#
# Syntax-check shell and JS/node scripts without executing them — the cheap
# "did I break a script" gate for the loop, one allowlisted call.
#
#   scripts/check-syntax.sh [file ...]
#
# With no args, checks every *.sh and *.mjs/*.js/*.cjs under scripts/. Picks the
# checker by extension (falling back to the shebang): `bash -n` for shell,
# `node --check` for JS. Exits non-zero if any file fails; prints one line each.
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

check_one() {
  local f="$1"
  [ -f "$f" ] || { echo "MISSING  $f"; return 1; }
  local kind="$2"
  if [ -z "$kind" ]; then
    case "$f" in
      *.sh|*.bash) kind=sh ;;
      *.mjs|*.js|*.cjs) kind=node ;;
      *) case "$(head -1 "$f")" in
           *bash*|*/sh) kind=sh ;;
           *node*) kind=node ;;
           *) echo "SKIP     $f (unknown type)"; return 0 ;;
         esac ;;
    esac
  fi
  local out
  if [ "$kind" = sh ]; then
    out="$(bash -n "$f" 2>&1)"
  else
    out="$(node --check "$f" 2>&1)"
  fi
  if [ $? -eq 0 ]; then
    echo "OK       $f"
  else
    echo "FAIL     $f"
    echo "$out" | sed 's/^/         /'
    return 1
  fi
}

rc=0
if [ "$#" -gt 0 ]; then
  for f in "$@"; do check_one "$f" "" || rc=1; done
else
  while IFS= read -r f; do check_one "$f" "" || rc=1; done < <(
    find scripts -type f \( -name '*.sh' -o -name '*.mjs' -o -name '*.js' -o -name '*.cjs' \) | sort
  )
fi
exit "$rc"
