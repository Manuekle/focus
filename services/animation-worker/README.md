---
title: Focus Animation Worker
sdk: docker
app_port: 7860
---

# Focus Animation Worker

Private GPU worker for Focus **Reference Motion**: a character image follows the movement of a driving video. Focus (Next.js on Railway) owns users, jobs and files; this service only runs one job at a time from a manifest of signed URLs.

```
POST /internal/jobs  → download inputs → DWPose → retarget preview → engine → H.264 export → upload to Focus
```

| Path | What it does |
| --- | --- |
| `app/main.py` | FastAPI: `/healthz`, `/readyz`, `/internal/jobs*` (Bearer `GPU_WORKER_TOKEN`) |
| `app/orchestration.py` | One run: stages, timings, GPU peak memory, uploads, cleanup |
| `app/pipeline/pose.py` | DWPose (rtmlib/ONNX), subject tracking, One-Euro smoothing, quality report, overlays |
| `app/pipeline/retarget.py` | Driving motion on the character's bone lengths (preview + out-of-frame checks) |
| `app/pipeline/export.py` | H.264/yuv420p at the requested fps, FFprobe + full decode check, PNG zip, animated WebP preview (FFmpeg libwebp, else Pillow) |
| `app/pipeline/interpolate.py` | Optional RIFE ×2 (A/B variant, off by default) |
| `app/providers/` | `steadydancer`, `wan_animate` (official scripts via argument lists), `wan_zerogpu` (experimental: a public HF ZeroGPU demo through `gradio_client`), `fake` (test engine: the rigid character moved by the hips, skeleton drawn over it) |

## Run locally (no GPU)

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e ".[dev,pose]"
.venv/bin/python -m pytest
GPU_WORKER_TOKEN=<24+ chars> ALLOWED_CALLBACK_HOSTS=127.0.0.1 ALLOW_INSECURE_CALLBACKS=1 \
  ANIMATION_ALLOW_FAKE_ENGINE=1 POSE_DEVICE=cpu .venv/bin/uvicorn app.main:app --port 7860
```

The first DWPose call downloads ~200 MB of ONNX weights into `~/.cache/rtmlib` (the Docker image bakes them in).

## Environment

| Variable | Purpose |
| --- | --- |
| `GPU_WORKER_TOKEN` | Shared with Focus. At least 24 characters, or every internal route returns 401. |
| `ALLOWED_CALLBACK_HOSTS` | Comma-separated Focus hosts the worker may download from / upload to (SSRF guard). |
| `ALLOW_INSECURE_CALLBACKS` | `1` allows `http://` to an allowed host. Local development only. |
| `ANIMATION_ALLOW_FAKE_ENGINE` | `1` offers the test engine (marked `synthetic`, never an animation). |
| `POSE_DEVICE` / `POSE_MODE` | `cuda`/`cpu`; rtmlib mode `lightweight`/`balanced`/`performance`. |
| `GPU_HOURLY_USD` | Listed hourly price of this hardware; Focus multiplies it by measured GPU seconds. |
| `MAX_CONCURRENT_JOBS` | Default 1 (one GPU). |
| `STEADYDANCER_DIR`, `STEADYDANCER_CKPT_DIR`, `STEADYDANCER_PYTHON` | SteadyDancer checkout, `SteadyDancer-14B` weights, its own Python. |
| `WAN_DIR`, `WAN_CKPT_DIR`, `WAN_PYTHON`, `WAN_USE_FLUX` | Wan2.2 checkout, `Wan2.2-Animate-14B` weights, its own Python. |
| `RIFE_DIR`, `RIFE_PYTHON` | ECCV2022-RIFE checkout with `train_log/`. |
| `ZEROGPU_SPACE` | Experimental `wan-zerogpu` engine: a public Hugging Face ZeroGPU demo of Wan2.2-Animate, e.g. `alexnasa/Wan2.2-Animate-ZEROGPU`. Third party; uploads go to it. Off when unset. Needs the `zerogpu` extra. |
| `HF_TOKEN` | Optional, for a larger ZeroGPU daily quota. |
| `ZEROGPU_LOW_RES` | `1` (default) renders "Low Res" 360×640 at half the quota; `0` uses "Medium Res" 480×832. |
| `WORK_ROOT` | Scratch space; deleted after each job. Never user storage. |

## Status

- Verified locally (CPU): contract, auth, SSRF checks, real DWPose on the user's anime dance clip, retargeting, export, uploads, Focus-side verification — with the **test engine**.
- **Not verified:** SteadyDancer and Wan2.2-Animate on a GPU, RIFE, the Docker image on a Space. Their commands follow the upstream READMEs as read on 2026-10-29. Run the smoke test in `docs/animation-operations.md` before enabling either engine.
