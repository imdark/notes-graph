---
name: setup-email-ses
description: Configure or fix NotesGraph outbound transactional email (invitations, magic links, verification) via AWS SES from @notesgraph.com. Use when email isn't sending, invites arrive with no email, or when setting up mail on a new environment.
---

# Self-hosted email via AWS SES

Full runbook is `docs/self-host-email.md`. The server sends via nodemailer/SMTP driven
by `MAILER_*` env; on this EC2 host we relay through SES (port 25 is blocked, 587 is open).

## First: diagnose

- **"Invite succeeds but no email arrives"** almost always = `MAILER_*` not set. The
  mailer silently drops mail when unconfigured **but still logs `Invitation email sent`**
  (misleading). Check: `ssh …box 'grep ^MAILER_ /opt/notesgraph/.env'`.
- SES status: `aws sesv2 get-email-identity --email-identity notesgraph.com --region us-east-2 --query '{DKIM:DkimAttributes.Status,Verified:VerifiedForSendingStatus}'`
- Sandbox: `aws sesv2 get-account --region us-east-2 --query ProductionAccessEnabled`

## Setup / repair (idempotent scripts)

```bash
scripts/setup-ses-dns.sh          # SES domain identity + DKIM/SPF/DMARC/MAIL-FROM records published to GoDaddy
# wait for DKIM = SUCCESS (minutes), then:
scripts/deploy-mailer.sh          # mint SES SMTP creds, write MAILER_* to the box .env, restart server
scripts/send-test-email.sh you@example.com   # send through the app's real SMTP path
```

## Hard constraints (don't fight these)

- **EC2 blocks outbound port 25** → cannot deliver directly; must relay via SES on **587**.
  Reverse DNS is `…amazonaws.com`, so direct-send would spam-folder anyway.
- **SES sandbox**: until AWS grants **production access**, mail only reaches *verified*
  recipient addresses. Production access is a **console** step — the API refuses to
  re-submit after a denial (`ConflictException`). Stopgap: verify each recipient with
  `aws sesv2 create-email-identity --email-identity them@x.com --region us-east-2`
  (they click the link), then invites to them deliver.
- **Sender = any `@notesgraph.com`** address works once the **domain** identity is
  verified (Easy DKIM). Set `MAILER_SENDER="NotesGraph <no-reply@notesgraph.com>"`.
- **DNS is GoDaddy**; the API key/secret are on the box at `/opt/notesgraph/godaddy.env`
  (`GODADDY_KEY`/`GODADDY_SECRET`, `Authorization: sso-key KEY:SECRET`,
  `PUT https://api.godaddy.com/v1/domains/notesgraph.com/records/{TYPE}/{NAME}`).
- Region is `us-east-2`. The SES SMTP password is derived from the IAM secret key with
  AWS's HMAC-chain algorithm (implemented in `deploy-mailer.sh`).
