# FOCUS — FLIPBOOK ANIMATION ENGINE
## Create real frame-by-frame animations from a single image using Meta AI

### ROLE

You are the principal software architect, AI engineer, 2D animation engineer, motion designer, and senior quality-assurance engineer responsible for extending Focus.

Focus is an existing AI-powered creative application. Focus V2 has already been developed, and the repository contains an established visual identity, video-processing functionality, Meta AI integrations, and cinematic editing tools.

Your mission is to implement a new capability:

**Focus Flipbook — Turn a single illustration into a sequence of hand-drawn animation frames.**

The product must produce actual frame-by-frame animation, not just camera movement or a static image moving across the screen.

The new capability should let users create animation loops, inspect individual drawings, correct inconsistent frames, preview motion, and export the results.

This is an evolution of Focus, not a replacement.

## THE MOST IMPORTANT PRIORITIES

In strict order:

1. Preserve the existing Focus application.
2. Preserve the established visual identity.
3. Make the new animation engine genuinely functional.
4. Achieve visual consistency between animation frames.
5. Make the workflow intuitive and reliable.
6. Produce valid exported animations.
7. Test the entire system with real images and real Meta API calls.
8. Polish the user experience.

**Do not work on a hackathon demo, viral video, promotional material, marketing page, or social media content during this implementation.**

The product comes first.

---

# 1. REPOSITORY SAFETY

Before making changes, inspect:

- Current working directory.
- Git status.
- Current branch.
- Existing application structure.
- Existing dependencies.
- Existing Meta Model API implementation.
- Existing video renderer.
- Existing export utilities.
- Existing upload system.
- Existing job manager.
- Existing visual identity.
- Existing animations and components.
- Existing automated tests.
- Existing environment configuration.

Run the existing validation commands to establish a baseline.

Document existing failures before implementing anything.

## Absolute restrictions

Do not:

- Reinitialize the repository.
- Recreate the Next.js project.
- Reset Git history.
- Discard uncommitted changes.
- Run `git reset --hard`.
- Run `git clean -fd`.
- Delete existing V2 modules.
- Replace current dependencies without justification.
- Replace the visual identity.
- Generate a new logo.
- Change established colors or typography.
- Rewrite the entire video-processing architecture.
- Delete or rewrite existing tests merely to make them pass.
- Commit or push automatically without an existing authorized workflow.
- Modify unrelated projects.

Prefer additive, isolated changes.

Inspect files before editing.

If an existing component solves a requirement, reuse it.

Create a new module instead of modifying a stable one unnecessarily.

Use feature flags to isolate incomplete functionality.

Keep Focus V2 functional at every milestone.

---

# 2. PRODUCT CONCEPT

Focus Flipbook is an AI-assisted traditional animation editor.

The user provides:

- A character illustration.
- A movement instruction.
- An animation style.
- Optional timing preferences.

Focus generates multiple images representing successive moments of the movement.

The images are placed on a frame timeline.

The user can play them rapidly to see the animation.

The result can be edited and exported.

### Example

Input:

A full-body anime-style character standing still.

Instruction:

"Animate this character walking to the right. Preserve the exact outfit, hairstyle, colors, proportions, and overall illustration style."

Expected result:

A sequence of distinct walking poses.

When played in order, the sequence creates the illusion of a character walking.

This is similar to traditional flipbook animation.

## Key product distinction

Traditional parallax animation moves existing layers.

Focus Flipbook generates and organizes different character poses.

The character's arms, legs, torso, and posture should visibly change across frames.

Simply translating a static character image does not satisfy the feature requirements.

---

# 3. REQUIRED META AI MODELS

Use the official Meta Model API.

Base URL:

`https://api.meta.ai/v1`

Environment variable:

`MODEL_API_KEY`

## Muse Image

Model:

`muse-image-1.0`

Primary responsibilities:

- Generate character references.
- Edit existing character illustrations.
- Generate pose variations.
- Generate animation keyframes.
- Correct selected inconsistent keyframes.
- Preserve visual identity as much as supported by the model.

Use official image-generation and multi-turn image-editing APIs.

Study Meta's documentation:

https://dev.meta.ai/docs/image-generation

https://dev.meta.ai/docs/cookbook/anchored-image-series

Important:

Muse Image supports reference-guided image generation, but it does not guarantee perfect character consistency.

Use reference images, repeated anchors, structured pose descriptions, image comparisons, and user review.

