# Flipbook-led landing

Direction approved by the user on 2026-10-29, with explicit authorization to implement. Scope: the landing and a written proposal for a future subject-effects editor.

## Purpose

Make Focus Flipbook the first thing a creator understands and opens. The existing landing promotes video effects and puts Flipbook in a secondary navigation link. Replace that hierarchy with an illustration-to-animation demonstration and one primary creation action.

## Direction and alternatives

Chosen: a Flipbook-led hero, a real interactive sample, a short illustration → movement → export explanation, followed by existing video capabilities and an explicitly labelled future-editor concept. A balanced split between animation and video was considered but dilutes the requested priority. Separate product home pages would add navigation without improving this first visit.

Preserve Focus's dark blue palette, cat mark, Porky's display type and Inter body. Tokens: ink #101219, panel #171b29, blue #6385fe, pale blue #b6c9ff, paper #f3f5fa, muted #a5adbf. The signature is an actual sequence of generated drawings that can be played or inspected, rather than a decorative video-editor mockup.

## Landing

- Hero: “Your drawings. In motion.” Supporting copy names the starting illustration, described movement and control over individual drawings.
- Primary action: “Create a flipbook” to `/flipbook` when the compiled feature flag permits it. When disabled, “Explore flipbook” anchors to its local demonstration; no link to a disabled route.
- Secondary action: “Explore video effects” anchors to the existing video section.
- Demo: static, optimized public copies of an existing Focus sample. The original illustration and eight generated key drawings show the real transformation. No private API URL, account ID, user metadata or live generation request is used. The sample is explicitly a loop, not a claim about continuous-sequence quality.
- Controls: play/pause, native labelled frame slider and frame buttons. Manual inspection pauses playback. Autoplay stops offscreen, while the document is hidden and for reduced motion. Playback has no live region announcing every frame.
- Explanation: upload a character, describe its movement, review drawings and export. List only supported output formats: MP4, GIF, sprite sheet and PNG frames.
- Video effects: retain the existing real comparison demo and upload/composer journey, including draft restoration through `?v=...` and sign-in.
- Future editor: a separate “In exploration” concept explains choosing a detected subject and applying glitch or distortion. No active control claims these effects are available.

## Boundaries and verification

Limit source changes to landing composition, its sample assets/components, metadata and affected landing expectations. Preserve ongoing changes in editor/animation code and public character assets. No hosting migration, deployment, paid AI calls or changes to feature flags.

Verify TypeScript, lint for changed source, the production build, existing unit tests where relevant, and browser behavior at desktop and 320px. Check primary/secondary destinations, frame changes, pause/resume, reduced motion, no overflow, working video upload, and truthful future-feature labelling.
