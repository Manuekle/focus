"""Subprocesses: argument lists only (never a shell), cancellable, bounded logs."""

from __future__ import annotations

import asyncio
import os
import signal
from collections.abc import Sequence
from pathlib import Path


class ProcessFailed(RuntimeError):
    def __init__(self, argv0: str, code: int | None, tail: str):
        super().__init__(f"{Path(argv0).name} exited with {code}")
        self.code = code
        self.tail = tail

    @property
    def out_of_memory(self) -> bool:
        text = self.tail.lower()
        return "cuda out of memory" in text or "outofmemoryerror" in text or "cudnn_status_alloc_failed" in text


async def run(args: Sequence[str], *, cwd: Path | None = None, env: dict[str, str] | None = None, timeout: float = 600, tail_chars: int = 12_000) -> str:
    """Runs one program to completion. Cancellation or timeout kills its whole process group."""
    process = await asyncio.create_subprocess_exec(
        *[str(a) for a in args],
        cwd=str(cwd) if cwd else None,
        env={**os.environ, **(env or {})},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    output = bytearray()

    async def read() -> None:
        assert process.stdout
        while chunk := await process.stdout.read(65536):
            output.extend(chunk)
            if len(output) > tail_chars * 2:
                del output[: len(output) - tail_chars]

    try:
        await asyncio.wait_for(asyncio.gather(read(), process.wait()), timeout)
    except (asyncio.CancelledError, asyncio.TimeoutError):
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()
        raise
    text = output.decode("utf-8", "replace")[-tail_chars:]
    if process.returncode != 0:
        raise ProcessFailed(str(args[0]), process.returncode, text)
    return text
