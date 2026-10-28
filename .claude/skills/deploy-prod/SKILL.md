---
name: deploy-prod
description: Deploy NotesGraph server/web/landing changes to the production EC2 box (app.notesgraph.com / notesgraph.com). Use when asked to deploy, redeploy, ship, or push backend/web/landing changes to prod. NOT for the mobile app (that's an APK — see deploy-android-apk).
---

# Deploy to production

Prod is a single EC2 box (`18.225.203.37`, Ubuntu) running a docker-compose stack
(caddy, notesgraph server, postgres, redis, linkcard) behind Caddy. DNS for
`notesgraph.com` + `app.notesgraph.com` is GoDaddy → the box (no CDN).

## Release (the normal way)

PRs merge into `stage` (the default branch). A release ships everything on
`stage` in one deploy:

```bash
scripts/release.sh --plan    # the PRs that would ship
scripts/release.sh --yes     # fast-forward main to stage + start the GitHub deploy
```

The deploy is `.github/workflows/deploy-prod.yml`: it builds the image on a
GitHub runner (~21 min, nothing heavy on the box), pushes it to ECR, and runs
`scripts/prod/deploy-image.sh` on the box over SSM (landing page, sidecars,
backup, roll). No SSH or AWS login from here; it works from a cloud agent too.
Watch it with `gh run watch <id> --exit-status`; the run id is in
`gh run list --workflow deploy-prod.yml --limit 1`. AWS setup:
`scripts/prod/setup-github-deploy-aws.sh`.

## Laptop deploy (fallback)

```bash
./scripts/deploy-prod.sh              # full: rsync tree + rebuild all bundles + docker image + roll stack
./scripts/deploy-prod.sh --landing    # landing page only (seconds)
./scripts/deploy-prod.sh --download    # download page + built binaries (apk/dmg)
```

It rsyncs the **working tree** (uncommitted changes included), builds on the box, and
rolls the stack. A full deploy is ~8–15 min (it rebuilds web/admin/mobile/server
bundles + a fresh docker image **every time**, even for a one-line backend change).

## Gotchas

- **SSH IP allowlist**: the box only allows port 22 from allow-listed IPs, and a
  cellular/rotating IP silently breaks SSH. The script auto-opens ingress via the AWS
  CLI (running `aws login` if the session expired). SG is `sg-0802d2901b2f1a5b6`,
  region `us-east-2`. To do it manually:
  `aws ec2 authorize-security-group-ingress --group-id sg-0802d2901b2f1a5b6 --protocol tcp --port 22 --cidr "$(curl -s https://checkip.amazonaws.com)/32" --region us-east-2`
- **The stack only rolls at the very end** (`DEPLOY-DONE`). Killing the deploy mid-build
  is safe — the old containers keep running until the new image is ready.
- **AWS session expires** (SSO). If `aws` commands fail with "session expired", the user
  must run `aws login` (interactive). Suggest `! aws login`.
- Verify after: `curl -s -o /dev/null -w "%{http_code}" https://app.notesgraph.com/`
  should be 200 (it 502s for a few seconds while the server boots).

## Runtime bits worth knowing

- Server `.env` is `/opt/notesgraph/.env`; recreate the server to reload it:
  `docker compose -f /opt/notesgraph/compose.yml --env-file /opt/notesgraph/.env up -d --force-recreate notesgraph`
- Landing/download files: `/opt/notesgraph/landing/` (bind-mounted read-only into Caddy at `/srv/landing`).
- GoDaddy DNS API creds live on the box at `/opt/notesgraph/godaddy.env` (used by the DDNS updater and the email DNS setup).
