"""Device side of the NotesGraph remote terminal (`wf terminal serve`).

Connects to the server's socket.io gateway as a device, starts each harness
the browser asks for inside a pty, streams what it prints and applies input
and resizes. Protocol: docs/reference/remote-terminal.md.

Needs `python-socketio[asyncio_client]` and `aiohttp`. POSIX only (pty).
"""

import asyncio
import fcntl
import os
import pty
import shlex
import signal
import struct
import termios
from dataclasses import dataclass, field
from typing import Callable, Optional

# The server refuses output frames over 256 KB; stay well under.
CHUNK = 32 * 1024

DEFAULT_HARNESSES = {
    "claude": ["claude"],
    "codex": ["codex"],
    "gemini": ["gemini"],
}
RESUME_ARGS = {
    "claude": ["--resume"],
    "codex": ["resume"],
    "gemini": ["--resume"],
}


def harness_argv(harness: str, resume: Optional[str] = None,
                 overrides: Optional[dict] = None) -> list:
    """Command line for a harness. `overrides` maps harness -> command string."""
    if harness == "shell":
        return [os.environ.get("SHELL") or "/bin/sh", "-l"]
    if overrides and overrides.get(harness):
        argv = shlex.split(overrides[harness])
    elif harness in DEFAULT_HARNESSES:
        argv = list(DEFAULT_HARNESSES[harness])
    else:
        raise ValueError(f"unknown harness {harness!r}")
    if resume:
        argv += RESUME_ARGS[harness] + [resume]
    return argv


