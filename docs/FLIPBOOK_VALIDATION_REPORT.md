# Focus Flipbook: validation report

Date: 2026-10-27 · Scope: the stability pass defined in `PLAN/AUDIT.md` · Paid Meta API calls: **none** (not authorized).

## Verdict

**Ready for a live Meta trial behind the flag; not ready for public release.** The offline pipeline, editor and exports are verified end to end with deterministic fixtures. Nothing has been run against the real Meta API yet:

- whether Muse Image produces consistent walk poses
- whether SAM 3.1 segments illustrations
- the real latency of either model

Keep `NEXT_PUBLIC_ENABLE_FLIPBOOK=false` in production until the live procedure below passes.

## Verification levels

| Area | Implemented | Unit tested | Integration tested | Live API verified | Visually verified |
| --- | --- | --- | --- | --- | --- |
| Upload + decode (PNG/JPEG/WebP, EXIF, limits) | ✅ | ✅ | ✅ (API + browser) | n/a | ✅ |
| Muse Spark character analysis | ✅ | ✅ parsing, assessment | ✅ (fake service) | ❌ | n/a |
| Muse Spark pose plan | ✅ | ✅ parsing, phase order, prompts | ✅ (fake service) | ❌ | n/a |
| Reference selection (original / clean / upload) | ✅ | ✅ decision | ✅ | ❌ (clean redraw = Muse Image) | ✅ |
| Muse Image frame drawing | ✅ | ✅ prompts | ✅ (fake service) | ❌ | ❌ (real drawings) |
| SAM 3.1 still-image segmentation | ✅ | — | ❌ (switched off in tests) | ❌ | ❌ |
| Key-background and alpha cut-out | ✅ | ✅ | ✅ | n/a | ✅ |
| Baseline / torso registration, bob, stride | ✅ | ✅ | ✅ | n/a | ✅ |
| Quality checks | ✅ | ✅ | ✅ | n/a | ✅ (flags a deliberately off-model replacement) |
| Muse Spark AI review | ✅ | ✅ parsing | ❌ | ❌ | ❌ |
| Player, onion skin, walk modes | ✅ | ✅ timing/position math | ✅ (browser) | n/a | ✅ |
| Frame approve / redraw / replace / restore / reorder | ✅ | — | ✅ | ❌ (redraw = Muse Image) | ✅ |
| MP4 / GIF / sprite sheet / PNG ZIP | ✅ | ✅ | ✅ (browser + FFprobe) | n/a | ✅ |
| Feature flag | ✅ | ✅ | ✅ (production server) | n/a | ✅ |

"Visually verified" means a person-readable image was produced and inspected: the aligned contact sheet, the editor screenshots and the decoded MP4 frames. It was done with the synthetic walker, not with Muse Image drawings.

## Checks performed

| Check | Result |
| --- | --- |
| `tsc --noEmit` | ✅ clean |
| `eslint .` | ✅ clean |
| `vitest run` (whole repo) | ✅ **312 passed**, 1 skipped (opt-in load test) |
| Flipbook suites only | ✅ 49 tests: `shared/flipbook.test.ts`, `server/animation/{planning,frame-alignment,export,flipbooks}.test.ts` |
| `next build`, default flags | ✅ |
| `next build`, Flipbook and Time Freeze flags on | ✅ (`/flipbook` becomes dynamic) |
| Playwright e2e, default build | ✅ 13 passed (the 2 Time Freeze specs skip by design) |
| Playwright e2e, Time Freeze build | ✅ 13 passed (the 2 rollback specs skip by design); together all 15 specs passed |
| Flag off, production server | ✅ `/flipbook` returns 404; every `/api/flipbooks/*` route returns 404 `flipbook_disabled` (405 for an unsupported method); no nav links |
| API key in client bundle | ✅ 0 matches of the key value, `MODEL_API_KEY`, `META_API_KEY` or `api.meta.ai` across `.next/static` |
| Browser pass (gstack headless Chromium, production build, AI disabled, seeded flipbook) | ✅, see Phase 4 below |

## Phase 2: Meta contracts against the official docs

Compared with dev.meta.ai pages: image-generation, anchored-image-series, sam/segmenting, structured-output, image-understanding, responses schemas, pricing-rate-limits.

