#!/usr/bin/env bash
#
# Hash of the Dockerfile stages that build the Rust addon (toolchain and
# native), for deploy-prod.yml's Rust addon cache key.
#
#   scripts/ci/native-stage-hash.sh [Dockerfile]
#
# The key used to hash the whole Dockerfile, so any edit to it (a yarn or
# bundler change) threw the compiled addon away and the next deploy spent
# ~10 min compiling it again. Only these two stages can change the addon.
set -euo pipefail

file="${1:-.github/deployment/node/Dockerfile.selfhost}"
awk '/^FROM /{ keep = ($0 ~ / AS toolchain$/ || $0 ~ / AS native$/) } keep' "$file" \
  | sha256sum | cut -c1-16
