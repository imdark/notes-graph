# Cloud agent runner image: runs NotesGraph agent jobs the way `wf agent serve`
# runs them on a Mac (see scripts/prod/agent-runner.md). Built from the repo
# root as context:
#
#   docker build -t notesgraph-agent-runner:prod -f tools/agent-runner/Dockerfile .
#
# A focused install (only this workspace's deps; the Agent SDK brings Claude
# Code's linux binary as an optional dependency), the entry bundled to one
# .mjs, and the tools automations shell out to: git, gh, curl, python3, and
# wf (github.com/imdark/workflow), which starts a Workflow job as a task.
FROM node:22-slim

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
 && /opt/wf/bin/pip install --no-cache-dir "git+https://github.com/imdark/workflow@main" \
 && ln -s /opt/wf/bin/wf /usr/local/bin/wf \
 # Jobs run as the image's own unprivileged `node` user (uid 1000).
 && mkdir -p /work && chown node:node /work

WORKDIR /app
COPY . .

RUN corepack enable \
 && yarn workspaces focus @notesgraph/agent-runner \
 && npx --yes esbuild tools/agent-runner/src/main.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --external:@anthropic-ai/claude-agent-sdk \
      --outfile=/app/agent-runner.mjs \
 && yarn cache clean \
 # Only what runs: the bundle and node_modules (the SDK and Claude Code).
 && find /app -mindepth 1 -maxdepth 1 ! -name node_modules ! -name agent-runner.mjs -exec rm -rf {} +

USER node
# HOME is on the work volume: wf's tickets (~/.wf) and Claude's sessions
# outlast the container.
ENV HOME=/work/home \
    RUNNER_WORK_ROOT=/work
CMD ["node", "/app/agent-runner.mjs"]
