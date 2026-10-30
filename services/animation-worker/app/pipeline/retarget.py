"""Basic retargeting: the driving motion on the target character's proportions.

The driving skeleton is rebuilt bone by bone from the hips with the target's
bone lengths (measured on the character image), keeping the driving bone
directions. Hands, feet and face follow their parent joint at the global
scale. The engines run their own official preprocessing; this result is the
preview shown before paying for inference, plus out-of-frame checks.
"""

from __future__ import annotations

import numpy as np

from .pose import L_HIP, R_HIP, PoseTrack

ROOT = -1
PARENT: dict[int, int] = {
    11: ROOT, 12: ROOT, 5: ROOT, 6: ROOT, 0: ROOT,
    7: 5, 9: 7, 8: 6, 10: 8,
    13: 11, 15: 13, 14: 12, 16: 14,
    1: 0, 2: 0, 3: 1, 4: 2,
    17: 15, 18: 15, 19: 15, 20: 16, 21: 16, 22: 16,
}
ORDER = [11, 12, 5, 6, 0, 7, 8, 9, 10, 13, 14, 15, 16, 1, 2, 3, 4, 17, 18, 19, 20, 21, 22]
RIGID = [(range(91, 112), 9), (range(112, 133), 10), (range(23, 91), 0)]  # left hand → left wrist, right hand → right wrist, face → nose


def _root(points: np.ndarray) -> np.ndarray:
    return np.nanmean(points[[L_HIP, R_HIP]], axis=0)


def _length(points: np.ndarray, joint: int) -> float:
    parent = PARENT[joint]
    base = _root(points) if parent == ROOT else points[parent]
    return float(np.linalg.norm(points[joint] - base))


def bone_lengths(points: np.ndarray) -> dict[int, float]:
    return {j: length for j in ORDER if np.isfinite(length := _length(points, j)) and length > 0}


def retarget(track: PoseTrack, reference: np.ndarray, size: tuple[int, int]) -> tuple[np.ndarray, dict]:
    """Returns retargeted keypoints (T, 133, 2) in the character image's pixels and a report."""
    frames = track.keypoints
    if not len(frames):
        return frames.copy(), {"usable": False, "reason": "no frames"}
    driving_lengths = {j: float(np.nanmedian([_length(f, j) for f in frames])) for j in ORDER}
    target_lengths = bone_lengths(reference)
    torso_d = np.nanmedian([np.linalg.norm(np.nanmean(f[[5, 6]], axis=0) - _root(f)) for f in frames])
    ref_torso = np.linalg.norm(np.nanmean(reference[[5, 6]], axis=0) - _root(reference))
    usable_reference = np.isfinite(ref_torso) and ref_torso > 0 and np.isfinite(_root(reference)).all()
    scale = float(ref_torso / torso_d) if usable_reference and torso_d > 0 else 1.0
    lengths = {j: target_lengths.get(j, scale * driving_lengths[j]) for j in ORDER}
    first_root = next((r for f in frames if np.isfinite(r := _root(f)).all()), None)
    anchor = _root(reference) if usable_reference else first_root

    out = np.full_like(frames, np.nan)
    for t, points in enumerate(frames):
        root = _root(points)
        if not np.isfinite(root).all() or first_root is None:
            continue
        new_root = anchor + scale * (root - first_root)
        for joint in ORDER:
            parent = PARENT[joint]
            base_d = root if parent == ROOT else points[parent]
            base_n = new_root if parent == ROOT else out[t, parent]
            vector = points[joint] - base_d
            norm = float(np.linalg.norm(vector))
            if not np.isfinite(norm) or norm == 0 or not np.isfinite(base_n).all():
                continue
            out[t, joint] = base_n + vector / norm * lengths[joint]
        for joints, parent in RIGID:
            idx = list(joints)
            out[t, idx] = out[t, parent] + scale * (points[idx] - points[parent])

    width, height = size
    outside = []
    for t in range(len(out)):
        body = out[t, :23]
        finite = np.isfinite(body).all(axis=1)
        if finite.any():
            b = body[finite]
            if (b[:, 0] < 0).any() or (b[:, 0] > width).any() or (b[:, 1] < 0).any() or (b[:, 1] > height).any():
                outside.append(t)
    return out, {
        "usable": True,
        "referencePoseFound": bool(usable_reference),
        "scale": round(scale, 4),
        "boneSource": {str(j): ("character" if j in target_lengths else "driving") for j in ORDER},
        "framesOutsideCharacterImage": outside,
    }
