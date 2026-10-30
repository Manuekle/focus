"""Focus animation worker: a private HTTP contract around the GPU pipeline.

  GET  /healthz                    process alive
  GET  /readyz                     engines and pose backend usable (token)
  POST /internal/jobs              accept a manifest, answer at once (token)
  GET  /internal/jobs/{id}         run status (token)
  POST /internal/jobs/{id}/cancel  best-effort cancel (token)

No route accepts paths or commands: only the typed manifest, whose URLs must
point back to an allowed Focus host.
"""

from __future__ import annotations

import importlib.util
import logging

from fastapi import Depends, FastAPI, HTTPException

from .config import settings
from .infrastructure.telemetry import gpu_info
from .orchestration import Registry, engines_ready
from .schemas import Manifest, Ready, Status
from .security import UnsafeUrl, check_callback_url, require_token

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = FastAPI(title="Focus Animation Worker", docs_url=None, redoc_url=None, openapi_url=None)
registry = Registry()


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/readyz", dependencies=[Depends(require_token)])
def readyz() -> Ready:
    engines, reasons = engines_ready()
    pose_ok = importlib.util.find_spec("rtmlib") is not None
    detail = None if pose_ok else "rtmlib (DWPose) is not installed"
    if not engines:
        detail = "; ".join(f"{k}: {v}" for k, v in reasons.items()) or "no engine configured"
    return Ready(ready=bool(engines) and pose_ok, engines=engines if pose_ok else [], gpu=gpu_info(), gpuHourlyUsd=settings.gpu_hourly_usd, detail=detail)


@app.post("/internal/jobs", dependencies=[Depends(require_token)], status_code=202)
async def create(manifest: Manifest) -> Status:
    try:
        for url in [manifest.inputs.character.url, manifest.inputs.driving.url, *manifest.uploads.values()]:
            check_callback_url(str(url))
    except UnsafeUrl as error:
        raise HTTPException(status_code=400, detail=f"refused URL: {error}") from error
    engines, _ = engines_ready()
    if manifest.engine not in engines:
        raise HTTPException(status_code=503, detail=f"engine {manifest.engine} is not available")
    return registry.start(manifest).status()


@app.get("/internal/jobs/{job_id}", dependencies=[Depends(require_token)])
def status(job_id: str) -> Status:
    run = registry.runs.get(job_id)
    if not run:
        raise HTTPException(status_code=404, detail="unknown job")
    return run.status()


@app.post("/internal/jobs/{job_id}/cancel", dependencies=[Depends(require_token)])
def cancel(job_id: str) -> Status:
    run = registry.cancel(job_id)
    if not run:
        raise HTTPException(status_code=404, detail="unknown job")
    return run.status()
