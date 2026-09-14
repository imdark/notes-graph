---
description: Autonomously work the NotesGraph kanban board card-after-card with minimal user input — stops only for genuine product decisions and before a prod deploy
---

# NotesGraph autonomous board worker

You are the agent **@claude**. Work the kanban board as a self-driving loop:
pull the most urgent eligible card, do it on its own branch, verify it, mark it
done, move to the next — **without checking in between cards**. Keep pulling
until no eligible todo remains or you hit a real blocker.

The whole point of this loop is **low input**: don't ask "should I do the next
one?" — just do it. You only surface to the user at three moments:
1. a card needs a genuine **product decision** you can't defensibly make,
2. you're about to **deploy to prod** (outward-facing, confirm first), or
3. the loop is **done** (no eligible cards) — report the run.

## Board coordinates (baked in — no discovery needed)

- Board doc: **`_NYa0NxmRK`**
- Workspace: **`36ad70b7-1cfa-4b3b-ab55-4bd70b61282c`**
- You are **@claude**; agent id for `update_task` notes: `claude-opus-4-8`.

`$ARGUMENTS` may narrow scope (a section like `mobile:` / `notegraph:`, or a
specific card id). If empty, work **`notegraph:` dev cards** — they're the ones
this repo can actually verify and ship.

## The tools (MCP: notesgraph)

- `list_blocks {docId:"_NYa0NxmRK", status:"todo", limit:100}` — the card list.
- `read_document` / `get_links` / `get_backlinks` — context for a card.
- `update_task` — the **only** way to change status/assignee + append a note.
- `update_block` — surgical single-block text edits (only if you must fix card text).

**Never hand-edit card text.** MCP writes render org-mode chips (STARTED/CLOSED
stamps, `@mentions`, `#tags`, `#type:x`); raw edits corrupt the CRDT (caused the
"7 STARTED stamps" and `@claude`→`@clau` bugs). Only `update_task`/`update_block`.

## The loop (repeat until no eligible card)

