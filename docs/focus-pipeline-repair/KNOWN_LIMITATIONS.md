# Known limitations

Each item says what is not solved, the evidence, and what currently covers it.

## Pose and geometry

- **Joints hidden under clothing in a drawing are not detectable.** RTMW's scores do not separate them (Phase 02 table: hidden knees score 0.65–0.76 of the image's median, visible hips 0.73). They are carried as VISIBLE. Covered by: the coverage rule (a verdict needs the clip's moving bones) and the visual review. A clip whose motion is under the clothing (walking in a long skirt) is judged on inferred legs.
- **Back views and profiles.** Left/right comes from the shoulder order; a back view whose joints the estimator labels as if it faced the camera reads as "camera". `facingOf` returns `profile` (no side claimed) when the shoulders overlap. Not tested on real back-view footage.
- **No ground-truth keypoints for anime drawings.** Detector quality is measured by label-free proxies (flip consistency, L/R consistency, jitter). RTMPose and MediaPipe were not benchmarked: not installed, and the current detector showed no coverage gap.
- **`keypointNoise = 0.02` torso** comes from the flip-error benchmark (an image vs its mirror), an upper bound of RTMW-x's self-consistency, not its error against truth.

## Rig

- A character sheet whose limbs are foreshortened (hands clasped, sleeves hanging) cannot be warped into extended poses; the rig refuses and Muse Image draws. Refusal is correct; on such sheets every first frame is a generation. Once an approved drawing shows the limb extended, later frames can deform from it.

## Character build on the mannequin

- Only the legs and hips are measured from the sheet (`sheetBuild`); arms and bust keep a generic build because a single sheet often hides them behind the arms. The prompt carries the rest ("Body" line), but the image reference for the bust is still generic.
- The mannequin and prompt changes made after the owner's run `41b85162` have **not been seen on a generation yet** (Phase 07 blocked on the owner's test run).
- A run laid out before the hair-top rule keeps the old rule so its later frames register like its approved ones; it doesn't get the head-measurement fix.

## Muse Image

- One generation per prompt strategy (Phase 04): no strategy is shown better. A real comparison needs several generations per strategy on several frames — a spend to decide, not automatic.
- The endpoint as used takes reference images and text only; there is no structural pose or mask conditioning. Pose control rests on the mannequin/guide image and words, and Muse Image mirrors some poses (the hanfu character on frame 1: mirrored in 3 of 4 cold generations seen in this work).
- Muse Image returns 1280×1920 for a `1024x1536` request; the pipeline resizes (same aspect).
- In the pipeline, Muse Image latency averaged 67 s vs 18 s in the debug tool (concurrent read-ahead); not investigated.
- `generateRun` still allows one retry after a transient error (`attempts: 2`): a timeout can bill two generations in the app. The debug tools use 1.

## Validation

- **Colour, first frame:** a part painted in *another colour the character has* (skirt in the blouse's green) passes the colour check; colour statistics can't see it without a previous frame (Phase 05 calibration: 18/42 synthetic recolours caught on a first frame, 42/42 from frame 2 on). Covered by the review ("every clothing item and its colours").
- **Colour areas between frames** use the sheet's own areas only as a direction (a frame moving back toward the sheet is a correction). A wrong part that happens to move toward the sheet's areas is not caught by this rule.
- **Colour similarity** (the "98 %") is measured after the drawing is pulled onto the palette; it does not separate right from wrong drawings and is a minor finding only.
- **Proportions against an estimate** use the video subject's distal/proximal limb ratio when the sheet shows a limb foreshortened. A character whose limb ratio differs strongly from the subject's (chibi, creature) gets a wrong estimate; findings against it are minor (review), never a redraw.
- **The reviewer is a model.** Its verdicts were coherent with the eye on every case seen here (6), but it is evidence, not a metric. Joint measurements may overrule it on limbs when they are precise (`closePose`).
- **INCONCLUSIVE / REVIEW_NEEDED stop the run** for a person; a long clip with a sheet that triggers estimates may stop more often. That is the intended trade (no unverified frame accepted, no attempt spent on a minor finding).

## Data and runs

- The original failing run (`60bd847f`) was deleted outside this work during Phase 04. It was rebuilt from the same recording with identical inputs (`scripts/audit/rebuild-wave-run.ts`); its three original Muse attempts survive only as half-size cut-outs and DWPose poses in the fixtures.
- Scripts that read user runs (`baseline.ts`, `isolation.ts`, `rig-benchmark.ts`, `fixture-remeasure.ts`, tests that `skipIf` a run is missing) need local data under `.focus-data` or `debug_runs`, which are not in the repository.
- `--limit 1` still reads the next frame ahead (one wasted Muse Spark call when the run stops).

## Generalization

- Inputs exercised with real inference: one recording (two characters), one other video (one character); 9-frame sequences on one character. Anime only; no cartoon/chibi/non-human character, no back view, no fast motion, no multi-person footage. See PHASE_08.md for what was and wasn't covered.