Do not treat eight independent text-only generations as a reliable animation.

## Muse Spark

Use the existing supported Muse Spark integration.

Responsibilities:

- Interpret animation instructions.
- Analyze the uploaded character.
- Identify the requested action.
- Create structured animation plans.
- Suggest appropriate poses.
- Validate whether the requested animation is supported.
- Help interpret frame-quality issues when appropriate.

Do not rely on Muse Spark to produce image pixels.

Use validated structured outputs.

## SAM 3.1

Model:

`sam-3.1`

Responsibilities:

- Segment the character from the source image.
- Produce foreground masks.
- Isolate generated character poses where necessary.
- Support sprite extraction.

Reuse the existing SAM service.

SAM provides segmentation, not animation.

Do not assume it generates poses, depth, or missing body parts.

## Other Meta models

Muse Wonder is optional for more complex planning.

Muse Voice Transcribe is not required.

Muse Glimmer and Muse Spark Open are not required for this feature.

Muse Code is a development tool, not an animation renderer.

Do not add unnecessary model integrations merely to increase the model count.

---

# 4. INITIAL MVP: WALK CYCLE

The first genuinely working feature must be:

**A character walking in a seamless loop.**

Do not begin with running, jumping, fighting, dancing, or arbitrary character motion.

Walking is the baseline for building and validating the animation pipeline.

## Input requirements

Prefer:

- Full-body character illustration.
- One clearly identifiable character.
- Side-view pose.
- Visible feet.
- Stable character proportions.
- Simple background.
- Sufficient resolution.

If the input does not show the full character, indicate that the result may be unreliable.

Do not silently invent unseen body parts while claiming exact identity preservation.

Allow the user to replace or correct the reference.

## Walking cycle

Build an eight-pose walk cycle.

The motion should approximately follow:

1. Left contact.
2. Left down.
3. Left passing.
4. Left up.
5. Right contact.
6. Right down.
7. Right passing.
8. Right up.

Define these as explicit pose specifications.

They should represent distinct stages of locomotion.

Do not create eight nearly identical standing images.

## Timing

Default:

- Eight unique animation drawings.
- Eight drawings per second.
- One complete cycle per second.
- 24 FPS MP4 output.
- Each drawing held for three output frames.

The user should see authentic stepped animation rather than artificial motion smoothing.

Support 12 FPS drawing playback as an optional setting when appropriate.

Keep drawing count distinct from encoded output frame rate.

Do not generate 240 separate AI images for a ten-second video.

Generate a small reusable cycle and repeat it.

## Loop correctness

The animation should loop without an obvious discontinuity.

Do not add an unnecessary duplicate ninth image identical to the first when eight frames already form the complete cycle.

Validate:

- Matching character scale.
- Consistent baseline.
- Consistent facing direction.
- Continuous limb movement.
- Reasonable foot contact.
- Stable torso height.
- Correct frame ordering.

If the cycle fails, fix individual frames rather than regenerating the entire sequence unnecessarily.

---

# 5. CHARACTER REFERENCE SYSTEM

Character consistency is the central technical challenge.

Do not generate animation frames without a reference strategy.

## Step A — Analyze the character

Inspect the provided image.

Determine, where visually identifiable:

- Character orientation.
- Character silhouette.
- Hair color and hairstyle.
- Clothing.
- Accessories.
- Body proportions.
- Color palette.
- Illustration style.
- Visible limbs.
- Foot position.
- Ground contact position.

Describe these attributes in structured metadata.

Do not infer invisible details as established facts.

## Step B — Build a reusable character anchor

Preserve the original image.

Prepare a reference suitable for generating multiple poses.

Where useful, create a character sheet containing:

- Original pose.
- Consistent full-body design.
- Relevant side-view reference.
- Character color palette.

Use Muse Image when needed.

Do not create additional reference sheets unnecessarily.

Store all generated references for reuse.

## Step C — Lock character identity

Every pose-generation request should reuse the same established character references.

Preserve:

- Same hairstyle.
- Same facial features as far as visible.
- Same clothing.
- Same accessories.
- Same color placement.
- Same body proportions.
- Same line-art style.
- Same shading conventions.
- Same camera angle.
- Same character orientation.

Only the pose should change.

Use Meta's documented reference-image and multi-turn mechanisms.

Do not assume that keeping a conversation ID alone guarantees identity consistency.

---

# 6. POSE PLANNING ENGINE

