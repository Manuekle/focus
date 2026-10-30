import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security import UnsafeUrl, check_callback_url

from .conftest import TOKEN

client = TestClient(app)


def test_internal_routes_need_the_token():
    assert client.get("/healthz").status_code == 200
    assert client.get("/readyz").status_code == 401
    assert client.get("/readyz", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/internal/jobs/x", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 404


def test_a_short_token_disables_the_api(monkeypatch):
    monkeypatch.setattr(settings, "token", "short")
    assert client.get("/readyz", headers={"Authorization": "Bearer short"}).status_code == 401


@pytest.mark.parametrize("url", [
    "https://evil.example/api/animations/worker/j/driving.mp4",
    "http://focus.example/api/animations/worker/j/driving.mp4",
    "https://user:pw@focus.example/api/animations/worker/j/driving.mp4",
    "https://focus.example/etc/passwd",
    "file:///etc/passwd",
    "https://169.254.169.254/api/animations/worker/j/x",
])
def test_callback_urls_must_be_focus(url):
    with pytest.raises(UnsafeUrl):
        check_callback_url(url)


def test_a_focus_url_passes_and_http_only_when_enabled(monkeypatch):
    assert check_callback_url("https://focus.example/api/animations/worker/j/driving.mp4?a=1")
    monkeypatch.setattr(settings, "allow_insecure", True)
    assert check_callback_url("http://127.0.0.1:3200/api/animations/worker/j/driving.mp4")


def test_manifest_with_a_foreign_url_is_refused():
    body = {
        "jobId": "0" * 8 + "-0000-4000-8000-" + "0" * 12, "attempt": 1, "engine": "fake", "mode": "animation", "seed": 1,
        "resolution": "480p", "outputFps": 24, "durationSeconds": 2, "interpolation": False, "keepAudio": False,
        "inputs": {"character": {"url": "https://evil.example/api/animations/worker/j/character.png", "sha256": "a" * 64},
                   "driving": {"url": "https://focus.example/api/animations/worker/j/driving.mp4", "sha256": "a" * 64}},
        "uploads": {}, "deadlineSeconds": 600,
    }
    response = client.post("/internal/jobs", json=body, headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 400
    assert "evil.example" in response.json()["detail"]
