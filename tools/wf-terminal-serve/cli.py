"""`wf terminal serve`: command wrapper around terminal_serve.serve.

Drop-in for wf's CLI (typer): `terminal_app = typer.Typer(...)`, registered
next to `agent_app`. It reuses the same device/URL/token resolution as
`wf agent serve` (`_client_and_device`).
"""

import asyncio
from typing import Optional

import typer
from rich.console import Console

from terminal_serve import serve

console = Console()
terminal_app = typer.Typer(help="Serve remote terminals to NotesGraph", no_args_is_help=True)


@terminal_app.command("serve")
def terminal_serve(
    device: Optional[str] = typer.Option(None, "--device", "-d", help="Target id (default: this machine)"),
    cwd: Optional[str] = typer.Option(None, "--cwd", help="Folder harnesses start in"),
):
    """Let NotesGraph open Claude Code, Codex, Gemini CLI or a shell here.

    Connects out over a websocket (works behind NAT), so nothing listens on
    this machine. Disconnecting a browser leaves the harness running.
    """
    from workflow.cli_agent import _client_and_device
    from workflow.config import load_effective_config

    client, target = _client_and_device(device)
    cfg = load_effective_config()
    overrides = ((cfg.get("terminal") or {}).get("harnesses")) or {}
    console.print(f"🖥️  Serving terminals for [bold]{target.id}[/bold] (Ctrl-C to stop)")

    def on_event(kind, detail=None):
        if kind == "spawn":
            console.print(f"   ▶ {detail.get('harness')} [dim]{str(detail.get('id'))[:8]}[/dim]")

    try:
        asyncio.run(serve(client.url, client.token, client.workspace, target.id,
                          cwd=cwd, overrides=overrides, on_event=on_event))
    except KeyboardInterrupt:
        console.print("\n🛑 Stopped")