Before generating images, create a structured animation plan.

Use Muse Spark.

Example representation:

```ts
type AnimationPose = {
  index: number;
  phase:
    | "left_contact"
    | "left_down"
    | "left_passing"
    | "left_up"
    | "right_contact"
    | "right_down"
    | "right_passing"
    | "right_up";
  description: string;
  relativeRootY: number;
};

type FlipbookPlan = {
  action: "walk";
  direction: "left" | "right";
  view: "side";
  drawingFps: 8 | 12;
  durationMs: number;
  loop: boolean;
  poses: AnimationPose[];
};
```

Refine this schema to match the existing Focus codebase.

Use Zod.

Never generate arbitrary executable code from model responses.

The pose planner should create clear spatial constraints.

For example:

**Left Contact**

- Left foot forward.
- Right foot backward.
- Opposite arm swing.
- Torso approximately upright.
- Head facing right.

**Left Passing**

- Weight supported by left leg.
- Right leg moving forward.
- Arms passing through central swing.
- Small vertical body movement.

The opposite half of the cycle mirrors gait timing, not the entire character image.

Do not mirror asymmetric clothing, logos, hairstyles, or accessories unintentionally.

---

# 7. FRAME GENERATION ENGINE

Implement an actual generation pipeline.

For each pose:

1. Load the canonical character reference.
2. Load the animation plan.
3. Build a pose-specific instruction.
4. Include appropriate reference images.
5. Request a pose image from Muse Image.
6. Validate response completeness.
7. Save the generated image.
8. Extract the character from the background when necessary.
9. Normalize its spatial alignment.
10. Add the frame to the sequence.

## Important: generation strategy

Do not request all frames using unrelated prompts.

Prefer anchored generation with a stable reference image.

When a sequence requires refinement, use the documented Muse Image conversation system appropriately.

Be careful with sequential drift: continuously using the immediately previous output as the only reference may gradually alter the character.

Maintain an immutable canonical character anchor.

For each pose, use that anchor and the pose specification as the primary references.

Additional pose or previous-frame references may supplement the anchor, not replace it.

## Optional sprite-sheet generation

Evaluate whether generating a reference sheet with multiple poses improves consistency.

If the model produces a well-organized multi-pose sheet, allow slicing into individual frames.

However:

- Do not assume generated grid boundaries are exact.
- Do not assume every cell contains a valid pose.
- Verify each extracted frame.
- Do not use incorrect crops.
- Do not fabricate frames that were never generated.

Select the most reliable method based on real tests.

---

# 8. FRAME ALIGNMENT

Raw generated images are not automatically valid animation frames.

Implement a normalization pipeline.

Every output frame should use:

- Identical canvas dimensions.
- Consistent subject scale.
- Consistent camera position.
- Stable ground baseline.
- Correct sprite alignment.
- Matching pixel format.
- Proper alpha handling.
- Preserved drawing details.

## Character extraction

If Muse Image produces an opaque background, use SAM segmentation or an existing reliable segmentation method.

Do not assume transparent images are always returned.

Avoid cutting off hair, accessories, limbs, or feet.

Handle mask failures explicitly.

## Root and baseline alignment

Estimate the character's stable origin.

Prefer a consistent ground-contact reference for walking cycles.

Align character scale and position.

Do not center every silhouette independently without considering its actual pose.

Avoid vertically jumping characters caused by incorrect bounding-box alignment.

Preserve intentional body bobbing.

## Background

For the first MVP, prefer a transparent or plain background.

Do not generate a new background for every frame.

If a scene background is required, render it separately as a stable layer.

---

# 9. CONSISTENCY VALIDATION

Create a frame quality-control system.

Compare generated frames for:

- Subject presence.
- Orientation.
- Canvas size.
- Relative scale.
- Center-of-mass displacement.
- Approximate ground baseline.
- Color consistency.
- Bounding-box stability.
- Unexpected background changes.
- Missing limbs.
- Major accessory changes.
- Duplicated body parts.
- Near-identical consecutive frames.

Automatic checks should flag potential issues, not falsely certify perfect anatomy or character identity.

Provide a contact sheet so the developer can visually inspect every frame.

Clearly identify frames that may require correction.

## Selective regeneration

Allow the user to regenerate one selected frame.

The regenerated frame must use:

- Original character reference.
- Pose specification.
- Neighboring approved poses when useful.
- Consistent style instructions.

