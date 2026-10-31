# Rotoscope pipeline — as built

Entry points: `pnpm rotoscope` (`server/rotoscope/cli.ts`) and the app (`server/rotoscope/service.ts` → `app/api/rotoscope/runs/**`, UI in `app/rotoscope/`). Both call `server/rotoscope/pipeline.ts`.

```
video ──ffmpeg──▶ source/frame_NNNN.png  (extract.ts: detectCrop + extractFrames at N fps)
                     │
                     ├─DWPose/RTMW (services/animation-worker/scripts/rotoscope_pose.py, local CPU)──▶ source-poses.json   [A: motion]
character.png ───────┼─DWPose──▶ character-pose.json                                                                  [B: proportions]
                     │                └─ rotoscope_pose.py guides: source pose re-drawn on B's limb lengths ─▶ guides/ (+ guides.json)
                     └─Muse Spark describeCharacter(B) ─▶ character.txt                                             [B: identity text]

generate (per open frame, runFrames in run-state.ts, maxAttempts tries):
  layoutRun ─ clip layout (layout.json, fixed on first generate), grid marks, bodySpec (body-map.ts)
  runPalette ─ sheetColours(B) + Muse Spark namePalette ─▶ palette.json / palette.png
  readFrame ─ Muse Spark describeFrame(A on grid, B, description) ─▶ readings/frame_NNNN.txt
  draw:
    try 1 (renderer auto): Character Mapping Engine (server/mapping/engine.ts: rig.ts, retarget.ts, deform.ts)
         └─ constraints (server/policies/rules.ts) fail ─▶ fall through to generators
    rig drawing passed but torn ─▶ healFrame (Muse Image edit)
    else: mannequin(target) + framePrompt (draw.ts) ─▶ Muse Image (server/animation/muse-image.ts) [+ Higgsfield when dual]
  measure (scoreDrawing):
    keyOut (alpha.ts) → holdColours (colour.ts) → DWPose on the cut-out → drawnMarks → register (grid)
    checks: pose (pose-match.ts) · scale (grid.ts) · colour (colour.ts) · proportions (body-map.ts) · alpha (alpha.ts) · style (style.ts)
  validate:
    runtime policies (validation stage) vs previous approved frame
    review (Muse Spark reviewFrame, draw.ts) — only if every measured check passed
    buildDiagnostics ─▶ mapping/diagnostics/frame_NNNN_aK.json
  pass ─▶ approve (attempts/ → frames/, sha256 in manifest) ; fail ─▶ feedback to next try ; all tries fail ─▶ halt the run
```

## Owners

| Component | Owner |
|---|---|
| Frame extraction, crop | `server/rotoscope/extract.ts` |
| Pose (DWPose / RTMW-x, COCO-WholeBody 133 pts) | `services/animation-worker/scripts/rotoscope_pose.py`, `server/mapping/pose-estimator.ts` |
| Guides on the character's proportions | `rotoscope_pose.py guides` (called by `drawGuides`) |
| Layout, grid, registration | `server/rotoscope/grid.ts`, `pipeline.ts` (`clipLayout`, `register`, `drawnMarks`) |
| Body measurements for the prompt and proportions check | `server/rotoscope/body-map.ts` |
| Muse Spark (character text, palette names, frame reading, review) | `server/rotoscope/draw.ts` via `server/ai/meta.ts` |
| Muse Image | `server/animation/muse-image.ts` (`imageRequestBody`, `generateImage`) |
| SAM 3.1 | `server/ai/sam.ts`, used by `server/mapping/segmenter.ts` (character mask) and `server/frame-debug/run.ts` |
| Character rig, retarget, deformation | `server/mapping/{rig,retarget,deform,engine}.ts` |
| Animation policies (constraints / advisories) | `server/policies/{rules,registry}.ts` |
| Colour palette and colour check | `server/rotoscope/colour.ts` |
| Retry loop, approval, persistence, lock | `server/rotoscope/run-state.ts` |
| Lessons from rejected attempts | `server/rotoscope/lessons.ts` |
| Single-frame debug | `server/frame-debug/*` (`pnpm single-frame-debug`) |
| UI | `app/rotoscope/*` |

## Where each visual reference comes from

| Image sent to Muse Image | Source | Entity |
|---|---|---|
| Image 1 "THE CHARACTER" | `character.png` (copied at init, sha256 in the manifest) | B |
| Image 2 pose (mannequin or skeleton guide) | A's pose on B's lengths | A geometry + B proportions |
| Image 3 video frame, greyscale | `source/frame_NNNN.png` | A |
| previous frame / style anchor | approved drawings of this run | C (earlier outputs) |
| palette | `palette.png`, measured on B | B |

The previous frame and the anchor are earlier **outputs**: they are labelled design/style only and the pose is said to come from A, but they are the one place where C feeds back into generation (Phase 07).

## Data flow invariants found

- The source pose is always A's (`source-poses.json`), never re-estimated from an output.
- `layout.json` is written once: every frame uses the same source→canvas transform (no recursive rescaling).
- Approved drawings are verified by sha256 on every resume (`verifyApproved`).
- The character image is verified by sha256 at the manifest level only; nothing checks that the bytes sent in a request are those bytes (Phase 01).
