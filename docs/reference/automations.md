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

## Useful endpoints

- `GET /api/notes/workspaces/:id/docs?q=&limit=1000`: docs by title match
  (`q` empty for all), as `{docs: [{docId, title}]}`. `limit` up to 1000.
- `GET /api/notes/workspaces/:id/docs/:docId/markdown`.
- `PUT /api/notes/workspaces/:id/docs/:docId` with `{markdown?, title?}`.
- `DELETE /api/notes/workspaces/:id/docs/:docId`: delete a doc permanently
  (needs `Doc.Delete`).
- `POST /api/notes/workspaces/:id/docs` with `{title, markdown, folder?: string[]}`.
- `GET /api/registry/workspaces/:id/jobs?kind=agent&since=<iso>&limit=200`:
  runs, newest first; `GET .../jobs/:jobId?logFrom=0` for one run with its
  transcript and questions.

## Templates

`AUTOMATION_TEMPLATES` (`plugins/automations/hooks.ts`, with
`nightly-templates.ts`) is what the app offers to start from. The two
nightly passes live there as code the person can read and change:

- **Title untitled notes nightly** (cron `0 3 * * *`): a title from the first
  sentence of each untitled note's body; notes with no body either are
  deleted for good (`DELETE /api/notes/workspaces/:id/docs/:docId`).
- **Learn from agent runs nightly** (cron `0 4 * * *`): the counting half of
  `wf learn` (see `wf-learn.md`) over the last 14 days of runs, kept as
  to-dos in "Proposed harness changes" under `ai / proposals`. Proposals
  only.

Both are tested by running their code under node against a fake
`notesgraph` (`plugins/automations/__tests__/nightly-templates.spec.ts`).
