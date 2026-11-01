import cv2
import numpy as np

from app.pipeline import fidelity

# A standing figure on a 600×900 canvas, arms out to the sides (COCO body order).
STAND = np.array([
    [300, 150], [290, 140], [310, 140], [280, 145], [320, 145],
    [250, 220], [350, 220], [190, 230], [410, 230], [130, 240], [470, 240],
    [270, 420], [330, 420], [265, 580], [335, 580], [260, 740], [340, 740],
], dtype=float)
BONES = [(5, 7), (7, 9), (6, 8), (8, 10), (11, 13), (13, 15), (12, 14), (14, 16), (5, 6), (11, 12), (5, 11), (6, 12), (0, 5), (0, 6)]


def pose(points: np.ndarray) -> dict:
    return {"keypoints": points.tolist(), "scores": [0.9] * len(points)}


def draw(points: np.ndarray, colour=(200, 60, 60)) -> np.ndarray:
    image = np.zeros((900, 600, 4), np.uint8)
    for a, b in BONES:
        cv2.line(image, tuple(points[a].astype(int)), tuple(points[b].astype(int)), (*colour, 255), 22)
    cv2.circle(image, tuple(points[0].astype(int)), 45, (*colour, 255), -1)
    return image


def test_a_drawing_on_its_guide_scores_near_full_marks():
    report = fidelity.measure(draw(STAND), pose(STAND), pose(STAND))
    m = report.metrics
    assert m["pose"] > 99 and m["limbs"] > 99 and m["proportions"] > 99
    assert m["integrity"] > 90
    assert not report.mirrored and not report.fragments


def test_a_raised_arm_the_guide_doesnt_have_loses_limb_and_pose_marks():
    raised = STAND.copy()
    raised[8], raised[10] = [370, 140], [390, 60]
    report = fidelity.measure(draw(raised), pose(STAND), pose(raised))
    worst = max(report.bones, key=lambda row: row["error"] or 0)
    assert worst["bone"].startswith("right") and worst["error"] > 60
    assert report.metrics["limbs"] < 85
    assert report.metrics["integrity"] < 95


def test_a_mirrored_pose_is_called_mirrored():
    guide = STAND.copy()
    guide[8], guide[10] = [370, 140], [390, 60]  # right arm up, left arm out
    mirrored = STAND.copy()
    mirrored[7], mirrored[9] = [230, 140], [210, 60]  # left arm up, right arm out
    mirrored[8], mirrored[10] = [410, 230], [470, 240]
    report = fidelity.measure(draw(mirrored), pose(guide), pose(mirrored))
    assert report.mirrored


def test_swapped_labels_on_a_right_drawing_are_not_its_fault():
    guide = STAND.copy()
    guide[8], guide[10] = [370, 140], [390, 60]
    report = fidelity.measure(draw(guide), pose(guide), pose(guide[fidelity.SWAP]))
    assert not report.mirrored
    assert report.metrics["limbs"] > 99


def test_a_stretched_limb_costs_proportions():
    long = STAND.copy()
    long[15] = [260, 860]
    report = fidelity.measure(draw(long), pose(STAND), pose(long))
    assert report.metrics["proportions"] < 97


def test_a_loose_fragment_is_found():
    image = draw(STAND)
    cv2.circle(image, (540, 820), 18, (200, 60, 60, 255), -1)
    report = fidelity.measure(image, pose(STAND), pose(STAND))
    assert len(report.fragments) == 1


def test_continuity_tells_the_same_drawing_from_a_recoloured_one():
    same = fidelity.measure(draw(STAND), pose(STAND), pose(STAND), previous=draw(STAND), drawn_prev=pose(STAND))
    other = fidelity.measure(draw(STAND), pose(STAND), pose(STAND), previous=draw(STAND, (40, 160, 230)), drawn_prev=pose(STAND))
    assert same.metrics["continuity"] > 95
    assert other.metrics["continuity"] < same.metrics["continuity"] - 30


def test_motion_follows_the_video_and_flags_a_jump():
    step = STAND.copy()
    step[9] += [0, -30]
    follows = fidelity.measure(draw(step), pose(step), pose(step), previous=draw(STAND), drawn_prev=pose(STAND), source=pose(step), source_prev=pose(STAND))
    jump = STAND.copy()
    jump[9] += [0, -200]
    jumps = fidelity.measure(draw(jump), pose(step), pose(jump), previous=draw(STAND), drawn_prev=pose(STAND), source=pose(step), source_prev=pose(STAND))
    assert follows.metrics["motion"] > 98
    assert jumps.metrics["motion"] < follows.metrics["motion"] - 5


def test_overlay_is_the_canvas_size():
    report = fidelity.measure(draw(STAND), pose(STAND), pose(STAND))
    assert fidelity.overlay(draw(STAND), pose(STAND), pose(STAND), report).shape == (900, 600, 3)


def test_identity_keys_out_the_sheets_white_backdrop():
    figure = draw(STAND)
    cv2.fillPoly(figure, [STAND[[5, 6, 12, 11]].astype(np.int32)], (200, 60, 60, 255))  # a body, not a wireframe
    sheet = np.full((900, 600, 4), 255, np.uint8)
    sheet[:, :, :3] = np.where(figure[:, :, 3:4] > 0, figure[:, :, :3], 255)  # the figure on opaque white
    report = fidelity.measure(figure, pose(STAND), pose(STAND), sheet=sheet)
    assert report.metrics["identity"] > 95


def test_limb_lengths_are_held_to_the_sheet_not_the_foreshortened_guide():
    short_guide = STAND.copy()
    short_guide[9] = [170, 235]  # the guide's left forearm seen end-on
    report = fidelity.measure(draw(STAND), pose(short_guide), pose(STAND), reference=pose(STAND))
    assert report.metrics["proportions"] > 99


def test_an_arm_whose_hand_lands_right_survives_a_hidden_elbow():
    guide = STAND.copy()
    guide[7], guide[9] = [230, 330], [260, 240]  # left arm: elbow down at the side, hand up at the chest
    sleeve = guide.copy()
    sleeve[7] = [150, 360]  # the estimator puts the elbow at the end of a wide sleeve
    report = fidelity.measure(draw(sleeve), pose(guide), pose(sleeve))
    rows = {row["bone"]: row for row in report.bones}
    assert rows["left upper arm"]["error"] > 20
    assert rows["left upper arm"]["score"] >= fidelity.HAND_FLOOR
    wrong = guide.copy()
    wrong[7], wrong[9] = [150, 360], [100, 420]  # the hand far from the guide's: a real error stays one
    rows = {row["bone"]: row for row in fidelity.measure(draw(wrong), pose(guide), pose(wrong)).bones}
    assert rows["left forearm"]["score"] < 0.5
