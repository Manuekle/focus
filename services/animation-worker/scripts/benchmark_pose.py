"""Benchmarks whole-body pose estimators on anime references and source video frames.

  benchmark_pose.py --set NAME=GLOB [--set NAME=GLOB ...] [--sequence NAME=DIR ...] --out report.json
                    [--modes performance,balanced] [--device cpu]

There are no hand-labelled keypoints for these pictures, so the measures
are label-free and say so:
  found       share of images with a torso (both shoulders and hips ≥ 0.3)
  body        share of the 17 body joints found, on images with a torso
  flip        mean joint distance (torso lengths) between the pose and the
              pose of the mirrored image mapped back with left/right swapped:
              a consistent estimator gives the same body either way
  sides       share of images where that mirrored mapping fits better than
              the unswapped one (left/right labelled by anatomy, not by side)
  jitter      sequences only: median joint acceleration |p(t+1)−2p(t)+p(t−1)|
              in torso lengths; real motion adds the same to every estimator
  agreement   mean joint distance between the estimators (torso lengths)
  ms          wall time per image, model loaded once
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.pipeline.pose import dwpose_estimator  # noqa: E402
from rotoscope_pose import load  # noqa: E402

CONF = 0.3
BODY = 17
PAIRS = [(1, 2), (3, 4), (5, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16)]


def largest(points: np.ndarray, scores: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    points, scores = np.asarray(points, np.float32).reshape(-1, 133, 2), np.asarray(scores, np.float32).reshape(-1, 133)
    if not len(points):
        return None
    areas = []
    for p, s in zip(points, scores):
        good = p[:BODY][s[:BODY] >= CONF]
        areas.append(float(np.ptp(good[:, 0]) * np.ptp(good[:, 1])) if len(good) >= 4 else 0.0)
    best = int(np.argmax(areas))
    return points[best], scores[best]


def torso(p: np.ndarray, s: np.ndarray) -> float | None:
    if (s[[5, 6, 11, 12]] < CONF).any():
        return None
    return float(np.linalg.norm((p[5] + p[6]) / 2 - (p[11] + p[12]) / 2)) or None


def swap(p: np.ndarray, s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    p, s = p.copy(), s.copy()
    for a, b in PAIRS:
        p[[a, b]] = p[[b, a]]
        s[[a, b]] = s[[b, a]]
    return p, s


def distance(a: np.ndarray, sa: np.ndarray, b: np.ndarray, sb: np.ndarray, unit: float) -> float | None:
    both = (sa[:BODY] >= CONF) & (sb[:BODY] >= CONF)
    if both.sum() < 6:
        return None
    return float(np.mean(np.linalg.norm(a[:BODY][both] - b[:BODY][both], axis=1)) / unit)


def run(model, image: np.ndarray):
    found = largest(*model(image))
    if found is None:
        return None
    p, s = found
    return p, s


def measure(model, paths: list[Path]) -> tuple[dict, list]:
    found = body = sides = 0
    flips: list[float] = []
    poses: list = []
    elapsed = 0.0
    for path in paths:
        image = load(path)
        start = time.perf_counter()
        result = run(model, image)
        elapsed += time.perf_counter() - start
        poses.append(result)
        if result is None or torso(*result) is None:
            continue
        p, s = result
        unit = torso(p, s)
        found += 1
        body += float((s[:BODY] >= CONF).mean())
        mirrored = run(model, image[:, ::-1].copy())
        if mirrored is None:
            continue
        q, t = mirrored
        q = q.copy()
        q[:, 0] = image.shape[1] - 1 - q[:, 0]
        swapped = distance(p, s, *swap(q, t), unit)
        straight = distance(p, s, q, t, unit)
        if swapped is not None:
            flips.append(swapped)
            if straight is None or swapped <= straight:
                sides += 1
    n = len(paths)
    return {
        "images": n,
        "found": round(found / n, 3) if n else None,
        "body": round(body / found, 3) if found else None,
        "flip": round(float(np.mean(flips)), 3) if flips else None,
        "sides": round(sides / len(flips), 3) if flips else None,
        "ms": round(elapsed / n * 1000) if n else None,
    }, poses


def jitter(poses: list) -> float | None:
    values = []
    for t in range(1, len(poses) - 1):
        a, b, c = poses[t - 1], poses[t], poses[t + 1]
        if a is None or b is None or c is None or (unit := torso(*b)) is None:
            continue
        ok = (a[1][:BODY] >= CONF) & (b[1][:BODY] >= CONF) & (c[1][:BODY] >= CONF)
        if ok.any():
            values.extend((np.linalg.norm(c[0][:BODY][ok] - 2 * b[0][:BODY][ok] + a[0][:BODY][ok], axis=1) / unit).tolist())
    return round(float(np.median(values)), 4) if values else None


def agreement(first: list, second: list) -> float | None:
    values = []
    for a, b in zip(first, second):
        if a is None or b is None or (unit := torso(*a)) is None:
            continue
        d = distance(a[0], a[1], b[0], b[1], unit)
        if d is not None:
            values.append(d)
    return round(float(np.mean(values)), 3) if values else None


def unique(paths: list[Path]) -> list[Path]:
    seen, out = set(), []
    for path in paths:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest not in seen:
            seen.add(digest)
            out.append(path)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", action="append", default=[], help="NAME=GLOB of still images")
    parser.add_argument("--sequence", action="append", default=[], help="NAME=DIR of frame_NNNN.png in order")
    parser.add_argument("--modes", default="performance,balanced")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    sets = {name: unique(sorted(Path(p) for p in glob.glob(pattern, recursive=True))) for name, pattern in (item.split("=", 1) for item in args.set)}
    sequences = {name: sorted(Path(folder).glob("frame_*.png")) for name, folder in (item.split("=", 1) for item in args.sequence)}
    modes = args.modes.split(",")
    report: dict = {"modes": modes, "device": args.device, "sets": {}, "sequences": {}}
    poses: dict = {}
    for mode in modes:
        model = dwpose_estimator(device=args.device, mode=mode)
        for name, paths in sets.items():
            stats, poses[(mode, name)] = measure(model, paths)
            report["sets"].setdefault(name, {})[mode] = stats
        for name, paths in sequences.items():
            stats, poses[(mode, name)] = measure(model, paths)
            stats["jitter"] = jitter(poses[(mode, name)])
            report["sequences"].setdefault(name, {})[mode] = stats
    if len(modes) == 2:
        for kind in ("sets", "sequences"):
            for name in report[kind]:
                report[kind][name]["agreement"] = agreement(poses[(modes[0], name)], poses[(modes[1], name)])
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
