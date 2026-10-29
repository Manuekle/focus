# Animation continuity

Approved in chat: detailed planning and drawing instructions, bounding key poses for continuous sequences, and warnings when a practically unchanged drawing is held for more than 125 ms (three ticks at 24 fps). Approved drawings and previous versions remain preserved. Fixes use the existing explicit, budgeted repair action.

## Reference analysis

The supplied recording is 16.29 seconds, 828 × 1792, HEVC, with 512 captured video frames and variable presentation timing. The 60 fps nominal rate is not its average captured rate and cannot establish the animation's original exposure sheet.

Consecutive samples around 2–3 seconds show brief held drawings followed by coherent arm, torso and weight changes. Face, hair, outfit, proportions, camera and ground remain consistent. Supporting feet stay planted until weight transfers; body tilt and hip movement relate to arm gestures. Movement does not require changing every stationary contour. Some apparent holds in this recording exceed 125 ms; its timing is evidence, not the requested upper limit.

## Implementation

1. Share continuity requirements between cycle, sequence and ensemble planning and every drawing path, including repair and in-between generation. Describe support/contact, joint trajectories, stable anatomy, left/right identity, overlapping follow-through and immutable appearance. Include neighboring planned poses with each generated drawing. References supply only their assigned roles; hidden anatomy is not grounds for invention.
2. For continuous sequences, generate sparse key drawings first and then bracket every intermediate with its two surrounding keys. Retain the specialized wave reversal keys. Other sequences use keys no farther than about 250 ms apart. A video reference remains available at the intermediate's exact timestamp. Reordering generation adds no image requests.
3. Compare visible sprite pixels, including internal details, at their planned timestamps. Allow a changed pose or subtle visible motion. Flag only drawings that extend a practically unchanged pose beyond 125 ms, allowing a full three-tick hold at 24 fps. Do not bridge missing drawings or compare the end of a finite clip to its start. Use elapsed time rather than MP4 frame duplication. Use the exposure sheet for legacy key timing. Distinguish repeated poses (`overlong_hold`) from a single exposure over 125 ms (`exposure_too_long`): the latter requires in-betweens or a cadence adjustment and is excluded from image-only bulk repair. When in-betweens are present, key-only timing is not enough to infer their exposure.
4. Keep automatic checks as warnings, routed to the existing Fix all action. Pixel checks do not certify anatomy or prevent every generative error. AI review receives continuity criteria and must report only visible evidence. No automatic paid regeneration loop.

## Validation

Use synthetic sprites to test 8/12/24 fps hold boundaries, 125 ms inclusive, missing samples, internal movement with an unchanged silhouette, and cumulative movement. Verify all image request paths carry continuity instructions, video-guided intermediates retain the reference, and generic sequences generate bounding keys before intermediates. Run existing planning, drawing, sequence and shared-schema regressions, typecheck, lint and production build.
