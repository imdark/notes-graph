# Cloud agent runner on prod

Runs NotesGraph agent jobs on the server the way `wf agent serve` runs them on
a Mac, so agents keep working with the Mac off. To NotesGraph it is one more
device, **Cloud (server)** (key `cloud`): pick it in an agent's settings, and
its runs queue, log, ask, push to the phone and stop like a Mac's.

- **Code:** `tools/agent-runner`, which claims jobs over the same HTTP API wf
  uses. It runs Claude Code through the Claude Agent SDK, on an Anthropic API
  key.
- **The agent:** the prompt, the pre-approved tools, the MCP servers and the
  **automation** (setup steps, tools, teardown) all come from the server with
  each job (`plugins/inventory/agent-profiles.ts`). The Mac follows the same
  profile.
- **Runs here:**
  - Claude Code agents: notes, web, and code tasks. A code task gets a git
    worktree of `RUNNER_REPO` on a `cloud/<job>` branch, and tools to install,
    test and typecheck.
  - Workflow agents, as wf tasks in the runner's own wf project **CLOUD**
    (markdown backend). `wf agent prepare-task` makes the ticket (`CLOUD-n`),
    branch and worktree, then hands the agent `wf ai`'s prompt and the task's
    skills. Its tickets and branches (`cloud-n-…`) can't collide with a Mac's
    `personal-n` ones. wf's home is `/work/home/.wf`, on the volume.
  - Research agents, with OmniSeek.
- **Mac only:** monitor commands, and agents with no harness picked.

`compose.yml` and `.env` live only on the box, so this file is the record.
Back both up before editing (`*.bak-<timestamp>`).

## Isolation

Agents here run shell commands and edit files, so the runner gets its own
container, holding none of the server's secrets.

- **Network:** it is on the `agents` network with `notesgraph` (the API) and
  `omniseek`. Postgres and redis are not on that network, so it cannot reach
  them.
- **User:** it runs as the non-root `node` user (uid 1000), with memory and process limits.
- **Its secrets are only:**
  - the Anthropic key
  - a NotesGraph token for the user it acts for
  - a GitHub token scoped to the one repo
- **How Claude sees them:** Claude sees the GitHub token, so it can push its
  branch and open a PR. Setup steps and automation tools never see the API key.

## 1. `/opt/notesgraph/compose.yml`

```yaml
  agent-runner:
    image: notesgraph-agent-runner:prod
    container_name: notesgraph_agent_runner
    env_file: .env.agent-runner
    volumes:
      # Job directories, and the repo mirror kept between jobs.
      - /opt/notesgraph/data/agent-runner:/work
    networks: [agents]
    mem_limit: 2g
    pids_limit: 512
    restart: unless-stopped
    depends_on: [notesgraph]
```

Add `agents` to the `networks:` of `notesgraph`, and of `omniseek` (see
`omniseek-sidecar.md`). Both keep `default` too. Declare the network at the
end:

```yaml
networks:
  agents: {}
```

The volume must be writable by the container's `node` user (uid 1000):
`sudo install -d -o 1000 -g 1000 /opt/notesgraph/data/agent-runner`.

## 2. `/opt/notesgraph/.env.agent-runner`

This is a separate env file, so the runner never gets the server's `.env`.
Make it mode 600.

```
RUNNER_NG_URL=http://notesgraph:3010
RUNNER_NG_TOKEN=<NotesGraph access token of the user agents run as>
RUNNER_WORKSPACES=<workspace id>[,<workspace id>…]
ANTHROPIC_API_KEY=<key from console.anthropic.com>
RUNNER_REPO=https://github.com/imdark/notes-graph
GH_TOKEN=<fine-grained token: that repo only, contents + pull requests read/write>
OMNISEEK_URL=http://omniseek:8765
OMNISEEK_TOKEN=<from /opt/notesgraph/data/omniseek/credentials/omniseek_http.json>
# Optional
RUNNER_MAX_JOBS=2
```

## 3. Apply

```sh
cd /opt/notesgraph
docker compose -f compose.yml --env-file .env up -d omniseek agent-runner
docker compose -f compose.yml --env-file .env up -d --force-recreate notesgraph   # joins `agents`
docker logs -f notesgraph_agent_runner   # "serving cloud for 1 workspace(s)"
```

The image is built by each deploy (`redeploy.sh`, "agent runner image"),
and only when `tools/agent-runner` or `yarn.lock` changed.

## Check

- **The device:** "Cloud (server)" appears in an agent's device picker.
- **A run:** a Claude Code agent on it runs with the Mac's runner stopped. Its
  log starts `$ claude … (claude-code, job …, cloud)`.
- **Isolation:** from inside the runner, postgres is unreachable:
  `docker exec notesgraph_agent_runner sh -c 'timeout 3 bash -c "</dev/tcp/postgres/5432"' && echo REACHABLE || echo blocked`

## Disk

Each code task's worktree is removed when it ends, but `install_deps` puts
a few GB of node_modules in it while it runs. With ~11 GB free, keep
`RUNNER_MAX_JOBS` at 2 or below. See `prod-disk-headroom`.
