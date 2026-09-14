#!/usr/bin/env bash
#
# One-time setup so NotesGraph can send email from @notesgraph.com via AWS SES.
# Idempotent — safe to re-run.
#
# It:
#   1. Creates (or reuses) the SES domain identity with Easy DKIM
#   2. Sets a custom MAIL FROM subdomain (mail.<domain>) for SPF alignment
#   3. Publishes the DKIM (3x CNAME) + MAIL FROM (MX + SPF) + DMARC records to
#      GoDaddy via its API
#
# DNS is on GoDaddy; the API key/secret live on the prod box at
# /opt/notesgraph/godaddy.env (GODADDY_KEY / GODADDY_SECRET) — the same creds the
# DDNS updater uses. This script pulls them over SSH into memory (never printed)
# and calls the GoDaddy API. SES calls use your local aws CLI session.
#
# After this runs, SES auto-verifies within minutes once DNS propagates. Then:
#   - request SES production access (console — see docs/self-host-email.md)
#   - run scripts/deploy-mailer.sh to wire the app to SES
#
# Prereqs: aws CLI authenticated (SES perms); SSH access to the box.
# Usage:   scripts/setup-ses-dns.sh
set -euo pipefail

DOMAIN="${MAIL_DOMAIN:-notesgraph.com}"
REGION="${SES_REGION:-us-east-2}"
DMARC_RUA="${DMARC_RUA:-mikesgoacademy@gmail.com}"
HOST="${NOTESGRAPH_DEPLOY_HOST:-18.225.203.37}"
SSH_KEY="${NOTESGRAPH_DEPLOY_KEY:-$HOME/.ssh/notesgraph-prod.pem}"
GODADDY_ENV="${GODADDY_ENV:-/opt/notesgraph/godaddy.env}"
SSH=(ssh -i "$SSH_KEY" -o ConnectTimeout=15 "ubuntu@$HOST")

log(){ printf '\033[36m==>\033[0m %s\n' "$*"; }
die(){ printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v aws >/dev/null || die "aws CLI not found"
aws sts get-caller-identity >/dev/null 2>&1 || die "aws not authenticated — run 'aws login'"

# --- 1. SES domain identity (Easy DKIM) ---------------------------------------
log "Ensuring SES domain identity $DOMAIN ($REGION)"
aws sesv2 get-email-identity --email-identity "$DOMAIN" --region "$REGION" >/dev/null 2>&1 \
  || aws sesv2 create-email-identity --email-identity "$DOMAIN" --region "$REGION" >/dev/null

# --- 2. custom MAIL FROM (SPF alignment) --------------------------------------
aws sesv2 put-email-identity-mail-from-attributes --email-identity "$DOMAIN" \
  --mail-from-domain "mail.$DOMAIN" --behavior-on-mx-failure USE_DEFAULT_VALUE \
  --region "$REGION" >/dev/null

# --- 3. DKIM tokens -> record list --------------------------------------------
TOKENS=$(aws sesv2 get-email-identity --email-identity "$DOMAIN" --region "$REGION" \
  --query 'DkimAttributes.Tokens' --output text)
[ -n "$TOKENS" ] || die "no DKIM tokens returned by SES"

# each entry: TYPE|NAME|JSON  (JSON contains no '|')
RECORDS=()
for t in $TOKENS; do
  RECORDS+=("CNAME|${t}._domainkey|[{\"data\":\"${t}.dkim.amazonses.com\",\"ttl\":3600}]")
done
RECORDS+=("MX|mail|[{\"data\":\"feedback-smtp.${REGION}.amazonses.com\",\"priority\":10,\"ttl\":3600}]")
RECORDS+=("TXT|mail|[{\"data\":\"v=spf1 include:amazonses.com ~all\",\"ttl\":3600}]")
RECORDS+=("TXT|_dmarc|[{\"data\":\"v=DMARC1; p=none; rua=mailto:${DMARC_RUA}\",\"ttl\":3600}]")

# --- 4. pull GoDaddy creds from the box (kept in memory, never printed) --------
log "Reading GoDaddy API credentials from $HOST:$GODADDY_ENV"
GD=$("${SSH[@]}" "cat '$GODADDY_ENV'") || die "could not read $GODADDY_ENV on the box"
GODADDY_KEY=$(printf '%s\n' "$GD" | sed -n 's/^GODADDY_KEY=//p' | tr -d '"'"'"' \r')
GODADDY_SECRET=$(printf '%s\n' "$GD" | sed -n 's/^GODADDY_SECRET=//p' | tr -d '"'"'"' \r')
[ -n "$GODADDY_KEY" ] && [ -n "$GODADDY_SECRET" ] || die "GODADDY_KEY / GODADDY_SECRET not found in $GODADDY_ENV"

# --- 5. publish records to GoDaddy --------------------------------------------
AUTH="Authorization: sso-key ${GODADDY_KEY}:${GODADDY_SECRET}"
BASE="https://api.godaddy.com/v1/domains/${DOMAIN}/records"
log "Publishing ${#RECORDS[@]} DNS records to GoDaddy for $DOMAIN"
for rec in "${RECORDS[@]}"; do
  IFS='|' read -r type name json <<<"$rec"
  code=$(curl -s -o /tmp/gd-resp.txt -w '%{http_code}' --max-time 20 -X PUT \
    -H "$AUTH" -H "Content-Type: application/json" -d "$json" "$BASE/$type/$name")
  if [ "$code" = "200" ]; then
    echo "  ✓ $type $name"
  else
    echo "  ✗ $type $name -> HTTP $code: $(cat /tmp/gd-resp.txt)"
  fi
done
rm -f /tmp/gd-resp.txt

cat <<EOF

Records published. SES verifies automatically once DNS propagates (usually
minutes). Check status with:

  aws sesv2 get-email-identity --email-identity $DOMAIN --region $REGION \\
    --query '{DKIM:DkimAttributes.Status, Verified:VerifiedForSendingStatus}' --output json

When DKIM shows SUCCESS:
  1. Request SES production access (see docs/self-host-email.md) to leave the sandbox.
  2. Run: scripts/deploy-mailer.sh          # wires the app to SES
  3. Test: scripts/send-test-email.sh you@example.com
EOF
