# FOCUS — PHASE 5: FINAL ENGINEERING AUDIT, PRODUCTION & HACKATHON READINESS

You are the principal QA engineer, security reviewer, performance engineer, and release manager of Focus.

The application has an existing visual identity, a Meta AI integration, and a video-editing engine.

Your responsibility is to verify the entire system, fix defects, and prepare a reliable public release.

Do not add major new features.

Do not redesign the interface.

Do not replace working implementations without evidence of a defect.

## 1. Full repository audit

Inspect the entire codebase.

Identify:

- Broken functionality.
- Incomplete implementations.
- TypeScript errors.
- Missing error handling.
- Unsafe API routes.
- Video synchronization issues.
- Memory leaks.
- Unbounded processing.
- Temporary file leaks.
- Broken download flows.
- Exposed credentials.
- Dead UI controls.
- Fake loading states.
- Unused dependencies.
- Duplicate code.
- Unnecessary abstractions.

Prioritize bugs that affect the end-to-end video-editing workflow.

## 2. Critical end-to-end test

Test the following real user journey:

1. Open Focus.
2. Upload a supported video.
3. Confirm correct video playback.
4. Enter an editing instruction.
5. Send the instruction to Muse Spark.
6. Receive a validated edit plan.
7. Send the video to SAM 3.1.
8. Receive frame-indexed segmentation masks.
9. Select the correct object if necessary.
10. Apply Reality Shift.
11. Preview the actual result.
12. Export MP4.
13. Open the exported MP4.
14. Verify that the entire video contains the edit.

Repeat the relevant steps for Break the Frame and Motion Echo.

Use real API requests whenever valid credentials and sufficient credits are available.

Do not confuse fixture-based tests with live integration tests.

## 3. Video export verification

Verify:

- Correct duration.
- Correct dimensions.
- Correct aspect ratio.
- Correct frame rate.
- Correct pixel format.
- Correct object masks.
- Stable video playback.
- Audio synchronization.
- No unexpected blank frames.
- No broken first or last frame.
- Valid MP4 encoding.
- Successful download.

Use FFprobe for technical checks.

Inspect actual rendered frames for visual correctness.

Compare selected frames against expected mask geometry.

## 4. Edge-case testing

Test:

- Portrait videos.
- Landscape videos.
- Square videos.
- Silent videos.
- Videos with audio.
- Moving subjects.
- Partially occluded subjects.
- Multiple similar objects.
- Static-camera clips.
- Camera movement.
- Objects temporarily leaving the frame.
- No matching object.
- Unsupported instructions.
- Invalid uploads.
- Network interruption.
- Failed Meta requests.
- Job cancellation.
- Repeated exports.

Do not silently conceal unsupported edge cases.

Clearly document known limitations.

## 5. API security

Verify:

- `MODEL_API_KEY` never reaches the browser.
- No `.env` files are committed.
- Uploaded files are validated.
- Filename/path traversal is prevented.
- Maximum file size is enforced.
- Maximum video duration is enforced.
- Requests have safe timeouts.
- Concurrent AI jobs are bounded.
- FFmpeg commands do not allow shell injection.
- Processing failures clean up resources.
- Temporary media expires.
- API routes have reasonable abuse protection.

For a public hackathon deployment, prevent unlimited anonymous requests from consuming all Meta credits.

Implement practical safeguards, such as:

- Global concurrency limits.
- Per-client rate limits where feasible.
- Maximum pending jobs.
- Bounded processing duration.
- A configurable processing budget or emergency disable switch.

Never log private API keys.

## 6. Performance audit

Measure actual timings for:

- Upload.
- Normalization.
- Muse Spark interpretation.
- SAM segmentation.
- Frame rendering.
- MP4 encoding.
- End-to-end completion.

Identify the slowest stages.

Optimize only bottlenecks supported by measurements.

Avoid repeated segmentation when a cached result can be reused safely.

Ensure one user's job cannot monopolize the entire instance indefinitely.

## 7. Deployment

Prepare a Docker-based deployment.

The runtime must support:

- Node.js.
- FFmpeg.
- FFprobe.
- Native dependencies.
- Temporary file storage.
- Long-running video-processing jobs.
- Secure environment variables.

Avoid relying on restrictive serverless execution limits for full video processing.

Document the resource requirements.

A single-container deployment is acceptable for the MVP.

If production jobs require a persistent worker, implement the smallest reliable architecture.

Do not introduce Kubernetes, complex microservices, or distributed infrastructure without necessity.

Provide:

- Dockerfile.
- `.dockerignore`.
- `.env.example`.
- Health endpoint.
- Production build instructions.
- Container startup instructions.
- Deployment documentation.

Test the container locally when Docker is available.

Do not claim production readiness unless the production configuration has actually been tested.

## 8. Testing and quality gates

Run all applicable checks:

- Dependency installation.
- TypeScript.
- ESLint.
- Unit tests.
- Integration tests.
- Production build.
- E2E tests.
- FFmpeg export tests.
- Browser interaction checks.

Fix the failures.

Do not suppress TypeScript errors simply to pass compilation.

Do not delete failing tests to produce a green test suite.

Document external services or credentials required for tests that cannot be run.

## 9. Open-source readiness

Prepare the repository for public release.

Include:

- README.md.
- LICENSE, selected only after verifying the user's intended licensing.
- `.gitignore`.
- `.env.example`.
- Architecture documentation.
- Setup instructions.
- Model API integration explanation.
- Video-processing explanation.
- Test instructions.
- Deployment instructions.
- Known limitations.
- Demo instructions.
- Third-party attribution where necessary.

Never publish private media.

Never publish API keys.

Respect the licensing of all existing brand assets, libraries, and sample videos.

## 10. Hackathon requirements

Prepare a clear documentation section:

"Built during Meta Global AI Developer Hackathon 2026"

Describe:

- The original problem.
- What was built during the event.
- Meta models used.
- Why each model is essential.
- Technical challenges.
- Object tracking and frame processing.
- Creative rendering capabilities.
- Real-world utility.
- Demo instructions.

Do not claim functionality that does not work.

Keep the project distinct from unrelated products.

## 11. Final readiness matrix

Create `docs/RELEASE_READINESS.md`.

For each feature, record:

- Feature name.
- Implementation status.
- Test status.
- Live API verification status.
- Known problems.
- Severity.
- Release decision.

Classify problems as:

- Blocker.
- High.
- Medium.
- Low.

Fix all blockers before recommending release.

## 12. Final report

Provide:

1. Technical findings.
2. Defects fixed.
3. Tests executed.
4. Tests passed.
5. Tests failed.
6. Real Meta API integration status.
7. Export verification results.
8. Security findings.
9. Deployment status.
10. Known limitations.
11. Final release recommendation.

Do not say "Everything works" without supporting test evidence.

If anything remains broken, describe it plainly.

**The final objective is a small, genuine, reliable, publicly demonstrable product—not an impressive-looking application that fails during the demo.**