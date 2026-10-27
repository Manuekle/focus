# FOCUS FLIPBOOK — FUNCTIONAL VALIDATION & STABILITY

You have completed the initial implementation of Focus Flipbook.

Your next task is NOT to build new features.

Your mission is to verify, debug, test, and stabilize the existing implementation while preserving all previously working Focus functionality.

## Critical rules

- Do not redesign the application.
- Do not change the existing visual identity.
- Do not rewrite working modules unnecessarily.
- Do not remove any Focus V1/V2 features.
- Do not reset Git or discard uncommitted changes.
- Do not create additional animation modes.
- Do not implement Reality Portals.
- Do not work on marketing or hackathon demos.
- Do not change dependencies unnecessarily.
- Do not make paid Meta API calls without explicit authorization.

Focus on application quality and correctness.

## Phase 1 — Full technical verification

Inspect the current repository.

Run:

- TypeScript checks.
- ESLint.
- Production build.
- Existing automated tests.

Fix all failures introduced by Flipbook.

Verify feature flag behavior:

- When disabled, Flipbook UI and API endpoints must be inaccessible.
- When enabled, the editor must load correctly.

Make sure the Meta API key is never exposed client-side.

## Phase 2 — Meta API integration review

Review the actual request contracts for:

- Muse Spark character analysis.
- Muse Image image editing and generation.
- SAM 3.1 image segmentation.

Compare the implementation against official Meta documentation.

Pay particular attention to:

- Muse Image tool options.
- Supported request parameters.
- Image reference handling.
- Correct conversation/reference usage.
- SAM image input format.
- Structured responses.
- Response parsing.
- Authentication.
- Rate limits.
- Network timeouts.

Fix unsupported or invalid request formats.

Do not invent API response structures.

Do not replace real integrations with mock implementations.

Use deterministic fixtures for automated tests.

Only perform paid live API tests after receiving explicit approval.

## Phase 3 — Animation correctness

Verify the eight-pose walking pipeline.

Test:

1. Character analysis.
2. Reference selection.
3. Pose planning.
4. Frame generation.
5. Character extraction.
6. Ground-baseline alignment.
7. Scale consistency.
8. Frame sequencing.
9. Loop playback.
10. Individual frame regeneration.

Check that the eight poses represent actual walking motion.

Verify that the character preserves its appearance between frames.

Detect duplicated poses, missing limbs, unexpected clothing changes, and alignment errors.

Do not claim that visual consistency is perfect based only on automated heuristics.

## Phase 4 — Editor verification

Check every user interaction:

- Upload.
- Character reference selection.
- Start generation.
- Cancel processing.
- Frame preview.
- Play and pause.
- Playback speed.
- Frame stepping.
- Onion skin.
- Frame approval.
- Regenerate one frame.
- Upload replacement frame.
- Restore original frame.
- Reorder frames.
- Walk in place.
- Walk left.
- Walk right.
- Export.

No decorative or nonfunctional buttons.

Ensure approved frames remain protected.

Ensure frame regeneration does not modify unrelated approved frames.

## Phase 5 — Export verification

Test export using deterministic generated frame fixtures.

Verify:

**MP4**
- H.264.
- YUV420P.
- 24 FPS.
- Correct duration.
- Actual animation frames.
- Valid playback.

**GIF**
- Correct frame order.
- Correct frame delays.
- Loop enabled.
- Verified output.

**Sprite sheet**
- Correct ordering.
- Correct frame dimensions.
- Correct transparency where available.

**PNG ZIP**
- All expected frames present.
- Correct filenames.
- Valid image contents.

Use FFprobe and appropriate image-decoding checks.

Do not mark an export successful until the output has been verified.

## Phase 6 — Concurrency and safety

Investigate the reported inconsistency in shared job concurrency limits.

Currently, video jobs and animation jobs may not count each other symmetrically.

Ensure that concurrent workloads cannot bypass intended global resource limits.

Review:

- Processing cancellation.
- Request limits.
- Image-generation budget.
- Failed-request accounting.
- Temporary file cleanup.
- Job expiration.
- Memory usage.
- Paid API retry limits.

Fix genuine defects with minimal architectural changes.

## Phase 7 — Regression protection

Verify that adding Flipbook did not break:

- Existing video uploads.
- Existing video editing.
- Time Freeze.
- Motion Echo.
- SAM video tracking.
- Existing rendering jobs.
- Existing MP4 export.
- Existing workspace navigation.

Do not change the current 10-second video limit as part of this stability pass. Document it as a separate pending product change, because the intended future maximum is 60 seconds.

## Phase 8 — Final report

Create `docs/FLIPBOOK_VALIDATION_REPORT.md`.

Include:

- Checks performed.
- Tests passed.
- Tests failed.
- Bugs found.
- Bugs fixed.
- Real API tests performed, if authorized.
- Untested Meta API integrations.
- Export verification results.
- Remaining technical risks.
- Regression test results.
- Current release readiness.

Distinguish clearly between:

- Implemented.
- Unit tested.
- Integration tested.
- Live API verified.
- Visually verified.

Do not claim the product is fully working unless those checks actually pass.

If paid API verification has not been authorized, finish all offline checks, provide the exact live-test procedure, and identify what remains unverified.

**Priority: Make Focus Flipbook reliable before adding anything else. Begin the technical verification now.**