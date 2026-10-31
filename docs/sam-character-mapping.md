# SAM 3.1 + pose tracking + character mapping

Date: 2026-10-30. Status: implemented in Rotoscope; runs inside Focus (no Claude Code or Muse Code needed at runtime).

## What it does

Rotoscope used to ask Muse Image to redraw every frame in the video's pose. Image models don't hold an exact pose: run `558b6cef` halted at **frame 20** after six Muse Image attempts all failed the pose check (mean 13.5–28.7°, worst bone 27–71°, one mirrored).

The **Character Mapping Engine** now draws each frame's first try by *deforming an approved drawing of the character* onto the source pose. The line art is resampled, not redrawn. Only body surface the drawing never showed is repainted, by Muse Image, inside a mask. The generators take over when the engine can't draw a frame.

Measured on frame 20 (DWPose re-estimating the deformed drawing, same firewall check): **passes, mean 1.7°, worst bone 7°.** All six Muse Image attempts on that frame failed the same check. This is one frame of one run; it is not a general fidelity guarantee.

## Modules (independent)

| Module | Path | Role |
| --- | --- | --- |
| Segmentation | `server/mapping/segmenter.ts`, `server/ai/sam.ts` | SAM 3.1 through the documented Meta Model API (Responses API, `sam-3.1`): character mask (concept prompt), body regions (box + point object prompts, `segmentImageObjects`), source subject tracking (one video request). Local fallback: alpha channel or flat-backdrop flood fill. |
| Pose | `server/mapping/pose-estimator.ts`, `services/animation-worker/scripts/rotoscope_pose.py` | RTMW whole-body (133 points) via rtmlib/ONNX in the worker's Python env. `--mode performance|balanced`, `--device cpu|cuda`. Falls back to the other model when the first finds no torso. |
| Skeleton | `server/mapping/skeleton.ts` | Named joints from COCO-WholeBody; normalized character coordinate system (pelvis origin, torso = 1, y up the spine). |
| Source track | `server/mapping/source-track.ts` | Left/right swap repair, ≤2-frame dropout bridging, One-Euro smoothing, occluded / bridged / off-subject flags. Never changes frame count or times. |
| Rig | `server/mapping/rig.ts` | Bone radii, draw order, per-pixel region labels (front limbs grown through the line art), hidden surface under limbs, seam-free joint weights. |
| Retarget | `server/mapping/retarget.ts` | Guide placement + source directions + character's full limb lengths × source foreshortening; joint rotations. |
| Deform | `server/mapping/deform.ts` | Hierarchical bone transforms (stretch limits, rigid head/hands/feet), grid mesh per bone, rotation-space blending at joints, piecewise-affine warp layer by layer; exposed and over-stretched masks. |
| Profile | `server/mapping/profile.ts` | Character analysis cached by image SHA-256: mask, landmarks, head roll/yaw (when ≥20 face points), proportions, palette. |
| Repair | `server/mapping/refine.ts` | Muse Image `edit` on exposed regions only; pasted back inside the mask. Pipeline discards it if any bone moves > 8° (re-estimated). |
| Policies | `server/policies/` | animation-principles skills as runtime rules (below). |
| Engine | `server/mapping/engine.ts` | Opens per run, plans base drawing, retargets, deforms, runs policy hooks. |
| Diagnostics | `server/mapping/diagnostics.ts` | Per-attempt record (below). |

The web server never loads a model or GPU library: pose estimation runs in the Python worker env (`ROTOSCOPE_PYTHON`, `ROTOSCOPE_POSE_DEVICE=cuda` on a GPU host). The deformer is plain TypeScript (~1 s per frame on CPU at 1024×1536).

## SAM usage and cost

`FOCUS_MAPPING_SAM`:
- `character` (default when a Meta key exists): one image call per character image, cached forever (`mapping/cache/<sha>/`). Its mask is used only if it agrees (IoU ≥ 0.6) with the local estimate; transparent uploads keep their own alpha.
- `all`: also region prompts (one call per character) and source-video subject tracking (one call per run, cached in `mapping/subject/`).
- `off`: local masks only.

