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
