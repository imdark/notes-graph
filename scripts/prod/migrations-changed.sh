#!/usr/bin/env bash
#
# Does this deploy run a migration the database hasn't had yet?
#
#   scripts/prod/migrations-changed.sh <src checkout> <record file>
#
# Exit 0 = yes, or can't tell (take the pre-migration backup).
# Exit 1 = no: nothing a migration reads changed since the commit in
#          <record file>, the last one whose migration passed.
# One line on stdout says why.
#
# The backup is ~2 min of every deploy, and most deploys add no migration,
# so it is only taken when one is coming. Anything uncertain (no git
# checkout, no record, a commit that can't be fetched, a failed diff)
# answers "yes", so a doubtful deploy still backs up. redeploy.sh writes the
# record after the migration passes.
set -uo pipefail

SRC="${1:?usage: migrations-changed.sh <src checkout> <record file>}"
RECORD="${2:?usage: migrations-changed.sh <src checkout> <record file>}"

# What the migration job (self-host-predeploy.js: prisma migrate deploy, then
# the data migrations) reads.
PATHS=(
  packages/backend/server/migrations
  packages/backend/server/schema.prisma
  packages/backend/server/src/data/migrations
  packages/backend/server/scripts/self-host-predeploy.js
)

new="$(git -C "$SRC" rev-parse HEAD 2>/dev/null)" || { echo "no git checkout to compare"; exit 0; }
prev="$(cat "$RECORD" 2>/dev/null | tr -d '[:space:]')"
if ! [[ "$prev" =~ ^[0-9a-f]{40}$ ]]; then
  echo "no record of the last migrated commit"
  exit 0
fi
if [[ "$prev" == "$new" ]]; then
  echo "same commit as the last migration (${prev:0:8})"
  exit 1
fi
if ! git -C "$SRC" cat-file -e "${prev}^{commit}" 2>/dev/null \
  && ! git -C "$SRC" fetch -q origin "$prev" 2>/dev/null; then
  echo "can't fetch the last migrated commit ${prev:0:8}"
  exit 0
fi
# --name-only compares trees, so a blob-less partial clone answers it.
if ! changed="$(git -C "$SRC" diff --name-only "$prev" "$new" -- "${PATHS[@]}" 2>/dev/null)"; then
  echo "couldn't diff ${prev:0:8}..${new:0:8}"
  exit 0
fi
if [[ -n "$changed" ]]; then
  echo "migrations changed since ${prev:0:8}: $(echo "$changed" | head -3 | tr '\n' ' ')"
  exit 0
fi
echo "no migration changes since ${prev:0:8}"
exit 1
