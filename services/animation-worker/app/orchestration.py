"""One job run: validate → poses → engine → export → upload.

State lives in memory only: a Space restart forgets every run, and Focus
(the source of truth) turns the resulting 404 into a retryable failure. One
GPU means one job at a time; others wait in `queued`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .config import settings
from .infrastructure import storage
from .infrastructure.process import ProcessFailed
from .infrastructure.telemetry import GpuSampler, Stopwatch, gpu_info
from .pipeline import export, interpolate, pose, retarget
from .pipeline.ingest import InvalidInput, target_size, validate_character, validate_driving
from .providers.base import AnimationProvider, AnimationRequest, EngineError, checkout_commit
from .providers.fake import FakeProvider
from .providers.steadydancer import SteadyDancerProvider
from .providers.wan_animate import WanAnimateProvider
from .providers.wan_zerogpu import WanZeroGpuProvider
from .schemas import GpuProfile, JobError, Manifest, Status

log = logging.getLogger("focus.worker")

PROVIDERS: dict[str, AnimationProvider] = {"steadydancer": SteadyDancerProvider(), "wan-animate": WanAnimateProvider(), "wan-zerogpu": WanZeroGpuProvider(), "fake": FakeProvider()}
CONTENT_TYPES = {".mp4": "video/mp4", ".json": "application/json", ".webp": "image/webp", ".zip": "application/zip"}
MIN_SUBJECT_RATIO = 0.6


class Failure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class Run:
    manifest: Manifest
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    stage: str = "queued"
    detail: str | None = None
    error: JobError | None = None
    uploaded: list[str] = field(default_factory=list)
    clock: Stopwatch = field(default_factory=Stopwatch)
    started: float | None = None
    finished: float | None = None
    peak_vram: float | None = None
    task: asyncio.Task | None = None
    synthetic: bool = False

    def status(self) -> Status:
        info = gpu_info()
        seconds = None if self.started is None else round((self.finished or time.monotonic()) - self.started, 2)
        return Status(
            jobId=self.manifest.jobId,
            runId=self.run_id,
            stage=self.stage,  # type: ignore[arg-type]
            detail=self.detail,
            error=self.error,
            uploaded=self.uploaded,
            timings=dict(self.clock.timings),
            gpu=GpuProfile(name=info["name"], vramTotalMb=info["vramTotalMb"], peakVramMb=self.peak_vram) if info else None,
            gpuSeconds=seconds,
            gpuHourlyUsd=settings.gpu_hourly_usd,
            synthetic=self.synthetic,
        )


class Registry:
    def __init__(self) -> None:
        self.runs: dict[str, Run] = {}
        self.slots = asyncio.Semaphore(max(1, settings.max_concurrent_jobs))
        self._estimator: pose.Estimator | None = None

    def estimator(self) -> pose.Estimator:
        if self._estimator is None:
            self._estimator = pose.dwpose_estimator(settings.pose_device, settings.pose_mode)
        return self._estimator

    def start(self, manifest: Manifest) -> Run:
        """Idempotent on (jobId, attempt). A newer attempt replaces an older run."""
        current = self.runs.get(manifest.jobId)
        if current and current.manifest.attempt == manifest.attempt:
            return current
        if current and current.task and not current.task.done():
            current.task.cancel()
        run = Run(manifest)
        self.runs[manifest.jobId] = run
        run.task = asyncio.create_task(self._guarded(run))
        return run

    def cancel(self, job_id: str) -> Run | None:
        run = self.runs.get(job_id)
        if run and run.task and not run.task.done():
            run.task.cancel()
        return run

    async def _guarded(self, run: Run) -> None:
        try:
            async with self.slots:
                await asyncio.wait_for(execute(run, self), timeout=run.manifest.deadlineSeconds)
        except asyncio.CancelledError:
            run.stage, run.error = "cancelled", JobError(code="CANCELLED", message="Cancelled.")
        except asyncio.TimeoutError:
            run.stage, run.error = "failed", JobError(code="TIMEOUT", message="The job passed its deadline.")
        except Failure as failure:
            run.stage, run.error = "failed", JobError(code=failure.code, message=str(failure)[:400])  # type: ignore[arg-type]
        except Exception:  # noqa: BLE001 — one job's crash must not take the worker down
            log.exception("job %s crashed", run.manifest.jobId)
            run.stage, run.error = "failed", JobError(code="GENERATION_FAILED", message="The worker hit an unexpected error.")
        finally:
            run.finished = time.monotonic()
            run.clock.close()
            shutil.rmtree(settings.work_root / run.manifest.jobId, ignore_errors=True)
            # Keep only recent runs in memory.
            for job_id in [j for j, r in self.runs.items() if r.finished and time.monotonic() - r.finished > 3600]:
                self.runs.pop(job_id, None)


def _enter(run: Run, stage: str, detail: str | None = None) -> None:
    run.stage, run.detail = stage, detail
    run.clock.enter(stage)


async def execute(run: Run, registry: Registry) -> None:
    m = run.manifest
    provider = PROVIDERS[m.engine]
    run.synthetic = provider.synthetic
    run.started = time.monotonic()
    work = settings.work_root / m.jobId / str(m.attempt)
    out = work / "out"
    out.mkdir(parents=True, exist_ok=True)
    sampler = GpuSampler().start()
    try:
        # ── validating ────────────────────────────────────────────────────
        _enter(run, "validating", "Downloading and checking inputs")
        ok, reason = provider.available()
        if not ok:
            raise Failure("GPU_UNAVAILABLE", f"{m.engine}: {reason}")
        try:
            character = await storage.download(str(m.inputs.character.url), work / "input/character.png", m.inputs.character.sha256, 50 << 20)
            driving = await storage.download(str(m.inputs.driving.url), work / "input/driving.mp4", m.inputs.driving.sha256)
            validate_character(character)
            facts = await validate_driving(driving, m.durationSeconds)
        except (InvalidInput, storage.TransferFailed) as error:
            raise Failure("INPUT_INVALID", str(error)) from error
        size = target_size(facts.width, facts.height, m.resolution)

        # ── preprocessing: poses, retargeting, diagnostics ────────────────
        _enter(run, "preprocessing", "Extracting poses")
        estimator = registry.estimator()
        total = max(1, round(facts.duration * facts.fps))

        def progress(index: int) -> None:
            run.detail = f"Extracting poses: frame {index + 1}/{total}"

        raw_track = await asyncio.to_thread(pose.extract, pose.read_frames(driving), estimator, facts.fps, progress)
        track = pose.smooth(raw_track)
        report = pose.quality_report(track)
        _write_json(out / "poses.json", track.to_json())
        _write_json(out / "pose_confidence.json", pose.confidence_summary(track))
        overlay_raw = work / "overlay_raw.mp4"
        await asyncio.to_thread(pose.write_video, overlay_raw, pose.overlay_frames(driving, track), facts.fps, (facts.width, facts.height))
        await export.h264(overlay_raw, out / "pose_overlay.mp4", facts.fps)
        if report["subjectRatio"] < MIN_SUBJECT_RATIO:
            _write_json(out / "quality_report.json", {"pose": report})
            await _upload(run, out, ["poses.json", "pose_confidence.json", "pose_overlay.mp4", "quality_report.json"])
            raise Failure("POSE_NOT_FOUND", f"subject followed in {report['subjectRatio']:.0%} of frames")

        image = cv2.imread(str(character))
        ref_points, ref_scores = estimator(image)
        ref_points, ref_scores = np.asarray(ref_points).reshape(-1, 133, 2), np.asarray(ref_scores).reshape(-1, 133)
        reference = np.full((133, 2), np.nan, dtype=np.float32)
        if len(ref_points):
            best = int(np.argmax([pose._area(p, s) for p, s in zip(ref_points, ref_scores)]))
            reference = np.where((ref_scores[best] >= pose.CONFIDENT)[:, None], ref_points[best], np.nan).astype(np.float32)
        retargeted, retarget_report = retarget.retarget(track, reference, (image.shape[1], image.shape[0]))
        _write_json(out / "retargeted_poses.json", {"format": "coco-wholebody-133", "width": image.shape[1], "height": image.shape[0], "fps": facts.fps, "keypoints": [[[None, None] if np.isnan(x) else [round(float(x), 2), round(float(y), 2)] for x, y in frame] for frame in retargeted], "report": retarget_report})
        preview_raw = work / "retarget_raw.mp4"
        await asyncio.to_thread(pose.write_video, preview_raw, (pose.draw_skeleton(image.copy(), points) for points in retargeted), facts.fps, (image.shape[1], image.shape[0]))
        await export.h264(preview_raw, out / "retargeted_pose_preview.mp4", facts.fps)
        await _upload(run, out, ["poses.json", "pose_confidence.json", "pose_overlay.mp4", "retargeted_poses.json", "retargeted_pose_preview.mp4"])

        # ── generating ────────────────────────────────────────────────────
        _enter(run, "generating", f"Rendering with {m.engine}")
        request = AnimationRequest(
            job_id=m.jobId, reference_image_path=character, driving_video_path=driving, pose_video_path=out / "pose_overlay.mp4",
            output_dir=work / "engine", seed=m.seed, size=size, duration_seconds=m.durationSeconds,
            config={"fps": facts.fps, "retargeted": retargeted, "timeout": max(60, m.deadlineSeconds - 120), "resolution": m.resolution, "on_detail": lambda text: setattr(run, "detail", text[:200])},
        )
        request.output_dir.mkdir(parents=True, exist_ok=True)
        try:
            await provider.validate(request)
            engine_video = await provider.run(request)
        except EngineError as error:
            raise Failure(error.code, str(error)) from error

        # ── postprocessing ────────────────────────────────────────────────
        _enter(run, "postprocessing", "Encoding and checking the video")
        audio = driving if m.keepAudio and facts.has_audio else None
        final = await export.encode(engine_video, out / "animation.mp4", m.outputFps, m.durationSeconds, audio)
        try:
            verified = await export.verify(final, m.durationSeconds, m.outputFps)
        except export.InvalidOutput as error:
            raise Failure("OUTPUT_INVALID", str(error)) from error
        rife: dict = {"requested": m.interpolation}
        if m.interpolation:
            try:
                doubled = await interpolate.double_fps(engine_video, work / "rife")
                rife_video = await export.encode(doubled, out / "animation_rife.mp4", m.outputFps * 2, m.durationSeconds, audio)
                rife_facts = await export.verify(rife_video, m.durationSeconds, m.outputFps * 2)
                rife.update(produced=True, fps=rife_facts.fps, inventedFrames=max(0, (rife_facts.frames or 0) - (verified.frames or 0)))
            except (interpolate.InterpolationUnavailable, export.InvalidOutput, ProcessFailed) as error:
                # The base video stays the deliverable; the A/B variant is reported as missing.
                rife.update(produced=False, reason=str(error))
        frame_count = await export.frames_zip(final, out / "frames.zip")
        await export.preview(final, out / "preview.webp")

        # ── uploading ─────────────────────────────────────────────────────
        _enter(run, "uploading", "Sending results to Focus")
        run.peak_vram = sampler.stop()
        _write_json(out / "quality_report.json", {"pose": report, "retarget": retarget_report})
        names = ["animation.mp4", "frames.zip", "quality_report.json"] + [n for n in ("animation_rife.mp4", "preview.webp") if (out / n).is_file()]
        await _upload(run, out, names)
        status = run.status()
        _write_json(out / "render_report.json", {
            "jobId": m.jobId, "attempt": m.attempt, "runId": run.run_id, "engine": m.engine, "synthetic": provider.synthetic,
            "seed": m.seed, "size": list(size), "resolution": m.resolution, "outputFps": m.outputFps, "durationSeconds": m.durationSeconds,
            "inputs": {"characterSha256": m.inputs.character.sha256, "drivingSha256": m.inputs.driving.sha256, "driving": facts.__dict__},
            "output": {"frames": frame_count, **verified.__dict__}, "interpolation": rife,
            "timings": run.clock.timings, "gpu": status.gpu.model_dump() if status.gpu else None, "gpuSeconds": status.gpuSeconds,
            "gpuHourlyUsd": settings.gpu_hourly_usd, "poseBackend": settings.pose_backend,
            "engineCommit": request.config.get("engine_version") or checkout_commit({"steadydancer": settings.steadydancer_dir, "wan-animate": settings.wan_dir}.get(m.engine)),
            "engineSource": f"huggingface.co/spaces/{settings.zerogpu_space}" if m.engine == "wan-zerogpu" else None,
            "weights": str({"steadydancer": settings.steadydancer_ckpt, "wan-animate": settings.wan_ckpt}.get(m.engine) or "") or None,
        })
        await _upload(run, out, ["render_report.json"])
        _enter(run, "completed", None)
    finally:
        sampler.stop()


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, separators=(",", ":"), default=str))


async def _upload(run: Run, out: Path, names: list[str]) -> None:
    for name in names:
        url = run.manifest.uploads.get(name)  # type: ignore[call-overload]
        if not url:
            continue
        try:
            await storage.upload(str(url), out / name, CONTENT_TYPES[Path(name).suffix])
        except storage.TransferFailed as error:
            raise Failure("GENERATION_FAILED", f"upload failed: {error}") from error
        if name not in run.uploaded:
            run.uploaded.append(name)


def engines_ready() -> tuple[list[str], dict[str, str]]:
    ready, reasons = [], {}
    for name, provider in PROVIDERS.items():
        ok, reason = provider.available()
        if ok:
            ready.append(name)
        elif name != "fake" or settings.allow_fake_engine:
            reasons[name] = reason or "unavailable"
    return ready, reasons
