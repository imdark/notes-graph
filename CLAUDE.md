# Working in this repo

## One command, one operation

Run each script or meaningful operation as its **own** Bash invocation. Do
**not** bundle several into a single command.

- ❌ chaining unrelated steps: `scripts/foo.sh; scripts/bar.sh`, `a && b && c`
- ❌ mixing a script with other logic: `grep … ; python3 - <<'EOF' … EOF`
- ❌ piping one script's output into another script
- ✅ one call per step: run `scripts/foo.sh`, see the result, then run `scripts/bar.sh`
- ✅ a simple read-only pipe is fine: `grep … | head`, `… | sort | uniq`

Why: bundled commands (especially with `;`, `&&`, background `&`, or inline
`<<EOF` heredocs) trigger extra approval prompts and defeat the per-command
allowlist in `.claude/settings.json`. Keeping each operation separate keeps
the allowlist matching and the loop prompt-free.

If a recurring multi-step operation keeps needing a bundled command, make it a
**script** under `scripts/` and allowlist that one script instead — e.g.
`scripts/task-git.sh` (branch/commit), `scripts/deploy-bg.sh` (detached
deploy), `scripts/add-i18n.mjs` (add an i18n key), `scripts/build-android.sh`.

## Searching the code — use ripgrep

Reach for **ripgrep (`rg`)** or the built-in **Grep tool** (which is ripgrep
under the hood) for code search — **not** `grep -r`. `rg` is far faster on this
monorepo, respects `.gitignore`/`.ignore` (so it skips `node_modules`, `dist`,
build output by default), and has cleaner multiline/glob support.

- ✅ `rg -n "pattern" packages/frontend/core/src` — recursive, gitignore-aware
- ✅ the **Grep tool** — prefer it for exploratory searches; no Bash approval,
  and it won't dump build artifacts at you
- ✅ scope with `-g '!**/dist/**'` / `-g '*.ts'` instead of long `--include`/prune
- ❌ `grep -rn … .` — slow here, walks `node_modules`/`dist`, noisy

`grep` is still allowlisted and fine for a quick read-only pipe on a file or a
command's output (`… | grep foo | head`); just don't use it as the _recursive
codebase search_ tool — that's `rg`'s job.

## Typechecking

**Always typecheck with `scripts/typecheck.sh <dir-or-tsconfig>`** — e.g.
`scripts/typecheck.sh packages/frontend/core`. It runs `tsc --noEmit` and prints
a clean pass/fail + error count, and it's allowlisted. Do **not** run raw
`npx tsc --noEmit … | tee … | grep 'error TS'`: the pipe defeats the allowlist
and triggers an approval prompt every time.

`scripts/typecheck.sh --changed <dir>` fails only on errors in files the
branch changed. Main carries a few errors of its own (e.g. one in
`quicksearch/services/cmdk.ts`), so judge a branch by `--changed`.

## Working in a git worktree

Run `scripts/worktree-setup.sh` once in a fresh worktree (`wf start` does it
when it creates one). Do **not** symlink main's `node_modules` into the
worktree: workspace packages then resolve to main's sources, so vitest tests
main's `@notesgraph/plugin-sdk`, tsc reports main's blocksuite exports, and
`yarn notesgraph server genconfig` writes into main. The script gives every
`node_modules` (root, `tools/agent-runner`, `packages/backend/server`, ...) its
own directory with third-party packages linked to main and workspace packages
pointing at the worktree. It also links main's built native addon and the
generated edgeless templates, and copies the Android `local.properties` and
`google-services.json`.

- Run vitest from the repo root, e.g. `npx vitest run tools/agent-runner`;
  the root config holds the setup files and aliases.
- The first `scripts/typecheck.sh` builds the referenced projects' `dist`
  (about a minute for core). Use `--changed`.
- The native addon is main's build: rebuild it in the worktree if the branch
  changes Rust code.

## Other allowlisted verify/loop scripts

- `scripts/debug-local-web-dev.sh` — local web dev server + a scripted debug
  Chrome (`up`/`inspect`/`eval`/`type`/`shot`) for CDP verification without the
  interactive MCP.
- `scripts/check-syntax.sh` — quick syntax check.
- `scripts/deploy-watch.sh` — stream deploy milestones (use with the Monitor tool).
- `scripts/mobile-emulator.sh` — Android emulator up/install/shot.

Prefer these allowlisted scripts over ad-hoc piped commands so the loop stays
prompt-free.

## Adding a feature flag

New features ship behind a flag in
`packages/frontend/core/src/modules/feature-flag/constant.ts`, and every flag
carries the commit that added it (`commit`), which the Deployments screen and
the Feature flags page check against prod's build.

1. Add the flag with `commit: ''`, and commit it.
2. Run `node scripts/stamp-feature-flags.mjs`; it fills in that commit. Commit
   the stamp.

`constant.spec.ts` fails on a flag with no commit. Merge with a merge commit
(as `gh pr merge --merge` does) so the hash survives onto main.
