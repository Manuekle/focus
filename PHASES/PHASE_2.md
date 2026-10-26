# FOCUS — PHASE 2: REAL META AI INTEGRATION & VIDEO TRACKING

Continue developing Focus inside the existing repository.

The application foundation and visual identity already exist. Preserve them completely.

Your objective is to implement a genuinely functioning AI video-understanding and segmentation pipeline.

Do not redesign the application.

Do not recreate existing components.

Do not fake AI results.

## 1. Required Meta models

Use Meta Model API.

Base URL:

`https://api.meta.ai/v1`

Environment variable:

`MODEL_API_KEY`

Required models:

- `muse-spark-1.3`
- `sam-3.1`

Use the official API and currently documented request formats.

Official documentation:

- https://dev.meta.ai/docs/quickstart
- https://dev.meta.ai/docs/sam/overview
- https://dev.meta.ai/docs/sam/segmenting
- https://dev.meta.ai/docs/sam/client-libraries

Read these references before implementing the integration.

Do not invent API functions or response structures.

Use `openai` with a custom Meta base URL where supported.

Ensure the API key is only available on the server.

## 2. Core responsibility separation

**Muse Spark = understanding and planning.**

**SAM 3.1 = segmentation and object tracking.**

**Focus compositor = deterministic video effects.**

Do not pretend that SAM understands complicated video-editing commands.

SAM must receive concrete object prompts or documented point/box prompts.

## 3. User instruction interpretation

A user can write instructions such as:

"Keep the skateboarder in color."

"Blur everything except the dog."

"Make the red car stand out."

"Create a frame-breaking effect with the dancer."

"Add motion trails to the runner."

Muse Spark must interpret these instructions into a restricted, validated edit plan.

Suggested schema:

```ts
type EditPlan = {
  target: {
    concept: string;
    selection: "single" | "all";
    description?: string;
  };
  effect:
    | "selective_color"
    | "background_blur"
    | "break_frame"
    | "motion_echo";
  parameters: {
    intensity?: number;
    trailCount?: number;
    trailSpacingMs?: number;
  };
  needsClarification: boolean;
  clarificationQuestion?: string;
};
```

Use Zod.

The response must be constrained to the supported effects.

Reject unsupported editing operations with a clear message.

The model must never generate executable shell commands, arbitrary code, file paths, or unrestricted FFmpeg arguments.

Do not trust AI-generated parameters without validation.

## 4. Video preparation

Accept short MP4 files and MOV files only if reliable normalization is supported.

MVP limits:

- 10-second maximum.
- 50 MB maximum upload.
- Maximum normalized resolution around 720p.
- 24 FPS constant frame rate.
- H.264 output.
- Preserved aspect ratio.
- Correct video orientation.

Use FFprobe to validate the actual media.

Use FFmpeg to normalize the source before segmentation.

IMPORTANT:

The normalized video submitted to SAM must use exactly the same frame dimensions, orientation, frame rate, and frame indexing as the compositor.

Never segment one version and render another independently.

This avoids mask drift.

## 5. SAM segmentation

Use the Meta Files API to upload the normalized video when appropriate.

Upload with purpose:

`user_data`

Reference its returned file ID through an `input_video` media part.

Use SAM's Responses API.

Prefer streaming segmentation for video.

For simple concept-based prompts:

- Send a short noun phrase.
- One concept per request.
- Do not send complete editing instructions.
- Do not combine multiple noun phrases into an unsupported concept prompt.

Examples:

Correct:
`red bicycle`

Incorrect:
`find the bicycle, blur the background, remove the people, and make it cinematic`

Use the official `@meta-sam/parser` package.

Prefer:

- `parseVideoStream`
- `recordsOfKind`
- `decodeMaskToRaster`
- `buildObjectPrompt`

Use these only according to their documented contracts and installed versions.

SAM returns segmentation data in a special-token grammar; do not assume its output is regular JSON.

Handle every streamed frame by its source frame index.

