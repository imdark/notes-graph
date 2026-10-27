#!/usr/bin/env bash
# Box side of the GitHub deploy (.github/workflows/deploy-prod.yml). The
# workflow builds the server image on a runner, pushes it to ECR, then runs
# this over SSM from a checkout of the deployed commit:
#
#   scripts/prod/deploy-image.sh <ecr-image-ref>
#
# It publishes the landing page and runs redeploy.sh with NOTESGRAPH_IMAGE
# set, so the server image is pulled rather than built here; the sidecars,
# the pre-migration backup and the stack roll are redeploy.sh's own. Takes the
# same build lock as deploy-prod.sh, so the two deploys never overlap.
# Runs as ubuntu.
set -euo pipefail

IMAGE="${1:?usage: deploy-image.sh <ecr-image-ref>}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
LOG=/home/ubuntu/deploy.log
LANDING=/opt/notesgraph/landing

exec 9>/tmp/notesgraph-deploy.lock
if ! flock -n 9; then
  echo "!! another deploy is already running on the box (/tmp/notesgraph-deploy.lock)" >&2
  exit 17
fi

echo "==> landing page"
# The same files deploy-prod.sh's deploy_landing copies.
mkdir -p "$LANDING/icons" "$LANDING/privacy" "$LANDING/terms"
cp "$SRC/landing/index.html" "$SRC/landing/sw.js" "$SRC/landing/manifest.json" "$LANDING/"
cp "$SRC"/landing/icons/* "$LANDING/icons/"
cp "$SRC/landing/privacy/index.html" "$LANDING/privacy/index.html"
cp "$SRC/landing/terms/index.html" "$LANDING/terms/index.html"

echo "==> redeploy with $IMAGE (full log: $LOG)"
# The full log stays on the box; SSM keeps only the last 24,000 characters of
# output, so pass through just the step lines and problems.
NOTESGRAPH_SRC="$SRC" NOTESGRAPH_IMAGE="$IMAGE" bash "$SRC/scripts/prod/redeploy.sh" 2>&1 \
  | tee "$LOG" | grep -E "^===|DEPLOY-DONE|WARN|FATAL|Error" || true

# redeploy.sh stops at the first failure; only its last line says it finished.
if ! grep -q "DEPLOY-DONE" "$LOG"; then
  echo "!! deploy FAILED; prod still runs the previous build. Last lines:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi
docker compose -f /opt/notesgraph/compose.yml --env-file /opt/notesgraph/.env ps \
  --format "table {{.Name}}\t{{.Status}}"
