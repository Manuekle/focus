# Focus v2 — Time Freeze + Echo

Plan for evolving Focus v1 into a temporal editor with one new effect, `time_freeze_echo`. Written after a full audit of the working tree on 2026-10-26 (branch `main`, HEAD `c4b3313`, large uncommitted v1 work in progress).

Baseline at audit time: `pnpm typecheck` clean, `pnpm test` 15 files / 146 tests passing. FFmpeg/FFprobe 9.0.2 available locally. No `MODEL_API_KEY` in `.env`, so live Meta API calls cannot be verified from this machine.

## 1. What v1 already has (reused as-is)

| Area | Where | Notes for v2 |
| --- | --- | --- |
| App shell | Next.js 16 App Router, one process. `app/editor/editor-studio.tsx` → `app/_editor/editor-view.tsx` | No new routes or shell needed. |
| Meta client | `server/ai/meta.ts` (retries, error mapping, limiters, key read only here) | Unchanged. |
| Muse Spark planning | `server/ai/planner.ts`: strict `json_schema` structured output → `EditPlanSchema` (Zod) → consistency fixes. Poster frame attached. Plans cached per request key in `plans/`. | Extend enum + parameters only. |
| AI editor chat | `server/ai/assistant.ts`: chat turn → bounded `ParamsPatch` → `applyParamsPatch` → re-render from cached masks | Extend knob list. |
| SAM 3.1 tracking | `server/ai/sam.ts` (Files API upload once per video, streaming parse via `@meta-sam/parser`), `shared/tracking.ts` (`Tracking`: frames sorted by explicit frame index, per-object box + one-bit mask + confidence, `missingFrames`, `outcome`) | Already gives everything Phase 3 asks for: per-frame masks by index, object ids, timestamps (`frameIndex / fps`), boxes. Cached per concept in `segmentations/c-*.json`; gap-fill (`+g-*`) and point-refine (`+p-*`) variants. |
| Mask rasterization | `server/video/masks.ts`: `rasterizeSelection` (real SAM rasters, never boxes), `feather`, `featherRadius` | Reused for cutouts. |
| Pixel ops | `server/video/effects.ts`: `cropGhost`, `drawGhost`, `blendOver`, `padBox` (Motion Echo already crops real-mask subject ghosts and redraws them at source position) | Reused directly for echoes. |
| Frame I/O | `server/video/frames.ts`: `readFrames` (RGBA pipe), `writeFrames` (H.264 yuv420p CFR, audio copy), `runFfmpeg` — argument arrays, no shell | `writeFrames` needs an audio-policy option (see §4). |
| Render pipeline | `server/video/compositor.ts`: `renderVideo`, `createProcessor`, `trackingMaskSource`, `renderComparison` (original/edited vstack), `verifyOutput` (FFprobe: codec, size, fps, frame count, pix_fmt, duration, audio presence) | Assumes output frames = input frames; needs a temporal path. |
| Finish layer | `server/video/finish.ts` (look, glow/outline, vignette, grain seeded by output index, letterbox) | Works per output frame; reused. |
| Upload / normalization | `server/videos.ts`: 50 MB streamed cap, FFprobe validation, normalized ≈720p, 24 fps CFR, H.264, AAC, poster | Unchanged. Segmentation and render read the same `normalized.mp4`, so mask N = frame N. |
| Jobs | `server/jobs.ts`: file-backed jobs, dedup, per-job lock, plan / segmentation / render caches, render key = hash(renderer version, segmentation, selection, params) | Changing temporal params changes only the render key, never SAM. Already satisfies "no new SAM request on param change". |
| Preview = export | `CompareStage` plays the rendered `compare.mp4` / `output.mp4`; download serves the same `output.mp4` | Preview is the encoded file, so it cannot diverge from export. Keep it that way. |
| Design system | `components/ui/*` (Button, Switch, ToggleChip, ProgressMeter, Spinner), `SlidingTabs`, `editor-scrubber` range style, Hugeicons, motion tokens, tokens in `app/globals.css` | Reuse only. Editor panels sit flat (no card boxes). |
| Tests | Vitest (`server/**`, `shared/**`, `app/**`), synthetic lavfi videos encoded with real FFmpeg in `compositor.test.ts`; jobs tests stub `services`; Playwright e2e; live tests on demand | Same patterns for v2. |

## 2. Missing or incomplete for this feature

