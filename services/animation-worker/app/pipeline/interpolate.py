"""Optional RIFE frame interpolation (hzwer/ECCV2022-RIFE, MIT).

Doubles the frame rate of the engine output with the repository's
inference_video.py (--exp=1). The export keeps the segment's duration, so
audio stays in sync; invented frames are counted in the render report. It
cannot fix deformed limbs or identity drift, and it is off by default until
an A/B shows it helps. NOT verified on a GPU yet.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from ..config import settings
from ..infrastructure.process import ProcessFailed, run


class InterpolationUnavailable(RuntimeError):
    pass


def available() -> tuple[bool, str | None]:
    root = settings.rife_dir
    if not root or not (root / "inference_video.py").is_file():
        return False, "RIFE_DIR is not an ECCV2022-RIFE checkout"
    if not (root / "train_log").is_dir():
        return False, "RIFE weights (train_log/) missing"
    return True, None


async def double_fps(source: Path, work: Path) -> Path:
    ok, reason = available()
    if not ok:
        raise InterpolationUnavailable(reason)
    assert settings.rife_dir
    work.mkdir(parents=True, exist_ok=True)
    local = work / "rife_input.mp4"
    shutil.copyfile(source, local)
    try:
        await run([settings.rife_python, "inference_video.py", "--exp=1", f"--video={local}"], cwd=settings.rife_dir, timeout=1800)
    except ProcessFailed as error:
        raise InterpolationUnavailable(f"RIFE failed (exit {error.code})") from error
    outputs = sorted((p for p in work.glob("rife_input_2X*.mp4")), key=lambda p: p.stat().st_mtime)
    if not outputs:
        raise InterpolationUnavailable("RIFE wrote no video")
    return outputs[-1]