Never per frame. SAM never places a joint: region masks are accepted only where they agree with the rig's own estimate (`acceptRegion`), and subject masks only lower confidence of joints off the subject.

## Frame generation (renderer `auto`, default)

1. Source pose (stabilized) → 2. character space (guide placement) → 3. character limb lengths → 4. joint rotations → 5. deform the planned base drawing → 6. line art preserved by resampling → 7. draw order resolves overlap → 8. exposed / over-stretched regions → 9. Muse Image repair of those regions only → 10. DWPose re-estimates → 11. firewall checks (pose, size, proportions, background, style, review) + `mapping` + `policies` → 12. approve, or next try with Muse Image.

Renderer per run (`generate { renderer }`, editor switch "Character rig first", CLI `--renderer`): `auto` | `rig` | `muse`.

## Runtime animation policies

Source: [dylantarre/animation-principles](https://github.com/dylantarre/animation-principles) @ `8359713`, MIT. The six SKILL.md files and LICENSE are vendored byte-for-byte in `server/policies/skills/animation-principles/`; `skills.lock.json` holds their SHA-256 and the loader refuses a modified file. Each rule names the SKILL.md section it implements; the registry fails to start if the section is missing. Skill text is never sent to a model; advisory rules contribute one short line each to the repair prompt.

**Review of the repo for Focus:** the skills are prose written mostly for UI motion (ms durations, easing curves). As files they do nothing inside the app. What transfers to rotoscoping is below; anything that would retime or ease the source was left out, because the source's timing is the reference.

| Rule | Skill · section | Kind | Stage |
| --- | --- | --- | --- |
| `straight-ahead-pose/base-selection` | straight-ahead-pose · The Hybrid Approach | constraint (decision) | pose planning: previous drawing if ≤30° and chain <4, else closest drawn key |
| `timing/source-timing` | timing · The Weight of Time | constraint | planning: one output per source frame at source times |
| `follow-through/keep-overlap` | follow-through · The Drag Hierarchy | constraint | planning: smoothing may trail extremities ≤35% of travel, else smoothing off |
| `solid-drawing/limb-volume` | solid-drawing · Core Theory | constraint | preparation: no limb past stretch limits |
| `solid-drawing/structure` | solid-drawing · The Three-Dimensional Challenge | constraint | rendering: 0 folds, ≤3% over-stretched, area ×0.8–1.25 |
| `timing/hold` | timing · The Hold | constraint | validation: source holds ⇒ drawing holds |
| `arc/path` | arc · The Pivot Chain | advisory | validation |
| `slow-in-out/spacing` | slow-in-out · The Spacing Principle | advisory | validation |
| `solid-drawing/repair-hint`, `follow-through/repair-hint` | Elements of Solidity; Core Theory | advisory (prompt line) | rendering |

## Diagnostics and inspector

Every attempt writes `mapping/diagnostics/frame_NNNN_aK.json`: source keypoints (stabilized + raw, swap/occlusion flags), rig keypoints, mask paths and segmentation method, target skeleton + rotations, measured skeleton, per-joint error (torso lengths), per-bone error (°), silhouette IoU vs the rig's prediction, missing/occluded joints, palette consistency vs the sheet, rendering method, repair outcome, all policy outcomes.

Rotoscope → Frame → **Mapping** tab: layers (target, measured, rig base, repainted, regions), joints colored by error, metrics, policy list. Drag target joints → Save → Redraw frame. Attempts drawn before the engine: "Measure frame N's attempts" (local DWPose, no AI) or `pnpm rotoscope diagnose --run X --frame N`.

## Compatibility

Manifest format unchanged; new data lives under `mapping/`. Old `run.json` reads `renderer: "auto"`. Approved frames are never touched. `pnpm rotoscope map --run X --frame N` previews the rig's drawing and pose check without any model call.

## Pose estimator benchmark

Script: `services/animation-worker/scripts/benchmark_pose.py`. No hand-labelled anime keypoints exist here, so measures are label-free: torso detection rate, body-joint share, flip-equivariance error (torso lengths), anatomical left/right consistency under mirroring, temporal jitter on source sequences, cross-model agreement, ms/image (CPU, Apple Silicon).

Run 2026-10-30, 151 images (24 My Characters references, 3 run character sheets, 34 approved anime drawings, 90 source frames from two runs). P = RTMW-x 384×288 (`performance`), B = RTMW-x 256×192 (`balanced`).

| Set | n | torso found P / B | flip error P / B | L/R consistent P / B | jitter P / B | ms P / B |
| --- | --- | --- | --- | --- | --- | --- |
| anime references | 24 | 100 % / 95.8 % | 0.018 / 0.026 | 100 % / 100 % | — | 534 / 1004 |
| run character sheets | 3 | 100 % / 100 % | 0.014 / 0.020 | 100 % / 100 % | — | 491 / 1075 |
| approved anime drawings | 34 | 100 % / 100 % | 0.019 / 0.026 | 100 % / 100 % | — | 504 / 1031 |
| source video 558b | 63 | 100 % / 100 % | 0.017 / 0.043 | 100 % / 96.8 % | 0.074 / 0.080 | 1079 / 651 |
| source video 83cb | 27 | 100 % / 100 % | 0.017 / 0.066 | 100 % / 92.6 % | 0.058 / 0.063 | 931 / 603 |

Cross-model agreement: 0.028–0.033 torso lengths. **Default: `performance`** — better on every accuracy proxy, never confused left/right under mirroring, missed no anime reference. `balanced` is the fallback (it found a torso where the default failed in none of these sets, but it covers a different failure input size). Timings vary with machine load (both modes ran back to back on one CPU).

Not measured: accuracy against ground truth, other model families (MMPose anime-specific detectors were not downloaded; DWPose-L and RTMO checkpoints aren't installed). Both candidates share the RTMW architecture.

## Tests

- `server/mapping/mapping.test.ts` — geometry, masks, region labels, seam-free weights, deformation measured on pixels, exposure, clamps, SAM prompt/accept rules.
- `server/mapping/source-track.test.ts` — timing preserved, jitter, swap repair, bridging, off-subject.
- `server/mapping/engine.test.ts` — run-level integration: analysis cache (no second segmentation/estimation), straight-ahead and sheet bases, corrections, diagnostics IO, SAM fallback.
- `server/policies/policies.test.ts` — byte-exact skills + license, tamper refusal, section binding, every rule.
- `server/mapping/frame20.test.ts` — **frame 20 regression**: real keypoints (fixture, numbers only); Muse attempts fail, rig deformation passes; plus a local-only test on the real run with DWPose (skipped without data/venv).

## Limits

- Deformation needs one approved drawing (or the sheet) whose pose is near enough; big turns (back view, profile) still need a generator.
- Exposed surface without a Muse key is filled from neighbours (visible smears); it's flagged, not hidden.
- Hands are moved rigidly; finger poses are not retargeted.
- Head yaw/roll is reported, not used to re-draw the face.
- Pose fidelity numbers are from one hard frame; per-run diagnostics are the measurement to trust.


## Flipbook in-betweens (skeleton first)

Flipbook's in-betweens used to be drawn by Muse Image halfway between two key drawings: one paid drawing each, and the model could drift off-model or stiffen the motion. They are now moved first, with the same mapping engine, and only drawn when the engine refuses.

`server/animation/skeleton-inbetween.ts`: both key cut-outs are placed on the raw drawing's canvas and measured (`analyzeDrawing` with the local segmenter: their own alpha, no SAM call; RTMW pose in the worker's Python env, cached by SHA in `<flipbook>/skeleton/`). `server/mapping/interpolate.ts` computes the pose at the in-between's position along the move: the torso frame is lerped, shoulders and hips ride in it, every other bone takes the angle to its parent and the length in torsos from the two keys, lerped the short way round (a swinging arm keeps its length through the arc). Easing is the timing chart's: the position already carries it. The nearer key drawing is deformed onto that pose (`deform`), never blended with the other.

It refuses, and the in-between is drawn by Muse Image (one drawing from the budget, reserved just then), when: the keys differ in size, a key has no whole body, any bone turns more than 160° between the keys, triangles fold, more than 4% of the drawing would stretch past the limits, more than 2.5% of it would be body the drawing never showed, or the figure's area leaves 0.8–1.25× of the base. The result is written as an ordinary in-between version (`raw.png`, `cutout.png`, `measure.json`) with `method: "skeleton"`, so registration, playback and export are unchanged.

Measured on run `47037117` (approved frames 1–8, same character): pairs 2→3, 3→4, 4→5, 6→7, 7→8 pass at t = 0.25 / 0.5 / 0.75 with ≤1.2% exposed and ~0% stretched; 1→2 at t = 0.5 showed 5% exposed (a visible notch at the shoulder) and is now refused; 1→5 is 149° apart and is refused. `FOCUS_SKELETON_INBETWEENS=off` turns it off; it is off in tests (`NODE_ENV=test`) and where the pose tool isn't installed.

Once the key drawings of a cycle are all ready (`autoInbetweens`), the in-betweens at the plan's pace are moved without being asked, up to 48 of them: free, local, best effort. What the engine refuses is left undrawn for the animator's "Make in-betweens" (a refused or unmeasurable key is tried once, not per in-between). Scenes, sequences and imported frames don't take part.

## Flipbook sequences that follow a movement video

A continuous sequence with a movement reference used to draw every tick (up to 480) with Muse Image, guided by the video frame as a picture. Now only the key drawings (every quarter second, `sequenceAnchorIndexes`) are drawn; every other tick is the nearest key moved along the video's pose.

`server/animation/video-pose.ts` measures the person in the video once per movement reference (RTMW over `samples/`, steadied by `stabilizeTrack`, cached in `pose-track.json`; null when the tool is missing or fewer than 80% of the ticks show a body). `server/mapping/follow.ts` takes the *change* of the video's pose since the key's tick, not the pose itself: every bone turns by what the same bone turned in the video, the figure moves by the person's travel in torsos, and a bone the camera sees shorter or longer is scaled by the same share. What the key drawing got only approximately right stays the character's. `skeletonFollow` (`skeleton-inbetween.ts`) deforms the key with the engine and refuses when the video moves a bone more than 70° from the key, or on the same gates as in-betweens. Refused ticks are drawn by Muse Image as before; the budget is reserved for the whole sequence and the moved frames are refunded, so only keys and refusals are charged. Versions made this way carry `source: "skeleton"` ("moved from the video" in the version tray).

Measured on run `47037117` (source poses of its video, key = approved frame 3 with both arms out): frames 4 and 5 are followed with ≤0.3% exposed, ~0% stretched, area 0.98×, and match the approved drawings' arm positions by eye (one arm raised, the other down, same line art); ticks 2 (95°) and 6 (159°) away from the key are refused.

## Cut-outs: SAM once, not per drawing

Every drawing Muse Image makes is painted on a flat key color chosen away from the character's palette (white unless the character is near white). Those are now cut out locally by that key (`extractKeyed` in `frame-alignment.ts`; `measure.method` = `key`): no network call, a fraction of a second. SAM 3.1 is the way out only for a drawing the key can't separate (no flat border, or nothing left after keying), so an animation calls it once for the character's own reference plus the odd failure, instead of once per drawing and per in-between. Uploaded drawings, imported frames and scenes of several characters keep their own cut-out. Skeleton in-betweens never call SAM: their cut-out is the deformed key's own alpha.
