# Deployment

Focus ships as one Docker container: Next.js standalone server + FFmpeg/FFprobe from Debian. Jobs run in-process and keep state in memory and on a local volume, so run **one instance** (no autoscaling across instances).

Serverless functions are not a fit for the current architecture: jobs keep running after the request returns, use FFmpeg, and keep files between requests. The live Flipbook trial took about five minutes; longer videos can also take minutes.

**Railway is the prepared deployment target.** See [the Railway setup guide](RAILWAY.md), `railway.json` and `deploy/railway.env.example` for the single-instance service, persistent volume, public flags and credentials. Render with a paid persistent disk is another compatible option. Vercel would require separate media storage and workers.

## Build and run

```sh
docker build -t focus .
docker run -d --name focus \
  -p 3000:3000 \
  --env-file .env \
  -v focus-data:/data \
  --restart unless-stopped \
  focus
curl http://localhost:3000/api/health
```

The image runs as the unprivileged `node` user, stores media in `/data` (a volume) and has a `HEALTHCHECK` on `/api/health` using the runtime `PORT`. Hosts that mount the volume as root can start the entrypoint as root; it fixes the mount's owner and immediately drops to `node` before starting the application.

Tested locally (Docker 29, Apple Silicon, `linux/arm64` image): health `healthy`, FFmpeg 5.1.9, upload → Muse Spark → SAM 3.1 → render → download of a 4 s clip completed in 26 s with a verified MP4.

## Resources

Measured on a laptop (Apple Silicon, native) for an 8 s, 1280×720, 191-frame clip:

| Stage | Time |
| --- | --- |
| Upload + normalization | ~1 s |
| Muse Spark interpretation | 3–5 s |
| SAM 3.1 segmentation (concept) | ~12 s |
| SAM gap fill (box prompt), when needed | ~17 s |
| Render + encode (Reality Shift / Motion Echo) | 7–13 s |
| Render + encode (Break the Frame, 1080×1350) | 13–16 s |

Recommended: 2 vCPU, 2 GB RAM, 5 GB disk for `/data`. A render holds one decoded frame plus small buffers (< 100 MB). Renders run one at a time per instance, normalization two at a time, SAM one at a time.

**Clips up to 60 s / 150 MB** (`FOCUS_MAX_VIDEO_DURATION_SECONDS`, `FOCUS_MAX_UPLOAD_MB`). Stage times scale roughly linearly with frame count, so expect about 7× the figures above for a 60 s clip (1,440 frames at 24 fps). Normalization allows 10 s of FFmpeg time per second of clip (at least 2 min). SAM streams its answer, so the 180 s Meta request timeout covers only the start of the response; SAM accepts up to 15,000 frames per request. Per clip, `/data` holds the source (≤ 150 MB), the normalized copy and every render for 24 h: size the volume for that. A reverse proxy in front of the container must accept 150 MB request bodies (for nginx: `client_max_body_size 150m;`). Next.js itself adds no limit for these uploads: there is no `proxy.ts`, and the upload route streams the body to disk with its own cap.

## Environment

See `.env.example`. Required: `MODEL_API_KEY`. For a public demo, set at least:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FOCUS_MAX_VIDEO_DURATION_SECONDS` | 60 | Longest accepted clip, 1–600 s. Enforced by the server at runtime; the interface shows the value compiled at build time (Docker: `--build-arg` too). |
| `FOCUS_MAX_UPLOAD_MB` | 150 | Largest accepted upload, 1–1024 MB. Same build-time note. |
| `FOCUS_SAM_DAILY_FRAMES` | 20000 | Daily SAM frame budget (each request bills ≥ 50 frames; a 60 s clip is 1,440 frames). |
| `FOCUS_AI_REQUESTS_PER_HOUR` | 30 | Paid requests per client per hour. |
| `FOCUS_UPLOADS_PER_HOUR` | 20 | Uploads per client per hour. |
| `FOCUS_MAX_ACTIVE_JOBS` | 4 | Running jobs across all clients. |
| `FOCUS_TRUST_PROXY` | 0 | Set to 1 behind a reverse proxy so limits use the real client IP. |
| `FOCUS_AI_DISABLED` | 0 | Emergency switch: 1 refuses new AI work immediately (restart the container to apply). |
| `FOCUS_ADMIN_TOKEN` | — | Enables `GET /api/usage` with header `X-Focus-Admin`. |
| `FOCUS_SESSION_SECRET` | — | **Required in production.** Signs session cookies (32+ chars: `openssl rand -base64 48`). |
| `FOCUS_FREE_EDITS` | 3 | AI edits allowed before Facebook sign-in. Stored on disk, survives restarts. |
| `FOCUS_CHAT_PER_HOUR` | 60 | AI editor messages per client per hour. |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | — | Real Facebook Login. Without them a simulated sign-in runs (development only). |
| `FOCUS_PUBLIC_URL` | request origin | Origin of the OAuth redirect URI. Register `<FOCUS_PUBLIC_URL>/api/auth/facebook/callback` as a Valid OAuth Redirect URI in the Meta app. |
| `FACEBOOK_GRAPH_VERSION` | v23.0 | Graph API version for the login dialog and `/me`. |
| `FOCUS_AUTH_SIMULATED` | 0 | 1 allows the simulated sign-in on a production build (testing only: anyone could sign in as any name). |

Limits are per instance and in memory: they reset on restart. They are practical guards for a demo, not billing-grade enforcement.

## Temporal release flag

`NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS` is a **public build-time boolean**, off by default. Only the exact value `true` enables Time Freeze as an additional effect. Missing, empty and other values compile to `false`. The explicit default is also compiled into API bundles, so changing the container's start-time environment cannot enable a server effect that the browser does not offer.

```sh
# Experimental build: keep server API keys in the normal runtime .env.
NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true pnpm build
pnpm start