Do not assume that all records arrive in chronological order.

## 6. Tracking data model

Create a consistent representation for segmentation results.

Each frame record should contain:

- Frame index.
- Frame timestamp.
- Source dimensions.
- Object identity.
- Object bounding box.
- Segmentation mask.
- Optional confidence.
- Completion/diagnostic information.

Object identities must remain stable across the clip.

Allow multiple objects to be identified.

Do not automatically select the first object when several matching subjects exist and the selection is ambiguous.

## 7. Object selection

Build an interactive object-selection interface.

When there is more than one matching object:

- Render detected objects over the video.
- Show bounding boxes or mask overlays.
- Allow the user to click the desired object.
- Clearly indicate the selection.
- Allow selecting all matching instances when appropriate.

When the user clicks a point in the preview, convert the position to actual source-video pixel coordinates.

Handle CSS scaling, `object-fit`, letterboxing, and orientation correctly.

Use documented SAM point or box prompting when a new segmentation pass is necessary.

Do not assume a click selection always requires another paid API call if an existing object mask already identifies the chosen subject.

## 8. Diagnostic segmentation viewer

Implement a temporary developer-facing segmentation inspection mode.

This is important for debugging and the hackathon demonstration.

Display:

- Original video.
- Transparent segmentation mask overlay.
- Object bounding boxes.
- Object IDs.
- Current frame index.
- Segmentation status.
- Mask availability.

The overlay must follow the real video frames.

Use accurate frame synchronization.

Expose this through a developer mode or compact "View tracking" control.

Do not turn the main application into a technical dashboard.

## 9. Job lifecycle

Implement a simple processing job system.

Suggested states:

- uploaded
- validating
- preparing
- interpreting
- segmenting
- awaiting_selection
- ready_to_render
- rendering
- completed
- failed
- canceled

Store job information safely.

For local development, a lightweight filesystem-backed or memory-based job manager is acceptable.

Use per-job temporary directories.

Handle process crashes and aborted requests.

Implement cleanup.

Never expose private server filesystem paths.

Limit concurrent expensive operations.

## 10. API cost protection

Meta credits are limited.

Implement:

- Request deduplication.
- Segmentation-result reuse.
- Maximum clip duration.
- Maximum video size.
- Concurrency limits.
- Explicit user-triggered processing.
- Bounded retries.
- Useful API errors.
- Basic usage diagnostics.

When the user only changes an effect's intensity, reuse existing segmentation masks.

Do not call SAM again for every UI adjustment.

Never make unnecessary paid requests in automated tests.

## 11. Testing

Create deterministic tests for:

- Instruction interpretation parsing.
- Unsupported prompts.
- Video normalization.
- Video metadata.
- SAM stream parsing.
- Empty segmentation responses.
- Multiple detected objects.
- Missing frames.
- Out-of-order frame records.
- Coordinate conversion.
- Job cancellation.
- Retry handling.

Use recorded fixtures for unit and integration tests.

Run at least one live Meta API test when credentials are available.

If credentials are missing or the API fails, do not fake success.

Record exactly what was and was not verified.

## 12. Definition of done

The user can:

1. Upload a real video.
2. Enter an editing instruction.
3. Have Muse Spark interpret it.
4. Have SAM 3.1 find the intended object.
5. See real tracking masks across the moving video.
6. Choose among multiple objects.
7. Reuse the segmentation result for subsequent editing.

This phase does not require all effects to be completed yet.

The essential outcome is a reliable AI segmentation engine.

## 13. Execution instructions

Inspect the current implementation before modifying it.

Implement the complete integration.

Run local tests.

Fix compilation errors.

Verify correct frame-mask alignment with real video.

Preserve the visual identity.

Commit nothing automatically unless the repository workflow explicitly requires it.

At completion, describe:

- Files changed.
- Actual API integrations.
- API tests performed.
- Successful and failed cases.
- Known limitations.

**Start implementing the real Meta AI pipeline now.**