"""Delivery files: H.264/yuv420p MP4 at the requested fps, PNG sequence, preview, checks.

Nothing here adds motion: a video shorter than the segment fails verification
instead of being padded with repeated frames.
"""

from __future__ import annotations

import asyncio
import zipfile
from pathlib import Path

import cv2
from PIL import Image, features

from ..config import settings
from ..infrastructure.process import ProcessFailed, run
from .ingest import VideoFacts, probe_video


class InvalidOutput(RuntimeError):
    pass


async def encode(source: Path, target: Path, fps: float, duration: float, audio_from: Path | None = None) -> Path:
    args = [settings.ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-protocol_whitelist", "file", "-i", source]
    if audio_from:
        args += ["-i", audio_from, "-map", "0:v:0", "-map", "1:a:0?"]
    args += [
        "-vf", f"fps={fps},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p",
        "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
        *(["-c:a", "aac", "-b:a", "160k"] if audio_from else ["-an"]),
        "-movflags", "+faststart", target,
    ]
    await run(args, timeout=900)
    return target


async def verify(path: Path, duration: float, fps: float) -> VideoFacts:
    """FFprobe facts plus a full decode; the same checks Focus repeats on its side."""
    facts = await probe_video(path)
    if facts.codec != "h264" or facts.pix_fmt != "yuv420p":
        raise InvalidOutput(f"{path.name}: {facts.codec}/{facts.pix_fmt}")
    if abs(facts.duration - duration) > max(0.25, duration * 0.1):
        raise InvalidOutput(f"{path.name}: lasts {facts.duration:.2f}s, segment is {duration}s")
    if abs(facts.fps - fps) > 0.5:
        raise InvalidOutput(f"{path.name}: {facts.fps} fps, expected {fps}")
    try:
        await run([settings.ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-xerror", "-i", path, "-f", "null", "-"], timeout=300)
    except ProcessFailed as error:
        raise InvalidOutput(f"{path.name}: does not decode") from error
    return facts


async def frames_zip(video: Path, target: Path) -> int:
    folder = target.parent / "frames"
    folder.mkdir(exist_ok=True)
    await run([settings.ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", video, "-start_number", "0", folder / "frame_%04d.png"], timeout=600)
    files = sorted(folder.glob("frame_*.png"))
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as archive:
        for file in files:
            archive.write(file, file.name)
    return len(files)


async def preview(video: Path, target: Path) -> Path | None:
    """Small animated WebP for lists: FFmpeg's libwebp, else Pillow's encoder (FFmpeg builds without libwebp are common)."""
    try:
        await run([settings.ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", video, "-vf", "fps=12,scale=320:-2:flags=lanczos", "-loop", "0", "-c:v", "libwebp", "-quality", "70", "-an", target], timeout=300)
        return target
    except ProcessFailed:
        return await asyncio.to_thread(_pillow_preview, video, target)


def _pillow_preview(video: Path, target: Path, fps: float = 12, width: int = 320) -> Path | None:
    if not features.check("webp_anim"):
        return None
    capture = cv2.VideoCapture(str(video))
    source_fps = capture.get(cv2.CAP_PROP_FPS) or fps
    step = max(1.0, source_fps / fps)
    frames: list[Image.Image] = []
    index, next_pick = 0, 0.0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if index >= next_pick:
                image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                frames.append(image.resize((width, max(2, round(image.height * width / image.width))), Image.LANCZOS))
                next_pick += step
            index += 1
    finally:
        capture.release()
    if not frames:
        return None
    frames[0].save(target, format="WEBP", save_all=True, append_images=frames[1:], duration=round(1000 / fps), loop=0, quality=70)
    return target


async def h264(source: Path, target: Path, fps: float) -> Path:
    """Diagnostic videos (pose overlays) in a browser-playable format."""
    await run([settings.ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", source, "-vf", f"fps={fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-an", "-movflags", "+faststart", target], timeout=600)
    return target
