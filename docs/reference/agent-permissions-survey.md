# Read-only and limited-write agents: how other tools configure it

A survey of how agent tools let you make an agent read-only or give it
limited write access through configuration, and what NotesGraph could borrow.

Status: **research** (2026-10-06). Companion to [Agents on Blocks](./agents-on-blocks.md).

---

## 1. The short version

Nearly every tool uses the same four layers, from coarsest to finest:

1. **Which tools the model can see at all.** A per-agent allowlist or denylist.
   A hidden tool cannot be called, and the model doesn't waste turns trying it.
2. **A named mode or profile** that bundles a policy: `plan` / `read-only` /
   `chat only` / `ask`. One switch, easy to understand.
3. **Per-call rules with argument matchers**: allow / ask / deny on a tool
   *plus* a pattern on its input (a path glob, a command prefix, a regex).
   This is where "limited write" lives: *can edit `*.md`*, *can run `git status`
   but not `git push`*.
4. **An enforcement boundary below the model**: an OS sandbox, a scoped token,
   or a server that drops write tools from its own tool list. This is the only
   layer that holds if the model or the client gets confused.

On top of that, everyone has a **human approval** path for the gray zone
(`ask`), and the serious ones make **deny win over everything** and stop a
repo-level config from raising its own permissions.

## 2. Tool by tool

### Claude Code / Claude Agent SDK

- **Subagent frontmatter** (`.claude/agents/*.md`): `tools:` allowlist,
  `disallowedTools:` denylist, `permissionMode:`. The built-in `Explore` agent
  is the reference read-only agent: every tool except Edit/Write/NotebookEdit.
- **`settings.json` permissions**: `allow` / `ask` / `deny` arrays with
  specifiers, e.g. `Bash(npm run test:*)`, `Edit(docs/**)`, `Read(./.env)`.
  Deny wins in every mode, including `bypassPermissions`. A `Read` deny on a
  path also blocks Edit/Write there.
- **Modes**: `default`, `acceptEdits`, `plan` (reads and read-only commands,
  no edits), `dontAsk`, `bypassPermissions`.
- **Layered scopes**: managed (org) > CLI flags > local > project > user.
  A project's `.claude/settings.json` can't switch itself to bypass.
- **Escape hatches**: `PreToolUse` hooks (a script decides per call) and
  `canUseTool` in the SDK (a callback decides per call), plus an OS sandbox
  for Bash (filesystem and network allowlists).

### OpenAI Codex CLI

Two independent knobs in `~/.codex/config.toml`:

- `sandbox_mode`: `read-only` | `workspace-write` | `danger-full-access`,
  enforced by the OS (Seatbelt on macOS, Landlock + seccomp on Linux).
  `workspace-write` takes `writable_roots` and `network_access`.
- `approval_policy`: when to ask (`untrusted`, `on-request`, `never`, …).

Saved as **profiles** (`codex --profile review`). The key idea: *approval
never grants what the sandbox lacks*. "Never ask" plus "read-only" is a safe,
fully autonomous reviewer.

### Gemini CLI: policy engine

TOML rules in `~/.gemini/policies`, each rule being
`toolName` + optional `commandPrefix` / `commandRegex` / `argsPattern` +
`decision = allow | deny | ask_user` + `priority`, optionally scoped to
`modes` (plan, autoEdit, yolo) and `interactive = true|false`. Tiers:
Admin > User > Workspace > Extension > Default. Built-in **plan mode** is just
a policy file: deny `*` at a priority, then allow the read tools above it.
In headless runs, `ask_user` resolves to a configurable default (deny).

### Roo Code (and Cline): modes with tool groups

A custom mode lists `groups`: `read`, `edit`, `command`, `mcp` (`browser`).
Limited write is a tuple:

```json
"groups": ["read", ["edit", { "fileRegex": "\\.md$", "description": "Markdown only" }]]
```

The built-in Architect mode is exactly this: read everything, edit only
`.md`, no commands. Project `.roomodes` overrides global modes. Cline has the
simpler Plan / Act split plus per-category auto-approve checkboxes.

### GitHub Copilot custom agents

`.github/agents/*.agent.md` frontmatter `tools:` with aliases `read`,
`search`, `edit`, `execute`, `agent`, plus MCP tool names. Omitted means all
tools. A read-only agent is `tools: ['read', 'search']`. The cloud coding
agent also runs with a token that can only push to its own `copilot/*`
branch, behind a network firewall allowlist: limited write enforced by
credentials, not the prompt.

### GitHub MCP server

