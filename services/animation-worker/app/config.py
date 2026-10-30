"""Worker configuration, read once from the environment.

Nothing here comes from a request: paths to upstream checkouts and weights,
the service token and the hosts the worker may download from are deployment
settings only.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip() in {"1", "true", "yes"}


def _float(name: str) -> float | None:
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return None


def _hosts(name: str) -> frozenset[str]:
    return frozenset(h.strip().lower() for h in os.environ.get(name, "").split(",") if h.strip())


@dataclass
class Settings:
    token: str = field(default_factory=lambda: os.environ.get("GPU_WORKER_TOKEN", ""))
    # Hosts Focus calls back from (signed input/output URLs). Anything else is refused (SSRF).
    allowed_hosts: frozenset[str] = field(default_factory=lambda: _hosts("ALLOWED_CALLBACK_HOSTS"))
    # Local development only: http:// callbacks to an allowed host.
    allow_insecure: bool = field(default_factory=lambda: _flag("ALLOW_INSECURE_CALLBACKS"))
    allow_fake_engine: bool = field(default_factory=lambda: _flag("ANIMATION_ALLOW_FAKE_ENGINE"))
    work_root: Path = field(default_factory=lambda: Path(os.environ.get("WORK_ROOT", "/tmp/focus-animation")))
    max_input_bytes: int = 200 * 1024 * 1024
    max_concurrent_jobs: int = field(default_factory=lambda: int(os.environ.get("MAX_CONCURRENT_JOBS", "1")))
    gpu_hourly_usd: float | None = field(default_factory=lambda: _float("GPU_HOURLY_USD"))
    pose_backend: str = field(default_factory=lambda: os.environ.get("POSE_BACKEND", "dwpose"))
    pose_device: str = field(default_factory=lambda: os.environ.get("POSE_DEVICE", "cuda"))
    pose_mode: str = field(default_factory=lambda: os.environ.get("POSE_MODE", "balanced"))
    # Upstream checkouts, each with its own Python environment (their pins conflict).
    steadydancer_dir: Path | None = field(default_factory=lambda: Path(p) if (p := os.environ.get("STEADYDANCER_DIR")) else None)
    steadydancer_ckpt: Path | None = field(default_factory=lambda: Path(p) if (p := os.environ.get("STEADYDANCER_CKPT_DIR")) else None)
    steadydancer_python: str = field(default_factory=lambda: os.environ.get("STEADYDANCER_PYTHON", "python"))
    wan_dir: Path | None = field(default_factory=lambda: Path(p) if (p := os.environ.get("WAN_DIR")) else None)
    wan_ckpt: Path | None = field(default_factory=lambda: Path(p) if (p := os.environ.get("WAN_CKPT_DIR")) else None)
    wan_python: str = field(default_factory=lambda: os.environ.get("WAN_PYTHON", "python"))
    wan_use_flux: bool = field(default_factory=lambda: _flag("WAN_USE_FLUX"))
    # Experimental: a public Hugging Face ZeroGPU demo running Wan2.2-Animate (third party, free quota).
    zerogpu_space: str = field(default_factory=lambda: os.environ.get("ZEROGPU_SPACE", ""))
    hf_token: str = field(default_factory=lambda: os.environ.get("HF_TOKEN", ""))
    # "Low Res" (360×640) spends half the quota of "Medium Res" (480×832). On unless ZEROGPU_LOW_RES=0.
    zerogpu_low_res: bool = field(default_factory=lambda: os.environ.get("ZEROGPU_LOW_RES", "1").strip() not in {"0", "false", "no"})
    rife_dir: Path | None = field(default_factory=lambda: Path(p) if (p := os.environ.get("RIFE_DIR")) else None)
    rife_python: str = field(default_factory=lambda: os.environ.get("RIFE_PYTHON", "python"))
    ffmpeg: str = field(default_factory=lambda: os.environ.get("FFMPEG_PATH", "ffmpeg"))
    ffprobe: str = field(default_factory=lambda: os.environ.get("FFPROBE_PATH", "ffprobe"))


settings = Settings()
