# Flipbook functional review — 2026-10-27

**Verdict: the core workflow is functional, including one successful real Meta generation. Two reproducible defects remain.** This review did not change application code.

## Findings

### P2 — Restart does not reset the running playback clock

Location: `app/flipbook/sequence-player.tsx:187–189` and `148–165`.

The Restart button and Home shortcut call `seek(0)`, but the active animation callback retains its previous `started` and `from`. Its next animation frame overwrites the reset with the old timeline. Restart works while paused.

Browser reproduction: select frame 2, choose 0.5× preview speed, play, then click Restart and immediately Pause. The two clicks took 568 ms; playback stopped on frame 4 rather than restarting from the beginning. The preserved clock explains the result.

Reset the playback time origin when restarting, or restart the animation effect with an explicit reset signal. Verify both the button and Home while playing and paused.

### P2 — Restore original can restore a drawing that never had a usable cutout

Location: `server/animation/flipbooks.ts:512–514`; `originalVersion` is assigned at `307`, before extraction succeeds.

When the first generation fails extraction, redrawing the frame successfully leaves `originalVersion` pointing to the failed first version. Restore original selects that version without checking its extraction data or retrying extraction. `finalize()` marks the frame failed, removing a working frame from the exportable cycle.

A separate offline regression probe reproduced this: first version without successful extraction → successful explicit redraw → Restore original → `status: failed`, `error.code: extraction_failed`. The assertion that restoration preserves a ready frame fails. The ordinary replacement-and-restore flow succeeds.

Keep the first successfully prepared version as the restorable original, or validate/re-extract a candidate before replacing the current usable version.

## Automated verification

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed |
| `NEXT_PUBLIC_ENABLE_FLIPBOOK=true pnpm build` | Passed |
| `pnpm test` | 325 passed; 1 opt-in load test skipped |
| `pnpm test:e2e` | 13 passed; 2 Time Freeze tests skipped with the temporal flag off |
| Additional failure-recovery probes | 1 passed; 1 failed, reproducing the restore defect above |

The committed Playwright suite exercises the existing video editor and release flags. Flipbook received a separate interactive browser pass against the real production build, with an isolated data directory and AI disabled, followed by the explicitly approved live trial.

## Browser verification

Verified upload and preview, prompt shortcuts and submit validation, the clear AI-disabled creation error, autoplay, pause, frame stepping, paused restart, frame selection, approval protection, frame reordering, transparent frame replacement with automatic polling, ordinary Restore original, onion-skin and movement controls, and all four export formats: MP4, GIF, sprite sheet plus atlas, and PNG ZIP.

The mobile editor at a 390×844 viewport had no horizontal overflow (document width 380 px). The desktop layout was inspected at 1280×900. The live animation, frames and saved exports survive a reload; its browser console contained no warnings or errors at the final check.

## Approved real Meta trial

- Input: the repository's synthetic, full-body side-view walker on white. Prompt: `Walk in place, relaxed`.
- Animation: `9440bee0-7d34-4f85-ac70-a52f38b33783`.
- Started at 07:06:54 UTC; ready by 07:12:06 UTC, approximately 5 minutes 12 seconds including the reference review pause.
- Successful calls: 1 Muse Spark character analysis, 1 Muse Spark pose plan, 8 Muse Image drawings, 9 SAM image segmentations (reference plus eight drawings). No failed usage entries for this animation.
- All eight frames are ready and use SAM cutouts; no automatic frame warnings. The measured stride is 714 px per cycle.
- The contact sheet was visually inspected: the character's design remains recognizable and the poses differ. Some lean and pose variation remains; one simple character does not establish quality for complex illustrations.

### Independent export checks

- Real MP4: HTTP 200 download, H.264/yuv420p, 512×768, 24 fps, exactly 48 decoded frames, 2.000 seconds. Each drawing sampled from the decoded video matches its registered sprite; mean channel error after scaling is 2.19–2.58/255.
- Real GIF: HTTP 200 download, 427×640, 8 frames, infinite loop, alpha, 1.01 seconds total. The 120/130 ms delays reflect GIF timing quantization.
- Offline sprite sheet, atlas and other downloads also returned HTTP 200 with attachment filenames.

## Evidence and scope

Live result: http://127.0.0.1:3200/flipbook?f=9440bee0-7d34-4f85-ac70-a52f38b33783

Persistent evidence folder:

`/Users/manudev/.codex/visualizations/2026/10/27/01a17c2b-20b2-75c3-9a12-a9ecd1d0ddf2/flipbook-review/`

Contains desktop/mobile screenshots, the real contact sheet, MP4, transparent GIF, state, usage summary, independent export verification, and the temporary regression probe source.

The paid clean-reference redraw, scene generation, AI review and extra paid frame redraw were not run. Paid failure paths use deterministic substitutes. Default-off release behavior was covered by existing tests, not by another full flag-off build in this pass. Application fixes remain outstanding.
