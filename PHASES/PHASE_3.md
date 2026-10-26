# FOCUS — PHASE 3: CINEMATIC VIDEO ENGINE & VIRAL EFFECTS

Continue working in the existing Focus repository.

The visual identity, application foundation, and Meta AI segmentation pipeline must remain intact.

You are now responsible for building the real video-compositing engine.

Think like a creative technologist working on professional video software.

The result must be visually impressive, technically correct, and fully exportable.

## Mission

Implement three object-aware cinematic effects:

1. Reality Shift.
2. Break the Frame.
3. Motion Echo.

All effects must use real SAM 3.1 masks.

No fake overlays.

No prerecorded effect video disguised as AI output.

No static screenshots pretending to be video editing.

No CSS-only effects that disappear during export.

The preview and MP4 must represent the same edit.

## 1. Shared compositing engine

Build one reusable, deterministic pipeline for all effects.

Input:

- Normalized source video.
- Frame-indexed segmentation masks.
- Selected object IDs.
- Effect type.
- Validated effect parameters.

Output:

- Rendered video frames.
- Final encoded MP4.
- Preview asset.
- Processing metadata.

Use FFmpeg and Sharp, or a technically justified equivalent.

The pipeline should:

1. Extract source frames.
2. Decode the segmentation masks.
3. Map masks to the correct frame dimensions.
4. Apply the effect.
5. Composite layers.
6. Encode the video.
7. Preserve audio when present.
8. Verify the output.

Do not run expensive image-processing work on the React main thread.

Do not load the entire video as uncompressed frames into application memory.

Support incremental frame processing.

Separate effects from encoding so all effects share the same export implementation.

Use the same rendering definitions for preview and final output wherever practical.

If a lightweight preview approximation is needed, ensure the exported version remains visually consistent.

## 2. Reality Shift

The first effect establishes the complete pipeline.

### Selective color

The user enters:

"Keep the person in color and make everything else black and white."

The subject remains in its original colors.

Everything outside the segmentation mask becomes grayscale.

Requirements:

- Frame-accurate masking.
- Correct object selection.
- Smooth edges.
- No significant color bleeding.
- No obvious halos.
- Stable tracking across movement.
- Consistent treatment across all frames.

Use a soft alpha mask where appropriate.

Do not excessively blur mask edges.

### Background blur

The user enters:

"Keep the dog sharp and blur everything else."

The subject remains sharp.

The background receives a configurable blur.

Provide three useful intensity levels.

Requirements:

- Accurate foreground/background compositing.
- Correct mask alignment.
- Proper handling of portrait videos.
- No cropping or stretching.
- Minimal edge artifacts.

Changing blur intensity should not require another SAM call.

### Acceptance test

Use a real video with a moving subject.

Render both effects.

Scrub the output and inspect the first, middle, and final frames.

Export MP4.

Verify that the effect remains applied throughout the entire video.

Do not proceed to Break the Frame if basic composition is still broken.

---

## 3. Break the Frame — FLAGSHIP FEATURE

This is the primary viral effect.

The user enters:

"Make the skateboarder break out of the frame."

The result should create the illusion that the selected subject extends outside an inner video window.

The effect should feel cinematic, intentional, and visually striking.

### Creative direction

Imagine a video displayed inside a beautiful rectangular frame.

The background footage remains clipped inside that rectangle.

The selected subject is rendered on a separate foreground layer that is not clipped to the same rectangle.

As the subject moves toward the edges, parts of their silhouette visually cross the frame boundary.

The subject appears to exist above the video and outside its limits.

The effect should create a strong sense of depth.

### Critical implementation detail

A video file still has rectangular physical dimensions.

To create the illusion, render onto a larger composition canvas.

Use three layers:

**Layer A — Composition background**

A clean canvas behind the inner video.

Use the existing Focus design identity for visual styling.

Support a dark or light composition background when appropriate.

**Layer B — Clipped video**

The original video appears inside a smaller rectangular viewport.

Its image is clipped to that region.

**Layer C — Unclipped subject**

Use the SAM mask to extract the foreground subject from the same original video.

Render this subject above the inner frame without applying the frame's clipping boundary.

The subject must use the correct source-to-output transform.

Its position must remain synchronized with the original video.

This allows visible subject pixels outside the inner frame crop to create the breakout illusion.

### Composition specification

Support an initial 1080 × 1350 export canvas for portrait-style social content.

The original video should appear within an inner framed region.

The frame can be centered with intentional margins.

Use suitable scale and crop transformations to create opportunities for the foreground subject to extend outside the inner frame.

Expose or derive a small set of composition parameters:

- Inner-frame size.
- Inner-frame position.
- Source framing.
- Background treatment.
- Subject foreground visibility.
- Mask feather.

Keep controls simple.

The default composition should look excellent without manual adjustment.

### Visual quality

- Avoid jagged cutout edges.
- Preserve fine object details as much as the segmentation allows.
- Avoid excessive shadows.
- Avoid sticker-like outlines.
- Avoid fake glow.
- Avoid excessive subject scaling.
- Avoid unrealistic disconnection between subject and source video.
- Preserve temporal stability.

A subtle depth shadow may be used only when it genuinely improves separation and matches the brand's visual language.

### Technical limitations

Do not hallucinate parts of objects that do not exist in the source video.

This effect is primarily spatial compositing, not generative video extension.

If the source framing does not provide enough visible subject pixels to create a convincing breakout effect, show an appropriate message or allow a composition adjustment.

Do not promise that every source video will produce a dramatic breakout.

### Optional visual refinement

Add a very subtle foreground emphasis at the frame boundary.

Keep it realistic.

The visual hierarchy must remain focused on the subject, not decorative elements.

