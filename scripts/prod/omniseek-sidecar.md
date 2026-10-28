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
port** and **no Caddy route**. It is on the `agents` network only, where the
`notesgraph` server and the cloud agent runner (`agent-runner.md`) reach it
as `http://omniseek:8765`.

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
  networks: [agents]
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

## Two places hold the token

The server and the cloud runner each have their own copy of OmniSeek's URL
and token, and each needs it set:

| Who                       | Env file             | Variables                                             |
| ------------------------- | -------------------- | ----------------------------------------------------- |
| `notesgraph` (the server) | `.env`               | `NOTESGRAPH_OMNISEEK_URL`, `NOTESGRAPH_OMNISEEK_TOKEN` |
| `agent-runner`            | `.env.agent-runner`  | `OMNISEEK_URL`, `OMNISEEK_TOKEN`                       |

A research agent whose server has an AI model runs its loop in the tab and
calls OmniSeek **through the server**, not the runner. So a healthy OmniSeek
and a working runner are not enough on their own.

## Troubleshooting: research says OmniSeek is disconnected

Seen 2026-10-28. OmniSeek was healthy and the runner reached it, but `.env`
had no `NOTESGRAPH_OMNISEEK_*` lines, because step 2 had been skipped. The
server's research API was off, so every research run reported OmniSeek as
unavailable.

Check each hop in order:

```sh
# 1. The sidecar is up
docker ps --filter name=omniseek          # "Up … (healthy)"
# 2. The server has the setting (prints the URL and "set"; an empty URL is the bug above)
docker exec notesgraph_server sh -c 'echo "$NOTESGRAPH_OMNISEEK_URL ${NOTESGRAPH_OMNISEEK_TOKEN:+set}"'
# 3. The server's token works: tools/list answers 200
docker exec notesgraph_server node -e 'fetch(process.env.NOTESGRAPH_OMNISEEK_URL+"/mcp",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream",Authorization:"Bearer "+process.env.NOTESGRAPH_OMNISEEK_TOKEN},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list",params:{}})}).then(r=>console.log(r.status))'
# 4. The research API is on: 401 signed out (404 means it is off)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3010/api/workspaces/<ws>/research/tools
```

If step 2 is empty, back up `.env`, then add the two lines from step 2 above
with the token from `credentials/omniseek_http.json`. Then recreate only the
server:
`docker compose -f compose.yml --env-file .env up -d --force-recreate --no-deps notesgraph`.
If step 3 answers 401, the token in `.env` no longer matches the
credentials file, for example after OmniSeek's data directory was reset.
Update `.env` and `.env.agent-runner` both.
