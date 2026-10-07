# ruflo: what's worth taking for NotesGraph and workflow

Research for PERSONAL-79, 2026-10-06. Source: https://github.com/ruvnet/ruflo (formerly
Claude Flow; MIT, TypeScript, ~74k stars) and the READMEs of its `ruflo-autopilot`,
`ruflo-goals`, `ruflo-cost-tracker`, `ruflo-console` and `ruflo-loop-workers` plugins.

## What ruflo is

An orchestration layer around Claude Code and Codex: ~100 agent definitions, ~300 MCP tools,
27 hooks, a daemon with 12 background workers, a vector memory (AgentDB + HNSW), "swarms"
with consensus protocols, cross-machine agent federation, and ~35 Claude Code plugins. Its
README is upfront that many numbers are its own claims and that the console's animations
use sample data.

Most of it overlaps with what NotesGraph and workflow already do (agent runs on blocks,
board loops, `wf agent serve`, embeddings). A few ideas are small, concrete, and fill gaps
we actually have.

## Worth taking (ranked)

### 1. Cost per run, with a cap and a budget ladder

ruflo's `cost-tracker` reads Claude Code's session logs and attributes tokens and USD per
agent, task and model. Budgets alert at 50 / 75 / 90 % and hard-stop at 100 %; deep
research runs take a `--cap-usd` (default $2) and are marked `truncated` when they hit it.

**Gap here:** neither NotesGraph agent runs nor `wf agent serve` record cost
(`rg total_cost` finds nothing in `packages/`). Claude Code's `stream-json` result line
already carries `total_cost_usd`.

**Proposal:** the runner reports `costUsd` and token counts with the run's final status; the
run record and the runs view show it; an agent row gets an optional `maxCostUsd` passed to
`claude --max-budget-usd`; a workspace monthly budget shows the 50/75/90/100 ladder in the
runs view and blocks new runs at 100 % until raised.

### 2. Permission levels instead of a raw tool list

ruflo's console gives Claude one of four levels — `read`, `write`, `manage`, `full` — plus an
approval mode, `ask` or `auto` (default `read` + `ask`). Actions above the level are refused.
Network, spending and destructive actions **always** ask, whatever the mode. "Take back
control" revokes access at once.

**Gap here:** agents have a `tools` allowlist and runs have "Allow all". That's precise but
hard to set from a phone. This is also the answer to the sibling task "how would they build a
read-only agent or limited write permissions via configuration".

**Proposal:** add a `level` field to agents that expands to a tool allowlist
(`read` = search/read tools; `write` = + `update_task`/`update_block`; `manage` =
+ create/link/update_document; `full` = + Bash/Edit on device runners). Keep `tools` as an
override. Keep a fixed "always ask" class (git push, deploy, spending, deleting) that
"Allow all" doesn't cover.

### 3. One "Waiting for a yes" inbox across runs

ruflo's "Room" shows the single pending confirmation with a countdown, plus a feed of
everything that was refused or failed (a "blocked" filter).

**Gap here:** questions and permission requests live on each run; the Mac notification and
phone push point to one run at a time.

**Proposal:** a runs-view section listing every run that's waiting on the user (question or
permission), oldest first, answerable in place, plus a "blocked/failed" filter on the run
list.

### 4. A secret guard on agent writes

Every ruflo plugin ships a small guard that refuses a memory write containing a key, token
or password (and SSN-shaped IDs), never echoing the matched value back.

**Gap here:** agents write straight into notes through the MCP tools
(`create_document`, `update_document`, `update_block`, `update_task`). A note is a synced
Yjs doc, so a leaked token ends up in history on every device and collaborator.

**Proposal:** in `plugins/copilot/mcp/provider.ts`, scan the text of write tools for
common secret shapes (AWS keys, `sk-…`, GitHub tokens, PEM blocks, `password=`) and refuse
with "the text looks like it contains a secret; remove it and retry". Cheap and
server-side, so it covers every runner.

### 5. A research agent preset with provenance and consent

`ruflo-goals` deep research: a cost cap and depth (`quick|standard|deep`), fetched text
screened for prompt injection before it's quoted, evidence grading, a source for every
claim, and the record saved **only after the user accepts the report**.

**Fit:** the Work list keeps getting "research X" tasks (ruflo, khoj, agent management
tools). A built-in "Research" agent with these rules (cited claims, a cap, a draft the user
accepts before it's filed into the graph) would make those consistent.

### 6. Goals with milestones and drift checks (later)

`horizon-track` keeps a long-running objective with milestones across sessions and flags
drift. In NotesGraph this would be a note with a milestone task list and a scheduled agent
run that compares progress against it and adds a short note. Worth doing once scheduled
runs exist; not before.

## Already have it, or not worth it

- **Autopilot loops over checklists** — `board-loop` / `board-auto` and the task statuses
  (QUEUED → COMMITTED → MERGED → DEPLOYED) already cover this. ruflo's "learn patterns from
  completed tasks / predict next action" has no evidence of paying off.
- **Swarms, Raft/Byzantine consensus, 100 agent roles** — complexity without a use case here;
  one agent per task plus parallel runs is enough.
- **~300 MCP tools** — an anti-pattern for us; our 15 focused tools are easier for a model to
  use correctly.
- **HNSW vector memory, SONA self-learning** — we already embed docs (`DocEmbedder`); their
  own benchmarks show HNSW ties or loses at our sizes.
- **Federation (mTLS, PII redaction, trust scores)** — no multi-org agent traffic to protect.
- **Multi-provider routing** — `AiBackendService` already picks cloud vs local.
- **Headless console drive with `--expect`** — nice CI pattern (a real headless Claude drives
  the UI through tools and asserts on output, hard-capped at $0.40), but
  `scripts/debug-local-web-dev.sh` already covers our verification loop.
