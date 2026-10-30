"""Input validation: what the files really are, before any GPU time is spent."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from ..config import settings
from ..infrastructure.process import ProcessFailed, run


class InvalidInput(ValueError):
    pass


@dataclass(frozen=True)
class VideoFacts:
    width: int
    height: int
    fps: float
    duration: float
    frames: int | None
    codec: str
    pix_fmt: str | None
    has_audio: bool


def _rate(value: str | None) -> float:
    if not value or "/" not in value:
        return float(value or 0)
    num, den = value.split("/")
    return float(num) / float(den) if float(den) else 0.0


async def probe_video(path: Path) -> VideoFacts:
    try:
        out = await run([settings.ffprobe, "-v", "error", "-protocol_whitelist", "file", "-print_format", "json", "-show_format", "-show_streams", str(path)], timeout=60)
    except ProcessFailed as error:
        raise InvalidInput(f"unreadable video: {error.tail[-200:]}") from error
    data = json.loads(out)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video or not video.get("width") or not video.get("height"):
        raise InvalidInput("no video stream")
    duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
    frames = int(video["nb_frames"]) if str(video.get("nb_frames", "")).isdigit() else None
    return VideoFacts(
        width=int(video["width"]),
        height=int(video["height"]),
        fps=_rate(video.get("avg_frame_rate")) or _rate(video.get("r_frame_rate")),
        duration=duration,
        frames=frames,
        codec=str(video.get("codec_name")),
        pix_fmt=video.get("pix_fmt"),
        has_audio=any(s.get("codec_type") == "audio" for s in data.get("streams", [])),
    )


async def validate_driving(path: Path, expected_seconds: float) -> VideoFacts:
    facts = await probe_video(path)
    if facts.duration <= 0 or abs(facts.duration - expected_seconds) > 0.3:
        raise InvalidInput(f"driving video lasts {facts.duration:.2f}s, expected {expected_seconds}s")
    if min(facts.width, facts.height) < 128 or max(facts.width, facts.height) > 4096:
        raise InvalidInput(f"driving video size {facts.width}x{facts.height} not supported")
    if not 1 <= facts.fps <= 120:
        raise InvalidInput(f"driving video fps {facts.fps} not supported")
    return facts


def validate_character(path: Path) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            if image.format != "PNG":
                raise InvalidInput(f"character must be PNG, got {image.format}")
            width, height = image.size
    except (UnidentifiedImageError, OSError) as error:
        raise InvalidInput("unreadable character image") from error
    if min(width, height) < 256 or max(width, height) > 4096:
        raise InvalidInput(f"character size {width}x{height} not supported")
    return width, height


def target_size(width: int, height: int, resolution: str) -> tuple[int, int]:
    """The engines' standard buckets in the driving video's orientation (W, H)."""
    short, long = (480, 832) if resolution == "480p" else (720, 1280)
    return (short, long) if height >= width else (long, short)