Preserve all other approved frames.

Do not regenerate the entire cycle unless explicitly requested.

## Budget controls

Use bounded image-generation calls.

Start with eight keyframes.

Set a configurable generation budget.

Do not automatically retry inconsistent frames indefinitely.

Report consumed requests where available.

Require an explicit user action for additional regeneration after the initial budget.

---

# 10. FLIPBOOK PLAYBACK ENGINE

Build an actual frame-sequence player.

Required controls:

- Play.
- Pause.
- Restart.
- Loop toggle.
- Frame stepping.
- Playback speed.
- Drawing FPS.
- Current frame indicator.

The player should display real generated images.

At eight drawings per second, display each image for the intended duration.

Do not use CSS transforms on a single unchanged image and claim frame-by-frame animation.

Preload only the frames needed for responsive playback.

Avoid excessive React re-rendering during animation.

Use a frame scheduler appropriate for the browser.

Respect playback timing.

Make animation preview deterministic.

---

# 11. ONION SKIN EDITING

Add a small but useful traditional animation feature:

**Onion Skin.**

When enabled:

- Show the previous drawing with reduced opacity.
- Show the current drawing normally.
- Optionally show the next drawing with reduced opacity.

This helps identify inconsistent movement.

Requirements:

- Toggle on/off.
- Adjustable overlay opacity.
- Correct frame alignment.
- No impact on final export unless explicitly designed as an effect.

Onion Skin is an editing tool, not a default exported visual effect.

Do not build a complete illustration editor.

The user only needs to inspect, reorder, replace, and regenerate existing frames.

---

# 12. FRAME TIMELINE

Reuse Focus's existing timeline design where possible.

Add a dedicated frame-strip presentation for Flipbook mode.

Each frame should show:

- Thumbnail.
- Frame index.
- Pose name.
- Generation state.
- Approval state.
- Optional warning.

User actions:

- Select frame.
- Step between frames.
- Preview sequence.
- Regenerate selected frame.
- Replace frame with uploaded image.
- Reorder frames.
- Restore original generated frame.
- Export.

Protect approved frames from automatic replacement.

Keep interaction simple.

Do not create a large professional animation suite.

---

# 13. WALKING ACROSS THE SCREEN

Separate local animation from spatial movement.

A walking cycle has two components:

**A. Local gait**

The legs and arms change pose.

**B. Root translation**

The character moves across the canvas.

Implement both.

Allow:

- Walk in place.
- Walk left.
- Walk right.

For horizontal movement:

- Use the existing eight-frame walk cycle.
- Translate the character across the output canvas.
- Synchronize stride speed with root translation.
- Avoid obvious foot sliding where possible.

Provide a speed control.

Do not create a fake walking effect with static-image translation.

The gait must remain visible.

Use the same approved sprite sequence for all playback modes.

---

# 14. BACKGROUND COMPOSITION

Allow an optional static background.

The user can:

- Keep a transparent background where the export format supports it.
- Use a solid color.
- Reuse the original image background where appropriate.
- Upload a custom background.

Do not regenerate the same background on every frame.

Maintain correct subject compositing.

Do not force a parallax effect onto a traditional 2D animation.

Keep background motion independent from sprite animation.

---

# 15. EXPORT FORMATS

The MVP should support:

## MP4

- H.264.
- YUV420P.
- 24 FPS.
- Correct duration.
- Correct pose sequence.
- Actual animated movement.
- Optional composited background.

## Animated GIF

- Correct frame delays.
- Correct loop behavior.
- Reasonable color palette.
- Bounded output size.

## Sprite sheet PNG

Export the approved frames arranged in a consistent grid.

Support a transparent sprite sheet when correct alpha masks are available.

Include frame dimensions and ordering metadata.

Optional: provide an atlas JSON file suitable for game-development workflows.

Do not advertise transparent MP4 output.

MP4 should use a composited background.

Avoid black halos around transparent sprite edges.

## PNG frame sequence

Allow exporting individual approved frames as a ZIP file.

Ensure deterministic frame names:

- frame_000.png
- frame_001.png
- frame_002.png

Use safe export paths.

Do not generate downloadable files until their output is complete and verified.

---

# 16. EXISTING VIDEO FEATURES

Preserve all existing Focus video capabilities.

The new Flipbook mode must not change the 60-second upload maximum already selected for private testing.

The 60-second video-input limit and the new frame-animation duration are separate constraints.