1. **No temporal operation model.** Every effect is frame-in/frame-out; output length always equals input length.
2. **Output frame count is hard-coded to the source** in `renderVideo` (index check), `writeFrames` (`-frames:v`, audio `-t`), `verifyOutput` (expected `frameCount`), `renderJob` (expects `video.normalized.frameCount`) and `renderComparison` (vstack assumes equal length).
3. **No audio policy beyond copy.** Inserting frames requires silence for the freeze interval and the original audio shifted after it.
4. **No temporal event detection** (jump apex, peak motion).
5. **No timeline marker UI.** The "timeline" is the scrubber in `VideoStage` / `CompareStage`; no markers exist.
6. **No feature flag mechanism.** No `NEXT_PUBLIC_*` variables are read anywhere.
7. **Effect enums are closed records**: `EffectIdSchema`, `PlanEffectSchema`, `EFFECT_PLAN_EFFECTS`, `SuggestionsSchema.ideas`, `PLAN_EFFECT_LABEL`, `EFFECT_LABEL`, `shared/pipeline.ts EFFECTS`, planner/assistant JSON schemas — all need the new member, gated by the flag where user-visible.

## 3. Technical risks

| Risk | Mitigation |
| --- | --- |
| Frame-count assumption spread across 5 places; a miss breaks every render's verification | Compute an explicit **output timeline** (list of source frame per output frame + freeze span) once, pass expected counts everywhere. Non-temporal effects get the identity timeline, so v1 code paths stay byte-identical. |
| Duplicate silhouette at the trigger position (base frame already contains the subject) | Echo samples exclude the trigger frame and are skipped when their mask overlaps the base mask beyond an IoU threshold; the present subject is redrawn last, on top. |
| Echoes bunching (slow motion) or missing (no mask) | Sample by spacing, then drop samples without a mask or too close to the previous accepted one; report how many echoes were actually drawn. Warn when fewer than 2 survive. |
| SAM gaps/low confidence near the trigger | Before render, check mask presence on the trigger frame and sampled frames. Missing trigger mask → refuse with a clear message; sparse samples → warning in `RenderResult.warnings`. |
| Model proposes a wrong timestamp | The planner never sets a timestamp. It only names the trigger *event*. Timestamp comes from the user (manual) or the geometric detector (auto suggestion), and its provenance is stored and shown. |
| Audio drift after inserted frames | Audio built with one FFmpeg filter graph (`atrim` + `anullsrc`/`adelay` + `concat`) using sample-exact values derived from frame indices; FFprobe test checks stream durations. |
| Memory | Cutouts are cropped to the padded mask box (like Motion Echo), at most 6 kept; one decode pass. |
| Camera motion | Out of scope (spec). Detector and docs state static-camera assumption; no claim of world-freeze with moving subject. |
| Large uncommitted v1 tree (≈980 status entries, many staged deletions) | Touch only files listed in §5; never revert or stage unrelated changes. |
| No live API key locally | Live verification of Muse Spark temporal parsing reported as *not verified*; covered by schema/parse unit tests with fixtures. |

## 4. Design

### 4.1 Temporal edit model (Phase 1)

`shared/temporal.ts` (new):

```ts
TemporalEditSchema = z.object({
  type: z.literal("time_freeze_echo"),
  target: ConceptSchema,                       // SAM concept; object ids come from the job selection
  trigger: z.object({
    mode: z.enum(["manual", "auto"]),
    timestampMs: z.number().int().nonnegative().optional(),
    event: z.enum(["jump_apex", "peak_motion"]).optional(),
  }),
  freezeDurationMs: z.number().int().min(500).max(3000),
  echo: z.object({
    count: z.number().int().min(2).max(6),
    spacingMs: z.number().int().min(80).max(400),
    opacity: z.number().min(0).max(1),
  }),
  resume: z.boolean(),
});
```

Render params: a new member of the `RenderParamsSchema` discriminated union, `effect: "time_freeze_echo"`, carrying `trigger`, `freezeDurationMs`, `echo`, `resume`, plus the shared `feather` and `finish`. `target` stays where v1 keeps it (plan concept + selected object ids), so masks and selection are untouched. Duration bound is checked with the media: `assertTriggerInRange(params, media)` in `startRender`/`renderJob` (Zod alone cannot know the clip length). No free-form strings reach FFmpeg: every FFmpeg number is computed server-side from validated integers.

### 4.2 Natural language (Phase 2)

