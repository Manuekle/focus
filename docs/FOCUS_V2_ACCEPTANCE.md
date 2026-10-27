# Focus V2 — Phase 10 acceptance

Acceptance date: 2026-10-26 (America/Bogota). **Accepted for an experimental single-instance demo with manual trigger selection. All 14 V2 acceptance criteria are verified within the scope below.** Time Freeze stays off by default; the existing environment file was not changed.

## Acceptance criteria

| # | Requirement | Evidence |
| --- | --- | --- |
| 1 | Preserve Focus v1 | Existing job/compositor tests, both feature-flag browser suites, and all five effects rendered with recorded real SAM masks in the Phase 8 replay. The global v1 renderer/cache version remains 2. |
| 2 | Upload a real video | Actual HTTP upload and normalization of OpenCV pedestrian footage in the container acceptance script; browser uploads also cover MP4 validation, broken files and duration rejection. |
| 3 | Select Time Freeze | Native browser flag matrix and container browser selecting the additional effect. The stable build omits it. |
| 4 | Choose a tracked subject | Recorded SAM object selection, existing multi-object job/point-selection tests, and 18 load-test jobs confirmed through `setSelection`. The container case reuses the previously selected real person. |
| 5 | Select the trigger | Native keyboard/pointer/manual-fallback tests; container browser chooses source frame 36 / 1500 ms with the native freeze slider. |
| 6 | Use real masks | Actual SAM 3.1 masks from Phase 8, 72/72 normalized frames. Their silhouettes, cutout pixels and source/frame alignment are checked by the recorded-footage replay. |
| 7 | Display historical cutouts over the freeze | Pixel/opacity/order tests and the real-footage case: three silhouettes from frames 12, 20 and 28 over the held frame. |
| 8 | Resume the original | Decoded source-frame comparisons before, during and after the hold. The real case resumes source frame 37 after 24 inserted frames. Audio fixtures check silent insertion and resumed alignment. |
| 9 | Preview the result | Browser comparison and Edited players use the actual encoded files, with timeline/mute controls and a visible freeze interval. |
| 10 | Download MP4 | Browser download, attachment header and FFprobe checks, including the container-generated export. |
| 11 | Match preview and export | Edited preview URL and download contain identical bytes. The stacked comparison is a separate encoding with the same frame clock; temporal audio is copied from the edited MP4. |
| 12 | Preserve Focus identity | Existing shell, components, fonts, colors, icons and animation styles retained. Container checks require all three packaged demo videos and save an editor screenshot. |
| 13 | Pass automated tests | Final unit/integration, feature-flag browser matrix, load test and container checks are listed below. |
| 14 | Build successfully | Native builds with the feature on/off and the Linux arm64 standalone Docker image are checked separately. |

## Validation results

| Check | Command / method | Recorded outcome |
| --- | --- | --- |
| Polling regression | `pnpm exec vitest run server/job-polling.test.ts` | Three cases failed before the fix and passed afterward: completed, canceled and failed jobs retain their final state. |
| Bounded concurrency | `pnpm test:load` | Passed: 18 jobs, three waves of six, 18,810 simultaneous polling reads, maximum six active jobs; three synthetic segmentations reused across the waves; zero provider calls. |
| Comparison clock across FFmpeg versions | Actual Linux FFmpeg before/after reproduction | The old post-stack fps filter produced 95/96 frames on three runs. Moving CFR conversion to the encoder preserved 96/96 on all three corresponding runs. Native regression repeats both 96- and 108-frame comparisons 12 times each, checking timestamps and copied audio. |
| TypeScript + ESLint | `pnpm typecheck && pnpm lint` | Passed. |
| Unit + FFmpeg integration | `pnpm exec vitest run --maxWorkers=1` | **263 passed**, one intentionally skipped opt-in load test. The default Vitest worker count now matches this validated setting. |
| Native build, flag enabled | `NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true pnpm build` | Passed. |
| Browser, flag enabled / runtime false | `NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true FOCUS_E2E_RUNTIME_TEMPORAL_EFFECTS=false pnpm test:e2e` | **13 passed**, two rollback-only cases skipped. |
| Native build, flag absent | `env -u NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS pnpm build` | Passed; final compiled value is false. |
| Browser, flag disabled / runtime true | `NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=false FOCUS_E2E_RUNTIME_TEMPORAL_EFFECTS=true pnpm test:e2e` | **13 passed**, two temporal-only cases skipped. Across the matrix every browser case runs. |
| Linux arm64 image + real-footage UI/API/export | Docker commands below | Passed with FFmpeg **5.1.9**, two CPUs and 2 GiB. Actual HTTP upload, frame-36 manual selection, three real-mask echoes, 96 frames / 4 s, H.264/yuv420p at 24 fps. Preview/download bytes match, byte ranges and all three demo videos work, and the process runs without root. Test container, volume and temporary session secret were removed. |

