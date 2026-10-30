"""GPU facts and peak memory, measured with nvidia-smi while a job runs."""

from __future__ import annotations

import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field


def gpu_info() -> dict | None:
    """Name and total memory of the first GPU, or None without an NVIDIA driver."""
    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10, check=True).stdout
        name, total = [part.strip() for part in out.splitlines()[0].split(",")]
        return {"name": name, "vramTotalMb": float(total)}
    except (subprocess.SubprocessError, ValueError, IndexError):
        return None


@dataclass
class GpuSampler:
    """Samples used memory once a second in a thread; keeps the peak."""

    interval: float = 1.0
    peak_mb: float | None = None
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    def start(self) -> "GpuSampler":
        if shutil.which("nvidia-smi"):
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()
        return self

    def stop(self) -> float | None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        return self.peak_mb

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5, check=True).stdout
                used = float(out.splitlines()[0])
                self.peak_mb = used if self.peak_mb is None else max(self.peak_mb, used)
            except (subprocess.SubprocessError, ValueError, IndexError):
                pass
            self._stop.wait(self.interval)


class Stopwatch:
    def __init__(self) -> None:
        self.timings: dict[str, float] = {}
        self._stage: str | None = None
        self._since = time.monotonic()

    def enter(self, stage: str) -> None:
        now = time.monotonic()
        if self._stage:
            self.timings[self._stage] = round(self.timings.get(self._stage, 0) + now - self._since, 2)
        self._stage, self._since = stage, now

    def close(self) -> dict[str, float]:
        self.enter("_end")
        self.timings.pop("_end", None)
        return self.timings
