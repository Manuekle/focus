# Phase 00 — Repository audit and baseline

**Status: PASSED**

## Scope inspected

Every stage of the rotoscope pipeline (`server/rotoscope/pipeline.ts`, shared by `cli.ts` and the app's `service.ts`) and the modules it calls. Owners are listed in [ARCHITECTURE.md](ARCHITECTURE.md).

## The observed case, located in the repository

Run `.focus-data/rotoscope/60bd847f-d485-4c71-a27d-2b3336ed6d62` (created 2026-10-31T00:17Z):

- `manifest.json`: 9 frames, `fps: 9`, `crop: 828×1472+0+160`, `maxAttempts: 3`, frame 1 `failed` after 3 attempts, `halted` on frame 1 — 0/9 approved.
- `run.json` log: the character rig rejected frame 1 (`solid-drawing/limb-volume — rightUpperArm`; `solid-drawing/structure — 282 folded triangles, 3.3 % over-stretched, area ×0.87`), then three Muse Image attempts.
- `work/frame_0001_a{1,2,3}_muse_{raw,keyed,pose}.png/json`: the raw drawings, the cut-outs and the DWPose results the checks used.
- `mapping/diagnostics/frame_0001_a{1,2,3}.json`: a second, independent 14-bone comparison against the target skeleton.

Evaluators that rejected the three attempts (all called from `scoreDrawing`, `pipeline.ts`):

| Check | Function | File |
|---|---|---|
| pose (`4 bones`, `MIRRORED`) | `comparePoses` | `server/rotoscope/pose-match.ts` |
| colour (`92.6/92.9/93.8 %`, needs 95 %) | `holdColours` | `server/rotoscope/colour.ts` |
| proportions (`forearm +19/+45/+60 %`, `head -13/-4 %`) | `checkProportions` | `server/rotoscope/body-map.ts` |
| alpha (edge touch, a1) | `checkAlpha` | `server/rotoscope/alpha.ts` |
| review (`skipped`) | `reviewFrame`/`reviewCheck`, gated at `validate` | `server/rotoscope/draw.ts`, `pipeline.ts` |
| rig constraints | `solid-drawing/limb-volume`, `solid-drawing/structure` | `server/policies/rules.ts`, `server/mapping/deform.ts` |
| "Mapping 53 % colour overlap" | `paletteSimilarity(palette(...))` in `buildDiagnostics` | `server/mapping/profile.ts` |

## Visual evidence

`character.png`, `source/frame_0001.png` and the three attempts, side by side (inspected by eye, recorded here):

- **a1**: the raised arm is on the image's LEFT; the source raises the arm on the image's RIGHT → a genuine mirror. Rejecting it is correct.
- **a2**: pose matches the source (raised arm on image right, other forearm across the chest), identity matches the sheet (hair, face, green hanfu, plum skirt). A human would accept it or at most flag it for review.
- **a3**: raised arm on the right side, but the upper arm rises from the elbow at a different angle (diagnostics: rightUpperArm 85° off). Plausible reject/review.

## Confirmed causes (each with evidence)

### C1 — The pose check measured only the two legs, which the character's skirt hides

`comparePoses` skips a bone shorter than `minBoneShare = 0.45 × torso`. In source frame 1 the arm bones are 0.15, 0.26, 0.32 and 0.43 torso lengths (the right arm raised and foreshortened, the left forearm across the chest), so **every arm bone was skipped**. The 4 bones measured were the thighs and shins. The character wears an ankle-length skirt: in every drawing those leg keypoints are DWPose's guesses under the cloth.
Effect: attempt 3, whose raised upper arm is 85° off per the diagnostics, passed the pose check ("4 bones, mean 3.5°").
Evidence: `scripts/audit/baseline.ts` output; the bone-length table below.

| torso-relative length | rUA | rFA | lUA | lFA |
|---|---|---|---|---|
| source frame 1 | 0.15 | 0.26 | 0.32 | 0.43 |
| threshold | 0.45 | 0.45 | 0.45 | 0.45 |

### C2 — Keypoint "confidence" is not a probability

RTMW (rtmlib) returns SimCC scores, not probabilities: frame 1 scores range 3.2–7.4 and the drawn legs under the skirt score 3.2–6.4. Every `minConfidence = 0.3` gate in the code (pose-match, body-map, pipeline `at`) therefore lets every keypoint through: an occluded joint is indistinguishable from a visible one by score alone.

### C3 — Palette extraction drops skin, the white underlayer and the mint collar

`sheetColours` clusters only *flat* pixels (every neighbour within ΔE 4 at radius 2) and drops colours under 0.8 % of the flat samples. Anime skin and hair carry soft shading: skin is 1.7 % of the figure but 0.7 % of the flat samples; dark hair 0.2 %. The run's palette has 5 colours (skirt, skirt shadow, blouse, outlines, blouse shadow) and **no skin**.
`holdColours` then counts every skin pixel as "a colour the character doesn't have" at maximum residual (100): `#fcdcbe` (skin, "no palette colour of that hue"), `#b58a7d` (skin shadow), `#e1e5e3` (white underlayer), `#bfe3cb` (mint collar) — 6.8–7.7 % of each figure, which alone takes the score from ~99 % to 92–94 %.

### C4 — The colour score is computed after recolouring the drawing

`similarity` is `100 − mean ΔE` *after* each pixel has been pulled onto its palette colour (keeping 25 % of its variation). The as-drawn figure ("80.0 % as drawn") is the measurement of the generator; the 92.6 % figure mostly measures the recolouring. Not a bug in itself, but the number does not mean what the 95 % threshold implies.

### C5 — The "53 % colour overlap" of Mapping measures something else

`paletteSimilarity` is a 64-bin RGB histogram intersection (4 levels per channel) of the whole figure. The skirt `#823c56` has R=130, two values above the 128 bin edge: a slightly darker skirt moves its largest region to another bin. It is also area-weighted, so a different pose (arm raised, sleeve over the skirt) changes it. It is a coarse distribution overlap, not a palette-distance score: the two numbers are not comparable.

### C6 — The proportions check compares against a foreshortened reference

The character sheet has the hands clasped in front of the waist: its forearms point at the camera. DWPose measures them at 0.22 and 0.33 torso lengths (upper arms 0.50/0.48). `sheetLengths` takes the longer side × 0.85 (`SHEET_FLOOR`) as the floor of the character's "own" length, and the guides cap forearms at ~0.31 torso. The source person's forearm, extended, is 0.43–0.46 torso.
So the reference a drawn forearm is held to is itself a foreshortened length: Muse Image's forearm at 0.39 torso (a2, visually correct) reads "+19 %", and the limit is +18 %. The same frame's target gives +19/+45/+60 % across three drawings because each drawing's forearm length is compared to a number that is too small, and a3's pose error lengthens the measured segment further.

### C7 — The visual review never ran

`validate` calls `reviewFrame` only when every measured check passed. With C1–C6 producing false failures, Muse Spark never looked at any attempt: "Visual review skipped: a measured check failed first".

### C8 — The rig rejection is legitimate, with one unreported degenerate case

Frame 1 needs the sheet's hanging wide sleeve rotated 148.6° and foreshortened to 31 %: the constraints reported the fold and refused, and the run fell back to Muse Image as designed. `deform.ts` skips triangles whose deformed area is below 1e-6 (`continue`) instead of counting them as distorted: a fully collapsed triangle is never reported. (Fixed in Phase 03.)

## Pending hypotheses (not yet proven)

- H1: DWPose's wrist on a raised open hand lands inside the palm, lengthening the measured forearm (contributes to a3's +60 %).
- H2: `withRetry(attempts: 2)` around Muse Image can, on a timeout after the provider generated, bill two generations for one call (Phase 04).
- H3: the guides' too-short forearms (C6) also push Muse Image toward drawing short forearms (prompt says "never longer than 0.89 cells").
- H4: legs inferred under clothing distort the torso length used to scale every limb in `checkProportions` (hips are under the skirt).

