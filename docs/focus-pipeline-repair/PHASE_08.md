# Phase 08 — Generalization and release validation

**Status: NOT_STARTED** (Rule 1: Phase 07 is BLOCKED, so this phase cannot start).

What already exists as preliminary evidence, collected while Phase 07 was in progress — it does not count as this phase's gate:

| Item | Evidence | State |
|---|---|---|
| Unit / integration tests | 922 pass, 2 skipped | done |
| Typecheck, lint | clean; 0 errors | done |
| Build | standalone build succeeds | done |
| API routes | no route added or changed; request/response contracts unchanged; new manifest fields (`decision`, `status`, `severity`, `layout.hairTop`, palette `gamut`/`sheetShares`) are optional | reviewed |
| Run persistence | old runs keep working: older `layout.json` keeps its hair-top rule; older palettes and readings are re-measured automatically; `Attempt.decision` optional | tested (`layout.test.ts`) |
| Railway compatibility | no new dependency; `debug_runs/` added to `.dockerignore` and `.railwayignore` (162 MB that would have gone into the build context); the pose worker stays outside the web image as before. Image built with the documented arguments (docs/RAILWAY.md) and `pnpm test:deployment` run: **8/8 checks passed, 0 provider calls** (non-root, root-owned volume writable, dynamic port healthcheck, Flipbook/sessions, uploads, FFmpeg, persistence after restart, no .env in the image). A first build with default arguments failed the test on `/flipbook` → 404 only because Flipbook is off by default; not a regression | done |
| UI | `/rotoscope` renders with no console errors; signed-in views not checked (sign-in not performed by this work) | partial |
| Inputs exercised with real inference | anime only: 2 characters on one recording, 1 character on another video, 9-frame sequences up to 6 frames | narrow |

Not covered at all yet: cartoon / chibi / non-human characters, back views, fast motion, multiple people, different frame counts and resolutions beyond two videos, loose vs tight clothing comparisons. See KNOWN_LIMITATIONS.md.