- `PlanEffectSchema` + planner JSON schema gain `time_freeze_echo`; parameters gain `freezeDurationMs`, `echoCount`, `echoSpacingMs`, `triggerEvent` (`jump_apex | peak_motion | null`), all nullable and clamped. No timestamp field in the model output.
- Family `"time-freeze"` → `time_freeze_echo`. Instructions only include the effect when the flag is on.
- Plan → default params: trigger `{ mode: "auto", event }` when an event was named, else `{ mode: "manual" }` with timestamp unset until the user or detector fills it.

### 4.3 Tracking reuse (Phase 3)

No new SAM code. `trackingMaskSource` already gives `alphaAt(frameIndex)`; add a pure helper for per-frame selection boxes and centers (`subjectBoxes` exists in `compositor.ts`; move/extend to `shared/temporal-events.ts` so the browser can draw suggestion markers without server code).

### 4.4 Rendering (Phase 4)

`server/video/temporal.ts` (new, isolated):

1. `planTimeline(media, params, tracking)` → `{ triggerFrame, freezeFrames, samples: frameIndex[], output: OutputFrame[] }` where output = source `0..T`, then `F` freeze frames, then source `T+1..N-1` if `resume` (continuation point: the frame after the trigger), or end after the hold.
2. Single decode pass. While decoding frames before `T`, crop real-mask cutouts for sample frames (`T − k·spacing`, k = count..1) with `cropGhost`.
3. At `T`: emit `F` frames from the frozen base; echoes revealed oldest → newest across the first ~60 % of the freeze (each fades in over a few frames to its target opacity: older = fainter, scaled by `echo.opacity`), last ~40 % holds the full composition; present subject redrawn on top from the base mask.
4. Finish layer applied per output frame (grain seeded by output index).
5. `writeFrames` gets `frameCount = output.length` and an audio policy `{ kind: "freeze", atSeconds, silenceSeconds, resume }`: `atrim` 0→T, silence for F, then `atrim` T→end with matching `asetpts`, concatenated; when `resume` is false the audio stops with the hold. Without audio input, nothing changes.
6. `verifyOutput` takes the expected output frame count/duration; `renderComparison` builds the "before" half with the same frame insertion (original frame held), so both halves share one clock.

Non-temporal effects keep the current `renderVideo` path untouched.

### 4.5 Event detection (Phase 5)

`shared/temporal-events.ts` (pure, tested): from selection boxes per frame → smoothed center-y and box height; `jump_apex` = local minimum of center-y with rise and fall each ≥ ~15 % of median subject height within ~1.5 s; `peak_motion` = max smoothed displacement per frame relative to subject size. Returns `{ frameIndex, confidence, reason } | null`; below threshold → `null` → manual. Results always labelled "suggested".

Implemented on 2026-10-26:

- Both heuristics use median-smoothed centers from one selected SAM identity. Missing masks, low SAM confidence, frame gaps, abrupt size changes and tracking teleports split the evidence into separate runs; no gap is interpolated.
- `jump_apex` chooses the highest supported center (minimum screen y), requiring a rise and a fall of at least 15% of median subject height within 1.5 seconds on each side, plus a coherent path. `peak_motion` measures consecutive-frame displacement relative to the subject diagonal, with frame-rate normalization and sustained motion around the candidate (at least 0.5 diagonals/second, 0.1 diagonal of net travel and net/path ratio ≥ 0.5 to reject persistent box jitter). Flat maxima use the middle of the highest apex / fastest period.
- A suggestion includes `event`, `frameIndex`, `timestampMs`, `confidence` and `reason`. The confidence threshold is 0.7; the score describes geometric evidence, not a calibrated action-recognition probability. Weak motion, unreliable tracking or multiple selected identities return no suggestion.
- `renderJob` resolves every `auto` trigger from the current cached tracking before computing the render key. Client-supplied auto timestamps are replaced. Accepted suggestions are exposed in `job.temporalSuggestion` and labelled in result warnings, including confidence. There must also be enough masked history for at least two echoes.
- Without a usable suggestion the job stays `ready_to_render`, clears the unresolved timestamp and asks for a manual freeze point. Explicit manual timestamps take priority and clear suggestion metadata. Re-renders reuse SAM masks and render caches. Older saved jobs default `temporalSuggestion` to null.
- Verified with geometry tests, real FFmpeg clips (lateral movement and a jumping subject measured from decoded pixels), and job lifecycle tests for auto detection, low-confidence fallback, manual correction and cache reuse. Live camera footage with SAM remains unverified; camera-motion compensation remains outside this phase. Timeline controls and editable markers belong to Phase 6.

### 4.6 UI (Phase 6) and flag (Phase 9)

