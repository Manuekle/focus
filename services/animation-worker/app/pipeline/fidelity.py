"""Fidelity of one rotoscoped drawing: how closely it follows its video frame and the frame before it.

Every measure here is local (NumPy + OpenCV), deterministic and in canvas pixels: the drawing,
the pose guide, the source poses and the previous approved drawing all stand on the same canvas
(server/rotoscope/pipeline.ts registers each drawing onto its frame's marks before it is measured).

Measures, each 0–100 (None when it can't be measured):

  pose        COCO object-keypoint similarity of the drawn body against the guide, after a
              similarity alignment on the torso: where every joint is.
  limbs       each limb bone's direction against the guide, foreshortened bones weighted down:
              which way every arm and leg points. Mirrored poses are detected here.
  integrity   every arm and leg drawn where the guide has it (ink along the target bones), the
              drawn joints standing on ink, and no loose fragments: missing, extra or broken limbs.
  proportions each limb bone's length against the guide's (which carries the character's own
              proportions), stretching punished harder than foreshortening.
  motion      the drawn joints' move from the previous drawing against the video person's move
              from the previous frame, in torso lengths: a jump the video doesn't make.
  continuity  the previous drawing and this one look like the same drawing: Lab colour
              histograms of the figure and the head's structure (SSIM).
  identity    the figure's colours against the character sheet's.
  silhouette  IoU with the video person's mask (SAM 3.1), informative only: costumes differ.

The verdict (weights, thresholds, what the next attempt is told) is policy, kept in TypeScript
(server/rotoscope/fidelity.ts); this module only measures.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

MIN_SCORE = 0.3
BODY = 17
# COCO keypoint sigmas (body).
SIGMAS = np.array([0.026, 0.025, 0.025, 0.035, 0.035, 0.079, 0.079, 0.072, 0.072, 0.062, 0.062, 0.107, 0.107, 0.087, 0.087, 0.089, 0.089])
# "Left"/"right" are the subject's sides, as COCO names them.
BONES: dict[str, tuple[int, int]] = {
    "left upper arm": (5, 7), "left forearm": (7, 9), "right upper arm": (6, 8), "right forearm": (8, 10),
    "left thigh": (11, 13), "left shin": (13, 15), "right thigh": (12, 14), "right shin": (14, 16),
}
LIMBS: dict[str, tuple[str, str]] = {
    "left arm": ("left upper arm", "left forearm"), "right arm": ("right upper arm", "right forearm"),
    "left leg": ("left thigh", "left shin"), "right leg": ("right thigh", "right shin"),
}
SWAP = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]
TORSO = [5, 6, 11, 12]
MOVING = list(range(5, 17))
# A bone is noise within this many degrees (DWPose on drawings).
ANGLE_NOISE = 6.0
ANGLE_ZERO = 60.0
# The eyes and ears move with the character's own face design, not the pose: left out of the pose score.
POSE_JOINTS = [0, *range(5, BODY)]
# DWPose on a drawing (garments over hips and knees, stylised hands) is noisier than COCO's annotators: wider tolerance.
OKS_SLACK = 1.5
# A drawn figure piece this share of the figure's area or larger, apart from the figure, is a fragment.
FRAGMENT_SHARE = 0.004


def points(pose: dict | None, min_score: float = MIN_SCORE) -> np.ndarray:
    """The body keypoints as a (17, 2) array, NaN where missing or unsure."""
    out = np.full((BODY, 2), np.nan)
    if not pose:
        return out
    scores = pose.get("scores") or []
    for i, point in enumerate((pose.get("keypoints") or [])[:BODY]):
        if point is None or point[0] is None or point[1] is None:
            continue
        if i < len(scores) and scores[i] is not None and scores[i] < min_score:
            continue
        out[i] = point[:2]
    return out


def ok(p: np.ndarray, *indices: int) -> bool:
    return all(not np.isnan(p[i]).any() for i in indices)


def torso_length(p: np.ndarray) -> float | None:
    if ok(p, 5, 6, 11, 12):
        return float(np.linalg.norm((p[5] + p[6]) / 2 - (p[11] + p[12]) / 2))
    if ok(p, 5, 6):
        return float(np.linalg.norm(p[5] - p[6]) * 1.45)
    return None


def similarity(src: np.ndarray, dst: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    """Umeyama: scale, rotation and translation taking src onto dst (both (n, 2), n ≥ 2)."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    s, d = src - mu_s, dst - mu_d
    var = (s ** 2).sum() / len(src)
    u, sig, vt = np.linalg.svd(d.T @ s / len(src))
    sign = np.diag([1.0, 1.0 if np.linalg.det(u @ vt) >= 0 else -1.0])
    rot = u @ sign @ vt
    scale = float((sig * np.diag(sign)).sum() / var) if var > 0 else 1.0
    return scale, rot, mu_d - scale * rot @ mu_s


