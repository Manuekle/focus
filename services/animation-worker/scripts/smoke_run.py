"""One real worker run without the Focus server: the smoke test for an engine.

Serves the inputs and receives the outputs through a local stand-in for
Focus's signed routes, runs the worker's own pipeline (real DWPose, the
chosen engine, export and checks) and writes every output plus summary.json
to --out. Exit code 0 when the run completed, 2 when it failed (the reason
is in summary.json), 1 on a setup error.

  .venv/bin/python scripts/smoke_run.py --engine wan-zerogpu \\
      --character ../../.focus-data/benchmarks/wan-zerogpu-2026-10-29/inputs/character.png \\
      --driving ../../.focus-data/benchmarks/wan-zerogpu-2026-10-29/inputs/driving.mp4 \\
      --seconds 2 --out ../../.focus-data/benchmarks/wan-zerogpu-worker

A real engine spends what that engine spends (wan-zerogpu: free ZeroGPU
quota of a third party's Space, which receives both inputs).
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.orchestration import Registry  # noqa: E402
from app.schemas import OUTPUT_NAMES, Manifest  # noqa: E402


def stand_in(files: dict[str, bytes], out: Path) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # quiet
            pass

        def _name(self) -> str:
            return self.path.split("?")[0].rsplit("/", 1)[-1]

        def do_GET(self):
            body = files.get(self._name())
            self.send_response(200 if body else 404)
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_PUT(self):
            name = self._name()
            if name not in OUTPUT_NAMES:
                self.send_response(403)
                self.end_headers()
                return
            (out / name).write_bytes(self.rfile.read(int(self.headers["Content-Length"])))
            self.send_response(201)
            self.end_headers()

    return Handler


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--engine", required=True, choices=["steadydancer", "wan-animate", "wan-zerogpu", "fake"])
    parser.add_argument("--character", type=Path, required=True)
    parser.add_argument("--driving", type=Path, required=True)
    parser.add_argument("--start", type=float, default=0.0, help="segment start in the driving video, seconds")
    parser.add_argument("--seconds", type=int, default=2, choices=[1, 2, 3])
    parser.add_argument("--fps", type=int, default=24, choices=[16, 24])
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    work = out / "_inputs"
    work.mkdir(exist_ok=True)
    # The worker expects the trimmed segment at a constant 24 fps, as Focus sends it.
    segment = work / "driving.mp4"
    subprocess.run([settings.ffmpeg, "-v", "error", "-y", "-ss", str(args.start), "-i", str(args.driving), "-t", str(args.seconds), "-map", "0:v:0", "-vf", "fps=24", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-an", str(segment)], check=True)
    files = {"character.png": args.character.read_bytes(), "driving.mp4": segment.read_bytes()}

    settings.allowed_hosts = frozenset({"127.0.0.1"})
    settings.allow_insecure = True
    settings.token = settings.token or uuid.uuid4().hex
    server = ThreadingHTTPServer(("127.0.0.1", 0), stand_in(files, out))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/api/animations/worker"
    job = str(uuid.uuid4())
    url = lambda name: f"{base}/{job}/{name}?a=1&exp=9999999999&sig=local"  # noqa: E731
    manifest = Manifest(
        jobId=job, attempt=1, engine=args.engine, mode="animation", seed=args.seed, resolution="480p", outputFps=args.fps,
        durationSeconds=args.seconds, interpolation=False, keepAudio=False,
        inputs={name.split(".")[0]: {"url": url(name), "sha256": hashlib.sha256(body).hexdigest()} for name, body in files.items()},
        uploads={name: url(name) for name in OUTPUT_NAMES}, deadlineSeconds=1800,
    )

    started = datetime.now(timezone.utc)
    registry = Registry()
    run = registry.start(manifest)
    last = None
    while not run.task.done():
        note = f"{run.stage}: {run.detail or ''}"
        if note != last:
            print(note, flush=True)
            last = note
        await asyncio.sleep(1)
    await asyncio.gather(run.task, return_exceptions=True)
    server.shutdown()

    status = run.status()
    summary = {
        "engine": args.engine,
        "startedAt": started.isoformat(),
        "finishedAt": datetime.now(timezone.utc).isoformat(),
        "segment": {"source": str(args.driving), "start": args.start, "seconds": args.seconds},
        "stage": status.stage,
        "error": status.error.model_dump() if status.error else None,
        "uploaded": status.uploaded,
        "timings": status.timings,
        "workerSeconds": status.gpuSeconds,
        "renderReport": json.loads((out / "render_report.json").read_text()) if (out / "render_report.json").is_file() else None,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({k: summary[k] for k in ("stage", "error", "uploaded", "timings")}, indent=2))
    return 0 if status.stage == "completed" else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
