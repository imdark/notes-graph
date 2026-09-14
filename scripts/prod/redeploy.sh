#!/usr/bin/env bash
# Remote side of scripts/deploy-prod.sh: rebuild the image from the synced
# source and roll the compose stack. Reuses yarn/cargo/docker caches.
#
# Version-controlled here so the prod deploy logic isn't only a box-local file.
# scripts/deploy-prod.sh runs THIS copy (rsynced to /home/ubuntu/notes-graph),
# so edits here take effect on the next deploy.
#
# Before the migration runs it takes a DB + config backup into
# /opt/notesgraph/backups (keeps the newest 10), so a bad migration/deploy is
# recoverable. Set SKIP_DB_BACKUP=1 to bypass the backup (not recommended).
set -euo pipefail
cd /home/ubuntu/notes-graph
source "$HOME/.cargo/env" 2>/dev/null || true
export NODE_OPTIONS="--max-old-space-size=6144"

# Protect the live app: if memory runs out, the kernel kills THIS
# build (and its node bundlers, which inherit the score), never the
# app/db containers. Paired with swap as the cushion.
echo 800 > /proc/self/oom_score_adj 2>/dev/null || true

echo "=== yarn install ==="
yarn install

echo "=== native addon ==="
yarn workspace @notesgraph/server-native build
# the loader requires arch-suffixed filenames (CI artifact naming)
cd packages/backend/native
cp -f server-native.node server-native.x64.node
cp -f server-native.node server-native.arm64.node
cp -f server-native.node server-native.armv7.node
cd /home/ubuntu/notes-graph

echo "=== web bundle ==="
BUILD_TYPE=stable SELF_HOSTED=true yarn notesgraph bundle -p @notesgraph/web
echo "=== admin bundle ==="
BUILD_TYPE=stable SELF_HOSTED=true yarn notesgraph bundle -p @notesgraph/admin
echo "=== mobile bundle ==="
BUILD_TYPE=stable SELF_HOSTED=true yarn notesgraph bundle -p @notesgraph/mobile

echo "=== server bundle ==="
yarn workspace @notesgraph/server build

# the bundler exits 0 even on compile errors — verify outputs exist
test -f packages/backend/server/dist/main.js || { echo "FATAL: server dist missing"; exit 1; }
test -f packages/frontend/apps/web/dist/selfhost.html || { echo "FATAL: web dist missing"; exit 1; }
test -d packages/frontend/admin/dist || { echo "FATAL: admin dist missing"; exit 1; }
test -d packages/frontend/apps/mobile/dist || { echo "FATAL: mobile dist missing"; exit 1; }

# image assembly the way CI does it (prod-only deps staged into the server pkg)
/opt/notesgraph/image-build.sh
echo "=== linkcard sidecar image ==="; docker build -f tools/link-card-server/Dockerfile -t notesgraph-linkcard:prod . || echo "WARN linkcard image build failed"
echo "BUILD-ALL-DONE"

cd /opt/notesgraph

# --- backup BEFORE the migration, so a bad migration is recoverable ----------
echo "=== db backup (pre-migration) ==="
mkdir -p backups
BK_TS=$(date +%Y%m%d-%H%M%S)
BK_USER=$(grep -E '^DB_USERNAME=' .env | cut -d= -f2- | tr -d '"')
BK_DB=$(grep -E '^DB_DATABASE=' .env | cut -d= -f2- | tr -d '"')
BK_DB=${BK_DB:-notesgraph}
BK_FILE="backups/db-${BK_TS}.sql.gz"
if docker exec notesgraph_postgres pg_dump -U "$BK_USER" -d "$BK_DB" | gzip > "$BK_FILE"; then
  echo "backup: $BK_FILE ($(du -h "$BK_FILE" | cut -f1))"
else
  rm -f "$BK_FILE"
  if [ "${SKIP_DB_BACKUP:-0}" = "1" ]; then
    echo "WARN db backup failed — continuing because SKIP_DB_BACKUP=1"
  else
    echo "FATAL: db backup FAILED — aborting before migration (set SKIP_DB_BACKUP=1 to override)"
    exit 1
  fi
fi
# Snapshot the config dir too — losing private.key would sign everyone out.
tar czf "backups/config-${BK_TS}.tar.gz" -C /opt/notesgraph/data config 2>/dev/null \
  || echo "WARN config snapshot failed"
# Retention: keep the newest 10 of each.
ls -1t backups/db-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f || true
ls -1t backups/config-*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f || true
# -----------------------------------------------------------------------------

echo "=== rolling stack (migration runs first) ==="
docker compose -f compose.yml --env-file .env up -d --force-recreate notesgraph_migration notesgraph
docker compose -f compose.yml --env-file .env up -d
docker image prune -f > /dev/null
echo "DEPLOY-DONE"
