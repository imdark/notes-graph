import asyncio
import os
import sys

from aiohttp import web
import socketio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from terminal_serve import serve  # noqa: E402


def test_against_fake_gateway():
    out, seen = [], {}

    async def go():
        sio = socketio.AsyncServer(async_mode="aiohttp")
        app = web.Application()
        sio.attach(app)
        done = asyncio.Event()

        @sio.on("terminal:device:attach")
        async def attach(sid, body):
            seen["auth"] = True
            await sio.emit("terminal:spawn", {"id": "s", "harness": "shell", "cols": 80, "rows": 24}, to=sid)
            return {"data": {"pending": [], "live": []}}

        @sio.on("terminal:device:started")
        async def started(sid, body):
            await sio.emit("terminal:stdin", {"sessionId": "s", "data": "echo wire-ok; exit\n"}, to=sid)

        @sio.on("terminal:device:output")
        async def output(sid, body):
            out.append(body["data"])

        @sio.on("terminal:device:exit")
        async def exited(sid, body):
            seen["code"] = body["code"]
            done.set()

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        task = asyncio.create_task(serve(f"http://127.0.0.1:{port}", "tok", "w", "dev"))
        await asyncio.wait_for(done.wait(), 15)
        task.cancel()
        await runner.cleanup()

    asyncio.run(go())
    assert "wire-ok" in "".join(out) and seen["code"] == 0
