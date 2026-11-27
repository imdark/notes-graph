#!/usr/bin/env bash
#
# Give this checkout dependencies from an install shared between checkouts,
# so a cloud run can typecheck or test without its own `yarn install`
# (minutes and gigabytes per run).
#
#   scripts/shared-deps.sh <deps dir>
#
# An install is keyed by what yarn reads: yarn.lock, .yarnrc.yml, .yarn/ and
# every package.json. The first checkout with a new key installs it into
# <deps dir>/<key> from those files alone (no sources, --mode=skip-build), and
# other jobs wanting the same key wait for it. Every checkout then gets it
# through scripts/worktree-setup.sh --from, which links third-party packages
# into the install and points workspace packages at this checkout's own.
#
# Re-running is cheap. If the branch changes a manifest, the next run links
# the install for the new key. A node_modules this script didn't make (a
# local install, or worktree-setup.sh's links to main on a Mac) is left alone.
# Installs nobody has linked for two days are deleted when a new one is made.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

deps="${1:?usage: scripts/shared-deps.sh <deps dir>}"
mkdir -p "$deps"
deps="$(cd "$deps" && pwd -P)"

KEY_FILE=node_modules/.shared-deps
MARKER=.worktree-shadow # worktree-setup.sh's, on each node_modules it made

files="$(git ls-files -co --exclude-standard -- yarn.lock .yarnrc.yml .yarn \
  ':(glob)**/package.json' | sort -u | while IFS= read -r f; do
  if [ -f "$f" ]; then printf '%s\n' "$f"; fi
done)"
key="$({
  printf '%s\n' "$files"
  printf '%s\n' "$files" | git hash-object --stdin-paths
} | git hash-object --stdin | cut -c1-16)"
dir="$deps/$key"

if [ -f "$KEY_FILE" ] && [ "$(cat "$KEY_FILE")" = "$key" ] && [ -f "$dir/.ready" ]; then
  touch "$dir"
  echo "shared-deps: up to date ($key)"
  exit 0
fi
if { [ -e node_modules ] || [ -L node_modules ]; } && [ ! -f "$KEY_FILE" ]; then
  echo "shared-deps: node_modules is already here (installed, or linked from main); leaving it"
  exit 0
fi

if [ ! -f "$dir/.ready" ]; then
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$deps/.lock-$key"
    flock -w 2400 9
  fi
  if [ ! -f "$dir/.ready" ]; then
    echo "shared-deps: installing $key, the first for these manifests (a few minutes)"
    started=$SECONDS
    rm -rf "$dir.tmp"
    mkdir -p "$dir.tmp"
    printf '%s\n' "$files" | tar -cf - -T - | tar -xf - -C "$dir.tmp"
    if ! (cd "$dir.tmp" && yarn install --mode=skip-build) >"$dir.tmp/.install.log" 2>&1; then
      echo "shared-deps: yarn install failed:" >&2
      tail -40 "$dir.tmp/.install.log" >&2
      exit 1
    fi
    touch "$dir.tmp/.ready"
    rm -rf "$dir"
    mv "$dir.tmp" "$dir"
    echo "shared-deps: installed in $((SECONDS - started))s"
    find "$deps" -mindepth 1 -maxdepth 1 -type d -name '[0-9a-f]*' \
      ! -name "$key" -mtime +2 -exec rm -rf {} +
  fi
fi
touch "$dir"

# The links of an earlier key, made by this script.
if [ -f "$KEY_FILE" ]; then
  find . -maxdepth 5 \( -path ./.git -o -path ./node_modules \) -prune -o \
    -type d -name node_modules -print -prune |
    while IFS= read -r nm; do
      if [ -e "$nm/$MARKER" ]; then rm -rf "$nm"; fi
    done
  rm -rf node_modules
fi

scripts/worktree-setup.sh --from "$dir"
printf '%s\n' "$key" >"$KEY_FILE"
