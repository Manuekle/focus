# Final delivery — partial (Phase 07 BLOCKED)

Phases 00–06 PASSED. Phase 07 is BLOCKED on a real nine-frame run with the current code, which the owner runs; Phase 08 has not started. This document reports only what is verified.

## 1. Problems found

On the observed case (9 frames, 0/9 approved, 3 rejections at frame 1) the evaluator, not only the generator, was wrong:
- the pose check measured only the two legs (hidden under the skirt) and never the arms;
- the palette had no skin, so every drawing's skin was "a colour the character doesn't have";
- the proportions were held to forearms the sheet shows foreshortened;
- the sheet's and the drawings' hair tops were measured by different rules (heads read 15–19 % small on every good drawing of another character);
- the visual review never ran.

In generation:
- a call could bill two generations;
- the palette sent as "the only colours allowed" lacked skin;
- the mannequin gave every character the same generic slim body;
- the previous frame was told to define the character;
- the frame reading carried the video subject's flat shoes and stockings into the character;
- one bad frame's colours were the reference for the next.

## 2. Confirmed root causes

PHASE_00.md C1–C8, PHASE_05.md (proportions, colour calibration), PHASE_07.md (mannequin, propagation, A→B leaks), PHASE_07 work on the owner's run `41b85162` (prompt in `prompts/`).

## 3. Architecture now

See ARCHITECTURE.md. Changes:
- provenance contracts A/B/C with hashes, checked before every request (`provenance.ts`);
- canonical joints with visibility (`joints.ts`);
- pose check with noise-based uncertainty and coverage (`pose-match.ts`);
- decision engine ACCEPTED / REVIEW_NEEDED / REJECTED / INCONCLUSIVE, where only REJECTED redraws (`decision.ts`, `run-state.ts`);
- palette with soft-shaded colours, the sheet's gamut and sheet areas (`colour.ts`);
- proportions with sheet-foreshortening estimates and noise margins (`body-map.ts`);
- one hair-top rule (`grid.ts`);
- mannequin with the character's legs and hips (`mannequin.ts`);
- temporal metrics (`temporal.ts`);
- `single_frame_debug --run` on the pipeline's own prompt (`frame-debug/pipeline-frame.ts`);
- every attempt saves its prompt.

## 4. Files

New:
- `server/rotoscope/{provenance,joints,decision,temporal}.ts`
- `server/frame-debug/pipeline-frame.ts`
- `scripts/audit/*.ts`
- tests: `server/rotoscope/{provenance,pose-geometry,validation,layout,temporal,mannequin}.test.ts`, `server/mapping/structure.test.ts`, `server/animation/muse-image.test.ts`, `server/frame-debug/pipeline-frame.test.ts`
- fixtures: `server/rotoscope/__fixtures__/wave/`
- `docs/focus-pipeline-repair/`

Modified:
- `server/rotoscope/{pipeline,pose-match,body-map,colour,draw,grid,mannequin,run-state,cli}.ts`
- `server/mapping/deform.ts`, `server/policies/rules.ts`
- `server/animation/muse-image.ts`
- `server/frame-debug/{run,report,cli}.ts`
- `server/mapping/__fixtures__/figure.ts`
- `.dockerignore`, `.railwayignore`

## 5. Gates

PROGRESS.md. 00–06 PASSED; 07 BLOCKED (item by item in PHASE_07.md); 08 NOT_STARTED.

## 6. Before / after

| | Before | After |
|---|---|---|
| Original 3 attempts vs the eye | 0/3 right reasons (a2 correct, rejected; a3's pose error passed) | 3/3 (a1 REJECTED mirror, a2 ACCEPTED, a3 REJECTED arm) |
| Colour positives (22 real drawings) | 6/14 passed (palette v4 without gamut); 0/3 on the wave in Phase 00 | 22/22 |
| Colour recolours after a correct frame | — | 42/42 caught |
| Good drawings failing the head check (second character) | 8/9 | 0/9 |
| Pose bones measured on frame 1 | 4 (legs) | 8, with 4/4 moving bones |
| Collapsed triangles reported | never | 16–43 per frame |

## 7. Single frame

PHASE_06.md: 3 real end-to-end frames, verdicts agree with the eye 3/3.

## 8. Multi frame

PHASE_07.md: 5–6 approved frames on two real runs, metrics against the 9-frame baseline. Not yet a full nine-frame run with the current code.

## 9. Regressions

None in the full suite (922 pass). One test helper fixed (forearm flip). Existing runs keep their layout rule; palettes and readings refresh automatically.

## 10. Limitations

KNOWN_LIMITATIONS.md.

## 11. Cost and deployment

Real inference used: about 15 Muse Image generations in total, plus Muse Spark readings, palette naming and reviews (tokens per call in PHASE_06.md). No new dependency. The pose worker stays a separate local or GPU service, as before. `debug_runs/` is excluded from images. The Railway image acceptance test (`pnpm test:deployment`) passes 8/8.

## 12. How to run and debug

```bash
pnpm rotoscope generate --run <name> --review-always
```

Every attempt keeps `work/frame_NNNN_aK_{prompt.txt,target.json,generated.json,muse_raw.png,…}` and its decision in `manifest.json`.

```bash
pnpm single-frame-debug --run <dir> --frame N --strategy existing|structured [--dry] [--generated out.png]
```

One generation at most, with the request, the raw output, the response, the measurements and the review.

```bash
node --import ./scripts/ts-loader.mjs scripts/audit/attempt-prompt.ts --run <dir> --frame N --attempt K
```

The prompt of a past attempt.

```bash
node --import ./scripts/ts-loader.mjs scripts/audit/temporal.ts --run <dir>
```

Temporal metrics of the approved frames.

```bash
node --import ./scripts/ts-loader.mjs scripts/audit/colour-calibration.ts
```

The colour check against labelled drawings.
