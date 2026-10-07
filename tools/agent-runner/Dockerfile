# Cloud agent runner image: runs NotesGraph agent jobs the way `wf agent serve`
# runs them on a Mac (see scripts/prod/agent-runner.md). Built from the repo
# root as context:
#
#   docker build -t notesgraph-agent-runner:prod -f tools/agent-runner/Dockerfile .
#
# Two stages, so the repo (the build context) never reaches the image: the
# entry is bundled to one .mjs from the monorepo, and the runtime gets only
# that plus the Agent SDK (which brings Claude Code's linux binary as an
# optional dependency) and the tools automations shell out to: git, gh,
# curl, python3, and wf (github.com/imdark/workflow), which starts a
# Workflow job as a task.
FROM node:22-slim AS build
WORKDIR /src
COPY . .
RUN corepack enable \
 && yarn workspaces focus @notesgraph/agent-runner \
 && npx --yes esbuild tools/agent-runner/src/main.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --external:@anthropic-ai/claude-agent-sdk \
      --outfile=/agent-runner.mjs

FROM node:22-slim

# The wf the cloud runs, pinned: bump it to ship a wf change (it changes this
# file, so the next deploy rebuilds the image).
ARG WF_REF=474aabe8382a2ee9238c09288ce20f81b05f556c

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git python3 python3-venv \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/* \
 # git over https to GitHub authenticates with GH_TOKEN, through gh.
 && git config --system credential.https://github.com.helper '!gh auth git-credential' \
 && git config --system user.name 'NotesGraph cloud agent' \
 && git config --system user.email 'cloud-agent@notesgraph.com' \
 && python3 -m venv /opt/wf \
 && /opt/wf/bin/pip install --no-cache-dir "git+https://github.com/imdark/workflow@${WF_REF}" \
 && ln -s /opt/wf/bin/wf /usr/local/bin/wf \
 # Jobs run as the image's own unprivileged `node` user (uid 1000).
 && mkdir -p /work && chown node:node /work

WORKDIR /app
# The SDK at the version the bundle was built against, and its peers.
COPY tools/agent-runner/package.json /tmp/runner-package.json
RUN node -e "const d=require('/tmp/runner-package.json').dependencies; \
      console.log(Object.entries(d).map(([n,v])=>n+'@'+v).join(' '))" > /tmp/deps \
 && npm install --omit=dev --no-audit --no-fund --prefix /app $(cat /tmp/deps) \
 && npm cache clean --force \
 && rm /tmp/deps /tmp/runner-package.json
COPY --from=build /agent-runner.mjs /app/agent-runner.mjs

USER node
# HOME is on the work volume: wf's tickets (~/.wf) and Claude's sessions
# outlast the container.
ENV HOME=/work/home \
    RUNNER_WORK_ROOT=/work
CMD ["node", "/app/agent-runner.mjs"]
