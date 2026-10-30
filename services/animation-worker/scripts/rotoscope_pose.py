"""Rotoscope helper: DWPose on still images and pose guides for the generator.

  detect --images DIR --out poses.json        one subject per PNG (sorted by name)
  detect --image FILE --out pose.json         a single image
  guides --source poses.json --character pose.json --out DIR [--head-top Y]

Transparent PNGs are composited on mid gray first so DWPose sees the figure.
Guides redraw the source skeleton with the character's own proportions
(shoulder and hip widths, bone lengths, head size from the real jaw line and
the hair top), placed where the source subject stands. A bone the camera sees shortened (pointing at the lens) keeps
that shortening, so the guide never stretches a foreshortened limb to full
length. The generator gets the pose and position, never the source person's look.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline.pose import CONFIDENT, L_HIP, L_SHOULDER, R_HIP, R_SHOULDER, PoseTrack, dwpose_estimator, extract  # noqa: E402

# Subject's right side warm, left side cool, so the generator can tell them apart.
RIGHT, LEFT, CENTER = (40, 40, 230), (230, 120, 30), (60, 170, 60)  # BGR
LIMBS = [
    ((6, 8), RIGHT), ((8, 10), RIGHT), ((12, 14), RIGHT), ((14, 16), RIGHT), ((16, 20), RIGHT), ((16, 22), RIGHT),
    ((5, 7), LEFT), ((7, 9), LEFT), ((11, 13), LEFT), ((13, 15), LEFT), ((15, 17), LEFT), ((15, 19), LEFT),
    ((5, 6), CENTER), ((11, 12), CENTER), ((5, 11), CENTER), ((6, 12), CENTER),
]
HAND_EDGES = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (0, 9), (9, 10), (10, 11), (11, 12), (0, 13), (13, 14), (14, 15), (15, 16), (0, 17), (17, 18), (18, 19), (19, 20)]
LEFT_HAND, RIGHT_HAND = 91, 112
# Skull height over the jaw-line ends, in jaw widths, when the sheet's hair top is unknown.
SKULL_DEFAULT = 0.6
# The shortest share of the sheet's limb length the source's reach may cap a limb at.
SHEET_FLOOR = 0.85


def load(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise SystemExit(f"cannot read {path}")
    if image.ndim == 3 and image.shape[2] == 4:
        alpha = image[:, :, 3:4].astype(np.float32) / 255
        image = (image[:, :, :3].astype(np.float32) * alpha + 128 * (1 - alpha)).astype(np.uint8)
    return image


def detect(paths: list[Path]) -> dict:
    estimator = dwpose_estimator(device="cpu", mode="performance")
    frames = [load(p) for p in paths]
    track = extract(iter(frames), estimator, fps=1.0)
    data = track.to_json()
    data["files"] = [p.name for p in paths]
    return data


def track_from(data: dict) -> PoseTrack:
    points = np.array([[[np.nan if v is None else v for v in xy] for xy in f["keypoints"]] for f in data["frames"]], dtype=np.float32)
    scores = np.array([f["scores"] for f in data["frames"]], dtype=np.float32)
    points[scores < CONFIDENT] = np.nan
    return PoseTrack(data["width"], data["height"], data.get("fps", 1.0), points, scores, [f.get("persons") or 0 for f in data["frames"]])


def root(points: np.ndarray) -> np.ndarray:
    return np.nanmean(points[[L_HIP, R_HIP]], axis=0)


def torso(points: np.ndarray) -> float:
    return float(np.linalg.norm(np.nanmean(points[[L_SHOULDER, R_SHOULDER]], axis=0) - root(points)))


def draw(points: np.ndarray, size: tuple[int, int], skull: float = SKULL_DEFAULT) -> np.ndarray:
    width, height = size
    canvas = np.full((height, width, 3), 255, np.uint8)
    thickness = max(3, round(height / 220))

    def ok(p: np.ndarray) -> bool:
        return bool(np.isfinite(p).all())

    for (a, b), color in LIMBS:
        if ok(points[a]) and ok(points[b]):
            cv2.line(canvas, tuple(int(v) for v in points[a]), tuple(int(v) for v in points[b]), color, thickness, cv2.LINE_AA)
    for base, color in ((LEFT_HAND, LEFT), (RIGHT_HAND, RIGHT)):
        for a, b in HAND_EDGES:
            if ok(points[base + a]) and ok(points[base + b]):
                cv2.line(canvas, tuple(int(v) for v in points[base + a]), tuple(int(v) for v in points[base + b]), color, max(1, thickness // 2), cv2.LINE_AA)
    jaw = [points[i] for i in JAW if ok(points[i])]
    if len(jaw) >= 9:
        # The head at the character's size: its jaw line, and the skull as the arc over it,
        # as tall over the jaw as the character's hair top is on the sheet.
        cv2.polylines(canvas, [np.array(jaw, dtype=np.int32)], False, CENTER, thickness, cv2.LINE_AA)
        a, b = jaw[0], jaw[-1]
        centre = (a + b) / 2
        width = float(np.linalg.norm(b - a))
        angle = float(np.degrees(np.arctan2(b[1] - a[1], b[0] - a[0])))
        # The cranium is wider than the jaw line (temples, ears, hair): a quarter wider.
        cv2.ellipse(canvas, tuple(int(v) for v in centre), (int(width * 0.62), int(width * skull)), angle, 180, 360, CENTER, thickness, cv2.LINE_AA)
    elif ok(points[0]):  # no face points: a circle around the nose sized from the shoulders
        span = np.linalg.norm(points[5] - points[6]) if ok(points[5]) and ok(points[6]) else height / 20
        cv2.circle(canvas, tuple(int(v) for v in points[0]), int(span * 0.45), CENTER, thickness, cv2.LINE_AA)
    if ok(points[0]) and ok(points[5]) and ok(points[6]):  # the neck
        cv2.line(canvas, tuple(int(v) for v in points[0]), tuple(int(v) for v in (points[5] + points[6]) / 2), CENTER, thickness, cv2.LINE_AA)
    for index in range(17):
        if ok(points[index]):
            cv2.circle(canvas, tuple(int(v) for v in points[index]), thickness + 2, (30, 30, 30), -1, cv2.LINE_AA)
    return canvas


# Limb bones, parent → child, measured on the character and redrawn per frame.
LIMB_BONES = [(5, 7), (7, 9), (6, 8), (8, 10), (11, 13), (13, 15), (12, 14), (14, 16)]
JAW = list(range(23, 40))  # COCO-WholeBody face 0–16: the jaw line, ear to ear through the chin
CHIN = 31


def unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if np.isfinite(n) and n > 1e-6 else np.full(2, np.nan)


def length(p: np.ndarray, a: int, b: int) -> float:
    return float(np.linalg.norm(p[b] - p[a]))


def jaw_width(p: np.ndarray) -> float:
    """Ear-to-ear width of the jaw line: the face's own size, steady under head tilt."""
    return length(p, JAW[0], JAW[-1]) if np.isfinite(p[[JAW[0], JAW[-1]]]).all() else float("nan")


