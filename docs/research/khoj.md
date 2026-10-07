# Khoj: features worth borrowing for NotesGraph and workflow

Research for PERSONAL-80, 2026-10-06. Source: <https://github.com/khoj-ai/khoj>
(shallow clone of `master`, docs under `documentation/docs`, server under
`src/khoj`).

Khoj is a self-hostable "AI second brain": Python/Django + FastAPI server,
pgvector for embeddings, clients for web, desktop, Obsidian, Emacs, Android and
WhatsApp. **License: AGPL-3.0** — borrow ideas, do not copy code.

## What Khoj has, and whether NotesGraph already covers it

| Khoj feature | Where in Khoj | NotesGraph today |
| --- | --- | --- |
| RAG chat over notes, `/notes` `/general` `/online` modes | `routers/api_chat.py` | Copilot with `doc-semantic-search`, `doc-keyword-search`, Exa web search |
| Semantic search (bi-encoder + **cross-encoder rerank**, confidence threshold) | `search_type/text_search.py`, docs `features/search.md` | Embedding search, **no rerank**, no threshold |
| **Query filters** in search/chat: `file:"x"`, `dt>="2026-01-01"`, `+"word"`, `-"word"` | `search_filter/`, docs `miscellaneous/query-filters.md` | No structured filters on semantic search |
| **Automatic user memory**: LLM extracts facts after each turn (create/delete), recent + semantic recall injected into prompts, user can list/edit/delete, scoped per agent | `routers/helpers.py: ai_update_memories`, `database/adapters: UserMemoryAdapters`, `routers/api_memories.py` | Only the "Agent memory" note convention in the agent system prompt; nothing automatic |
| Research mode: tool loop capped at `KHOJ_RESEARCH_ITERATIONS` (5), parallel tool calls, dedupes earlier queries, **user can inject new instructions mid-run** | `routers/research.py` | Agent runs (`modules/agents`), OmniSeek research tools, `ask_user` (agent → user only); **no user → agent steering mid-run** |
| Agents: persona + knowledge + model + tools | `routers/api_agents.py` | Agents module (richer: device/cloud runners, deployments, monitors) |
| Automations: cron query, result emailed | `routers/api_automation.py` | Monitors (`kind: 'agent'`, schedule, in-app/push/email alerts) — covered |
| Shareable public snapshot of a conversation | docs `features/share.md` | Doc sharing exists; agent runs / copilot chats not shareable |
| Desktop quick chat: hotkey opens mini chat prefilled with clipboard | docs `features/khoj_mini.md` | Not present in Electron app |
| WhatsApp / phone access (Twilio) | `routers/twilio.py`, `api_phone.py` | Android app + phone push |
| `/diagram` (Mermaid/Excalidraw) | `generate_mermaidjs_diagram` | Mermaid module exists; not exposed as an agent tool |
| Operator (computer/browser use in a container) | `processor/operator/` | Claude Code device runner covers this |
| Code sandbox, image gen, TTS/STT | `processor/tools/run_code.py`, `processor/image`, `processor/speech` | code-artifact, fal provider, voice-tasks — mostly covered |
| MCP client tools in research | `processor/tools/mcp.py` | Copilot MCP provider — covered |

## Recommendations (most value first)

1. **Automatic memory as notes.** After an agent run or copilot chat, a cheap
   model extracts durable facts about the user ("Cosmo is 7") and proposes
   create/delete operations against the existing facts, like Khoj's
   `extract_facts_from_query`. Unlike Khoj's hidden DB table, write them into
   the "Agent memory" notes so the user can see and edit them. Before a run,
   pull recent facts plus the top semantic matches into the prompt. This makes
   the "look in NotesGraph first, ask once, save it" rule automatic instead of
   relying on each agent to follow it. Same idea applies to `wf` task runs.
2. **Steer a running agent.** Khoj drains an interrupt queue each iteration
   and folds new user text into the loop (`research.py` ~L518). NotesGraph
   runs can ask the user but the user can't add an instruction while one runs.
   Add a "send to run" box on the run view that queues a message the runner
   picks up on its next turn (device runner via `wf agent serve`, cloud runner
   via the server).
3. **Query filters for search.** Parse `tag:`, `prop:key:value`, `doc:"title"`,
   `dt>=` / `dt<=` (created/updated), `+"word"` / `-"word"` out of a query
   before the semantic search, and expose them in quicksearch, the
   `doc-semantic-search` copilot tool and the MCP `semantic_search` tool.
   NotesGraph already indexes inline `#tags` and `#key:value` on blocks, so
   this is mostly plumbing.
4. **Rerank and a relevance threshold.** Rerank the top ~30 embedding hits
   with a cross-encoder (or an LLM call) and drop hits past a distance
   threshold, so RAG gets fewer, better passages.
5. **Research-loop hygiene.** Cap iterations, run independent tool calls in
   parallel, and pass previous queries so the model doesn't repeat a search.
   Emit a status line like "Found 6 notes across 3 docs" — cheap and
   reassuring in the run log.
6. **Share a run.** Public read-only snapshot link for an agent run or
   copilot conversation, reusing doc-sharing permissions.
7. **Quick-ask hotkey (desktop).** Global shortcut opens a small copilot
   window prefilled with the clipboard; answer can be inserted into today's
   journal.
8. **Diagram tool.** Expose a "create Mermaid block" tool to copilot/agents,
   since the Mermaid renderer already exists.

Skip: automations (monitors cover it), operator (Claude Code device runner),
extra clients (Obsidian/Emacs/WhatsApp) — low value for this user base.