The load check exercises the single-process manager, real normalization, cached masks, local render queue, output verification and repeat renders. Providers are replaced with fixtures and both key variables are empty. Inputs are three synthetic 320×180, 24 fps, three-second clips with audio. It tests bounded concurrency rather than HTTP admission limits or deployment capacity. The report is `.focus-data/phase10/load-report.json`.

## Fixes made during acceptance

- A polling response could carry an active snapshot read immediately before its worker finished. Seeing no worker afterward, `getJob` could overwrite the already completed/canceled/failed file as interrupted. It now re-reads under the existing per-job write lock and checks the worker again before marking an interruption. Actual orphaned jobs still fail as interrupted.
- FFmpeg 5 in Linux exposed a final-frame loss that the previous native comparison fix did not fully resolve. Both halves retain integer frame timestamps; temporal comparisons now set CFR at the encoder instead of applying a post-stack fps filter. Video trimming stays in the graph and the edited soundtrack is copied, preserving the last audio packets. Temporal cache version 4 rebuilds these comparisons; v1 keys stay unchanged.
- The Docker context's broad MP4 exclusion also removed the three intended landing-page demo videos. Those specific packaged assets are now included, while uploads, caches and test media remain excluded. Agent tooling is also excluded from the image context.
- Real video suites are validated in sequence with one worker. Overlapping Docker and native FFmpeg work exceeded the previous 60-second test budgets on this machine. The acceptance evidence uses bounded sequential runs; it does not claim a latency SLA under arbitrary host load.

## Container reproduction

After the recorded Phase 8 capture described in [FOCUS_V2_LIVE_TESTING.md](FOCUS_V2_LIVE_TESTING.md):

```sh
docker build --build-arg NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true -t focus-phase10-temporal .
node scripts/verify-temporal-container.mjs
```

The script creates its own container and named volume, binds only `127.0.0.1:3402`, runs as the image's unprivileged user and limits the container to two CPUs and 2 GiB. Provider keys are empty and AI requests disabled. It uploads real footage, replays the previously captured plan/SAM result, then drives the actual browser, render API, comparison, preview and download. It checks packaged demo assets, byte ranges and encoded media, and removes its container, volume and temporary session-secret file afterward. A build with the feature enabled is started with the runtime flag set to false, checking the compiled flag behavior in standalone mode.

Artifacts are saved in `.focus-data/phase10/container/`: `report.json`, `editor.png`, `output.mp4` and `compare.mp4`. This is a replay of genuine provider responses with real production processing; no fresh Meta request is made by this script. The original fresh API evidence remains in Phase 8's `live-capture-report.json`.

## Scope and limitations

- The accepted interaction is manual trigger selection with a reliable fallback. Both geometric suggestions returned null for the real pedestrian clip. Automatic jump/peak suggestions are verified with synthetic decoded motion and job tests, not live action-recognition evidence.
- Echoes use source pixels in screen coordinates and assume a stable camera. Camera-motion compensation, world stabilization and generated content remain outside V2.
- The real sample is silent. Audio synchronization is verified separately using actual encoded swept-tone fixtures and audio-bearing load clips.
- SAM may miss a subject, merge similar instances or need another point. Low confidence or insufficient distinct history asks for manual correction/refinement; the renderer reports gaps/overlap rather than inventing silhouettes.
- Deployment state and queues remain local to one instance. This audit does not establish cloud/amd64 capacity or multi-instance coordination. Publication rights were not re-reviewed; [the historical v1 audit](RELEASE_READINESS.md) retains the owner's outstanding publication decisions.
- Time Freeze remains experimental and **off by default**. Enable it before a build or restart development with the explicit flag. See [activation and rollback](DEPLOYMENT.md#temporal-release-flag).