- `shared/features.ts`: `TEMPORAL_EFFECTS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS === "true"` (public, boolean only, no secrets). Server routes reject `time-freeze` requests when off; the composer hides the tab; v1 enums still parse old jobs.
- Composer: 4th effect tab **Time Freeze** — "Freeze a moment. Multiply the motion."
- Result panel (`EffectControls`): freeze point, echoes (count), spacing, intensity (echo opacity), Apply (existing re-render), Download (existing). Freeze duration fixed to the plan/default with a single slider only if it stays simple.
- Timeline: a distinct marker on the scrubber at the freeze point (source time), draggable/settable by seeking; the auto suggestion shown as a separate editable marker; on the result player, the freeze span is shaded on the output timeline.

Implemented on 2026-10-26:

- The existing composer offers **Time Freeze** with its description and examples only when `NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true`. `availableEffects()` filters the catalog; the previous effects keep their controls and defaults.
- A ready temporal job exposes echo count (2–6), spacing (80–400 ms), intensity (0–1), freeze duration (0.5–3 s) and **Preview Time Freeze**. Finish and resume settings stay under a disclosure. Missing timestamps focus the source marker and show an inline instruction rather than sending an invalid render request.
- `FreezeTimeline` extends the source player's scrubber with a diamond freeze marker and a separate playback handle. Seek then **Freeze here**, drag the diamond, or use native range keyboard controls. Both handles snap to normalized source frames; the final frame cannot place a timestamp past the clip. Opening an existing freeze seeks to that exact source frame.
- Suggestions show their event and confidence next to the controls. Moving a suggested marker changes its provenance to manual, retains a dashed reference to the original suggestion, and allows **Use suggestion** to restore it before applying. Suggestion information no longer creates a large persistent toast over the mobile timeline. Actual rendering warnings keep the existing notice behavior.
- Results provide **Adjust freeze point**, **Preview rendered video**, **Apply adjustments** and the existing MP4 download. The source timeline remains separate from the encoded output clock; the comparison player shades and labels the inserted freeze interval. The preview and download still use the same server-rendered file. Draft changes are applied explicitly, and a failed temporal render can be corrected from the same controls and saved masks.
- Browser verification uses a real uploaded FFmpeg jumping-sprite clip and segmentation masks extracted from its decoded red pixels. Only planning/SAM are seeded; render, comparison and MP4 download use the real API. Coverage includes missing-point focus, seeking and the last-frame boundary, parameter changes, keyboard and pointer editing, auto-to-manual provenance, restoring a suggestion without a spurious dirty state, cache reuse, export, reduced motion and a 320 px viewport.
- The public flag is compiled into the client bundle: set it before `pnpm build` (or restart `next dev`). It remains off by default. Live Meta verification and camera footage remain outside these browser tests.

Browser checks for this phase: `NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true pnpm build`, then `NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true pnpm exec playwright test`. The temporal browser tests skip when the flag is off; the previous editor tests still run.

Phase 9 release safeguards:

