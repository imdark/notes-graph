#!/usr/bin/env bash
#
# The deploy's build caches, kept in S3 instead of the Actions cache.
#
#   scripts/ci/s3-cache.sh restore <dir> <key> [<prefix>]
#   scripts/ci/s3-cache.sh save    <dir> <key>
#
# restore fills <dir> from <key>, else (with <prefix>) from the newest entry
# whose key starts with <prefix>, and writes hit=true|false to
# $GITHUB_OUTPUT (true only for <key> itself, like actions/cache). A missing
# entry leaves <dir> empty; the build treats that as a cold cache.
# save stores <dir> as <key>, zstd-compressed.
#
# Both are best-effort: a failure is a GitHub warning and exit 0, never a
# failed deploy, since a cache is only ever a speed-up.
#
# Why not the Actions cache: the repo gets 10 GB, and PR test runs use ~8 GB
# each, so the deploy's caches were evicted between deploys (run 44960158138
# found neither the Rust addon nor the yarn cache the deploy before had
# saved). Entries expire after 14 days (scripts/prod/setup-github-deploy-aws.sh).
set -euo pipefail

BUCKET="${NOTESGRAPH_CACHE_BUCKET:-notesgraph-deploy-cache-726029337107}"
cmd="${1:?usage: s3-cache.sh restore|save <dir> <key> [prefix]}"
dir="${2:?dir}"
key="${3:?key}"
prefix="${4:-}"

object() { echo "s3://$BUCKET/$1.tar.zst"; }
exists() { aws s3api head-object --bucket "$BUCKET" --key "$1.tar.zst" >/dev/null 2>&1; }
out() { [[ -n "${GITHUB_OUTPUT:-}" ]] && echo "$1" >> "$GITHUB_OUTPUT"; return 0; }

case "$cmd" in
  restore)
    mkdir -p "$dir"
    found="" hit=false
    if exists "$key"; then
      found="$key" hit=true
    elif [[ -n "$prefix" ]]; then
      found="$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$prefix" \
        --query 'sort_by(Contents || `[]`, &LastModified)[-1].Key' --output text 2>/dev/null || true)"
      found="${found%.tar.zst}"
      [[ "$found" == "None" ]] && found=""
    fi
    if [[ -z "$found" ]]; then
      echo "cache miss: $key${prefix:+ (no entry under $prefix)}"
      out "hit=false"
      exit 0
    fi
    s=$(date +%s)
    if ! aws s3 cp --only-show-errors "$(object "$found")" - | zstd -dq | tar -x -C "$dir"; then
      # A cache is only ever a speed-up: start cold rather than fail the deploy.
      echo "::warning::couldn't restore $found; building without it"
      rm -rf "$dir" && mkdir -p "$dir"
      out "hit=false"
      exit 0
    fi
    echo "restored $found ($(du -sh "$dir" | cut -f1)) in $(( $(date +%s) - s )) s$([[ $hit == true ]] || echo ', newest under the prefix')"
    out "hit=$hit"
    ;;
  save)
    s=$(date +%s)
    if ! tar -C "$dir" -cf - . | zstd -3 -T0 -q | aws s3 cp --only-show-errors - "$(object "$key")"; then
      # Run 45433772790 failed here (the bucket didn't exist yet) and so never
      # rolled the box. A lost cache only makes the next deploy slower.
      echo "::warning::couldn't save $key; the next deploy builds without it"
      exit 0
    fi
    echo "saved $key ($(du -sh "$dir" | cut -f1)) in $(( $(date +%s) - s )) s"
    ;;
  *)
    echo "unknown command: $cmd" >&2
    exit 2
    ;;
esac
