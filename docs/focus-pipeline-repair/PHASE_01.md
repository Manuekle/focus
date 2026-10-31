# Phase 01 — Reference isolation

**Status: PASSED**

## Problem

Nothing in the pipeline recorded which bytes went to the generator as which entity. The character's sha256 was checked only at manifest level; the bytes actually sent were never compared, and nothing would have caught an earlier output (C) sent in place of the video frame (A) or the sheet (B).

## Audit findings (code)

- Image 1 is always `character.png` (read in `layoutRun`), Image 2 the A+B pose (mannequin or guide), Image 3 A's frame in greyscale (`framePrompt`, `draw.ts`). Previous frame and anchor (C) are labelled "design/style only, NOT the pose".
- The skeleton is always A's: `source-poses.json` comes from DWPose on `source/`; nothing re-estimates it from an output. The drawn pose (`work/*_pose.json`) is used only for measuring.
- `framePrompt` tells the model: look from Image 1, motion only from Image 3, proportions from Image 2 and the measurements.
- Coordinates: DWPose works on the cropped frames (`extractFrames` crops with FFmpeg), so source-pose pixels are cropped-frame pixels; `layout.json` maps them to the canvas once per clip.
- Side handling: every module derives "facing" from the shoulder order (`sr.x < sl.x`), which cannot tell a profile and cannot tell front from back when the estimator labels a back view as a front view.

## Changes

- `server/rotoscope/provenance.ts` (new): the contracts `PoseSource` (A), `CharacterIdentity` (B), `GenerationTarget` (the frame's references, each with entity and sha256), `GeneratedFrame` (C, linked to its target by hash); `assertIsolation`; coordinate transforms `frameToVideo`/`videoToFrame`/`frameToCanvas`/`canvasToFrame`; `facingOf` (camera/away/profile) and `imageSideOf` (anatomical side → image side, `null` in profile).
- `server/rotoscope/pipeline.ts`:
  - `generateRun` refuses to start if `sha256(character.png)` differs from the manifest's (a replaced sheet would draw someone else under the same run).
  - Before every Muse Image/Higgsfield call: the references are recorded (`work/frame_NNNN_aK_target.json`) and `assertIsolation` runs against the hashes of every approved drawing of the run.
  - After it: `work/frame_NNNN_aK_generated.json` links the raw output's hash to its target.
- `scripts/audit/isolation.ts` (new): builds every frame's references from a real run's files and checks them.

## Tests

| Test | Kind | Result |
|---|---|---|
| `provenance.test.ts` — entities of every framePrompt reference | Unit-tested | pass |
| character swap (knight vs robot, same pose): only Image 1 and the design line change; every pose reference byte-identical; pose text from A's joints | Unit-tested | pass |
| same character, two poses: Image 1 identical, pose text differs | Unit-tested | pass |
| wrong character bytes / output as video frame / output as character / unknown role → refused | Unit-tested | pass |
| frame↔video round trip through the real crop 828×1472+0+160; frame↔canvas through the real layout | Unit-tested | pass |
| facing camera / away / profile and image side on the real source pose | Unit-tested | pass |
| `isolation.ts` on run 60bd847f: 9/9 frames, Image 1 = `bb756728…` = manifest sha256, 3 earlier outputs excluded | Integration-tested (real artifacts) | pass |
| Muse Spark readings of frames 1–2 (real inference, already on disk): no attribute of the video subject (shorts, tie, choker, stockings, white shirt, purple hair) appears; 20 mentions of the character's own garments | Tested with real inference (n=2, existing outputs) | pass |

Typecheck clean; full rotoscope/mapping suite green (see TEST_RESULTS.md).

## Not verified

- Back views: DWPose may label a back view's joints as if it faced the camera; `facingOf` then says "camera". Recorded in KNOWN_LIMITATIONS.md; Phase 02 adds face-visibility evidence.
- Muse Spark on characters other than this one (2 readings only).

## Gate decision

- Provenance of every reference verified and recorded: yes.
- Pose comes from A, identity from B: yes (unit + integration).
- No accidental attribute contamination: yes for the evidence available (2 real readings; prompt structure).
- Character swap keeps the pose reference identical: yes.
- Coordinate transforms reproducible: yes.

**PASSED.**
