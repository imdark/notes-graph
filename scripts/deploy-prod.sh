#!/usr/bin/env bash
# Deploy the current working tree to production (app.notesgraph.com).
#
# Usage:
#   ./scripts/deploy-prod.sh              # full deploy: sync + build + restart
#   ./scripts/deploy-prod.sh --landing    # landing page only (seconds)
#   ./scripts/deploy-prod.sh --download   # download page + built binaries (apk/dmg)
#
# The first full deploy on a fresh box takes ~20-30 min (cold caches);
# subsequent deploys reuse yarn/cargo/docker caches and are much faster.
#
# SSH access: the box only allows port 22 from allow-listed IPs, so a rotating
# home IP silently breaks SSH. If SSH is unreachable this script uses the AWS
# CLI to add the current public IP to the box's security group, running
# 'aws login' interactively first if the session has expired. Override targets
# with NOTESGRAPH_DEPLOY_REGION / NOTESGRAPH_DEPLOY_SG.
set -euo pipefail

HOST="${NOTESGRAPH_DEPLOY_HOST:-18.225.203.37}"
SSH_KEY="${NOTESGRAPH_DEPLOY_KEY:-$HOME/.ssh/notesgraph-prod.pem}"
# Keepalives: a stalled connection errors out in ~2 minutes instead of
# hanging the deploy forever (the remote build step is a long-lived session).
SSH=(ssh -i "$SSH_KEY" -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "ubuntu@$HOST")
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$REPO_ROOT/package.json').version" 2>/dev/null || echo '0.0.0')"
DL_REMOTE="/opt/notesgraph/landing/download"

# AWS bits for auto-opening SSH when this machine's IP isn't allowlisted.
AWS_REGION_="${NOTESGRAPH_DEPLOY_REGION:-us-east-2}"
DEPLOY_SG="${NOTESGRAPH_DEPLOY_SG:-}"   # optional; auto-derived from HOST if empty

# True if we can open an SSH session to the box right now.
ssh_probe() {
  ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=accept-new "ubuntu@$HOST" 'true' >/dev/null 2>&1
}

# Make sure the AWS CLI has a live session, logging in interactively if not.
ensure_aws_auth() {
  command -v aws >/dev/null 2>&1 || {
    echo "!! aws CLI not installed — can't auto-open SSH. Install it or add your IP to the security group manually." >&2
    return 1
  }
  if aws sts get-caller-identity >/dev/null 2>&1; then
    return 0
  fi
  echo "==> AWS session missing/expired — launching interactive login (a browser may open)"
  # 'aws login' is this environment's configured re-auth entrypoint.
  aws login || {
    echo "!! 'aws login' failed. Authenticate manually, then re-run." >&2
    return 1
  }
  aws sts get-caller-identity >/dev/null 2>&1
}

# Add this machine's public IP to the box's SSH (tcp/22) ingress rule.
open_ssh_ingress() {
  ensure_aws_auth || return 1

  local sg="$DEPLOY_SG"
  if [[ -z "$sg" ]]; then
    sg="$(aws ec2 describe-instances --region "$AWS_REGION_" \
      --filters "Name=ip-address,Values=$HOST" \
      --query 'Reservations[].Instances[].SecurityGroups[].GroupId' \
      --output text 2>/dev/null | tr '\t' '\n' | head -1)"
  fi
  [[ -n "$sg" ]] || { echo "!! couldn't resolve a security group for $HOST" >&2; return 1; }

  local myip
  myip="$(curl -fsS --max-time 10 https://api.ipify.org)" \
    || { echo "!! couldn't determine this machine's public IP" >&2; return 1; }

  echo "==> authorizing SSH (tcp/22) from $myip/32 on $sg"
  # Idempotent: a duplicate rule just means we're already allowed.
  aws ec2 authorize-security-group-ingress --region "$AWS_REGION_" --group-id "$sg" \
    --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$myip/32,Description=deploy-prod-$(whoami)-$(date +%Y%m%d)}]" \
    >/dev/null 2>&1 \
    && echo "==> ingress rule added (remember to revoke it later if this is a dynamic IP)" \
    || echo "==> ingress rule already present (or add failed) — continuing"
}

