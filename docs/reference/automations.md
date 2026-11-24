# Automations: what the code can reach

An automation is JavaScript that runs on a device the workspace registered
(a machine with `wf`, or the cloud runner on a self-hosted box) when a
trigger fires: a cron or interval schedule, a workspace event, a webhook, a
hook around an agent run, or "Run now". Each run is a registry job of kind
`automation`; its log and output are on the Automations page.

The server side is `packages/backend/server/src/plugins/automations`; the
runner side is `tools/agent-runner/src/code-runner.ts`, which runs the code
as the body of an async function in a `vm` sandbox. The return value is the
run's output.

## Globals

- `input`: what triggered the run (the event, the webhook body, the agent
  job for a hook), or null.
- `secrets`: the workspace secrets the automation names, by name.
- `console`: each line goes to the run's log.
- `fetch`, `Headers`, `URL`, `TextEncoder`, `crypto`, timers, `atob`/`btoa`.
- `notesgraph`: the workspace API as the automation's creator (below).

## `notesgraph`: the workspace API as the creator

When the server hands a run to a runner, it mints an access token for the
automation's creator that expires at the run's timeout plus two minutes and
is revoked when the run ends (`RegistryJobService.runIdentity`,
`AutomationService.finishRun`). The runner gives the sandbox:

- `notesgraph.url`: the server's base url.
- `notesgraph.workspaceId`.
- `notesgraph.fetch(path, init?)`: `fetch` against the server with the
  token's `Authorization` header. `path` is a path under the server such
  as `/api/notes/workspaces/<id>/docs`. An object `body` is sent as JSON. The
  reply is returned parsed when it is JSON, as text otherwise; a non-2xx
  reply throws an Error whose message carries the method, path, status and
  the server's message, with `status` set on it.

So an automation reads and writes notes, lists agent runs with their
transcripts, or calls anything else the creator may, with no secret to set
up. The reserved secret names `NOTESGRAPH_TOKEN` and `NOTESGRAPH_WORKSPACE`
carry the same identity for code that wants raw `fetch`; a workspace secret
cannot shadow them.

Because the token acts as the creator, only workspace admins may write
automations, and a run can do nothing its creator could not.

## Calling other automations

`notesgraph.automations` lets one automation run another, so small ones
can be put together:

- `await notesgraph.automations.run(nameOrId, input?, {target?})`: start
  it and wait. Returns its output; throws when the run fails, times out or
  is cancelled (the error's `run` holds the run with its error).
- `await notesgraph.automations.start(nameOrId, input?, {target?})`: start
  it and go on. Returns `{automationId, runId, status}`.
- `await notesgraph.automations.wait(handle)`: wait for a started run, as
  `run` does. Start several, then `Promise.all` their `wait`s to run them
  side by side.
- `await notesgraph.automations.list()`: the workspace's automations.

A name must match exactly one automation; when two share it, call by id.
The called automation runs its deployed version on its own device, with
its own secrets and time limit, as a run of kind `call` on its Runs list.

The runner names the calling run in the request (`caller` on
`POST .../automations/:id/run`), and the server refuses a call whose
caller has already ended, one that would call an automation already in the
chain (a cycle, including calling itself), and a chain of more than five
automations (`MAX_CALL_DEPTH`). A caller waiting on `run` counts against
its own time limit, so give it room for what it calls. Calling needs the
same right as Run now: the automation's creator must be a workspace admin.

This is the cloud runner's helper (`tools/agent-runner`). Code run by a wf
device can call the same endpoint with `NOTESGRAPH_TOKEN`, but without
`caller` its run counts as a manual one and no cycle check applies.

## Useful endpoints

- `GET /api/notes/workspaces/:id/docs?q=&limit=1000`: docs by title match
  (`q` empty for all), as `{docs: [{docId, title}]}`. `limit` up to 1000.
- `GET /api/notes/workspaces/:id/docs/:docId/markdown`.
- `PUT /api/notes/workspaces/:id/docs/:docId` with `{markdown?, title?}`.
- `DELETE /api/notes/workspaces/:id/docs/:docId`: moves the doc to the trash
  (restorable).
- `POST /api/notes/workspaces/:id/docs` with `{title, markdown, folder?: string[]}`.
- `GET /api/registry/workspaces/:id/jobs?kind=agent&since=<iso>&limit=200`:
  runs, newest first; `GET .../jobs/:jobId?logFrom=0` for one run with its
  transcript and questions.

## Templates

`AUTOMATION_TEMPLATES` (`plugins/automations/hooks.ts`, with
`nightly-templates.ts`) is what the app offers to start from. The two
nightly passes live there as code the person can read and change:

- **Title untitled notes nightly** (cron `0 3 * * *`): a title from the first
  sentence of each untitled note's body; notes with no body are only
  reported.
- **Learn from agent runs nightly** (cron `0 4 * * *`): the counting half of
  `wf learn` (see `wf-learn.md`) over the last 14 days of runs, kept as
  to-dos in "Proposed harness changes" under `ai / proposals`. Proposals
  only.

Both are tested by running their code under node against a fake
`notesgraph` (`plugins/automations/__tests__/nightly-templates.spec.ts`).

The **Tag interview events** template (`interview-template.ts`, every 30
minutes) reads the workspace calendar over `/graphql`, keeps events whose
title or description looks like an interview, and queues one agent run per
new event through `POST /api/registry/workspaces/:id/devices/:key/jobs`. The
agent classifies the event, tags its note `#interview` and adds the
candidate's CV and LinkedIn link from the Slack-synced notes. Set
`AGENT_DEVICE` (and `CALENDAR`, default `pantheon`) at the top of the code.
Events already handed over are listed in the "Interview events handed to the
agent" note. Tested in `__tests__/interview-template.spec.ts`.
