"""The common engine interface. Each engine turns (character image, driving video) into an MP4."""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from ..infrastructure.process import ProcessFailed


@dataclass
class AnimationRequest:
    job_id: str
    reference_image_path: Path
    driving_video_path: Path
    pose_video_path: Path | None
    output_dir: Path
    seed: int
    size: tuple[int, int]  # (W, H) target bucket
    duration_seconds: float
    config: dict[str, Any] = field(default_factory=dict)


class EngineError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class AnimationProvider(Protocol):
    name: str
    synthetic: bool

    def available(self) -> tuple[bool, str | None]: ...

    async def validate(self, request: AnimationRequest) -> None: ...

    async def run(self, request: AnimationRequest) -> Path: ...


def cuda_available() -> bool:
    return shutil.which("nvidia-smi") is not None


def engine_error(error: ProcessFailed, step: str) -> EngineError:
    """Upstream failures become typed errors; the log tail stays in the worker log only."""
    if error.out_of_memory:
        return EngineError("MODEL_OOM", f"{step}: out of GPU memory")
    return EngineError("GENERATION_FAILED", f"{step} failed (exit {error.code})")


def checkout_commit(root: Path | None) -> str | None:
    """The upstream commit a provider runs, read from .git without spawning git."""
    if not root:
        return None
    try:
        head = (root / ".git" / "HEAD").read_text().strip()
        if head.startswith("ref: "):
            ref = root / ".git" / head[5:]
            return ref.read_text().strip() if ref.is_file() else None
        return head
    except OSError:
        return None


def newest_mp4(folder: Path, prefix: str = "") -> Path:
    files = sorted((p for p in folder.rglob("*.mp4") if p.name.startswith(prefix)), key=lambda p: p.stat().st_mtime)
    if not files:
        raise EngineError("GENERATION_FAILED", "engine finished without writing a video")
    return files[-1]
