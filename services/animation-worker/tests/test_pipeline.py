"""The whole worker run against a local stand-in for Focus's signed routes.

Real FFmpeg, real uploads over HTTP; the pose estimator is a scripted stick
figure and the engine is the test engine, so no model weights or GPU are used.
"""

import asyncio
import hashlib
import json
import subprocess
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.config import settings
from app.orchestration import Registry
from app.schemas import OUTPUT_NAMES, Manifest

from .conftest import stick_figure


class FocusStub(BaseHTTPRequestHandler):
    files: dict[str, bytes] = {}
    received: dict[str, bytes] = {}

    def log_message(self, *args):  # quiet
        pass

    def do_GET(self):
        name = self.path.split("?")[0].rsplit("/", 1)[-1]
        body = self.files.get(name)
        self.send_response(200 if body else 404)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_PUT(self):
        name = self.path.split("?")[0].rsplit("/", 1)[-1]
        self.received[name] = self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(201)
        self.end_headers()


@pytest.fixture()
def focus(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "allow_insecure", True)
    video = tmp_path / "driving.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=24:duration=2", "-pix_fmt", "yuv420p", str(video)], check=True)
    image = np.full((768, 512, 3), 235, dtype=np.uint8)
    cv2.circle(image, (256, 200), 60, (90, 60, 200), -1)
    character = tmp_path / "character.png"
    cv2.imwrite(str(character), image)
    FocusStub.files = {"driving.mp4": video.read_bytes(), "character.png": character.read_bytes()}
    FocusStub.received = {}
    server = ThreadingHTTPServer(("127.0.0.1", 0), FocusStub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def manifest_for(base: str, **extra) -> Manifest:
    job = str(uuid.uuid4())
    url = lambda name: f"{base}/api/animations/worker/{job}/{name}?a=1&exp=9999999999&sig=x"  # noqa: E731
    sha = {name: hashlib.sha256(body).hexdigest() for name, body in FocusStub.files.items()}
    return Manifest(
        jobId=job, attempt=1, engine="fake", mode="animation", seed=3, resolution="480p", outputFps=24, durationSeconds=2,
        interpolation=False, keepAudio=False,
        inputs={"character": {"url": url("character.png"), "sha256": sha["character.png"]}, "driving": {"url": url("driving.mp4"), "sha256": sha["driving.mp4"]}},
        uploads={name: url(name) for name in OUTPUT_NAMES}, deadlineSeconds=600, **extra,
    )


def scripted_registry(people: bool = True) -> Registry:
    registry = Registry()
    frame = {"t": 0}

    def estimator(image):
        if not people:
            return np.zeros((0, 133, 2)), np.zeros((0, 133))
        if image.shape[:2] == (768, 512):  # the character image
            return (stick_figure(0, 512, 768) * 1.1)[None], np.full((1, 133), 0.9)
        frame["t"] += 1
        return stick_figure(frame["t"])[None], np.full((1, 133), 0.9)

    registry._estimator = estimator
    return registry


async def test_a_full_run_uploads_verified_outputs(focus):
    registry = scripted_registry()
    run = registry.start(manifest_for(focus))
    await run.task
    assert run.error is None, run.error
    assert run.stage == "completed"
    assert run.synthetic is True
    for name in ("animation.mp4", "preview.webp", "pose_overlay.mp4", "poses.json", "retargeted_poses.json", "retargeted_pose_preview.mp4", "frames.zip", "quality_report.json", "render_report.json"):
        assert name in FocusStub.received, name
    report = json.loads(FocusStub.received["render_report.json"])
    assert report["synthetic"] is True
    assert report["output"]["codec"] == "h264" and report["output"]["pix_fmt"] == "yuv420p"
    assert report["output"]["frames"] == 48
    poses = json.loads(FocusStub.received["poses.json"])
    assert len(poses["frames"]) == 48
    assert not (settings.work_root / run.manifest.jobId).exists()  # temp files removed


async def test_no_person_fails_with_pose_not_found_and_keeps_diagnostics(focus):
    registry = scripted_registry(people=False)
    run = registry.start(manifest_for(focus))
    await run.task
    assert run.stage == "failed"
    assert run.error.code == "POSE_NOT_FOUND"
    assert "pose_overlay.mp4" in FocusStub.received
    assert "animation.mp4" not in FocusStub.received


async def test_a_wrong_checksum_is_invalid_input(focus):
    registry = scripted_registry()
    manifest = manifest_for(focus)
    manifest.inputs.driving.sha256 = "0" * 64
    run = registry.start(manifest)
    await run.task
    assert run.error.code == "INPUT_INVALID"


async def test_cancel_stops_the_run_and_same_attempt_is_idempotent(focus):
    registry = scripted_registry()
    manifest = manifest_for(focus)
    run = registry.start(manifest)
    assert registry.start(manifest) is run
    await asyncio.sleep(0.05)
    registry.cancel(manifest.jobId)
    await asyncio.gather(run.task, return_exceptions=True)
    assert run.stage == "cancelled"
