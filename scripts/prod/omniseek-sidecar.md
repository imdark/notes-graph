# OmniSeek sidecar on prod

The research tools behind the **Research (server)** agent runtime: OmniSeek
(github.com/Battam1111/omniseek), a self-hosted MCP server for cross-lingual
search, reading pages/PDFs/arXiv, and a scholarly citation graph. It has no
model of its own; the agent loop runs in the reader's tab on the server's
copilot model, and each tool call goes through this server's
`/api/workspaces/:id/research/tools/:name` (`plugins/research`), which only
passes on the read-and-search tools.

Like the plugin marketplace sidecar, `compose.yml` and `.env` live only on the
box, so this file is the record. Back both up before editing
(`*.bak-<timestamp>`).

## Exposure

OmniSeek authenticates with a bearer token, but it drives credentialed
sources and must never be reachable from outside. It gets **no published
port** and **no Caddy route**: only the `notesgraph` server talks to it, over
the default compose network.

## Tier

Prod runs the prebuilt **Core** image (keyless search, static sources,
non-PDF reading, lexical memory). The Research tier (PDF, ASR, cross-lingual
vectors, OCR) pulls torch and model weights — several GB the box (2 vCPU,
7.6 GB RAM, ~15 GB disk free) can't spare. `omniseek_view` and
`omniseek_transcribe` therefore aren't offered on the server; the device
**Research (OmniSeek)** harness has the full tier.

## 1. `/opt/notesgraph/compose.yml`

```yaml
  omniseek:
    image: ghcr.io/battam1111/omniseek:latest
    container_name: notesgraph_omniseek
    environment:
      - OMNISEEK_HTTP_HOST=0.0.0.0
    volumes:
      # Token, profile, cache, recall index and curator state.
      - /opt/notesgraph/data/omniseek:/root/.omniseek
    expose:
      - '8765'
    mem_limit: 1g
    restart: unless-stopped
```

## 2. `/opt/notesgraph/.env`

The token is generated on the container's first start into
`/opt/notesgraph/data/omniseek/credentials/omniseek_http.json`:

```
NOTESGRAPH_OMNISEEK_URL=http://omniseek:8765
NOTESGRAPH_OMNISEEK_TOKEN=<token from that file>
```

Unset (or empty) `NOTESGRAPH_OMNISEEK_URL` turns the research API off: the
endpoints 404 and a research run fails with "Research isn't set up on this
server".

## 3. Apply

```sh
docker compose -f /opt/notesgraph/compose.yml --env-file /opt/notesgraph/.env up -d omniseek
curl -s http://$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' notesgraph_omniseek):8765/healthz   # {"ok":true}
docker compose -f /opt/notesgraph/compose.yml --env-file /opt/notesgraph/.env up -d --force-recreate notesgraph
```

Check from the app's side: `GET /api/workspaces/<ws>/research/tools` (signed
in) lists the allowlisted `omniseek_*` tools.

## DeepSeek as the research model

A Cloud or Research (server) agent can run on DeepSeek instead of the
server's copilot: pick **DeepSeek V3** (`deepseek-chat`) or **DeepSeek R1**
(`deepseek-reasoner`) under Harness in Settings → Agents. The tab sends each
step to `/api/workspaces/:id/research/deepseek/chat` (`plugins/research`), and
the server calls DeepSeek with its own key, so the key never reaches a browser.
Add to `/opt/notesgraph/.env` and recreate `notesgraph`:

```
NOTESGRAPH_DEEPSEEK_API_KEY=<key from platform.deepseek.com>
# NOTESGRAPH_DEEPSEEK_URL=https://api.deepseek.com   (the default)
```

Without the key those endpoints 404 and a DeepSeek run fails with "DeepSeek
isn't set up on this server". `GET /api/workspaces/<ws>/research/deepseek`
lists the models once it is set.
