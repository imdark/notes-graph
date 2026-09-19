# Plugin marketplace sidecar on prod

The registry the app's **Plugins** tab browses. Built by `redeploy.sh` as
`notesgraph-plugin-server:prod` (step: "plugin marketplace image"); the two
pieces below live on the box and are **not** in this repo, so they have to be
added by hand once. Check them against the actual files before pasting —
they are written from the linkcard sidecar's shape, not from a copy of your
current config.

## What is public and what is not

Reading the registry and downloading a plugin are **public**. Everything that
writes or executes is **gated**.

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
key. So it gets **no published port**, and the proxy in front is what draws
the line above. If the sidecar is ever reachable directly, anyone can publish a
signed plugin into every user's marketplace.

Reads are public so that the desktop and Android apps can load plugin code at
all — see the note at the bottom.

## 1. `/opt/notesgraph/compose.yml`

```yaml
  plugin_server:
    image: notesgraph-plugin-server:prod
    container_name: notesgraph_plugin_server
    restart: unless-stopped
    environment:
      # Curation is the only brake once publishing is reachable at all.
      AUTO_APPROVE: 'false'
    volumes:
      - ./data/plugins:/data
    networks:
      - notesgraph
```

No `ports:` — reachable only on the docker network.

`./data/plugins` holds `registry.json`, the published bundles and
`signing-key.json`. **Back it up with the rest of `data/`**: losing the signing
key invalidates the signature on every plugin already published.

## 2. Caddy

Reads are public; anything that writes or executes is gated. Order matters —
the gated matchers must come before the catch-all.

`route` rather than `handle`, because it evaluates in written order — which is
what makes "gated first, public second, refuse the rest" mean what it reads
like.

```caddy
  route /market/* {
    # 1. Writes and code execution: signed-in callers only. forward_auth asks
    # the app's own /api/auth/check, which answers 204 when the request carries
    # a valid session (cookie, JWT or PAT) and 401 when it does not.
    # /api/auth/session is NOT usable here — it is public and answers 200 with
    # an empty user when signed out, so every anonymous request would pass.
    @market_write path /market/publish /market/admin/* /market/p/*
    forward_auth @market_write notesgraph:3010 {
      uri /api/auth/check
      copy_headers Cookie Authorization
    }

    # 2. Refuse any other method outright, so a write can never fall through to
    # the public branch below if the matcher above is ever edited — the sidecar
    # treats every POST as a mutation.
    @market_other_write not method GET HEAD OPTIONS
    respond @market_other_write "method not allowed" 405

    # 3. Public: /plugins, /plugins/:id, /download/*, /pubkey, /health. These
    # have to be open — plugin code is loaded with a dynamic import(), which
    # cannot authenticate cross-origin, so gating downloads would lock out the
    # desktop and Android apps.
    uri strip_prefix /market
    reverse_proxy notesgraph_plugin_server:8099
  }
```

Note that step 1 only *authenticates* the write; it then falls through to the
proxy at the bottom of the route, which is what actually forwards it.

**Validate before reloading** — I have not run this against your Caddyfile:

```bash
docker exec notesgraph_caddy caddy validate --config /etc/caddy/Caddyfile
```

Check the upstream name/port for the app container against the existing
`reverse_proxy` block — this assumes `notesgraph:3010`. Verify the split after
deploying:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://app.notesgraph.com/market/plugins   # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://app.notesgraph.com/market/publish  # 401
```

## Publishing

Publishing goes through the gated route, so a PAT works:

```bash
curl -X POST https://app.notesgraph.com/market/publish \
  -H "Authorization: Bearer $NOTESGRAPH_PAT" \
  -H 'content-type: application/json' \
  -d @plugin.json
```

With `AUTO_APPROVE=false` a submission lands `pending` and stays unlisted until
approved:

```bash
curl -X POST https://app.notesgraph.com/market/admin/<id>/<version>/approve \
  -H "Authorization: Bearer $NOTESGRAPH_PAT"
```

Note that the gate only proves *someone is signed in* — it does not distinguish
an admin from any other user. Until the sidecar learns who the caller is,
anyone with an account can publish and approve.

## Why reads are public: desktop and mobile

Plugin code is loaded with a dynamic `import()`, which cannot carry an
`Authorization` header and sends cookies only same-origin. The web app is
same-origin with `/market/*`, so a gate there would be invisible to it — but
the desktop and Android apps authenticate with a JWT header against a different
origin, and would simply fail to load any plugin. Public reads are what keep
them working.

The client side matches: `PluginMarketplaceService` deliberately does **not**
send `credentials: 'include'`, because the sidecar answers with
`Access-Control-Allow-Origin: *` and browsers refuse to pair a wildcard origin
with a credentialed request.

If reads ever need gating, the fix is short-lived signed download URLs, not a
`forward_auth` on the download path.
