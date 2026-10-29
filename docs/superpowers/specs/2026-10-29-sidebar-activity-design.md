# Sidebar activity

Approved in chat on 2026-10-29: a compact, visible Activity section pinned to the bottom of the sidebars in Editor, Flipbook and Characters.

## Behavior

- Show active animation, image generation and video processing tasks, with a title and their actual stage.
- Reuse the existing small ProgressMeter for measured progress, and Spinner when a percentage is unavailable.
- Show Completed, Failed, Canceled or Needs input as appropriate. Opening a task returns to its existing editor, where the result or error can be reviewed.
- Put active tasks first and keep recent results until dismissed. Bound and scroll the activity list so navigation remains available.
- Follow known server jobs when navigating between studio pages. Restore tracked server jobs after reload, using session-scoped metadata; do not replay mutations. Clear activity when the signed-in account changes.
- Treat connection failures as reconnecting while a server job is still running. A failed read alone must not report that generation failed.

## Design system

Use the current sidebar label and row density, semantic colors, Hugeicons, Button, Spinner, ScrollArea and ProgressMeter. Preserve the app's English UI copy. Add no illustration, custom loading animation, new palette or floating surface. Honor existing keyboard focus and reduced-motion behavior.

## Implementation boundary

A browser activity store owns task metadata and subscriptions. Typed API clients publish existing job snapshots and wrap expensive synchronous requests. One client provider follows known background resources with read-only requests when the current editor is no longer polling them. The same footer component renders in the three sidebars. Existing generation logic and server endpoints remain authoritative.

## Validation

Verify active and indeterminate progress, success, failure, cancellation, needs-input states, dismissal, retries, ordering, reload restoration and account changes. Browser checks cover navigation between studios, a long library with the footer still visible, a narrow sidebar, keyboard access and reduced motion. Run TypeScript and ESLint checks.
