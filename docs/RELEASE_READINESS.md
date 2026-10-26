# Release readiness

Audit date: 2026-10-26. Evidence below comes from commands actually run on this date; "fixture" means recorded or synthetic data, "live" means real Meta Model API calls.

**Recommendation:** ready for a **public hackathon demo** on a single container with the default limits. **Not yet cleared for open-source publication** until the rights question below (Oruka-derived code) are resolved. No blockers remain in the product itself.

## Feature matrix

| Feature | Implementation | Tests | Live API verification | Known problems | Severity | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Upload + validation (MP4/MOV, ≤ 10 s, ≤ 50 MB, real probe) | Complete | Unit + FFmpeg integration; E2E (broken file, 12 s clip) | n/a | — | — | Release |
| Normalization (≤ 720p, 24 fps CFR, H.264, rotation) | Complete | FFmpeg integration (landscape, portrait, square) | n/a | — | — | Release |
| Playback + URL restore | Complete | E2E (time advances after play; reload keeps the video) | n/a | — | — | Release |
| Instruction → plan (Muse Spark 1.3) | Complete | 19 unit tests (parsing, unsupported, injection-shaped concepts, effect coercion) | Live: Spanish instructions → `bridge`, `white-haired boy`, `rock`; unsupported edit refused; `pnpm test:live` planner test passed | Concepts must be plain nouns; planner instructed accordingly after a live miss ("jumping rock") | Low | Release |
| Segmentation + tracking (SAM 3.1) | Complete | 17 tests on recorded SAM output (ordering, gaps, empty, splits) | Live: 1 object × 96/96 frames; 16 rocks; 191-frame anime clip (148/191 by concept, 191/191 after gap fill); empty result handled | SAM can miss a subject on early frames; reported, never faked; fix is an explicit paid pass | Medium | Release |
| Multi-object selection (click / list / all) | Complete | Job tests (selection, free click selection, paid point prompt with fakes) | Live: 16-object scene selected by click in the browser | Paid point prompt verified only with fakes | Low | Release |
| Gap fill (box prompt) | Complete | Unit + job tests; reuse of filled masks by later jobs | Live: 148 → 191 frames on the anime clip | Costs one SAM pass (≥ 50 frames) | Low | Release |
| Reality Shift — selective color | Complete | Pixel tests (color kept, gray background, feathered edge); compositor integration | Live E2E: in-mask saturation 11.9–13.1 vs source 12.5–13.7; outside 5.0 at frames 0/95/190 | — | — | Release |
| Reality Shift — background blur (3 levels) | Complete | Pixel tests (sharp subject, no color bleed) | Live: Golden Gate rock and bridge renders inspected | — | — | Release |
| Break the Frame (1080×1350) | Complete | Pixel tests (clip, unclipped subject, transform consistency); square/portrait sources | Live E2E: 45–51k subject px outside the inner frame at frames 0/95/190; 100% of other outside pixels are canvas color; breakout in 100% of frames | Framing is automatic; low contrast for dark subjects on the dark canvas (light canvas available) | Low | Release |
| Motion Echo | Complete | Pixel tests (opacity order, ghost position, present subject on top) | Live E2E: frame 0 has no ghosts; 12–16k ghost px at frames 95/190; present subject unchanged (mean diff 2.7–4.5) | With a panning camera the trail is subtle and not world-stabilized | Medium | Release as "best with a static camera" |
| Preview + before/after slider | Complete | Browser checks: pointer drag, keyboard (arrows, Home), shared stream | n/a | No audio in comparison mode (the "Editado" mode has audio) | Low | Release |
| Re-render from cached masks | Complete | Job test (new params → new render, same params → instant, no SAM call) | Live: background change re-rendered in ~15 s with no AI call | — | — | Release |
| MP4 export + download | Complete | FFprobe verification on every render; tests for wrong frame count / missing audio | Live E2E: three MP4s, H.264 yuv420p 24/1, 191 frames, 7.958 s, audio start/duration identical to source; correct `Content-Disposition` | — | — | Release |
| Processing feedback (real phases) | Complete | Browser check of phase transitions | Live | — | — | Release |
| Cancellation / retry / restart recovery | Complete | Job tests (cancel kills SAM wait and FFmpeg; retry creates a new job; interrupted jobs marked failed) | n/a | — | — | Release |
| Abuse and cost protection | Complete | 8 guard tests; E2E with emergency switch | n/a | Limits are in memory per instance and reset on restart | Medium | Release (single instance) |
| Health endpoint | Complete | E2E; Docker HEALTHCHECK | n/a | — | — | Release |
| Docker deployment | Complete | Image built and run locally (arm64): healthy, full live job in the container | Live job inside container: 4 s clip → verified MP4 in 26 s | Not yet tested on a cloud host or on amd64 | Medium | Release after a smoke test on the target host |
| Design-system catalog (`/system`) | Preserved | E2E page load | n/a | — | — | Release |

