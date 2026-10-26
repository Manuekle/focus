# FOCUS — PHASE 4: PREMIUM PRODUCT EXPERIENCE & INTERACTION POLISH

You are now acting as the principal product designer, interaction engineer, and frontend quality lead for Focus.

The real Meta AI and video-editing engines already exist.

Your mission is to turn the current implementation into a remarkably polished, intuitive creative application without breaking functionality.

**The project already contains its own visual identity. Do not redesign the brand.**

## 1. Audit before modifying

Read the current source code and `docs/DESIGN_SYSTEM.md`.

Inspect the actual logos, colors, typography, components, and motion conventions.

Preserve existing design decisions.

Do not introduce a new color palette or a different visual identity.

If the current interface already solves a requirement well, leave it alone.

Avoid making arbitrary changes merely to produce more code.

## 2. Product experience

Focus should feel like an extremely refined creative application.

The editing workflow should be effortless:

**Drop a video. Describe an effect. See the transformation. Export.**

No onboarding maze.

No complex sidebar navigation.

No generic AI chatbot layout.

No marketing-heavy dashboard.

No excessive controls.

The video must remain the center of attention.

## 3. Empty state

Design a beautiful, functional initial screen.

Required elements:

- Existing Focus logo.
- Product tagline.
- One clear video upload area.
- Natural-language prompt input.
- Three concise effect examples.
- Minimal supporting information.

Suggested copy:

Heading:
"Make anything stand out."

Supporting text:
"Create impossible-looking video effects with a single sentence."

Upload label:
"Drop your video here"

Secondary label:
"Or browse files"

Show the actual supported file constraints.

Do not claim that unsupported formats or effects work.

Use the actual brand typography and design tokens.

## 4. Video workspace

After upload, reveal the editing workspace.

The workspace should include:

### Video stage

- Correctly scaled video.
- Play/pause.
- Seek.
- Time indicator.
- Mute/unmute when audio exists.
- Original/edited comparison.
- Object tracking overlays when enabled.

### Prompt composer

A prominent editing field.

Placeholder:

"What would you like to change?"

Provide intelligent examples based on the supported effects.

Submit with an intentional primary action.

Use Enter to submit only when appropriate and without conflicting with multiline editing.

### Effect selection

Offer:

- Reality Shift.
- Break the Frame.
- Motion Echo.

Use compact controls.

Communicate what each effect does through concise descriptions.

Do not create a large visual catalog that pushes the actual video below the fold.

### Parameter controls

Reveal only parameters relevant to the selected effect.

For example:

Reality Shift:
- Grayscale / blur.
- Blur intensity when applicable.

Break the Frame:
- Composition framing.

Motion Echo:
- Trail count.
- Trail spacing.
- Intensity.

Do not show irrelevant controls.

### Export

Make the export action clear.

Disable it appropriately until a valid rendered output exists.

Provide real progress.

Do not show a fake success state.

## 5. Processing feedback

Replace generic loading spinners with meaningful states.

Use real job progress.

Possible stages:

- Preparing video.
- Understanding your edit.
- Finding the subject.
- Tracking the motion.
- Applying the effect.
- Encoding MP4.
- Finished.

Use actual stage completion signals.

Do not animate progress percentages independently of processing.

Do not fabricate time estimates.

If cancellation is supported, ensure it actually terminates the work.

If retry is supported, ensure it creates or resumes a valid job safely.

## 6. Interactions

Every interactive element must have a meaningful behavior.

Audit:

- Click.
- Hover.
- Keyboard.
- Touch.
- Focus.
- Disabled.
- Loading.
- Success.
- Error.
- Cancel.
- Retry.

No dead buttons.

No fake settings.

No controls that only change local labels without affecting the video.

### Motion principles

Use restrained, purposeful motion.

Animation should clarify:

- State changes.
- Spatial relationships.
- Entry and exit.
- Selection.
- Feedback.
- Content replacement.

Prefer transform and opacity for simple transitions.

Avoid large layout animations that cause neighboring components to jump.

Use spring motion where it improves direct manipulation.

No continuous decorative animation.

No animation merely because a component mounted.

Avoid flicker and competing transitions.

All important animations should respect `prefers-reduced-motion`.

### Transitions

Refine transitions between:

- Empty and uploaded.
- Uploaded and processing.
- Processing and result.
- Original and edited.
- Effect selection.
- Expanded and collapsed controls.
- Object selection.
- Exporting and completed.

Keep controls spatially consistent.

Preserve focus when dialogs or panels close.

Avoid focus loss during asynchronous state updates.

Do not unmount the video player unnecessarily when only effect controls change.

## 7. Video comparison

Make comparison a standout interaction.

Provide:

- A precise before/after slider where technically appropriate.
- Original and edited labels.
- A shared playback state.
- No time drift.
- No flickering.
- Smooth pointer tracking.
- Touch support.
- Keyboard accessibility.

If the comparison slider is unreliable, replace it with a stable before/after toggle.

Functionality is more important than novelty.

## 8. Responsive quality

Desktop is the primary demo platform.

Optimize the interface for laptop screens.

The entire essential workflow should be understandable without excessive scrolling.

For mobile:

- Stack editing controls.
- Keep the video prominent.
- Support touch interaction.
- Avoid horizontal overflow.
- Keep the export action accessible.
- Respect safe areas when appropriate.

Test realistic browser widths.

Do not just resize the desktop layout.

## 9. Empty, error, and edge states

Polish every state.

Examples:

- No video uploaded.
- Unsupported file.
- Video too long.
- Corrupted video.
- Missing API configuration.
- No objects detected.
- Multiple objects detected.
- AI request timed out.
- Processing failed.
- Export failed.
- Job canceled.
- Download completed.
- Network disconnected.

Use understandable product copy.

Do not expose raw stack traces in user-facing UI.

Preserve useful diagnostic information for development.

## 10. Accessibility

Implement:

- Semantic HTML.
- Accessible labels.
- Visible keyboard focus.
- Proper contrast.
- Screen-reader-friendly status updates.
- Keyboard-operable dialogs.
- Keyboard-operable comparison controls.
- Reduced-motion support.
- Reasonable touch targets.

Accessibility is part of quality, not optional polish.

## 11. Visual QA

Inspect the application in an actual browser where available.

Check:

- Typography.
- Consistent spacing.
- Borders.
- Radii.
- Surface hierarchy.
- Alignment.
- Video scaling.
- Animation continuity.
- Responsive behavior.
- Dialog positioning.
- Loading transitions.
- Hover states.
- Empty states.
- Export controls.

Compare implementation with the existing design references.

Fix visual regressions.

Do not replace the brand identity with generic aesthetics.

## 12. Performance

Minimize unnecessary React re-renders.

Avoid recreating player instances unnecessarily.

Throttle high-frequency pointer updates when appropriate.

Memoize expensive computations only where justified.

Avoid oversized dependencies.

Keep page transitions and interactions responsive.

Ensure media-processing tasks do not block the main browser thread.

## 13. Acceptance criteria

The UI must:

- Match the existing Focus identity.
- Feel coherent and professionally designed.
- Guide users through the full workflow.
- Have working interactions.
- Show truthful processing states.
- Support all completed effects.
- Allow real video export.
- Work on desktop and mobile.
- Pass accessibility checks.
- Respect reduced motion.
- Avoid visual and interaction regressions.

Run the application and verify these behaviors.

**Your goal is not to add more UI. Your goal is to make every existing interaction excellent.**