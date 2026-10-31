# Phase 04 — Muse Image generation

**Status: PASSED** (tested with real inference: 2 generations)

## Incident during this phase

The original run `60bd847f` was deleted from `.focus-data/rotoscope/` at about 2026-10-31T01:10Z, while this phase was in progress, by something outside this work (the app's dev server was running; no command of this work removes run folders — the rig benchmark deletes only its own temporary copy). Already preserved: the Phase 00/02 baselines (`baseline/*.json`) and the fixtures (`server/rotoscope/__fixtures__/wave/`: every pose, the character sheet, half-size cut-outs of the three attempts).

`scripts/audit/rebuild-wave-run.ts` rebuilt the run offline as `debug_runs/runs/wave`: source frames and poses from `test-1s-v4` (cut from the same recording: identical poses, 0.0 px), the original character, DWPose and the guides redrawn locally, the original character description. Check: character pose and all 9 guides within 0.04 px of the original (the fixture's rounding), layout identical to the last digit. The three original Muse Image attempts at full size are lost.

## The real request (audited)

Built by `imageRequestBody` (`server/animation/muse-image.ts`), sent through the Responses API with the `image_generation` tool:

- One user message: for each reference `"Image N: <role>"` then the image as a PNG data URL, in order; the prompt text last.
- Order in the pipeline (`framePrompt`): 1 character (B), 2 pose mannequin or skeleton guide (A+B), 3 video frame in greyscale (A), then previous frame / style anchor / correction (C) when present, palette last.
- References over 1024 px on the long side are resized (Lanczos, aspect and alpha kept); smaller ones travel byte for byte. The 1024×1536 canvas references (2 and 3) are always resized to 683×1024.
- Tool: `size 1024x1536`, `output_format png`, `reasoning_strength high`, image search / web search / shell off; `store: false` — stateless, no history between generations.
- Muse Image returned **1280×1920 PNG, RGB, no alpha** for a `1024x1536` request in both real calls; the pipeline resizes it to the canvas (same 2:3 aspect).
- No structural pose or mask conditioning is used or claimed: the endpoint as used takes reference images and text only. Pose control is by reference images (mannequin/guide) and words.

## Defects found and fixed

| Defect | Evidence | Fix |
|---|---|---|
| One call could bill two generations | `generateImage` wrapped the call in `withRetry(attempts: 2)`; a connection timeout (after up to 180 s) is retryable, and the provider may already have drawn the first | `attempts` option; `single_frame_debug` (both modes) uses `attempts: 1`. Every result records `requests` |
| The output was only kept after conversion (sRGB + alpha re-encode) | `generateImage` returned the converted PNG only | `raw` (the decoded bytes, untouched) returned and saved as `generated_raw.<format>` (format by magic bytes) |
| No response metadata or token usage in the debug record | — | `response` (id, status, model, usage, requests, latency) returned and saved as `muse_response.json`; shown in the report |
| API failures and quality failures shared one shape | `generation: { source: "failed", error }` | `{ source: "failed", kind: "api", code }` (the `AppError` code); the report says it is not a quality verdict |
| **The palette reference was wrong** | Image 4 ("the only colours allowed on the character") had no skin, hair, white underlayer or mint collar (Phase 00 C3): the generator was told to paint skin with none of its colours | `sheetColours` adds every softly shaded colour covering ≥ 0.8 % of the figure that no palette colour may stand for, by `holdColours`' own rule (see below). `PALETTE_VERSION` 3 → 4, so every run's palette is measured again |
| Provenance hashes didn't match what was sent for resized references | dry-run integration test | `withSentBytes`: each record also carries the hash of the bytes the request body actually carries when they differ |
| The debug tool couldn't run the pipeline's prompt | `single_frame_debug` used its own 2-image prompt | `pnpm single-frame-debug --run <dir> --frame N --strategy existing\|structured [--dry]` (`server/frame-debug/pipeline-frame.ts`) |
| Two debug runs got different palette images | Muse Spark named the same colours differently each call (Image 4 hashes `20a97d95` vs `be7075f7`, same hex values) | the debug palette is kept by character hash and reused |

### Palette criterion

The palette must explain the character sheet itself: a sheet colour that `holdColours` would call "a colour the character doesn't have" is missing from the palette. A second k-means pass runs on *softly shaded* pixels (every 4-neighbour within ΔE 10: a cel gradient moves a few ΔE per pixel, an outline edge 30 or more) and adds each cluster ≥ `MIN_SHARE` that no palette colour of the same kind lies within `MAX_SHIFT` of. On the wave sheet this adds skin `#fddebe`; the sheet then scores 98.3 % against its own palette with no foreign colour, where before skin alone was 1.7 % of the figure at maximum residual.

## Pipeline-mode single_frame_debug

One frame, the pipeline's own inputs built from the run's files (no Muse Spark call except naming a missing palette once), provenance checked before the call, exact request saved (images replaced by files with their sha256), one Muse Image request, raw output + response saved, the drawing measured by the pipeline's own `measureDrawing` (local DWPose). The run's manifest is never touched. Previous frame, anchor, lessons and feedback are left out on purpose: the frame is drawn cold.

## Prompt strategies — real inference, frame 1, same references

| | A: existing (`framePrompt`) | B: structured (`structuredFramePrompt`) |
|---|---|---|
| prompt | 4 949 chars (no frame reading: none kept in the rebuilt run, and none asked for) | 2 797 chars |
| images | 4 (character, mannequin, video frame, palette) | the same 4 (palette swatch names differed, see above) |
| tokens in / out | 19 594 / 1 765 | 18 432 / 1 511 |
| latency | 18.7 s | 18.1 s |
| by eye | **mirrored**: raised arm on the image's left; other arm stretched out instead of across the chest; hand touching the top edge | raised arm on the correct side; **head turned to profile**; other forearm not across the chest; figure cut at the top |
| pose check | FAIL: MIRRORED, 4/4 moving bones measured | FAIL: right forearm 40° (±14°) |
| colour | pass, 98.0 % (88.0 % as drawn) | fail: 5.2 % foreign (`#c39181` ΔE 28, `#274c4f` ΔE 27) |
| proportions | fail, forearm −59 %, head −9 % | fail, forearm +53 %, head −37 % |
| alpha | fail, edge (42 px) | fail, edge (110 px) |
| artifacts | `debug_runs/pipeline/2026-10-31T01-17-05-853Z_f1_existing/` | `debug_runs/pipeline/2026-10-31T01-17-53-490Z_f1_structured/` |

**Conclusion: no strategy is shown better.** One generation each; both failed the pose, differently. B used ~6 % fewer input tokens. Deciding needs several generations per strategy on several frames (a cost decision, not taken automatically: Rule 6). The colour and proportion verdicts above are from checks that Phase 05 recalibrates; the artifacts are kept for re-evaluation offline.

## Tests

| Test | Kind | Result |
|---|---|---|
| `muse-image.test.ts`: labels and order; byte-exact small references; >1024 px resized to 683×1024 with alpha kept; tool locked down; edit keeps aspect; `attempts: 1` → 1 request after a transient error; default → 2; raw bytes untouched + response metadata; no drawing → `image_incomplete` | Integration-tested (provider stubbed) | 6/6 |
| `pipeline-frame.test.ts`: dry run on the rebuilt wave run, both strategies: no generation, entities B / A+B / A / aid, Image 1 = the run's character sha256 and sent unresized, every sent image's hash accounted for | Integration-tested (real run files) | 2/2 |
| two real generations (above) | **Tested with real inference** | completed, 1 request each |

A Vitest pitfall cost time and is worth knowing: `beforeEach(() => create.mockClear())` returns the mock, which Vitest then runs as a teardown hook — calling a mock that throws. Braces fix it.

## Gate decision

- References sent are correct: yes — verified by hash end to end; the wrong palette reference fixed.
- Request respects the provider contract: yes — the request the app already used, accepted and completed twice; no undocumented conditioning claimed.
- At most one generation per debug invocation: yes (`attempts: 1`, `requests: 1` recorded).
- Original output saved: yes (`generated_raw.png`, untouched).
- API failures distinguished from quality failures: yes.
- Integration tests on request construction: yes.
- Real inference: yes, 2 generations.

**PASSED.**