### Acceptance test

Use a video showing a person moving through the scene.

The exported result must visibly show:

- A rectangular inner video.
- A correctly clipped background.
- An unclipped foreground subject.
- Subject pixels extending across the inner frame boundary.
- Stable movement.
- Correct timing.
- Working MP4 output.

Test a portrait clip and a landscape clip.

---

## 4. Motion Echo

This effect creates a temporal trail from an object moving through a video.

Example instruction:

"Give the dancer a cinematic motion trail."

The application should preserve the present subject while showing several fading copies from earlier moments.

### Implementation

Use the current frame as the base.

For each frame, look up a small number of previous subject masks.

Use the corresponding previous source frames to extract previous subject appearances.

Composite these historical subject layers into the current output frame.

Use descending opacity for older instances.

Example configuration:

- Three trails.
- Approximately 120ms between samples.
- Newer trails more opaque.
- Older trails less opaque.
- Current subject fully visible.

The actual values should be tuned by inspecting real results.

Avoid treating the effect as ordinary whole-frame motion blur.

Only the selected object's prior appearances should create trails.

### Important technical considerations

This effect is most convincing when:

- The camera is fixed.
- The subject moves visibly.
- Background motion is limited.
- The object is clearly segmented.

When the camera moves, old subject positions may not align with the current scene.

Do not pretend historical pixel coordinates are world-stabilized.

For the MVP, explicitly optimize Motion Echo for static-camera footage.

Do not add complex camera tracking or optical-flow stabilization unless the primary effects are already working and tested.

### Motion controls

Expose no more than:

- Trail count.
- Trail spacing.
- Trail intensity.

Keep safe ranges.

Reuse cached segmentation masks.

Changing trail parameters should not trigger new AI inference.

### Acceptance test

Use a short fixed-camera video of a moving subject.

The MP4 must show visible temporal silhouettes.

The subject itself must remain clear.

There must be no unexplained black frames, timing shifts, or badly offset masks.

---

## 5. Effect preview

Provide an accurate edited preview.

Required:

- Play and pause.
- Seek.
- Original/edited comparison.
- Correct video ratio.
- Correct timing.
- Correct object masks.
- Consistent effect parameters.

Prefer producing an actual preview video when that is more reliable than live browser compositing.

Do not build a fragile browser-only preview just to make the editor feel instantaneous.

A reliable preview that takes processing time is better than an inaccurate preview.

### Before/after comparison

If technically feasible, implement a comparison slider.

The slider should reveal original versus edited video with synchronized timestamps.

Do not run two independent players that drift apart.

Use a shared timeline or a synchronized composition mechanism.

Support pointer and keyboard interactions.

---

## 6. Export engine

Build a real MP4 export pipeline.

Requirements:

- H.264 encoding.
- YUV420P.
- Correct frame rate.
- Correct duration.
- Valid output dimensions.
- Audio preserved when source audio exists.
- No audio when source is silent.
- No accidental time stretching.
- No blank tail frames.
- No broken rotation metadata.
- Correct output filename.

Use safe process execution.

Do not concatenate untrusted strings into shell commands.

Use a subprocess argument array.

Track export progress from actual processing events.

After encoding:

1. Verify the output file exists.
2. Run FFprobe.
3. Check duration.
4. Check resolution.
5. Check video stream.
6. Check frame rate.
7. Verify audio handling.
8. Make the output available for download.

The export button must download the edited video, never the original input file.

---

## 7. Processing performance

Optimize for short videos.

MVP constraints:

- 10 seconds maximum.
- 720p normalized processing.
- 24 FPS.
- Bounded memory.
- Maximum one or two concurrent render jobs on the development machine.

Keep temporary artifacts isolated by job ID.

Reuse frames and masks where appropriate.

Ensure a canceled or failed job does not leave uncontrolled FFmpeg processes.

Provide cleanup for expired files.

Avoid unnecessary re-rendering when an export with identical parameters already exists.

---

## 8. Rendering correctness

Pay special attention to:

- Mask alpha conversion.
- Frame coordinate systems.
- Source versus output aspect ratio.
- Transparent foreground extraction.
- Pixel premultiplication.
- Video rotation.
- Correct clipping.
- Frame count consistency.
- Temporal indexing.
- Audio synchronization.

Do not assume a bounding box is equivalent to a segmentation mask.

All foreground extraction must use actual pixel masks.

Check the effect at multiple timestamps.

If masks are missing for some frames, do not silently fabricate perfect tracking.

Provide a safe fallback, warning, or recoverable failure.

---

## 9. Tests

Implement effect-specific tests.

### Reality Shift

- Foreground retains original color.
- Background becomes grayscale or blurred.
- Mask edges are handled correctly.

### Break the Frame

- Background is clipped.
- Foreground is not clipped.
- Source/output coordinate transforms are consistent.
- Export contains visible breakout pixels.

### Motion Echo

- Past frames are sampled correctly.
- Trails use correct object masks.
- Opacity changes are deterministic.
- Current subject remains visible.

### Export

- MP4 is valid.
- Duration is correct.
- Dimensions are correct.
- No frame drift.
- Audio is handled correctly.

Use synthetic test fixtures for pixel-level correctness.

Also validate with real, rights-cleared sample videos.

## 10. Final acceptance

The phase is finished when all three effects work on real video and can be exported.

If Motion Echo is not reliable, mark it experimental rather than allowing it to compromise Reality Shift and Break the Frame.

Report the actual status of each effect:

- Functional.
- Partially functional.
- Not implemented.
- Tested with real API masks.
- Tested only with fixtures.

Prioritize technical honesty.

Preserve the existing brand identity and project architecture.

**Build and verify these effects now. Do not stop after generating an implementation plan.**