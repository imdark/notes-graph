# wf learn (harness proposals)

Step 1 of the self-improving harness plan from the note "Self-improving harness
research (2026-11-01)". The command lives in the `wf` repo (imdark/workflow,
`workflow/learn.py`), not here.

`wf learn` mines captured sessions for repeated mistakes and writes proposals.
It never edits Agent rules, skills or Agent memory itself.

- Detectors (no model): the same tool call failing 3+ times, the same call
  repeated 3+ times, the same short user question in 2+ sessions.
- A model turns the findings into at most `--limit` one-line deltas, each
  targeting `agent_rules`, `skill` or `agent_memory`, with quoted evidence.
- Sessions that used WebFetch/WebSearch are flagged; proposals citing them are
  marked "review closely" (prompt-injection defence).
- Output: `~/.wf/learn/proposed-<date>.md` and, with NotesGraph publishing on,
  a note under `<project> / ai / proposals`.
- `wf learn --scan-only` shows the findings without calling a model.

Not built yet: the accept/reject panel on the Agents page, helpful/harmful
counters, and bench replay validation (steps 2 and 3 of the plan).

## Nightly, as an automation (CLOUD-92)

The counting half of `wf learn` ships as an automation template, "Learn from
agent runs nightly" (`packages/backend/server/src/plugins/automations/
nightly-templates.ts`, see `automations.md`). Start it from the Automations
page: it runs on a device the workspace registered (the cloud runner on a
self-hosted box) every night at 4am, reads the last 14 days of agent runs
with their transcripts and questions through the registry API as its
creator, applies the four detectors above, and keeps a note titled
"Proposed harness changes" current under `ai / proposals`, with at most 10
findings as to-dos. A to-do the person ticked stays ticked on later nights; a
finding no longer seen is dropped. A finding whose runs read web content
says "review closely". Pause, reschedule, run now and read its log like any
automation.

Proposals only: it never edits Agent rules, skills or Agent memory, and no
model is called; the local `wf learn` can still turn the findings into worded
deltas. The Harness²-style baseline-vs-edited comparison stays a `wf bench`
job because of its per-task cost.
