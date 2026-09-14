#!/bin/bash
#
# Build the NotesGraph prod server image LOCALLY (linux/amd64) and push it to
# the prod box, then roll the stack. Keeps the RAM-heavy bundling off the
# 7.6 GB box entirely (two concurrent box builds OOM'd it on 2026-07-20).
#
#   scripts/deploy-prod-local.sh            # build + ship + roll
#   scripts/deploy-prod-local.sh --build    # build the image only
#
# On an arm64 Mac the buildx step runs linux/amd64 under emulation — slow on
# a cold cache, fast after. The image ships as save|zstd|ssh|load (no
# registry). Landing/download static files are NOT touched here — use
# scripts/deploy-prod.sh --landing / --download for those.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

KEY="${SSH_KEY:-$HOME/.ssh/notesgraph-prod.pem}"
HOST="${DEPLOY_HOST:-ubuntu@18.225.203.37}"
SG="sg-0802d2901b2f1a5b6"
REGION="us-east-2"
IMAGE="notesgraph:prod"
DOCKERFILE=".github/deployment/node/Dockerfile.selfhost"
SSH=(ssh -o ConnectTimeout=20 -i "$KEY" "$HOST")

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }

ensure_ssh() {
  if "${SSH[@]}" true 2>/dev/null; then return; fi
  log "opening SSH ingress for this IP"
  local myip
  myip="$(curl -s https://checkip.amazonaws.com)"
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp \
    --port 22 --cidr "$myip/32" --region "$REGION" 2>/dev/null || true
}

compressor() { command -v zstd >/dev/null && echo "zstd -T0" || echo "gzip"; }
decompressor() { command -v zstd >/dev/null && echo "zstd -d" || echo "gzip -d"; }

log "docker buildx (linux/amd64) — cold cache is slow on an arm Mac"
docker buildx build --platform linux/amd64 \
  -f "$DOCKERFILE" -t "$IMAGE" --load .

if [[ "${1:-}" == "--build" ]]; then
  log "built $IMAGE (not shipped)"
  exit 0
fi

ensure_ssh

# Ship: the box must be able to decompress with the same tool.
COMP="$(compressor)"
if [[ "$COMP" == zstd* ]] && ! "${SSH[@]}" 'command -v zstd >/dev/null'; then
  COMP="gzip"
fi
DECOMP="gzip -d"; [[ "$COMP" == zstd* ]] && DECOMP="zstd -d"

log "shipping image to box ($COMP over ssh)"
docker save "$IMAGE" | eval "$COMP" | "${SSH[@]}" "$DECOMP | docker load"

log "rolling stack (migration first)"
"${SSH[@]}" 'cd /opt/notesgraph && \
  docker compose -f compose.yml --env-file .env up -d --force-recreate notesgraph_migration notesgraph && \
  docker compose -f compose.yml --env-file .env up -d && \
  docker image prune -f >/dev/null'

log "verifying"
curl -s -o /dev/null -w "app.notesgraph.com -> HTTP %{http_code}\n" --max-time 20 https://app.notesgraph.com
log "done"
