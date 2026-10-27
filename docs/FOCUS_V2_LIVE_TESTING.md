# Focus v2 — real-footage validation

Validated on 2026-10-26 with real Meta API responses, actual SAM masks and encoded MP4s. The live checks are separate from the synthetic Vitest and browser fixtures. They are excluded from `pnpm test`.

## Reproduce the live case

The source is OpenCV's [vtest.avi sample](https://github.com/opencv/opencv/blob/4.x/samples/data/vtest.avi): people walking across a fixed camera. The original is 768×576 at 10 fps. A three-second crop focuses on the pedestrian in a black coat. The source stays unchanged; prepared footage and artifacts are git-ignored.

```sh
mkdir -p .focus-data/phase8/source
curl --fail --location https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/vtest.avi \
  -o .focus-data/phase8/source/vtest.avi
ffmpeg -hide_banner -loglevel error -y -t 3 \
  -i .focus-data/phase8/source/vtest.avi \
  -vf crop=512:384:256:128 -c:v libx264 -crf 18 -pix_fmt yuv420p \
  -movflags +faststart .focus-data/phase8/source/pedestrians.mp4

FOCUS_TEMPORAL_LIVE_VIDEO=.focus-data/phase8/source/pedestrians.mp4 \
FOCUS_TEMPORAL_LIVE_POINT=0.79,0.38 \
pnpm test:live:temporal
```

The command reads the server's existing `.env` through Node. `MODEL_API_KEY` or the supported `META_API_KEY` is required for a fresh capture. Keys are never written to reports. The suite enables Time Freeze only inside its test process and restores the environment afterward.

The initial capture requests one Muse Spark plan and one SAM pass over the normalized excerpt, plus a Files API upload. Cached plans and masks are reused on later runs. The excerpt is bounded to 2–4 seconds and at most 96 normalized frames. Existing provider retry limits still apply. Use this specific command rather than the whole v1 live suite to avoid unrelated paid requests.

| Setting | Default | Meaning |
| --- | --- | --- |
| `FOCUS_TEMPORAL_LIVE_VIDEO` | unset | Required local footage path; no configured source means the suite skips. |
| `FOCUS_TEMPORAL_LIVE_POINT` | unset | Optional `x,y` fractions of the **first normalized frame**, within 0–1. Selects a specific subject with the existing SAM point prompt. Without it, use the plan's concept. |
| `FOCUS_TEMPORAL_LIVE_INSTRUCTION` | Black-coat instruction above | Optional bounded instruction for another clip. |
| `FOCUS_TEMPORAL_LIVE_START` | `0` | Excerpt start in seconds. |
| `FOCUS_TEMPORAL_LIVE_SECONDS` | `3` | Excerpt duration, 2–4 seconds. |
| `FOCUS_TEMPORAL_LIVE_TRIGGER_MS` | `1500` | Manual freeze point, checked against the normalized clip before any paid call. |
| `FOCUS_TEMPORAL_LIVE_REPLAY` | unset | `true` forbids creating missing artifacts or making API calls. |
| `FOCUS_TEMPORAL_LIVE_REJECTED_TRACKING` | unset | Optional cached background tracking file for the negative selection test. |

Use the first-frame poster for point placement. A contact sheet sampled with FFmpeg's `fps` filter may show a later frame; it is not a substitute for the prompt's exact frame.

## Observed result

For the prepared file produced on this machine:

- Original source SHA-256: `45cddc9490be69345cbdab64ca583be65987e864ca408038e648db99e10516cf`.
- Prepared MP4 SHA-256: `f8e89540e1f8e6dc9b217c766c3cfa4b9077a358bbe516cc8e42859a27d551cf`. FFmpeg versions can produce different encoded bytes and therefore different cache directories.
- Normalized input: 512×384, 24 fps, 72 frames, 3 seconds, no audio. Normalization repeats source frames; no generated or interpolated footage is introduced.
- Muse Spark 1.3 returned `time_freeze_echo`, concept `person in black coat`, three echoes, 320 ms spacing, 1000 ms hold and no invented event timestamp.
- SAM 3.1 tracked object `0` in 72/72 frames, with mean confidence ≈0.940. Masks are real silhouettes, not filled boxes.
- The freeze point is **manual**, at 1500 ms / frame 36. Both geometric suggestions returned `null` on this clip; this is not evidence of automatic action detection.
- Cutouts come from frames 12, 20 and 28. The hold inserts 24 frames and then resumes at source frame 37. The MP4 contains 96 frames / 4 seconds. No render warnings.
- Mean absolute RGB differences in unchanged regions were 0.79 before the freeze, 1.09 at the trigger, 1.09 in the frozen background, 1.08 at resumption and 1.25 at the final frame, on a 0–255 scale. Echo interior pixels also passed the expected opacity checks.
- Selective color, background blur, spotlight, Break the Frame and Motion Echo all rendered and passed FFprobe verification from those same masks. A second temporal render changed echo count and hold duration without a new Meta call.

Artifacts are under `.focus-data/phase8/e249dcac5f5da1dd/`:

| Artifact | Evidence |
| --- | --- |
| `live-capture-report.json` | Successful fresh API capture, plan, tracking statistics and usage. |
| `report.json` | Most recent run; `mode` and `reused` distinguish fresh capture from cached replay. |
| `time-freeze/output.mp4` | Edited/exported MP4. |
| `time-freeze/compare.mp4` | Encoded before/after comparison. |
| `sam-mask.png`, `subject-cutout.png` | Real matte and transparent cutout at an echo frame. |
| `before.png`, `freeze.png`, `resumed.png` | Frames for visual inspection. |
| `time-freeze-adjusted/`, effect-named folders | Parameter-change and v1 regression exports. |
| `background-rejection.json` | Expected rejection of the first, incorrect selection. |

The first live point, `(0.70, 0.40)`, fell on pavement and produced a valid background segmentation. The renderer refused to make overlapping echoes. After checking the actual first frame, `(0.79, 0.38)` selected the coat correctly. Total API work for this validation was **one Muse Spark plan, one upload and two SAM passes, 144 reported video frames processed**. The plan and upload were reused for the corrected selection. No further API calls were made for the regression renders or replay.

## Replay with no credentials or API calls

After the initial capture, this command passes even with both key variables explicitly empty:

```sh
MODEL_API_KEY= META_API_KEY= \
FOCUS_TEMPORAL_LIVE_REPLAY=true \
FOCUS_TEMPORAL_LIVE_VIDEO=.focus-data/phase8/source/pedestrians.mp4 \
FOCUS_TEMPORAL_LIVE_POINT=0.79,0.38 \
FOCUS_TEMPORAL_LIVE_REJECTED_TRACKING=.focus-data/phase8/e249dcac5f5da1dd/live-f00ef5874001b600.json \
pnpm test:live:temporal
```

The two replay checks verify the complete temporal/v1 render path and the recorded `echoes_overlap` rejection. The usage log must remain unchanged through rendering. Missing or invalid cached inputs fail before any creation callback; replay never falls back to a network request.

## Limits of this evidence

This is one real walking subject under a fixed camera, selected with a point prompt. It does not establish reliable automatic jump detection, arbitrary camera-motion support or universal SAM tracking quality. The footage is silent; audio insertion and synchronization are covered separately by the real encoded swept-tone fixtures from Phase 7. API response artifacts are local and ignored by Git, so another checkout must make its own live capture or receive the matching source/masks before replaying.
