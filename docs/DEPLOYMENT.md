# Deployment

Focus ships as one Docker container: Next.js standalone server + FFmpeg/FFprobe from Debian. Jobs run in-process and keep state in memory and on a local volume, so run **one instance** (no autoscaling across instances).

Serverless functions are not a fit: a job holds an FFmpeg pipeline for up to ~30 s per clip and keeps files between requests.

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

The image runs as the unprivileged `node` user, stores media in `/data` (a volume) and has a `HEALTHCHECK` on `/api/health`.

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

## Environment

See `.env.example`. Required: `MODEL_API_KEY`. For a public demo, set at least:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FOCUS_SAM_DAILY_FRAMES` | 20000 | Daily SAM frame budget (each request bills ≥ 50 frames). |
| `FOCUS_AI_REQUESTS_PER_HOUR` | 30 | Paid requests per client per hour. |
| `FOCUS_UPLOADS_PER_HOUR` | 20 | Uploads per client per hour. |
| `FOCUS_MAX_ACTIVE_JOBS` | 4 | Running jobs across all clients. |
| `FOCUS_TRUST_PROXY` | 0 | Set to 1 behind a reverse proxy so limits use the real client IP. |
| `FOCUS_AI_DISABLED` | 0 | Emergency switch: 1 refuses new AI work immediately (restart the container to apply). |
| `FOCUS_ADMIN_TOKEN` | — | Enables `GET /api/usage` with header `X-Focus-Admin`. |

Limits are per instance and in memory: they reset on restart. They are practical guards for a demo, not billing-grade enforcement.

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