Initial Flipbook animation output durations:

- 2 seconds.
- 4 seconds.
- 6 seconds.

Longer loops can be added later.

Do not attempt to generate 60 seconds of unique AI drawings.

Existing video mode should continue using its current supported duration and processing pipeline.

Do not change SAM tracking or V2 effects unless a verified regression requires a targeted fix.

---

# 17. USER EXPERIENCE

The current visual identity is authoritative.

Do not redesign Focus.

Add Flipbook as an additional creation mode.

Suggested creation modes:

- Video.
- Animate Image.
- Flipbook.

If the existing architecture already has Animate Image, integrate Flipbook as a dedicated animation method rather than creating duplicate navigation.

## Initial screen

Heading:

**Make your drawings move.**

Subtitle:

"Turn a single illustration into a frame-by-frame animation."

Upload area:

"Drop a character illustration."

Prompt placeholder:

"Describe how your character should move..."

Primary action:

"Create animation."

## Editor

The user should see:

- Original reference.
- Generated frame preview.
- Timeline.
- Animation controls.
- Current pose.
- Regenerate-frame action.
- Export.

Keep the character central.

Use clear loading states:

- Analyzing character.
- Planning poses.
- Generating frames.
- Preparing sprites.
- Checking consistency.
- Animation ready.

Do not show fake processing percentages.

Do not replace existing components with generic dashboard controls.

## Interaction quality

- Smooth but restrained transitions.
- Stable layout.
- Proper focus states.
- No flashing previews.
- No unexpected layout shifts.
- Responsive design.
- Keyboard-accessible controls.
- Reduced-motion support for interface animations.

The animation preview itself must remain controllable by the user.

---

# 18. ARCHITECTURE

Add an isolated animation domain.

Suggested modules, adjusted to the existing project structure:

`animation/character-analysis`

`animation/pose-planning`

`animation/reference-manager`

`animation/frame-generation`

`animation/frame-alignment`

`animation/quality-control`

`animation/sequence-player`

`animation/export`

Reuse existing modules for:

- Meta API client.
- SAM segmentation.
- File handling.
- Processing jobs.
- FFmpeg.
- Authentication or private access controls where they already exist.
- Design system.
- Common UI components.

Do not build a second unrelated media job manager.

Keep all model calls on the server.

Validate all inputs.

Use unique job IDs.

Limit concurrency.

Clean up temporary assets.

---

# 19. DEVELOPMENT MILESTONES

Implement sequentially.

## Milestone 1 — Baseline protection

- Audit Focus V2.
- Run existing tests.
- Record current working behavior.
- Document relevant architecture.
- Add a disabled feature flag for Flipbook.

Acceptance:

Existing Focus functionality remains unchanged.

## Milestone 2 — Reference preparation

- Implement image upload.
- Analyze character.
- Integrate Muse Image references.
- Reuse SAM for extraction.
- Prepare a consistent character anchor.

Acceptance:

A source character can be saved and previewed without losing its original design.

## Milestone 3 — Real pose generation

- Implement the eight-pose walking plan.
- Generate actual distinct character poses.
- Use anchored reference images.
- Validate frame output.
- Allow individual frame regeneration.

Acceptance:

The user can inspect eight real pose images.

Do not advance if all poses are nearly identical or inconsistent beyond usability.

## Milestone 4 — Playable animation

- Implement frame sequencing.
- Normalize scale and alignment.
- Add playback controls.
- Add loop behavior.
- Add onion skin.
- Add walk-in-place and root-translation modes.

Acceptance:

The user can see a recognizable, continuous walking animation.

## Milestone 5 — Export

- Implement MP4.
- Implement GIF.
- Implement sprite-sheet PNG.
- Verify output files.
- Test repeated loops.

Acceptance:

Exports genuinely reproduce the approved frame sequence.

## Milestone 6 — UI polish

- Integrate into existing Focus navigation.
- Improve timeline.
- Refine loading states.
- Improve error handling.
- Test responsive layout.
- Fix alignment issues.

Acceptance:

The experience feels integrated with Focus, not like a separate prototype.

## Milestone 7 — Stability and regression

- Run existing V2 tests.
- Run Flipbook tests.
- Verify current video effects.
- Verify all new exports.
- Test error recovery.
- Check temporary-file cleanup.
- Run production build.
- Fix regressions.

Acceptance:

Focus V2 and Flipbook both function correctly.