def align_on_torso(drawn: np.ndarray, target: np.ndarray) -> np.ndarray:
    shared = [i for i in TORSO if ok(drawn, i) and ok(target, i)]
    if len(shared) < 2:
        return drawn
    scale, rot, shift = similarity(drawn[shared], target[shared])
    return (scale * (rot @ drawn.T)).T + shift


def angle(v: np.ndarray) -> float:
    return math.degrees(math.atan2(v[1], v[0]))


def angle_between(a: np.ndarray, b: np.ndarray) -> float:
    d = abs(angle(a) - angle(b)) % 360
    return min(d, 360 - d)


@dataclass
class Report:
    metrics: dict[str, float | None] = field(default_factory=dict)
    bones: list[dict] = field(default_factory=list)
    limbs: list[dict] = field(default_factory=list)
    joints: list[dict] = field(default_factory=list)
    fragments: list[dict] = field(default_factory=list)
    mirrored: bool = False
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "metrics": {k: (None if v is None else round(float(v), 2)) for k, v in self.metrics.items()},
            "bones": self.bones, "limbs": self.limbs, "joints": self.joints, "fragments": self.fragments,
            "mirrored": self.mirrored, "notes": self.notes,
        }


# ── Pose ────────────────────────────────────────────────────────────────────

def pose_similarity(drawn: np.ndarray, target: np.ndarray, report: Report) -> float | None:
    torso = torso_length(target)
    if torso is None:
        report.notes.append("the guide has no torso: pose not measured")
        return None
    aligned = align_on_torso(drawn, target)
    # COCO's object scale is its area; a standing figure's box is about 3.3 torsos tall and 0.45 as wide.
    area = (3.3 * torso) ** 2 * 0.45
    values = []
    for i in POSE_JOINTS:
        if not ok(target, i):
            continue
        if not ok(aligned, i):
            values.append(0.0)
            report.joints.append({"joint": i, "error": None, "oks": 0.0})
            continue
        d2 = float(((aligned[i] - target[i]) ** 2).sum())
        k = 2 * SIGMAS[i] * OKS_SLACK
        value = math.exp(-d2 / (2 * area * k * k))
        values.append(value)
        report.joints.append({"joint": i, "error": round(math.sqrt(d2) / torso, 3), "oks": round(value, 3)})
    return 100 * float(np.mean(values)) if values else None


def bone_errors(drawn: np.ndarray, target: np.ndarray) -> list[dict]:
    torso = torso_length(target) or 1.0
    shared = [i for i in TORSO if ok(target, i)]
    centre = float(np.mean(target[shared, 0])) if shared else None
    out = []
    for name, (a, b) in BONES.items():
        if not ok(target, a, b):
            continue
        vt = target[b] - target[a]
        length = float(np.linalg.norm(vt))
        # A bone seen end-on is short and its direction unreliable: it counts for less.
        weight = float(np.clip(length / (0.35 * torso), 0.2, 1.0))
        # Where the viewer sees it: what the generator is told ("the arm on the LEFT of the image").
        screen = None if centre is None else ("left" if target[a][0] < centre else "right")
        if not ok(drawn, a, b):
            out.append({"bone": name, "screen": screen, "error": None, "weight": weight, "score": 0.0})
            continue
        err = angle_between(drawn[b] - drawn[a], vt)
        score = float(np.clip(1 - max(0.0, err - ANGLE_NOISE) / (ANGLE_ZERO - ANGLE_NOISE), 0, 1))
        out.append({"bone": name, "screen": screen, "error": round(err, 1), "weight": round(weight, 2), "score": round(score, 3), "target": round(angle(vt), 1), "drawn": round(angle(drawn[b] - drawn[a]), 1)})
    return out


def direction_score(rows: list[dict]) -> float:
    return sum(r["score"] * r["weight"] for r in rows) / max(1e-6, sum(r["weight"] for r in rows))