- `next.config.ts` compiles an explicit `true`/`false` public value into both server and browser bundles, including when the environment variable is absent. `shared/features.ts` remains the single effect gate. Only the exact `true` value enables the experimental catalog entry.
- Job entry points enforce the gate before creating/reusing a temporal job, starting a render from explicit or saved/default settings, changing a subject, completing tracking or calling the AI editor. Cached plans are checked before SAM and the renderer checks its resolved effect again. Restoring a temporal chat version follows the same gate. Existing MP4 reads/downloads stay available.
- After rollback, stale temporal drafts preserve the instruction and cancel autostart; the stable composer selects Reality Shift. This correction persists in local storage so enabling the feature again cannot revive the old autostart. Saved temporal project edits remain stored but are omitted from editor history while disabled, preventing their controls from reopening.
- Docker supports the public build argument, defaulting to false. Activation and rollback require replacement builds; changing only the production start-time environment does not change this flag. Generated E2E data is excluded from the Docker context. No new runtime configuration API or router is introduced.
- Unit/integration coverage includes exact flag values, cached temporal plans under a v1 request, cached jobs, omitted render parameters, selection/refinement/gap-fill paths, AI edit/restore refusal and continued access to completed exports. Browser release checks cover the catalog, API, old browser drafts and old projects; the matrix intentionally starts each build with the opposite runtime flag. Commands and rollback semantics are in [DEPLOYMENT.md](DEPLOYMENT.md#temporal-release-flag).
- Release verification reproduced an intermittent 107/108-frame comparison failure: the edited MP4 was complete, but stacking the concatenated original clock with the MP4 clock could lose the final frame. Both temporal halves now receive integer frame timestamps in the same timebase before stacking, with explicit final-frame handling. A permanent regression repeats a real 108-frame comparison 12 times and checks frame timestamps and identical decoded audio. Temporal cache version 3 rebuilds affected comparisons; v1 cache keys remain unchanged.
- Verified on 2026-10-26: `pnpm check` passed all 259 tests, TypeScript and ESLint. Both production builds passed: enabled, and disabled with the variable absent. Each browser run passed 13 checks with 2 state-specific skips, while starting the server with the opposite flag. The real-footage replay also passed both checks with both API keys empty, reusing the recorded SAM masks without new provider calls. The final default build's 33 public JS/CSS/map assets contained no occurrence of the configured private provider key. Docker image execution was not verified because the local daemon was unavailable. The local environment file remains unchanged and the final production build is disabled by default.
- Validation is bounded to two Vitest workers and one shared-server browser worker. An earlier overlapping exploratory run reported an `interrupted` v1 job; it did not recur in the final bounded runs. General concurrent-load acceptance remains separate from the release-flag checks.

### 4.7 Preview and export (Phase 7)

Preview is the rendered MP4 (same file the download serves), so preview and export match by construction. Audio policy: muted during the inserted freeze, original audio resumes in sync — implemented once in `writeFrames` and mirrored in the comparison stream. FFprobe verification extended to check output frame count, duration and audio stream duration.

Implemented on 2026-10-26:

- Temporal audio is first aligned to the normalized source clock, padding leading/trailing silence when the soundtrack starts late or ends early. The insertion starts at `freezeStart / fps`, lasts `freezeFrames / fps`, and either resumes the remaining source audio or ends with the hold. A swept-tone fixture verifies the resumed sound against the right source samples, including a one-frame error comparison.
- The temporal comparison copies the edited AAC track without re-encoding it. Both playback modes expose the existing mute control and preserve the playback position when switching. The original half holds the same trigger frame for the same duration; constant frame rate is restored after stacking, and the video is trimmed in the filter graph so the encoder does not discard trailing audio packets. A freeze on the final source frame omits the empty continuation branch.
- `renderJob` verifies both temporal MP4s before committing them. FFprobe checks H.264, yuv420p, dimensions, frame count, frame rate and duration, plus zero-based audio/video start times and AAC duration with a tolerance of one video frame or one 48 kHz AAC packet, whichever is longer. Existing v1 verification and silent comparisons remain unchanged. Temporal cache versioning invalidates only older Time Freeze renders.
- Versioned result URLs now resolve the requested `r` key inside the job's own video directory and require completed, schema-valid render metadata. A previous preview or download remains available during and after a replacement render. Invalid or missing versions return 404; byte-range requests keep working. An unversioned URL retains the previous latest-completed-result behavior.
- In-flight render deduplication is scoped by video as well as render key. Two clips with identical concepts and settings produce separate files in their own directories, while edits of the same clip still share work. The cached key format of v1 effects is preserved.
- Verification covers decoded source/echo/held/resumed pixels, every video timestamp in the output and comparison, identical decoded audio in both files, 0.5–3 s freezes, the last-frame boundary, ending on the hold, silent clips, short or delayed audio, and rejection of malformed audio timing. Browser checks compare preview/download bytes, check old URLs after re-render, exercise Range and invalid-version requests, and probe the downloaded MP4.
- **Edited** preview and download use the exact same MP4 bytes. The before/after comparison is encoded again for the stacked player, so its pixels can have small additional H.264 compression differences; its frame clock and copied soundtrack match the export. Real camera footage and live SAM are verified separately in Phase 8 below.

## 5. Files

Modified (minimal, additive):

- `shared/schemas.ts` — `EffectId` + `"time-freeze"`, `PlanEffect` + `time_freeze_echo`, `EFFECT_PLAN_EFFECTS`, plan parameters, optional `ideas["time-freeze"]`.
- `shared/render.ts` — new params member, defaults, bounds, `describeParamChanges` labels.
- `shared/pipeline.ts` — effect entry (flag-filtered at use sites).
- `server/ai/planner.ts`, `server/ai/assistant.ts`, `server/ai/suggest.ts` — schema/prompt extensions.
- `server/video/frames.ts` — optional audio policy in `writeFrames`.
- `server/video/compositor.ts` — route `time_freeze_echo` to the temporal renderer; `verifyOutput` / `renderComparison` take explicit expected timeline.
- `server/jobs.ts` — trigger range check, expected frame count from render output.
- `app/api/edits/route.ts` — flag gate.
- `app/_editor/composer.tsx`, `effect-controls.tsx`, `job-panel.tsx`, `video-stage.tsx`, `compare-stage.tsx`, `editor-view.tsx` — tab, controls, markers.
- `.env.example`, `README.md`, `docs/ARCHITECTURE.md` — flag + module docs.

New:

- `shared/temporal.ts` (+ test) — schema, bounds, timeline planning helpers (pure).
- `shared/temporal-events.ts` (+ test) — jump apex / peak motion suggestions.
- `shared/features.ts` — flag.
- `server/video/temporal.ts` (+ test) — temporal renderer.

## 6. Backward compatibility

- All new enum members are additive; stored v1 jobs, plans, renders and projects keep parsing.
- `RENDERER_VERSION` unchanged: v1 render keys and cached files stay valid.
- v1 effects keep the identity timeline: same frame count, same audio copy, same verification.
- Flag off (default): no new tab, planner prompt without the new effect, API rejects `time-freeze`, editor behaves exactly as before.
- Full v1 test suite must stay green after every phase.

## 7. Testing (Phase 8)

Real FFmpeg-encoded synthetic clips (lavfi background + a moving/jumping sprite on a parabolic path, with optional sine audio) give exact ground-truth masks, so mask/frame alignment, cutout pixels, echo positions and ordering are asserted on decoded output frames, not mocked geometry. Plus: schema bounds, trigger range, event detection on recorded box tracks, output frame ordering, freeze duration, audio/video stream durations via FFprobe, MP4 validity, and the full existing v1 suite. A real camera clip with SAM masks requires the live API key; reported as not verified if unavailable.

### 7.1 Phase 8 — real-footage verification (2026-10-26)

Implemented `server/video/temporal.live.test.ts` and `pnpm test:live:temporal`, an opt-in live suite with checksum/model/prompt caches and an explicit replay mode that forbids network work. See [FOCUS_V2_LIVE_TESTING.md](FOCUS_V2_LIVE_TESTING.md) for commands, artifact paths, provenance, API usage and limitations.

- Actual Muse Spark 1.3 and SAM 3.1 calls validated a three-second fixed-camera crop of OpenCV's pedestrian footage. SAM tracked the selected black-coated person in all 72 normalized frames (mean confidence ≈0.940).
- Manual freeze at 1500 ms, three real-mask echoes from frames 12/20/28, 1000 ms hold, correct resumption: output is 96 frames / 4 seconds and passes FFprobe. Pixel checks cover source/mask alignment, non-rectangular subject extraction, opacity, reveal order, frozen background and resumed source frames. PNGs and both MP4s are retained for inspection.
- All five v1 effects also rendered successfully from the real stored masks. Changed temporal parameters reused those masks. A replay with both API keys empty passed the full render checks and a negative background-selection check; the usage log stayed unchanged.
- The initial point landed on pavement and was rejected as `echoes_overlap`. Correcting it to the first-frame coat location required a second SAM pass, with the existing plan and upload reused. Total observed work: one plan, one upload, two SAM passes / 144 reported frames processed. The rejected masks are retained as regression evidence.
- Both automatic event suggestions returned null for this 10 fps source normalized to 24 fps. The verified freeze is explicitly manual. Live jump-apex recognition and footage with substantial camera motion are not claimed. This clip is silent; Phase 7's encoded audio cases remain the synchronization evidence.

## 8. Execution order

Phase 10 completed on 2026-10-26: all 14 criteria are mapped to evidence in [FOCUS_V2_ACCEPTANCE.md](FOCUS_V2_ACCEPTANCE.md). Final checks passed 263 unit/integration tests, 13 browser checks in each flag state, a bounded 18-job load scenario and an actual Linux arm64 container browser/upload/render/download replay using recorded real SAM masks. Acceptance fixed a stale-poll interruption race, a Linux FFmpeg comparison EOF loss (temporal cache version 4) and excluded packaged demo videos. Native builds finish with the flag disabled; no new Meta calls were needed. The earlier Phase 9 interrupted-job observation is now covered by three deterministic regressions and the load run. General cloud capacity, amd64 and live automatic action recognition remain outside this acceptance.

Phase 1 model → 2 planner → 3 tracking helpers → 4 renderer → 5 detection → 6 UI → 7 preview/export verification → 8 tests → 9 flag → 10 acceptance report. User confirmation is requested before moving to each next phase.
