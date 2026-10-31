# Phase 06 — Single frame end to end

**Status: PASSED** (tested with real inference: 3 generations through the real pipeline)

## Setup

The real pipeline (`pnpm rotoscope generate --limit 1 --review-always`), not the debug tool, on three runs with `maxAttempts: 1` (no automatic regeneration), data under `debug_runs/data` (`FOCUS_DATA_DIR`), never in `.focus-data`:

| Run | Source | Character | How it was made |
|---|---|---|---|
| `e2e-wave` | the screen recording, frame 1 (the problem case) | green hanfu + plum skirt (the original) | `rebuild-wave-run.ts`, offline |
| `e2e-boy` | the same frame | black-haired boy, white shirt, black trousers (from `test-1s-v4`) | `rebuild-wave-run.ts --character --description`, offline |
| `e2e-qipao` | a different video (`reze-saludo-4s-v2.mp4`, 512×768, 24 fps, from 1 s), frame 1 | green hanfu | `pnpm rotoscope init` (real: crop detection, DWPose, Muse Spark description) |

Flow exercised for each: video frame → DWPose → character sheet → palette (measured, named by Muse Spark) → frame reading (Muse Spark) → character rig → constraint refusal → fallback to Muse Image with provenance check → cut-out, colour hold, DWPose on the drawing, registration → measured checks → Muse Spark review → decision → manifest.

Artifacts per stage, in each run: `source/`, `source-poses.json`, `guides/`, `character-pose.json`, `palette.json/png`, `readings/`, `mapping/` (sheet mask, source track, diagnostics), `work/frame_0001_a1_{mannequin,target,muse_raw,muse_keyed,muse_pose,generated,pose}`, `attempts/`, `frames/` (approved), `manifest.json` (checks + decision), `run.json`-equivalent console log above.

## Results

| | e2e-wave | e2e-boy | e2e-qipao |
|---|---|---|---|
| By eye | **mirrored** (raised arm on the image's left) | pose and identity right: raised arm on the right, other forearm across the chest, the boy's design | arm raised to the right but lower; torso and head turned the other way; skirt flaring |
| Rig | refused: rightUpperArm stretch; 260 folded + 43 collapsed (leftForearm 113…) | refused: rightUpperArm, rightForearm; 179 folded + 10 collapsed (torso 156) | refused: rightForearm; 327 folded + 25 collapsed (leftForearm 196) |
| Fallback | recorded (`rig` warn) | recorded | recorded |
| Pose fidelity | FAIL mirrored, 4/4 moving bones | pass, mean 0.0° beyond noise, 4/4 | FAIL left upper arm 41° (±10°), 2/2 |
| Identity / colour | colour pass 98.8 % (89.6 % as drawn); review: arms swapped | colour pass 99.5 %; review: same character, same style | colour pass 99.2 %; review: head/torso turned |
| Geometry (scale, alpha) | pass, pass | pass, pass | pass, pass |
| Proportion reliability | forearms judged against an estimate (sheet foreshortened); pass | measured against the sheet; pass | forearms against an estimate; head −20 % → fail (major) |
| Silhouette | diagnostics | diagnostics | diagnostics |
| Visual defects (review) | arms swapped | none | head and torso turned |
| Decision | **REJECTED** (pose, critical) | **ACCEPTED** → approved | **REJECTED** (pose, critical) |
| Agrees with the eye | yes | yes | yes |
| Wall time (frame 1, everything) | 143 s | 138 s | 164 s |

No state errors: e2e-boy frame 1 `approved` with `decision: ACCEPTED`, the next frame pending; the two others `failed` with `decision: REJECTED` and `halted` on frame 1. Every generator attempt has `target.json` (provenance passed) and `generated.json`.

## Cost and latency (from `debug_runs/data/usage.jsonl`)

| Calls | n | input tokens | output tokens | total time |
|---|---|---|---|---|
| Muse Image generations | 3 | 114 011 | 10 151 | 201 s |
| Muse Spark analysis (3 frame readings + 3 read-ahead of frame 2, 3 palette namings, 1 character description) | 10 | 36 521 | 36 882 | 266 s |
| Muse Spark review | 3 | 14 783 | 10 520 | 68 s |
| SAM 3.1 (character mask) | 3 | — | — | 4.4 s |

No price table exists in the repository, so cost is reported in calls and tokens. Generation latency in the pipeline (avg 67 s) was higher than in the debug runs (18 s): Muse Image ran while the next frame's reading ran in parallel; not investigated further.

Observation: with `--limit 1` the pipeline still reads frame 2 ahead (one Muse Spark call per run that is wasted when the run stops). Recorded in KNOWN_LIMITATIONS.md.

## The problem case

The original failure was 3 rejections, all for wrong reasons on attempts 2–3 (colour and forearm false positives; the pose check measuring only hidden legs). Now the same frame is rejected for the right reason (a real mirror), and the same pipeline accepts a correct drawing of another character on the identical frame with every measurement and the reviewer agreeing. The original a2 (correct by eye) re-measures as ACCEPTED (Phase 05).

## Gate decision

- Full flow works with real inference: yes (3 runs).
- References correct: provenance check passed and recorded on every generation.
- No state errors: yes.
- Results kept: yes, every stage.
- Coherent diagnostics: measurements, review and eye agree 3/3.
- Relevant failures detected: mirror, arm angle, head/torso turn.
- Accepted case has evidence: all measurements pass with 4/4 moving bones measured, colour 95.4 % as drawn, review clean.
- No automatic regeneration: `maxAttempts: 1`; one generation per run.

**PASSED.**
