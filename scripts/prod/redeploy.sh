#!/usr/bin/env bash
# Remote side of scripts/deploy-prod.sh: rebuild the image from the synced
# source and roll the compose stack. Reuses yarn/cargo/docker caches.
#
# Version-controlled here so the prod deploy logic isn't only a box-local file.
# scripts/deploy-prod.sh runs THIS copy (rsynced to /home/ubuntu/notes-graph),
# so edits here take effect on the next deploy.
#
# Before the migration runs it takes a DB + config backup into
# /opt/notesgraph/backups (keeps the newest 5), so a bad migration/deploy is
# recoverable. Set SKIP_DB_BACKUP=1 to bypass the backup (not recommended).
#
# The GitHub deploy (.github/workflows/deploy-prod.yml, via deploy-image.sh)
# builds the server image on a runner and sets NOTESGRAPH_IMAGE to it in ECR:
# then the server build here is skipped, the image is pulled and tagged
# notesgraph:prod, and everything after (sidecars, backup, roll) is the same.
# NOTESGRAPH_SRC is the tree to work from (default: the rsynced one).
set -euo pipefail
SRC="${NOTESGRAPH_SRC:-/home/ubuntu/notes-graph}"
cd "$SRC"
source "$HOME/.cargo/env" 2>/dev/null || true
export NODE_OPTIONS="--max-old-space-size=6144"

# Protect the live app: if memory runs out, the kernel kills THIS
# build (and its node bundlers, which inherit the score), never the
# app/db containers. Paired with swap as the cushion.
echo 800 > /proc/self/oom_score_adj 2>/dev/null || true

# Per-step timing. A full deploy ran ~1h with no idea where the time went; the
# only way anyone found out that static precompression alone was ~20 min of it
# was by watching `ps` on the box mid-build. Each step now reports its own
# duration. The "=== " prefix is what deploy-prod.sh greps for, so the closing
# line stays in that format deliberately.
STEP_NAME=""
STEP_T0=0
step() {
  step_end
  STEP_NAME="$1"
  STEP_T0=$(date +%s)
  echo "=== ${STEP_NAME} ==="
}
step_end() {
  if [ -n "$STEP_NAME" ]; then
    echo "=== ${STEP_NAME} done in $(( $(date +%s) - STEP_T0 ))s ==="
    STEP_NAME=""
  fi
}

# Pull an image from ECR. The ECR helper signs in with the box's instance
# role; a throwaway docker config keeps it out of ubuntu's own.
ecr_pull() {
  local ref="$1" config rc
  config="$(mktemp -d)"
  echo "{\"credHelpers\":{\"${ref%%/*}\":\"ecr-login\"}}" > "$config/config.json"
  DOCKER_CONFIG="$config" docker pull -q "$ref" && rc=0 || rc=$?
  rm -rf "$config"
  return "$rc"
}

if [ -n "${NOTESGRAPH_IMAGE:-}" ]; then
  step "pull prebuilt server image"
  ecr_pull "$NOTESGRAPH_IMAGE"
  docker tag "$NOTESGRAPH_IMAGE" notesgraph:prod
else
# Build the server image here (the rsync deploy from deploy-prod.sh).

# What this deploy is, for the Deployments screen. Read before the build
# touches the tree.
git rev-parse HEAD >/dev/null 2>&1 && node scripts/prod/deploy-info.mjs \
  || echo "deploy record: skipped (no git checkout)"

step "yarn install"
yarn install

step "native addon"
yarn workspace @notesgraph/server-native build
# the loader requires arch-suffixed filenames (CI artifact naming)
cd packages/backend/native
cp -f server-native.node server-native.x64.node
cp -f server-native.node server-native.arm64.node
cp -f server-native.node server-native.armv7.node
cd "$SRC"

# The three frontend bundles are plain JS/CSS with nothing arch-specific in
# them, so they can be built on the dev machine (many fast cores) and shipped,
# instead of rebuilt on this 2-core box. deploy-prod.sh --local-bundles does
# that and sets this flag.
#
# The server bundle is deliberately NOT part of that: it resolves
# ./server-native.<arch>.node, so building it anywhere but here would embed the
# wrong architecture's addon.
if [ "${NOTESGRAPH_SKIP_FRONTEND_BUNDLES:-0}" = "1" ]; then
  step "frontend bundles (shipped prebuilt, not rebuilding)"
  # Never silently fall through to a stale dist: if the upload did not land,
  # stop rather than ship whatever happens to be on disk.
  for marker in \
    packages/frontend/apps/web/dist/selfhost.html \
    packages/frontend/admin/dist \
    packages/frontend/apps/mobile/dist; do
    if [ ! -e "$marker" ]; then
      echo "FATAL: prebuilt frontend bundles missing ($marker) — deploy without --local-bundles"
      exit 1
    fi
  done
  # A prebuilt dist older than the source it came from means the local build
  # silently failed and an earlier one is being reused.
  if [ -n "$(find packages/frontend/apps/web/src -newer packages/frontend/apps/web/dist/selfhost.html -type f -print -quit 2>/dev/null)" ]; then
    echo "FATAL: shipped web dist is older than its sources — local build is stale"
    exit 1
  fi
