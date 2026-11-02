# Time Freeze + Echo

Time Freeze is a temporal effect: at a chosen moment the video holds a frame, ghost silhouettes of the subject's earlier positions fade in over it, and then the original clip resumes. It is the only effect whose output is longer than its input, and it is **off by default**.

Enable it with `NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true`. The flag is compiled into the bundle, so rebuild (or restart `pnpm dev`) after changing it. See [DEPLOYMENT.md](DEPLOYMENT.md#temporal-release-flag) for the production notes.

## What the user controls

| Setting | Range | Meaning |
| --- | --- | --- |
| Trigger | manual timestamp, or automatic `jump_apex` / `peak_motion` | Where the clip freezes |
| Freeze duration | 500–3000 ms | How long the frame is held |
| Echo count | 2–6 | Number of ghost silhouettes |
| Echo spacing | 80–400 ms | Time between sampled ghost frames |
| Echo opacity | 0–1 | Opacity of the newest ghost; older ones are fainter |
| Resume | on / off | Continue from the frame after the trigger, or end after the hold |

Muse Spark never produces a timestamp. A plan only names the trigger *event*; the timestamp comes from the user (manual) or from a geometric detector, and its provenance is stored and shown.

## How it renders

`server/video/temporal.ts` builds an explicit **output timeline** (the source frame for every output frame, plus the freeze span). Non-temporal effects use the identity timeline, so their code path is unchanged.

1. A single decode pass crops real-mask cut-outs of the sampled frames (`trigger − k·spacing`) for the echoes. At most six are kept in memory.
2. At the trigger frame the held base is emitted for the freeze duration. Echoes are revealed oldest to newest across roughly the first 60 % of the hold, and the last 40 % holds the full composition. The present subject is redrawn on top.
3. The finishing layer (look, glow, vignette, grain, letterbox) runs per output frame.
4. Audio is built with one FFmpeg filter graph: original audio up to the trigger, silence for the hold, then the rest. With `resume` off the audio stops with the hold.
5. `verifyOutput` receives the expected output frame count and duration, and the before/after comparison inserts the same held frames so both halves share one clock.

Echo samples exclude the trigger frame and are skipped when their mask overlaps the base mask beyond an IoU threshold. Samples without a mask, or too close to the previous accepted one, are dropped; the render reports how many echoes were actually drawn and warns when fewer than two survive. A missing mask on the trigger frame refuses the render with a clear message.

## Automatic trigger detection

`shared/temporal-events.ts` (pure and tested) works from the selected SAM identity's per-frame boxes:

- Both heuristics use median-smoothed centres. Missing masks, low confidence, frame gaps, abrupt size changes and tracking teleports split the evidence into separate runs; no gap is interpolated.
- `jump_apex` picks the highest supported centre, requiring a rise and a fall of at least 15 % of the median subject height within 1.5 s on each side, plus a coherent path.
- `peak_motion` measures consecutive-frame displacement relative to the subject diagonal, normalized for frame rate.
- A suggestion carries `event`, `frameIndex`, `timestampMs`, `confidence` and `reason`. The confidence threshold is 0.7. The score describes geometric evidence, not a calibrated action-recognition probability. Weak motion, unreliable tracking or several selected identities return no suggestion.

## Limits

- Static camera assumed. There is no stabilization and no claim of a world-space freeze with a moving camera.
- Changing temporal parameters changes only the render key, never the SAM pass: re-rendering reuses the stored masks.
- Preview equals export: the editor plays the encoded file, and the download serves the same bytes.
