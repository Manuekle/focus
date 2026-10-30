"""Test engine: no model. Moves the character image with the dance's hips and draws the retargeted skeleton over it.

It exists to exercise the whole pipeline (downloads, poses, export, uploads,
verification and Flipbook import in Focus) without a GPU. The character
stays rigid, so it is obviously not an animation; the output is marked
`synthetic` end to end. Enabled only with ANIMATION_ALLOW_FAKE_ENGINE=1.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from ..config import settings
from ..pipeline.pose import draw_skeleton, write_video
from .base import AnimationRequest, EngineError


class FakeProvider:
    name = "fake"
    synthetic = True

    def available(self) -> tuple[bool, str | None]:
        return (settings.allow_fake_engine, None if settings.allow_fake_engine else "ANIMATION_ALLOW_FAKE_ENGINE is off")

    async def validate(self, request: AnimationRequest) -> None:
        if "retargeted" not in request.config:
            raise EngineError("POSE_NOT_FOUND", "test engine needs retargeted poses")

    async def run(self, request: AnimationRequest) -> Path:
        width, height = request.size
        character = cv2.imread(str(request.reference_image_path))
        poses: np.ndarray = request.config["retargeted"]
        ch, cw = character.shape[:2]
        scale = 0.8 * min(width / cw, height / ch)
        fitted = cv2.resize(character, (max(1, int(cw * scale)), max(1, int(ch * scale))), interpolation=cv2.INTER_AREA)
        base = np.array([(width - fitted.shape[1]) / 2, (height - fitted.shape[0]) / 2], dtype=np.float32)
        # The character's own corner color: a flat background like the engines' "simple background" mode.
        background = tuple(int(v) for v in character[2, 2])
        roots = np.nanmean(poses[:, [11, 12]], axis=1)
        finite = np.isfinite(roots).all(axis=1)
        first = roots[finite][0] if finite.any() else np.zeros(2, dtype=np.float32)

        def frames():
            for points, root in zip(poses, roots):
                shift = (root - first) * scale if np.isfinite(root).all() else np.zeros(2, dtype=np.float32)
                left, top = (base + shift).round().astype(int)
                left = int(np.clip(left, 0, width - fitted.shape[1]))
                top = int(np.clip(top, 0, height - fitted.shape[0]))
                canvas = np.full((height, width, 3), background, dtype=np.uint8)
                canvas[top:top + fitted.shape[0], left:left + fitted.shape[1]] = fitted
                draw_skeleton(canvas, points * scale + np.array([left, top], dtype=np.float32), thickness=2)
                cv2.putText(canvas, "TEST ENGINE - NOT AI", (24, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 220), 1, cv2.LINE_AA)
                yield canvas

        out = request.output_dir / "engine.mp4"
        if write_video(out, frames(), request.config["fps"], (width, height)) == 0:
            raise EngineError("GENERATION_FAILED", "no frames")
        return out
