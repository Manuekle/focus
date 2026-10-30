"""Whole-body poses of the driving video with DWPose (COCO-WholeBody, 133 points).

Steps: detect every person in every frame, follow one subject (the largest
at the start, then the nearest), smooth trajectories with a One-Euro filter
(fast moves and stops survive, jitter doesn't), and report frames whose
joints are missing, unsure or jump.
"""

from __future__ import annotations

import math
import warnings
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

BODY = slice(0, 17)
# COCO body indices.
NOSE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP = 0, 5, 6, 11, 12
BODY_EDGES = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 6), (5, 11), (6, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (0, 1), (0, 2), (1, 3), (2, 4), (0, 5), (0, 6), (15, 17), (15, 18), (15, 19), (16, 20), (16, 21), (16, 22)]
HAND_EDGES = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (0, 9), (9, 10), (10, 11), (11, 12), (0, 13), (13, 14), (14, 15), (15, 16), (0, 17), (17, 18), (18, 19), (19, 20)]
LEFT_HAND, RIGHT_HAND = 91, 112
CONFIDENT = 0.3


class Estimator(Protocol):
    """frame (H, W, 3 BGR) → keypoints (persons, K, 2) in pixels, scores (persons, K)."""

    def __call__(self, frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]: ...


def dwpose_estimator(device: str = "cuda", mode: str = "balanced") -> Estimator:
    """DWPose through rtmlib + ONNX Runtime. Weights are fetched by rtmlib on first use; bake them into the image."""
    from rtmlib import Wholebody  # optional dependency: pip install .[pose]

    model = Wholebody(to_openpose=False, mode=mode, backend="onnxruntime", device=device)
    return lambda frame: model(frame)


def read_frames(path: Path) -> Iterator[np.ndarray]:
    capture = cv2.VideoCapture(str(path))
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                return
            yield frame
    finally:
        capture.release()


@dataclass
class PoseTrack:
    width: int
    height: int
    fps: float
    keypoints: np.ndarray  # (T, 133, 2) pixels, NaN where missing
    scores: np.ndarray  # (T, 133)
    persons: list[int] = field(default_factory=list)  # people detected per frame

    def to_json(self) -> dict:
        return {
            "format": "coco-wholebody-133",
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "frames": [
                {
                    "index": i,
                    "timestamp": round(i / self.fps, 4),
                    "persons": self.persons[i] if i < len(self.persons) else None,
                    "keypoints": [[None, None] if math.isnan(x) else [round(float(x), 2), round(float(y), 2)] for x, y in self.keypoints[i]],
                    "scores": [round(float(s), 3) for s in self.scores[i]],
                }
                for i in range(len(self.keypoints))
            ],
        }


def _center(points: np.ndarray, scores: np.ndarray) -> np.ndarray | None:
    good = scores[BODY] >= CONFIDENT
    return points[BODY][good].mean(axis=0) if good.sum() >= 4 else None


def _area(points: np.ndarray, scores: np.ndarray) -> float:
    good = points[BODY][scores[BODY] >= CONFIDENT]
    if len(good) < 4:
        return 0.0
    span = good.max(axis=0) - good.min(axis=0)
    return float(span[0] * span[1])


def extract(frames: Iterator[np.ndarray], estimator: Estimator, fps: float, on_frame: Callable[[int], None] | None = None) -> PoseTrack:
    """Follows one subject through the clip: the largest person first, then whoever is nearest."""
    keypoints: list[np.ndarray] = []
    scores: list[np.ndarray] = []
    persons: list[int] = []
    last: np.ndarray | None = None
    size = (0, 0)
    for index, frame in enumerate(frames):
        size = (frame.shape[1], frame.shape[0])
        points, conf = estimator(frame)
        points, conf = np.asarray(points, dtype=np.float32).reshape(-1, 133, 2), np.asarray(conf, dtype=np.float32).reshape(-1, 133)
        persons.append(len(points))
        choice: int | None = None
        if len(points):
            if last is None:
                areas = [_area(p, s) for p, s in zip(points, conf)]
                choice = int(np.argmax(areas)) if max(areas) > 0 else None
            else:
                distances = [np.linalg.norm(c - last) if (c := _center(p, s)) is not None else math.inf for p, s in zip(points, conf)]
                choice = int(np.argmin(distances)) if min(distances) < math.inf else None
        if choice is None:
            keypoints.append(np.full((133, 2), np.nan, dtype=np.float32))
            scores.append(np.zeros(133, dtype=np.float32))
        else:
            keypoints.append(points[choice])
            scores.append(conf[choice])
            last = _center(points[choice], conf[choice]) if _center(points[choice], conf[choice]) is not None else last
        if on_frame:
            on_frame(index)
    return PoseTrack(size[0], size[1], fps, np.stack(keypoints) if keypoints else np.zeros((0, 133, 2)), np.stack(scores) if scores else np.zeros((0, 133)), persons)


class OneEuro:
    """One-Euro filter (Casiez et al. 2012): little lag on fast moves, strong smoothing at rest."""

    def __init__(self, fps: float, min_cutoff: float = 1.2, beta: float = 0.03, d_cutoff: float = 1.0):
        self.rate, self.min_cutoff, self.beta, self.d_cutoff = fps, min_cutoff, beta, d_cutoff
        self.x: np.ndarray | None = None
        self.dx: np.ndarray | None = None

    @staticmethod
    def _alpha(cutoff: np.ndarray | float, rate: float) -> np.ndarray | float:
        tau = 1.0 / (2 * math.pi * cutoff)
        return 1.0 / (1.0 + tau * rate)

    def __call__(self, value: np.ndarray) -> np.ndarray:
        if self.x is None:
            self.x, self.dx = value.copy(), np.zeros_like(value)
            return value
        dx = (value - self.x) * self.rate
        a_d = self._alpha(self.d_cutoff, self.rate)
        self.dx = a_d * dx + (1 - a_d) * self.dx
        cutoff = self.min_cutoff + self.beta * np.abs(self.dx)
        a = self._alpha(cutoff, self.rate)
        self.x = a * value + (1 - a) * self.x
        return self.x