def set_winsize(fd: int, cols: int, rows: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


@dataclass
class Pty:
    id: str
    pid: int
    fd: int
    reader: Optional[asyncio.Task] = None
    killed: bool = False


@dataclass
class Device:
    """Runs the sessions the gateway hands this machine."""
    workspace_id: str
    device_key: str
    emit: Callable  # async (event, payload) -> None
    cwd: Optional[str] = None
    overrides: dict = field(default_factory=dict)
    ptys: dict = field(default_factory=dict)

    def _ref(self, session_id: str) -> dict:
        return {"workspaceId": self.workspace_id, "sessionId": session_id}

    async def spawn(self, session: dict) -> None:
        sid = str(session["id"])
        if sid in self.ptys:
            return
        cols = int(session.get("cols") or 80)
        rows = int(session.get("rows") or 24)
        try:
            argv = harness_argv(session.get("harness", "shell"),
                                session.get("resume"), self.overrides)
            pid, fd = pty.fork()
        except Exception as err:  # unknown harness, fork failure
            await self.emit("terminal:device:started", self._ref(sid))
            await self.emit("terminal:device:output",
                            {**self._ref(sid), "data": f"\r\n[wf] cannot start: {err}\r\n"})
            await self.emit("terminal:device:exit", {**self._ref(sid), "code": 127})
            return
        if pid == 0:  # child
            try:
                if self.cwd:
                    os.chdir(self.cwd)
                os.environ["TERM"] = "xterm-256color"
                os.execvp(argv[0], argv)
            except Exception as err:
                os.write(2, f"[wf] cannot start {argv[0]}: {err}\r\n".encode())
            os._exit(127)
        set_winsize(fd, cols, rows)
        p = Pty(id=sid, pid=pid, fd=fd)
        self.ptys[sid] = p
        await self.emit("terminal:device:started", self._ref(sid))
        p.reader = asyncio.create_task(self._pump(p))

    async def _pump(self, p: Pty) -> None:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def on_readable():
            try:
                data = os.read(p.fd, CHUNK)
            except OSError:
                data = b""
            queue.put_nowait(data)
            if not data:
                loop.remove_reader(p.fd)

        loop.add_reader(p.fd, on_readable)
        decoder_tail = b""
        try:
            while True:
                data = await queue.get()
                if not data:
                    break
                data = decoder_tail + data
                text = data.decode("utf-8", errors="ignore")
                # Keep an incomplete trailing multi-byte sequence for next read.
                try:
                    data.decode("utf-8")
                    decoder_tail = b""
                except UnicodeDecodeError as err:
                    if err.end == len(data):
                        decoder_tail = data[err.start:]
                        text = data[:err.start].decode("utf-8", errors="ignore")
                    else:
                        decoder_tail = b""
                if text:
                    await self.emit("terminal:device:output",
                                    {**self._ref(p.id), "data": text})
        finally:
            code = await self._reap(p)
            self.ptys.pop(p.id, None)
            try:
                os.close(p.fd)
            except OSError:
                pass
            await self.emit("terminal:device:exit", {**self._ref(p.id), "code": code})

    async def _reap(self, p: Pty) -> int:
        for _ in range(50):
            try:
                pid, status = os.waitpid(p.pid, os.WNOHANG)
            except ChildProcessError:
                return 0
            if pid:
                return os.waitstatus_to_exitcode(status)
            await asyncio.sleep(0.1)
        self._signal(p, signal.SIGKILL)
        try:
            _, status = os.waitpid(p.pid, 0)
            return os.waitstatus_to_exitcode(status)
        except ChildProcessError:
            return -9

    @staticmethod
    def _signal(p: Pty, sig: int) -> None:
        try:
            os.killpg(os.getpgid(p.pid), sig)
        except (ProcessLookupError, PermissionError):
            try:
                os.kill(p.pid, sig)
            except ProcessLookupError:
                pass

    def stdin(self, session_id: str, data: str) -> None:
        p = self.ptys.get(str(session_id))
        if p:
            os.write(p.fd, data.encode("utf-8"))

    def resize(self, session_id: str, cols: int, rows: int) -> None:
        p = self.ptys.get(str(session_id))
        if p:
            set_winsize(p.fd, int(cols), int(rows))

    def kill(self, session_id: str) -> None:
        p = self.ptys.get(str(session_id))
        if p:
            p.killed = True
            self._signal(p, signal.SIGHUP)

    async def kill_all(self) -> None:
        for p in list(self.ptys.values()):
            self._signal(p, signal.SIGHUP)
        tasks = [p.reader for p in self.ptys.values() if p.reader]
        if tasks:
            await asyncio.wait(tasks, timeout=7)


async def serve(url: str, token: str, workspace_id: str, device_key: str,
                cwd: Optional[str] = None, overrides: Optional[dict] = None,
                on_event: Callable = lambda *a: None) -> None:
    """Stay connected and run sessions until cancelled."""
    import socketio

    sio = socketio.AsyncClient(reconnection=True, reconnection_delay=2,
                               reconnection_delay_max=30)

    async def emit(event: str, payload: dict):
        await sio.emit(event, payload)

    device = Device(workspace_id, device_key, emit, cwd, overrides or {})

    async def announce():
        ack = await sio.call("terminal:device:attach",
                             {"workspaceId": workspace_id, "deviceKey": device_key},
                             timeout=15)
        if isinstance(ack, dict) and ack.get("error"):
            raise RuntimeError(ack["error"].get("message", "refused"))
        data = (ack or {}).get("data") or {}
        # `live` sessions we no longer have (this process restarted) are gone.
        for s in data.get("live") or []:
            if str(s["id"]) not in device.ptys:
                await emit("terminal:device:exit",
                           {"workspaceId": workspace_id, "sessionId": s["id"], "code": None})
        for s in data.get("pending") or []:
            await device.spawn(s)
        on_event("attached", device_key)

    @sio.event
    async def connect():
        await announce()

    @sio.on("terminal:spawn")
    async def _spawn(session):
        on_event("spawn", session)
        await device.spawn(session)

    @sio.on("terminal:stdin")
    async def _stdin(body):
        device.stdin(body["sessionId"], body["data"])

    @sio.on("terminal:resize")
    async def _resize(body):
        device.resize(body["sessionId"], body["cols"], body["rows"])

    @sio.on("terminal:kill")
    async def _kill(body):
        device.kill(body["sessionId"])

    await sio.connect(url, headers={"Authorization": f"Bearer {token}"},
                      transports=["websocket"], wait_timeout=20)
    try:
        await sio.wait()
    finally:
        await device.kill_all()
        await sio.disconnect()
