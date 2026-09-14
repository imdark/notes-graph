#!/usr/bin/env bash
#
# Configure NotesGraph's outbound email to send from @notesgraph.com via AWS SES.
# Idempotent — safe to re-run (it mints fresh SMTP credentials each time).
#
# What it does:
#   1. Verifies the SES `notesgraph.com` domain identity is ready (warns if not)
#   2. Ensures an IAM user (notesgraph-ses-smtp) allowed to send via SES
#   3. Mints SMTP credentials (SES SMTP password derived from the IAM secret key)
#   4. Writes MAILER_* into the prod server's .env (over SSH) and restarts the app
#   5. Optionally sends a test email via SES (`--test you@example.com`)
#
# Secrets (IAM secret + SMTP password) are captured into shell variables and
# streamed to the box over stdin — they are never printed or passed as argv.
#
# Prereqs:
#   - aws CLI authenticated with SES + IAM permissions (run `aws login` first)
#   - notesgraph.com verified in SES (DKIM CNAMEs added to GoDaddy DNS)
#   - SSH access to the prod box (same key as deploy-prod.sh)
#
# Usage:  scripts/deploy-mailer.sh [--test you@example.com]
set -euo pipefail

REGION="${SES_REGION:-us-east-2}"
IAM_USER="${SES_IAM_USER:-notesgraph-ses-smtp}"
SENDER="${MAILER_SENDER:-NotesGraph <no-reply@notesgraph.com>}"
SMTP_HOST="email-smtp.${REGION}.amazonaws.com"
SMTP_PORT="${MAILER_PORT:-587}"

HOST="${NOTESGRAPH_DEPLOY_HOST:-18.225.203.37}"
SSH_KEY="${NOTESGRAPH_DEPLOY_KEY:-$HOME/.ssh/notesgraph-prod.pem}"
SSH=(ssh -i "$SSH_KEY" -o ConnectTimeout=15 "ubuntu@$HOST")

log()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v aws >/dev/null      || die "aws CLI not found"
command -v python3 >/dev/null  || die "python3 not found (needed to derive the SMTP password)"
aws sts get-caller-identity >/dev/null 2>&1 || die "aws not authenticated — run 'aws login'"

# --- 1. domain verification check ---------------------------------------------
log "Checking SES domain identity notesgraph.com ($REGION)"
DKIM_STATUS=$(aws sesv2 get-email-identity --email-identity notesgraph.com --region "$REGION" \
  --query 'DkimAttributes.Status' --output text 2>/dev/null || echo MISSING)
if [ "$DKIM_STATUS" != "SUCCESS" ]; then
  warn "DKIM status = $DKIM_STATUS (need SUCCESS). Add the DKIM CNAMEs + mail-from"
  warn "records to GoDaddy DNS; SES verifies automatically. Writing config anyway,"
  warn "but mail won't deliver until the domain verifies (and prod access is granted)."
fi
PROD=$(aws sesv2 get-account --region "$REGION" --query 'ProductionAccessEnabled' --output text 2>/dev/null || echo false)
[ "$PROD" = "True" ] || warn "SES still in sandbox — can only send to verified addresses until production access is granted."

# --- 2. IAM user + send policy ------------------------------------------------
log "Ensuring IAM user $IAM_USER with SES send permission"
aws iam get-user --user-name "$IAM_USER" >/dev/null 2>&1 || aws iam create-user --user-name "$IAM_USER" >/dev/null
aws iam put-user-policy --user-name "$IAM_USER" --policy-name notesgraph-ses-send \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ses:SendRawEmail","ses:SendEmail"],"Resource":"*"}]}'

# --- 3. mint a fresh access key (delete old ones to stay under the 2-key cap) --
log "Minting SMTP credentials"
for k in $(aws iam list-access-keys --user-name "$IAM_USER" --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
  aws iam delete-access-key --user-name "$IAM_USER" --access-key-id "$k"
done
CREDS=$(aws iam create-access-key --user-name "$IAM_USER" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
AKID=$(printf '%s' "$CREDS" | awk '{print $1}')
SECRET=$(printf '%s' "$CREDS" | awk '{print $2}')
[ -n "$AKID" ] && [ -n "$SECRET" ] || die "failed to create IAM access key"
sleep 8   # let the new key propagate before the app tries to use it

# --- 4. derive the SES SMTP password from the IAM secret ----------------------
SMTP_PASS=$(python3 - "$SECRET" "$REGION" <<'PY'
import sys, hmac, hashlib, base64
secret, region = sys.argv[1], sys.argv[2]
def s(k, m): return hmac.new(k, m.encode('utf-8'), hashlib.sha256).digest()
sig = s(s(s(s(s(('AWS4'+secret).encode('utf-8'), '11111111'), region), 'ses'), 'aws4_request'), 'SendRawEmail')
print(base64.b64encode(bytes([0x04]) + sig).decode())
PY
)
[ -n "$SMTP_PASS" ] || die "failed to derive SMTP password"

# --- 5. write MAILER_* to the server .env (over stdin) + restart --------------
log "Writing MAILER_* to the server .env and restarting the app"
{
  printf 'MAILER_HOST=%s\n'     "$SMTP_HOST"
  printf 'MAILER_PORT=%s\n'     "$SMTP_PORT"
  printf 'MAILER_USER=%s\n'     "$AKID"
  printf 'MAILER_PASSWORD=%s\n' "$SMTP_PASS"
  printf 'MAILER_SENDER=%s\n'   "$SENDER"
} | "${SSH[@]}" '
  set -e
  tmp=$(mktemp)
  grep -vE "^MAILER_(HOST|PORT|USER|PASSWORD|SENDER|SERVERNAME|IGNORE_TLS)=" /opt/notesgraph/.env > "$tmp" 2>/dev/null || true
  cat >> "$tmp"                      # append the new MAILER_ lines from stdin
  install -m 600 "$tmp" /opt/notesgraph/.env
  rm -f "$tmp"
  docker compose -f /opt/notesgraph/compose.yml --env-file /opt/notesgraph/.env up -d --force-recreate notesgraph >/dev/null
'
log "Mailer configured: $SMTP_HOST as $AKID, sender \"$SENDER\""

# --- 6. optional test send ----------------------------------------------------
if [ "${1:-}" = "--test" ] && [ -n "${2:-}" ]; then
  log "Sending SES test email to $2"
  aws sesv2 send-email --region "$REGION" \
    --from-email-address "$SENDER" \
    --destination "ToAddresses=$2" \
    --content 'Simple={Subject={Data=NotesGraph SES test,Charset=UTF-8},Body={Text={Data=If you can read this, outbound email from notesgraph.com is working.,Charset=UTF-8}}}' \
    --query 'MessageId' --output text && log "Sent (check the inbox/spam)."
fi

log "Done."