def reflected(p: np.ndarray) -> np.ndarray:
    """The pose drawn as its mirror image, as an estimator would label it: reflected about the torso and sides swapped."""
    shared = [i for i in TORSO if ok(p, i)]
    if not shared:
        return p
    centre = float(np.mean(p[shared, 0]))
    out = p.copy()
    out[:, 0] = 2 * centre - out[:, 0]
    return out[SWAP]


def orient(drawn: np.ndarray, target: np.ndarray, report: Report) -> np.ndarray:
    """
    The drawn pose labelled the way the guide is. The estimator sometimes swaps a drawing's left and right labels while
    the drawing itself is right: then the swapped labels are used. A drawing whose mirror image matches the guide is
    mirrored: that is the drawing's error, so its own labels stay and the report says so.
    """
    straight = bone_errors(drawn, target)
    measured = [r["error"] for r in straight if r["error"] is not None]
    if not measured or np.mean(measured) <= 25:
        return drawn
    base = direction_score(straight)
    swapped, mirror = drawn[SWAP], reflected(drawn)
    swap_score, mirror_score = direction_score(bone_errors(swapped, target)), direction_score(bone_errors(mirror, target))
    if swap_score > base + 0.25 and swap_score >= mirror_score:
        report.notes.append("the pose estimator swapped the drawing's left and right labels: measured with them corrected")
        return swapped
    if mirror_score > base + 0.25:
        report.mirrored = True
        report.notes.append("the drawing is the mirror image of the target pose: left and right swapped on screen")
    return drawn


ARMS = {"left arm": (5, 7, 9), "right arm": (6, 8, 10)}
# A hand this close (torso lengths) to the guide's, after the torsos are laid on each other, lands where the video's does.
HAND_ON_TARGET = 0.3
# What an arm whose hand lands right scores at least: its elbow may be hidden in a wide sleeve, where the estimator
# guesses it at the sleeve's end, but the arm reads right.
HAND_FLOOR = 0.8


def limb_directions(drawn: np.ndarray, target: np.ndarray, report: Report) -> float | None:
    bones = bone_errors(drawn, target)
    if not bones:
        return None
    torso = torso_length(target)
    aligned = align_on_torso(drawn, target)
    for limb, (shoulder, elbow, wrist) in ARMS.items():
        if torso is None or not ok(aligned, wrist) or not ok(target, wrist):
            continue
        miss = float(np.linalg.norm(aligned[wrist] - target[wrist])) / torso
        if miss > HAND_ON_TARGET:
            continue
        for row in bones:
            if BONES[row["bone"]] in ((shoulder, elbow), (elbow, wrist)) and row["score"] < HAND_FLOOR:
                row["score"], row["handOnTarget"] = HAND_FLOOR, round(miss, 3)
                report.notes.append(f"{row['bone']} {row['error']}° off but its hand lands on the video's ({miss:.2f} torso): elbow likely hidden")
    report.bones = bones
    return 100 * direction_score(bones)


def proportions(drawn: np.ndarray, target: np.ndarray, report: Report, reference: np.ndarray | None = None) -> float | None:
    """
    Each limb bone against the character's own, in torso lengths. Measured on the character sheet's pose when there is
    one: DWPose places hips the same way on the sheet and on its drawings (under a skirt, say), so that bias cancels,
    and the sheet holds every limb at full length. A bone may be shorter (turned toward the camera), never longer.
    """
    base = reference if reference is not None and torso_length(reference) else target
    td, tb = torso_length(drawn), torso_length(base)
    if not td or not tb:
        return None
    scores = []
    for row in report.bones or bone_errors(drawn, target):
        a, b = BONES[row["bone"]]
        if not ok(drawn, a, b) or not ok(base, a, b):
            continue
        ratio = (np.linalg.norm(drawn[b] - drawn[a]) / td) / max(1e-6, np.linalg.norm(base[b] - base[a]) / tb)
        # Against the sheet only stretching is wrong (shorter is foreshortening); against the guide, which keeps the
        # video's foreshortening, much shorter is wrong too.
        penalty = max(0.0, ratio - 1.15) * 2.5 + (max(0.0, 0.75 - ratio) * 1.5 if base is target else max(0.0, 0.45 - ratio) * 1.5)
        row["ratio"] = round(float(ratio), 3)
        scores.append(float(np.clip(1 - penalty, 0, 1)))
    return 100 * float(np.mean(scores)) if scores else None


# ── Integrity ───────────────────────────────────────────────────────────────

