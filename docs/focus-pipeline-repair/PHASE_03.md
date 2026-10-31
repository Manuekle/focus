# Phase 03 — Character rig and deformation

**Status: PASSED**

## Observed failure, reproduced offline

`scripts/audit/rig-benchmark.ts` (a copy of the run, local segmenter, no Meta call) reproduces frame 1 exactly: `rightUpperArm` clamped, **282 folded triangles, 3.3 % over-stretched, area ×0.87** ([baseline/rig-before.json](baseline/rig-before.json)). Frames 2–9, never reached by the real run, are all refused too, on `rightForearm`.

## Root cause

- The rig is built from the character sheet, whose hands are clasped in front of the waist: its forearms point at the camera (0.22 and 0.33 torso lengths, Phase 00 C6). Any frame with an extended forearm needs it stretched past `maxStretch = 1.3` → clamped → `limb-volume` refuses. Frame 1 needs the right upper arm pulled into an extreme foreshortening (31 %) → clamped too.
- Fold locations (new `foldedBy`): 200–300 triangles per frame, concentrated in the arm layers (`leftForearm` 105–124 on frames 1–5, `leftUpperArm` 101–132 on frames 6–9) and the torso near the shoulders: the zones where a joint's blend interpolates between layers turned 100–150° apart. A hanging wide sleeve rotated overhead is a surface that has to be **redrawn**, not warped; no 2D deformation makes it a raised sleeve.

**The refusal is correct.** The pipeline already falls back to Muse Image when a constraint fails; what was wrong is that parts of the failure were invisible and the fallback was only a log line.

## Defects fixed

| Defect | Fix |
|---|---|
| A triangle deformed to (near) zero area was `continue`d: neither folded nor distorted, nothing in the stats | Counted as **collapsed** when its area is under 1e-6, or under half a pixel *and* already past the squash limit (`triangleArea[0]`): it rasterizes to nothing, so the distorted-pixel count can never see it. 16–43 per frame on this run. |
| No way to tell *where* the mesh breaks | `stats.foldedBy`: folded + collapsed triangles per bone layer; printed in the structure outcome. |
| A torso whose affine fit sheared past the limits was silently replaced by a pelvis–neck similarity (its corners land off target) | `plan.torsoFit: "affine" \| "similarity"`, printed in the structure outcome. |
| The rig → Muse Image fallback left no trace on the attempt | Each generator attempt of a frame the rig refused carries a `rig` check, `status: "warn"`, `character rig not used (<reason>); drawn by Muse Image instead`. |

`solid-drawing/structure` now fails on any folded **or collapsed** triangle. No limit was loosened.

## Strategies evaluated

- Rigid layers without joint blending: removes folds by construction, but opens seams at every joint (the reason blending exists: see the `blendAbout` comment); on this sheet the sleeve would still be a hanging sleeve.
- Larger stretch limits: would make the rig "pass" frames by stretching foreshortened forearms 2–3× — exactly the silent stretching this phase forbids. Not done.
- Choosing a better base: the engine already picks the nearest approved drawing (`exclude` set, `triedBases`); on a fresh run the sheet is the only base. Once Muse Image draws an approved frame with the arm raised, later frames deform from it (frames-to-frames is the design).

None of them makes a 2D warp of this sheet valid for this clip, so no deformation algorithm was replaced.

## Before / after (rig benchmark, 9 frames)

| Frame | before: folded / collapsed | after: folded / collapsed | verdict before → after |
|---|---|---|---|
| 1 | 282 / (not counted) | 260 / 43 | refused → refused |
| 2 | 185 / – | 178 / 22 | refused → refused |
| 3 | 200 / – | 193 / 16 | refused → refused |
| 4 | 235 / – | 224 / 16 | refused → refused |
| 5 | 234 / – | 223 / 16 | refused → refused |
| 6 | 276 / – | 266 / 17 | refused → refused |
| 7 | 269 / – | 256 / 22 | refused → refused |
| 8 | 282 / – | 269 / 28 | refused → refused |
| 9 | 263 / – | 247 / 29 | refused → refused |

Some tiny folded triangles are now counted as collapsed (checked first), so broken triangles in total went up (frame 1: 282 → 303) while "folded" went down. Data: [baseline/rig-after.json](baseline/rig-after.json).

## Tests

| Test | Kind | Result |
|---|---|---|
| `structure.test.ts`: own pose clean; forearm folded back → folds detected by orientation and located; limb squashed flat → collapsed, structure fails; over-stretch clamped and `limb-volume` fails; sheared torso → `similarity` reported | Unit-tested (synthetic figure, real deform) | 5/5 |
| existing `mapping.test.ts` (reproduces own drawing IoU > 0.97; raised arm measured on pixels within 4°; no folds) | Unit | pass |
| `frame20.test.ts` (rig on a real run's keypoints) | Integration | pass |
| rig benchmark on run 60bd847f | Integration (real artifacts) | as above |
| full server suite | — | 67 files, 724 pass, 2 skipped |

## Gate decision

- Triangle orientation checked: yes (signed area).
- Inversions detected: yes; collapses too (new).
- Physically inconsistent deformations rejected: yes (`limb-volume`, `structure`).
- No silent stretching: clamps reported; torso fallback and sub-pixel collapse now reported.
- Regions to redraw identified: exposed/over-stretched masks (existing) and, when the rig can't draw at all, the explicit fallback record.
- Transform tests pass; visible regions kept in supported cases (existing IoU and raised-arm tests).

**PASSED.**