| Contract | Implementation | Docs | Status |
| --- | --- | --- | --- |
| Muse Image endpoint | `POST /v1/responses`, `model: muse-image-1.0` | same | ✅ |
| Tool options | inside `tools[]`: `type: image_generation`, `size`, `output_format: png`, `reasoning_strength`, `enable_image_search/web_search/shell: false` | the options belong in the tool entry; only `image_generation` is accepted | ✅ shape; `enable_image_search` appears in the docs text but not in the JSON example, so it is unverified live |
| Reference images | `input_image` parts with `image_url` data URLs, at most 1024 px; anchor first | multiple references per turn are allowed; data URLs up to 20,971,520 chars | ✅ |
| Conversation use | `store: false`, the anchor re-sent every turn, no `previous_response_id` chain | both approaches documented; chaining grows context and can drift | ✅ deliberate |
| Output parsing | `output[]` item with `type === "image_generation_call"`, base64 `result` | same ("select by type, not position") | ✅ |
| Transparency | always cut out locally | "background is always opaque" | ✅ |
| Content policy | 400 `content_policy_violation` becomes `image_blocked` and is refunded | blocked images aren't billed | ✅ |
| SAM image input | `input_text` concept + `input_image` with `image_url` data URL, no `detail`; metadata `mask_encoding: one_bit`, `include_confidence: "true"` (strings); streaming parsed by `parseImageStream` | same; `file_id` documented for video only | ✅ |
| Muse Spark structured output | `text.format: { type: json_schema, strict: true }`, every object has `additionalProperties: false`, every key in `required`, `anyOf` only below the root | strict subset rules | ✅ |
| Muse Spark image input | `input_image` with `detail: "high"` | `detail` ∈ low/high/auto/original | ✅ |
| Auth | Bearer key from `MODEL_API_KEY` (falls back to `META_API_KEY`), server only | same | ✅ |
| Rate limits | Muse Image: 2 concurrent per process; SAM: 1; Muse Spark: 2 | Muse Image 150 RPM, SAM 3,000 RPM, Spark 3,000 RPM per team | ✅ well under |
| Retries | 2 attempts for image and SAM, 3 for Spark; exponential backoff on 429 and 5xx | backoff with jitter; honor `Retry-After` | ⚠️ no jitter and no `Retry-After` (existing shared helper, unchanged) |
| Timeouts | SDK timeout 180 s per attempt | no guidance | ⚠️ unknown real Muse Image latency |

No invalid request formats were found, so no request shapes changed in this pass.

## Bugs found and fixed

| # | Severity | Bug | Fix |
| --- | --- | --- | --- |
| 1 | High | Actions answered before their worker marked the flipbook active. The editor polls only active flipbooks, so after Redraw, Replace, Generate missing or a reference change it stopped polling and never showed the result. Caught by the integration tests. | `startVisible()` in `server/animation/flipbooks.ts` starts the worker and writes the running status before the request returns. Tests assert that the response is already `generating` / `referencing`. |
| 2 | High | Video jobs passed `running.size` to the shared cap, ignoring Flipbook workers, so mixed workloads could exceed `FOCUS_MAX_ACTIVE_JOBS`. | `activeWorkCount()` in `server/jobs.ts` (video jobs + Flipbook workers) is now used by every video and Flipbook gate. |
| 3 | Medium | Every failed drawing was refunded to the budget, including timeouts and unreadable images that may have been billed. | `unbilled()` refunds only clearly unbilled failures (blocked, incomplete, 4xx/5xx refusals). Timeouts and cancels stay counted. Tested. |
| 4 | Medium | Failed SAM still-image calls counted toward the daily SAM frame budget. | `samFramesSince` counts only successful `segment_image` entries. |
| 5 | Medium | Background enclosed between the legs (or inside a bent arm) stayed in the sprite, showing as white patches over any background. Found in the visual contact sheet. | `removeEnclosedBackground()` removes interior key-colored regions above a minimum size; small details like eyes are kept. Regression test asserts no opaque key-colored pixels remain. |
| 6 | Medium | Exports dropped from the 24-entry list stayed on disk. | Their directories are removed when they fall off the list. |
| 7 | Medium | Test isolation: the SAM call in the cut-out wasn't injectable, so a test run with a key in the shell environment could make a paid call. | `segmentation.segment` is replaceable; every Flipbook test sets it to `null`. |
| 8 | Low | Frame inspector and create preview cropped the character (percentage-height image inside an aspect-ratio box). Seen in screenshots. | Images are absolutely positioned and contained. |
| 9 | Low | Player stage stayed full width when its height was capped, leaving dark bands. | Stage `max-width` follows its aspect ratio. |
| 10 | Low | Shared guard and Meta errors showed in Spanish in the English Flipbook UI. | `messageFor()` maps shared codes (`ai_disabled`, `rate_limited`, `meta_*`, …) to the editor's English copy, including errors stored on frames. |

