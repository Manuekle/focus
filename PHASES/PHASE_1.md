# FOCUS — PHASE 1: PROJECT DISCOVERY, DESIGN SYSTEM & FOUNDATION

You are the founding engineer, creative technologist, senior product designer, and technical lead of Focus, an AI-powered cinematic video editor.

Your mission is to inspect the existing project folder, preserve its visual identity, establish a clean architecture, and build the real application foundation.

**IMPORTANT: This folder already contains the visual identity of Focus. You must discover and reuse it. Do not create a different brand.**

## 1. Non-negotiable rules

1. Inspect the current repository before changing anything.
2. Do not initialize a new application if a project already exists.
3. Never delete, replace, or overwrite existing brand assets without a specific technical need.
4. Never invent alternative brand colors, logos, or typography when these already exist.
5. Never replace custom components with generic shadcn defaults simply because they are faster to generate.
6. Reuse the current brand's aesthetic, visual language, assets, and design decisions.
7. Preserve all existing working functionality.
8. Avoid modifying unrelated files.
9. Do not run destructive cleanup commands.
10. Do not create empty mock interfaces and describe them as complete.

The existing repository is the source of truth.

## 2. First: inspect the complete project

Before implementation, examine:

- Current working directory.
- Git status and recent commits, if available.
- Package manager and framework.
- Existing `src`, `app`, `components`, `public`, `assets`, `styles`, and design directories.
- Logos and icons.
- SVG illustrations.
- Brand colors.
- Typography and font configuration.
- CSS variables and design tokens.
- Light and dark theme rules.
- Existing UI primitives.
- Animations and transition conventions.
- Screenshots, Figma references, and design documentation.
- Any existing application architecture.
- Any existing API or video-processing code.

Search for possible brand-reference files regardless of their names.

Identify what already exists and what is missing.

If the repository contains unrelated experiments, do not incorporate them automatically.

## 3. Visual identity preservation

Create `docs/DESIGN_SYSTEM.md`.

Document the actual identity found in the project:

- Brand name.
- Logo variants.
- Color palette.
- Typography.
- Iconography.
- Border styles.
- Corner radii.
- Layout principles.
- Surface hierarchy.
- Spacing conventions.
- Motion behavior.
- Light/dark variants if available.
- Existing reusable components.

Use actual values discovered in the repository.

Do not fabricate missing information.

If an asset is missing, record that it is missing. Do not generate a replacement unless implementation genuinely requires it.

Do not copy existing brand assets to different locations without reason.

If an existing asset is technically broken, explain the defect before modifying it.

## 4. Product definition

Focus is an AI-powered video editor.

Tagline:

"Make anything stand out."

The product allows users to upload a short video, describe a visual change using natural language, and produce a new video using Meta AI.

Core flow:

Upload → Describe → Identify → Track → Transform → Preview → Export

The application will have three creative effects:

**Reality Shift**
Selective color and background blur using AI segmentation.

**Break the Frame**
A cinematic depth effect where the selected subject visually extends beyond an inner video frame.

**Motion Echo**
Multiple temporal silhouettes of a moving subject, creating a cinematic motion-trail effect.

The first complete effect must be Reality Shift because it establishes the reusable segmentation and rendering engine.

Break the Frame is the flagship visual feature for the public demo.

Motion Echo comes after the other effects work.

Do not attempt to develop all effects before the basic video pipeline is functional.

## 5. Technical foundation

Preferred stack, unless the existing project has a compatible architecture that should be preserved:

- Next.js 16.
- React 19.
- TypeScript strict.
- Tailwind CSS 4.
- Node.js 24.
- pnpm.
- Motion for React, only where useful.
- Lucide React, unless the visual identity already contains a custom icon system.
- FFmpeg and FFprobe.
- Sharp for server-side image compositing where suitable.
- Zod for runtime validation.
- Vitest for unit tests.
- Playwright for E2E tests.

Use the existing project dependencies when possible.

Avoid unnecessary infrastructure.

For the MVP:

- No login.
- No database unless technically essential.
- No subscriptions.
- No multi-user projects.
- No complex SaaS infrastructure.
- No analytics dashboards.
- No unnecessary marketing pages.

This is a focused creative tool, not an enterprise platform.

## 6. UX architecture

Build around a single workspace.

Required states:

### Empty state

The user sees the brand, a video upload area, and the primary editing interaction.

### Uploaded state

The user sees the video, editing prompt, and available effects.

### Processing state

The user sees real task progress, the current processing stage, and appropriate cancel/retry controls.

### Result state

The user sees an actual edited video, comparison controls, and the MP4 export action.

### Error state

The user receives a meaningful, actionable explanation.

Avoid unnecessary route changes.

The experience must feel fast, responsive, and intentional.

## 7. Interface design requirements

Use the existing Focus identity.

Aim for:

- Elegant editorial composition.
- Precise spacing.
- Exceptional typography.
- Strong visual hierarchy.
- Clean video-player layout.
- Restrained motion.
- Carefully designed empty states.
- Minimal visual noise.
- Premium interactions.

Do not introduce:

- Generic gradients.
- Random glassmorphism.
- Overly colorful cards.
- Excessive shadows.
- Decorative 3D elements.
- Unnecessary iconography.
- Generic AI chatbot interfaces.
- Unrequested mascots.
- Stock illustrations.
- Arbitrary font combinations.

If the existing identity deliberately uses any of these styles, preserve the established design rather than applying blanket restrictions.

The video must be the visual centerpiece.

## 8. Implementation tasks

1. Audit the repository.
2. Record an inventory of important brand and application files.
3. Document the existing design system.
4. Check the project's build and TypeScript status.
5. Establish the necessary application architecture.
6. Build or refine the application shell using existing brand components.
7. Implement functional video upload and validation.
8. Implement a working original-video preview.
9. Create shared schemas for editing operations.
10. Prepare clean interfaces for the Meta AI and video-processing services.
11. Ensure all new components are responsive.
12. Run the application locally and verify the interface.

For this phase, real video uploading and playback must work.

The AI processing itself belongs to the next phase.

Do not show AI-generated results unless real processing exists.

## 9. Acceptance criteria

This phase is complete only when:

- Existing assets have been preserved.
- The design system has been documented from real repository evidence.
- The application runs locally.
- TypeScript passes.
- The upload works.
- Video validation works.
- Video playback works.
- The interface matches the existing visual identity.
- The foundation supports real Meta AI processing.
- No unrelated files were damaged.

## 10. Final report

When finished, report:

1. What you found in the repository.
2. Which identity assets and components were reused.
3. Which files were created or modified.
4. Which commands and tests were executed.
5. What works.
6. What remains incomplete.
7. Any technical blockers.

Do not claim that AI editing works until it has actually been integrated and tested.

**Start by inspecting the current folder. Then implement this phase completely.**