## Rights questions (block open-source publication, not the demo)

| Item | Problem | Severity | Action |
| --- | --- | --- | --- |
| Oruka-derived code | `provenance.json`/docs state no public license is granted for the extracted Oruka code | High | Owner must confirm what may be published |
| Interface font | Inter replaces Optimistic Display; SIL Open Font License 1.1 included in `public/fonts/inter/LICENSE.txt` | — | Keep the included font license |
| License file | Intentionally absent (owner's decision); README states all rights reserved | — | Revisit before publishing |
| Sample media | None in the repo; test clips are generated or kept outside git | — | — |

## Tests executed (2026-10-26)

| Gate | Command | Result |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` (local and in Docker) | Pass |
| TypeScript | `pnpm typecheck` | Pass |
| ESLint | `pnpm lint` | Pass |
| Import/package integrity | `pnpm verify` | Pass (191 files) |
| Unit + integration (Vitest, FFmpeg) | `pnpm test` | **102 / 102 passed** |
| Production build | `next build` | Pass |
| Browser E2E (Playwright, Chrome) | `pnpm test:e2e` | **6 / 6 passed** |
| Live Meta API | `pnpm test:live` | Muse Spark passed; SAM passed every check except an assertion on billed frames (50-frame minimum observed), since corrected and not re-run to save credits |
| Live end-to-end journey | scripted upload → plan → SAM → gap fill → three effects → download (local production server) | Pass, all three MP4s verified |
| Docker | `docker build` + run + health + live job | Pass (local, arm64) |

Not run: tests on a cloud host; amd64 image; screen-reader audit; reduced-motion emulation (verified by code review only).

## Security review

| Check | Result |
| --- | --- |
| API key in client bundles, server bundles or git history | Not found (searched `.next/static`, `.next/server`, all commits) |
| `.env` committed | No; `.env*` ignored except `.env.example`; excluded from Docker context |
| Upload validation | Extension + MIME on client; FFprobe container/stream/duration/resolution on server; 50 MB enforced while streaming |
| Path traversal | All path ids validated (UUID / key patterns); filenames sanitized and never used as paths; malformed filename header → 400 |
| Shell injection | FFmpeg/FFprobe only via argument arrays |
| Timeouts | FFprobe 30 s, normalization 120 s, Meta calls 180 s with bounded retries (transient errors only) |
| Concurrency | SAM 1, Muse Spark 2, renders 1, normalizations 2 per instance; max active jobs 4 |
| Abuse | Per-client hourly limits (AI requests, uploads); daily SAM frame budget; emergency switch; 16 KB JSON cap |
| Diagnostics | `/api/usage` hidden in production unless `FOCUS_ADMIN_TOKEN` is set; keys never logged |
| Cleanup | Failed ingests and renders remove their files; media older than 24 h deleted |
| Access model | No accounts: unguessable UUIDs act as capability tokens (documented) |

## Performance (measured)

8 s, 1280×720, 191-frame clip on a fresh video, local production server:

| Stage | Time |
| --- | --- |
| Upload + normalization | 1.1 s |
| Muse Spark | 3.1–5.4 s |
| SAM concept pass (find 7.5 s + track 5.0 s) | 12.5 s |
| SAM gap fill | 17.4 s |
| Render + encode, same-size effects | 7.2–13 s |
| Render + encode, Break the Frame | 13–16 s |
| Full first edit including gap fill | 51.6 s |

Slowest stage: SAM. Optimization applied from this measurement: new jobs now start from an existing gap-filled segmentation, removing a render pass with missing masks (≈ 10–14 s) for every subsequent effect on the same subject.

## Defects found and fixed during the audit

- Later effects on the same subject started from unfilled masks, rendered once with gaps, then re-rendered → now reuse the filled segmentation.
- `pnpm install --frozen-lockfile` failed in CI/Docker on an undeclared build-script decision (esbuild) → declared in `pnpm-workspace.yaml`.
- A malformed `X-Focus-Filename` header caused a 500 → now 400.
- `/api/usage` was public → hidden in production unless an admin token is configured.
- Unbounded JSON bodies on job routes → 16 KB cap.
- No abuse or cost limits → rate limits, active-job cap, daily SAM budget, emergency switch.
- Media uploaded but never edited was never cleaned → cleanup now also runs on upload.
- No health endpoint or deployment artifacts → `/api/health`, Dockerfile, `.dockerignore`, `.env.example`, deployment docs.

## Known limitations

See the README. In short: ≤ 10 s clips; Motion Echo needs a static camera; SAM can miss frames (reported, fixable with a paid pass); automatic Break the Frame framing; single-instance state; dev server (Turbopack) occasionally serves stale route modules after edits — restart `pnpm dev`.