`--read-only` / `GITHUB_READ_ONLY=1` (remote: a `/readonly` URL or the
`X-MCP-Readonly` header) **removes write tools from `tools/list`** and
overrides any explicit `--tools` / `--toolsets` request. Toolsets
(`repos,issues,…`) narrow further. This is server-side enforcement: the
client never sees a write tool. (One reported bug: the flag was ignored in
the HTTP transport in v0.31.0, so check `tools/list`, don't trust the flag.)

### Goose

Session modes: Autonomous, Smart Approve, Manual Approve, Chat Only. Per-tool
settings: Always allow / Ask before / Never allow. **Smart Approve reads
the MCP `readOnlyHint` annotation**: tools not marked read-only go to
"ask before" automatically. Subagents are disabled outside autonomous mode.

### OpenAI Agents SDK

- MCP `tool_filter`: `create_static_tool_filter(allowed_tool_names=[…],
  blocked_tool_names=[…])` or a dynamic callable.
- `needs_approval` on function tools (`True` or a per-call predicate), and
  `require_approval={"always": {...}, "never": {...}}` per MCP server. Pending
  calls surface as `interruptions`; the run state is serializable, so a paused
  run can wait for a human and resume later. Malformed arguments fail closed
  (approval required).

### MCP itself: tool annotations

The MCP spec lets a server tag tools with `readOnlyHint`, `destructiveHint`,
`idempotentHint` and `openWorldHint`. These are *hints* (clients must not
trust them from untrusted servers), but they're what lets a client like Goose
build a "read-only" preset without a hand-maintained list.

## 3. Patterns worth copying

| Pattern | Seen in | Why it matters |
| --- | --- | --- |
| Hide, don't just block | GitHub MCP, Copilot `tools:`, Claude `tools:` | The model can't call or keep retrying a tool it never sees. |
| Mode = named policy bundle | Claude `plan`, Codex profiles, Gemini plan.toml, Roo modes, Goose | One choice a person understands ("Read-only", "Can edit notes"). |
| Argument-scoped rules | Claude `Edit(docs/**)`, Roo `fileRegex`, Gemini `argsPattern` | Gives limited write instead of all-or-nothing. |
| Deny always wins; lower layers can't widen | Claude, Gemini tiers, GitHub MCP read-only | An agent definition can't override a workspace or admin "no writes". |
| Enforcement below the model | Codex sandbox, Copilot branch-scoped token, GitHub MCP server-side | Holds even when the client or prompt is wrong. |
| Tool metadata drives defaults | MCP annotations → Goose Smart Approve | New tools get classified automatically. |
| Headless `ask` resolves to a default | Gemini `interactive`, Codex `never` | An unattended run doesn't hang on a prompt nobody will see. |
| Sticky "allow all" scoped to one run | OpenAI `always_approve`, NotesGraph "Allow all" | Cuts prompt fatigue without widening the agent for good. |

## 4. Where NotesGraph is today

- **Device agents** (Claude Code via `wf agent serve`): each job carries the
  agent's `tools` list to the runner. Every other permission becomes a
  question to the person who started the run; "Allow all" sets
  `allowAllTools` on that job only (`plugins/inventory/jobs.ts`). There's no
  named read-only mode and no path/argument scoping on the NotesGraph side.
- **NotesGraph MCP**: write tools are switched on server-wide by an env flag
  (`mcpWriteToolsEnabled`, `plugins/copilot/mcp/provider.ts`), not per agent,
  per workspace or per token. Tools carry no MCP annotations.
- **Agents on Blocks design**: a per-agent `tools` allowlist intersected with
  workspace read/write toggles, with read-only first. That's the "hide" and
  "deny wins" patterns already.

## 5. Suggestions, in order of payoff

1. **Annotate the NotesGraph MCP tools** with `readOnlyHint` /
   `destructiveHint`. It's cheap, and Claude Code, Goose and others can use it
   right away; it also gives NotesGraph one source of truth for "which tools
   are reads".
2. **Agent "access" preset** in the agent editor: *Read-only* · *Can comment /
   append notes* · *Can edit* · *Full*. Each preset expands to a tools
   allowlist (and, for device agents, Claude Code `permissions` +
   `permissionMode`). Read-only maps to `plan` mode with Edit/Write/Bash denied.
3. **Enforce on the server, not just the runner.** Mint the run's MCP token
   with a scope (`read` vs `read+write`) and have the MCP server leave write
   tools out of `tools/list` for a read-scoped token, like GitHub's
   `/readonly`. A device agent then can't write to notes even if its local
   config is wrong.
4. **Argument-scoped write** for the "limited" tier: allow
   `update_task` / `update_block` only on the block or doc the run started
   from (the run's target), and `create_document` only under "Agent memory".
   It's the NotesGraph equivalent of Roo's `fileRegex`.
5. **Deny wins across layers**: workspace setting > agent preset > run-level
   "Allow all". "Allow all" should never widen past the agent's preset.
6. **Headless default**: when nobody can answer (scheduled or queued runs),
   resolve `ask` to deny with a visible note on the run, rather than waiting.

## Sources

- Claude Code: [subagents](https://code.claude.com/docs/en/sub-agents), [permissions](https://code.claude.com/docs/en/permissions), [settings](https://code.claude.com/docs/en/settings)
- Codex: [agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)
- Gemini CLI: [policy engine](https://geminicli.com/docs/reference/policy-engine/), [plan.toml](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/policy/policies/plan.toml)
- Roo Code: [custom modes](https://roocodeinc.github.io/Roo-Code/features/custom-modes/)
- GitHub Copilot: [custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- GitHub MCP server: [repo](https://github.com/github/github-mcp-server), [server configuration](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md), [issue #2156](https://github.com/github/github-mcp-server/issues/2156)
- Goose: [permission modes](https://goose-docs.ai/docs/guides/managing-tools/goose-permissions/)
- OpenAI Agents SDK: [human in the loop](https://github.com/openai/openai-agents-python/blob/main/docs/human_in_the_loop.md), [MCP](https://openai.github.io/openai-agents-python/mcp/)
