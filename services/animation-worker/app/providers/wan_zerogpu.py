"""Wan2.2-Animate through a public Hugging Face ZeroGPU demo (experimental).

Calls the Space's Gradio API (`/animate_scene`, mode "Pose Retarget") with
`gradio_client`. Inference runs on Hugging Face under the demo's free
ZeroGPU quota, so the worker itself needs no GPU and nothing is billed. It
is also a third party's Space: the character image and the driving clip are
uploaded to it, its schema, quota and availability can change at any time,
and it is not production infrastructure. Off unless ZEROGPU_SPACE is set.

Schema read with Client.view_api() on 2026-10-29 (Space commit
96e899b7c57220183defee4ce91a79d694b2375d): max_duration_s 2–20, resolution
"Low Res" (360×640 portrait) or "Medium Res" (480×832), output at 30 fps.
Every run records the Space commit it actually used.
"""

from __future__ import annotations

import asyncio
import importlib.util
import logging
import shutil
import time
from collections.abc import Callable
from pathlib import Path

from ..config import settings
from .base import AnimationRequest, EngineError

log = logging.getLogger("focus.worker.zerogpu")

ENDPOINT = "/animate_scene"
MIN_SECONDS, MAX_SECONDS = 2, 20
POLL_SECONDS = 2.0


def classify(message: str) -> EngineError:
    """Gradio errors arrive as text: quota, missing GPU and the rest are told apart by their wording."""
    text = message.lower()
    if "quota" in text:
        return EngineError("GPU_UNAVAILABLE", "The free ZeroGPU quota is used up. Try again later, or give the worker an HF_TOKEN for a larger daily quota.")
    if "no gpu" in text or "gpu task aborted" in text or "zerogpu" in text or "queue is full" in text or "space is sleeping" in text or "paused" in text:
        return EngineError("GPU_UNAVAILABLE", "The ZeroGPU demo has no GPU free right now. Try again in a few minutes.")
    if "out of memory" in text:
        return EngineError("MODEL_OOM", "The ZeroGPU demo ran out of GPU memory.")
    return EngineError("GENERATION_FAILED", f"The ZeroGPU demo failed: {message[:200]}")


class WanZeroGpuProvider:
    name = "wan-zerogpu"
    synthetic = False

    def available(self) -> tuple[bool, str | None]:
        if not settings.zerogpu_space:
            return False, "ZEROGPU_SPACE is not set"
        if importlib.util.find_spec("gradio_client") is None:
            return False, "gradio_client is not installed (pip install .[zerogpu])"
        return True, None

    async def validate(self, request: AnimationRequest) -> None:
        ok, reason = self.available()
        if not ok:
            raise EngineError("GPU_UNAVAILABLE", reason or "unavailable")
        if not MIN_SECONDS <= request.duration_seconds <= MAX_SECONDS:
            raise EngineError("INPUT_INVALID", f"The ZeroGPU demo renders {MIN_SECONDS}–{MAX_SECONDS} s; choose a segment of at least {MIN_SECONDS} s.")
        if request.config.get("resolution") == "720p":
            raise EngineError("INPUT_INVALID", "The ZeroGPU demo renders at most 480×832. Choose 480p.")

    async def run(self, request: AnimationRequest) -> Path:
        from gradio_client import Client, handle_file  # optional dependency: pip install .[zerogpu]

        report: Callable[[str], None] = request.config.get("on_detail") or (lambda _text: None)
        downloads = request.output_dir / "zerogpu"
        downloads.mkdir(parents=True, exist_ok=True)
        try:
            client = await asyncio.to_thread(Client, settings.zerogpu_space, hf_token=settings.hf_token or None, verbose=False, download_files=str(downloads))
            endpoints = (await asyncio.to_thread(client.view_api, return_format="dict", print_info=False))["named_endpoints"]
        except Exception as error:  # noqa: BLE001 — any failure to reach the Space means it isn't usable now
            raise EngineError("GPU_UNAVAILABLE", f"The ZeroGPU demo can't be reached: {str(error)[:160]}") from error
        names = {p["parameter_name"] for p in endpoints.get(ENDPOINT, {}).get("parameters", [])}
        if not {"input_video", "max_duration_s", "edited_frame", "rc_str", "resolution_choice"} <= names:
            raise EngineError("GPU_UNAVAILABLE", "The ZeroGPU demo changed its API; the provider needs updating.")
        request.config["engine_version"] = await asyncio.to_thread(_space_commit)

        job = client.submit(
            input_video=handle_file(str(request.driving_video_path)),
            max_duration_s=int(round(request.duration_seconds)),
            edited_frame=handle_file(str(request.reference_image_path)),
            rc_str="Pose Retarget",
            resolution_choice="Low Res" if settings.zerogpu_low_res else "Medium Res",
            api_name=ENDPOINT,
        )
        started = time.monotonic()
        try:
            while not job.done():
                report(_describe(job, time.monotonic() - started))
                await asyncio.sleep(POLL_SECONDS)
            outputs = job.outputs()
            result = job.result()
        except asyncio.CancelledError:
            job.cancel()
            raise
        except EngineError:
            raise
        except Exception as error:  # noqa: BLE001 — gradio_client raises its own AppError/QueueError types
            log.warning("zerogpu job failed: %s", str(error)[:500])
            raise classify(str(error)) from error
        video = _video_path(result if result is not None else (outputs[-1] if outputs else None))
        if not video or not video.is_file():
            raise EngineError("GENERATION_FAILED", "The ZeroGPU demo returned no video.")
        target = request.output_dir / "engine.mp4"
        shutil.copyfile(video, target)
        return target


def _describe(job, elapsed: float) -> str:
    try:
        status = job.status()
        code = getattr(getattr(status, "code", None), "name", "")
        if code == "IN_QUEUE" and status.rank is not None:
            return f"ZeroGPU queue: position {status.rank + 1}" + (f", about {round(status.eta)} s" if status.eta else "")
        if code == "QUEUE_FULL":
            return "ZeroGPU queue is full; waiting"
    except Exception:  # noqa: BLE001 — status is advisory only
        pass
    return f"Generating on the ZeroGPU demo ({round(elapsed)} s)"


def _video_path(value) -> Path | None:
    """The first return is the edited video: a path, or a dict with one in Gradio's file format."""
    first = value[0] if isinstance(value, (list, tuple)) and value else value
    if isinstance(first, dict):
        first = first.get("video") or first.get("path")
    if isinstance(first, dict):
        first = first.get("path")
    return Path(first) if isinstance(first, str) else None


def _space_commit() -> str | None:
    try:
        from huggingface_hub import HfApi

        return HfApi(token=settings.hf_token or None).space_info(settings.zerogpu_space).sha
    except Exception:  # noqa: BLE001 — provenance only; the run doesn't depend on it
        return None