else
  step "web bundle"
  BUILD_TYPE=stable SELF_HOSTED=true yarn notesgraph bundle -p @notesgraph/web
  step "admin bundle"
  BUILD_TYPE=stable SELF_HOSTED=true yarn notesgraph bundle -p @notesgraph/admin
  step "mobile bundle"
  BUILD_TYPE=stable SELF_HOSTED=true yarn notesgraph bundle -p @notesgraph/mobile
fi

step "server bundle"
yarn workspace @notesgraph/server build

# the bundler exits 0 even on compile errors — verify outputs exist
test -f packages/backend/server/dist/main.js || { echo "FATAL: server dist missing"; exit 1; }
test -f packages/frontend/apps/web/dist/selfhost.html || { echo "FATAL: web dist missing"; exit 1; }
test -d packages/frontend/admin/dist || { echo "FATAL: admin dist missing"; exit 1; }
test -d packages/frontend/apps/mobile/dist || { echo "FATAL: mobile dist missing"; exit 1; }

# image assembly the way CI does it (prod-only deps staged into the server pkg).
# Timed as one step: image-build.sh is box-local (/opt/notesgraph, not synced
# from the repo) and prints its own "=== ... ===" lines without calling step(),
# so without this its time was silently attributed to the server bundle -
# "server bundle done in 724s" was really the bundle plus this whole block.
step "image assembly (prod deps, prisma, docker image)"
/opt/notesgraph/image-build.sh
fi
# --- sidecar images ----------------------------------------------------------
# The link-card, plugin marketplace and agent runner images. Each is redone
# only when its source changes: scripts/prod/sidecar-hash.sh hashes just the
# inputs that determine it (Docker's layer cache can't help, as each
# Dockerfile does `COPY . .` from the repo root), and the image carries that
# hash as a label for the next deploy to compare.
#
# A GitHub deploy builds them in CI (deploy-prod.yml's sidecars job) and
# pushes each to ECR as notesgraph:<name>-<hash>, so here they are pulled.
# Built on this 2-vCPU box they took 22 of a 30-min deploy on 2026-11-26.
# Only a missing CI image (or an rsync deploy, with no ECR) builds here.
# NOTESGRAPH_FORCE_<LINKCARD|PLUGIN_SERVER|AGENT_RUNNER>=1 builds here always.
sidecar_image() {
  local name="$1" dockerfile="$2" local_tag="$3" force="$4"
  local hash prev ref
  hash="$(bash "$SRC/scripts/prod/sidecar-hash.sh" "$name" 2>/dev/null || true)"
  prev="$(docker image inspect "$local_tag" \
    --format '{{ index .Config.Labels "notesgraph.src-hash" }}' 2>/dev/null || true)"
  if [ "$force" != "1" ] && [ -n "$hash" ] && [ "$hash" = "$prev" ]; then
    echo "$name image already matches source (${hash:0:12}), skipping"
    return
  fi
  if [ "$force" != "1" ] && [ -n "$hash" ] && [ -n "${NOTESGRAPH_IMAGE:-}" ]; then
    ref="${NOTESGRAPH_IMAGE%:*}:$name-$hash"
    if ecr_pull "$ref"; then
      docker tag "$ref" "$local_tag"
      echo "$name image pulled from CI (${hash:0:12})"
      return
    fi
    echo "WARN $name image not in ECR ($ref): building it here"
  fi
  # The label is what the next deploy compares against. A failed build leaves
  # no new label, so the rebuild is retried rather than silently skipped.
  docker build -f "$dockerfile" --label "notesgraph.src-hash=$hash" \
    --build-arg "RUNNER_VERSION=$hash" -t "$local_tag" . \
    || echo "WARN $name image build failed"
}

step "linkcard sidecar image"
sidecar_image linkcard tools/link-card-server/Dockerfile notesgraph-linkcard:prod \
  "${NOTESGRAPH_FORCE_LINKCARD:-0}"
step "plugin marketplace image"
sidecar_image plugin-server tools/notesgraph-plugin-server/Dockerfile notesgraph-plugin-server:prod \
  "${NOTESGRAPH_FORCE_PLUGIN_SERVER:-0}"