# Guarantee SSH works before any ssh/scp/rsync; open the port via AWS if needed.
ensure_ssh_access() {
  if ssh_probe; then return 0; fi
  echo "==> SSH to $HOST is unreachable — attempting to open port 22 for this machine"
  open_ssh_ingress || { echo "!! could not open SSH access automatically" >&2; exit 1; }
  local i
  for i in 1 2 3 4 5; do
    if ssh_probe; then echo "==> SSH reachable"; return 0; fi
    sleep 3
  done
  echo "!! SSH to $HOST still unreachable after opening ingress" >&2
  exit 1
}

echo "==> deploying to $HOST"
ensure_ssh_access

# Build the three frontend bundles here instead of on the box.
#
# They are plain JS/CSS - nothing in them is architecture-specific - and this
# machine has several fast cores against the box's two. Measured locally:
# web ~13s, mobile ~11s, admin ~6s.
#
# The server bundle is NOT built here on purpose: it resolves
# ./server-native.<arch>.node, so a local build would embed this machine's
# addon instead of the box's linux/x64 one.
build_frontend_bundles() {
  echo "==> building frontend bundles locally (web, admin, mobile)"
  cd "$REPO_ROOT"
  for pkg in web admin mobile; do
    echo "--> $pkg"
    BUILD_TYPE=stable SELF_HOSTED=true yarn notesgraph bundle -p "@notesgraph/$pkg" \
      || { echo "!! local $pkg bundle failed" >&2; exit 1; }
  done

  # The bundler can exit 0 having produced nothing (same trap redeploy.sh
  # guards against), so check the outputs rather than the exit code.
  for marker in \
    packages/frontend/apps/web/dist/selfhost.html \
    packages/frontend/admin/dist \
    packages/frontend/apps/mobile/dist; do
    [[ -e "$REPO_ROOT/$marker" ]] \
      || { echo "!! local bundle produced no $marker" >&2; exit 1; }
  done

  # Pre-compress here too. The image's /app/static is exactly these three
  # dists, and compressing them on the box cost ~8 min of brotli on two cores.
  # Done here they ride along in the same rsync, and docker-clean.mjs skips any
  # file that already has fresh .br/.gz siblings. Same script, so the settings
  # cannot drift between the two sides.
  echo "==> pre-compressing bundles locally"
  for d in \
    packages/frontend/apps/web/dist \
    packages/frontend/admin/dist \
    packages/frontend/apps/mobile/dist; do
    node "$REPO_ROOT/packages/backend/server/scripts/docker-clean.mjs" \
      --precompress "$REPO_ROOT/$d" \
      || { echo "!! local pre-compression of $d failed" >&2; exit 1; }
  done
}

# Ship those dists. sync_source excludes every dist/, so they need their own
# pass; --delete keeps stale hashed chunks from piling up on the box.
sync_frontend_dists() {
  echo "==> uploading prebuilt frontend bundles"
  for d in \
    packages/frontend/apps/web/dist \
    packages/frontend/admin/dist \
    packages/frontend/apps/mobile/dist; do
    rsync -az --delete -e "ssh -i $SSH_KEY" \
      "$REPO_ROOT/$d/" "ubuntu@$HOST:/home/ubuntu/notes-graph/$d/"
  done
}

sync_source() {
  echo "==> rsync source"
  rsync -az --delete \
    --exclude node_modules --exclude target --exclude '*/dist' --exclude dist \
    --exclude .yarn/cache --exclude .yarn/install-state.gz --exclude out \
    --exclude '.next' --exclude coverage --exclude test-results \
    -e "ssh -i $SSH_KEY" \
    "$REPO_ROOT/" "ubuntu@$HOST:/home/ubuntu/notes-graph/"
  # vendored dist committed to git — the global '*/dist' exclude above would drop it
  rsync -az -e "ssh -i $SSH_KEY" \
    "$REPO_ROOT/packages/common/theme/dist/" \
    "ubuntu@$HOST:/home/ubuntu/notes-graph/packages/common/theme/dist/"
}

