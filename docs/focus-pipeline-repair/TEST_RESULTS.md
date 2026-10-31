# Test results

Final state (2026-10-30, code as of the end of Phase 07 work):

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | clean |
| Unit + integration | `npx vitest run` | **86 files, 922 passed, 2 skipped** (the 2 skipped need local data or a live key) |
| Lint | `npx eslint .` | 0 errors, 1 warning (pre-existing, `app/rotoscope/pencil-note.tsx`, untouched) |
| Production build | `next build` in an isolated copy (the dev server's `.next` untouched) | success (standalone output) |
| Docker / Railway image acceptance | `docker build` with docs/RAILWAY.md arguments, then `pnpm test:deployment` | **8/8 passed**, 0 provider calls |

## New test files

| File | Tests | Covers |
|---|---|---|
| `server/rotoscope/provenance.test.ts` | 14 | A/B/C isolation, character swap, coordinate round trips, image side |
| `server/rotoscope/pose-geometry.test.ts` | 11 | pose check on real keypoints (3/3 human verdicts), coverage, unconfirmed joints, canonical joints |
| `server/mapping/structure.test.ts` | 5 | folded and collapsed triangles, clamps, torso fallback |
| `server/animation/muse-image.test.ts` | 6 | request contract, one generation per call, raw output, API failure |
| `server/frame-debug/pipeline-frame.test.ts` | 2 | dry single_frame_debug on a real run (local data) |
| `server/rotoscope/validation.test.ts` | 21 | decision states, colour (palette, gamut, foreign, wrong parts, propagation), proportions estimates, hair top, silhouettes |
| `server/rotoscope/layout.test.ts` | 1 | hair-top rule fixed per run with its layout (local data) |
| `server/rotoscope/temporal.test.ts` | 5 | temporal metrics |
| `server/rotoscope/mannequin.test.ts` | 3 | the character's build on the mannequin |

Changed test helper: `server/mapping/__fixtures__/figure.ts` (`measuredPose` flipped bent forearms; Phase 02).

## Real inference (all bounded; no automatic retries in debug)

| Phase | Generations | Purpose |
|---|---|---|
| 04 | 2 | prompt strategies A/B on the wave frame 1 |
| 05 | 0 (2 reviews) | visual review in debug on the saved outputs |
| 06 | 3 | end to end: wave, second character, other video |
| 07 | e2e-boy: 4; e2e-boy9: 2; e2e-seq: frames 3–6 until the owner stopped it | sequences |

Offline evidence scripts: `scripts/audit/{baseline,isolation,rig-benchmark,colour-calibration,fixture-remeasure,proportion-spread,temporal,attempt-prompt,rebuild-wave-run,migrate-run}.ts`.
