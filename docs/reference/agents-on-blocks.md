# Agents on Blocks

A registry of named agents — personal or workspace-shared — that a reader runs against a
single block, a selection, or a whole note.

Status: **design**. Phase 1 scope: **web only**, **read-only tools**.

Rendered version of this note (private): https://claude.ai/code/artifact/a77d01e4-1193-449d-bf7c-59f2ccdbef69

---

## 1. The substrate already exists

This is mostly wiring. The notable find is the execution engine: a complete agentic tool
loop is implemented in Rust, covered by tests, and wired to no product feature.

| Piece | Where | State |
| --- | --- | --- |
| Agentic tool loop — `llmDispatchToolLoopStream`, `maxSteps`, `llmCompileExecutionPlan` | `packages/backend/server/src/native.ts:1558` | implemented, **unused** |
| 15 MCP tools over docs, blocks, tasks, boards, links | `packages/backend/server/src/plugins/copilot/mcp/provider.ts` | shipped |
| Block-targeted action surface — `actionToHandler`, `getSelectedTextContent`, AI panel with accept/discard/regenerate | `packages/frontend/core/src/blocksuite/ai/actions` | shipped |
| Backend split (cloud vs in-browser LLM) selected by `AiBackendService.backend$` | `packages/frontend/core/src/modules/ai-local` | shipped |
| Yjs-backed ORM that syncs — `folders`, `projects`, `virtualViews`, `comments`, … | `packages/frontend/core/src/modules/db/schema/schema.ts` | shipped |
| Task semantics — `todoStatus`, `orgStatus`, tags, props, `todoTrail`, deadlines — indexed | indexer + `packages/common/reader` | shipped |

## 2. Storage: personal and shared, side by side

An `agents` table of **identical shape goes into both schemas**:

- `NotesGraph_WORKSPACE_DB_SCHEMA` → shared with collaborators
- `NotesGraph_WORKSPACE_USERDATA_DB_SCHEMA` → private, syncs to that user's devices

Which table a row sits in **is** its scope. No `scope` column that can drift out of sync
with where the data actually lives, and it follows the ORM's own grain (`WorkspaceDBService`
already exposes `db` and `userdataDB$` side by side — see `modules/db/services/db.ts:103`).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | primary key | defaults to `nanoid`, as elsewhere in the schema |
| `name` | string | shown in menus — "Break into subtasks" |
| `emoji` | string? | menu icon; `explorerIcon` already stores icons this way |
| `instructions` | string | the system prompt, authored by the reader |
| `model` | string? | unset falls through to `AIModelService` |
| `tools` | string[] | allowlist; read-only names only in phase 1 |
| `targets` | string[] | `block` / `selection` / `doc` — drives `showWhen` |
| `output` | string | `panel` in phase 1 |
| `maxSteps` | number | tool-loop budget, default 8 |
| `enabled` | boolean | hides from menus without deleting |
| `createdAt` / `createdBy` | number / string? | author attribution on shared agents |

`AgentsService` merges both tables into one list, tagging each row with the scope it came
from. Promoting a personal agent to the workspace is a row copy across schemas — no
migration, and the original can stay as a draft.

**Runs go in userdata only.** Run records are per-person and high-volume, and a tool-call
transcript in the shared Yjs document would permanently grow something every collaborator
syncs. Keep the record small (`agentId`, target, status, `startedAt`, `durationMs`,
`steps`, `error`, short summary) and ring-prune it. Full transcripts belong in a blob if
wanted at all.

## 3. One target shape for every entry point

```ts
type AgentTarget =
  | { kind: 'block';     docId: string; blockId: string }
  | { kind: 'selection'; docId: string; blockIds: string[] }
  | { kind: 'doc';       docId: string };
```

Context assembly reuses what the editor and indexer already produce:

- **Block** — its text, plus `orgStatus`, tags, inline props and the `todoTrail` ancestor
  breadcrumb, so a nested task arrives with the heading it lives under.
- **Selection** — the same, concatenated in document order.
- **Doc** — title and markdown via the existing adapter, optionally widened with
  embedding-matched chunks from `DocEmbedder`.

## 4. Executor: one interface, two implementations

Mirrors the split chat already uses (`createAIRequestService` vs
`createLocalAIRequestService`, chosen by the same signal), so there's no new pattern.

```ts
interface AgentExecutor {
  run(agent: Agent, target: AgentTarget, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

type AgentEvent =
  | { type: 'step';  index: number }
  | { type: 'tool';  name: string; args: unknown }
  | { type: 'text';  delta: string }
  | { type: 'done';  output: string }
  | { type: 'error'; message: string };
```

- **Local** — loop runs in the tab against `LocalLLMService`, calling MCP tools over GraphQL.
- **Server** — `llmDispatchToolLoopStream` behind an SSE endpoint, tools bound to the MCP
  implementations. Survives navigation and reaches mobile. **Phase 3.**

Why local first: this server advertises `Comment`, `Indexer`, `LocalWorkspace`,
`CopilotEmbedding` — no `Copilot`. A server-first design would ship dead on arrival here.

## 5. Tools: nine now, six later

An agent's allowlist is **intersected** with the workspace's existing MCP read/write
toggles, so a workspace with writes off cannot be overridden by an agent definition.

Phase 1 (read): `read_document`, `list_blocks`, `list_documents`, `semantic_search`,
`keyword_search`, `search_blocks`, `get_board`, `get_backlinks`, `get_links`.

Deferred (write): `create_document`, `link_document`, `update_document`,
`update_document_meta`, `update_block`, `update_task`.

