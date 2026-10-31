# Phase 07 — Temporal consistency

**Status: BLOCKED** — everything verifiable without new generations is done and passes; the gate's last item, a real nine-frame sequence with the current code, is a test the owner runs (instruction of 2026-10-30: "yo ejecuto las pruebas, tú solo recibes las imágenes y comparas"). No further paid generation is started from this work.

## Drift sources, audited in code

| Source | Finding |
|---|---|
| Reference drift | Image 1 is always `character.png`, checked by sha256 every run and every request (Phase 01). None. |
| Pose drift | Every frame's pose comes from its own video frame (guides, mannequin, measured angles, reading). None. |
| Repeated rescaling / recursive cropping | `layout.json` fixed once; registration maps each drawing straight to its frame's target lines; crop fixed at extraction. None. |
| Context accumulation | `store: false`, one stateless request per drawing; lessons are bounded text (`PROMPT_LESSONS`). None. |
| Reuse of generated frames | Previous frame and style anchor (C) are references; the rig deforms approved drawings but never rig-made ones. **Found: identity drift through C** — the previous frame's role said "keep the character … identical to it", so a body or a shading that differed from the sheet was copied forward. Fixed (prompt). |
| Error propagation | **Found:** the colour check holds each frame's colour areas to the previous approved frame. In the owner's run `41b85162`, frames 2–3 were accepted with the video subject's black stockings drawn as dark shading on the shins (skin shadow 5.7 % of the figure in frame 1 → 15.9 % / 16.3 %); frame 4's attempts with clean bare legs were then rejected as "colours on the wrong parts" because they differed from frame 3. Fixed (below). |
| Identity drift through the mannequin | **Found:** the mannequin — the reference Muse Image follows most closely — had generic fixed limb widths; every frame drew the same straight, slim body instead of the character's (owner's run: curvy hips and thighs drawn straight). Fixed (below). |
| A attributes leaking into B | **Found:** the frame reading described the video subject's feet ("flat on the ground with full sole contact") for a character in stilettos, and nothing told the generator that the video subject's dark stockings are not shading. Fixed (prompt, reading). |

## Changes