def full_lengths(frames: np.ndarray, ref_ratio: dict, torso_median: float) -> dict:
    """How long each source bone is when it isn't foreshortened: its longest look in the clip (90th
    percentile), and never less than the character's own ratio would give the source's torso."""
    out = {}
    for a, b in LIMB_BONES:
        seen = [length(f, a, b) for f in frames if np.isfinite(f[[a, b]]).all()]
        clip = float(np.percentile(seen, 90)) if seen else 0.0
        out[(a, b)] = max(clip, 0.9 * ref_ratio[(a, b)] * torso_median)
    return out


def rotoscope_retarget(track: PoseTrack, placed: np.ndarray) -> np.ndarray:
    """The source pose on the character's proportions, frame by frame.

    Torso, shoulder and hip widths and every limb take the character's lengths;
    directions come from the source. Each bone keeps the source's shortening
    (its length now ÷ its full length), so an arm pointing at the camera stays short.
    Hands, feet and face follow their joint at the character's scale."""
    frames = track.keypoints
    ref_torso = torso(placed)
    torsos = [t for f in frames if np.isfinite(t := torso(f)) and t > 0]
    torso_median = float(np.median(torsos))
    ref_len = {bone: length(placed, *bone) for bone in LIMB_BONES}
    # The character sheet may hide a bone (a hand in a pocket): use the longer side for both.
    for left, right in [((5, 7), (6, 8)), ((7, 9), (8, 10)), ((11, 13), (12, 14)), ((13, 15), (14, 16))]:
        longest = np.nanmax([ref_len[left], ref_len[right]])
        ref_len[left] = ref_len[right] = float(longest)
    # A sheet measures limbs badly when they are bent or turned (three-quarter view, clasped hands)
    # and tends to read them long. No limb may be longer, against the torso, than the source shows
    # it at its most extended: over-long arms and legs are what the generator then copies. But a
    # clip that never extends a limb (an arm raised toward the camera throughout) would make its
    # shortened look the full length: never below SHEET_FLOOR of the sheet (body-map.ts sheetLengths).
    for bone in LIMB_BONES:
        seen = [length(f, *bone) / t for f in frames if np.isfinite(f[list(bone)]).all() and np.isfinite(t := torso(f)) and t > 0]
        if seen:
            ref_len[bone] = max(SHEET_FLOOR * ref_len[bone], min(ref_len[bone], float(np.percentile(seen, 90)) * ref_torso))
    ref_ratio = {bone: ref_len[bone] / ref_torso for bone in LIMB_BONES}
    full = full_lengths(frames, ref_ratio, torso_median)
    spans = {pair: float(np.nanmedian([length(f, *pair) for f in frames])) for pair in [(5, 6), (11, 12)]}
    ref_span = {pair: length(placed, *pair) for pair in [(5, 6), (11, 12)]}
    # A sheet drawn in three-quarter view measures narrow shoulders and hips: never narrower
    # than the source's widest look on the character's torso, so the guide isn't pinched.
    for pair in ref_span:
        seen = [length(f, *pair) for f in frames if np.isfinite(f[list(pair)]).all()]
        if seen:
            ref_span[pair] = max(ref_span[pair], 0.9 * float(np.percentile(seen, 90)) / torso_median * ref_torso)
    ref_neck = (placed[5] + placed[6]) / 2
    ref_head = placed[0] - ref_neck
    # The face at the character's size: jaw width on the sheet over the source's usual jaw
    # width. Nose-to-neck distance changes with every nod, so it is only the fallback.
    source_jaws = [w for f in frames if np.isfinite(w := jaw_width(f)) and w > 0]
    if np.isfinite(jaw_width(placed)) and source_jaws:
        face_scale = jaw_width(placed) / float(np.median(source_jaws))
    else:
        face_scale = float(np.linalg.norm(ref_head)) / max(1e-6, float(np.nanmedian([np.linalg.norm(f[0] - (f[5] + f[6]) / 2) for f in frames])))
    limb_scale = {9: ref_len[(7, 9)] / max(1e-6, full[(7, 9)]), 10: ref_len[(8, 10)] / max(1e-6, full[(8, 10)]),
                  15: ref_len[(13, 15)] / max(1e-6, full[(13, 15)]), 16: ref_len[(14, 16)] / max(1e-6, full[(14, 16)])}

    out = np.full_like(frames, np.nan)
    for t, p in enumerate(frames):
        q = out[t]
        hips = (p[11] + p[12]) / 2
        if not np.isfinite(hips).all():
            continue
        shoulders_mid = (p[5] + p[6]) / 2
        # Widths turn with the body: the source's width now ÷ its usual width, on the character's width.
        for (a, b), centre in [((11, 12), hips), ((5, 6), None)]:
            turn = np.clip(length(p, a, b) / max(1e-6, spans[(a, b)]), 0.2, 1.15)
            if centre is None:
                stretch = np.clip(float(np.linalg.norm(shoulders_mid - hips)) / torso_median, 0.5, 1.15)
                centre = hips + unit(shoulders_mid - hips) * ref_torso * stretch
            half = unit(p[a] - p[b]) * ref_span[(a, b)] * turn / 2
            q[a], q[b] = centre + half, centre - half
        neck = (q[5] + q[6]) / 2
        source_neck = shoulders_mid
        head = p[0] - source_neck
        if np.isfinite(head).all():
            q[0] = neck + unit(head) * float(np.linalg.norm(ref_head)) * np.clip(float(np.linalg.norm(head)) * face_scale / float(np.linalg.norm(ref_head)), 0.3, 1.1)
        for a, b in LIMB_BONES:
            if not np.isfinite(p[[a, b]]).all() or not np.isfinite(q[a]).all():
                continue
            shortening = np.clip(length(p, a, b) / full[(a, b)], 0.12, 1.0)
            q[b] = q[a] + unit(p[b] - p[a]) * ref_len[(a, b)] * shortening
        # Face and head features ride on the nose; hands on the wrists; feet on the ankles.
        if np.isfinite(q[0]).all():
            for i in [1, 2, 3, 4, *range(23, 91)]:
                if np.isfinite(p[i]).all() and np.isfinite(p[0]).all():
                    q[i] = q[0] + (p[i] - p[0]) * face_scale
        for wrist, base in [(9, 91), (10, 112)]:
            if np.isfinite(q[wrist]).all():
                for i in range(base, base + 21):
                    if np.isfinite(p[i]).all():
                        q[i] = q[wrist] + (p[i] - p[wrist]) * limb_scale[wrist]
        for ankle, toes in [(15, (17, 18, 19)), (16, (20, 21, 22))]:
            if np.isfinite(q[ankle]).all():
                for i in toes:
                    if np.isfinite(p[i]).all():
                        q[i] = q[ankle] + (p[i] - p[ankle]) * limb_scale[ankle]
    return out


