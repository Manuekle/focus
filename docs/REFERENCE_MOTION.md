# Reference Motion

Reference Motion transfers the movement of a short reference video onto a character illustration. Focus orchestrates the job on CPU; inference runs in a separate GPU worker (`services/animation-worker`). The feature is behind `NEXT_PUBLIC_ENABLE_REFERENCE_MOTION` and lives at `/animate`.

## Architecture

| Area | How it works |
| --- | --- |
| App | One Next.js 16 process. The public API is `app/api/animations/**` plus `server/reference-motion/**`. No second TypeScript backend. |
| Deployment | One CPU container (Railway, see [RAILWAY.md](RAILWAY.md)). GPU inference runs in an external worker. |
| State | No database. One JSON file per entity (`job.json`, `asset.json`) under `FOCUS_DATA_DIR/reference-motion/`, written with write-then-rename under a per-id lock. |
| Queue | In-process dispatcher registered on `globalThis` (Next bundles each route separately). It polls the worker. Recovery after a restart happens when an active job is read with no live worker. |
| Files | Local disk with a 24 h TTL and a storage budget. The worker downloads inputs and uploads outputs through short-lived HMAC-signed URLs served by Focus (`/api/animations/worker/**`). |
| Auth | Signed session cookie. Every asset and job has an `ownerId` that is checked on each request. |
| Limits | The shared guard (`server/guard.ts`, `server/quota.ts`) plus `ANIMATION_*` limits. |
| Meta models | SAM 3.1 and Muse Image are optional, later stages. They are not on the critical path. |

Design decisions:

1. **No new infrastructure.** No Postgres, Redis or S3. The contracts (manifest, signed URLs, states) allow swapping them later without touching the worker.
2. **GPU worker in Python/FastAPI**, packaged for Hugging Face Docker Spaces (`app_port: 7860`) or any GPU host. It exposes only `/healthz`, `/readyz` and `/internal/jobs*`, protected by a service token. It never accepts paths or commands: only a validated manifest with signed URLs.
3. **Polling instead of callbacks.** Focus calls `GET /internal/jobs/{id}` every few seconds. This avoids another inbound endpoint and survives a Space restart (a worker 404 becomes a retryable `GPU_UNAVAILABLE`).
4. **Swappable engines** (`providers/`): `steadydancer` and `wan_animate` wrap the official scripts with argument lists; `fake` exists only with `ANIMATION_ALLOW_FAKE_ENGINE=1` and marks results `synthetic`. No real engine is declared working without a GPU smoke test.
5. **DWPose** (via `rtmlib`, ONNX) produces the poses in the worker. SAM 3.1 is not used for skeletons.
6. **RIFE is off by default**; it is an optional stage behind configuration.

## Components

| Piece | Where |
| --- | --- |
| Shared contract (states, errors, manifest, files) | `shared/reference-motion.ts` |
| JSON store, locks, restart recovery, cleanup | `server/reference-motion/store.ts` |
| Uploads (Sharp / FFprobe, normalization to H.264 24 fps) | `server/reference-motion/assets.ts` |
| Job: validate, trim, dispatch, follow, verify | `server/reference-motion/jobs.ts` |
| HMAC-signed URLs for the worker | `server/reference-motion/signing.ts` |
| GPU worker client | `server/reference-motion/worker-client.ts` |
| Public API (session required) | `app/api/animations/{engines,uploads,jobs}` |
| Worker input (signed URL only) | `app/api/animations/worker/[id]/[file]` |
| UI | `/animate` (the "Motion" tab), `app/animate/*` |
| Flipbook import | `server/reference-motion/flipbook-import.ts`, `importSequence` in `server/animation/flipbooks.ts`, `POST /api/animations/jobs/:id/flipbook` |
| GPU worker | `services/animation-worker` (its own README) |

States: `queued → validating → awaiting_gpu → preprocessing → generating → postprocessing → uploading → verifying → completed`, plus `failed`, `cancel_requested` and `cancelled`. Progress is completed stages over total stages, never a timer. `preprocessing` (poses) runs in the worker after dispatch, so it comes after `awaiting_gpu`. Time Focus cannot observe between two polls is stored as `workerTimings`.

Errors: `INPUT_INVALID`, `POSE_NOT_FOUND`, `GPU_UNAVAILABLE`, `MODEL_OOM`, `GENERATION_FAILED`, `CANCELLED`, `OUTPUT_INVALID`, `TIMEOUT`, `INTERRUPTED`. All but `INPUT_INVALID` and `POSE_NOT_FOUND` are retryable. A retry with the same `Idempotency-Key` counts once and consumes no generation.

## Import into Flipbook

"Open in Flipbook" turns a verified render into a continuous, private Flipbook sequence: one frame per tick at 24 drawings/s (a 16 fps render keeps its frames; none are invented), the uploaded character as the reference and, if the render has sound, its track as the Flipbook audio. It runs once per job and cut-out method; repeating it opens the same Flipbook.