deploy_landing() {
  echo "==> landing page"
  scp -q -i "$SSH_KEY" "$REPO_ROOT/landing/index.html" "ubuntu@$HOST:/opt/notesgraph/landing/index.html"
  # sw.js + manifest.json + icons make the landing page installable/offline —
  # see landing/sw.js. Shared with the download page (same origin/scope).
  scp -q -i "$SSH_KEY" "$REPO_ROOT/landing/sw.js" "ubuntu@$HOST:/opt/notesgraph/landing/sw.js"
  scp -q -i "$SSH_KEY" "$REPO_ROOT/landing/manifest.json" "ubuntu@$HOST:/opt/notesgraph/landing/manifest.json"
  "${SSH[@]}" "mkdir -p /opt/notesgraph/landing/icons"
  scp -q -i "$SSH_KEY" "$REPO_ROOT"/landing/icons/* "ubuntu@$HOST:/opt/notesgraph/landing/icons/"
  echo "==> landing deployed"
}

# Publish the download page and whatever built binaries exist locally, named to
# match the versioned links in landing/download/index.html. Only uploads files
# that are actually present, so it works before every platform has been built.
deploy_download() {
  echo "==> download page + binaries (v$VERSION)"
  "${SSH[@]}" "mkdir -p $DL_REMOTE"
  scp -q -i "$SSH_KEY" "$REPO_ROOT/landing/download/index.html" \
    "ubuntu@$HOST:$DL_REMOTE/index.html"
  # download/index.html references /manifest.json, /sw.js, /icons/* at site
  # root (shared with the home page) — make sure they're present even if
  # --download is run standalone, without --landing having run first.
  scp -q -i "$SSH_KEY" "$REPO_ROOT/landing/sw.js" "ubuntu@$HOST:/opt/notesgraph/landing/sw.js"
  scp -q -i "$SSH_KEY" "$REPO_ROOT/landing/manifest.json" "ubuntu@$HOST:/opt/notesgraph/landing/manifest.json"
  "${SSH[@]}" "mkdir -p /opt/notesgraph/landing/icons"
  scp -q -i "$SSH_KEY" "$REPO_ROOT"/landing/icons/* "ubuntu@$HOST:/opt/notesgraph/landing/icons/"

  # Android — an unsigned debug APK for sideloading, not a Play Store release.
  # Channel matters: the download page points people at this box, and the box
  # IS the stable server (app.notesgraph.com), so a canary APK here sends the
  # app at canary.notesgraph.com and login/preflight fails. Publish the
  # channel we were asked for, defaulting to stable, and keep a backup +
  # atomic swap so a half-finished 150MB upload can't be served.
  local apk_channel="${BUILD_TYPE:-stable}"
  local apk="$REPO_ROOT/packages/frontend/apps/android/App/app/build/outputs/apk/$apk_channel/debug/app-$apk_channel-debug.apk"
  if [[ -f "$apk" ]]; then
    local dl_apk="$DL_REMOTE/notesgraph-$VERSION-android.apk"
    echo "==> android apk [$apk_channel] ($(du -h "$apk" | cut -f1)) -> notesgraph-$VERSION-android.apk"
    scp -i "$SSH_KEY" "$apk" "ubuntu@$HOST:$dl_apk.new"
    "${SSH[@]}" "cp -f $dl_apk $dl_apk.prev 2>/dev/null; mv -f $dl_apk.new $dl_apk && chmod 644 $dl_apk"
  else
    echo "!! android apk not found — skipping ($apk)"
  fi

  # macOS — a dmg from `electron-forge make` (only present if you ran make, not package).
  # Sort newest-first and skip any pre-rebrand AFFiNE*.dmg left in the output dir.
  local dmg
  dmg="$(ls -t "$REPO_ROOT"/packages/frontend/apps/electron/out/*/make/*.dmg 2>/dev/null | grep -iv '/AFFiNE[^/]*\.dmg$' | head -1 || true)"
  if [[ -n "${dmg:-}" && -f "$dmg" ]]; then
    echo "==> macos dmg -> notesgraph-$VERSION-macos-arm64.dmg"
    scp -i "$SSH_KEY" "$dmg" "ubuntu@$HOST:$DL_REMOTE/notesgraph-$VERSION-macos-arm64.dmg"
  fi

  # NotesGraph Web Clipper — package the unpacked MV3 extension as a zip the
  # download page serves for "Load unpacked".
  local clipper_dir="$REPO_ROOT/tools/clipper-extension"
  local clipper_zip="/tmp/notesgraph-web-clipper.zip"
  if [[ -d "$clipper_dir" ]] && command -v zip >/dev/null 2>&1; then
    rm -f "$clipper_zip"
    ( cd "$clipper_dir" && zip -q -r "$clipper_zip" . -x 'smoke-test.mjs' 'README.md' '.DS_Store' )
    echo "==> web clipper ($(du -h "$clipper_zip" | cut -f1)) -> notesgraph-web-clipper.zip"
    scp -q -i "$SSH_KEY" "$clipper_zip" "ubuntu@$HOST:$DL_REMOTE/notesgraph-web-clipper.zip"
  else
    echo "!! web clipper not packaged (missing dir or zip) — skipping"
  fi

  echo "==> download deployed -> https://notesgraph.com/download"
}

# Opt-in: build the frontend bundles here and ship them, rather than rebuilding
# them on the box. Off by default - the all-on-box path stays the safe default.
LOCAL_BUNDLES=0
if [[ "${1:-}" == "--local-bundles" ]]; then
  LOCAL_BUNDLES=1
  shift
fi

if [[ "${1:-}" == "--landing" ]]; then
  deploy_landing
  exit 0
fi

if [[ "${1:-}" == "--download" ]]; then
  deploy_download
  exit 0
fi

if [[ "$LOCAL_BUNDLES" == "1" ]]; then
  build_frontend_bundles
fi

sync_source
if [[ "$LOCAL_BUNDLES" == "1" ]]; then
  sync_frontend_dists
fi
deploy_landing

# Concurrency guard: the box has only ~7.6 GB RAM and each full build runs
# three node bundlers at a 6 GB heap — two overlapping builds OOM'd the OS
# and took prod down (2026-07-20). Take an flock-based lock on the box so a
# second full deploy fails fast instead of racing the first.
echo "==> acquiring remote build lock"
if ! "${SSH[@]}" 'exec 9>/tmp/notesgraph-deploy.lock; flock -n 9 || exit 17; echo locked' 2>/dev/null | grep -q locked; then
  echo "!! another deploy is already building on the box (/tmp/notesgraph-deploy.lock)." >&2
  echo "   Wait for it to finish (watch /home/ubuntu/deploy.log) or clear a stale lock." >&2
  exit 1
fi

echo "==> remote build + restart (log: /home/ubuntu/deploy.log on the box)"
# Hold the lock for the whole remote build so a concurrent deploy is blocked.
# Runs the version-controlled scripts/prod/redeploy.sh (rsynced above), which
# also takes a pre-migration DB + config backup into /opt/notesgraph/backups.
"${SSH[@]}" 'exec 9>/tmp/notesgraph-deploy.lock; flock -n 9 || { echo "LOCK-LOST"; exit 17; }; NOTESGRAPH_SKIP_FRONTEND_BUNDLES='"$LOCAL_BUNDLES"' bash /home/ubuntu/notes-graph/scripts/prod/redeploy.sh 2>&1 | tee /home/ubuntu/deploy.log | grep -E "^===|BUILD-ALL-DONE|DEPLOY-DONE|Error|error TS|FAILED" || true'

# redeploy.sh aborts on build failure (set -e), but the grep pipeline above
# swallows its exit code — gate on the completion marker so a failed build
# can't masquerade as a successful deploy.
if ! "${SSH[@]}" 'grep -q "DEPLOY-DONE" /home/ubuntu/deploy.log'; then
  echo "!! remote build FAILED — prod still runs the previous build. Last errors:" >&2
  "${SSH[@]}" 'grep -iE "error|ERROR" /home/ubuntu/deploy.log | tail -10' >&2 || true
  exit 1
fi

echo "==> verifying"
"${SSH[@]}" 'docker compose -f /opt/notesgraph/compose.yml --env-file /opt/notesgraph/.env ps --format "table {{.Name}}\t{{.Status}}"'
curl -s -o /dev/null -w "app.notesgraph.com -> HTTP %{http_code}\n" --max-time 15 https://app.notesgraph.com || echo "(app URL not reachable yet — DNS/TLS pending?)"
echo "==> done"
