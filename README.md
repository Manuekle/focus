# Focus — Make anything stand out.

Focus is an AI video editor. Drop a short clip, describe what should stand out in one sentence, and Focus finds the subject, tracks it frame by frame and renders a cinematic effect around it — exported as a real MP4.

> **Built during Meta Global AI Developer Hackathon 2026.** See [the hackathon section](#built-during-meta-global-ai-developer-hackathon-2026).

The interface is in Spanish. The three effects:

| Effect | What it does | Status |
| --- | --- | --- |
| **Reality Shift** | The subject keeps its color, stays sharp, or stands in a **spotlight**; everything else turns gray, blurs or falls into shadow. | Working, verified on real footage (spotlight: real masks, offline render) |
| **Break the Frame** | The video sits inside an inner frame on a 1080×1350 canvas; the subject is drawn above it and steps out across the frame edge. | Working, verified on real footage |
| **Motion Echo** | Fading copies of the subject from earlier frames trace its path. | Working; designed for static cameras (see limitations) |

**Finish** (any effect): color looks (Cinematic, Noir, Golden hour, Moonlight, Vintage film, Vivid), a glow or outline drawn from the subject's own mask, vignette, film grain and letterbox.

**AI editor.** Once a result is ready, keep talking to it: "make it cinematic with a gold glow", "more dramatic", "turn it into motion trails". Muse Spark answers with a bounded settings patch (validated with Zod, numbers clamped) and Focus re-renders from the saved masks: no new SAM pass. Every turn's version can be restored for free. A request that needs another subject comes back as a suggested new edit, never as silent paid work.

**Accounts.** Anyone can try Focus: 3 free AI edits without an account (counted server-side by an anonymous cookie and the client address; `FOCUS_FREE_EDITS`). After that, "Continue with Facebook". Signed-in edits are saved as **projects** (one per clip, every edit and AI editor turn kept, exempt from the 24-hour cleanup). Locally the Facebook step is simulated; set `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` and the same routes run the real Facebook Login (Graph API authorization-code flow). The home page hands the clip and instruction to the full editor (`/editor`) through `localStorage`, so the instruction also survives the sign-in round trip.

## How it works

```
Upload → Describe → Identify → Track → Transform → Preview → Export
```

1. **Upload.** FFprobe validates the real media (MP4/MOV, ≤ 60 s, ≤ 150 MB by default; `FOCUS_MAX_VIDEO_DURATION_SECONDS` / `FOCUS_MAX_UPLOAD_MB` in `.env.local`). FFmpeg normalizes it once: ≤ 720p, 24 fps constant, H.264, rotation applied. This normalized file is the single source for segmentation *and* rendering, so masks and frames can never drift apart.
2. **Describe → Identify.** **Muse Spark 1.3** reads the instruction (any language) and the first frame and returns a strict JSON edit plan: a short English noun phrase for the subject, the effect, bounded parameters, or a clear "unsupported" / "needs clarification" verdict. Zod validates everything; the model never produces commands, paths or FFmpeg arguments.
3. **Track.** **SAM 3.1** receives that noun phrase and the normalized video (Files API + streaming Responses API) and returns per-frame masks with stable object ids, parsed with `@meta-sam/parser`. When several objects match, the user clicks the right one on the video — a click on an existing mask costs nothing. Frames SAM missed can be completed with one explicit box-prompted pass.
4. **Transform → Export.** A deterministic compositor decodes the normalized video frame by frame through an FFmpeg pipe, applies the selected masks of that same frame, and encodes H.264/yuv420p with the original audio. Every export is verified with FFprobe (codec, size, fps, exact frame count, duration, audio) before it is offered for download.
5. **Preview.** A before/after slider draws both halves from one stacked stream, so the two sides cannot desynchronize.

Changing an effect setting re-renders from the stored masks: no new AI call. Identical requests reuse the existing job.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Release status: [docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md).

## Run it locally

Requirements: Node.js 24, pnpm 12, FFmpeg + FFprobe on `PATH`, a Meta Model API key.

```sh
pnpm install
cp .env.example .env      # set MODEL_API_KEY
pnpm dev                  # http://localhost:3200
```

- `/` — the editor.
- `/api/health` — readiness (FFmpeg, FFprobe, storage, AI switch).

Uploads, masks and renders live in `.focus-data/` (git-ignored) and expire after 24 h.

## Tests

```sh
pnpm check       # TypeScript, ESLint, unit + integration tests
pnpm test        # Vitest only (no network, no credits): parsing, plans, jobs, compositor, FFmpeg exports
pnpm build && pnpm test:e2e   # Playwright (installed Chrome) against the production build, AI switched off
pnpm test:live   # Paid v1 planner, AI editor and SAM checks. Needs a Meta API key.
pnpm test:live:temporal # Opt-in real-footage temporal checks; see docs/FOCUS_V2_LIVE_TESTING.md.
```

Unit tests replay **recorded** SAM 3.1 output (`server/ai/__fixtures__`); they are not live tests. The live path is covered by `pnpm test:live` and by the end-to-end journey recorded in [docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md).

## Deploy

A single Docker container (Next.js standalone + FFmpeg). Video processing is long-running and CPU-bound, so it needs a container host, not serverless functions.

```sh
docker build -t focus .
docker run -p 3000:3000 --env-file .env -v focus-data:/data focus
```

Resources, abuse protection and environment variables: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Railway setup: [docs/RAILWAY.md](docs/RAILWAY.md). The repository includes `railway.json`, a production variable template and `pnpm test:deployment` to verify the Docker image with a persistent volume and AI disabled.

Time Freeze is experimental and off by default. Enable it with `NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true pnpm build`, then start that build. Docker uses `docker build --build-arg NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true -t focus-temporal .`. This public boolean is compiled into both browser and API bundles; switching it on or off requires a rebuild. See [release and rollback checks](docs/DEPLOYMENT.md#temporal-release-flag).

## Known limitations

- Clips up to 60 s / 150 MB (configurable), processed at ≤ 720p and 24 fps.
- **Motion Echo assumes a static camera.** With a panning camera, trails stay where the subject *was on screen*, not in the world; there is no stabilization.
- **Break the Frame** chooses its framing automatically. When the subject barely leaves the inner frame, the app says so; it never invents pixels beyond the source.
- SAM may miss a subject on some frames (e.g. at the start of a shot or while partly hidden). Those frames are reported, never faked; "Completar el seguimiento" runs one extra paid SAM pass.
- Concepts work best as simple nouns plus one attribute ("white-haired boy", "red car").
- One container instance: jobs and limits live in process memory plus local files.

## Built during Meta Global AI Developer Hackathon 2026

**Problem.** Object-aware video effects — keeping one person in color, letting a dancer step out of the frame — normally need rotoscoping by hand, frame by frame, in professional software. Most people who want these shots for social video cannot do that.

**What we built.** A focused editor where the whole workflow is one sentence: upload, describe, get an exported MP4 with the effect applied to the right subject on every frame.

**Meta models and why each is essential.**

- **Muse Spark 1.3** turns free-form, multilingual instructions ("Deja al chico de pelo blanco en color…") into a constrained plan. It looks at the actual frame to choose a noun phrase SAM can see, picks the effect variant, and refuses edits Focus cannot do. Without it, users would have to speak SAM's prompt language.
- **SAM 3.1** does the part that used to be manual: it finds every instance of the concept and tracks each with a stable identity through the clip, returning pixel masks for every frame. Box prompts complete frames the concept pass missed.

**Technical challenges.**

- *Mask/frame alignment:* SAM and the compositor read the exact same normalized file; frame indices are explicit (SAM may stream frames out of order).
- *Edge quality:* masks are feathered symmetrically around SAM's boundary; background blur uses normalized convolution so the subject's color never smears into the background.
- *Break the Frame:* one source→canvas transform drives both the clipped video layer and the unclipped subject layer; the layout cuts the frame edge through the subject on its nearest side.
- *Honest progress:* every stage in the UI is driven by a real signal (first SAM frame received, last frame composited, verification started).
- *Cost control:* plan, segmentation and render caches; deduplicated requests; free re-selection; rate limits, a daily SAM budget and an emergency switch for public demos.

**Real-world utility.** Creators, marketers and editors get rotoscope-grade isolation for short clips in seconds, with an MP4 ready to post.

**Demo.** Use a short clip (≤ 60 s) of a person or object moving against a mostly static background:

1. *Reality Shift* — "Deja a la persona en color y todo lo demás en blanco y negro".
2. *Break the Frame* — "Haz que la persona salga del marco"; switch the background to *Claro* for dark subjects.
3. *Motion Echo* — on a fixed-camera shot: "Añade estelas de movimiento a la persona".

Drag the before/after slider, change a setting (re-render without AI calls), and download the MP4.

## Rights and attribution

No open-source license is granted at this time: **all rights reserved** unless stated otherwise.

- The design-system base in `components/`, `lib/` and `styles/` was extracted from Oruka (see `provenance.json`); this repository grants no license to that code.
- **Inter** (`public/fonts/inter/`) is © The Inter Project Authors and distributed under the included SIL Open Font License 1.1 (`LICENSE.txt`).
- Meta models are used through the Meta Model API under Meta's terms; `@meta-sam/parser` is distributed under the SAM License.
- Dependencies keep their licenses: Next.js, React, Zod, Motion and Hugeicons free icons (MIT); OpenAI SDK and Sharp (Apache-2.0). FFmpeg (LGPL/GPL, including libx264) is invoked as an external program.
- Character templates **Ichika** and **Seita** were supplied by the user, who states they generated them with Muse. See `public/demo/flipbook/README.md`. The landing currently shows static illustrations while a new animation is prepared.
- The video-effect demos in `public/demo/` use the user-supplied `270507.mp4`, processed with actual SAM 3.1 masks and the Focus compositor. See `public/demo/README.md` for provenance and render parameters.
