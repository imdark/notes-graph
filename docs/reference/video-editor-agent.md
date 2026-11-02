# Video editor agent (video-use as a NotesGraph plugin)

Edit a video by conversation, from the phone: drop footage in, the agent
transcribes it, proposes a cut, shows previews, and iterates until you say
ship. The editing brain is [browser-use/video-use](https://github.com/browser-use/video-use)
(a Claude Code skill plus ffmpeg/PIL helpers); NotesGraph supplies the agent
runtime, the device that runs it, the conversation surface and the plugin
store listing.

Status: **design** (2026-11-01). Companion to [Agents on Blocks](./agents-on-blocks.md),
[agent-runner](../../scripts/prod/agent-runner.md) and the plugin SDK
(`packages/common/plugin-sdk`).

---

## 1. What exists, and what the survey ruled out

Three agent systems live in the repo. Only one fits an ask → plan → execute →
preview → iterate loop:

| System                                                                                          | Where                                                               | Fit                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Copilot chat + native action recipes                                                            | `plugins/copilot`, `backend/native/src/llm`                         | Linear recipes, 20-step tool loop, no shell. **No.**                                                                  |
| In-tab agent loop (WebLLM / server model)                                                       | `modules/agents/services/executor.ts`                               | Text tool protocol for small models, no shell. **No.**                                                                |
| **Device-registry agent jobs** (Claude Code on a Mac via `wf agent serve`, or the cloud runner) | `plugins/registry`, `tools/agent-runner`, `workflow/deploy/jobs.py` | ask_user with options, steer mid-run, push to phone, 24 h question timeout, per-profile shell tools, skills. **Yes.** |

The plugin system cannot carry the work itself: a plugin's client is
in-process JS (no subprocess, `native.fs` jailed and desktop-only), its
server is an in-process FaaS handler in the marketplace sidecar (no ffmpeg,
single synchronous request), its `storage.blob` is base64 in GlobalState,
and no SDK capability lets a plugin register an agent, profile, skill or
MCP tool. Mobile has no plugin UI at all, but installed plugins do activate
there and the **Agents page on the phone already shows runs, questions and
reviews**.

So the split is:

- **Plugin** = the store listing and the launch UX (create a project note,
  install the Video editor agent, start a run).
- **Agent profile** = the engine: Claude Code with the video-use skill and
  helpers on a device that has ffmpeg, a GPU-class CPU and the footage.
- **Phone** = the control surface: strategy questions, preview approval,
  steering, the final link. Nothing renders on the phone.

Transcription needs no API key any more: `helpers/transcribe_local.py` in the
`local-asr` branch of `~/code/video-use` runs CrisperWhisper (verbatim,
fillers kept, word timestamps) + pyannote (speakers) on Metal and writes the
same JSON as ElevenLabs Scribe. Verified 2026-11-01 on a two-voice clip.
CrisperWhisper's weights are CC BY-NC 4.0: fine for personal videos, swap
the backend for WhisperX/Parakeet before editing anything commercial.

## 2. The loop, as the user sees it

1. On the phone or web, open the plugin's **New video project**. It creates a
   note "Video: <name>" with a _Footage_ section (a folder path on the Mac,
   or uploaded clips in phase 2) and a _Brief_ paragraph to fill in.
2. Start the **Video editor** agent on that note (block menu, or the
   plugin's button). The run is queued for the chosen device.
3. The agent inventories and transcribes the footage, reads the brief, and
   asks shaped questions through `ask_user` with options ("Fast-paced
   social cut / Documentary pace", "Captions: bold overlay / none").
4. It proposes a strategy in plain English and waits. **Hard rule from
   SKILL.md: nothing is cut before the user confirms.**
5. It renders a 720p preview, uploads it with a filmstrip of every cut
   boundary, and asks "Approve / Revise / Try the other take" **with the
   preview attached to the question**. The phone shows the video inline.
6. The user answers or steers ("make the hook shorter"). Repeat 5.
7. On approval it renders `final.mp4`, uploads it, links it under the
   project note, and appends the session to the note's _Edit log_ (the
   skill's `project.md` memory, kept in NotesGraph so the next run continues).

## 3. Architecture

```
 phone / web ──answer, steer──▶ NotesGraph server ◀──claim, report, ask, upload── device runner
   Agents page                   registry jobs                 Claude Code + video-use skill
   question card (video)         question.attachments[]        helpers/*.py, ffmpeg, CrisperWhisper
   project note                  POST jobs/:id/artifacts        {cache}/video-use (venv)
                                 workspace blob storage         footage: Mac folder | downloaded blobs
```

### 3.1 Agent profile `video-editor` (server, `plugins/registry/agent-profiles.ts`)

A fourth entry in `PROFILES`, keyed by the agent's `model`:

- **systemPrompt**: `CLAUDE_CODE_SYSTEM_PROMPT` + a video section: where the
  helpers live, the twelve hard rules from SKILL.md restated as
  non-negotiable, "confirm the strategy with ask_user before cutting", "every
  preview goes out as an attached question", "write the edit log to the note".
- **skills**: `video-use` added to `SKILL_CATALOG`, pointing at the raw
  SKILL.md of the pinned video-use commit. The runner loads it as a plugin
  skill; the helpers come from the setup step below, so the prompt names the
  path (`{cache}/video-use/helpers`).
- **mcpServers**: `notesgraph`, `run`.
- **workdir**: `job` (footage and `edit/` live under the job directory, never
  in the skill repo, per hard rule 12).
- **automation.setup** (idempotent, cached between jobs):
  1. `video-use`: clone or `git pull --ff-only` into `{cache}/video-use`;
     `uv venv .venv --python 3.12`; `uv pip install -e '.[local]'` only when
     `pyproject.toml` changed.
  2. `footage`: resolve the project note's footage into `{job_dir}/footage/`
     (phase 1: a folder path on the device; phase 2: download the note's
     attachment blobs with the runner token).
- **automation.tools** (become `mcp__automation__*`; params via `$ARG_*`):
  `inventory` (ffprobe every source), `transcribe` (local ASR, cached),
  `pack` (`takes_packed.md`), `timeline_view <src> <start> <end>`,
  `render --preview`, `render` (final), `grade`, `upload_artifact <path>`
  (section 3.3). Wrapping the helpers as tools keeps raw `Bash` out of the
  allowlist, so the access levels keep meaning what they mean.
- **allowedTools**: `CLAUDE_CODE_ALLOWED_TOOLS` + `mcp__automation`.
- **toolTimeoutMs**: 24 h (a preview waits for a person).

**Runner support.** The cloud runner already runs profile automations
(`tools/agent-runner/src/automation.ts`). The Mac runner (`wf agent serve`,
`workflow/deploy/jobs.py`) runs _automation jobs_ but **ignores
`profile.automation`**. Phase 1 adds that to wf (setup steps before Claude
starts, an `automation` stdio MCP server exposing the tools, teardown after),
which also brings `install_deps`/`run_tests` parity to Macs. Fallback if wf
can't change in time: allow `Bash({cache}/video-use/.venv/bin/python:*)`,
`Bash(ffmpeg:*)`, `Bash(ffprobe:*)` in the profile for Mac devices.

### 3.2 Previews on the phone: question attachments

Questions carry only text today (`RegistryJobQuestion`: kind, text, detail,
options). Add:

- Prisma: `attachments String[] @default([])` on `RegistryJobQuestion`
  (blob keys), and `kind` gains `'preview'` (a question whose first
  attachment is the thing being approved).
- `POST /api/registry/workspaces/:ws/jobs/:jobId/artifacts` (multipart,
  runner token): streams the file into workspace blob storage via
  `core/storage/wrappers/blob.ts` (presign/multipart already exist), records
  it on the job (`RegistryJobArtifact`: jobId, key, name, mime, bytes,
  createdAt), returns the key. Served by the existing
  `GET /api/workspaces/:id/blobs/:name`. Size cap 2 GB, count cap per job.
- `mcp__run__ask_user` gains `attachments?: string[]` (artifact keys), and
  the runner's `upload_artifact` tool returns a key the model passes in.
- `AgentQuestionCard` (desktop and the phone's Agents page share it) renders
  `video/*` as an inline `<video controls>` and `image/*` as an image, above
  the options. Android's `AgentPushService` shows the image attachment as the
  notification's big picture; answering from the notification keeps working.
- The run log lists artifacts with links; `agent-run-log.tsx` gets an
  **Artifacts** row.

### 3.3 Project state in the note

The skill's memory (`project.md`, `edl.json`) is kept in NotesGraph so a
later run picks up where the last stopped, and so the phone can read it:

- _Edit log_ section: one `## Session N — date` block per run, written with
  `update_document` (strategy, decisions, outstanding).
- _Cuts_ section: the EDL as a table (source, start, end, beat, reason) and
  the `edl.json` text in a code block; the agent reads it back on the next run.
- _Timeline_ (optional, phase 2): `create_widget` with an HTML timeline that
  references the filmstrip and preview blob URLs, so the note itself shows
  the cut. Widgets are sandboxed iframes with scripts, 100 KB max.
- _Deliverables_: links to `preview.mp4` versions and `final.mp4`.

### 3.4 The plugin (`com.notesgraph.video-editor`)

Permissions `ui, docs, workspace, net, agents`. Client:

- Command **Video editor: new project** → creates the project note from a
  template (Footage, Brief, Edit log, Cuts, Deliverables).
- Command **Video editor: install agent** → installs the "Video editor" agent
  (template below) into the workspace if missing.
- Sidebar panel (desktop): project list with last preview and status.

`agents` is a **new SDK capability**: `ctx.agents.installTemplate(id)` and
`ctx.agents.start(agentId, target)`, mapped in `context-factory.ts` to
`AgentsService` / `AgentRunSessionService`. It is small, and it is the one
thing a plugin genuinely cannot do today. Until it lands, the plugin's
commands open the agent editor pre-filled instead.

The template itself (`modules/agents/services/agent-templates.ts`):
`VIDEO_EDITOR_TEMPLATE` with `kind: 'worker'`, `harness: 'remote'`,
`model: 'video-editor'`, `targets: ['doc']`, `maxSteps: 80`. The editor's
`REMOTE_HARNESSES` gains "Video editor (video-use)", and
`isDeviceClaudeModel`, `deviceHarnessName`, `defaultSkillsFor` learn the new
model.

### 3.5 Where it runs

| Device                                | ffmpeg            | ASR                                           | Footage                           | Status                               |
| ------------------------------------- | ----------------- | --------------------------------------------- | --------------------------------- | ------------------------------------ |
| **Mac (M5 Pro)** via `wf agent serve` | yes               | CrisperWhisper fp16 on Metal, ~3× realtime    | local folder, or downloaded blobs | **Phase 1**                          |
| Cloud runner (EC2 box)                | add to Dockerfile | CPU only, slow; egress-throttled, ~11 GB disk | downloaded blobs                  | Phase 3, previews only               |
| Runpod GPU pod as a device            | yes               | fast                                          | downloaded blobs                  | Phase 3, for long multi-take batches |

A `video-editor` run on a device without ffmpeg fails in setup with a clear
message rather than mid-edit.

## 4. Phases

**Phase 1 — the loop works end to end (Mac + phone).**
Server: profile, skill catalog entry, question attachments, artifacts
endpoint and model, `ask_user` attachments. Frontend: model option,
template, question card media, run log artifacts. wf: profile automation
support. video-use: `local-asr` branch rebased on upstream, pinned commit.
Done when: start on the web from a project note whose Footage is a Mac
folder, answer strategy and preview questions from the phone, `final.mp4`
linked in the note.

**Phase 2 — plugin in the store, footage from the phone.**
SDK `agents` capability; plugin published to the marketplace sidecar
(fix: CLI publish sends no auth, bundles only entry files); phone video
picker and `READ_MEDIA_VIDEO` on Android, `.videos` on iOS; attachment
blocks as footage; timeline widget; mobile "New video project" entry on the
Agents page.

**Phase 3 — runs without the Mac.**
ffmpeg + python in the agent-runner image; Runpod GPU device; EDL block so
a re-edit session can start from a shared note; shared run links for clients
to approve a cut.

## 5. Files touched in phase 1

| Area                            | File                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile + skill catalog         | `packages/backend/server/src/plugins/registry/agent-profiles.ts`                                                                                                 |
| Question attachments, artifacts | `packages/backend/server/schema.prisma`, `src/models/registry-job.ts`, `plugins/registry/jobs.ts`, `plugins/registry/controller.ts`                              |
| Runner tools (cloud)            | `tools/agent-runner/src/run-tools.ts`, `api.ts`                                                                                                                  |
| Runner tools (Mac)              | `~/code/workflow/workflow/deploy/jobs.py`, `agent_mcp.py` (profile automation)                                                                                   |
| Model + template                | `packages/frontend/core/src/modules/agents/services/remote-runner.ts`, `agent-templates.ts`, `desktop/dialogs/setting/workspace-setting/agents/agent-editor.tsx` |
| Question UI                     | `desktop/pages/workspace/detail-page/tabs/agent-question.tsx`, `agent-run-log.tsx`; Android `push/AgentPushService.kt`                                           |
| Skill + helpers                 | `~/code/video-use` (`local-asr` branch): SKILL.md, `helpers/transcribe_local.py`                                                                                 |

## 6. Decisions to take

1. **Mac first.** The box has no GPU and little disk; the Mac has both and
   the footage. Cloud previews are phase 3.
2. **Tools, not Bash.** The profile exposes helpers as `mcp__automation__*`
   tools so access levels stay meaningful; that requires the wf change.
3. **Previews travel as question attachments**, not as note blocks, so the
   approve/revise loop stays in the run and the note keeps only what was
   kept.
4. **ASR licence.** CrisperWhisper is non-commercial. Personal videos: fine.
   Anything paid: switch `transcribe_local.py` to WhisperX before the run.
