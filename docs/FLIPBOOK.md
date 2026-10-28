# Focus Flipbook

One character illustration → eight distinct, hand-drawn-style poses (walk, run, jump, wave, idle or fighting combo) → a looping frame-by-frame animation → verified MP4 / GIF / sprite sheet / PNG frames. Several saved characters can also be drawn together in one scene (a fight, a dance), as long as you ask: see [Scenes](#scenes-several-characters-together). Behind `NEXT_PUBLIC_ENABLE_FLIPBOOK=true` (off by default; restart `pnpm dev` or rebuild to switch). Page: `/flipbook`.

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
| Anchor: the upload, or one prepared reference in the selected camera view | `reference-manager.ts` | Muse Image (only when needed) |
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

**A cycle animates one character.** Every cycle drawing is made from one character anchor and cut out as one figure. When an upload has several characters and the instruction asks for a fight, the user is told only one character will throw punches. Two or more characters interacting is a [scene](#scenes-several-characters-together), made from saved characters.

## Camera views and saved characters

**Camera view** preserves the source by default, or selects front (looking at the camera), three-quarter, side, back, above or below. It is separate from left/right screen travel. The selected view persists in the plan and controls preparation, drawing, repair, background perspective and review. A complete front-facing illustration does not require a profile redraw. The lateral stride estimator runs only for profile views. Each cycle keeps its camera fixed; continuous camera orbits are not implemented.

**My characters** opens `/characters`: create a design from references, edit its outfit, name and compare immutable versions, then use one exact version in Flipbook. The derived animation copies the selected design and original identity reference and enforces its owner's access. See [My characters](MY_CHARACTERS.md) and [the Elf-chan validation](MY_CHARACTERS_VALIDATION_2026-10-27.md).

## Scenes: several characters together

**Animate together** (`/flipbook?together=1`; "Animate together" in the sidebar and on the My characters picker) draws two to four saved characters in the same picture, as long as you ask: "a fight: one throws a punch, the other dodges and kicks back", 3 seconds. It needs an account, because the characters are saved ones.

- **The length sets the frames.** A scene is drawn at a fixed 8 drawings per second, on threes at 24 fps, so it has `seconds × 8` drawings: 1 s is 8, 2 s is 16, 6 s is 48 (`ensembleDrawings`, `MIN/MAX_ENSEMBLE_SECONDS`). Each drawing is held 3 output frames and the scene plays once through, exactly as long as asked; the export takes the plan's pace and length whatever the request says (`sceneRequest`). The create screen states the cost before anything is drawn, and starting is the confirmation: the animation's budget opens to cover the scene (`max(FOCUS_FLIPBOOK_IMAGE_BUDGET, drawings)`), and anything past it, like a redraw, asks again.
- **Pipeline.** `createEnsemble` copies each character's selected version. Muse Spark reads each one (`analyze`, one call each; their palettes merge, so the key color avoids all of them). One Muse Spark call choreographs one beat per drawing (`planEnsemble`: where each character stands, which way it faces, what its body does; exactly N beats, with one retry when it miscounts). Muse Image draws each beat from every character's own image as Images 1…n, at 1536×1024 on a flat key color (`drawEnsembleFrame`, `ensemblePrompt`). SAM cuts out the group (the union of every figure found for "character" and for each character's own noun, `extractSubject({ group })`; the key color when SAM finds none). Then registration and checks.
- **Continuity.** Drawings go in two lanes: each leans on the one two beats back as one more reference (the second beat on the first), so staging, size and line carry on while the image limiter keeps two requests going. A redraw or a repair leans on the drawing before it.
- **A fixed camera** (`computeEnsembleAlignment`). No drawing is moved to match another: each keeps the place it was drawn at, all at one scale, on a cell the size of the drawing's own frame (1152×768), so the characters move inside it. The cycle checks for scale and center of mass, a second figure and the stride don't apply and are skipped; a figure touching the edge is still flagged.
- **What a scene doesn't have.** In-betweens, reordering, extra references, a changed reference, the movement chat, a kept uploaded scene and pose guides: its beats are one choreography (`not_for_scenes`). A drawing can be improved, redrawn with a note, replaced, restored or approved like any frame, and the background panel works as for a cycle.
- **Private.** Like an animation made from one saved character, a scene is only opened by its owner (`requireFlipbookAccess`), and it keeps the exact versions it was made from.
- **Limits.** Which character is which, and whether two bodies really make contact, depend on Muse Image: characters with similar designs can swap features, and the checks can't certify identity or that the beats read as a fight. Watch the contact sheet. 48 drawings are 48 paid requests, two at a time, so a 6 s scene takes a while; the editor shows the real count as it goes.

## Internal pose references

Focus uses [POSE-DB-01](https://ai-pose-gallery.pages.dev/) internally. The complete
metadata snapshot indexes **288 poses and 1,439 images**, preserving all actual
camera variants, including the one missing angle. There is no pose picker. Use
the existing motion controls and describe the movement; for Idle, a description
such as “sitting calmly” or “crouching, looking around” can set the resting posture.

The existing Muse Spark planning call receives the original character image and
a compact catalog of compatible postures. It can choose a base `poseId` for an
idle loop and a `referenceId` per phase for other movements. IDs are validated
against the full imported allowlist, normalized to the selected camera view and
checked for compatibility before download. Fixed phase mechanics always take
priority over a static anatomy guide. A base posture keeps its support points
through breathing, blinking and swaying; an upper-body guide never crops the
character or replaces the phase's legs. Plans save the chosen guides, so frame
redraws and repairs reuse them.

The renderer supports one character. There are **233 eligible
single-character postures** across the full-body and upper-body series; movement
filters additionally exclude seated or lying body poses from travelling actions.
Only available guides matching the selected view are used. The back view has no
matching catalog images and uses textual mechanics without a profile fallback.
The 55 paired postures remain excluded from single-character animation.

`server/animation/pose-catalog.json` stores metadata; `shared/pose-ids.json` holds
the allowed image IDs without names or categories in the browser. Refresh both
with `pnpm poses:sync`. The importer parses JSON data without executing the page
and checks identifiers, paths, duplicate entries, text lengths and response size.
It copies no PNGs or thumbnails.

`pose-references.ts` downloads only the guides a run uses from the fixed source
host, refuses redirects, limits each response to 8 MiB and 16 million decoded
pixels, and caches validated copies privately under `.focus-data/pose-references/`.
The gallery permits reference use but prohibits redistributing its image data;
there is no gallery media route or browser gallery. An unavailable automatic guide
adds a caveat and leaves the original frame pipeline working from its posture and
movement descriptions. Older explicit selections still require their reference.
The mannequin is sent last to Muse Image; Image 1 remains the character identity.
This adds no extra paid model call.

## Consistency strategy

- One immutable anchor image goes into every pose request as Image 1, with the same identity text (hair, clothing, accessories and their side, palette, style) repeated. A drawing never becomes the reference for the next drawing, so the cycle doesn't drift.
- A redraw may add the previous drawing as Image 2, but only for size, line weight and color. The anchor stays Image 1.
- Drawings are requested on a flat key color picked away from the character's palette, with no floor and no shadow, so the cut-out is clean.
- Cut-out edges lose the key color: slivers of exact key color inside the mask (between strands of hair) become transparent, and within 3 px of the outline the key's hue is taken back out of each pixel, beyond what the pixel deeper inside has (`despill`). A soft edge that un-blending pushed past the inside (a green rim on a magenta key) is pulled back.
- Registration: feet on one baseline, torso column on the cell center, height scaled to the pose's bob-chart value. The cell only grows, so redrawing one frame never moves the approved ones.

## Timing

Anime timing on a 24 fps clock, with no interpolation and no blending: the character changes in steps, one finished drawing at a time, and the camera moves on every frame.

- **Exposure sheet** (`exposures`, `PoseSpec.hold` in `shared/flipbook.ts`). Walk, run, wave and idle hold every drawing evenly: on threes at 8 drawings per second, on twos at 12. Fight and jump use anime holds: the guard, the hits, the crouch, the apex and the landing stay on screen longer (3–4 frames) and the fast parts (loads, push-off, returns) go by on ones or twos. Each pace still sums to one cycle (24 or 16 frames), so 2, 4 and 6 s exports are whole numbers of cycles. A cycle whose holds don't add up falls back to even holds.
- **Camera on ones** (`stageClock`). Sliding, parallax and zooming backgrounds move on every output frame while the character holds its drawing, like an anime follow pan, so the screen never steps at 8–12 per second. Walking across still moves the character's root once per drawing (`cellLeftAt`), by the stride measured from the contact and passing drawings.
- The player and every exporter use the same functions (`drawingAtFrame`, `frameAtTick`, `stageClock`). MP4 is 24 fps; GIF writes every 24 fps frame (held frames cost almost nothing; a moving background pans on twos there to keep the file small); sprite atlases and the PNG ZIP carry each drawing's duration (`frameDurationsMs`).

Interpolated "Smooth · 60 fps" playback (RIFE) was retired: it morphed between drawings that differ strongly (ghost limbs, warped hair) and softened fine lines. Saved animations that chose it play and export as drawn.

## In-betweens

**In-betweens** (editor side panel) draws one drawing halfway between each pair of key poses in playback order, `i0`…`i7` (`i3` goes after `f3`). Each is one Muse Image request from the anchor (Image 1, identity) and the two keys as drawn (Images 2 and 3, the only source of the pose; `inbetweenPrompt`: every part travels halfway along its arc, no blur or smears), then cut out like a key (SAM or the key color, with the same despill) and registered on the same cell, halfway up the bob chart between its keys (`finalize`). The panel states the cost first (one drawing each, and the budget before and after); past the budget, the usual confirmation asks (`reserveImages`), and drawings Meta doesn't bill are refunded. `POST /api/flipbooks/<id>` `{ action: "inbetweens" }` (`drawInbetweens`).

- **Timing** (`exposureSheet`): an in-between takes one frame from the key before it, so the cycle keeps its length and every export stays a whole number of cycles. Keys keep their holds and in-betweens play on ones: a fight at 8/s goes from 8 drawings to 16 (holds 3·1·1·1·3·1…). At 12/s a key already on ones leaves no room, so its in-between isn't shown; the panel says how many play.
- **Staleness** (`inbetweenCurrent`): each in-between remembers the two key drawings it was made from. Redrawing a key, restoring it or moving a pose makes the in-betweens beside it stale: they stop playing, and the button draws only those again (`inbetweenTargets`).
- **Playback**: the player, MP4, GIF, sprite sheet and PNG ZIP play the same cycle (`playbackCycle`); the atlas marks in-betweens and carries their durations. The **In-betweens** switch in the player leaves them out to compare (`PlaybackSettings.inbetweens`, saved with the look; exports follow it). The frame strip and frame panel still show the eight keys.
- Root motion and background pans are measured per cycle of keys; a drawing's root position is the stage clock at its first frame, so travel keeps pace with time whatever plays between the keys.

## Cost controls

- `FOCUS_FLIPBOOK_IMAGE_BUDGET` sets the Muse Image drawings per animation (default 16). Going past it needs an explicit confirmation, and each confirmation extends the budget by exactly what was confirmed. Failed drawings are refunded.
- New animations, redraws, in-betweens, reference changes, scene plates and generated backgrounds pass `guardAiRequest`: the emergency switch, active-work cap, hourly rate and SAM daily budget, where a still image counts as one frame. An anonymous user's new animation spends one free edit.
- The AI review and the movement chat use the chat window (`guardChatRequest`); applying a chat proposal passes `guardAiRequest` and spends one drawing per redrawn frame.

## Chat: change the movement in words

A compact panel under the preview ("Change the movement") takes a sentence such as "make her wave with the other hand", "slower, smaller movement", "make the walk happier" or "change frame 4 so the arm is higher". It follows the video editor's AI chat: one small Muse Spark call per message, the same hourly window (`guardChatRequest`, `FOCUS_CHAT_PER_HOUR`), and it is off when `FOCUS_AI_DISABLED=1` (the panel reads `/api/health` and shows that it is paused).

- **Propose first, never redraw by itself.** `POST /api/flipbooks/[id]/chat` (`server/animation/chat.ts`) sends the message, the last 8 turns, the playback on screen and the saved plan (the eight poses in playback order, with their current instructions, and which frames are approved) to Muse Spark. The answer is a typed proposal (`shared/flipbook-chat.ts`): `changes` (frame, new instruction, a one-line summary), a `playback` patch, `skipped` frames and the `cost`. Nothing is saved or drawn, and no budget is used.
- **What can change.** Poses: any of the eight instructions. Playback (free): `drawingFps` 8 or 12, `speed` 0.5–1.5 (only while the cycle travels), `durationSeconds` 2, 4 or 6, and `motion` (`across` only for actions that travel). The loop is always on, so "stop looping" gets an explanation, not a change. The phases themselves, the camera view and the character's design are never touched.
- **Guards on the model's answer.** Frames come from the positions it was shown; repeated, out-of-range and unchanged poses are dropped; approved frames are named in `skipped` and left alone; playback values are clamped to the supported set and dropped when they equal the current ones.
- **Cost, stated before Apply.** The panel shows "This will redraw N frames (N drawings)", plus how the budget stands (`FOCUS_FLIPBOOK_IMAGE_BUDGET`). When the proposal goes past the budget it says by how much, and Apply is the explicit confirmation (`confirmExtra`). Playback-only proposals say they are free and apply instantly in the studio (the existing "look" autosave keeps them).
- **Apply** (`POST /api/flipbooks/[id]/chat/apply`, `applyPoseChanges` in `server/animation/flipbooks.ts`) runs the same path as "Redraw" for each listed frame, in one run: `paidGate` (`guardAiRequest`), `reserveImages` (one drawing per frame, nothing saved if the budget or a guard refuses), the new instructions saved into the plan, then `drawFrames` with the neighbor image, SAM cut-out, registration and checks. Approved frames refuse the whole apply; a busy animation refuses it too. Failed drawings are refunded like any redraw; the new instruction stays in the plan, so redrawing the frame again uses it.
- **Tests** run with Muse Spark and Muse Image faked (`chat.test.ts`, no paid calls); `e2e/flipbook-chat.spec.ts` covers the disabled state with AI off.

## Reading the upload

Right after an upload, `POST /api/flipbooks/images/<id>/look` reads it once (`readUploadedImage`): one Muse Spark call (`lookAtImage`, the analysis fields without an instruction, plus a one-line summary, the setting and up to three motions that suit the picture) and one SAM frame. SAM tries the subject phrase, then its head noun ("girl with horse ears" → "girl"), then "character" (`segmentationConcepts`). The result is kept with the upload (`look.json`, `character.png`, and `scene.png`: the upload with the character's place made transparent), so reading again is free. It passes the chat and AI guards and spends no free edit.

The create screen shows what was read (summary, facts, caveats), suggests the ideas as chips (the first one is the starting pick), and lets you flip between Original, Character and Scene. Creating with a picked motion sends `action`, and the flipbook reuses the reading's character facts instead of analyzing again; the caveats were already shown, so the run doesn't pause at the reference. With **Keep the scene** (on by default when there is one), Muse Image redraws the scene without the character alongside the poses (one drawing, `separateScene`) and it becomes the background: scrolling for a cycle in place, still for one that travels. A failed scene is a caveat, never a failed animation.

The scene is an edit with no size (`action: "edit"`), so it keeps the upload's aspect. Muse Image still re-renders the whole picture (on a real 16:9 illustration: median drift 2/255, small details such as a jersey number changed), and `input_image_mask` made no measurable difference, so the plate is only used where the character was: SAM cuts the character out of the upload, the mask is extended over strongly changed pixels connected to it (thin parts SAM missed, like a tail's tip; `removedWithSubject`), grown and feathered, and every pixel outside it is the upload's own (`keepAroundSubject`). When the character can't be cut out or the plate came back in another aspect, the plate is used as drawn.

## Animate as is

The second mode on the create screen. Nothing is redrawn: the upload is the animation, and only its own pixels move, in a loop that closes exactly. It suits pictures the cycle can't use as they are (a close-up, a three-quarter view, a cropped body) and anyone who wants the picture kept as drawn.

- **Finding what can move** (`findLayers`, `server/animation/living-pictures.ts`, `POST /api/flipbooks/images/<id>/living`): one Muse Spark call (`nameLayers`, strict JSON) names the parts in plain nouns, by kind: the character, parts of it that flow (hair, cape, scarf), many small floating things (leaves, petals), the sky, and what stays still. Then one SAM frame per moving part. A flowing mask counts only when at least half of it lies on or beside the character (another character's hair is dropped); floating pieces are small (under 3% of the picture, at most 80); the sky is large. A part SAM can't find is dropped, never guessed. The character comes from the same cut-out the flipbook uses. Masks and `layers.json` are kept in the upload's `living/` folder, so this runs once per upload.
- **The engine** (`server/animation/living.ts`, no AI): floating pieces are cut out as sprites and their places filled from the surroundings (push-pull inpainting, grown past their painted glow); they drift across the frame in whole crossings per loop (bigger ones twice, so they read as nearer) or flutter in place, and pass behind the character unless they overlapped it. Flowing parts bend in a wave whose weight is 0 at the root (where the part touches the rest of the body, by geodesic distance inside the part) and 1 at the tip; the field fades out around the part, so what's around it follows instead of tearing. The body breathes and leans a little from its lowest point. Open sky drifts by crossfading two shifted copies; it stays a band away from everything else, because SAM's sky reaches into the glow and blur around what stands in it and drifting those pixels slides ghost outlines. Every motion is periodic in the loop, and pixels no motion reaches are the upload's own.
- **Anime timing.** The character's own motion (breathing, flowing parts, the blink) holds each pose for two frames, 12 poses a second (`LIVING_BODY_HOLD`, `bodyTime`), the way anime animates characters; the camera, the sky and floating pieces move on every frame.
- **Rendering** (`renderLiving`, `POST /api/flipbooks/images/<id>/living/render`): local, about 11 s for a 4 s loop at 1536×864 (17 s with the Depth camera, 26 s for a 6 s loop with Depth and blinking); see [Deployment](DEPLOYMENT.md#animate-as-is-cpu-memory-and-disk). One silent loop is rendered first; the MP4 (H.264, 24 fps, AAC when it has sound, verified with FFprobe) repeats it and lays the sound under it, and the GIF (12 fps, 640 px, verified by parsing) is made from it. Keyed by the request and the inventory; the same choices reuse the files. A picture keeps its 12 newest renders (`pruneRenders`). Each layer takes the motions its kind allows (`MOTIONS_FOR`), at Subtle, Normal or Strong; plus the wind's direction and a 2, 4 or 6 second loop.

- **Sound.** The Meta Model API has no audio generation (its models are text, image, segmentation and speech-to-text). Sound is either an **ambience** (wind, leaves in the wind, rain, waves) synthesized by FFmpeg from filtered noise with fixed seeds (no AI, no stock files, no licenses; `soundGraph`), suggested from what moves (`suggestAmbience`), or **a track the person uploads** (`POST …/living/audio`: read with FFprobe, normalized to stereo AAC, cut to 60 s, replacing the previous one). Either way the sound is made a little longer than the video and its last half-second is crossfaded (equal power) into its start, so the MP4 repeats without a seam. **Video length** repeats whole loops to 10, 20 or 30 seconds or more (`videoSeconds`), without re-encoding the picture (`-stream_loop`, stream copy). The GIF is always one silent loop.
- **Camera and shape.** A slow zoom (in and back out within the loop) or a pan (side to side inside a slight zoom), both periodic, so the loop still closes (`cameraView`). The video can be the picture's own shape or a 9:16 or 1:1 crop (`framedSize`) around the character's head and shoulders (`focusOf`: the center of mass of the top 40% of its outline, so an outstretched arm doesn't pull the crop away), at the picture's own resolution. A still, uncropped camera copies pixels as they are.
- **Depth camera and blinking.** Both need one extra step, done once per upload and kept in `living/`. **Depth** (`separateLivingScene`, `POST …/living/scene`) is a pan where the character slides more than the background, as if nearer. What it uncovers comes from the scene with the character taken out (`scene.png`): free when the picture is transparent or its background plain (filled from its surroundings), otherwise one Muse Image drawing, kept only where the character was (`keepAroundSubject`), so every other pixel is still the upload's own. The background layer is replaced a few pixels past the character's mask (`wideCover`), so its glow and outline slide away with it instead of staying behind as a ghost. **Blinking** (`prepareBlink`, `POST …/living/blink`) costs one SAM frame to find the eyes and one Muse Image edit that draws them shut; only the eye region of that drawing is used (`blink.png` and `blink-mask.png`, a soft mask), laid over the upload for about 0.18 s once per loop (`blinkAmount`: closing, holding, opening), so the rest of the face is never touched. Both are off until asked for, and tests replace the Muse Image calls (`livingServices`) so nothing is spent.
- **Parts picked by hand.** SAM can't separate a part of a character in a still image: a point gives the whole character, a box only the part's outline. So "Add a part" (`addPart`, `POST …/living/parts`) picks it the way a cel-shaded drawing separates its parts (`pickPart`): grow from the click while each step to a neighbor changes the color only a little (following shading) and stays within range of the clicked color, never outside the character, then close the gaps thin inner lines leave. It becomes a flowing layer; it can be removed, and its id is never reused, since renders are cached by layer id.
- **How flowing parts bend.** Weight 0 at the root (where the part meets the rest of the body) to 1 at the tip, by distance inside the part. Past its outline, each background pixel takes the weight of the part's nearest pixel (`nearestSet`), fading over three times the tip's travel, so the background bends along without tearing; the rest of the character never bends with it (a leg a tail hangs behind keeps its shape). A tip travels at most a quarter of its part's length, and the wave along the part is limited so neighboring pixels never move past each other: short parts (a tail) can't fold over themselves.
- **Progress.** Asked for `application/x-ndjson`, the render route streams one line per percent and then the render; closing the request cancels it on the server.
- **Keeping it.** "Open in video editor" (`livingToEditor`, `POST …/living/editor`) ingests the finished MP4 as an editor clip, sound included; for a signed-in person it becomes a saved project, out of the 24-hour cleanup that uploads and their renders are subject to.

Limits: nothing new is invented, so a part can only move as far as its surroundings can cover for it. Inpainting under a floating piece that crossed something textured (a blurred runner) leaves a soft patch, and SAM can't name every part (a "tail" wasn't found on the reference picture).

## Backgrounds

Transparent, a color, the uploaded scene without the character (`scene`, one drawing, only for illustrations with a scene), an uploaded image, or a **generated** setting: one Muse Image drawing in the character's style (`backdropPrompt`), offered first when the upload has no background (real alpha or a plain backdrop). A generated background, like the separated scene, is stored twice: as drawn (`generated.png`, still) and as a strip that tiles horizontally (`generated-loop.png`, moving). The strip is made seamless with a minimum-error cut across the last 12% of the width (`seamlessPlate`), kept to the middle of that overlap, and blended band by band across the cut (`pyramidBlend`, a Laplacian pyramid as for panorama seams): broad color and soft clouds fade over a wide band while fine detail switches sharply, so the wrap shows neither a hard, jagged line (as a plain cut through clouds did) nor a double exposure.

A scene or generated background moves in one of four ways (`BackgroundMotionSchema`): **Still**; **Slide**, the seamless strip; **Parallax**, two layers from one picture; and **Slow zoom**. Parallax comes from SAM on the strip: "sky", "cloud" and "sun" (three SAM frames) make the far layer. A cloud or sun found in the lower 40% is dropped, since it is usually a bush. The rest is the near layer, see-through where the far layer is, grown 2 px so cloud rims don't slide with the ground. Where the near layer slides off it, the far layer shows the average sky color of each row (`depthLayers`). Parallax is offered only when the split exists (`backgrounds.depth`). The far layer moves at `PARALLAX_FAR` (0.3) of the near one. A slow zoom eases from 1 to 1 + `ZOOM_DEPTH` (6%) and back over the clip's whole length (`backgroundZoomAt`), so the export loops. A separated scene defaults to Parallax (or Slide, without a sky) behind a walk or run on the spot, Still behind one that travels, and Slow zoom behind a jump, wave, idle or fight (`defaultMotion`).

A sliding background is fitted to the stage height and slides on every output frame by `backgroundShiftAt`: in place it moves back by exactly one stride per cycle, so the feet stay planted; while travelling it pans at 0.35× in the travel direction; actions without a stride drift slowly. The player and the exporter both use it. A GIF with any moving background (slide, parallax or zoom) covers the whole length instead of looping one cycle. Sprite sheets and PNG frames stay transparent or solid.

## Saving and the video editor

Signed in, a new animation is saved to the account (`ownerId`); one made before signing in is saved when its owner signs in with it open (`PATCH /api/flipbooks/<id>`, which also renames). The sidebar lists them (`GET /api/flipbooks`). Each animation keeps its last playback settings and background (`look`), so it reopens as it was left. Deleting one from the sidebar takes it off the account; it then expires like an unsaved one. As with clips, an animation's id is its only access key.

"Animate in the video editor" (`POST /api/flipbooks/<id>/editor`) renders a verified MP4 with the current settings and background (white when transparent) and ingests it as a new clip, then opens `/editor?v=<id>`.

## Storage

`.focus-data/flipbook-images/<id>/` holds uploads and `.focus-data/flipbooks/<id>/` holds state, references, versions, sprites, backgrounds and exports. Uploads and unsaved animations expire after 24 h; animations saved to an account stay until they are deleted.

## Known limitations

- Walk, run, jump, wave, idle and single-character fighting combos in a fixed selected camera view, and scenes of two to four saved characters (1–6 s). Dance as a cycle and continuous camera orbits are not implemented; a scene's characters can dance, but only as a described scene. The frontal Elf-chan Wave is verified live; the other new views have automated contract coverage and still require visual evaluation for each design.
- Identity consistency depends on Muse Image. The checks flag size, color, framing, near-duplicate silhouettes and a missing stride, but they can't certify anatomy or identity.
- Facing direction isn't measured automatically. The AI review and your eyes catch it.
- No transparent MP4. GIF transparency is 1-bit.

Validation status, test coverage and the live-test procedure: [FLIPBOOK_VALIDATION_REPORT.md](FLIPBOOK_VALIDATION_REPORT.md).
