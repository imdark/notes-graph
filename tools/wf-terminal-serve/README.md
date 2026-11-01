# wf terminal serve

Device side of the remote terminal (browser and server side:
`docs/reference/remote-terminal.md`). The `wf` CLI isn't in this repo, so this
is the module to drop into it:

- `terminal_serve.py` — socket.io device client, pty per session. Needs
  `python-socketio` and `aiohttp`.
- `cli.py` — the `wf terminal serve` command; register `terminal_app` in
  `workflow/cli.py` beside `agent_app`.

Harnesses: `claude`, `codex`, `gemini`, `shell`. Override the command in
`~/.wf/config.yaml`, e.g. to run Claude through wf so it has wf's MCP tools:

    terminal:
      harnesses:
        claude: "wf ai"

Tests: `python -m pytest tools/wf-terminal-serve/tests`.
