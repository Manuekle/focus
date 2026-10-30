"""Downloads from and uploads to Focus through its signed URLs.

The worker keeps nothing between runs: inputs come from Focus, outputs go
back to Focus, and the local work directory is deleted at the end of a job.
"""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

import httpx

from ..config import settings
from ..security import check_callback_url


class TransferFailed(RuntimeError):
    pass


async def download(url: str, target: Path, expected_sha256: str, max_bytes: int | None = None) -> Path:
    limit = max_bytes or settings.max_input_bytes
    check_callback_url(url)
    digest = hashlib.sha256()
    size = 0
    target.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10), follow_redirects=False) as client:
        async with client.stream("GET", url) as response:
            if response.status_code != 200:
                raise TransferFailed(f"download {target.name}: HTTP {response.status_code}")
            with target.open("wb") as handle:
                async for chunk in response.aiter_bytes(1 << 20):
                    size += len(chunk)
                    if size > limit:
                        raise TransferFailed(f"download {target.name}: larger than {limit} bytes")
                    digest.update(chunk)
                    handle.write(chunk)
    if digest.hexdigest() != expected_sha256:
        target.unlink(missing_ok=True)
        raise TransferFailed(f"download {target.name}: checksum mismatch")
    return target


async def upload(url: str, source: Path, content_type: str, attempts: int = 3) -> None:
    check_callback_url(url)
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=10), follow_redirects=False) as client:
                with source.open("rb") as handle:
                    response = await client.put(url, content=handle.read() if source.stat().st_size < (8 << 20) else _chunks(source), headers={"Content-Type": content_type, "Content-Length": str(source.stat().st_size)})
            if response.status_code in (200, 201):
                return
            if response.status_code < 500:
                raise TransferFailed(f"upload {source.name}: HTTP {response.status_code}")
            last = TransferFailed(f"upload {source.name}: HTTP {response.status_code}")
        except httpx.HTTPError as error:
            last = error
        await asyncio.sleep(2 * (attempt + 1))
    raise TransferFailed(f"upload {source.name} failed: {last}")


async def _chunks(source: Path):
    with source.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            yield chunk
