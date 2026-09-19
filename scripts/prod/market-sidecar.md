# Plugin marketplace sidecar on prod

The registry the app's **Plugins** tab browses. Built by `redeploy.sh` as
`notesgraph-plugin-server:prod` (step: "plugin marketplace image").

**Applied on the box as of 2026-09-19** — the `plugin_server` service is in
`/opt/notesgraph/compose.yml` and the `/market/*` block is in
`/opt/notesgraph/Caddyfile`. Neither file is in this repo, so this is the only
record of them; both were backed up in place before editing
(`*.bak-<timestamp>`). Reapply or inspect with `scripts/prod-exec.sh`.

## What is public and what is not

| route | exposure |
|---|---|
| `GET /plugins`, `GET /plugins/:id` | public |
| `GET /download/:id/:version/*` | public |
| `GET /pubkey`, `GET /health` | public |
| `POST /publish` | signed in |
| `POST /admin/:id/:version/approve\|reject` | signed in |
| `POST /p/:id/:fn` (runs plugin server code) | signed in |

The sidecar has no authentication of its own — every route is open to anyone
who can reach the port, and submissions are auto-signed with the registry's
key. So it gets **no published port**, and Caddy draws the line above. If the
sidecar is ever reachable directly, anyone can publish a signed plugin into
every user's marketplace.

Reads are public so the desktop and Android apps can load plugin code at all —
see the last section.

## 1. `/opt/notesgraph/compose.yml`

Note: no `networks:` key — this stack uses the default compose network, and the
proxy addresses services by their compose service name (`plugin_server:8099`,
the same way `linkcard:8088` works).

```yaml
  plugin_server:
    image: notesgraph-plugin-server:prod
    container_name: notesgraph_plugin_server
    environment:
      - PORT=8099
      - PLUGIN_DATA_DIR=/data
      - AUTO_APPROVE=false
    volumes:
      - /opt/notesgraph/data/plugins:/data
    expose:
      - '8099'
    restart: unless-stopped
```

`/opt/notesgraph/data/plugins` holds `registry.json`, the published bundles and
`signing-key.json`. **Back it up with the rest of `data/`**: losing the signing
key invalidates the signature on every plugin already published.

## 2. Caddy

Goes inside the existing `app.notesgraph.com { … }` block, **before** the bare
`handle { reverse_proxy notesgraph:3010 }` catch-all.

`handle`, not `route` — this cost a failed attempt. Caddy emits all `handle`
blocks as one mutually-exclusive group *before* any `route` block, regardless
of where the `route` is written. A top-level `route /market/*` placed above the
catch-all therefore never ran: the bare `handle` swallowed every request first,
so `/market/plugins` returned the SPA and `/market/publish` 404'd. The nested
`route` is what preserves the order of the directives inside.

```caddy
  handle /market/* {
    route {
      # forward_auth asks the app's own /api/auth/check: 204 when the request
      # carries a valid session (cookie, JWT or PAT), 401 when it does not.
      # /api/auth/session is NOT usable for this — it is public and answers
      # 200 with an empty user when signed out.
      @market_write path /market/publish /market/admin/* /market/p/*
      forward_auth @market_write notesgraph:3010 {
        uri /api/auth/check
        copy_headers Cookie Authorization
      }

      # Belt and braces: refuse any other mutating method outright, so a new
      # write route can never fall through to the public branch unnoticed.
      @market_other_write not method GET HEAD OPTIONS
      respond @market_other_write "method not allowed" 405

      # The sidecar knows nothing about the /market prefix.
      uri strip_prefix /market
      reverse_proxy plugin_server:8099
    }
  }
```

`forward_auth` only *authenticates* the write; it falls through to the proxy at
the bottom of the route, which is what actually forwards it.

Validate against a candidate file before swapping it in — a bad Caddyfile takes
the whole site down:

```bash
scripts/prod-exec.sh --file ./Caddyfile /opt/notesgraph/Caddyfile.new
scripts/prod-exec.sh 'docker run --rm -v /opt/notesgraph/Caddyfile.new:/etc/caddy/Caddyfile:ro caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile'
# then install it and:
scripts/prod-exec.sh 'docker exec notesgraph_caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'
```

`caddy validate` will NOT catch the handle/route ordering trap — that config is
perfectly valid, it just never matches. Always verify the behaviour:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://app.notesgraph.com/market/plugins    # 200 application/json
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://app.notesgraph.com/market/publish            # 401
curl -s -o /dev/null -w '%{http_code}\n' https://app.notesgraph.com/clip/health                       # still linkcard, not the SPA
```

## Publishing

Publishing goes through the gated route, so a PAT works:

```bash
curl -X POST https://app.notesgraph.com/market/publish \
  -H "Authorization: Bearer $NOTESGRAPH_PAT" \
  -H 'content-type: application/json' \
  -d @plugin.json
```

With `AUTO_APPROVE=false` a third-party submission lands `pending` and stays
unlisted until approved:

```bash
curl -X POST https://app.notesgraph.com/market/admin/<id>/<version>/approve \
  -H "Authorization: Bearer $NOTESGRAPH_PAT"
```

First-party plugins bundled in the image are exempt — `seedBundledPlugins()`
publishes them `trusted`, so they are approved on boot even with curation on.
Curation is for submissions that arrive over the wire; a plugin baked into the
build has already been through it. (Before that fix, `AUTO_APPROVE=false`
silently left the seeds `pending` and the marketplace listed nothing.)

**Editing `registry.json` by hand does not stick.** Seeding re-runs on every
container start and `publish()` replaces the existing entry for that id and
version, so a manual status edit is overwritten on the next restart.

Note the gate only proves *someone is signed in* — it does not distinguish an
admin from any other user. Until the sidecar learns who the caller is, anyone
with an account can publish and approve.

## Why reads are public: desktop and mobile

Plugin code is loaded with a dynamic `import()`, which cannot carry an
`Authorization` header and sends cookies only same-origin. The web app is
same-origin with `/market/*`, so a gate there would be invisible to it — but
the desktop and Android apps authenticate with a JWT header against a different
origin, and would simply fail to load any plugin. Public reads keep them
working.

The client side matches: `PluginMarketplaceService` deliberately does **not**
send `credentials: 'include'`, because the sidecar answers with
`Access-Control-Allow-Origin: *` and browsers refuse to pair a wildcard origin
with a credentialed request.

If reads ever need gating, the fix is short-lived signed download URLs, not a
`forward_auth` on the download path.
