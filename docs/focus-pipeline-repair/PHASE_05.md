# Phase 05 — Quality validation engine

**Status: PASSED**

No check was switched off. Each change below fixes a measured defect or turns a non-discriminating rule into a lower-severity finding, with the evidence that justifies it.

## What each score measures

| Score | Where | What it measures | Notes |
|---|---|---|---|
| pose | `pose-match.ts` `comparePoses` | screen-direction error of each limb bone, beyond its keypoint-noise uncertainty; mirror test; coverage of the clip's moving bones | Phase 02 |
| colour similarity ("98.0 %") | `colour.ts` `holdColours` | 100 − mean ΔE of the figure's pixels to their palette colour **after** they were pulled onto it (25 % of their variation kept) | measures the recolouring more than the drawing |
| colour "as drawn" ("88.0 %") | same | the same before pulling | the generator's own closeness to the palette |
| foreign colours ("5.2 % of the figure…") | same | share of the figure in clusters farther than ΔE 26 from every colour **the sheet has** (its gamut, below) | was: from every palette colour |
| colour jumps ("wrong parts") | same | a palette colour group's share of the figure against the previous approved frame (> 6 points) | first frame: none (see below) |
| Mapping "colour overlap" / `consistency` ("53 %") | `mapping/profile.ts` `paletteSimilarity` | intersection of two 64-bin RGB histograms (4 levels per channel), area-weighted, of the whole figure | **not comparable** with the above: a skirt at R=130 sits 2 values above a bin edge, and a different pose changes the areas. It is a coarse distribution overlap, recorded in diagnostics only, never a check |
| proportions | `body-map.ts` `checkProportions` | each limb's drawn length (scaled by the torso) against its guide length: too long against the full length, too short only on clear bones; head height | |
| silhouette | `pipeline.ts` `silhouetteMatch` | IoU of the rig's predicted silhouette and the drawing's alpha | diagnostics only |
| review | `draw.ts` `reviewFrame` (Muse Spark) | part-by-part pose, identity, style, anatomy, clean cut-out, as judged by a model | evidence, not a metric |

The 53 % vs 92.6 % disparity is explained: they are different quantities (coarse histogram overlap of areas vs palette distance after recolouring), and the 92.6 % itself was low only because skin was missing from the palette (Phase 00 C3).

## Changes

### A. Pose — Phase 02 (uncertainty, coverage, `inconclusive`, unconfirmed joints)

Detector errors are separated from pose errors: a bone too short for its direction to rise above the estimator's noise is *unmeasured*, not wrong; a frame where too few moving bones are measurable is *inconclusive*, not passed.

### B. Proportions — the forearm +19/+45/+60 %

Root cause (Phase 00 C6): the sheet's forearms point at the camera (hands clasped), so their sheet length is a lower bound. New `sheetEstimates`: a limb's distal/proximal ratio on the sheet (longer side of each) against the same ratio of the video subject at full extension; below `SHEET_FLOOR` (0.85, the guides' own constant) the distal bone gets an estimated full length = the sheet's proximal bone × the clip's ratio. The video subject's proportions are used for that ratio only.
- Wave frame 1: forearm lower bound 0.89 cells → estimate 1.23 cells. Legs: no estimate (their ratio matches).
- A limb within the estimate passes; past it the finding is `severity: minor` → REVIEW_NEEDED (a person judges), never an automatic redraw. A limb past an exact (non-estimated) length is still a major, measured defect.
- The prompt's body map gives the estimate ("about 1.23 cells") instead of telling the generator never to exceed the foreshortened length (hypothesis H3).

### C. Colour

1. Palette (Phase 04): soft-shaded colours added so the palette explains the sheet (skin).
2. **Gamut**: every colour on the sheet's figure (k-means, 32 clusters, those ≥ 0.2 % of the figure), stored in `palette.json` (`PALETTE_VERSION` 5). A drawn colour is foreign only when far from the gamut: shading tones and small accents (a shoe's red trim) the palette doesn't name are the character's colours. Off-palette but in-gamut pixels are left as drawn and cost their distance to the gamut, not the maximum.
3. Similarity below 95 % alone → `severity: minor`; foreign colours or wrong-part jumps → `major`.
4. A first-frame comparison of part areas against the sheet's own shares was implemented, calibrated, and **removed**: it does not separate (below).

**Calibration** (`scripts/audit/colour-calibration.ts`, data in [baseline/colour-calibration.json](baseline/colour-calibration.json)). Positives: 3 wave attempts and 2 real Muse outputs (colours right by eye), 9 approved frames of a second character (black hair, white shirt, black trousers, red-trimmed shoes) from the same video, and the 8 consecutive pairs of that sequence. Negatives: each positive with its largest colour region's hue turned 120° / 180° or its lightness inverted (42).

