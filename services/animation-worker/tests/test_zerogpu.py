"""The ZeroGPU provider against a stand-in gradio_client: no network, no quota spent."""

import asyncio
import importlib.machinery
import sys
import types
from pathlib import Path

import pytest

from app.config import settings
from app.providers import wan_zerogpu
from app.providers.base import AnimationRequest, EngineError
from app.providers.wan_zerogpu import WanZeroGpuProvider, classify

PARAMS = [{"parameter_name": n} for n in ("input_video", "max_duration_s", "edited_frame", "rc_str", "resolution_choice")]


class FakeJob:
    def __init__(self, result, polls=2, error=None):
        self._result, self._polls, self._error = result, polls, error
        self.cancelled = False

    def done(self):
        self._polls -= 1
        return self._polls < 0

    def status(self):
        return types.SimpleNamespace(code=types.SimpleNamespace(name="IN_QUEUE"), rank=0, eta=12.0)

    def outputs(self):
        return []

    def result(self):
        if self._error:
            raise self._error
        return self._result

    def cancel(self):
        self.cancelled = True


@pytest.fixture()
def fake_gradio(monkeypatch, tmp_path):
    state = {"submits": [], "job": None, "params": PARAMS}
    video = tmp_path / "space-output.mp4"
    video.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"0" * 64)

    class Client:
        def __init__(self, space, hf_token=None, verbose=False, download_files=None):
            state["space"], state["token"] = space, hf_token

        def view_api(self, return_format="dict", print_info=False):
            return {"named_endpoints": {"/animate_scene": {"parameters": state["params"]}}}

        def submit(self, **kwargs):
            state["submits"].append(kwargs)
            state["job"] = state.get("next_job") or FakeJob((str(video), None, None, None, None))
            return state["job"]

    module = types.ModuleType("gradio_client")
    module.__spec__ = importlib.machinery.ModuleSpec("gradio_client", None)
    module.Client = Client
    module.handle_file = lambda path: {"path": path}
    monkeypatch.setitem(sys.modules, "gradio_client", module)
    monkeypatch.setattr(wan_zerogpu, "_space_commit", lambda: "abc123")
    monkeypatch.setattr(wan_zerogpu, "POLL_SECONDS", 0)
    monkeypatch.setattr(settings, "zerogpu_space", "someone/wan-demo")
    monkeypatch.setattr(settings, "zerogpu_low_res", True)
    return state


def request_for(tmp_path: Path, seconds: float = 2, resolution: str = "480p") -> AnimationRequest:
    (tmp_path / "engine").mkdir(exist_ok=True)
    details: list[str] = []
    return AnimationRequest(
        job_id="j", reference_image_path=tmp_path / "character.png", driving_video_path=tmp_path / "driving.mp4", pose_video_path=None,
        output_dir=tmp_path / "engine", seed=1, size=(480, 832), duration_seconds=seconds,
        config={"resolution": resolution, "on_detail": details.append, "details": details},
    )


def test_unavailable_without_a_space(monkeypatch):
    monkeypatch.setattr(settings, "zerogpu_space", "")
    assert WanZeroGpuProvider().available() == (False, "ZEROGPU_SPACE is not set")


async def test_refuses_what_the_demo_cannot_render(fake_gradio, tmp_path):
    with pytest.raises(EngineError) as short:
        await WanZeroGpuProvider().validate(request_for(tmp_path, seconds=1))
    assert short.value.code == "INPUT_INVALID"
    with pytest.raises(EngineError) as large:
        await WanZeroGpuProvider().validate(request_for(tmp_path, resolution="720p"))
    assert large.value.code == "INPUT_INVALID"


async def test_submits_pose_retarget_and_returns_the_edited_video(fake_gradio, tmp_path):
    request = request_for(tmp_path, seconds=3)
    out = await WanZeroGpuProvider().run(request)
    assert out.read_bytes().startswith(b"\x00\x00\x00\x18ftyp")
    sent = fake_gradio["submits"][0]
    assert sent["rc_str"] == "Pose Retarget" and sent["resolution_choice"] == "Low Res" and sent["max_duration_s"] == 3 and sent["api_name"] == "/animate_scene"
    assert sent["input_video"] == {"path": str(request.driving_video_path)}
    assert request.config["engine_version"] == "abc123"
    assert any("queue: position 1" in text for text in request.config["details"])


async def test_quota_is_a_recoverable_gpu_unavailable(fake_gradio, tmp_path):
    fake_gradio["next_job"] = FakeJob(None, polls=0, error=RuntimeError("You have exceeded your free GPU quota (120s requested vs. 30s left)."))
    with pytest.raises(EngineError) as error:
        await WanZeroGpuProvider().run(request_for(tmp_path))
    assert error.value.code == "GPU_UNAVAILABLE"
    assert "quota" in str(error.value)


async def test_a_changed_api_is_refused_before_uploading(fake_gradio, tmp_path):
    fake_gradio["params"] = [{"parameter_name": "video"}]
    with pytest.raises(EngineError) as error:
        await WanZeroGpuProvider().run(request_for(tmp_path))
    assert error.value.code == "GPU_UNAVAILABLE"
    assert fake_gradio["submits"] == []


async def test_cancel_cancels_the_space_job(fake_gradio, tmp_path):
    fake_gradio["next_job"] = FakeJob(None, polls=10_000)
    task = asyncio.create_task(WanZeroGpuProvider().run(request_for(tmp_path)))
    for _ in range(50):
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert fake_gradio["job"].cancelled


@pytest.mark.parametrize("message, code", [
    ("ZeroGPU worker error: No GPU was available", "GPU_UNAVAILABLE"),
    ("CUDA out of memory", "MODEL_OOM"),
    ("ValueError: bad frame", "GENERATION_FAILED"),
])
def test_classify(message, code):
    assert classify(message).code == code