# Or build the experimental container.
docker build --build-arg NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true -t focus-temporal .
docker run -p 3000:3000 --env-file .env -v focus-data:/data focus-temporal
```

The Docker build argument carries this boolean only. Server secrets, including Meta API keys, stay in the runtime environment. `docker run -e NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=...` does not change an existing build. For development, set the flag before starting `next dev`, and restart it after changing the flag.

To roll back, build with `NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=false` or rebuild the default Docker image, then replace the running process/container with that build. Keep the data volume. When disabled:

- The stable effects remain available; the Time Freeze tab and saved temporal editor controls are hidden.
- New temporal jobs, cached plans, re-renders with or without supplied parameters, subject changes, gap fills and AI edits of temporal jobs are refused with `effect_disabled` before that work starts.
- A temporal browser draft keeps its text, selects Reality Shift and cancels automatic generation, so it cannot silently spend credits on a different effect. This correction is saved locally, preventing the old autostart from returning after re-enabling the feature.
- Stored plans, masks, jobs and MP4s remain on disk under the normal retention rules. Existing completed export URLs still work; temporal project edits become visible again when the feature is enabled.

The release flag is separate from `FOCUS_AI_DISABLED`: that existing emergency switch stops new AI requests for every effect. A feature-flag rollback takes effect when the replacement build starts; it does not cancel a worker already running in the old process.

Verify both compiled states with no paid API work (Playwright starts an isolated server with AI disabled and empty provider keys):

```sh
NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true pnpm build
NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true FOCUS_E2E_RUNTIME_TEMPORAL_EFFECTS=false pnpm test:e2e
NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=false pnpm build
NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=false FOCUS_E2E_RUNTIME_TEMPORAL_EFFECTS=true pnpm test:e2e
```

`FOCUS_E2E_RUNTIME_TEMPORAL_EFFECTS` belongs only to the test harness. Starting each server with the opposite value verifies that its API and client both obey the compiled release flag. To verify an unset flag, leave it out of `.env*` and use `env -u NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS pnpm build` for the stable build. The stable checks also reopen a pre-rollback draft/project and reject an empty-body render of saved temporal settings without altering the job.

Run builds, TypeScript checks and video suites in sequence. Next regenerates shared type files, while FFmpeg and mask decoding use real CPU and memory. Vitest and browser checks each use one worker, with a 60-second fixture setup limit in Vitest. Browser files share their server and data directory. Upload checks wait for the actual normalization response before inspecting effect controls.

## Operations

- **Health:** `GET /api/health` → 200 when FFmpeg, FFprobe and storage work; includes whether AI is enabled and today's SAM usage.
- **Expiry:** media, masks and renders older than 24 h are deleted when new uploads or jobs arrive.
- **Restarts:** running jobs are marked "interrupted" after a restart; cached plans, masks and renders survive on the volume and are reused.
- **Logs:** server errors are logged with codes; API keys are never logged.

## Local production check without Docker

```sh
pnpm build
pnpm exec next start --port 3201   # Next warns about standalone; it works for local checks
pnpm test:e2e
```
