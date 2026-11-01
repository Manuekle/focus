"""Rotoscope fidelity: one drawing measured against its pose guide, its video frame and the frame before it.

  rotoscope_fidelity.py --spec spec.json --out report.json [--overlay overlay.png]

spec.json (every image on the same canvas, poses as rotoscope_pose.py writes one frame):
  {
    "drawing": "attempt.png",            RGBA cut-out, registered on the frame's marks
    "target": {pose}, "drawn": {pose},   the pose guide on the canvas, the drawing's pose on the canvas
    "previous": "frame_0004.png",        optional: the previous approved drawing
    "drawnPrevious": {pose},             optional: its pose on the canvas
    "source": {pose}, "sourcePrevious": {pose},   optional: the video person's poses, on the canvas
    "sheet": "sheet.png",                optional: the character sheet at the drawing's scale
    "personMask": "mask.png",            optional: the video person's mask (SAM 3.1), on the canvas
    "reference": {pose}                  optional: the character sheet's pose (any scale): limb lengths are held to it
  }

The report is app/pipeline/fidelity.py Report.as_dict(); the verdict is the server's (fidelity.ts).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline.fidelity import measure, overlay  # noqa: E402


def rgba(path: str | None, base: Path) -> np.ndarray | None:
    if not path:
        return None
    image = cv2.imread(str(base / path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise SystemExit(f"cannot read {path}")
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGRA)
    elif image.shape[2] == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    return cv2.cvtColor(image, cv2.COLOR_BGRA2RGBA)


def grey(path: str | None, base: Path) -> np.ndarray | None:
    if not path:
        return None
    image = cv2.imread(str(base / path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise SystemExit(f"cannot read {path}")
    # A mask may come as alpha, as grey or as white on black.
    if image.ndim == 3 and image.shape[2] == 4:
        return image[:, :, 3]
    return image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--overlay", type=Path)
    args = parser.parse_args()
    spec = json.loads(args.spec.read_text())
    base = args.spec.parent
    drawing = rgba(spec["drawing"], base)
    report = measure(
        drawing, spec["target"], spec["drawn"],
        previous=rgba(spec.get("previous"), base), drawn_prev=spec.get("drawnPrevious"),
        source=spec.get("source"), source_prev=spec.get("sourcePrevious"),
        sheet=rgba(spec.get("sheet"), base), person_mask=grey(spec.get("personMask"), base), reference=spec.get("reference"),
    )
    args.out.write_text(json.dumps(report.as_dict()))
    if args.overlay:
        cv2.imwrite(str(args.overlay), overlay(drawing, spec["target"], spec["drawn"], report))


if __name__ == "__main__":
    main()
