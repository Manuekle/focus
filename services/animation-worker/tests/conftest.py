import numpy as np
import pytest

from app.config import settings

TOKEN = "t" * 32


@pytest.fixture(autouse=True)
def _settings(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "token", TOKEN)
    monkeypatch.setattr(settings, "allowed_hosts", frozenset({"127.0.0.1", "focus.example"}))
    monkeypatch.setattr(settings, "allow_insecure", False)
    monkeypatch.setattr(settings, "allow_fake_engine", True)
    monkeypatch.setattr(settings, "work_root", tmp_path / "work")


def stick_figure(t: int, width: int = 360, height: int = 640) -> np.ndarray:
    """A 133-point COCO-WholeBody person whose right forearm swings over time."""
    points = np.full((133, 2), np.nan, dtype=np.float32)
    cx = width / 2
    body = {
        0: (cx, 120), 1: (cx - 8, 112), 2: (cx + 8, 112), 3: (cx - 16, 118), 4: (cx + 16, 118),
        5: (cx - 50, 180), 6: (cx + 50, 180), 7: (cx - 70, 260), 8: (cx + 70, 260),
        11: (cx - 35, 340), 12: (cx + 35, 340), 13: (cx - 40, 440), 14: (cx + 40, 440), 15: (cx - 42, 540), 16: (cx + 42, 540),
        17: (cx - 60, 560), 18: (cx - 50, 560), 19: (cx - 40, 556), 20: (cx + 60, 560), 21: (cx + 50, 560), 22: (cx + 40, 556),
    }
    for joint, (x, y) in body.items():
        points[joint] = (x, y)
    angle = np.pi / 2 - (t % 24) / 24 * np.pi / 2
    points[9] = points[7] + 70 * np.array([0, 1])
    points[10] = points[8] + 70 * np.array([np.cos(angle), np.sin(angle)])
    for base, wrist in ((91, 9), (112, 10)):
        for k in range(21):
            points[base + k] = points[wrist] + (k % 5 * 3, k // 5 * 3)
    for k in range(23, 91):
        points[k] = points[0] + (np.cos(k) * 10, np.sin(k) * 10)
    return points
