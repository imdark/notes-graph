#!/usr/bin/env bash
#
# Send a test email through NotesGraph's configured SMTP path — using the
# server container's MAILER_* env exactly as the app does when it sends invites.
# Confirms the SES SMTP credentials, TLS, and from-domain all work end to end.
#
# NOTE: while SES is in sandbox, the recipient must be a *verified* SES identity.
# Verify one first with:
#   aws sesv2 create-email-identity --email-identity you@example.com --region us-east-2
# (then click the link SES emails you). Out of sandbox, any recipient works.
#
# Usage: scripts/send-test-email.sh recipient@example.com
set -euo pipefail

TO="${1:-}"
[ -n "$TO" ] || { echo "usage: $0 recipient@example.com" >&2; exit 1; }
HOST="${NOTESGRAPH_DEPLOY_HOST:-18.225.203.37}"
SSH_KEY="${NOTESGRAPH_DEPLOY_KEY:-$HOME/.ssh/notesgraph-prod.pem}"

ssh -i "$SSH_KEY" -o ConnectTimeout=15 "ubuntu@$HOST" TO="$TO" 'bash -s' "$TO" <<'REMOTE'
TO="$1"
# Static CJS script (/app is ESM, so use .cjs); recipient is passed via env to
# avoid any string interpolation into the script body.
cat > /tmp/mailtest.cjs <<'JS'
const nodemailer = require('nodemailer');
const t = nodemailer.createTransport({
  host: process.env.MAILER_HOST,
  port: Number(process.env.MAILER_PORT),
  secure: false, requireTLS: true,
  auth: { user: process.env.MAILER_USER, pass: process.env.MAILER_PASSWORD },
});
t.verify()
  .then(() => t.sendMail({
    from: process.env.MAILER_SENDER,
    to: process.env.TEST_TO,
    subject: 'NotesGraph SMTP test',
    text: 'Sent by your NotesGraph server via AWS SES from ' + process.env.MAILER_SENDER + '.',
  }))
  .then(i => console.log('SENT_OK', i.messageId || '', (i.response || '').slice(0, 80)))
  .catch(e => console.log('SEND_ERR', e.message));
JS
docker cp /tmp/mailtest.cjs notesgraph_server:/app/mailtest.cjs >/dev/null 2>&1
docker exec -e TEST_TO="$TO" -w /app notesgraph_server node mailtest.cjs
docker exec notesgraph_server rm -f /app/mailtest.cjs 2>/dev/null; rm -f /tmp/mailtest.cjs
REMOTE