def ink(alpha: np.ndarray, radius: int) -> np.ndarray:
    mask = (alpha >= 128).astype(np.uint8)
    if radius > 0:
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)))
    return mask


def coverage(mask: np.ndarray, a: np.ndarray, b: np.ndarray, samples: int = 24) -> float:
    h, w = mask.shape
    hits = 0
    for t in np.linspace(0.08, 0.92, samples):
        x, y = (a + (b - a) * t).round().astype(int)
        hits += 0 <= x < w and 0 <= y < h and mask[y, x] > 0
    return hits / samples


def fragments(alpha: np.ndarray) -> list[dict]:
    mask = (alpha >= 128).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count <= 2:
        return []
    areas = stats[1:, cv2.CC_STAT_AREA]
    main = int(np.argmax(areas)) + 1
    total = int(areas.sum())
    out = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if label == main or area < FRAGMENT_SHARE * total:
            continue
        x, y, w, h = (int(v) for v in stats[label, :4])
        out.append({"box": [x, y, w, h], "area": area, "share": round(area / total, 4)})
    return out


def integrity(alpha: np.ndarray, drawn: np.ndarray, target: np.ndarray, report: Report) -> float | None:
    torso = torso_length(target)
    if torso is None:
        return None
    near = ink(alpha, max(2, int(0.12 * torso)))
    tight = ink(alpha, max(1, int(0.03 * torso)))
    # The guide laid on the drawn torso: registration puts the drawing on the person's marks, the guide may stand a little apart.
    guide = align_on_torso(target, drawn)
    scores = []
    for limb, (upper, lower) in LIMBS.items():
        (a, b), (_, c) = BONES[upper], BONES[lower]
        if not ok(guide, a, b, c):
            continue
        # Ink along the guide's limb: the limb is drawn where the video has it.
        where = (coverage(near, guide[a], guide[b]) + coverage(near, guide[b], guide[c])) / 2
        present = ok(drawn, a, b, c)
        # The drawn limb stands on ink: the estimator found a limb that is really there, not one it guessed.
        real = (coverage(tight, drawn[a], drawn[b]) + coverage(tight, drawn[b], drawn[c])) / 2 if present else 0.0
        score = (0.6 * where + 0.4 * real) if present else 0.0
        report.limbs.append({"limb": limb, "present": present, "onGuide": round(where, 3), "onInk": round(real, 3), "score": round(score, 3)})
        scores.append(score)
    report.fragments = fragments(alpha)
    if not scores:
        return None
    return float(np.clip(100 * np.mean(scores) - 8 * len(report.fragments), 0, 100))


# ── Continuity and identity ─────────────────────────────────────────────────

def figure_mask(rgba: np.ndarray, key_light: bool = False) -> np.ndarray:
    """
    The figure's pixels: its alpha. With `key_light` (a character sheet, drawn on white and placed opaque on the
    canvas) the flat light backdrop around the figure goes too: every light region touching the image's edge or a
    transparent pixel. The figure's own whites sit inside its outline and stay.
    """
    alpha = (rgba[:, :, 3] >= 128).astype(np.uint8)
    if not key_light:
        return alpha
    light = ((rgba[:, :, :3].min(axis=2) >= 235) & (alpha > 0)).astype(np.uint8)
    _, labels = cv2.connectedComponents(light, connectivity=4)
    outside = cv2.dilate(1 - alpha, np.ones((3, 3), np.uint8)) > 0
    outside[0, :] = outside[-1, :] = outside[:, 0] = outside[:, -1] = True
    backdrop = np.isin(labels, np.setdiff1d(np.unique(labels[outside & (light > 0)]), [0]))
    return (alpha.astype(bool) & ~backdrop).astype(np.uint8)


def lab_histogram(rgba: np.ndarray, key_light: bool = False) -> np.ndarray | None:
    mask = figure_mask(rgba, key_light)
    if mask.sum() < 500:
        return None
    lab = cv2.cvtColor(np.ascontiguousarray(rgba[:, :, :3]), cv2.COLOR_RGB2LAB)
    hist = cv2.calcHist([lab], [0, 1, 2], mask, [4, 8, 8], [0, 256, 0, 256, 0, 256])
    return cv2.normalize(hist, hist).flatten()


