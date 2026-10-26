# Architecture

One Next.js 16 application, one process. The browser never talks to Meta; route handlers do.

```
app/_editor/        React workspace (upload, composer, stage, overlays, comparison, panels)
app/api/            Route handlers (thin: validate, call server/, map errors)
server/             Everything with side effects
  videos.ts           upload → FFprobe validation → FFmpeg normalization
  jobs.ts             job lifecycle, caches, dedup, selection, gap fill, renders, cleanup
  guard.ts            rate limits, active-job cap, SAM budget, emergency switch, JSON limits
  ai/meta.ts          Meta client, retries, error mapping, concurrency limiters
  ai/planner.ts       Muse Spark → validated EditPlan
  ai/sam.ts           Files API + SAM 3.1 streaming → Tracking
  video/frames.ts     FFmpeg decode/encode pipes (RGBA frames, cancellable)
  video/masks.ts      SAM rasters → full-frame alpha, feathering
  video/effects.ts    pixel operations (selective color, mask-aware blur, ghosts)
  video/layout.ts     Break the Frame geometry
  video/compositor.ts per-effect frame processors, export, comparison, FFprobe verification
shared/             Types and pure logic used on both sides (Zod schemas, tracking model, coordinates)
```

## Data flow

1. `POST /api/videos` streams the raw body to disk with a 50 MB cap, probes it, normalizes it (`normalized.mp4`, `poster.jpg`) and stores `asset.json`.
2. `POST /api/edits` creates a job (deduplicated by video + effect + normalized prompt) and runs it in the background:
   - **interpreting** — Muse Spark, cached per request in `plans/`.
   - **segmenting** — SAM 3.1, cached per concept in `segmentations/c-*.json`; a gap-filled variant (`c-*+g-*.json`) is preferred when it exists.
   - **awaiting_selection** when several objects match and the plan asked for one.
   - **rendering** — compositor; cached per (segmentation, selection, params) in `renders/r-*`.
   - **completed** — output verified; `result?kind=output|compare` serves it with Range support.
3. The editor polls `GET /api/jobs/:id` (700 ms). Each job carries `status`, a real `phase`, progress and detail text.

Process-wide state (running jobs, in-flight deduplication, locks, limiters, rate windows) lives on `globalThis`, because Next bundles each route handler separately.

## Tracking model

`shared/tracking.ts` — frames sorted by explicit SAM frame index; each frame lists objects with a half-open box, optional confidence and the SAM mask payload (one-bit base85). Object summaries record frames present, first/last frame, mean confidence and area. Missing frames are listed, never interpolated.

## Rendering

For every frame *i* of the normalized video: decode RGBA *i* → rasterize the selected objects' masks of frame *i* → feather → effect → encode. Only one frame (plus, for Motion Echo, cropped subject ghosts) is held in memory.

- **Selective color:** Rec. 709 luma, blended by the inverse mask.
- **Background blur:** normalized convolution, `blur(color·w)/blur(w)` with `w = 1 − mask`, then composited under the sharp subject.
- **Break the Frame:** one transform `canvas = source·scale + offset` feeds both layers: video clipped to the inner frame, subject drawn unclipped. Layout picks the frame edge nearest the subject and cuts through it.
- **Motion Echo:** ghosts of earlier frames (spacing × count) drawn with decreasing opacity, then the present subject on top.

The encoder receives exactly `frameCount` frames at 24 fps; audio is copied from the normalized file and trimmed to the video length. A second FFmpeg pass stacks original over edited for the comparison stream.

## Security model

- The Meta key is read only in `server/ai/meta.ts`; no client module imports server code (`scripts/verify.mjs` enforces no `node:` imports in shared UI code).
- FFmpeg/FFprobe run with argument arrays, never a shell. Uploaded file names are sanitized and never used as paths.
- Every id in a path (video UUID, job UUID, segmentation key) is validated by pattern before use.
- JSON bodies are capped at 16 KB; uploads at 50 MB while streaming.
- Video ids are unguessable UUIDs and act as capability tokens: there are no accounts.
