import numpy as np

from app.pipeline import pose, retarget

from .conftest import stick_figure


def track_of(frames: list[np.ndarray], fps: float = 24) -> pose.PoseTrack:
    points = np.stack(frames)
    scores = np.where(np.isnan(points).any(axis=2), 0.0, 0.9).astype(np.float32)
    return pose.PoseTrack(360, 640, fps, points, scores, [1] * len(frames))


def test_short_dropouts_are_held_and_long_ones_stay_missing():
    frames = [stick_figure(t) for t in range(20)]
    for t in (5, 6):
        frames[t][10] = np.nan
    for t in range(10, 16):
        frames[t][9] = np.nan
    smoothed = pose.smooth(track_of(frames))
    assert not np.isnan(smoothed.keypoints[5:7, 10]).any()
    assert np.isnan(smoothed.keypoints[13:16, 9]).all()  # beyond the 3-frame gap: reported, not invented


def test_one_euro_follows_a_fast_move_without_much_lag():
    filt = pose.OneEuro(24)
    values = [filt(np.array([0.0, 0.0]))] + [filt(np.array([100.0, 0.0])) for _ in range(4)]
    assert values[2][0] > 80


def test_quality_report_flags_missing_subjects_and_jumps():
    frames = [stick_figure(t) for t in range(10)]
    frames[3][:] = np.nan
    frames[7] = frames[7] + np.array([200, 0], dtype=np.float32)
    report = pose.quality_report(track_of(frames))
    assert report["framesWithSubject"] == 9
    assert "subject_not_found" in report["perFrame"][3]["issues"]
    assert 7 in report["jumpFrames"]


def test_extract_follows_the_largest_person_then_the_nearest():
    def estimator(frame):
        t = int(frame[0, 0, 0])
        small = stick_figure(t) * 0.5
        big = stick_figure(t)
        order = [small, big] if t % 2 else [big, small]
        return np.stack(order), np.full((2, 133), 0.9)

    frames = (np.full((640, 360, 3), t, dtype=np.uint8) for t in range(6))
    track = pose.extract(frames, estimator, 24)
    assert track.persons == [2] * 6
    assert np.allclose(track.keypoints[:, 0], [stick_figure(t)[0] for t in range(6)])


def test_retarget_keeps_directions_and_takes_the_character_bone_lengths():
    frames = [stick_figure(t) for t in range(24)]
    reference = stick_figure(0) * 1.5  # a taller character
    out, report = retarget.retarget(track_of(frames), reference, (540, 960))
    assert report["referencePoseFound"]
    assert report["scale"] == 1.5
    for t in (0, 12):
        forearm = out[t, 10] - out[t, 8]
        driving = frames[t][10] - frames[t][8]
        assert np.isclose(np.linalg.norm(forearm), np.linalg.norm(reference[10] - reference[8]), atol=0.5)
        assert np.allclose(forearm / np.linalg.norm(forearm), driving / np.linalg.norm(driving), atol=1e-3)