def histogram_similarity(a: np.ndarray, b: np.ndarray, sheet: bool = False) -> float | None:
    ha, hb = lab_histogram(a), lab_histogram(b, key_light=sheet)
    if ha is None or hb is None:
        return None
    # Bhattacharyya distance 0 (same) … 1 (disjoint).
    return float(1 - cv2.compareHist(ha, hb, cv2.HISTCMP_BHATTACHARYYA))


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    a, b = a.astype(np.float64), b.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    blur = lambda x: cv2.GaussianBlur(x, (11, 11), 1.5)  # noqa: E731
    mu_a, mu_b = blur(a), blur(b)
    var_a, var_b, cov = blur(a * a) - mu_a ** 2, blur(b * b) - mu_b ** 2, blur(a * b) - mu_a * mu_b
    value = ((2 * mu_a * mu_b + c1) * (2 * cov + c2)) / ((mu_a ** 2 + mu_b ** 2 + c1) * (var_a + var_b + c2))
    return float(value.mean())


def head_crop(rgba: np.ndarray, p: np.ndarray, size: int = 96) -> np.ndarray | None:
    torso = torso_length(p)
    centre = p[0] if ok(p, 0) else ((p[1] + p[2]) / 2 if ok(p, 1, 2) else None)
    if torso is None or centre is None:
        return None
    half = int(0.5 * torso)
    x, y = int(centre[0]), int(centre[1] - 0.15 * torso)
    h, w = rgba.shape[:2]
    if x - half < 0 or y - half < 0 or x + half > w or y + half > h:
        return None
    crop = rgba[y - half:y + half, x - half:x + half].astype(np.float32)
    alpha = crop[:, :, 3:4] / 255
    grey = cv2.cvtColor((crop[:, :, :3] * alpha + 200 * (1 - alpha)).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    return cv2.resize(grey, (size, size), interpolation=cv2.INTER_AREA)


def continuity(current: np.ndarray, previous: np.ndarray, drawn: np.ndarray, drawn_prev: np.ndarray | None, report: Report) -> float | None:
    colours = histogram_similarity(current, previous)
    if colours is None:
        return None
    report.metrics["colourMatch"] = colours
    # Adjacent frames of one character: 0.8–0.95 (a pose shows more sleeve, less skirt); another palette: under 0.5.
    parts = [(float(np.clip((colours - 0.55) / 0.35, 0, 1)), 0.6)]
    if drawn_prev is not None:
        a, b = head_crop(current, drawn), head_crop(previous, drawn_prev)
        if a is not None and b is not None:
            value = ssim(a, b)
            report.metrics["headSsim"] = value
            # Measured on Muse Image's frames of one character: 0.4–0.5 from frame to frame (the head turns, hair moves).
            parts.append((float(np.clip((value - 0.1) / 0.35, 0, 1)), 0.4))
    return 100 * sum(v * w for v, w in parts) / sum(w for _, w in parts)


def motion(drawn: np.ndarray, drawn_prev: np.ndarray, source: np.ndarray, source_prev: np.ndarray, report: Report) -> float | None:
    td, ts = torso_length(drawn), torso_length(source)
    td_prev, ts_prev = torso_length(drawn_prev), torso_length(source_prev)
    if not all((td, ts, td_prev, ts_prev)):
        return None
    # Each joint relative to the shoulders' centre, in torso lengths: the figure's own motion, not where it stands. The
    # shoulders, not the hips: a skirt or a long coat hides the hips, and DWPose guesses them differently frame to frame.
    def rel(p: np.ndarray, torso: float) -> np.ndarray:
        root = (p[5] + p[6]) / 2 if ok(p, 5, 6) else np.nanmean(p[TORSO], axis=0)
        return (p - root) / torso
    expected = rel(source, ts) - rel(source_prev, ts_prev)
    actual = rel(drawn, td) - rel(drawn_prev, td_prev)
    scores = []
    for i in MOVING:
        if np.isnan(expected[i]).any() or np.isnan(actual[i]).any():
            continue
        err = float(np.linalg.norm(actual[i] - expected[i]))
        scores.append(float(np.clip(1 - max(0.0, err - 0.1) / 0.6, 0, 1)))
        if err > 0.35:
            report.notes.append(f"joint {i} moves {err:.2f} torso lengths differently from the video between the two frames")
    return 100 * float(np.mean(scores)) if scores else None


def silhouette(alpha: np.ndarray, mask: np.ndarray) -> float | None:
    a, b = alpha >= 128, mask >= 128
    union = np.logical_or(a, b).sum()
    return 100 * float(np.logical_and(a, b).sum() / union) if union else None


# ── All of it ───────────────────────────────────────────────────────────────

def measure(
    drawing: np.ndarray, target: dict, drawn: dict, *,
    previous: np.ndarray | None = None, drawn_prev: dict | None = None,
    source: dict | None = None, source_prev: dict | None = None,
    sheet: np.ndarray | None = None, person_mask: np.ndarray | None = None, reference: dict | None = None,
) -> Report:
    """`drawing`, `previous` and `sheet` are RGBA (h, w, 4) on the canvas; `person_mask` is (h, w) uint8."""
    report = Report()
    t = points(target)
    d = orient(points(drawn), t, report)
    d_prev = points(drawn_prev) if drawn_prev else None
    report.metrics["pose"] = pose_similarity(d, t, report)
    report.metrics["limbs"] = limb_directions(d, t, report)
    report.metrics["proportions"] = proportions(d, t, report, points(reference) if reference else None)
    report.metrics["integrity"] = integrity(drawing[:, :, 3], d, t, report)
    report.metrics["motion"] = motion(d, d_prev, points(source), points(source_prev), report) if d_prev is not None and source and source_prev else None
    report.metrics["continuity"] = continuity(drawing, previous, d, d_prev, report) if previous is not None else None
    identity = histogram_similarity(drawing, sheet, sheet=True) if sheet is not None else None
    # The drawing against the whole sheet: a pose shows other shares of the outfit, so 0.8 and up is the same palette.
    report.metrics["identity"] = None if identity is None else 100 * float(np.clip((identity - 0.45) / 0.4, 0, 1))
    report.metrics["silhouette"] = silhouette(drawing[:, :, 3], person_mask) if person_mask is not None else None
    return report


# ── Evidence picture ────────────────────────────────────────────────────────

GUIDE, DRAWN, BAD = (90, 200, 120), (235, 120, 40), (60, 60, 230)  # BGR


def overlay(drawing: np.ndarray, target: dict, drawn: dict, report: Report) -> np.ndarray:
    """The drawing on grey with the guide (green) and the drawn skeleton (orange); bad bones and fragments in red."""
    alpha = drawing[:, :, 3:4].astype(np.float32) / 255
    bgr = cv2.cvtColor(np.ascontiguousarray(drawing[:, :, :3]), cv2.COLOR_RGB2BGR).astype(np.float32)
    canvas = (bgr * alpha * 0.55 + 205 * (1 - alpha * 0.55)).astype(np.uint8)
    t, d = points(target), points(drawn)
    errors = {row["bone"]: row for row in report.bones}
    torso = torso_length(t) or 100
    width = max(3, int(torso * 0.035))
    for name, (a, b) in BONES.items():
        if ok(t, a, b):
            cv2.line(canvas, tuple(t[a].astype(int)), tuple(t[b].astype(int)), GUIDE, width * 2, cv2.LINE_AA)
    for a, b in ((5, 6), (11, 12), (5, 11), (6, 12)):
        if ok(t, a, b):
            cv2.line(canvas, tuple(t[a].astype(int)), tuple(t[b].astype(int)), GUIDE, width, cv2.LINE_AA)
    for name, (a, b) in BONES.items():
        if not ok(d, a, b):
            continue
        row = errors.get(name)
        bad = row is not None and row["score"] < 0.75
        cv2.line(canvas, tuple(d[a].astype(int)), tuple(d[b].astype(int)), BAD if bad else DRAWN, width, cv2.LINE_AA)
        if row and row["error"] is not None and row["error"] > ANGLE_NOISE:
            mid = ((d[a] + d[b]) / 2).astype(int)
            cv2.putText(canvas, f"{row['error']:.0f}", (int(mid[0]) + 6, int(mid[1])), cv2.FONT_HERSHEY_SIMPLEX, 0.9, BAD if bad else DRAWN, 2, cv2.LINE_AA)
    for i in range(BODY):
        if ok(d, i):
            cv2.circle(canvas, tuple(d[i].astype(int)), width + 1, DRAWN, -1, cv2.LINE_AA)
    for frag in report.fragments:
        x, y, w, h = frag["box"]
        cv2.rectangle(canvas, (x - 4, y - 4), (x + w + 4, y + h + 4), BAD, 3)
    if report.mirrored:
        cv2.putText(canvas, "MIRRORED", (24, 56), cv2.FONT_HERSHEY_SIMPLEX, 1.6, BAD, 4, cv2.LINE_AA)
    return canvas
