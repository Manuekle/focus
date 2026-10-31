# Phase 02 — Pose tracking and geometry

**Status: PASSED**

## Root causes (confirmed in Phase 00, measured here)

1. **"4 bones"**: `comparePoses` dropped every bone shorter than 0.45 torso lengths. Frame 1's arm bones are 0.15–0.43, so only the legs were measured — and the character's legs are under an ankle-length skirt in every drawing.
2. **Scores are not probabilities**: RTMW (rtmlib, SimCC) scores, measured on the fixture:

| Set | body min / median / max |
|---|---|
| source frames (legs visible) | 3.23 / 6.14 / 7.73 |
| character sheet (legs under the skirt) | 3.35 / 4.93 / 7.51 |
| Muse Image attempts (legs under the skirt) | 3.21 / 4.91 / 7.18 |

Relative to each image's median body score, the hidden knees score 0.65–0.76 while visible joints of the source score as low as 0.56 (a partly hidden elbow) and 0.73 (hips). **No score threshold separates clothing-hidden joints from visible ones**; the `0.3` floor everywhere in the code passes every point.

## Changes

- `server/rotoscope/pose-match.ts` — `comparePoses` rewritten:
  - A bone is measurable when its direction's two-sigma uncertainty, `boneUncertainty(length, keypointNoise × torso)`, is within `maxBoneDegrees`. `keypointNoise = 0.02` torso lengths is the upper end of RTMW-x's measured flip error (0.012–0.019 on anime and source sets, `pose-benchmark-wave.json`, docs/sam-character-mapping.md). Not a number tuned to this case: it comes from the estimator benchmark.
  - Each bone's error is judged beyond its uncertainty (`excess`); mirroring uses bones up to twice as uncertain (side survives foreshortening, as before).
  - `movingBones(clip)`: bones whose direction changes by more than `maxBoneDegrees` over the clip. With the clip given, a pass requires at least `minCoverage = 0.5` of the frame's moving bones measured; otherwise **`inconclusive`** (`passed: false`). A confident failure (mirror, missing limb, bone off) stands regardless.
  - `hidden`: source keypoints not confirmed as seen are never measured.
  - New fields: `status`, `unmeasured`, `coverage`, per-bone `uncertainty`.
- `server/rotoscope/joints.ts` (new): the canonical joint — `id`, anatomical `side`, `image` (pixels + `space`), `normalized` (torso units from the hips' midpoint), raw `score`, `visibility` (VISIBLE / OCCLUDED / INFERRED / UNKNOWN) with a `reason`, `source`. Visibility evidence: missing or off-image point (UNKNOWN), source-track flags (occluded/off-subject → OCCLUDED, bridged → INFERRED), outside the figure mask (OCCLUDED). Scores are carried but never turned into visibility (see table).
- `server/rotoscope/run-state.ts`: `Check.status` (`pass | fail | inconclusive | warn`).
- `server/rotoscope/pipeline.ts`: the pose check gets the clip and the source track's unconfirmed joints (read when measuring: the mapping writes the track on its first frame); `closePose` (the measurement that may overrule the reviewer on the limbs) now needs the clip-aware pass.
- `server/mapping/__fixtures__/figure.ts` (test helper): each chain bone's first joint is the end nearer the parent's far joint, not the parent's centre — the old rule flipped a forearm folded back past the elbow. Found because the new check measured frame 20's left forearm (0.44 torso, skipped before by 0.01): the rig's target was right (−145° vs source −142°), the measurement was flipped (+5°); after the fix it reads −135°.

## Detector

Benchmark re-run on the wave run (`services/animation-worker/scripts/benchmark_pose.py`, result in [baseline/pose-benchmark-wave.json](baseline/pose-benchmark-wave.json)):

| Set | mode | torso found | flip error | L/R consistent | jitter | ms |
|---|---|---|---|---|---|---|
| sheet (1) | performance | 100 % | 0.012 | 100 % | — | 446 |
| sheet (1) | balanced | 100 % | 0.023 | 100 % | — | 329 |
| attempts (3) | performance | 100 % | 0.016 | 100 % | — | 411 |
| attempts (3) | balanced | 100 % | 0.025 | 100 % | — | 328 |
| source sequence (9) | performance | 100 % | 0.017 | 100 % | 0.035 | 411 |
| source sequence (9) | balanced | 100 % | 0.144 | 77.8 % | 0.042 | 349 |

Coverage is complete on every set; the failures were in how the output was consumed, not in detection. **The detector stays RTMW-x 384×288 (`performance`)**; `balanced` confused left/right on 22 % of the source frames. RTMPose/MediaPipe were not benchmarked: the current detector shows no coverage gap that would justify a switch, and neither is installed (KNOWN_LIMITATIONS.md).

## Results against the baseline (offline, [baseline/phase02.json](baseline/phase02.json))

| Attempt | Human | pose before | pose now |
|---|---|---|---|
| a1 | mirrored | FAIL mirrored, 4 bones (legs) | FAIL mirrored, 8 bones, left upper arm 171° |
| a2 | correct | PASS, 4 bones (legs) | PASS, 8 bones, moving bones 4/4, mean 0.1° beyond noise |
| a3 | upper arm off | **PASS**, 4 bones (legs) | **FAIL**, right upper arm 85° (±25°) |

The false pass on a3 is gone; the verdicts now agree with the eye and with the independent 14-bone diagnostics on all three.

## Tests

| Test | Kind | Result |
|---|---|---|
| `pose-geometry.test.ts`: arms measured; 3/3 human verdicts; moving bones = arms not legs; all moving bones foreshortened → inconclusive; unconfirmed joints never measured; uncertainty law; canonical joints (sides, units, every visibility state, mask) | Unit-tested on real keypoints | 11/11 pass |
| `checks.test.ts` (existing pose tests incl. mirror, foreshortened skip, missing limb) | Unit | pass |
| `frame20.test.ts` (rig deformation measured on pixels, previous Muse attempts still fail) | Integration (synthetic pixels) | pass |
| baseline replay | Integration (real artifacts) | as above |
| full suite: rotoscope, mapping, frame-debug, policies, animation | — | 41 files, 446 pass, 1 skipped |
| typecheck | — | clean |

## Not verified / limits

- Joints hidden under clothing in a **drawing** are carried as VISIBLE: no evidence available separates them (test documents it). The pose verdict no longer depends on them when the clip's motion is elsewhere; a clip whose motion *is* under the clothing (walking in a long skirt) gets `inconclusive` only if the leg bones are too short, not because they are hidden. Visual review (Phase 05) and silhouette (SAM) are the remaining evidence.
- Back views and profiles: see Phase 01 limits.
- No ground-truth keypoints exist for anime drawings; accuracy is measured by label-free proxies.

## Gate decision

- Every available point represented with confidence and visibility: yes (`joints.ts`).
- Hidden joints not invented as measurements: yes for every hidden joint the evidence can identify (track flags, mask, off-image); clothing occlusion documented as undetectable by score.
- Coordinate conversion verifiable: yes (Phase 01 tests + canonical `normalized`).
- Mirroring detected correctly: yes (a1; existing synthetic mirror test).
- No reliable verdict from too few points: yes (`coverage`, `inconclusive`).
- Reproducible tracker benchmark: yes.
- No regressions: full suite green; the one test that changed was a test-helper bug, fixed and explained.

**PASSED.**
