# Monitoring agent

A smart monitoring agent on top of the Monitoring page and the inventory
health checks. The idea comes from VersusControl's
[AI agent for monitoring](https://github.com/VersusControl/devops-ai-guidelines/blob/main/04-ai-agent-for-monitoring/00-contents.md):
**learn what normal looks like, flag what's new, escalate only what matters.**

Code: `packages/backend/server/src/plugins/inventory/monitoring-agent.ts`
(server) and `packages/frontend/core/src/components/monitoring/agent.tsx`
(panel on the Monitoring page).

## What it does

- **Learns normal, with no rules.** Every numeric check a machine reports
  (disk, memory and load from the health check, plus any check with a
  `value` that the wf CLI posts to `/devices/:key/status`) gets a
  per-machine EWMA baseline: mean and variance, α = 0.2. After 10
  readings, a reading ≥ *sensitivity* σ above normal is an anomaly
  (σ ≥ 2× sensitivity is critical). Disk, memory and load only alarm when
  they go up. Other metrics alarm in both directions. A floor on σ (2
  points for disk, 5 for memory, 0.25 for load) keeps a flat baseline
  from flagging tiny changes.
- **Flags what's new.** A warn or fail state the machine has never been
  in, such as a check that has never failed, is a *new* finding once the
  machine has had 10 health checks. A state it has already been in isn't
  news a second time.
- **Doesn't learn a spike as normal.** An anomalous reading is learned at
  α/4, so one bad hour stays abnormal. A lasting shift still becomes the
  new normal over time.
- **Escalates only what matters.** The same finding on the same machine
  is recorded once every 6 h. It is recorded again sooner if it gets
  worse (warn → critical) or was marked resolved.

## Modes: earning trust

| Mode     | Learns | Logs decisions | Alerts / triage |
|----------|--------|----------------|-----------------|
| training | ✓      |                |                 |
| shadow   | ✓      | ✓ (`shadow`)   |                 |
| detect   | ✓      | ✓ (`escalated`)| ✓               |

When detect escalates a finding, it can do two things:

- send a phone push, reusing the existing `monitor-alert` FCM message, so
  the current APK shows it;
- if **Triage with Claude** is on, queue a `claude-code` job on the
  machine. The job is told to use read-only commands only and to answer
  with *Likely cause / Evidence / Suggested fix / Urgency*. Its answer is
  stored on the decision.

**Expected** on a decision moves the baseline halfway to that reading and
widens its spread, so it stops being flagged. **Resolved** lets the
finding alert again at once.

The agent runs **Check all machines** itself every *interval* minutes
(default 60; 0 means only when someone asks). It acts as whoever last
changed its settings.

## API

All under `/api/inventory/workspaces/:workspaceId`, PAT or session auth.
Reads need `Workspace.Read`. Everything else needs `Workspace.Settings.Update`.

| Method | Path | Body / query |
|--------|------|--------------|
| GET  | `/monitoring-agent` | settings plus per-machine learning progress |
| POST | `/monitoring-agent` | `{ mode?, sensitivity?, intervalMinutes?, autoTriage?, alerts?: { push } }`. The first call turns the agent on |
| POST | `/monitoring-agent/reset` | `{ deviceKey? }` forgets what was learned (all machines → back to training) |
| GET  | `/monitoring-agent/decisions` | `?limit=` (max 500) |
| POST | `/monitoring-agent/decisions/:id/triage` | queues a read-only Claude run |
| POST | `/monitoring-agent/decisions/:id/feedback` | `{ verdict: 'expected' \| 'resolved' }` |

## Not done yet

- Anomalies on monitor readings (`monitor_readings`) and on log patterns,
  which is the guide's main source. Today the agent only reads device
  checks.
- No in-app bell notification. The bell's notification types are tied to
  a doc, so escalations show on the Monitoring page and by push.
