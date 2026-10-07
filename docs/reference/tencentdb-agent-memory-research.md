# TencentDB Agent Memory: ideas for NotesGraph and workflow

Source: <https://github.com/TencentCloud/TencentDB-Agent-Memory> (MIT, v2.0.0).
Researched 2026-10-06 from the README and the MemoryCore, MemoryProxy and
OpenClaw-plugin docs. Not run locally.

## What it is

A shared, self-hosted memory hub for teams of coding agents. One script starts
three Node services:

- **MemoryProxy (:8096)** is a transparent LLM proxy. Point Claude Code or
  Codex's base URL at it. On every request it runs session init (a
  team → agent → task form on the first turn), memory injection, write-back
  after each turn, auth, rate limits and usage reporting. No MCP or hooks
  needed.
- **MemoryCore (:8420)** stores everything in SQLite and local files and runs
  an async extraction pipeline over four memory layers:
  - **L0** is the raw conversation.
  - **L1** holds "atoms": extracted facts and constraints.
  - **L2** holds "scenarios": project-level context blocks kept as Markdown
    files, each with a heat score.
  - **L3** is a persona/core profile.

  Retrieval is BM25 + vector + RRF. It works without embeddings and is
  limited by item count, character budget and timeout.
- **Skills** are reusable workflows extracted from conversations and tool
  calls. Each has a version, resources, trigger boundaries, steps and
  validation rules.
- **MemoryKnowledge** provides a Karpathy-style "LLM wiki" and a CodeGraph.
- **Governance:** visibility is `private`, `team`, `restricted` or `agent`.
  New memories and skills are **private by default**. Every asset has a
  version, a status and a usage count.
- **Cold start:** it imports repos, docs and past agent sessions.
- **Benchmark:** PersonaMem accuracy went from 48% to 76%.

### The design idea worth taking

Each memory layer has a fixed place in the prompt:

| Layer | Size | How the model gets it |
| --- | --- | --- |
| L2 scenarios, L3 profile | small, stable | injected into the system prompt |
| L0 conversations, L1 facts | large, query-specific | read-only tools the model calls when it needs them |

The prompt prefix stays stable, which keeps the upstream KV cache valid, and
context stays small. The injected persona ends with a short "Scene Navigation"
list (path, heat, one-line summary), so the model knows which scenario file to
open. Credentials never appear in the prompt: tool calls go through a bridge
that adds the service token on the way out.

## What we already have

- **workflow:** `wf proxy` is the same transparent-proxy idea. It covers
  Anthropic, OpenAI chat and Responses, de-dups history and scopes sessions to
  the active task. Its session → facts → rollup ladder matches L0 → L1 → L2.
  It publishes conversations to NotesGraph.
- **NotesGraph:** an "Agent memory" note (a hand-kept L3), keyword search and
  semantic search as separate tools, agent runs split between userdata and the
  workspace, and boards.

**The gap is recall.** `build_context()` in `workflow/ai_context.py` injects
only the task's append-only `summary.md`:

- The facts and rollup the ladder produces are never fed back.
- `wf mem search` isn't available to the agent as a tool.
- Every task prompt has a "PROJECT CONTEXT: ask the RAG system" paragraph that
  points at a tool the agent doesn't have.

## Ideas worth taking (ranked)

1. **workflow: close the recall loop with the inject/toolize split.**
   - Inject the task rollup and its facts, plus a short project rollup, into
     `build_context()` in place of the raw `summary.md` log. Keep this block
     stable for the whole session.
   - Expose `wf mem search` (L0) and a facts search as tools in the wf-tools
     MCP server, and replace the "ask the RAG system" paragraph with a
     one-line guide to them.
   - Wrap the injected block in `<wf-memory>`. `proxy/sanitize.py` already
     strips that tag, so the ladder never re-learns its own output.
2. **NotesGraph: hybrid `search` with RRF.** Run keyword and semantic search
   together and fuse the results with reciprocal rank fusion, with an
   item-count and character budget. Agents currently have to guess which tool
   to call, and they often call both.
3. **NotesGraph: layered Agent memory with "scene navigation".**
   - "Agent memory" stays the short L3 profile and is injected at the start of
     every run.
   - Topic detail moves into linked child notes (L2), each with a one-line
     summary and a use count shown in the parent.
   - Agents read the index and open only the child notes they need.
4. **Skill extraction with trigger boundaries.** When the ladder sees a
   procedure repeated across sessions, it proposes a skill: when to use it,
   when not to, steps, and how to verify. The proposal starts as a draft note.
   Once the user promotes it, it is exported to a `SKILL.md` and keeps a
   version and a usage count. This is the same idea as OpenKB's Skill Factory,
   so build it once.
5. **Private by default for memory that agents write.** Facts from runs go to
   userdata until the user shares them. This matters once workspaces have
   collaborators.
6. **Usage counts on memory notes and skills.** These rank recall (idea 3) and
   flag unused entries for a notes health check.
7. **Cold-start import (`wf mem import`).** Seed facts and rollups once from
   existing Claude Code transcripts and the published conversation notes.

## Skip

- **CodeGraph.** Claude Code's own search is enough.
- **The SaaS machinery:** team/role/ACL admin, billing, rate limits,
  ClickHouse/Langfuse reporting and MemoryPanel.
- **Running their stack.** It's a second Node proxy that overlaps `wf proxy`.

## Suggested next step

Start with idea 1. It's a change to `ai_context.py` plus two MCP tools, and it
makes the ladder's output useful. Then idea 2.
