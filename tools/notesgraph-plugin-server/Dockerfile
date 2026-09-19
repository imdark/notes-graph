# Plugin marketplace sidecar: the registry the app's Plugins tab browses, plus
# publish/download and the per-plugin FaaS entrypoint. Built from the repo root
# as context.
#
#   docker build -t notesgraph-plugin-server:prod \
#     -f tools/notesgraph-plugin-server/Dockerfile .
#
# Same shape as the link-card sidecar: a *focused* install of just this
# workspace's deps, then esbuild the TS entry to a single .mjs, so the runtime
# needs neither yarn, the `r` runner, nor tsx — just node.
#
# NOTE ON EXPOSURE: this service has no authentication of its own. /publish,
# /admin/* and /p/* (which executes plugin server code) are open to anyone who
# can reach the port, and submissions are auto-signed with the registry key.
# It must sit on the docker network only, with the proxy in front gating access
# — see the Caddy `/market/*` block, which forward_auths to /api/auth/check.
FROM node:20-bookworm-slim

WORKDIR /app
COPY . .

RUN corepack enable \
 && yarn workspaces focus @notesgraph/plugin-server \
 && npx --yes esbuild tools/notesgraph-plugin-server/src/server.ts \
      --bundle --platform=node --format=esm --target=node20 \
      --outfile=/app/plugin-server.mjs \
 && yarn cache clean

# The registry, the published bundles and the signing key all live under
# PLUGIN_DATA_DIR. It MUST be a mounted volume: losing signing-key.json
# invalidates the signature on every plugin already published.
ENV PORT=8099 \
    PLUGIN_DATA_DIR=/data

# Seed folder for first-party plugins, baked into the image so a fresh volume
# still lists them on first boot.
ENV PLUGIN_SEED_DIR=/app/tools/plugin-template

VOLUME ["/data"]
EXPOSE 8099
CMD ["node", "/app/plugin-server.mjs"]
