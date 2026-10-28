# My characters

`/characters`, enabled by `NEXT_PUBLIC_ENABLE_FLIPBOOK=true`, uses the existing Focus account. Its entry point is also available in Flipbook's sidebar and empty state.

Start with **Elf-chan**, using `public/characters/elf-chan.png`, or upload a PNG, JPEG or WebP reference. Creating a character saves the original; it does not call a model. **Create design** generates one full-body image. **Generate change** edits the selected version. Every generation includes the immutable original for face, hair, eyes, ears and style; the selected version determines the current outfit. Outfit and style supporting images have explicit, narrower roles. There are at most three references.

Each successful image becomes an immutable version. Names and the selected version can change. Selecting, comparing, renaming and downloading do not call AI. Failed or interrupted work keeps the last valid version and the attempted instruction. Generation requests use operation IDs, so a duplicate submission does not pay twice. Work is counted in the global active-work cap. `FOCUS_CHARACTER_IMAGE_BUDGET` defaults to 16 attempts per character; clearly unbilled refusals are returned to the allowance, while uncertain timeout outcomes remain counted. Up to 32 versions are supported.

`server/characters/` owns validated state and images under `<FOCUS_DATA_DIR>/characters/`. This data does not expire with temporary Flipbook uploads. Writes are atomic; jobs and locks share process-wide state, following the single-container architecture of the rest of Focus. An interrupted process reports the interrupted generation instead of showing an endless spinner. A queued request whose response was lost can be replayed with the same operation ID.

**Use in Flipbook** opens the exact selected version with no generation or temporary re-upload. Only **Create animation** begins the existing analysis and pose pipeline. The new animation copies both the selected design and the original identity image. Its saved `characterSource` records character, version and their names; later character edits or renames do not modify that snapshot. The original identity portrait is included in every pose generation and reference preparation, separately from the selected outfit. A link returns from the animation to its character.

**Animate together** (`/flipbook?together=1`) draws two to four saved characters in one scene, for 1–6 seconds, at 8 drawings per second: a fight, a dance, a chase. Each character is drawn from its selected version, copied into the animation, and only its owner can open it. See [Scenes](FLIPBOOK.md#scenes-several-characters-together).

Characters, references and generated images require their owner's session. Character-derived Flipbook data, actions and media also enforce ownership. The older anonymous upload workflow retains its existing UUID capability URLs. The video editor's existing account and media model is unchanged.

The studio uses existing Focus components and typography. The illustration remains visible during generation; a status message describes actual work instead of a fabricated percentage. Mobile puts the image before controls and omits the desktop library sidebar. Comparison shows two contained images with a shared stage. Fields have visible labels, version buttons expose their selected state, and controls have visible keyboard focus.

The feature uses Muse Image for initial generation and editing; Muse Spark and SAM remain part of Flipbook's existing animation pipeline. It adds no model provider, database, browser agent or automatic source search.

## Camera views

The character generator preserves the reference's camera unless a change is requested. Elf-chan starts facing the camera. Flipbook offers **Keep original view**, **Front**, **Three-quarter**, **Side profile**, **Back**, **From above** and **From below**. Screen movement is independent of the camera; choosing rightward travel does not turn a frontal character into a profile. The view is persisted in the animation plan and used for reference preparation, every drawing, repairs, background perspective and review. Complete frontal references can be used directly.

The internal anatomy guides match the selected view. A view without matching guides, such as the back, uses the textual phase mechanics; it never substitutes a profile mannequin. Frontal and rear strides do not use the side-view stride estimator. Idle loops preserve the reference's resting posture when no catalog posture is selected. Wave prompts keep the same arm throughout the sequence.

These are fixed-camera animation cycles. They do not add a 3D rig or a continuous camera orbit. The model still needs visual review, especially for hands, asymmetric details and newly inferred views.

## Verification

Offline tests in `server/characters/` use the supplied Elf-chan reference with replaced paid services. They cover ownership, original-reference continuity, immutable versions, comparison/selection without generation, failed and interrupted jobs, budgets, duplicate requests, supporting-reference limits, HTTP origin checks, private media and the independent Flipbook copy. `server/animation/access.test.ts` checks private derived animations and compatibility with anonymous uploads.

The manual live test uses Elf-chan for the initial design, a green-coat edit, a front-facing version and Wave animations. Details and remaining visual limits are recorded in [the delivery report](MY_CHARACTERS_VALIDATION_2026-10-27.md).