1. **List** `list_blocks` on the board, status `todo`.
2. **Pick** the most urgent eligible card:
   - Prefer the requested section (default `notegraph:`).
   - **Skip** cards mentioning another agent (`@name` ≠ `@claude`) and `#hold`.
     A card already stamped `@claude` (even if it bounced back to todo) is yours.
   - Prefer **concrete, verifiable** cards over vague ones. Soonest deadline
     first; else oldest first.
   - Watch for **already-done** cards — a complaint we've since fixed (e.g. a
     rebrand/icon/URL leak). Verify the current state; if it's already resolved,
     close it with a note pointing at the commit (don't rebuild it).
3. **Claim** `update_task {status:"in-progress", agent:"claude-opus-4-8"}`. Say in
   one line which card and why.
4. **Branch** `scripts/task-git.sh branch <blockId> <kebab-name>`. One card, one
   branch. Branches **stack** (each off the last) so the newest branch's working
   tree contains every change — that's what makes the single batched deploy easy.
5. **Do the work.** Read context first. Implement.
   - **Reuse the codebase's own first-class abstractions** instead of re-deriving.
     (e.g. identify a journal page via `JournalService.journalDate$` — the marker
     the whole app already uses — not a fresh `YYYY-MM-DD` regex.)
   - **Mildly ambiguous ≠ blocked.** If there's a clearly-beneficial, low-risk
     reading, take it and note your interpretation. Only bounce a card back to
     todo (with a note on what's blocking) when it needs a real **product**
     decision or info you genuinely can't get — then move to the next card.
6. **Verify before done** (never mark done on faith):
   - Types: `scripts/typecheck.sh <pkg>` (e.g. `packages/frontend/core`). Allowlisted.
   - Web (CDP, no interactive MCP): `scripts/debug-local-web-dev.sh up` then
     `… eval '<js>'` / `… shot <out.png>` → Read the shot. See the recipes below.
   - Mobile: `scripts/mobile-emulator.sh up|install|shot` → Read the shot.
   - Rust: `cargo test`.
7. **Commit** `scripts/task-git.sh commit "<what+why>" <paths…>` (appends trailers).
8. **Mark done** `update_task {status:"done", note:"<what shipped + how verified>"}`.
9. **Next card — immediately.** Don't ask. Go to step 1.

## Browser-verify recipes (learned the hard way)

- **Search the code with `rg` / the Grep tool, never `grep -r`** (gitignore-aware,
  skips `node_modules`/`dist`). See CLAUDE.md.
- **Dev server "already up" can be a lie** — it may answer `curl` with `000`. If
  eval fails or a page shows `chrome-error://`, `scripts/debug-local-web-dev.sh
  restart` then `… wait 180`, and confirm `curl -s -o /dev/null -w "%{http_code}"
  http://localhost:8080/` is `200` before trusting it.
- **Wrap eval JS in an IIFE** — the CDP eval context **persists variables between
  calls**, so a bare `const x = …` throws "already declared" on the next call. Use
  `(()=>{ … return JSON.stringify(...); })()`.
- **Navigate with an absolute URL**: `location.assign("http://localhost:8080/…")`
  (relative paths resolved wrong once and wandered off-app).
- **Type into a React input** via the native setter, not `.value=`:
  `const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
  set.call(input,"text"); input.dispatchEvent(new Event("input",{bubbles:true}));`
- **Open the command palette** by dispatching `$mod+K` to `window`:
  `window.dispatchEvent(new KeyboardEvent("keydown",{key:"k",code:"KeyK",metaKey:true,bubbles:true}))`.
  Palette DOM: root `[data-testid=cmdk-quick-search]`, input `[cmdk-input]`,
  groups `[cmdk-group]` / `[cmdk-group-heading]`, items `[cmdk-item]`
  (`[data-testid=cmdk-label]` for the title).
- **Notes sidebar** testids: `navigation-panel-notes-inbox` /
  `navigation-panel-notes-journal`; expand a tree node by clicking its
  `[data-testid=navigation-panel-collapsed-button]` (a node's `.click()` on the
  wrapper doesn't toggle). Tree children render in the node's second child div.

## Deploying (the one checkpoint)

Deploy is outward-facing → **confirm with the user before a prod deploy** unless
they've already said to deploy this run.

**Delay the deploy until you've finished a few cards — never deploy per card.**
A full deploy is ~8–15 min and rebuilds every bundle + a fresh docker image
regardless of how small the change was, so batching several cards into one
deploy is the whole economy. A good rhythm: pull a run of cards, then one deploy.
Because branches stack, the newest branch's working tree already contains every
card's changes — deploy from there (`deploy-prod.sh` rsyncs the working tree,
uncommitted included).

**You can keep working — even pull and finish more cards — while a deploy runs.**
`deploy-prod.sh` rsyncs the tree **once at launch**; after the log reaches
`==> remote build + restart` the build is entirely on the box, so local edits,
commits, and branch switches no longer affect the in-flight deploy. Watch the
milestones with the Monitor and keep going.

- **Never start a second deploy while one is running** — this is the one hard
  concurrency rule. `deploy-prod.sh` holds a flock and a concurrent build OOM'd
  prod once. Wait for `DEPLOY-EXITED`/`DEPLOY-DONE` before launching another.
- Launch detached: `scripts/deploy-bg.sh` (logs `/tmp/notesgraph-deploy.log`).
- Watch via the **Monitor tool** running `scripts/deploy-watch.sh` (streams
  milestones, exits `DEPLOY-EXITED`). The stack only rolls at `DEPLOY-DONE`
  (brief 502 while it boots) — killing the build before then is safe.
- Verify: `curl -s -o /dev/null -w "%{http_code}" https://app.notesgraph.com/` → 200.
- SSH IP allowlist rotates (cellular/CGNAT); the script auto-opens ingress. If AWS
  SSO expired it can't — suggest the user run `! aws login`.
- Mobile ships separately via the `deploy-android-apk` skill.

## Hard rules

- **One command, one operation per Bash call** — don't chain with `&&`/`;`/`&` to
  dodge approvals; wrap recurring multi-step ops in an allowlisted `scripts/*.sh`.
- **Card text only via `update_task`/`update_block`.**
- **Check `git status` before building/deploying** — a parallel session may have
  dirtied the tree. Never `git checkout -- .` to "clean up" (clobbered 6332 files
  once). Reset only what you own.
- **`setsid` isn't on macOS** — background via `nohup`+`disown` (the scripts do).

## Finishing

When no eligible todo remains, stop and report: cards completed (with branches),
any bounced back to todo and why, and — if you deployed — the verification result.
To keep the loop running across turns with no prompting, drive it with `/loop`
(or schedule a wakeup); each wake re-enters this file and pulls the next card.
