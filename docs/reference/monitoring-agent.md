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

## Log patterns

The guide's main source is logs, so the agent reads them too. Code:
`packages/backend/server/src/plugins/inventory/log-patterns.ts`.

- **Where the lines come from.** With the agent on, the health check
  also runs `journalctl -p warning -o short-iso` since the last scan
  (an hour back the first time), at most 1000 lines. Before the lines
  leave the machine, `sed` scrubs JWTs, bearer tokens and
  `password=`/`token=`/`api_key=` values. Machines without journalctl
  (macOS) send none. Anything else can post lines itself:
  `POST /devices/:key/logs` with `{ lines, until? }`.
- **Redact, then mine.** On the server every line is redacted again
  (JWTs, bearer/basic, AWS/GitHub/Slack/`sk-` keys, URL passwords,
  `secret=` and similar, emails). Then numbers, ids, hex, UUIDs, IPs and
  times are masked to `<*>`. Last, the line joins the most similar
  pattern (Drain-style: same word count, same first word, at least half
  the words equal). The words that differ become `<*>`. Raw lines are
  never stored, only templates and one redacted example.
- **The catalog** is one row a machine (`monitoring_log_catalogs`), up
  to 300 patterns. The patterns not seen for longest are dropped first.
  A pattern is *known* once it has been seen 20 times or someone labels
  it known.
- **Verdicts.** After the catalog has had 10 scans, a pattern that has
  never been seen is **new**. It is critical if the line says fatal,
  panic, OOM, segfault, corruption and the like, and warn otherwise.
  Each pattern learns its rate in lines an hour (EWMA). A known pattern
  with at least 5 lines in a scan and a rate ≥ *sensitivity* σ above
  normal is a **spike** (an `anomaly` decision). σ is never taken as
  less than √mean, as for Poisson counts. A spike is held out of the
  baseline, so it can't drag normal up.
- Log findings go through the same modes, cooldown, push and triage as
  the check findings. Their metric is `log:<pattern id>`. **Expected**
  labels the pattern known and moves its rate halfway to the reading.

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
| GET  | `/monitoring-agent/logs` | each machine's catalog of log patterns |
| POST | `/monitoring-agent/logs/:key/:patternId/label` | `{ label: 'known' \| null }` |
| POST | `/devices/:key/logs` | `{ lines: string[], until?: epoch s }`: a machine sends its own log lines |

## Not done yet

- Anomalies on monitor readings (`monitor_readings`).
- Time-of-day baselines (the guide keeps a separate normal for each
  hour). With hourly scans, each hour would need 10 days to warm up.
- Logs from macOS (`log show`) and from Docker containers.
- No in-app bell notification. The bell's notification types are tied to
  a doc, so escalations show on the Monitoring page and by push.
