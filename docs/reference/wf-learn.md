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

## Nightly on the server (CLOUD-92)

The server runs the counting half of `wf learn` itself, every night at 4am
after the 3am doc enrichment (`AgentLearnService`,
`packages/backend/server/src/plugins/registry/learn-job.ts`; the detectors
are pure in `learn.ts`). It reads each workspace's agent runs of the last 14
days from the registry (the transcript tail in `registry_jobs.log` and the
questions in `registry_job_questions`), applies the four detectors above, and
keeps a note titled "Proposed harness changes" current, filed under
`ai / proposals`, with at most 10 findings as to-dos. A to-do the user ticked
stays ticked on later nights; a finding no longer seen is dropped. A finding
whose runs read web content says "review closely".

Proposals only: the job never edits Agent rules, skills or Agent memory. No
model is called on the server; the findings are the output, and the local
`wf learn` can still turn them into worded deltas. The Harness²-style
baseline-vs-edited comparison stays a `wf bench` job because of its per-task
cost.
