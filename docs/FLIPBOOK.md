# Focus Flipbook

One character illustration → eight distinct, hand-drawn-style poses (walk, run or fighting combo) → a looping frame-by-frame animation → verified MP4 / GIF / sprite sheet / PNG frames. Behind `NEXT_PUBLIC_ENABLE_FLIPBOOK=true` (off by default; restart `pnpm dev` or rebuild to switch). Page: `/flipbook`.

## Pipeline

```
upload ─► Muse Spark analysis ─► Muse Spark pose plan ─► character anchor ─► 8 × Muse Image drawings
       ─► SAM 3.1 cut-outs ─► registration on one sprite cell ─► quality checks ─► player / exports
```

| Step | Module | Model / tool |
| --- | --- | --- |
| Upload, decode, EXIF rotate, PNG working copy | `server/animation/image-input.ts` | Sharp |
| Visible facts about the character, requested action | `character-analysis.ts` | Muse Spark (strict JSON + Zod) |
| Direction, motion, timing hints, per-pose character detail | `pose-planning.ts` | Muse Spark |
| Anchor: the upload, or one clean side-view redraw | `reference-manager.ts` | Muse Image (only when needed) |
| One drawing per pose, anchor re-sent every time | `frame-generation.ts`, `muse-image.ts` | Muse Image, Responses API `image_generation`, `store: false` |
| Cut-out: real alpha → SAM 3.1 → flood-fill key (flagged) | `frame-alignment.ts`, `server/ai/sam.ts#segmentImage` | SAM 3.1 still image |
| Registration, bob chart, stride | `frame-alignment.ts` | — |
| Checks; optional AI review of the contact sheet | `quality-control.ts` | Muse Spark (review only on request) |
| MP4 / GIF / sprite sheet + atlas / PNG ZIP | `export.ts`, `zip.ts` | FFmpeg, Sharp |
| State, locks, workers, cleanup | `store.ts`, `flipbooks.ts` | — |

## Actions

| Action | Eight phases | Travels | Notes |
| --- | --- | --- | --- |
| Walk | contact, down, passing, up × left/right | yes (stride measured from contact vs passing) | 8 drawings/s by default |
| Run | strike, load, drive, float × left/right | yes (stride 1.7 × body height) | float frames sit 7% of body height above the ground; 12 drawings/s by default |
| Fight | guard, jab load, jab, jab return, cross load, cross, cross return, guard bounce | no | one character shadowboxing; no opponent, no impact effects |

The action comes from the instruction (Muse Spark analysis: `walk`, `run`, `fight`; anything else that names no movement is a walk). Phases, their order, the body height per phase and the flight lift are fixed in `shared/flipbook.ts` (`ACTION_SPECS`). A model can add character detail to a pose; it can't reorder, drop or invent one. Registration uses the median torso column, so a thrown arm doesn't shift the body.

**Two characters fighting each other is not supported.** Every drawing is made from one character anchor and cut out as one figure; a duel needs two identities, contact and occlusion between bodies, and a shared stage. When the image has several characters and the instruction asks for a fight, the user is told only one character will throw punches.

## Consistency strategy

- One immutable anchor image goes into every pose request as Image 1, with the same identity text (hair, clothing, accessories and their side, palette, style) repeated. A drawing never becomes the reference for the next drawing, so the cycle doesn't drift.
- A redraw may add the previous drawing as Image 2, but only for size, line weight and color. The anchor stays Image 1.
- Drawings are requested on a flat key color picked away from the character's palette, with no floor and no shadow, so the cut-out is clean.
- Registration: feet on one baseline, torso column on the cell center, height scaled to the pose's bob-chart value. The cell only grows, so redrawing one frame never moves the approved ones.

## Timing

8 (or 12) drawings per second, 24 fps output, so each drawing is held for 3 (or 2) frames. Exports are 2, 4 or 6 s, always a whole number of cycles. Walking across moves the root once per drawing, by the stride measured from the contact and passing drawings. The player and the exporter both use `cellLeftAt` / `tickAtOutputFrame`.

## Cost controls

- `FOCUS_FLIPBOOK_IMAGE_BUDGET` sets the Muse Image drawings per animation (default 16). Going past it needs an explicit confirmation, and each confirmation extends the budget by exactly what was confirmed. Failed drawings are refunded.
- New animations, redraws, reference changes and scene plates pass `guardAiRequest`: the emergency switch, active-work cap, hourly rate and SAM daily budget, where a still image counts as one frame. An anonymous user's new animation spends one free edit.
- The AI review uses the chat window (`guardChatRequest`).

## Storage

`.focus-data/flipbook-images/<id>/` holds uploads and `.focus-data/flipbooks/<id>/` holds state, references, versions, sprites, backgrounds and exports. Both expire after 24 h and aren't attached to saved projects.

## Known limitations

- Walk, run and single-character fighting combos. Jump, idle, dance and gestures are not implemented, and neither are two characters interacting.
- Identity consistency depends on Muse Image. The checks flag size, color, framing, near-duplicate silhouettes and a missing stride, but they can't certify anatomy or identity.
- Facing direction isn't measured automatically. The AI review and your eyes catch it.
- No transparent MP4. GIF transparency is 1-bit.

Validation status, test coverage and the live-test procedure: [FLIPBOOK_VALIDATION_REPORT.md](FLIPBOOK_VALIDATION_REPORT.md).
