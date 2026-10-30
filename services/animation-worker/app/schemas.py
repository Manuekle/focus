"""The Focus ↔ worker contract. Mirrors shared/reference-motion.ts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

Engine = Literal["steadydancer", "wan-animate", "wan-zerogpu", "fake"]
Stage = Literal["queued", "validating", "preprocessing", "generating", "postprocessing", "uploading", "completed", "failed", "cancelled"]
ErrorCode = Literal["INPUT_INVALID", "POSE_NOT_FOUND", "GPU_UNAVAILABLE", "MODEL_OOM", "GENERATION_FAILED", "CANCELLED", "OUTPUT_INVALID", "TIMEOUT", "INTERRUPTED"]

OUTPUT_NAMES = (
    "animation.mp4",
    "animation_rife.mp4",
    "pose_overlay.mp4",
    "retargeted_pose_preview.mp4",
    "preview.webp",
    "frames.zip",
    "poses.json",
    "retargeted_poses.json",
    "pose_confidence.json",
    "quality_report.json",
    "render_report.json",
)
OutputName = Literal[OUTPUT_NAMES]  # type: ignore[valid-type]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: HttpUrl
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class Inputs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    character: Input
    driving: Input


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    jobId: str = Field(pattern=r"^[0-9a-f-]{36}$")
    attempt: int = Field(ge=1, le=99)
    engine: Engine
    mode: Literal["animation"]
    seed: int = Field(ge=0, le=2**31 - 1)
    resolution: Literal["480p", "720p"]
    outputFps: Literal[16, 24]
    durationSeconds: float = Field(ge=1, le=3)
    interpolation: bool
    keepAudio: bool
    inputs: Inputs
    uploads: dict[OutputName, HttpUrl]  # type: ignore[valid-type]
    deadlineSeconds: int = Field(gt=0, le=4 * 3600)


class JobError(BaseModel):
    code: ErrorCode
    message: str = Field(max_length=400)


class GpuProfile(BaseModel):
    name: str | None = None
    vramTotalMb: float | None = None
    peakVramMb: float | None = None


class Status(BaseModel):
    jobId: str
    runId: str
    stage: Stage
    detail: str | None = None
    error: JobError | None = None
    uploaded: list[str] = []
    timings: dict[str, float] = {}
    gpu: GpuProfile | None = None
    gpuSeconds: float | None = None
    gpuHourlyUsd: float | None = None
    synthetic: bool = False


class Ready(BaseModel):
    ready: bool
    engines: list[Engine]
    gpu: dict | None = None
    gpuHourlyUsd: float | None = None
    detail: str | None = None
