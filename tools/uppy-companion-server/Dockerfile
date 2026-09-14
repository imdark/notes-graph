# syntax=docker/dockerfile:1.7
#
# Self-contained image for the Uppy Companion relay (Google Drive/Dropbox
# remote-source uploads). Unlike the main notesgraph image, this doesn't
# depend on the rest of the monorepo's hoisted node_modules — its only
# runtime dependency is the published `@uppy/companion` package, so it's
# built from the pre-compiled `dist/` output with a plain `npm install`.
#
# Build from the repo root so `dist/` (produced by `yarn workspace
# @notesgraph/uppy-companion-server run build` — a `tsc` compile, see
# tsconfig.json) is available in the build context:
#   docker build -f tools/uppy-companion-server/Dockerfile -t notesgraph-uppy-companion .

FROM node:22-bookworm-slim
WORKDIR /app

# A minimal, standalone package.json — NOT the repo's own, which carries a
# `workspace:*` devDependency plain `npm install` can't resolve outside the
# yarn workspace. The compiled dist/ has no other runtime dependency.
RUN echo '{"name":"uppy-companion-server-runtime","type":"module","private":true,"dependencies":{"@uppy/companion":"^6.2.2"}}' > package.json && \
  npm install --omit=dev --ignore-scripts

COPY ./tools/uppy-companion-server/dist ./dist

EXPOSE 3020

CMD ["node", "./dist/server.js"]
