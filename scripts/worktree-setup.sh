#!/usr/bin/env bash
#
# Make a fresh git worktree of this repo runnable (tests, typecheck, scripts)
# with the main checkout's installed dependencies, without a `yarn install`.
#
#   scripts/worktree-setup.sh
#
# Run it from inside the worktree. `wf start` runs it for you when it creates
# one. Re-running is safe and picks up packages added to main since.
#
# Why not just `ln -s <main>/node_modules node_modules`: the workspace packages
# in node_modules (@notesgraph/*, @blocksuite/*, @notesgraph-tools/*, ...) are
# relative links like `../../packages/common/plugin-sdk`. Behind a whole-dir
# link they resolve inside MAIN, so vitest, tsc and node load main's sources
# instead of the branch's, and `yarn notesgraph server genconfig` writes into
# main. Here each node_modules is a real directory instead:
#   - workspace packages (relative links) are re-created, so they point at the
#     worktree's own packages
#   - third-party packages are absolute links into main's node_modules
#   - .prisma and @prisma/client are cloned, so `prisma generate` against the
#     branch's schema writes into the worktree, not main's dev server
# It also links main's built native addons and copies the gitignored Android
# build files when main has them.
set -euo pipefail

wt="$(cd "$(dirname "$0")/.." && pwd -P)"
common="$(git -C "$wt" rev-parse --git-common-dir)"
case "$common" in /*) ;; *) common="$wt/$common" ;; esac
main="$(cd "$common/.." && pwd -P)"

if [ "$wt" = "$main" ]; then
  echo "worktree-setup: $wt is the main checkout; nothing to do"
  exit 0
fi
if [ ! -d "$main/node_modules" ]; then
  echo "worktree-setup: $main has no node_modules; run yarn install there first" >&2
  exit 1
fi

MARKER=.worktree-shadow

# Clone a directory: APFS copy-on-write where available, else a plain copy.
clone() { cp -Rc "$1" "$2" 2>/dev/null || cp -R "$1" "$2"; }

# shadow <main dir> <worktree dir> <path relative to node_modules>
shadow() {
  local src="$1" dst="$2" rel="$3" entry name
  mkdir -p "$dst"
  for entry in "$src"/* "$src"/.[!.]*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name="${entry##*/}"
    case "$name" in
      node_modules | .DS_Store | "$MARKER") continue ;; # main has a stray self-link
    esac
    if [ -e "$dst/$name" ] || [ -L "$dst/$name" ]; then
      continue
    fi
    case "$rel$name" in
      .prisma | @prisma/client)
        clone "$entry" "$dst/$name"
        continue
        ;;
    esac
    if [ -L "$entry" ] && [[ "$(readlink "$entry")" != /* ]]; then
      cp -P "$entry" "$dst/$name"
    elif [ -d "$entry" ] && [ ! -L "$entry" ] && { [[ "$name" == @* ]] || [ "$name" = .bin ]; }; then
      shadow "$entry" "$dst/$name" "$rel$name/"
    else
      ln -s "$entry" "$dst/$name"
    fi
  done
}

setup_node_modules() {
  local src="$1" dst="$2"
  if [ -L "$dst" ]; then
    rm "$dst" # the old whole-dir link to main
  elif [ -d "$dst" ] && [ ! -e "$dst/$MARKER" ]; then
    echo "  skip ${dst#"$wt"/}: installed in the worktree"
    return
  fi
  shadow "$src" "$dst" ""
  touch "$dst/$MARKER"
  echo "  ${dst#"$wt"/}"
}

echo "worktree-setup: linking dependencies from $main"
setup_node_modules "$main/node_modules" "$wt/node_modules"

# Per-package node_modules (packages/backend/server, tools/agent-runner, ...).
while IFS= read -r src; do
  rel="${src#"$main"/}"
  [ -d "$wt/$(dirname "$rel")" ] || continue
  setup_node_modules "$src" "$wt/$rel"
done < <(find "$main" -maxdepth 5 \
  \( -path "$main/.git" -o -path "$main/.claude" -o -path "$main/node_modules" \) -prune \
  -o -type d -name node_modules -print -prune)

# Built Rust addons (the server needs server-native.node to boot, genconfig
# included). Linked, so they are main's build: rebuild in the worktree if the
# branch changes the Rust code.
for f in "$main"/packages/backend/native/*.node "$main"/packages/frontend/native/*.node; do
  [ -f "$f" ] || continue
  rel="${f#"$main"/}"
  if [ ! -e "$wt/$rel" ] && [ ! -L "$wt/$rel" ]; then
    ln -s "$f" "$wt/$rel"
    echo "  linked $rel"
  fi
done

# Generated, gitignored template JSON that frontend typecheck imports.
for rel in packages/frontend/templates/edgeless; do
  if [ -d "$main/$rel" ] && [ ! -e "$wt/$rel" ] && [ -d "$(dirname "$wt/$rel")" ]; then
    ln -s "$main/$rel" "$wt/$rel"
    echo "  linked $rel"
  fi
done

for f in packages/frontend/apps/android/App/local.properties \
  packages/frontend/apps/android/App/app/google-services.json; do
  if [ -f "$main/$f" ] && [ ! -e "$wt/$f" ] && [ -d "$(dirname "$wt/$f")" ]; then
    cp "$main/$f" "$wt/$f"
    echo "  copied $f"
  fi
done

echo "worktree-setup: done"