## Phase 3: animation correctness (deterministic fixtures)

Fixture: `server/animation/__fixtures__/walker.ts`, an SVG side-view walker. Its legs and arms take distinct contact / down / passing / up poses. The eight drawings are deliberately drawn at different scales (0.90–1.18) and offsets, as separate generations would be.

- **Extraction:** all 8 cut out (key path). Feet found within 5 px of the true lowest foot. Enclosed gaps are removed. Real alpha is used when present. A noise image fails with `extraction_failed` instead of producing a fake sprite.
- **Baseline:** every aligned sprite's lowest row is within 3 px of `BASELINE_Y`, and its torso column within 4 px of the cell center.
- **Scale:** height after registration is within 2% of the bob chart; down is the lowest pose, up the highest. Size drift is reported (`relativeScale` up to 1.18).
- **Stride:** measured from contact and passing spans (`strideMeasured: true`, 539 px per cycle on the seed).
- **Sequencing and loop:** 8 phases in fixed order. Every supported length is a whole number of cycles, and the last output frame is drawing 8.
- **Duplicates:** a repeated neighbor is flagged `near_duplicate`; the clean cycle has none.
- **Other checks:** color drift, cropping, size drift and a missing stride are flagged. A deliberately off-model replacement in the browser was flagged at 54% color drift and 22% resize.
- **Redraw isolation:** redrawing f3 changed only f3's version. The approved f2 can't be redrawn or restored (the API returns `frame_approved`), and every other frame's version and approval is unchanged.

**Not verified:** whether real Muse Image drawings keep the character's identity, form a recognizable walk, and avoid missing limbs or clothing changes. The checks above flag problems; they can't certify anatomy or identity.

## Phase 4: editor, in the browser

Production build, AI disabled, a flipbook seeded through the real pipeline (fake paid calls). Evidence: `.gstack/browse-reports/2026-10-27-0112/` (local, not committed). Console showed no errors apart from expected 503s from AI-disabled requests and a framework CSS preload warning.

