# Remote terminal

Open Claude Code (or Codex, Gemini CLI, a shell) on a registered machine from
the Deployments and Agents views, and drive it in the browser live. The
harness runs under `wf` on the machine, so it has the workspace's MCP tools.

## Pieces

- **Browser** (`components/remote-terminal`, `modules/agents/services/terminal*.ts`):
  a socket.io connection to the server, a small VT screen (`TerminalScreen`)
  and key/paste forwarding.
- **Server** (`plugins/registry/terminal-gateway.ts`, `terminal-sessions.ts`):
  relays between viewers and devices and keeps 512 KB of recent output per
  session in memory. Both sides need `Workspace.Settings.Update`, since this
  is a shell on the machine.
- **Device** (`wf terminal serve`): connects as a device with its PAT,
  starts each requested harness in a pty, streams output, applies input.

Leaving the page only detaches. Reattaching replays the buffered output from
the viewer's last offset. If the server restarts the buffer is lost; the
device can offer the harness's own conversation again with `resume`.

## Socket events

Acks are `{ data }` or `{ error: { message } }`.

Viewer → server: `terminal:list {workspaceId, deviceKey?}`,
`terminal:open {workspaceId, deviceKey, harness, resume?, cols?, rows?}`,
`terminal:attach {workspaceId, sessionId, since?}` (returns
`{session, data, from}`), `terminal:detach`, `terminal:input {…, data}`,
`terminal:resize {…, cols, rows}`, `terminal:close`.

Server → viewer: `terminal:output {sessionId, data, offset}`,
`terminal:status {session}`, `terminal:exit {sessionId, code}`.

Device → server: `terminal:device:attach {workspaceId, deviceKey}` (returns
`{pending, live}`), `terminal:device:started {workspaceId, sessionId}`,
`terminal:device:output {…, data}`, `terminal:device:exit {…, code}`.

Server → device: `terminal:spawn {session}` (harness, resume, cols, rows),
`terminal:stdin {sessionId, data}`, `terminal:resize`, `terminal:kill`.

Harness values: `claude`, `codex`, `gemini`, `shell`.
