"""Wan2.2-Animate-14B (Wan-Video/Wan2.2), animation mode.

Official flow from the upstream README (read 2026-10-29):

  python ./wan/modules/animate/preprocess/preprocess_data.py \
      --ckpt_path <ckpt>/process_checkpoint --video_path <video> --refer_path <image> \
      --save_path <dir> --resolution_area W H --retarget_flag [--use_flux]
  python generate.py --task animate-14B --ckpt_dir <ckpt> --src_root_path <dir> --refert_num 1

`replacement` mode is deliberately not wired: start with `animation`.
Status: NOT verified on a GPU yet. Treat an 80 GB GPU as the conservative
baseline for the unquantized model; offloading flags are not passed because
the README documents them only for other tasks.
"""

from __future__ import annotations

from pathlib import Path

from ..config import settings
from ..infrastructure.process import ProcessFailed, run
from .base import AnimationRequest, EngineError, cuda_available, engine_error, newest_mp4


class WanAnimateProvider:
    name = "wan-animate"
    synthetic = False

    def available(self) -> tuple[bool, str | None]:
        root, ckpt = settings.wan_dir, settings.wan_ckpt
        if not root or not (root / "generate.py").is_file():
            return False, "WAN_DIR is not a Wan2.2 checkout"
        if not ckpt or not (ckpt / "process_checkpoint").is_dir():
            return False, "WAN_CKPT_DIR (Wan2.2-Animate-14B) missing"
        if not cuda_available():
            return False, "no CUDA GPU"
        return True, None

    async def validate(self, request: AnimationRequest) -> None:
        ok, reason = self.available()
        if not ok:
            raise EngineError("GPU_UNAVAILABLE", reason or "unavailable")

    async def run(self, request: AnimationRequest) -> Path:
        root, ckpt = settings.wan_dir, settings.wan_ckpt
        assert root and ckpt
        processed = request.output_dir / "wan_process"
        out = request.output_dir / "wan_out"
        out.mkdir(parents=True, exist_ok=True)
        width, height = request.size
        preprocess = [
            settings.wan_python, "./wan/modules/animate/preprocess/preprocess_data.py",
            "--ckpt_path", ckpt / "process_checkpoint", "--video_path", request.driving_video_path,
            "--refer_path", request.reference_image_path, "--save_path", processed,
            "--resolution_area", str(width), str(height), "--retarget_flag",
            *(["--use_flux"] if settings.wan_use_flux else []),
        ]
        generate = [
            settings.wan_python, "generate.py", "--task", "animate-14B", "--ckpt_dir", ckpt,
            "--src_root_path", processed, "--refert_num", "1",
            "--base_seed", str(request.seed), "--save_file", out / "animation.mp4",
        ]
        for step, args in (("preprocess", preprocess), ("generate", generate)):
            try:
                await run(args, cwd=root, env={"CUDA_VISIBLE_DEVICES": "0"}, timeout=request.config.get("timeout", 3600))
            except ProcessFailed as error:
                raise engine_error(error, f"wan {step}") from error
        return newest_mp4(out)