step "agent runner image"
sidecar_image agent-runner tools/agent-runner/Dockerfile notesgraph-agent-runner:prod \
  "${NOTESGRAPH_FORCE_AGENT_RUNNER:-0}"
step_end
echo "BUILD-ALL-DONE"

cd /opt/notesgraph

# --- backup BEFORE the migration, so a bad migration is recoverable ----------
# Only when this deploy brings a migration the database hasn't had: most
# don't, and the dump was ~2 min of every deploy. migrations-changed.sh
# answers "yes" whenever it can't tell. FORCE_DB_BACKUP=1 always backs up.
MIGRATED_RECORD=/opt/notesgraph/migrated-commit
BK_WHY="$(bash "$SRC/scripts/prod/migrations-changed.sh" "$SRC" "$MIGRATED_RECORD")" && BK_NEED=1 || BK_NEED=0
if [ "${FORCE_DB_BACKUP:-0}" = "1" ]; then
  BK_NEED=1
  BK_WHY="FORCE_DB_BACKUP=1"
fi
if [ "$BK_NEED" = "1" ]; then
  step "db backup (pre-migration: ${BK_WHY})"
  mkdir -p backups
  BK_TS=$(date +%Y%m%d-%H%M%S)
  BK_USER=$(grep -E '^DB_USERNAME=' .env | cut -d= -f2- | tr -d '"')
  BK_DB=$(grep -E '^DB_DATABASE=' .env | cut -d= -f2- | tr -d '"')
  BK_DB=${BK_DB:-notesgraph}
  # zstd on both cores: on this box gzip -6 was ~122 s of a 2 GB dump and
  # zstd -3 -T0 ~10 s, 30% smaller (restore: zstd -dc <file> | psql ...).
  # gzip stays the fallback if zstd is ever missing.
  if command -v zstd >/dev/null 2>&1; then
    BK_FILE="backups/db-${BK_TS}.sql.zst"
    BK_COMPRESS=(zstd -3 -T0 -q)
  else
    BK_FILE="backups/db-${BK_TS}.sql.gz"
    BK_COMPRESS=(gzip)
  fi
  if docker exec notesgraph_postgres pg_dump -U "$BK_USER" -d "$BK_DB" | "${BK_COMPRESS[@]}" > "$BK_FILE"; then
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
  # Retention: keep the newest BACKUPS_KEEP of each. A dump is ~150 MB and one
  # is taken every deploy, so 10 held ~1.5 GB on a 58 GB disk that is already
  # mostly images; 5 still reaches back a few days of deploys.
  BACKUPS_KEEP=${BACKUPS_KEEP:-5}
  # Both formats count toward the newest BACKUPS_KEEP, so older .sql.gz
  # dumps age out as .sql.zst ones arrive.
  ls -1t backups/db-*.sql.zst backups/db-*.sql.gz 2>/dev/null | tail -n +$((BACKUPS_KEEP + 1)) | xargs -r rm -f || true
  ls -1t backups/config-*.tar.gz 2>/dev/null | tail -n +$((BACKUPS_KEEP + 1)) | xargs -r rm -f || true
else
  step "db backup skipped (${BK_WHY})"
fi
# -----------------------------------------------------------------------------

# The migration runs on its own, attached, before the server is touched. It
# used to run as a dependency of the recreated server: compose removed the
# running server container first, then waited on the migration, so a
# migration that failed (2026-11-07: the new build threw at load) left the
# new server container never started and prod answering 502, while this
# script claimed the previous build still ran. With `set -e` a failure here
# ends the deploy with the old server still up.
step "migration (the running server stays up until it passes)"
docker compose -f compose.yml --env-file .env up --force-recreate --exit-code-from notesgraph_migration notesgraph_migration
step_end
# The database now has this commit's migrations: the next deploy compares
# against it to decide whether it needs a backup.
git -C "$SRC" rev-parse HEAD > "$MIGRATED_RECORD" 2>/dev/null || rm -f "$MIGRATED_RECORD"
step "rolling stack"
# The migration passed above. The server lists it in depends_on
# (service_completed_successfully), so without --no-deps recreating the
# server ran it again, and the plain `up -d` below a third time, each time
# waiting on postgres/redis/manticore health: most of this step's ~34 s.
docker compose -f compose.yml --env-file .env up -d --no-deps --force-recreate notesgraph
# Start whatever else isn't running (a new sidecar, or after a reboot), by
# name and without deps, so the one-shot migration job stays done.
mapfile -t ROLL_SERVICES < <(docker compose -f compose.yml --env-file .env config --services | grep -vx notesgraph_migration)
docker compose -f compose.yml --env-file .env up -d --no-deps "${ROLL_SERVICES[@]}"
docker image prune -f > /dev/null
step_end
echo "DEPLOY-DONE"
