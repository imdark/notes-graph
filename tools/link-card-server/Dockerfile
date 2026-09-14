# Link-card sidecar image: bookmark cards + Playwright/WebKit screenshots +
# crawler proxies (RSS/YouTube/IMAP). Built from the repo root as context.
#
#   docker build -t notesgraph-linkcard:prod -f tools/link-card-server/Dockerfile .
#
# Base is the Playwright image so WebKit + its OS deps ship preinstalled and the
# browser build matches the `playwright` npm version. We do a *focused* install
# (only this workspace's deps, built for the image's Node ABI) and bundle the TS
# entry to a single .mjs, so runtime needs neither yarn, the `r` runner, nor tsx —
# just `node`. Native/browser deps stay external and resolve from node_modules.
FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app
COPY . .

RUN corepack enable \
 && yarn workspaces focus @notesgraph/link-card-server \
 && ./node_modules/.bin/playwright install webkit \
 && npx --yes esbuild tools/link-card-server/src/server.ts \
      --bundle --platform=node --format=esm --target=node20 \
      --external:sharp --external:@resvg/resvg-js --external:playwright --external:imapflow \
      --outfile=/app/linkcard-server.mjs \
 && yarn cache clean

ENV PORT=8088 \
    LINK_CARD_BASE_URL=https://app.notesgraph.com \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 8088
CMD ["node", "/app/linkcard-server.mjs"]