| Rule set | positives passed | negatives failed |
|---|---|---|
| before (palette v3-style, flat only) — measured on the wave in Phase 00 | 0/3 wave attempts | — |
| palette v4 (soft pass), no gamut | 6/14 (second character's shoe trim and shirt shading flagged foreign) | 37/42 |
| + gamut + first frame vs sheet shares (≤ 0.2) | 9/14 (wave jumps 0.36–0.37 vs the sheet: its skirt flares) | 42/42 |
| **+ gamut, jumps vs previous frame only (final)** | **22/22** (incl. 8 consecutive pairs, largest jump 0.034) | 18/42 first frame; **42/42 with a correct previous frame** (smallest jump 0.374 vs the 0.06 limit) |

Sheet-share jumps overlap between positives (≤ 0.371) and negatives (≥ 0.369): no threshold separates them, so the rule is not used. The final rule set has **no known false rejection**; its known **false acceptance** is a first frame whose part is painted in *another colour the character has* (skirt in the blouse's green): colour statistics cannot see it without a previous frame. That is left to the visual review ("every clothing item and its colours"), and caught from frame 2 on by the share rule.

### D. SAM 3.1 and silhouettes

SAM 3.1 is used where it has real support: the character's figure mask for the rig (`segmenter.ts`) and the debug tool's figure masks, with the existing guards (a mask covering < 1 % or > 95 % of the frame is refused, empty results fall back). It is not used for pose. Fixed: `intersectionOverUnion` returns 1 for two empty masks, so an empty cut-out "matched" an empty prediction perfectly; `silhouetteMatch` returns null when either side is empty.

### E. Visual review

- Pipeline: the reviewer now looks at every drawing the measurements don't **reject** (an inconclusive pose is what it should see), instead of only drawings that passed everything; `pnpm rotoscope generate --review-always` (debug) reviews every attempt.
- `single_frame_debug --run` always reviews (one Muse Spark call), and `--generated` re-evaluates a saved output with no new generation.
- The review is a check with critical severity on pose/identity/anatomy failures, but `closePose` still lets precise joint measurements overrule it on limbs (existing), and it is recorded as evidence beside the measurements.

### F. Decision engine (`server/rotoscope/decision.ts`)

`ACCEPTED` (every check passed; info warnings allowed) · `REJECTED` (a measured critical or major failure) · `INCONCLUSIVE` (no rejection, but a check that could reject couldn't measure) · `REVIEW_NEEDED` (no rejection, a minor finding). Severities default by check (pose/review critical; alpha/scale/proportions/colour/policies major; style minor; rig/mapping info) and can be lowered by the check itself with evidence (colour similarity-only, proportions against an estimate).
`runFrames`: only REJECTED draws again; INCONCLUSIVE and REVIEW_NEEDED stop the run at that frame with `halted.reason` "needs review…", spending no further attempt; each attempt stores its `decision`. A person approves (existing `approve` command / UI) or redraws.

## Results

Original wave attempts, re-measured on the rebuilt run (`scripts/audit/fixture-remeasure.ts`, [baseline/phase05-fixtures.json](baseline/phase05-fixtures.json)):

| Attempt | Human | Phase 00 | Now |
|---|---|---|---|
| a1 | reject (mirrored) | rejected (pose, colour, proportions, alpha) | **REJECTED**: pose mirrored (critical), alpha edge |
| a2 | accept | rejected (colour 92.6 %, forearm +19 %) | **ACCEPTED** by every measurement (the review would run next) |
| a3 | reject (upper arm) | rejected for the wrong reasons (colour, forearm); pose passed | **REJECTED**: pose right upper arm 85° (critical) |

Real outputs of Phase 04, re-evaluated with review (2 Muse Spark calls, no regeneration):

| Output | Measurements | Review | Decision |
|---|---|---|---|
| A existing | pose MIRRORED, alpha edge; colour pass | right/left arms swapped part by part | REJECTED |
| B structured | pose right forearm 40°, alpha edge (110 px); colour **pass** (was 5.2 % foreign before the gamut) | head in profile, torso sideways; left hand cropped | REJECTED |

## Tests

| Test | Kind | Result |
|---|---|---|
| `validation.test.ts` — decision states (all four, severity ordering, overrides); runFrames: REVIEW_NEEDED and INCONCLUSIVE stop after one attempt with the verdict stored, REJECTED retries; colour: skin in the palette, sheet passes its own palette, the 3 real attempts pass, orange foreign → major fail, skirt in the blouse's green after a correct frame → wrong parts; proportions: sheet forearms detected (not legs), extended sheet → no estimate, within estimate passes, past estimate → minor → REVIEW_NEEDED, without estimate → major → REJECTED; silhouette: empty → null | Unit-tested on real fixtures | 17/17 |
| colour calibration (positives/negatives above) | Integration (real images) | false rejects 0/22; false accepts documented |
| fixture re-measure (3/3 match the human verdict) | Integration (real artifacts) | pass |
| review on 2 real outputs | **Tested with real inference** | coherent with the eye |
| full server suite | — | 70 files, 749 pass, 2 skipped; typecheck clean |

## Gate decision

- Every metric has a testable definition: yes (table above).
- Occlusion considered: unconfirmed joints, coverage, foreshortened sheet bones.
- No known false colour rejections: 0/22 positives rejected.
- Colour disparity explained: yes.
- Visual review runs in debug: yes (real calls).
- States covered by tests: yes.
- False positives and false negatives tested: yes, including the documented false-accept class.
- Decision traceable: each attempt stores its decision; reasons are logged and in `halted.reason`.

**PASSED.**