def guides(source: dict, character: dict, out: Path, head_top: float | None = None) -> dict:
    track = track_from(source)
    reference = track_from(character).keypoints[0]
    first_root = next((r for f in track.keypoints if np.isfinite(r := root(f)).all()), None)
    torsos = [t for f in track.keypoints if np.isfinite(t := torso(f)) and t > 0]
    if first_root is None or not torsos or not np.isfinite(torso(reference)):
        raise SystemExit("no usable pose in the source frames or the character image")
    # The character in source-frame pixels: same torso length, standing on the source's first hip position.
    placed = (reference - root(reference)) * (float(np.median(torsos)) / torso(reference)) + first_root
    points = rotoscope_retarget(track, placed)
    # The skull's height over the jaw, from the sheet's hair top: the guide's head is the character's.
    skull = SKULL_DEFAULT
    if head_top is not None and np.isfinite(jaw_width(reference)) and jaw_width(reference) > 0:
        jaw_mid = (reference[JAW[0]] + reference[JAW[-1]]) / 2
        skull = float(np.clip((jaw_mid[1] - head_top) / jaw_width(reference), 0.4, 1.6))
    out.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(source["files"]):
        cv2.imwrite(str(out / name), draw(points[index], (track.width, track.height), skull))
    guide = PoseTrack(track.width, track.height, track.fps, points, np.where(np.isfinite(points).all(axis=2), 1.0, 0.0).astype(np.float32), track.persons).to_json()
    guide["files"] = source["files"]
    guide["skull"] = skull
    (out / "guides.json").write_text(json.dumps(guide))
    width, height = track.width, track.height
    outside = [t for t in range(len(points)) if np.isfinite(points[t, :23]).all(axis=1).any() and ((points[t, :23] < 0).any() or (points[t, :23, 0] > width).any() or (points[t, :23, 1] > height).any())]
    return {"usable": True, "framesOutsideImage": outside, "skull": round(skull, 3)}


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    d = sub.add_parser("detect")
    d.add_argument("--images", type=Path)
    d.add_argument("--image", type=Path)
    d.add_argument("--out", type=Path, required=True)
    g = sub.add_parser("guides")
    g.add_argument("--source", type=Path, required=True)
    g.add_argument("--character", type=Path, required=True)
    g.add_argument("--out", type=Path, required=True)
    g.add_argument("--head-top", type=float, help="the character sheet's hair top, in sheet pixels")
    args = parser.parse_args()
    if args.command == "detect":
        paths = sorted(args.images.glob("*.png")) if args.images else [args.image]
        args.out.write_text(json.dumps(detect(paths)))
    else:
        report = guides(json.loads(args.source.read_text()), json.loads(args.character.read_text()), args.out, args.head_top)
        print(json.dumps({k: v for k, v in report.items() if k != "boneSource"}))


if __name__ == "__main__":
    main()
