---
description: Work the NotesGraph kanban board in a loop until no eligible todo cards remain
---

# NotesGraph board loop

You are the agent **@claude**. Work the NotesGraph kanban board as a loop:
claim the most urgent unclaimed todo, do it on its own branch, verify it,
mark it done, and move to the next — until no eligible cards remain.

$ARGUMENTS may name a board, a doc/block URL, or a section (e.g. "mobile:").
If empty, default to the board found via the discovery step below and work the
**`mobile:`** section first.

## The tools (MCP: notesgraph)

- `keyword_search` — find the board doc (search `"notesgraph"` or the name given).
- `get_board` — read the board's query scopes / columns.
- `list_blocks` — list cards. Scope by the board; fallback scope `{tags:["notesgraph"]}`.
- `read_document` / `get_links` / `get_backlinks` — pull context for a card.
- `update_task` — the ONLY way to change a card's status/assignee/section.
- `update_block` — surgical single-block text edits (for fixing card text safely).

**Never edit task text by any other means.** MCP writes render org-mode chips
(status `[ ]/[-]/[X]`, STARTED/CLOSED stamps, #tags, @mentions, #type:x) — hand
edits or raw text corrupt the CRDT (this caused the "7 STARTED stamps" and
`@claude`→`@clau` bugs). Only `update_task` / `update_block`.

## The loop

1. **Discover.** `keyword_search "notesgraph"` → `get_board` → `list_blocks` with
   the board scope, status `todo`. If that's empty, retry with `{tags:["notesgraph"]}`.
2. **Pick the most urgent** eligible card:
   - Work the requested section first (default `mobile:`).
   - **Skip** cards claimed by another agent — an `@name` mention that isn't `@claude`.
   - **Skip** anything tagged `#hold`.
   - Among the rest: soonest deadline first; if none have deadlines, oldest first.
   - If nothing is eligible, stop and report — the loop is done.
3. **Claim it.** `update_task` → status in-progress, assignee `@claude`. This writes
   one STARTED stamp. Then say in one line which card you're working and why.
4. **Branch.** `scripts/task-git.sh branch <blockId> <task name>` — creates
   `<blockId>-<kebab-name>`. One card = one branch.
5. **Do the work.** Read context first (`read_document`/`get_links`). Implement.
   - If the card needs a decision or info you can't get: `update_task` back to
     **todo** with a note explaining what's blocking, then go to the next card.
     Don't guess on ambiguous product decisions.
6. **Verify before done** — don't mark done on faith:
   - Web: `scripts/debug-local-web-dev.sh up`, then exercise the change. For a
     scripted browser check without the interactive MCP:
     `scripts/debug-local-web-dev.sh inspect [path]` (launches a dedicated debug
     Chrome), then `… eval '<js>'` (run a DOM assertion, prints JSON) and
     `… shot [out.png] [path]` (screenshot → Read it). Or a playwright spec under
     `tests/notesgraph-local/e2e/`. Restart the dev server (`… restart`) if a
     change isn't reflected — HMR/stale bundles happen.
   - Mobile: build + `scripts/mobile-emulator.sh up`/`install`/`shot`, then Read the
     screenshot. (See the `deploy-android-apk` / `test-mobile-emulator` skills.)
   - Types: `npx tsc --noEmit` on touched packages. Rust: `cargo test`.
7. **Commit.** `scripts/task-git.sh commit "<msg>" [paths...]` — stages the paths
   (or `-A`) and appends the standard trailers. Message: what changed + why.
8. **Mark done.** `update_task` → status done, with a note summarizing what shipped
   (and how it was verified). This writes the CLOSED stamp.
9. **Next card.** Repeat from step 2.

## Deploying

Batch it — deploy once after a run of cards, not per card (a full deploy is ~8–15
min and OOM-risky if overlapped).

- Launch detached: `scripts/deploy-bg.sh` (writes `/tmp/notesgraph-deploy.log`).
- Watch with the Monitor tool running `scripts/deploy-watch.sh` — it streams
  milestones/errors and exits `DEPLOY-EXITED` when the deploy finishes.
- **Never run two deploys at once** — `deploy-prod.sh` holds a flock, and a second
  concurrent build OOM'd prod once. Let one finish before starting the next.
- Verify after: `curl -s -o /dev/null -w "%{http_code}" https://app.notesgraph.com/` → 200.

## Hard rules (learned the hard way)

- **One command, one operation per Bash call.** Don't chain unrelated steps with
  `&&`/`;`/pipelines to dodge approvals — wrap a recurring multi-step op in a script
  and allowlist it (that's what the `scripts/*.sh` above are). A bare `&` on the
  command line forces a special approval; use `deploy-bg.sh` instead.
- **Card text only via `update_task` / `update_block`.** Never hand-edit.
- **`setsid` isn't on macOS** — scripts that background must fall back to
  `nohup`+`disown` (deploy-bg.sh / debug-local-web-dev.sh already do).
- **Check `git status` before building/deploying** — a parallel session may have
  left the tree dirty; don't `git checkout -- .` to "clean up" (it clobbered 6332
  files once). Reset only what you know you own.
- **Don't touch another agent's card** (`@name` ≠ `@claude`) or a `#hold` card.

## Finishing

When no eligible todo cards remain, stop the loop and report: which cards you
completed (with branches), which you scoped back to todo and why, and whether a
deploy went out + its verification result.