- **Plain background (default, free):** each frame is cut out by its background colour, with no SAM. A frame with a non-plain background fails with its reason and can be replaced by hand. The "lineart" keying treats the dark outline (thickened by 1 px) as a wall for the fill from the edge, so white clothing enclosed by the outline survives. Each cut-out records `leakShare`; above 6 % the frame gets a `cutout_leak` warning.
- **SAM 3.1 (optional, paid):** the "Background isn't plain" switch runs one SAM pass over the 24 fps clip (concept `person`, then `character` only if nothing is found). The object present longest is the character and its per-frame mask becomes that frame's transparency. It goes through `guardAiRequest` (emergency switch, daily SAM frame budget, generation quota, hourly limit). The Meta file id is stored on the job so the clip is not uploaded twice.
- Static camera registration: each frame stays where it was rendered.
- Frames carry `source: "imported"` and the Flipbook `importedFrom`. Redraw, AI enhance, motion chat, sequence plan, video reference, duplicate and change-reference are blocked on the server and hidden in the UI. Replace, reorder, approve, background, audio and export stay available.
- If the uploaded character has expired (24 h), the import is rejected because the reference is missing.

## Experimental engine: Wan2.2 through a ZeroGPU demo

`wan-zerogpu` (`services/animation-worker/app/providers/wan_zerogpu.py`) calls the Gradio API of a public Hugging Face demo that runs Wan2.2-Animate. It is off by default; enable it with `ZEROGPU_SPACE=<owner>/<space>`. Inference runs on Hugging Face with the free ZeroGPU quota, so the worker needs no GPU and nothing is billed. Poses, retargeting, export and verification are still done by the worker and Focus.

- **Third party:** the character image and the trimmed clip are uploaded to that Space. The UI warns about this under "Before generating". Use only material you may share.
- **Demo constraints** (read with `Client.view_api()`): 2–20 s clips, "Pose Retarget" mode, "Low Res" 360×640 or "Medium Res" 480×832, 30 fps output. Focus requires 2–3 s segments at 480p for this engine and exports at 16/24 fps.
- **Quota:** `ZEROGPU_LOW_RES=1` (default) uses "Low Res", half the quota of "Medium Res". Without `HF_TOKEN` the daily quota is the anonymous one; a free account token raises it. An exhausted quota, a full queue or a sleeping Space end in a retryable `GPU_UNAVAILABLE`; the job detail shows the queue position.
- **Demo changes:** before uploading anything the provider checks that `/animate_scene` still has the expected parameters; if not, it fails with `GPU_UNAVAILABLE` without sending files. Every render stores the Space commit (`engineCommit`) and origin (`engineSource`) in `render_report.json`.
- **Not production:** it depends on someone else's Space, queue and quota. It exists to exercise the flow with real inference at no cost.
- Install with `pip install ".[pose,zerogpu]"` (the worker Dockerfile already does). Since it uses no local GPU, the worker can run on a CPU machine with `POSE_DEVICE=cpu`.

## Configuration

Focus:

```env
NEXT_PUBLIC_ENABLE_REFERENCE_MOTION=true    # compiled in: rebuild after changing
GPU_WORKER_URL=https://<space>.hf.space
GPU_WORKER_TOKEN=<openssl rand -hex 32>     # same value on the worker
ANIMATION_URL_SECRET=<openssl rand -hex 32> # signs URLs; required in production
ANIMATION_CALLBACK_BASE_URL=https://<your-domain>  # optional; defaults to FOCUS_PUBLIC_URL
ANIMATION_DEFAULT_ENGINE=steadydancer
ANIMATION_MAX_DURATION_SECONDS=3
ANIMATION_MAX_ACTIVE_JOBS_PER_USER=1
ANIMATION_MAX_ACTIVE_JOBS=1
ANIMATION_JOBS_PER_HOUR=6
ANIMATION_JOB_TIMEOUT_SECONDS=2700
```

Worker: see `services/animation-worker/README.md`. `ALLOWED_CALLBACK_HOSTS` must contain the public host of Focus.

## Local development without a GPU

1. Start the worker in another terminal:

```bash
cd services/animation-worker && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e ".[dev,pose]"
```

```bash
GPU_WORKER_TOKEN=<token> ALLOWED_CALLBACK_HOSTS=127.0.0.1 ALLOW_INSECURE_CALLBACKS=1 ANIMATION_ALLOW_FAKE_ENGINE=1 POSE_DEVICE=cpu services/animation-worker/.venv/bin/uvicorn app.main:app --app-dir services/animation-worker --port 7860
```

2. In Focus, set `NEXT_PUBLIC_ENABLE_REFERENCE_MOTION=true`, `GPU_WORKER_URL=http://127.0.0.1:7860` and `GPU_WORKER_TOKEN=<token>` in `.env.local`, restart `pnpm dev` and open `/animate`.