| Interaction | Result |
| --- | --- |
| Upload (valid / wrong type) | ✅ preview and size shown / "Upload a PNG, JPEG or WebP image." |
| Create animation with AI off | ✅ clear English error; nothing created |
| Play / pause | ✅ drawing advances while playing, holds when paused |
| Playback speed | ✅ measured 8.0 / 16.0 / 4.0 drawings/s at 1× / 2× / 0.5×; 12.0 at 12 fps |
| Frame stepping, restart | ✅ step ±1 and restart; the frame panel follows |
| Loop off | ✅ stops on the last drawing after one full length |
| Onion skin | ✅ canvas changes when on; exact frame restored when off |
| Walk in place / right / left | ✅ 512×768 stage in place; 1366×768 across; moves 538 px per cycle (stride 539), left mirrors right |
| Approve / unapprove | ✅ persisted; approved frame's Redraw, Replace and note are disabled, with a notice |
| Redraw with AI off | ✅ English error; version and budget unchanged |
| Upload replacement frame | ✅ transparent upload cut out by its own alpha; UI updated without reload |
| Restore original | ✅ |
| Reorder | ✅ Move earlier/later and Alt+←/→ |
| Custom background | ✅ uploaded, selected, used in the export |
| Export MP4 / GIF / sprite sheet / PNG ZIP | ✅ all four; downloads return 200 with attachment names; MP4 can't be set transparent |
| Contact sheet | ✅ PNG of every registered drawing in order |
| Mobile and tablet layout | ✅ stacks cleanly (`editor-mobile.png`, `editor-tablet.png`) |
| Cancel processing | ✅ integration test (needs a running worker, which can't happen with AI off) |

Not exercised in the browser: reference switching that needs Muse Image, and the AI review (needs Muse Spark). Their parsing and state handling are covered by tests.

## Phase 5: export verification

Deterministic sprites, checked by FFprobe and by decoding the files independently:

- **MP4:** h264, yuv420p, `24/1`, exactly 48 frames, 2.000 s, no audio. Each decoded frame k matches drawing ⌊k/3⌋ mod 8 at the shared placement (mean error < 4/255). Frames 0–2 are identical, 2→3 changes, and frame 24 equals frame 0 (the loop). Walking right matches the expected stage frames. The browser export also probed clean at 1366×768 with the custom background.
- **GIF:** 8 frames, NETSCAPE infinite loop, total delay ≈ 1.00 s (125 ms per drawing, alternating rounding), at most 640 px, transparent background. Each decoded frame best matches its own phase.
- **Sprite sheet:** 4×2 grid of exact cell size with alpha. The atlas JSON order, coordinates and phases match, and each cell matches its sprite (IoU > 0.99).
- **PNG ZIP:** read by an independent parser: `frame_000…007.png` plus `animation.json`, each decoding to the right size and drawing (IoU > 0.99).

## Phase 6: concurrency and safety

- **Shared cap:** fixed (#2).
- **Cancellation:** abort reaches the Meta SDK calls. A late answer after cancel can't write (tested). Unfinished frames fall back to their last registered drawing or show as failed.
- **Request limits:** every paid action passes `guardAiRequest` (emergency switch, active-work cap, hourly rate, SAM daily budget). AI review passes `guardChatRequest`. A new anonymous animation spends one free edit. JSON bodies are capped at 16 KB and uploads at 15 MB while streaming.
- **Drawing budget:** 16 by default; going past it needs an explicit confirmation, which extends the budget by exactly what was confirmed (tested). Refunds follow #3.
- **Temp files:** export temp directories are removed on failure, GIF source frames after success, and dropped exports (#6). Atomic-write leftovers from a crash go with the 24 h expiry.
- **Expiry:** flipbooks and uploads expire 24 h after their last change; running work is never removed.
- **Memory:** at most one 15 MB upload buffer per request, 36 MP decode limit, about 1.5 MP pixel buffers per cut-out, 8 cell-size sprites per export, one export at a time.
- **Paid retries:** at most 2 attempts for Muse Image and SAM, 3 for Muse Spark.

## Phase 7: regressions

Video upload, editing, Reality Shift, Break the Frame, Motion Echo, Time Freeze, SAM video tracking, the render jobs and MP4 export all pass their existing unit, integration and e2e suites, unchanged. The workspace and editor navigation is unchanged with the flag off.

**Video limit (follow-up change, 2026-10-27):** uploads now accept up to **60 s / 150 MB**, configured by `FOCUS_MAX_VIDEO_DURATION_SECONDS` / `FOCUS_MAX_UPLOAD_MB` (see `docs/DEPLOYMENT.md`). Flipbook doesn't use video uploads and is unaffected.

## Remaining technical risks

1. **Identity consistency of real Muse Image drawings:** the main unknown. Mitigations in place: an immutable anchor, the identity text repeated in every prompt, checks, redraw with a note, replace.
2. **SAM 3.1 on illustrations:** may miss stylized characters. The fallback is the key-background cut-out, flagged on the frame.
3. **Muse Image latency and timeout:** 180 s per attempt. Eight drawings at 2 concurrent could take minutes.
4. **`enable_image_search: false`:** in the docs text but not their JSON example. If Meta rejects it with 400, remove that one key in `server/animation/muse-image.ts`.
5. **Retries:** no jitter or `Retry-After` handling (shared helper, unchanged).
6. **Walking across in a 2 s export:** the character can leave the stage partway through, because it wraps only after fully exiting.
7. **Persistence:** single-process, in-memory locks and workers, like the video jobs. Flipbooks aren't saved into projects.

## Live test procedure (needs explicit approval; about $0.10–0.20 and 10 SAM image calls per run)

1. Put a real `MODEL_API_KEY` in `.env` and set `NEXT_PUBLIC_ENABLE_FLIPBOOK=true`.
2. Run `pnpm dev`, then open `http://localhost:3200/flipbook`.
3. Upload a full-body, side-view character on a plain background. Prompt: `Walk to the right`. Expect, in order: analyzing, planning, preparing reference (no Muse Image call for a side view), 8 drawings, cut-outs, checks, ready.
4. Check:
   - `.focus-data/usage.jsonl` lists 1 `flipbook_analyze`, 1 `flipbook_plan`, 8 `image_generate`, and 9 `segment_image` (reference + 8), all `ok: true`.
   - Frame metrics read "Cut out by SAM 3.1". If they read "Background color", SAM missed (risk 2).
   - Open **Contact sheet** and look for the same character in every frame, legs in 8 distinct stride positions, no missing limbs.
   - Play at 8 drawings/s: it should read as a walk with no pop at the loop.
5. Redraw one frame with a note, approve another, and confirm only the first changes.
6. Export MP4 and GIF and play both outside the app.
7. Repeat with a front-view character to exercise the clean-reference path, which pauses at "reference ready".
8. Record the results in this file under a new "Live API verification" section.
