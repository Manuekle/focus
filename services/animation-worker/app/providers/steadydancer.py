"""SteadyDancer (MCG-NJU/SteadyDancer, Apache-2.0 code; check weight terms separately).

Wraps the repository's documented inference steps, run from its checkout
with its own Python environment:

  preprocess/pose_align.py              --imgfn_refer --vidfn --outfn --outfn_align_pose_video
  preprocess/dump_video_images.py       <video> <folder>
  preprocess/pose_align_withdiffaug.py  (same flags; writes single_aug.mp4)
  generate_dancer.py --task i2v-14B --size W*H --ckpt_dir --prompt --image
                     --cond_pos_folder --cond_neg_folder --sample_guide_scale
                     --condition_guide_scale --end_cond_cfg --base_seed --save_file

Status: commands follow the upstream README (read 2026-10-29). NOT verified
end to end on a GPU yet; no VRAM claim is made. Supported sizes for this
checkpoint must be confirmed in the smoke test.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from ..config import settings
from ..infrastructure.process import ProcessFailed, run
from .base import AnimationRequest, EngineError, cuda_available, engine_error, newest_mp4

PROMPT = "A 2D anime character dancing, consistent identity, clean line art, stable colors."


class SteadyDancerProvider:
    name = "steadydancer"
    synthetic = False

    def available(self) -> tuple[bool, str | None]:
        root, ckpt = settings.steadydancer_dir, settings.steadydancer_ckpt
        if not root or not (root / "generate_dancer.py").is_file():
            return False, "STEADYDANCER_DIR is not a SteadyDancer checkout"
        if not ckpt or not ckpt.is_dir():
            return False, "STEADYDANCER_CKPT_DIR missing"
        if not (root / "preprocess/pretrained_weights/dwpose").is_dir():
            return False, "DWPose weights for SteadyDancer preprocessing missing"
        if not cuda_available():
            return False, "no CUDA GPU"
        return True, None

    async def validate(self, request: AnimationRequest) -> None:
        ok, reason = self.available()
        if not ok:
            raise EngineError("GPU_UNAVAILABLE", reason or "unavailable")

    async def run(self, request: AnimationRequest) -> Path:
        root = settings.steadydancer_dir
        assert root and settings.steadydancer_ckpt
        work = request.output_dir / "steadydancer"
        positive, negative, out = work / "positive", work / "negative", work / "out"
        for folder in (positive, negative, out):
            folder.mkdir(parents=True, exist_ok=True)
        ref = work / "ref_image.png"
        video = work / "driving_video.mp4"
        shutil.copyfile(request.reference_image_path, ref)
        shutil.copyfile(request.driving_video_path, video)
        (work / "prompt.txt").write_text(PROMPT)
        py = settings.steadydancer_python
        width, height = request.size
        steps = [
            ("pose_align", [py, "preprocess/pose_align.py", "--imgfn_refer", ref, "--vidfn", video, "--outfn", positive / "all.mp4", "--outfn_align_pose_video", positive / "single.mp4"]),
            ("dump_positive", [py, "preprocess/dump_video_images.py", positive / "single.mp4", positive]),
            ("pose_align_withdiffaug", [py, "preprocess/pose_align_withdiffaug.py", "--imgfn_refer", ref, "--vidfn", video, "--outfn", negative / "all.mp4", "--outfn_align_pose_video", negative / "single.mp4"]),
            ("dump_negative", [py, "preprocess/dump_video_images.py", negative / "single_aug.mp4", negative]),
            ("generate", [
                py, "generate_dancer.py", "--task", "i2v-14B", "--size", f"{width}*{height}", "--ckpt_dir", settings.steadydancer_ckpt,
                "--prompt", PROMPT, "--image", ref, "--cond_pos_folder", positive, "--cond_neg_folder", negative,
                "--sample_guide_scale", "5.0", "--condition_guide_scale", "1.0", "--end_cond_cfg", "0.4",
                "--base_seed", str(request.seed), "--save_file", out / "video",
            ]),
        ]
        for step, args in steps:
            try:
                await run(args, cwd=root, env={"CUDA_VISIBLE_DEVICES": "0"}, timeout=request.config.get("timeout", 3600))
            except ProcessFailed as error:
                raise engine_error(error, f"steadydancer {step}") from error
        return newest_mp4(out)