---

# 20. TESTING REQUIREMENTS

Implement meaningful tests.

## Character consistency

Check:

- Frame count.
- Image dimensions.
- Orientation.
- Approximate subject scale.
- Background consistency.
- Mask extraction.
- Frame ordering.

Provide a visual contact sheet for manual review.

## Animation behavior

Check:

- Playback frame timing.
- Frame stepping.
- Correct loop boundary.
- Correct walking-pose ordering.
- Correct root translation.
- Consistent sprite alignment.
- Loop duration.

## Export

Check:

- GIF frame delays.
- MP4 encoding.
- MP4 duration.
- Sprite-sheet dimensions.
- Correct PNG alpha channel when supported.
- Frame-sequence archive contents.

## Failure handling

Test:

- Invalid uploads.
- Corrupt images.
- Missing Meta API key.
- Model timeout.
- Rate limit.
- Inconsistent frame.
- Segmentation failure.
- User cancellation.
- Regeneration failure.
- Export failure.

Do not silently convert a failed generation into a fake successful animation.

## Real API verification

Use deterministic fixtures in automated tests.

Also verify at least one actual Muse Image generation workflow when API credentials are available.

If an external API test cannot run, report it as unverified.

Do not claim a real Meta integration has been tested if only mocks were used.

---

# 21. SUCCESS CRITERIA

The feature is complete only when a user can:

1. Upload an original character illustration.
2. Describe a supported walking animation.
3. Have Muse Spark generate a valid pose plan.
4. Have Muse Image generate distinct character poses.
5. Use reference anchoring to improve visual consistency.
6. Extract usable sprites where necessary.
7. Inspect individual frames.
8. Replace or regenerate a selected frame.
9. Preview a genuinely moving frame-by-frame animation.
10. Loop it without a major discontinuity.
11. Export MP4.
12. Export GIF.
13. Export a sprite sheet.
14. Continue using existing Focus V2 video features.
15. Use the interface without encountering broken controls or hidden simulated functionality.

Do not describe the feature as complete before these requirements are verified.

If the model cannot produce visually acceptable poses for a particular input, provide a clear quality warning and preserve a path for user correction.

Never silently fall back to moving a static image and claim that genuine frame-by-frame animation succeeded.

---

# 22. PRODUCT QUALITY FIRST

This project is intended for the Meta Global AI Developer Hackathon.

However, do not work on the hackathon presentation yet.

Do not create:

- Marketing videos.
- Viral X posts.
- Demo storyboards.
- Pitch slides.
- Landing-page redesigns.
- Social-media assets.
- Promotional animations.

Do not optimize the implementation merely to create a fake impressive demo.

Instead, optimize for:

- Reliable character generation.
- Accurate pose sequences.
- Stable animation.
- Working exports.
- Intuitive editing.
- Clean architecture.
- Minimal API costs.
- No regressions.

A genuinely functional animation tool is more valuable than a polished video showing capabilities the application cannot reproduce.

---

# 23. FINAL ENGINEERING REPORT

When implementation finishes, provide:

1. Repository baseline.
2. Existing components reused.
3. New modules created.
4. Files modified.
5. Character-reference strategy.
6. Pose-generation strategy.
7. Real Meta API calls verified.
8. Frame-consistency test results.
9. Walk-cycle quality assessment.
10. Working export formats.
11. Regression test results.
12. Known limitations.
13. Unfinished features.
14. Recommended next engineering steps.

Do not report success based only on a passing TypeScript build.

Verify that the produced images actually change pose, form a recognizable walk cycle, and export as a working animation.

If this cannot be demonstrated, report the specific blocker and preserve the rest of Focus.

---

# EXECUTION

Start by inspecting the current repository.

Do not rebuild the project.

Do not replace the identity.

Do not implement Reality Portals.

Do not make marketing assets.

Establish the baseline and implement the new feature incrementally.

The first technical milestone must prove this workflow:

**Single character image → Character reference → Eight walking poses → Corrected frame sequence → Playable animation → Real MP4**

Prioritize completing this vertical slice before extending the system.

Once the eight-frame walking cycle is reliable, make the implementation extensible to future animations such as idle, running, jumping, and simple gestures.

Do not implement those additional actions until walking works consistently.

**The objective is to give Focus a genuinely useful, controllable frame-by-frame animation engine while preserving everything that already works.**

Begin with the repository audit, then implement the product.