## Reproducible baseline

`node --import ./scripts/ts-loader.mjs scripts/audit/baseline.ts --run .focus-data/rotoscope/60bd847f-d485-4c71-a27d-2b3336ed6d62 --out docs/focus-pipeline-repair/baseline/phase00.json`

It re-measures every kept attempt from `work/` with the current checks (no model call) via the new `remeasureAttempt` (`pipeline.ts`). The Phase 00 run reproduced every recorded verdict and number exactly (see [BASELINE.md](BASELINE.md)).

## Files modified (instrumentation only)

- `server/rotoscope/pipeline.ts`: the measured checks moved into `scoreDrawing` (same order, same functions, same arguments) so `remeasureAttempt` reuses them; `runPalette` gained an `offline` option that never calls Muse Spark. No check's behaviour changed (baseline identical).
- `scripts/audit/baseline.ts`: new.

## Tests

- Unit: `pnpm test` suite run after the refactor — see [TEST_RESULTS.md](TEST_RESULTS.md).
- Integration-tested: baseline replays the saved run identically.
- Visually verified: the three attempts inspected by eye (above).

## Gate decision

- Flow traced end to end: yes ([ARCHITECTURE.md](ARCHITECTURE.md)).
- Owner per component: yes.
- Evaluators of the three rejections located: yes (table above).
- Reproducible baseline from saved artifacts: yes.
- Unproven problems listed as hypotheses: yes (H1–H4).

**PASSED.**
