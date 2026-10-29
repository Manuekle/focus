# Flipbook-led landing

Direction approved by the user on 2026-10-29, with explicit authorization to implement. Updated with the user's supplied Reze illustration and video, request for a simpler cute presentation using the app's design system, and instruction to preserve the original published background and premium badge. Scope: the landing and a written proposal for a future subject-effects editor.

## Purpose

Make Focus Flipbook the first thing a creator understands and opens. The existing landing promotes video effects and puts Flipbook in a secondary navigation link. Replace that hierarchy with an illustration-to-animation demonstration and one primary creation action.

## Direction and alternatives

Chosen: a Flipbook-led hero, a real interactive sample, a short illustration → movement → export explanation, followed by existing video capabilities and an explicitly labelled future-editor concept. A balanced split between animation and video was considered but dilutes the requested priority. Separate product home pages would add navigation without improving this first visit.

Preserve the published landing's exact radial-gradient background, grain, soft heading light, gradient display text and original shimmering rotating badge. Keep Focus's cat mark and Porky's for all landing titles. New content uses the studio's controls and shared Button and Badge components. The signature is the supplied Reze illustration beside the supplied dance reference, with a small curved arrow and a circular frame carousel. Use a centered, quiet composition with no simulated editor chrome. Media and individual frame cards use the original comparison demo's glass finish; the carousel floats directly over the landing background with no enclosing card. Secondary CTAs use the primary button's existing stroke and inner-light treatment with charcoal color variables scoped to the landing.

## Landing

- Hero: “Your drawings. In motion.” Supporting copy names the starting illustration, described movement and control over individual drawings.
- Primary action: “Create a flipbook” to `/flipbook` when the compiled feature flag permits it. When disabled, “Explore flipbook” anchors to its local demonstration; no link to a disabled route.
- Secondary action: “Explore video effects” anchors to the existing video section.
- Demo: optimized public copies of the exact illustration and MOV supplied by the user. Remove only the recording's black bars and transcode an H.264 preview with its original audio retained as AAC. Remove the visible “Motion reference” label at the user's request; do not claim the supplied video is a verified Focus generation. No private API URL, account ID, source-file metadata or live generation request is used.
- Controls: circular glass play/pause on hover or keyboard focus (always reachable on touch), a sound toggle and eight extracted frames in a circular focus carousel. The current frame is large and sharp; two neighbors on either side progressively shrink, fade and blur toward transparent edges. Support drag/swipe, previous/next, arrow keys and Home/End. Manual selection pauses and seeks the video; keyboard focus pauses autoplay. Remove the old “Every little move” label, time counter and scrubber. Announce only manual selection, never playback progress. Muted autoplay respects browser policy; enabling sound or manually playing activates the original audio after a user gesture. Playback stops offscreen, while the document is hidden and for reduced motion. Playback must work for media already decoded before React hydrates.
- Explanation: upload a character, describe its movement, review drawings and export. List only supported output formats: MP4, GIF, sprite sheet and PNG frames.
- Video effects: retain the existing real comparison demo and upload/composer journey, including draft restoration through `?v=...` and sign-in.
- Future editor: a separate “In exploration” concept explains choosing a detected subject and applying glitch or distortion. No active control claims these effects are available.

## Boundaries and verification

Limit source changes to landing composition, its sample assets/components, metadata and affected landing expectations. Preserve ongoing changes in editor/animation code and public character assets. No hosting migration, deployment, paid AI calls or changes to feature flags.

Verify TypeScript, lint for changed source, the production build, existing unit tests where relevant, and browser behavior at desktop and 320px. Check primary/secondary destinations, frame changes, pause/resume, reduced motion, no overflow, working video upload, and truthful future-feature labelling.