- `server/rotoscope/mannequin.ts` — `sheetBuild(rig)`: the character's legs (each leg's region area seen + hidden over twice its length; the wider side of each pair, as a three-quarter sheet turns one leg away) and hips (how far torso and thigh pixels reach past the hip joints and the thighs, in the band above the hips; hands don't count). Arms and bust stay generic: a single sheet often hides them behind the arms (the owner's sheet: 14 k torso pixels labelled out of 42 k expected). Measured on the owner's sheet: thighs 0.198 torso (generic 0.16), shins 0.085 (generic 0.11). The pipeline draws the mannequin with it whenever the mapping engine has analysed the sheet.
- `server/rotoscope/draw.ts` — prompt: a **Body** line (shoulders, bust, waist, hips, thighs, calves, heads-tall ratio, shoes and heel height from Image 1 only); the mannequin's volumes declared a generic dummy; previous frame and style anchor may never override Image 1's build, outfit, shoes or skin; Image 3 declared a different person whose clothes (stockings, shorts, flat shoes) are never carried over; the magenta rule no longer forbids a pink-skinned character's own colours. Frame reading: feet described for the character's shoes; the video's dark clothes are not shading. `READING_REVISION` 2: readings kept under the old instructions are read again.
- `server/rotoscope/colour.ts` — `sheetShares` (the sheet's own colour areas) used as a **direction** only: a frame whose areas move back toward the sheet's is correcting an earlier frame, not making a mistake; a move away from it is still a wrong part. `PALETTE_VERSION` 6.
- `server/rotoscope/pipeline.ts` — every generator attempt writes its exact prompt (`work/frame_NNNN_aK_prompt.txt`).
- `server/rotoscope/temporal.ts` (new) + `scripts/audit/temporal.ts`: per-frame pose deviation against the video, per-step motion error (the drawing's change of each limb against the video's change), scale (drawn torso over the video subject's torso, normalised), colour-area shift, silhouette change, and the drift slope.
- `scripts/audit/attempt-prompt.ts`: the prompt of any past attempt, rebuilt from the run's files.

## Measurements on real sequences (offline, no generation)

| Run | Code | Frames | pose deviation (°) | drift slope (°/frame) | scale range | max colour shift | max motion error (°) |
|---|---|---|---|---|---|---|---|
| `test-1s-v4` (baseline: old pipeline, all 9 approved) | before | 9 | 4.4, 0, 1.4, 0.5, 0.5, 2.8, 3.3, 4.5, 5.4 | **+0.39** | 0.917–1.023 (shrinks at 8–9) | 0.035 | 14.2 |
| owner's `41b85162` (approved so far) | between fixes | 6 | 0, 0, 0, 2.4, 2.5, 2.1 | +0.58 | 0.987–1.094 | **0.12** (the stockings in frames 2–3) | 7.1 |
| `e2e-seq` (5 approved, Phase 05/06 rules) | after Phase 06 | 5 | 0, 0, 1.9, 0, 0 | **0.00** | 0.986–1.039 | 0.040 | 9.5 |

The metrics detect what the eye saw: the owner's run's colour-area shift (0.12 vs ≤ 0.04) is the stocking contamination; the baseline's drift slope and end-of-clip shrink are real accumulation in the old pipeline. On the first five frames the current rules show no pose drift and no scale accumulation; motion error is mixed (better on the first step, worse on steps 2–3) — five frames are too few to call it an improvement.

Real generations behind these numbers: the `e2e-seq` frames were drawn earlier in this work (Phase 07 started a capped run; the owner stopped it at frame 6 when taking over the testing). `e2e-boy9` frame 1 failed twice legitimately (one mirror; one raised arm drawn L-shaped with the elbow at shoulder height — keypoints checked on the image).

## Tests

| Test | Kind | Result |
|---|---|---|
| `temporal.test.ts`: a drawing that follows the video (no error, no drift, constant scale, no flicker); frozen drawing (motion error = the video's motion); drifting arms (positive slope); growing figure (scale off 1); jumping silhouette (flicker) | Unit (real source poses) | 5/5 |
| `mannequin.test.ts`: legs measured at the fixture's drawn widths; arms/bust left generic; no hips beyond thighs on a straight figure; wider build draws more pixels | Unit | 3/3 |
| `validation.test.ts`: a frame dropping a wrong shading passes; adding it after a clean frame fails | Unit | 2/2 (21/21 file) |
| Owner's frame 4: attempts a2 and a3, rejected for "wrong parts" against the contaminated frame 3, now pass colour | Integration (real artifacts) | pass |
| Colour calibration re-run: positives 22/22 pass; recolours after a correct frame 42/42 fail | Integration (real images) | unchanged |
| Full suite | — | 86 files, 922 pass, 2 skipped |

## What blocks the gate

| Gate item | State |
|---|---|
| Nine frames complete or report legitimate, traceable failures | **Not verified with the current code.** Needs the owner's run. |
| No incorrect reuse of earlier outputs | Pass (provenance; propagation fixed). |
| Identity anchored to the reference | Pass in code and prompt; visual effect of the mannequin/prompt fixes **not yet seen** on a generation. |
| No accumulated scale error | Pass on 5 frames (0.986–1.039); baseline shrank to 0.917. |
| Temporal consistency better than baseline | Drift and scale yes on 5 frames; motion error mixed. Needs 9 frames. |
| Metrics detect jitter and anomalies | Pass (tests; detected the owner's stocking frames). |
| No clearly defective frames accepted for lack of coverage | Coverage rule passes; but the owner's run accepted frames 2–3 with the stockings — the cause is fixed in prompt, reading and colour rule, **not yet re-verified on a generation**. |

**To unblock:** run a nine-frame sequence with the current code (a fresh run, or `41b85162` after reopening frames 2–3, so the new palette, readings and mannequin apply), then this work compares the images and the saved prompts (`work/*_prompt.txt`) and closes the gate or reports what fails.
