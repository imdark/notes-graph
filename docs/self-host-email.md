# Self-hosted email (AWS SES)

How NotesGraph sends transactional email (workspace invitations, sign-in magic
links, email verification) on the self-hosted deployment, and how to set it up
from scratch on a new environment.

## How it works

The server sends mail with **nodemailer over SMTP**, configured entirely from
env vars (`core/mail`):

| env | example | notes |
|-----|---------|-------|
| `MAILER_HOST` | `email-smtp.us-east-2.amazonaws.com` | SES SMTP endpoint |
| `MAILER_PORT` | `587` | STARTTLS submission |
| `MAILER_USER` | `AKIA…` | SES SMTP username (IAM access key id) |
| `MAILER_PASSWORD` | *(derived)* | SES SMTP password (derived from the IAM secret) |
| `MAILER_SENDER` | `NotesGraph <no-reply@notesgraph.com>` | From address |
| `MAILER_SERVERNAME` | *(optional)* | SMTP HELO name |
| `MAILER_IGNORE_TLS` | *(optional)* | `true` only for self-signed relays |

If **no** `MAILER_HOST` is set, the mailer is unconfigured and **silently drops
mail** — it still logs `Invitation email sent`, which is misleading. So "invites
succeed but no email arrives" almost always means `MAILER_*` isn't set. See
[Troubleshooting](#troubleshooting).

We use **AWS SES** as the SMTP provider because the box is on EC2:

- EC2 **blocks outbound port 25**, so a mail server on the box can't deliver
  directly — it must relay. SES SMTP is on **587** (open) and is AWS-native.
- SES verifies the `notesgraph.com` **domain** (Easy DKIM), which lets us send
  from any `@notesgraph.com` address with DKIM/SPF/DMARC passing.

DNS for `notesgraph.com` is on **GoDaddy**; the API key/secret used by the DDNS
updater (`/opt/notesgraph/godaddy.env`) is reused to publish the SES records.

## First-time setup

Prereqs: `aws` CLI authenticated with SES + IAM permissions (`aws login`),
`python3`, and SSH access to the box (the `deploy-prod.sh` key).

### 1. SES identity + DNS records

```bash
scripts/setup-ses-dns.sh
```

This creates the SES domain identity (Easy DKIM), sets a custom MAIL FROM
(`mail.notesgraph.com`), and publishes to GoDaddy:

- 3 × `CNAME` `<token>._domainkey` → `<token>.dkim.amazonses.com` (DKIM)
- `MX` `mail` → `feedback-smtp.<region>.amazonses.com` (MAIL FROM)
- `TXT` `mail` → `v=spf1 include:amazonses.com ~all` (SPF)
- `TXT` `_dmarc` → `v=DMARC1; p=none; rua=mailto:…` (DMARC)

SES auto-verifies once DNS propagates (usually minutes). Check:

```bash
aws sesv2 get-email-identity --email-identity notesgraph.com --region us-east-2 \
  --query '{DKIM:DkimAttributes.Status, Verified:VerifiedForSendingStatus}' --output json
```

Wait for `DKIM: "SUCCESS"`.

### 2. Leave the SES sandbox (production access)

New SES accounts are **sandboxed**: they can only send to *verified* recipient
addresses, capped at 200/day. To email arbitrary invited members you must
request **production access**. This is a **console** step — the API
(`put-account-details`) refuses to re-submit after a denial (`ConflictException`).

1. AWS Console → **SES** → *Account dashboard* → **Request production access**
   (or reply to the existing Support case).
2. Mail type: **Transactional**. Website: `https://notesgraph.com`.
3. Use-case description (this wording gets approved; generic ones get denied):

   > Self-hosted single-tenant workspace/notes app at https://notesgraph.com.
   > Transactional, recipient-initiated email only — workspace invitations an
   > admin triggers, sign-in magic links, email verification. No marketing or
   > bulk. Under ~50/day. From no-reply@notesgraph.com, SES domain-verified with
   > DKIM + custom MAIL FROM SPF + DMARC. We process SES bounce/complaint
   > notifications and suppress addresses that bounce or complain. Every
   > recipient was deliberately invited by an admin.

AWS usually approves within ~24h.

**Stopgap while sandboxed:** invites deliver to any address you first verify as
an SES identity:

```bash
aws sesv2 create-email-identity --email-identity member@example.com --region us-east-2
# recipient clicks the link SES emails them; then invites to them deliver
```

### 3. Wire the app to SES

```bash
scripts/deploy-mailer.sh
```

This ensures an IAM user (`notesgraph-ses-smtp`) allowed to send, mints SES SMTP
credentials (derives the SMTP password from the IAM secret), writes `MAILER_*`
into the box's `.env`, and restarts the server. Secrets are streamed over stdin
— never printed or passed as argv. Re-run any time to rotate credentials.

### 4. Test

```bash
scripts/send-test-email.sh you@example.com   # recipient must be verified if still sandboxed
```

Sends through the server container's `MAILER_*` env exactly as the app does.
`SENT_OK … 250 Ok` means it left SES; check the inbox.

## Scripts

| script | purpose |
|--------|---------|
| `scripts/setup-ses-dns.sh` | Create SES identity + publish DKIM/SPF/DMARC/MAIL FROM records to GoDaddy |
| `scripts/deploy-mailer.sh` | Mint SES SMTP creds, write `MAILER_*` to the server `.env`, restart |
| `scripts/send-test-email.sh` | Send a test email via the server's SMTP path |

All are idempotent and read the box host/key from the same env vars as
`deploy-prod.sh` (`NOTESGRAPH_DEPLOY_HOST`, `NOTESGRAPH_DEPLOY_KEY`).

## Troubleshooting

- **Invite succeeds but no email** — `MAILER_*` not set (mailer unconfigured, mail
  dropped silently). Run `scripts/deploy-mailer.sh`. Confirm on the box:
  `grep '^MAILER_' /opt/notesgraph/.env`.
- **`Email address is not verified` / `MessageRejected`** — still in the SES
  sandbox and the recipient isn't verified. Verify the recipient (step 2 stopgap)
  or get production access.
- **DKIM stuck `PENDING`** — DNS not propagated or records wrong. Check the
  authoritative NS directly:
  `dig +short CNAME <token>._domainkey.notesgraph.com @ns39.domaincontrol.com`.
- **Lands in spam** — ensure MAIL FROM (SPF) verified and DMARC present; SES
  console → the identity should show DKIM + MAIL FROM = success.
- **Change sender name/address** — set `MAILER_SENDER` env or `SES_REGION` /
  `MAILER_SENDER` when running `deploy-mailer.sh`; any `@notesgraph.com` address
  works once the domain is verified (no per-address verification needed).

## Notes

- Region is `us-east-2` (matches the box). Override with `SES_REGION` on the
  scripts if you move it.
- The SES SMTP password is derived from the IAM secret key with AWS's documented
  algorithm (HMAC-SHA256 chain, region-scoped) — see `deploy-mailer.sh`.
- Rotating credentials: just re-run `deploy-mailer.sh` (it deletes old access
  keys for the IAM user before minting a new one).
