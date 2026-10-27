# Focus Flipbook

One character illustration → eight distinct, hand-drawn-style poses (walk, run, jump, wave, idle or fighting combo) → a looping frame-by-frame animation → verified MP4 / GIF / sprite sheet / PNG frames. Behind `NEXT_PUBLIC_ENABLE_FLIPBOOK=true` (off by default; restart `pnpm dev` or rebuild to switch). Page: `/flipbook`.

## Pipeline

```
upload ─► Muse Spark analysis ─► Muse Spark pose plan ─► character anchor ─► 8 × Muse Image drawings
       ─► SAM 3.1 cut-outs ─► registration on one sprite cell ─► quality checks ─► player / exports
```

| Step | Module | Model / tool |
| --- | --- | --- |
| Upload, decode, EXIF rotate, PNG working copy | `server/animation/image-input.ts` | Sharp |
| Visible facts about the character, requested action; the upload reading (summary, setting, ideas) | `character-analysis.ts` | Muse Spark (strict JSON + Zod) |
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
| Jump | ready, crouch, push off, rise, apex, fall, land, recover | no | crouches are drawn shorter (bob chart −0.22); rise, apex and fall float off the ground (up to 0.14 of body height, inside the cell's headroom); 12 drawings/s |
| Wave | rest, raise, hand up, wave out, wave in, out again, in again, lower | no | the arm nearest the viewer waves; neighbors are close on purpose, so no near-duplicate warning |
| Idle | rest, breathe in, full breath, blink, breathe out, settle, sway, return | no | breathing, a blink and a small weight shift; no near-duplicate warning |

The action comes from the instruction (Muse Spark analysis: `walk`, `run`, `fight`, `jump`, `wave`, `idle`; an instruction that names no movement is a walk, and one Focus can't animate, like a dance, is refused before anything is drawn), or from the motion picked on the create screen. Every action has its default pace (`ACTION_SPECS[action].drawingFps`). In the hands-up poses, hands stay at or below the top of the head, because the drawing's measured height sets its scale. The resize check divides out each pose's planned height, so a crouch drawn shorter on purpose isn't flagged. Phases, their order, the body height per phase and the flight lift are fixed in `shared/flipbook.ts` (`ACTION_SPECS`). A model can add character detail to a pose; it can't reorder, drop or invent one. Registration uses the median torso column, so a thrown arm doesn't shift the body.

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
- New animations, redraws, reference changes, scene plates and generated backgrounds pass `guardAiRequest`: the emergency switch, active-work cap, hourly rate and SAM daily budget, where a still image counts as one frame. An anonymous user's new animation spends one free edit.
- The AI review uses the chat window (`guardChatRequest`).

## Reading the upload

Right after an upload, `POST /api/flipbooks/images/<id>/look` reads it once (`readUploadedImage`): one Muse Spark call (`lookAtImage`, the analysis fields without an instruction, plus a one-line summary, the setting and up to three motions that suit the picture) and one SAM frame. SAM tries the subject phrase, then its head noun ("girl with horse ears" → "girl"), then "character" (`segmentationConcepts`). The result is kept with the upload (`look.json`, `character.png`, and `scene.png`: the upload with the character's place made transparent), so reading again is free. It passes the chat and AI guards and spends no free edit.

The create screen shows what was read (summary, facts, caveats), suggests the ideas as chips (the first one is the starting pick), and lets you flip between Original, Character and Scene. Creating with a picked motion sends `action`, and the flipbook reuses the reading's character facts instead of analyzing again; the caveats were already shown, so the run doesn't pause at the reference. With **Keep the scene** (on by default when there is one), Muse Image redraws the scene without the character alongside the poses (one drawing, `separateScene`) and it becomes the background: scrolling for a cycle in place, still for one that travels. A failed scene is a caveat, never a failed animation.

## Backgrounds

Transparent, a color, the uploaded scene without the character (`scene`, one drawing, only for illustrations with a scene), an uploaded image, or a **generated** setting: one Muse Image drawing in the character's style (`backdropPrompt`), offered first when the upload has no background (real alpha or a plain backdrop). A generated background, like the separated scene, is stored twice: as drawn (`generated.png`, still) and as a strip that tiles horizontally (`generated-loop.png`, moving). The strip is made seamless with a minimum-error cut across the last 12% of the width (`seamlessPlate`), so the wrap has no double exposure.

A scene or generated background moves in one of four ways (`BackgroundMotionSchema`): **Still**; **Slide**, the seamless strip; **Parallax**, two layers from one picture; and **Slow zoom**. Parallax comes from SAM on the strip: "sky", "cloud" and "sun" (three SAM frames) make the far layer. A cloud or sun found in the lower 40% is dropped, since it is usually a bush. The rest is the near layer, see-through where the far layer is, grown 2 px so cloud rims don't slide with the ground. Where the near layer slides off it, the far layer shows the average sky color of each row (`depthLayers`). Parallax is offered only when the split exists (`backgrounds.depth`). The far layer moves at `PARALLAX_FAR` (0.3) of the near one. A slow zoom eases from 1 to 1 + `ZOOM_DEPTH` (6%) and back over the clip's whole length (`backgroundZoomAt`), so the export loops. A separated scene defaults to Parallax (or Slide, without a sky) behind a walk or run on the spot, Still behind one that travels, and Slow zoom behind a jump, wave, idle or fight (`defaultMotion`).

A sliding background is fitted to the stage height and slides once per drawing by `backgroundShiftAt`: in place it moves back by exactly one stride per cycle, so the feet stay planted; while travelling it pans at 0.35× in the travel direction; actions without a stride drift slowly. The player and the exporter both use it. A GIF with any moving background (slide, parallax or zoom) covers the whole length instead of looping one cycle. Sprite sheets and PNG frames stay transparent or solid.

## Saving and the video editor

Signed in, a new animation is saved to the account (`ownerId`); one made before signing in is saved when its owner signs in with it open (`PATCH /api/flipbooks/<id>`, which also renames). The sidebar lists them (`GET /api/flipbooks`). Each animation keeps its last playback settings and background (`look`), so it reopens as it was left. Deleting one from the sidebar takes it off the account; it then expires like an unsaved one. As with clips, an animation's id is its only access key.

"Animate in the video editor" (`POST /api/flipbooks/<id>/editor`) renders a verified MP4 with the current settings and background (white when transparent) and ingests it as a new clip, then opens `/editor?v=<id>`.

## Storage

`.focus-data/flipbook-images/<id>/` holds uploads and `.focus-data/flipbooks/<id>/` holds state, references, versions, sprites, backgrounds and exports. Uploads and unsaved animations expire after 24 h; animations saved to an account stay until they are deleted.

## Known limitations

- Walk, run, jump, wave, idle and single-character fighting combos, all in side view. Dance and other gestures are not implemented, and neither are two characters interacting.
- Identity consistency depends on Muse Image. The checks flag size, color, framing, near-duplicate silhouettes and a missing stride, but they can't certify anatomy or identity.
- Facing direction isn't measured automatically. The AI review and your eyes catch it.
- No transparent MP4. GIF transparency is 1-bit.

Validation status, test coverage and the live-test procedure: [FLIPBOOK_VALIDATION_REPORT.md](FLIPBOOK_VALIDATION_REPORT.md).