def smooth(track: PoseTrack, max_gap: int = 3) -> PoseTrack:
    """Fills short dropouts by holding the last confident point, then filters each joint.

    A joint missing longer than `max_gap` frames stays missing: it is reported, never invented.
    """
    points = track.keypoints.copy()
    conf = track.scores.copy()
    total, joints = conf.shape
    for joint in range(joints):
        gap, held = 0, None
        for t in range(total):
            if conf[t, joint] >= CONFIDENT and not np.isnan(points[t, joint]).any():
                held, gap = points[t, joint].copy(), 0
            elif held is not None and gap < max_gap:
                gap += 1
                points[t, joint] = held
            else:
                points[t, joint] = np.nan
    filters = [OneEuro(track.fps) for _ in range(joints)]
    for t in range(total):
        for joint in range(joints):
            if np.isnan(points[t, joint]).any():
                filters[joint] = OneEuro(track.fps)  # restart after a hole instead of sliding across it
            else:
                points[t, joint] = filters[joint](points[t, joint])
    return PoseTrack(track.width, track.height, track.fps, points, conf, track.persons)


def torso_length(points: np.ndarray) -> float | None:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN joints: no torso this frame
        shoulders = np.nanmean(points[[L_SHOULDER, R_SHOULDER]], axis=0)
        hips = np.nanmean(points[[L_HIP, R_HIP]], axis=0)
    if np.isnan(shoulders).any() or np.isnan(hips).any():
        return None
    return float(np.linalg.norm(shoulders - hips)) or None


def quality_report(track: PoseTrack) -> dict:
    """Frames to look at: no subject, several people, missing body joints, sudden jumps."""
    frames = []
    found = 0
    for t in range(len(track.keypoints)):
        body = track.keypoints[t, BODY]
        visible = ~np.isnan(body).any(axis=1)
        body_conf = float(track.scores[t, BODY].mean())
        issues: list[str] = []
        if visible.sum() < 8:
            issues.append("subject_not_found")
        else:
            found += 1
        missing = [int(j) for j in np.where(~visible)[0]]
        if missing and visible.sum() >= 8:
            issues.append("joints_missing")
        if t < len(track.persons) and track.persons[t] > 1:
            issues.append("multiple_people")
        if t > 0:
            scale = torso_length(track.keypoints[t]) or torso_length(track.keypoints[t - 1])
            step = np.linalg.norm(track.keypoints[t, BODY] - track.keypoints[t - 1, BODY], axis=1)
            if scale and np.nanmax(np.nan_to_num(step, nan=0)) > 0.6 * scale:
                issues.append("sudden_jump")
        frames.append({"index": t, "bodyConfidence": round(body_conf, 3), "missingJoints": missing, "issues": issues})
    total = len(frames)
    return {
        "frames": total,
        "framesWithSubject": found,
        "subjectRatio": round(found / total, 3) if total else 0.0,
        "multiplePeopleFrames": sum("multiple_people" in f["issues"] for f in frames),
        "jumpFrames": [f["index"] for f in frames if "sudden_jump" in f["issues"]],
        "perFrame": frames,
    }


def confidence_summary(track: PoseTrack) -> dict:
    return {
        "body": [round(float(v), 3) for v in track.scores[:, BODY].mean(axis=1)],
        "leftHand": [round(float(v), 3) for v in track.scores[:, LEFT_HAND:LEFT_HAND + 21].mean(axis=1)],
        "rightHand": [round(float(v), 3) for v in track.scores[:, RIGHT_HAND:RIGHT_HAND + 21].mean(axis=1)],
    }


def draw_skeleton(canvas: np.ndarray, points: np.ndarray, color: tuple[int, int, int] = (60, 220, 255), thickness: int = 3) -> np.ndarray:
    def line(a: int, b: int, c: tuple[int, int, int], w: int) -> None:
        pa, pb = points[a], points[b]
        if not (np.isnan(pa).any() or np.isnan(pb).any()):
            cv2.line(canvas, tuple(int(v) for v in pa), tuple(int(v) for v in pb), c, w, cv2.LINE_AA)

    for a, b in BODY_EDGES:
        line(a, b, color, thickness)
    for base in (LEFT_HAND, RIGHT_HAND):
        for a, b in HAND_EDGES:
            line(base + a, base + b, (255, 160, 80), max(1, thickness - 2))
    for point in points[:23]:
        if not np.isnan(point).any():
            cv2.circle(canvas, tuple(int(v) for v in point), thickness + 1, (255, 255, 255), -1, cv2.LINE_AA)
    return canvas


def write_video(path: Path, frames: Iterator[np.ndarray], fps: float, size: tuple[int, int]) -> int:
    """Raw frames to an intermediate MP4 (mp4v); export.py re-encodes to H.264 for delivery."""
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    count = 0
    try:
        for frame in frames:
            writer.write(frame)
            count += 1
    finally:
        writer.release()
    return count


def overlay_frames(video: Path, track: PoseTrack) -> Iterator[np.ndarray]:
    for t, frame in enumerate(read_frames(video)):
        if t >= len(track.keypoints):
            return
        yield draw_skeleton(frame, track.keypoints[t])