Read-only is the honest starting posture: a loop that can only look costs a wasted run when
it misbehaves; one that can write costs a corrupted note that syncs everywhere before anyone
notices.

## 6. Where a reader starts a run

- **A block** — an `Agents ▸` group in the format bar and slash menu, built with the existing
  `AIItemGroupConfig` so agents sit beside the built-in AI actions; plus the drag-handle menu.
- **A note** — the doc header `…` menu, and an **Agents** tab in the right side panel listing
  agents with this doc's recent runs underneath.
- **A task** — task-shaped agents surface only on list blocks carrying an `orgStatus`.

`targets` drives `showWhen`, so a doc-scoped agent never appears on a text selection.

## 7. Output, budget, stopping

Phase 1 has one output mode: **preview in the AI panel**, reusing its accept/discard/
regenerate flow. Nothing an agent produces reaches a document without someone pressing
accept — which is what makes read-only phase 1 genuinely safe rather than nominally safe.

- `maxSteps` caps the loop; a wall-clock cap catches a model that stalls without consuming steps.
- One run per target at a time, keyed on `docId:blockId`.
- Cancel is a visible control wired to the `AbortSignal` the executor already takes.
- Every terminal state writes a run record — including cancels and errors.

## 8. Phase 1 implementation plan (file level)

Mirrors the `modules/projects` layout exactly (`entities/` + `services/` + `stores/` +
`index.ts` with a `configure*Module` registered in `modules/index.ts`).

### 8.1 Schema — 2 files

- `modules/db/schema/schema.ts` — add `agents` to `NotesGraph_WORKSPACE_DB_SCHEMA` **and**
  to `NotesGraph_WORKSPACE_USERDATA_DB_SCHEMA` (identical shape); add `agentRuns` to the
  userdata schema only.
- No migration needed: the ORM tables are Yjs maps, absent rows simply read as empty.

### 8.2 New module — `modules/agents/` — 6 files

| File | Contents |
| --- | --- |
| `entities/agents.ts` | `Agents` entity: `agents$` LiveData merging workspace + userdata rows, each tagged `scope: 'workspace' \| 'personal'`; `revalidate()` |
| `stores/agents.ts` | `AgentsStore`: CRUD against both tables via `WorkspaceDBService.db` and `.userdataDB$`; `create/update/delete/promote(id)` |
| `stores/agent-runs.ts` | `AgentRunsStore`: append + ring-prune (`MAX_RUNS`), `runsForDoc$(docId)` |
| `services/agents.ts` | `AgentsService`: `agentsFor(target)` filtering on `targets` + `enabled`; `run(agent, target)` |
| `services/executor.ts` | `AgentExecutor` interface, `LocalAgentExecutor`, `createAgentExecutor()` branching on `AiBackendService.backend$` |
| `index.ts` | exports + `configureAgentsModule(framework)` in `WorkspaceScope`, wired like `configureProjectsModule` |

Then one line in `modules/index.ts` to call it.

### 8.3 Context assembly — 1 file

- `modules/agents/services/context.ts` — `buildAgentContext(target): Promise<string>`.
  Block/selection path reads the block models + `orgStatus`/tags/props/`todoTrail`; doc path
  reuses the existing markdown adapter. No new parsing.

### 8.4 Tool binding — 1 file

- `modules/agents/services/tools.ts` — maps the 9 read tool names to GraphQL calls against
  the MCP resolvers, intersected with the workspace read/write toggles. Rejects any name not
  on the phase-1 allowlist, so a hand-edited agent row can't widen its own reach.

### 8.5 Entry points — 3 files

- `blocksuite/ai/entries/format-bar/…` (or a new `agents` entry) — build an `Agents ▸`
  `AIItemGroupConfig` from `agentsFor({kind:'block'|'selection'})`, `showWhen` per `targets`.
- `desktop/pages/workspace/detail-page/detail-page.tsx` — add an `Agents` `ViewSidebarTab`
  (follow the chat tab's lazy pattern: withhold the body until first open).
- `desktop/pages/workspace/detail-page/tabs/agents.tsx` — the panel: agent list, run button,
  recent runs for this doc.

### 8.6 Management UI — 2 files

- `desktop/dialogs/setting/workspace-setting/agents/index.tsx` — list, enable/disable,
  create/edit/duplicate/delete, personal↔workspace toggle.
- `…/agents/agent-editor.tsx` — name, emoji, instructions, model, tool checkboxes, targets,
  `maxSteps`.

### 8.7 Order of work

1. Schema + module skeleton + management UI — agents can be created and listed, nothing runs.
2. Context assembly + local executor with tools stubbed — a run returns text.
3. Tool binding — reads work.
4. Entry points + panel output + run records.

**Prerequisite before step 2:** the AI backend defaults to `cloud` while this server
advertises no `Copilot`, so the local backend has to be pointed at a real model before any
agent can return anything. Worth settling first.

## 9. Decisions taken

| Question | Decision |
| --- | --- |
| Personal or workspace agents? | Both. Two tables of one shape; the table is the scope. Promotion is a row copy. |
| Where do run records live? | Userdata only, ring-pruned. |
| Mobile in phase 1? | No. Web first → local executor first. |
| Can agents write? | Not in phase 1. Read-only tools; output is a preview a person accepts. |

## 10. Open risks

- **No LLM is configured for agents to use.** See the prerequisite above.
- **The Rust tool loop is unproven in production.** Tests cover it; no feature has exercised
  it. Phase 1 avoids depending on it — a deliberate hedge.
- **Workspace-scoped agents are executable content.** A shared agent is a prompt every
  collaborator can run against their own notes. Fine among trusted collaborators; worth
  revisiting before workspaces are shared more widely.
