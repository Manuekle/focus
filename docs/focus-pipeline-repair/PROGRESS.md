# Progress

| Phase | Status | Report |
|---|---|---|
| 00 Repository audit and baseline | PASSED | [PHASE_00.md](PHASE_00.md) |
| 01 Reference isolation | PASSED | [PHASE_01.md](PHASE_01.md) |
| 02 Pose tracking and geometry | PASSED | [PHASE_02.md](PHASE_02.md) |
| 03 Character rig and deformation | PASSED | [PHASE_03.md](PHASE_03.md) |
| 04 Muse Image generation | PASSED (real inference) | [PHASE_04.md](PHASE_04.md) |
| 05 Quality validation engine | PASSED | [PHASE_05.md](PHASE_05.md) |
| 06 Single frame end to end | PASSED (real inference) | [PHASE_06.md](PHASE_06.md) |
| 07 Temporal consistency | **BLOCKED** — needs a real 9-frame run with the current code, run by the owner | [PHASE_07.md](PHASE_07.md) |
| 08 Generalization and release validation | NOT_STARTED (blocked by 07) | [PHASE_08.md](PHASE_08.md) |

## Changes after the owner's run `41b85162` (2026-10-31)

Run `f9bb5bc7` ("dance reze"), worked on a copy (`f9bb5bc7-prod-test`) so the owner's run stays untouched.

- **Generator:** Muse Image no longer gets the mannequin and the 13-part Muse Spark reading. It edits the colour video frame into the character (`swapFramePrompt` in `draw.ts`): Image 1 the video frame, Image 2 the character sheet rescaled to the video person's height (`characterAtVideoScale` in `pipeline.ts`), a ~90-word pose note of that frame alone (`describeMotion`, kept in `notes/`), the identity line, and on a retry only what was wrong. Higgsfield still gets the long prompt.
- **Character build:** `build.json`, once per run: Muse Spark's widths and waist read on the grid, with the landmark lines replaced by DWPose's and the silhouette's (`reconcileBuild`): Spark alone read a head 1.3 cells where it is 1.6 and put the character at 9 heads instead of 7.
- **Review:** Muse Spark also sees the drawing ghosted over its video frame on the grid and the character beside the drawing at one scale with the measured build (`ghostOverlay`, `buildPair`, `buildOk`). Both images are kept in `work/` (`*_review_overlay.png`, `*_review_build.png`).
- **Overlay scan** (`scan.ts`, until now lab only) runs on every attempt as an informational check and writes `work/*_scan.png`. It does not decide a frame: its limits were set on rig and mannequin drawings.
- Provenance accepts the character rescaled from the run's sheet (`ReferenceRecord.of`).
- Findings: the video frame must be sent whole on the canvas, not as the enlarged crop the guides use (mirrored 5 of 5 with the crop, 1 of 4 whole); Muse Image's content filter sometimes declines one request and accepts the same a moment later (one retry in `drawSwap`).
- Phase 07 (temporal) is no longer blocked on a 9-frame run with the current code: see the run's `report` output. Phase 08 is unchanged.

**The project is not finished.** Final delivery of what is verified: [FINAL_DELIVERY.md](FINAL_DELIVERY.md).

Supporting documents: [BASELINE.md](BASELINE.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [TEST_RESULTS.md](TEST_RESULTS.md) · [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) · prompts of the owner's run: [prompts/](prompts/)