The "Test engine (no AI)" runs the whole pipeline with real poses: it moves the rigid character with the reference hips and draws the transferred skeleton on top. The result carries `synthetic: true` in Focus and in `render_report.json`, and the UI says so. It is not an animation.

## Deploying the worker on Hugging Face

1. Create a **private** Docker Space with the contents of `services/animation-worker` (its `README.md` already declares `sdk: docker` and `app_port: 7860`).
2. Space secrets: `GPU_WORKER_TOKEN`, `ALLOWED_CALLBACK_HOSTS`, and `GPU_HOURLY_USD` for the chosen hardware.
3. Engines: build a derived image (or mount persistent storage) containing the SteadyDancer or Wan2.2 checkout, its weights and **its own Python environment**, and set `STEADYDANCER_*` / `WAN_*`. Their PyTorch/CUDA/MMCV versions conflict with the worker's; do not install them in the same venv.
4. Enable sleep/pause so idle time is not billed. Focus waits for a cold start in `awaiting_gpu` until the job deadline; if the Space forgets the run (restart), the job fails with a retryable `GPU_UNAVAILABLE`.
5. Check current pricing before enabling hardware: https://huggingface.co/pricing.

If Hugging Face Spaces is not a fit, the same container runs on RunPod, Modal or any GPU host; only `GPU_WORKER_URL` changes.

## Verification status

- `pnpm vitest run server/reference-motion` covers signing, real uploads, measured states, idempotency, ownership, GPU unavailable before charging, out-of-range segments, black-video rejection, lost worker plus retry, `MODEL_OOM`, cancellation and duration.
- `pytest` in the worker covers the token, SSRF, a manifest with a foreign URL, smoothing, jumps, subject tracking, retargeting, the full pipeline with real HTTP uploads, `POSE_NOT_FOUND`, checksums and cancellation. The `wan-zerogpu` provider has its own tests with a mocked `gradio_client`.
- A real render through the worker with `wan-zerogpu` was produced end to end (DWPose on CPU, generation in the Space, export and verification: H.264 yuv420p, 24 fps, exact frame count). Visual review found transferred movement and a preserved identity, with a blurry face and fast arms leaving trails.
- The Flipbook import was checked with a plain-background cut-out, the lineart keying and one approved SAM 3.1 pass.
- **Pending:** a GPU smoke test and benchmark of SteadyDancer and Wan2.2-Animate on the project's own worker; choosing the default engine from data; RIFE on GPU; SAM 3.1 inside the worker; and, with more than one API replica, a queue (Redis) and a database (Postgres) in place of the in-process dispatcher and JSON store. The worker contract does not change.

Before enabling a real engine by default, run one 3 s segment at 480p and 24 fps through `/animate`, record the engine commit and weights (`render_report.json` → `engineCommit`, `weights`), peak VRAM, per-stage timings and cost, review the result by eye (movement, identity, lines, hands and feet, background, flicker), and only then change `ANIMATION_DEFAULT_ENGINE` and remove `ANIMATION_ALLOW_FAKE_ENGINE` from the production worker.

## Licence audit (draft)

This table records what the public READMEs state. It is **incomplete** and does not replace a legal review or reading the terms of each set of weights.

| Component | Code | Weights / base model | To verify |
| --- | --- | --- | --- |
| SteadyDancer (`MCG-NJU/SteadyDancer`) | Apache-2.0 per its README | `MCG-NJU/SteadyDancer-14B`; derived from Wan 2.1 and modifies MusePose | Model card licence on Hugging Face, Wan 2.1 and MusePose terms, commercial use |
| Wan2.2-Animate (`Wan-Video/Wan2.2`) | See the repository LICENSE | `Wan-AI/Wan2.2-Animate-14B`; optional preprocessing with FLUX (`--use_flux`) | Model licence; FLUX has its own terms (not enabled by default) |
| ZeroGPU demo (`wan-zerogpu` engine) | Space code, by the demo's author | `Wan-AI/Wan2.2-Animate-14B` per its code | Space licence, Hugging Face and ZeroGPU terms for automated use; it receives Focus users' content |
| DWPose (via `rtmlib`) | rtmlib Apache-2.0; DWPose Apache-2.0 | ONNX `rtmw-dw-x-l` and a YOLOX/RTMDet detector downloaded from OpenMMLab | Checkpoint terms and training datasets (COCO-WholeBody) |
| RIFE (`hzwer/ECCV2022-RIFE`) | MIT | `train_log/` from the repository | Licence of the published weights |
| Meta Muse Image / SAM 3.1 | Meta API | n/a | Already used by Focus under Meta's terms; not yet used in Reference Motion |
| FFmpeg | LGPL/GPL (libx264 is GPL) | n/a | Invoked as an external program, as in the rest of Focus |

User content: the UI asks people to use only images and videos they have the rights to.
