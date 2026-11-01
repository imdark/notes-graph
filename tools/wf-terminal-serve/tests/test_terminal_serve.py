import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from terminal_serve import Device, harness_argv  # noqa: E402


def test_argv():
    assert harness_argv("claude") == ["claude"]
    assert harness_argv("claude", "abc") == ["claude", "--resume", "abc"]
    assert harness_argv("codex", "abc") == ["codex", "resume", "abc"]
    assert harness_argv("claude", None, {"claude": "wf ai --x"}) == ["wf", "ai", "--x"]
    with pytest.raises(ValueError):
        harness_argv("vim")


def run_session(script_argv, stdin=None):
    events = []

    async def emit(ev, body):
        events.append((ev, body))

    async def go():
        d = Device("w", "dev", emit, overrides={"claude": script_argv})
        await d.spawn({"id": "s1", "harness": "claude", "cols": 100, "rows": 30})
        if stdin:
            await asyncio.sleep(0.3)
            d.stdin("s1", stdin)
        for _ in range(100):
            if any(e == "terminal:device:exit" for e, _ in events):
                break
            await asyncio.sleep(0.1)

    asyncio.run(go())
    return events


def test_output_exit_and_size():
    ev = run_session("sh -c 'stty size; echo hi; exit 3'")
    out = "".join(b["data"] for e, b in ev if e == "terminal:device:output")
    assert "30 100" in out and "hi" in out
    assert ev[0][0] == "terminal:device:started"
    assert ev[-1] == ("terminal:device:exit", {"workspaceId": "w", "sessionId": "s1", "code": 3})


def test_stdin_and_unknown_harness():
    ev = run_session("sh -c 'read x; echo got:$x'", stdin="ping\n")
    assert "got:ping" in "".join(b["data"] for e, b in ev if e == "terminal:device:output")

    async def go():
        evs = []

        async def emit(e, b):
            evs.append((e, b))
        await Device("w", "d", emit).spawn({"id": "z", "harness": "vim"})
        return evs
    evs = asyncio.run(go())
    assert evs[-1][1]["code"] == 127
