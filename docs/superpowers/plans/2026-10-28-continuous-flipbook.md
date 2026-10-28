# Continuous Flipbook Implementation Plan

**Goal:** Deliver the approved continuous timeline, sound, character duplication
and uploaded movement-reference workflow in the existing Flipbook studio.

**Architecture:** Keep legacy cycles and ensembles intact. Add a sequence plan
with a 24 Hz absolute time grid; share its timing between preview and export.
Separate media ingestion and duplication from paid image generation.

**Tech stack:** Next.js 16.4.1, React 19, TypeScript, Zod, Sharp, FFmpeg, Vitest.
**Spec:** `docs/superpowers/specs/2026-10-28-continuous-flipbook-design.md`.
**Execution:** Native in this session, following the user's approved design.

## Constraints and review focus

- Preserve all pre-existing working-tree edits and legacy saved data.
- 1–20 whole seconds; 8/12/24 drawings/s; default 4 s at 24 drawings/s.
- 60 fps MP4 output; no automatic repetition inside sequence content.
- Bound image generation to two concurrent calls and retain completed work.
- Show full drawing counts before explicit generation; do not run paid tests.
- Test late/out-of-order worker results, density changes at common ticks,
  short/offset audio, copied media after original deletion, and untrusted media.

## Task 1: Sequence contracts and timing

Files: `shared/flipbook.ts`, new `shared/sequence.ts`,
`shared/sequence.test.ts`.

Interfaces: `SequenceSettingsSchema`; `sequenceTicks(settings): number[]`;
`sequenceFrameId(tick): string`; sequence plan mode and timestamped poses.

- [ ] Add tests for 96/480 samples, shared 8/12/24 Hz ticks, strict IDs,
  exact finite timing, and legacy-cycle parsing.
- [ ] Add bounded sequence contracts without changing legacy frame IDs.
- [ ] Verify with `pnpm exec vitest run shared/sequence.test.ts shared/flipbook.test.ts`.

## Task 2: Planning, generation and revisions

Files: new `server/animation/sequence-planning.ts`; existing
`server/animation/flipbooks.ts`, `frame-generation.ts`, `pose-planning.ts`,
`store.ts`, `app/api/flipbooks/[id]/route.ts`; sequence lifecycle tests.

Interfaces: `planSequence(input): Promise<FlipbookPlan>`;
`reviseSequence(id, settings, gate): Promise<Flipbook>`; generation reuses
existing `generateMissing` and per-frame version storage.

- [ ] Test windowed absolute-time planning, continuity, budget reservation,
  cancellation/retry and reuse of drawings at identical ticks.
- [ ] Add sequence skeletons, bounded scheduling and stable revision snapshots.
- [ ] Preserve staging positions with ensemble-style registration and avoid
  last-to-first neighbors in finite sequences.
- [ ] Verify sequence lifecycle and existing cycle/ensemble tests.

## Task 3: Full timeline and exports

Files: `app/flipbook/{flipbook-create,flipbook-editor,sequence-player,
frame-strip,export-panel,frame-panel}.tsx`, `server/animation/export.ts`.

Interfaces: sequence creation options, complete drawing selection, persisted
timeline revisions and finite exposure settings shared with exporter.

- [ ] Add finite timing/export tests and check the first/last output frames.
- [ ] Show mode, duration, density, pending counts and all timestamped drawings.
- [ ] Bound sprite cache and thumbnail window; stop finite playback at end.
- [ ] Page large atlases and stream frame files; retain legacy exports.
- [ ] Clarify individual-frame correction and collapse technical metrics.

## Task 4: Sound

Files: new `server/animation/flipbook-audio.ts`,
`app/api/flipbooks/[id]/audio/route.ts`, `app/flipbook/audio-panel.tsx`;
shared contracts, player, exporter and client API.

Interfaces: upload/read/remove track; audio settings `{version, offset,
startsAt, volume}`; normalized AAC input to export.

- [ ] Test detected media, byte limits, short/long/offset audio and cache keys.
- [ ] Persist per-project tracks and integrate synchronized preview controls.
- [ ] Mux audio to exact MP4 duration; label silent formats accurately.

## Task 5: Duplicate with another character

Files: new `server/animation/duplicate.ts`,
`app/api/flipbooks/[id]/duplicate/route.ts`,
`app/flipbook/duplicate-panel.tsx`; client API and lifecycle tests.

Interfaces: `duplicateFlipbook(source, target, ownerId): Promise<Flipbook>`;
target is an uploaded image or an owned saved-character version.

- [ ] Test distinct IDs, renewed identity, unchanged movement and original,
  independently copied background/audio/reference assets and access checks.
- [ ] Prepare the copy without drawing automatically; open it in the studio.

## Task 6: Uploaded movement reference

Files: new `server/animation/motion-reference.ts`,
`app/api/flipbooks/[id]/motion/route.ts`,
`app/flipbook/motion-reference-panel.tsx`; sequence planner and generation.

Interfaces: upload validated local MP4/MOV, choose start/duration, persist
24 Hz guide samples and pass matching guides with identity kept separate.

- [ ] Test trimming, rotation, timestamps, source audio selection, invalid
  files and network/playlist rejection; prior plans survive failures.
- [ ] Add preview/trim/attach UI, plan revision and per-frame guide images.
- [ ] Mark model fidelity as requiring a real authorized visual test.

## Task 7: Integration verification

- [ ] Run TypeScript, ESLint and affected Vitest suites; fix regressions.
- [ ] Exercise the local studio with simulated generation, desktop/mobile
  timeline controls, sound and duplication.
- [ ] Update `docs/FLIPBOOK.md` with actual shipped behavior and limits.
- [ ] Review the final diff against the approved spec and report remaining
  visual/provider validation separately from automated correctness.
