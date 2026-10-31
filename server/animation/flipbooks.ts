import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import sharp from "sharp";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { copyMediaFile as copyFile } from "../storage-budget";
import { Readable } from "node:stream";
import {
  FRAME_IDS,
  MAX_EXTRA_REFERENCES,
  WALK_POSES,
  ensembleDrawings,
  frameIdAt,
  actionSpec,
  flipbookTitle,
  flipbookUrls,
  inbetweenAfter,
  inbetweenTargets,
  denseInbetweenTargets,
  currentInbetweenPlan,
  gapShares,
  inbetweenProgress,
  inbetweenCurrent,
  plannedInbetweenTargets,
  nextInOrder,
  orderedFrames,
  exposureSheet,
  repairableFrames,
  playbackCycle,
  currentMotionCheck,
  maxPlannedInbetweens,
  type MotionCheck,
  type MotionFix,
  type CreateEnsembleRequest,
  type DrawingId,
  type FlipbookPlan,
  type Inbetween,
  type InbetweenId,
  type InbetweenTarget,
  type DrawingFps,
  type ExportRecord,
  type ExportRequest,
  type Flipbook,
  type FlipbookBackground,
  type FlipbookSummary,
  type ImageLook,
  type PlaybackSettings,
  ImageLookSchema,
  type FlipbookFrame,
  type CycleAction,
  type BackgroundMotion,
  type FrameAction,
  type FrameId,
  importedFromLabel,
  type ImportedFrom,
  type FrameWarning,
} from "../../shared/flipbook";
import type { ApplyPoseChangesRequest } from "../../shared/flipbook-chat";
import { AppError } from "../errors";
import type { CharacterSource } from "../../shared/characters";
import { shareRender } from "./render-tasks";
import { animationCharacterSource } from "../characters/flipbook-source";
import { CameraViewSchema, cameraDescription, phaseForView, resolveCameraView, type ViewPreference } from "../../shared/animation-view";
import { PoseIdSchema, type PoseId } from "../../shared/pose-library";
import { Limiter } from "../ai/meta";
import { activeWorkCount, type PaidWorkGate } from "../jobs";
import { assessInput, analyzeCharacter, lookAtImage } from "./character-analysis";
import { computeAlignment, computeEnsembleAlignment, computeTimedAlignment, extractKeyed, extractSubject, MeasureSchema, renderSprite, type AlignInput, type Measure } from "./frame-alignment";
import { stationaryBodyColors, type BodyColors } from "./appearance-consistency";
import { renderExport } from "./export";
import { drawEnsembleFrame, drawInbetween, drawPose } from "./frame-generation";
import { SkeletonRefused, measureMove, skeletonCacheDir, skeletonFromNeighbor, skeletonFollow, skeletonInbetween, skeletonInbetweensEnabled, type KeyDrawing } from "./skeleton-inbetween";
import { planInbetweenTiming, silhouetteChange, type GapMeasure } from "./inbetween-planning";
import { keyFit, measureLoop, motionFixRequest, type SpriteOf } from "./motion-check";
import { proposeChange } from "./chat";
import { guideSetup } from "./onboarding";
import type { GuideMessage, GuideReply } from "../../shared/flipbook-onboarding";
import { videoPoseTrack } from "./video-pose";
import { ensembleView, groupConcepts, mergeAnalyses, planEnsemble, type CastEntry } from "./ensemble-planning";
import { loadPoseReference } from "./pose-references";
import { compatiblePoseId } from "./pose-catalog";
import { decodeImage, getCharacterImage, imageFiles, readUpload } from "./image-input";
import { actionFor, pacedPlan, planPoses } from "./pose-planning";
import { planSequence, planSkeleton, sequenceSkeleton } from "./sequence-planning";
import { planPoseToPose } from "./pose-to-pose-planning";
import { poseToPoseEnabled } from "../../shared/features";
import { inbetweenTasks, keyIndexes, liftTrack } from "../../shared/timing-chart";
import { SequenceSettingsSchema, type SequenceSettings } from "../../shared/sequence";
import { videoAnimationPrompt } from "../../shared/animation-prompt";
import { normalizeTrack, prepareExportTrack, trackPath } from "./flipbook-audio";
import { motionDir, motionGuide } from "./motion-reference";
import { computeGuidedAlignment, guideSprite, guideTrack, motionWarnings } from "./motion-registration";
import { sequenceAnchorIndexes } from "./motion-continuity";
import { checkFrames, contactSheet, reviewFrames } from "./quality-control";
import { FAR_CONCEPTS, castSheet, decideReference, growMask, drawBackdrop, drawCleanReference, drawScenePlate, readReference, restoreScene, seamlessPlate, splitDepth, storeReference, subjectMask } from "./reference-manager";
import type { VideoAsset } from "../../shared/schemas";
import { ingestVideo } from "../videos";
import {
  abortWorker,
  allFlipbooks,
  assertFlipbookEnabled,
  type BackgroundFile,
  cleanupFlipbooks,
  createState,
  flipbookDir,
  flipbookFiles,
  getFlipbook,
  isRunning,
  newVersionId,
  parseFlipbookId,
  readJsonFile,
  startWorker,
  updateFlipbook,
  writeAtomic,
} from "./store";

// Focus Flipbook orchestration:
//
//   upload → Muse Spark analysis → Muse Spark pose plan → character anchor
//   → eight Muse Image drawings (anchored) → key cut-outs (SAM 3.1 only as the fallback) → registration
//   → quality checks → playable cycle → verified exports
//
// Every paid call is bounded by a per-flipbook image budget and the shared
// abuse guards; going past the budget always takes an explicit confirmation.
// A frame that could not be drawn or cut out stays failed and visible; the
// cycle is never padded with a moved copy of another drawing.

/** Replaceable in tests so no paid request ever runs there. */
export const services = {
  describe: lookAtImage,
  analyze: analyzeCharacter,
  plan: planPoses,
  planSequence,
  planPoseToPose,
  planEnsemble,
  draw: drawPose,
  drawEnsemble: drawEnsembleFrame,
  inbetween: drawInbetween,
  /** In-betweens moved from the keys' skeleton instead of drawn; null turns it off (tests, hosts without the pose tool). */
  skeleton: skeletonInbetweensEnabled() ? skeletonInbetween : null,
  /** An in-between moved from a finished in-between next to it in the same gap; null like `skeleton`. */
  skeletonNeighbor: skeletonInbetweensEnabled() ? skeletonFromNeighbor : null,
  /** How far the body moves between two keys, read from their skeletons; null where the pose tool isn't available. */
  measureMove: skeletonInbetweensEnabled() ? measureMove : null,
  /** Muse Spark decides the cycle's speed and each gap's in-betweens from the measured movement. */
  planInbetweens: planInbetweenTiming,
  /** The guided setup's conversation after an upload. */
  guide: guideSetup,
  /** A drawing of a movement video moved from the nearest key along the video's pose; null turns it off like `skeleton`. */
  follow: skeletonInbetweensEnabled() ? skeletonFollow : null,
  /** The video's pose at every tick. */
  videoTrack: skeletonInbetweensEnabled() ? videoPoseTrack : null,
  poseReference: loadPoseReference,
  cleanReference: drawCleanReference,
  scene: drawScenePlate,
  backdrop: drawBackdrop,
  review: reviewFrames,
  /** Muse Spark's correction of the jumps the motion check measured. */
  motionFix: proposeMotionFix,
};

/** Described motion is planned pose to pose; a wave and an idle keep their own sequence planning. */
function posedToPose(action: CycleAction): boolean {
  return poseToPoseEnabled() && action !== "wave" && action !== "idle";
}

export function imageBudget(): number {
  const value = Number(process.env.FOCUS_FLIPBOOK_IMAGE_BUDGET);
  return Number.isInteger(value) && value > 0 ? value : 16;
}

const exportLimiter = ((globalThis as { __focusFlipbookExport?: Limiter }).__focusFlipbookExport ??= new Limiter(1));
// 6: continuous root travel and position-aware, dense in-betweens.
const EXPORT_VERSION = 9;
type ExportOptions = { readonly signal?: AbortSignal; readonly beforeRender?: () => void };

function skeleton(): FlipbookFrame[] {
  return WALK_POSES.map((pose, index) => ({
    id: FRAME_IDS[index],
    poseIndex: index,
    phase: pose.phase,
    label: pose.label,
    status: "pending",
    approved: false,
    version: null,
    originalVersion: null,
    versions: [],
    metrics: null,
    warnings: [],
    review: null,
    error: null,
  }));
}

/** The empty drawings of a scene: one per beat, named when the plan arrives. */
function ensembleSkeleton(count: number): FlipbookFrame[] {
  return Array.from({ length: count }, (_, index) => ({
    id: frameIdAt(index),
    poseIndex: index,
    phase: `beat_${index}` as FlipbookFrame["phase"],
    label: `Drawing ${index + 1}`,
    status: "pending" as const,
    approved: false,
    version: null,
    originalVersion: null,
    versions: [],
    metrics: null,
    warnings: [],
    review: null,
    error: null,
  }));
}

const RESTING = new Set<Flipbook["status"]>(["awaiting_motion", "reference_ready", "ready", "failed", "unsupported", "canceled"]);

function assertIdle(flipbook: Flipbook): void {
  if (isRunning(flipbook.id)) throw new AppError("flipbook_busy", 409, "This animation is still working. Wait for the current step to finish.");
  if (!RESTING.has(flipbook.status)) throw new AppError("flipbook_not_editable", 409, "This animation can’t be changed now.");
}

/** Cycle-only features (in-betweens, reordering, a changed reference): a scene's drawings are fixed beats of one choreography. */
function assertScenelessCycle(flipbook: Flipbook, what: string): void {
  if (flipbook.sequence) throw new AppError("not_for_sequences", 409, `${what} is for repeated cycles. Edit the sequence's timed drawings instead.`);
  if (flipbook.cast.length) throw new AppError("not_for_scenes", 409, `${what} isn’t available for a scene with several characters. Redraw a drawing instead.`);
}

/**
 * Muse Image can draw for this flipbook. Imported frames have
 * no pose plan to draw from: they can be replaced or given a background, not
 * redrawn, unless the call says the work doesn't draw poses.
 */
function assertDrawable(flipbook: Flipbook, options: { allowImported?: boolean } = {}): asserts flipbook is Flipbook & { plan: NonNullable<Flipbook["plan"]>; reference: NonNullable<Flipbook["reference"]> } {
  if (!flipbook.plan || !flipbook.reference) throw new AppError("flipbook_not_ready", 409, "The character reference isn’t ready yet.");
  if (flipbook.importedFrom && !options.allowImported) throw new AppError("imported_frames", 409, importedFramesMessage(flipbook.importedFrom));
}

/** Why an imported frame can't be redrawn, said for the import it came from. */
function importedFramesMessage(importedFrom: ImportedFrom): string {
  const again = importedFrom.kind === "reference-motion" ? ", or render the motion again" : "";
  return `These frames come from ${importedFromLabel(importedFrom)}. Replace or reorder them${again}.`;
}

/** Where a run lands when it fails: back to the last usable resting state. */
const failWith = (error: AppError) => (current: Flipbook): Flipbook => ({
  ...current,
  status: current.plan && current.reference ? (current.frames.some((frame) => frame.status === "ready") ? "ready" : "reference_ready") : "failed",
  frames: current.frames.map((frame) => (frame.status === "generating" || frame.status === "processing" ? { ...frame, status: "failed", error: { code: error.code, message: error.message } } : frame)),
  inbetweens: current.inbetweens.map((entry) => (entry.status === "generating" || entry.status === "processing" ? { ...entry, status: "failed", error: { code: error.code, message: error.message } } : entry)),
  error: { code: error.code, message: error.message },
});

/** A change from a worker: dropped once that worker was canceled. */
function workerUpdate(id: string, signal: AbortSignal, change: (current: Flipbook) => Flipbook): Promise<Flipbook> {
  return updateFlipbook(id, (current) => (signal.aborted ? current : change(current)));
}

function patchFrame(current: Flipbook, frameId: string, change: (frame: FlipbookFrame) => FlipbookFrame): Flipbook {
  return { ...current, frames: current.frames.map((frame) => (frame.id === frameId ? change(frame) : frame)) };
}

function patchInbetween(current: Flipbook, inbetweenId: InbetweenId, change: (entry: Inbetween) => Inbetween): Flipbook {
  return { ...current, inbetweens: current.inbetweens.map((entry) => (entry.id === inbetweenId ? change(entry) : entry)) };
}

// ── Budget ─────────────────────────────────────────────────────────────────

/**
 * Takes `count` drawings from the flipbook's budget before they are paid for.
 * Past the budget, only an explicit confirmation lets the work through, and
 * it extends the budget by exactly what was confirmed.
 */
function assertImageAllowance(current: Flipbook, count: number, confirmExtra: boolean): void {
  if (current.budget.used + count > current.budget.limit && !confirmExtra) {
    throw new AppError(
      "budget_reached",
      402,
      `This animation has used ${current.budget.used} of its ${current.budget.limit} drawings. Confirm to draw ${count} more.`,
    );
  }
}

async function reserveImages(id: string, count: number, confirmExtra: boolean): Promise<void> {
  await updateFlipbook(id, (current) => {
    assertImageAllowance(current, count, confirmExtra);
    const next = current.budget.used + count;
    return { ...current, budget: { limit: Math.max(current.budget.limit, next), used: next } };
  });
}

/**
 * Meta does not bill drawings that fail or are blocked. A timeout, a cancel or
 * an image we couldn't read may still have been billed, so those stay counted.
 */
export function unbilled(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  return ["image_blocked", "image_incomplete", "meta_bad_request", "meta_unauthorized", "meta_forbidden", "meta_model_not_found", "meta_rate_limited", "meta_unreachable", "meta_unavailable", "meta_not_configured", "ai_disabled"].includes(error.code);
}

/** Puts drawings that were never billed back into the budget. */
function refundImages(id: string, count: number): Promise<unknown> {
  if (count <= 0) return Promise.resolve();
  return updateFlipbook(id, (current) => ({ ...current, budget: { ...current.budget, used: Math.max(0, current.budget.used - count) } }), { evenIfCanceled: true }).catch(() => undefined);
}

// ── Create and run ─────────────────────────────────────────────────────────

export async function createFlipbook(
  input: { readonly imageId?: string; readonly characterSource?: CharacterSource; readonly view?: ViewPreference; readonly prompt: string; readonly ownerId?: string | null; readonly action?: CycleAction; readonly poseId?: PoseId; readonly keepScene?: boolean; readonly sequence?: SequenceSettings; readonly motionSource?: "video"; readonly motionNote?: string },
  gate?: PaidWorkGate,
): Promise<Flipbook> {
  assertFlipbookEnabled();
  const sequence = input.sequence ? SequenceSettingsSchema.parse(input.sequence) : undefined;
  const fromVideo = input.motionSource === "video";
  if (fromVideo && (!sequence || input.action || input.poseId || input.view)) throw new AppError("invalid_motion_source", 400, "Video movement needs a continuous sequence without preset motion or camera overrides.");
  if (input.poseId !== undefined && (!PoseIdSchema.safeParse(input.poseId).success || !CameraViewSchema.options.some((view) => compatiblePoseId(input.poseId, "idle", view) === input.poseId) || (input.action && input.action !== "idle"))) {
    throw new AppError("invalid_pose", 400, "This posture isn’t compatible with the animation. Try describing the movement again.");
  }
  const savedCharacter = input.characterSource ? await animationCharacterSource(input.characterSource, input.ownerId) : null;
  if (!savedCharacter && !input.imageId) throw new AppError("image_not_found", 404, "Choose an image or a saved character.");
  const uploaded = savedCharacter ? null : await getCharacterImage(input.imageId!);
  const image = savedCharacter?.image ?? uploaded!.image;
  void cleanupFlipbooks();
  // A motion picked from the reading reuses its character facts: no second look.
  const action = input.poseId ? "idle" : input.action;
  const reading = action && !savedCharacter ? await readLook(image.id) : null;
  const analysis = reading && action ? { ...reading.analysis, requestedAction: action } : null;
  const keepScene = Boolean(input.keepScene && !image.hasAlpha && (reading ? reading.layers.scene : true));
  // Analysis + plan + up to nine drawings, each cut out by SAM on one still frame; with the scene, its plate and depth layers too.
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: WALK_POSES.length + 1 + (keepScene ? 1 + FAR_CONCEPTS.length : 0) });
  const id = randomUUID();
  await mkdir(flipbookDir(id), { recursive: true });
  if (savedCharacter) {
    await writeAtomic(flipbookFiles.source(id), savedCharacter.png);
    await writeAtomic(flipbookFiles.sourceFlat(id), savedCharacter.flat);
    await writeAtomic(flipbookFiles.identity(id), savedCharacter.identity);
  } else {
    await copyFile(uploaded!.png, flipbookFiles.source(id));
    await copyFile(uploaded!.flat, flipbookFiles.sourceFlat(id));
  }
  const now = new Date().toISOString();
  const flipbook = await createState({
    id,
    imageId: image.id,
    ownerId: input.ownerId ?? null,
    ...(savedCharacter ? { characterSource: savedCharacter.origin } : {}),
    cast: [],
    ...(input.view ? { requestedView: input.view } : {}),
    title: flipbookTitle({ title: "", prompt: input.prompt }),
    prompt: input.prompt,
    ...(input.poseId ? { poseId: input.poseId } : {}),
    status: fromVideo ? "awaiting_motion" : "analyzing",
    detail: fromVideo ? "Add and apply your video segment to prepare its movement." : analysis ? "Planning the poses" : "Analyzing your character with Muse Spark",
    ...(fromVideo ? { motionSource: "video" as const, motionNote: input.motionNote, requestedKeepScene: keepScene } : {}),
    progress: null,
    source: { width: image.width, height: image.height, hasAlpha: image.hasAlpha },
    analysis,
    ...(sequence ? { sequence } : {}),
    plan: null,
    warnings: [],
    reference: null,
    extraReferences: [],
    frames: sequence ? sequenceSkeleton(sequence) : skeleton(),
    order: sequence ? sequenceSkeleton(sequence).map((frame) => frame.id) : [...FRAME_IDS],
    alignment: null,
    inbetweens: [],
    budget: { limit: imageBudget(), used: 0 },
    backgrounds: { scene: false, custom: false, reference: false, generated: null, depth: { scene: false, generated: false } },
    look: null,
    review: null,
    exports: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  if (!fromVideo) startWorker(id, (signal) => runPipeline(id, signal, { keepScene, fromReading: Boolean(analysis), action }), failWith);
  return flipbook;
}

/**
 * A flipbook made of frames rendered elsewhere (Reference Motion): one drawing
 * per tick of a 24-per-second sequence, in order. Nothing is drawn: each frame
 * is cut out from its own flat background without SAM, registered at the
 * place it was rendered (a fixed camera), and checked like any drawing. A
 * frame that can't be cut out fails on its own, with its reason. Private to
 * the account that imported it.
 */
export async function importSequence(input: {
  readonly ownerId: string;
  readonly title: string;
  /** The character the frames were rendered from: the reference for color checks. */
  readonly character: Buffer;
  /** One PNG path per tick, in playback order. Transparent pixels are already-cut background (SAM masks). */
  readonly frames: readonly string[];
  readonly sequence: SequenceSettings;
  readonly importedFrom: ImportedFrom;
  /** The render's own soundtrack, kept as the flipbook's audio. */
  readonly audio?: { readonly file: string; readonly name: string };
}): Promise<Flipbook> {
  assertFlipbookEnabled();
  const sequence = SequenceSettingsSchema.parse(input.sequence);
  const slots = sequenceSkeleton(sequence);
  if (input.frames.length !== slots.length) throw new AppError("import_mismatch", 422, `The render has ${input.frames.length} frames; ${sequence.durationSeconds} s at ${sequence.drawingFps} drawings/s needs ${slots.length}.`);
  const character = await decodeImage(input.character);
  const first = await sharp(input.frames[0]).metadata();
  void cleanupFlipbooks();
  const id = randomUUID();
  await mkdir(flipbookDir(id), { recursive: true });
  await writeAtomic(flipbookFiles.source(id), character.png);
  await writeAtomic(flipbookFiles.sourceFlat(id), character.flat);
  const referenceVersion = newVersionId();
  await writeAtomic(flipbookFiles.reference(id, referenceVersion), character.flat);
  try {
    const { measure } = await extractSubject({ png: character.flat, concept: "character", flipbookId: id, allowAlpha: false, useSegmentation: false });
    await writeAtomic(flipbookFiles.referenceMeasure(id, referenceVersion), JSON.stringify(measure));
  } catch {
    // No flat background to measure: the color checks skip this reference.
  }
  const now = new Date().toISOString();
  const frames: FlipbookFrame[] = [];
  for (const [index, slot] of slots.entries()) {
    const version = newVersionId();
    const dir = flipbookFiles.versionDir(id, slot.id, version);
    await mkdir(dir, { recursive: true });
    await copyFile(input.frames[index], path.join(dir, "raw.png"));
    frames.push({ ...slot, status: "processing", version, versions: [{ id: version, source: "imported", createdAt: now }] });
  }
  const portrait = (first.height ?? 0) > (first.width ?? 0);
  let audio: NonNullable<Flipbook["audio"]> | undefined;
  if (input.audio) {
    const version = createHash("sha256").update(`${id}:audio`).digest("hex").slice(0, 12);
    const target = trackPath(id, version);
    await mkdir(path.dirname(target), { recursive: true });
    audio = { version, name: input.audio.name.slice(0, 120), durationSeconds: await normalizeTrack(input.audio.file, target), offset: 0, startsAt: 0, volume: 1 };
  }
  const flipbook = await createState({
    id,
    imageId: randomUUID(),
    ownerId: input.ownerId,
    importedFrom: input.importedFrom,
    cast: [],
    title: input.title.slice(0, 80),
    prompt: `Imported from ${importedFromLabel(input.importedFrom)}.`,
    status: "preparing",
    detail: "Cutting out the imported frames",
    progress: { done: 0, total: frames.length },
    source: { width: character.width, height: character.height, hasAlpha: character.hasAlpha },
    analysis: null,
    sequence,
    ...(audio ? { audio } : {}),
    plan: {
      mode: "sequence",
      action: "dance",
      direction: "right",
      motion: "in_place",
      drawingFps: sequence.drawingFps,
      durationSeconds: sequence.durationSeconds,
      loop: false,
      poses: slots.map((slot, index) => ({ index, phase: slot.phase, label: slot.label, description: `Imported ${importedFromLabel(input.importedFrom)} frame.`, relativeRootY: 0, lift: 0 })),
    },
    warnings: input.importedFrom.kind === "reference-motion" && input.importedFrom.synthetic ? ["These frames come from the test engine: a pipeline check, not an animation of the character."] : [],
    reference: { kind: "original", version: referenceVersion, reason: "The character the motion was rendered from.", createdAt: now },
    extraReferences: [],
    frames,
    order: frames.map((frame) => frame.id),
    alignment: null,
    inbetweens: [],
    budget: { limit: 0, used: 0 },
    backgrounds: { scene: false, custom: false, reference: false, generated: null, depth: { scene: false, generated: false } },
    look: { settings: { ...sequence, aspect: portrait ? "9:16" : "16:9", speed: 1, motion: "in_place", smoothing: 0 }, background: { kind: "color", color: "#ffffff" } },
    review: null,
    exports: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  startWorker(id, (signal) => cutOut(id, signal, frames.map((frame) => frame.id)), failWith);
  return flipbook;
}

/**
 * A scene: several saved characters drawn together, as long as the person
 * asked. The length is the duration at a fixed pace (ENSEMBLE_FPS), so asking
 * for more seconds means more drawings. Starting it is the confirmation of
 * their cost: the budget opens to cover them, and anything past that (a
 * redraw) asks again.
 */
export async function createEnsemble(input: CreateEnsembleRequest & { readonly ownerId?: string | null }, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const members = await Promise.all(input.cast.map((source) => animationCharacterSource(source, input.ownerId)));
  const drawings = ensembleDrawings(input.seconds);
  // Reading each character, the plan, every drawing, and up to two SAM looks at each drawing for the group.
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: drawings * 2 + members.length + 1 });
  void cleanupFlipbooks();
  const id = randomUUID();
  await mkdir(flipbookDir(id), { recursive: true });
  await Promise.all(members.map((member, index) => writeAtomic(flipbookFiles.cast(id, index), member.flat)));
  // The lineup stands in for the upload: it is the poster, and the reference every drawing is checked against.
  const sheet = await castSheet(members.map((member) => member.flat));
  await writeAtomic(flipbookFiles.source(id), sheet.png);
  await writeAtomic(flipbookFiles.sourceFlat(id), sheet.png);
  const now = new Date().toISOString();
  const frames = ensembleSkeleton(drawings);
  const flipbook = await createState({
    id,
    imageId: members[0].image.id,
    ownerId: input.ownerId ?? null,
    cast: members.map((member) => ({ characterId: member.origin.characterId, versionId: member.origin.versionId, name: member.origin.name, versionName: member.origin.versionName, analysis: null })),
    ...(input.view ? { requestedView: input.view } : {}),
    title: flipbookTitle({ title: "", prompt: input.prompt }),
    prompt: input.prompt,
    status: "analyzing",
    detail: "Reading the characters with Muse Spark",
    progress: null,
    source: { width: sheet.width, height: sheet.height, hasAlpha: false },
    analysis: null,
    plan: null,
    warnings: [],
    reference: null,
    extraReferences: [],
    frames,
    order: frames.map((frame) => frame.id),
    alignment: null,
    inbetweens: [],
    budget: { limit: Math.max(imageBudget(), drawings), used: 0 },
    backgrounds: { scene: false, custom: false, reference: false, generated: null, depth: { scene: false, generated: false } },
    look: null,
    review: null,
    exports: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  startWorker(id, (signal) => runEnsemble(id, signal, input.seconds), failWith);
  return flipbook;
}

/** The characters of a scene as the drawings receive them: their own images, with what Muse Spark saw in each. */
async function readCast(flipbook: Pick<Flipbook, "id" | "cast">): Promise<(CastEntry & { readonly png: Buffer })[]> {
  return Promise.all(flipbook.cast.map(async (member, index) => {
    const png = await readFile(flipbookFiles.cast(flipbook.id, index)).catch(() => null);
    if (!png) throw new AppError("character_missing", 409, `${member.name}’s image is missing. Start the scene again.`);
    return { name: member.name, versionName: member.versionName, analysis: member.analysis, png };
  }));
}

async function runEnsemble(id: string, signal: AbortSignal, seconds: number): Promise<void> {
  const flipbook = await getFlipbook(id);
  const images = await readCast(flipbook);
  const analyses = await Promise.all(images.map((entry) => services.analyze({ imagePng: entry.png, prompt: flipbook.prompt, flipbookId: id, signal })));
  if (signal.aborted) return;
  const missing = analyses.findIndex((analysis) => analysis.characterCount === 0);
  if (missing >= 0) {
    await workerUpdate(id, signal, (current) => ({ ...current, status: "unsupported", error: { code: "unsupported_animation", message: `We couldn’t find a character in ${images[missing].name}’s image. Pick another version.` } }));
    return;
  }
  const warnings = analyses.flatMap((analysis, index) => (!analysis.fullBodyVisible || !analysis.feetVisible ? [`${images[index].name}’s full body isn’t visible. Unseen parts will be invented, so they may not match the design.`] : [])).slice(0, 8);
  const cast = images.map((entry, index) => ({ ...entry, analysis: analyses[index] }));
  await workerUpdate(id, signal, (current) => ({
    ...current,
    cast: current.cast.map((member, index) => ({ ...member, analysis: analyses[index] })),
    analysis: mergeAnalyses(analyses),
    warnings,
    status: "planning",
    detail: `Planning ${ensembleDrawings(seconds)} drawings of the scene with Muse Spark`,
  }));

  const plan = await services.planEnsemble({ cast, images: images.map((entry) => entry.png), prompt: flipbook.prompt, seconds, view: ensembleView(flipbook.requestedView), flipbookId: id, signal });
  if (signal.aborted) return;
  const version = newVersionId();
  await writeAtomic(flipbookFiles.reference(id, version), await readFile(flipbookFiles.sourceFlat(id)));
  await workerUpdate(id, signal, (current) => ({
    ...current,
    plan,
    frames: current.frames.map((frame) => ({ ...frame, phase: plan.poses[frame.poseIndex].phase, label: plan.poses[frame.poseIndex].label })),
    reference: { kind: "original", version, reason: "The characters lined up as saved. Every drawing is made from each one’s own image.", createdAt: new Date().toISOString() },
    status: "generating",
    detail: "Drawing the scene with Muse Image",
  }));
  const frameIds = (await getFlipbook(id)).order;
  await reserveImages(id, frameIds.length, false);
  await drawEnsembleFrames(id, signal, frameIds, {});
}

async function runPipeline(id: string, signal: AbortSignal, options: { keepScene: boolean; fromReading: boolean; action?: CycleAction; retry?: boolean; confirmExtra?: boolean }): Promise<void> {
  const flipbook = await getFlipbook(id);
  // Fail before paid model work if the selected posture cannot be retrieved.
  if (flipbook.poseId) await services.poseReference(flipbook.poseId, signal);
  const sourceFlat = await readFile(flipbookFiles.sourceFlat(id));

  const analyzed = flipbook.analysis ?? await services.analyze({ imagePng: sourceFlat, prompt: flipbook.prompt, flipbookId: id, signal });
  const fromVideo = Boolean(flipbook.motionReference && flipbook.sequence);
  const action = fromVideo ? undefined : flipbook.poseId ? "idle" : options.action;
  const analysis = action ? { ...analyzed, requestedAction: action } : analyzed;
  if (signal.aborted) return;
  const assessed = assessInput(analysis, { fromVideo });
  if (!assessed.supported) {
    await workerUpdate(id, signal, (current) => ({ ...current, analysis, status: "unsupported", error: { code: "unsupported_animation", message: assessed.reason! } }));
    return;
  }
  const initialFrames = flipbook.sequence && !flipbook.plan ? sequenceSkeleton(flipbook.sequence) : null;
  await workerUpdate(id, signal, (current) => ({ ...current, analysis, ...(initialFrames ? { frames: initialFrames, order: initialFrames.map((frame) => frame.id) } : {}), warnings: assessed.warnings, status: "planning", detail: flipbook.sequence ? `Planning ${initialFrames?.length ?? flipbook.frames.length} drawings across ${flipbook.sequence.durationSeconds} seconds` : `Planning eight ${actionSpec(actionFor(analysis)).label} poses with Muse Spark` }));

  const proposedPlan = options.retry && flipbook.plan ? flipbook.plan : flipbook.sequence
    ? !fromVideo && posedToPose(action ?? actionFor(analysis))
      ? await services.planPoseToPose({ analysis, prompt: flipbook.prompt, flipbookId: id, settings: flipbook.sequence, view: flipbook.requestedView, action, signal })
      : await services.planSequence({ analysis, prompt: flipbook.prompt, flipbookId: id, settings: flipbook.sequence, view: fromVideo ? undefined : flipbook.requestedView, action, guide: fromVideo ? (tick) => motionGuide(id, flipbook.motionReference!, tick) : undefined, signal })
    : await services.plan({ analysis, prompt: flipbook.prompt, flipbookId: id, imagePng: sourceFlat, poseId: flipbook.poseId, view: flipbook.requestedView, signal });
  // Manual motion keeps the chosen camera; video motion takes its observed
  // camera from the plan instead of imposing the illustration's orientation.
  const cameraView = fromVideo ? proposedPlan.view ?? resolveCameraView(undefined, analysis) : resolveCameraView(flipbook.requestedView, analysis, flipbook.prompt);
  const plan = { ...proposedPlan, ...(flipbook.sequence ? { motionId: proposedPlan.motionId ?? randomUUID() } : {}), view: cameraView,
    poseId: compatiblePoseId(proposedPlan.poseId, proposedPlan.action, cameraView),
    poses: proposedPlan.poses.map((pose) => ({ ...pose, referenceId: compatiblePoseId(pose.referenceId, proposedPlan.action, cameraView), description: fromVideo ? pose.description : phaseForView(pose.description, cameraView) })),
  };
  if (signal.aborted) return;
  // A timing chart decides how many drawings there are and when.
  const timed = plan.timing && !(options.retry && flipbook.plan) ? planSkeleton(plan) : null;
  await workerUpdate(id, signal, (current) => ({
    ...current,
    plan,
    ...(timed ? { frames: timed, order: timed.map((frame) => frame.id) } : { frames: current.frames.map((frame) => ({ ...frame, phase: plan.poses[frame.poseIndex].phase, label: plan.poses[frame.poseIndex].label })) }),
    status: "referencing",
    detail: "Preparing the character reference",
  }));

  // The scene is redrawn without the character alongside the poses.
  const scene = options.keepScene ? separateScene(id, signal, plan) : Promise.resolve();
  try {
    const decision = decideReference(analysis, plan.view);
    if (decision.kind === "clean") await reserveImages(id, 1, options.confirmExtra === true);
    await prepareReference(id, decision, signal);
    if (signal.aborted) return;
    if (flipbook.sequence || options.retry) {
      await workerUpdate(id, signal, (current) => ({ ...current, status: "reference_ready", detail: `Motion ready. Generate ${current.frames.length} timed drawings to complete the clip.` }));
      return;
    }

    // Caveats about the input: let the person check the reference before
    // eight drawings are paid for, unless they already read them on the
    // upload. Otherwise keep going.
    if (assessed.warnings.length && !options.fromReading) {
      await workerUpdate(id, signal, (current) => ({ ...current, status: "reference_ready", detail: "Check the reference, then generate the frames." }));
      return;
    }
    await reserveImages(id, WALK_POSES.length, false);
    await drawFrames(id, signal, [...FRAME_IDS], {});
  } finally {
    await scene;
  }
}

/**
 * The uploaded scene without the character, drawn once and made the
 * animation's background: scrolling for a cycle in place, still for one that
 * travels. A failure is a caveat, never a failed animation.
 */
async function separateScene(id: string, signal: AbortSignal, plan: NonNullable<Flipbook["plan"]>): Promise<void> {
  try {
    await reserveImages(id, 1, true);
    const flipbook = await getFlipbook(id);
    let plate;
    try {
      plate = await services.scene({ sourceFlat: await readFile(flipbookFiles.sourceFlat(id)), analysis: flipbook.analysis, flipbookId: id, signal });
    } catch (error) {
      if (unbilled(error)) await refundImages(id, 1);
      throw error;
    }
    if (signal.aborted) return;
    const depth = await storePlate(id, "scene", await keptScene(id, flipbook, plate.png, signal), signal);
    const background: FlipbookBackground = { kind: "scene", motion: defaultMotion(plan, depth) };
    await workerUpdate(id, signal, (current) => ({
      ...current,
      backgrounds: { ...current.backgrounds, scene: true, depth: { ...current.backgrounds.depth, scene: depth } },
      // The scene was asked for: it becomes the background, whatever was picked while it was drawn.
      look: { settings: current.look?.settings ?? { drawingFps: plan.drawingFps, durationSeconds: plan.durationSeconds, motion: plan.motion, aspect: "16:9", speed: 1 }, background },
    }));
  } catch (error) {
    if (signal.aborted) return;
    if (!(error instanceof AppError)) console.error("[focus] flipbook scene separation failed", error);
    await workerUpdate(id, signal, (current) => ({ ...current, warnings: [...current.warnings, "The scene couldn’t be separated from the character. Use “Use your scene” to try again, or pick another background."].slice(-8) })).catch(() => undefined);
  }
}

/** The scene plate with the upload kept, pixel for pixel, everywhere but the character's place. */
async function keptScene(id: string, flipbook: Flipbook, png: Buffer, signal?: AbortSignal): Promise<Buffer> {
  const sourceFlat = await readFile(flipbookFiles.sourceFlat(id));
  return await restoreScene({ sourceFlat, plate: png, concept: flipbook.analysis?.subject ?? "character", flipbookId: id, signal }) ?? png;
}

/**
 * How a separated scene moves by default: in two depths (or sliding) behind
 * a walk or run on the spot, still behind one that travels, and a slow zoom
 * behind the motions that never travel (a jump, a wave, a breath, a fight).
 */
export function defaultMotion(plan: Pick<NonNullable<Flipbook["plan"]>, "action" | "motion" | "view">, depth: boolean): BackgroundMotion {
  if (!actionSpec(plan.action).travels) return "zoom";
  if (plan.motion !== "in_place") return "static";
  if (plan.view && plan.view !== "side" && plan.view !== "three_quarter") return "static";
  return depth ? "parallax" : "scroll";
}

/**
 * A scene or generated plate as drawn (still, zoom), as a seamless strip
 * (scrolling), and, when SAM finds a sky in the strip, as far and near
 * layers (parallax). Returns whether the layers exist; a failed split only
 * means no parallax.
 */
async function storePlate(id: string, which: "scene" | "generated", png: Buffer, signal?: AbortSignal): Promise<boolean> {
  const flat = (await decodeImage(png)).flat;
  const strip = await seamlessPlate(flat);
  await writeAtomic(flipbookFiles.background(id, which), flat);
  await writeAtomic(flipbookFiles.background(id, `${which}-loop`), strip);
  try {
    const layers = await splitDepth({ strip, flipbookId: id, signal });
    if (!layers) return false;
    await writeAtomic(flipbookFiles.background(id, `${which}-far`), layers.far);
    await writeAtomic(flipbookFiles.background(id, `${which}-near`), layers.near);
    return true;
  } catch (error) {
    if (signal?.aborted || (error instanceof AppError && error.code === "canceled")) throw error;
    console.warn("[focus] flipbook depth split failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Scenes made before scrolling existed get their strip on first use. */
export async function ensureSceneLoop(id: string): Promise<string> {
  const loop = flipbookFiles.background(id, "scene-loop");
  if (await stat(loop).catch(() => null)) return loop;
  await writeAtomic(loop, await seamlessPlate(await readFile(flipbookFiles.background(id, "scene"))));
  return loop;
}

async function prepareReference(id: string, decision: { kind: "original" | "clean" | "uploaded"; reason: string }, signal: AbortSignal, uploaded?: Buffer): Promise<void> {
  const flipbook = await getFlipbook(id);
  const version = newVersionId();
  const concept = flipbook.analysis?.subject ?? "character";
  await workerUpdate(id, signal, (current) => ({ ...current, status: "referencing", detail: decision.kind === "clean" ? "Drawing a clean side-view reference with Muse Image" : "Preparing the character reference" }));
  if (decision.kind === "clean") {
    let drawn;
    try {
      drawn = await services.cleanReference({ sourceFlat: await readFile(flipbookFiles.sourceFlat(id)), analysis: flipbook.analysis, direction: flipbook.plan?.direction ?? "right", view: flipbook.plan?.view, extras: await readExtras(flipbook), identityReference: flipbook.characterSource ? await readFile(flipbookFiles.identity(id)) : undefined, flipbookId: id, signal });
    } catch (error) {
      if (unbilled(error)) await refundImages(id, 1);
      throw error;
    }
    if (signal.aborted) return;
    await storeReference({ flipbookId: id, version, png: drawn.png, concept, allowAlpha: false, signal });
  } else if (decision.kind === "uploaded" && uploaded) {
    const decoded = await decodeImage(uploaded);
    await storeReference({ flipbookId: id, version, png: decoded.flat, measureFrom: decoded.png, concept, allowAlpha: decoded.hasAlpha, signal });
  } else {
    await storeReference({
      flipbookId: id,
      version,
      png: await readFile(flipbookFiles.sourceFlat(id)),
      measureFrom: flipbook.source.hasAlpha ? await readFile(flipbookFiles.source(id)) : undefined,
      concept,
      allowAlpha: flipbook.source.hasAlpha,
      signal,
    });
  }
  if (signal.aborted) return;
  await workerUpdate(id, signal, (current) => ({ ...current, reference: { kind: decision.kind, version, reason: decision.reason, createdAt: new Date().toISOString() }, error: null }));
}

/** The extra reference images, as sent beside the anchor. One that went missing is skipped, not fatal. */
async function readExtras(flipbook: Pick<Flipbook, "id" | "extraReferences">): Promise<Buffer[]> {
  const read = await Promise.all(flipbook.extraReferences.map((extra) => readFile(flipbookFiles.extraReference(flipbook.id, extra.version)).catch(() => undefined)));
  return read.filter((png) => png !== undefined);
}

/** What was found wrong with a drawing, in words the repair prompt can use. */
/** What the repair drawing carries when the animator marked it with a pencil. */
const MARKS_PROBLEM = "The animator drew RED pencil marks over Image 2 on the parts that are wrong. Keep everything that is not marked; redraw only the marked parts as the correction asks. The red marks are notes only: never draw them.";

/** The drawing with the animator's red marks over it, at the drawing's own size. */
async function markUp(drawing: Buffer, marks: Buffer): Promise<Buffer> {
  const { width, height } = await sharp(drawing).metadata();
  const overlay = await sharp(marks).resize(width, height, { fit: "fill" }).png().toBuffer();
  return sharp(drawing).composite([{ input: overlay }]).png().toBuffer();
}

function problemsOf(frame: FlipbookFrame): string[] {
  return [
    ...frame.warnings.map((warning) => warning.message),
    ...(frame.review?.issues ?? []).map((issue) => `${issue.code.replaceAll("_", " ")}: ${issue.note}`),
  ].map((text) => text.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 6);
}

/**
 * A cycle's drawings in pose-to-pose order, as rounds: the first drawing, the
 * one halfway round, then the quarters, the eighths and so on. Each round is
 * drawn between finished ones, so no key is guessed without its neighbors.
 */
export function poseToPoseRounds<T>(order: readonly T[], wanted: readonly T[]): T[][] {
  const rounds: T[][] = [];
  const placed = new Set<number>();
  for (let step = order.length; step >= 1; step = step === 1 ? 0 : Math.max(1, Math.floor(step / 2))) {
    const round: T[] = [];
    for (let at = 0; at < order.length; at += step) {
      if (placed.has(at)) continue;
      placed.add(at);
      if (wanted.includes(order[at])) round.push(order[at]);
    }
    if (round.length) rounds.push(round);
  }
  return rounds;
}

/**
 * Draws the given frames from the anchor (the budget is already reserved),
 * cuts them out, re-registers the cycle and checks it.
 */
async function drawFrames(id: string, signal: AbortSignal, frameIds: readonly FrameId[], options: { note?: string; withNeighbor?: boolean; repair?: boolean; marks?: Buffer; alsoCut?: readonly FrameId[]; /** The caller has more steps (a motion fix checks the keys, then plans the in-betweens): no automatic in-betweens, no resting state. */ stay?: true }): Promise<void> {
  const flipbook = await getFlipbook(id);
  assertDrawable(flipbook);
  if (flipbook.cast.length) return drawEnsembleFrames(id, signal, frameIds, options);
  const reference = await readReference(id, flipbook.reference.version);
  const extras = await readExtras(flipbook);
  const identityReference = flipbook.characterSource ? await readFile(flipbookFiles.identity(id)) : undefined;
  const poseReferences = new Map<PoseId, Buffer>();
  const guideIds = [...new Set(frameIds.map((id) => {
    const frame = flipbook.frames.find((entry) => entry.id === id)!;
    return compatiblePoseId(flipbook.plan.poseId ?? flipbook.plan.poses[frame.poseIndex].referenceId, flipbook.plan.action, flipbook.plan.view ?? "side");
  }).filter((id): id is PoseId => Boolean(id)))];
  let missingGuide = false;
  try {
    await Promise.all(guideIds.map(async (guideId) => {
      try { poseReferences.set(guideId, await services.poseReference(guideId, signal)); }
      catch (error) {
        if (signal.aborted || flipbook.poseId) throw error;
        missingGuide = true;
      }
    }));
  } catch (error) { await refundImages(id, frameIds.length); throw error; }
  if (missingGuide) {
    const warning = "A visual pose guide was unavailable. The drawings use the planned movement and posture descriptions.";
    await workerUpdate(id, signal, (current) => ({ ...current, warnings: current.warnings.includes(warning) ? current.warnings : [...current.warnings, warning].slice(0, 8) }));
  }
  const total = frameIds.length;
  let done = 0;
  await workerUpdate(id, signal, (current) => ({
    ...current,
    status: "generating",
    detail: total === 1 ? `${options.repair ? "Repairing" : "Redrawing"} “${current.frames.find((frame) => frame.id === frameIds[0])?.label}” with Muse Image` : "Drawing the poses with Muse Image",
    progress: { done: 0, total },
    error: null,
    frames: current.frames.map((frame) => (frameIds.includes(frame.id) ? { ...frame, status: "generating", error: null } : frame)),
    queuedDrawings: [...frameIds],
  }));

  const drawn: FrameId[] = [];
  // Pose to pose: keys and breakdowns first, then each in-between by halves between two finished drawings.
  const chart = flipbook.plan.timing;
  const tasks = chart ? new Map(inbetweenTasks(chart).map((task) => [task.index, task])) : null;
  const anchors = chart ? keyIndexes(chart) : sequenceAnchorIndexes(flipbook.plan, Boolean(flipbook.motionReference));
  const startedIds = new Set<FrameId>();
  /** Drawings moved along the video's pose from a key: made without Muse Image, so never counted as started. */
  const moved = new Set<FrameId>();
  let refundable = 0;
  let started = 0;
  // A cycle is drawn pose to pose (poseToPoseRounds): each drawing leans on the finished drawings around it in
  // time, kept ones or ones this run has drawn, so the step, the swing and the hair carry on between them.
  const cycle = !flipbook.sequence;
  const plan = pacedPlan(flipbook.plan, flipbook.prompt);
  const surrounding = async (current: Flipbook, frameId: FrameId) => {
    const { order } = current;
    const at = order.indexOf(frameId);
    const finished = (step: 1 | -1) => {
      for (let distance = 1; distance < order.length; distance++) {
        const position = at + step * distance;
        if (!flipbook.plan.loop && (position < 0 || position >= order.length)) return null;
        const entry = current.frames.find((candidate) => candidate.id === order[(position + order.length) % order.length]);
        if (entry?.version && entry.status !== "failed" && (!frameIds.includes(entry.id) || drawn.includes(entry.id))) return entry;
      }
      return null;
    };
    const read = async (entry: FlipbookFrame | null) => {
      const png = entry ? await readFile(path.join(flipbookFiles.versionDir(id, entry.id, entry.version!), "raw.png")).catch(() => null) : null;
      return png && entry ? { png, index: entry.poseIndex } : undefined;
    };
    const [before, after] = [finished(-1), finished(1)];
    return { before: await read(before), after: after?.id === before?.id ? undefined : await read(after) };
  };
  const drawOne = async (frameId: FrameId) => {
    if (signal.aborted) return;
    await workerUpdate(id, signal, (current) => ({ ...current, queuedDrawings: current.queuedDrawings?.filter((id) => id !== frameId) }));
    if (signal.aborted) return;
    started++;
    startedIds.add(frameId);
    const frame = flipbook.frames.find((entry) => entry.id === frameId)!;
    try {
      let neighbor: Buffer | null = null;
      const latest = flipbook.sequence || cycle ? await getFlipbook(id) : flipbook;
      if (options.withNeighbor || flipbook.sequence) {
        const order = flipbook.order;
        const previousIndex = order.indexOf(frameId) - 1;
        const previousIds = flipbook.sequence ? order.slice(0, previousIndex + 1).reverse() : [order[(previousIndex + order.length) % order.length]];
        const previous = previousIds.map((id) => latest.frames.find((entry) => entry.id === id)).find((entry) => entry?.version && (entry.status !== "failed" || ["canceled", "interrupted", "extraction_failed"].includes(entry.error?.code ?? "")));
        if (previous?.version) neighbor = await readFile(path.join(flipbookFiles.versionDir(id, previous.id, previous.version), "raw.png")).catch(() => null);
      }
      let temporalPair: Parameters<typeof services.draw>[0]["temporalPair"];
      if (anchors.length && !anchors.includes(frame.poseIndex) && !options.repair) {
        const task = tasks?.get(frame.poseIndex);
        const fromIndex = task ? task.from : anchors.filter((index) => index < frame.poseIndex).at(-1)!;
        const toIndex = task ? task.to : anchors.find((index) => index > frame.poseIndex)!;
        const from = latest.frames.find((entry) => entry.poseIndex === fromIndex)!;
        const to = latest.frames.find((entry) => entry.poseIndex === toIndex)!;
        if (!from.version || !to.version) throw new AppError("keyframes_not_ready", 409, "Finish the surrounding key poses before drawing this transition.");
        temporalPair = { from: await readFile(path.join(flipbookFiles.versionDir(id, from.id, from.version), "raw.png")), to: await readFile(path.join(flipbookFiles.versionDir(id, to.id, to.version), "raw.png")), fromIndex, toIndex, position: task ? task.position : (frame.poseIndex - fromIndex) / (toIndex - fromIndex) };
      }
      let repair: { png: Buffer; problems: string[] } | null = null;
      if (options.repair && frame.version) {
        const png = await readFile(path.join(flipbookFiles.versionDir(id, frameId, frame.version), "raw.png")).catch(() => null);
        if (!png) throw new AppError("drawing_missing", 409, "This drawing’s file is missing. Redraw the frame instead.");
        repair = options.marks ? { png: await markUp(png, options.marks), problems: [MARKS_PROBLEM] } : { png, problems: problemsOf(frame) };
      }
      const guideId = compatiblePoseId(flipbook.plan.poseId ?? flipbook.plan.poses[frame.poseIndex].referenceId, flipbook.plan.action, flipbook.plan.view ?? "side");
      const tick = flipbook.sequence ? Number(frame.phase.slice(7)) : -1;
      const guide = flipbook.motionReference ? await motionGuide(id, flipbook.motionReference, tick) : null;
      if (flipbook.motionReference && !guide) throw new AppError("motion_reference_incomplete", 422, "The video sample for this drawing is missing. Apply the reference segment again.");
      const continuity = cycle && !repair ? await surrounding(latest, frameId) : undefined;
      const image = await services.draw({ reference: reference.png, neighbor, continuity, extras, identityReference, repair, temporalPair, motionGuide: guide ?? undefined, poseReference: guideId ? poseReferences.get(guideId) : undefined, requirePoseReference: Boolean(flipbook.poseId), analysis: flipbook.analysis, plan, index: frame.poseIndex, note: options.note, flipbookId: id, signal });
      if (signal.aborted) return;
      const version = newVersionId();
      await writeAtomic(path.join(flipbookFiles.versionDir(id, frameId, version), "raw.png"), image.png);
      drawn.push(frameId);
      done++;
      await workerUpdate(id, signal, (current) => ({
        ...patchFrame(current, frameId, (entry) => ({
          ...entry,
          status: "processing",
          version,
          versions: [...entry.versions, { id: version, source: options.repair ? "enhanced" as const : "generated" as const, createdAt: new Date().toISOString(), ...(options.note ? { note: options.note } : {}) }].slice(-32),
          review: null,
          error: null,
        })),
        progress: { done, total },
      }));
    } catch (error) {
      if (signal.aborted) return;
      if (unbilled(error) || (error instanceof AppError && error.code === "keyframes_not_ready")) refundable++;
      const failure = error instanceof AppError ? error : new AppError("image_failed", 502, "This drawing failed. Redraw it.");
      if (!(error instanceof AppError)) console.error("[focus] flipbook drawing failed", error);
      await workerUpdate(id, signal, (current) => patchFrame(current, frameId, (entry) => ({
        ...entry,
        // A failed redraw keeps a drawing that is already registered on the cycle.
        status: entry.version && current.alignment?.transforms[frameId]?.version === entry.version ? "ready" : "failed",
        error: { code: failure.code, message: failure.message },
      })));
    }
  };
  /**
   * A sequence that follows a movement video: once its key drawings exist, every other tick is the nearest key
   * moved along the video's pose (mapping/follow.ts), for free. What can't be moved, the keys being too far from
   * the video or the pose not found, is returned to be drawn by Muse Image.
   */
  const skeletonFill = async (candidates: readonly FrameId[]): Promise<FrameId[]> => {
    const motion = flipbook.motionReference;
    const { follow, videoTrack } = services;
    if (!follow || !videoTrack || !motion || !flipbook.sequence || !candidates.length) return [...candidates];
    await workerUpdate(id, signal, (current) => ({ ...current, detail: "Measuring the video’s movement", progress: { done, total } }));
    const track = await videoTrack(motionDir(id, motion.version), motion.durationSeconds * 24).catch(() => null);
    if (!track || signal.aborted) return [...candidates];
    const latest = await getFlipbook(id);
    const tickOf = (frame: FlipbookFrame) => Number(frame.phase.slice(7));
    const keys = new Map<FrameId, { tick: number; drawing: KeyDrawing }>();
    for (const index of anchors) {
      const key = latest.frames.find((frame) => frame.poseIndex === index);
      if (!key?.version || key.status === "failed" || signal.aborted) continue;
      const dir = flipbookFiles.versionDir(id, key.id, key.version);
      try {
        const raw = await readFile(path.join(dir, "raw.png"));
        const saved = await readFile(path.join(dir, "cutout.png")).catch(() => null);
        const savedMeasure = await readMeasure(id, key);
        if (saved && savedMeasure) {
          keys.set(key.id, { tick: tickOf(key), drawing: { raw, cutout: saved, measure: savedMeasure } });
          continue;
        }
        const extraction = await extractKeyed({ png: raw, concept: latest.analysis?.subject ?? "character", flipbookId: id, allowAlpha: false, signal });
        await writeAtomic(path.join(dir, "cutout.png"), extraction.cutout);
        await writeAtomic(path.join(dir, "measure.json"), JSON.stringify(extraction.measure));
        keys.set(key.id, { tick: tickOf(key), drawing: { raw, cutout: extraction.cutout, measure: extraction.measure } });
      } catch { /* a key that can't be measured can't carry the frames around it */ }
    }
    const left: FrameId[] = [];
    const unusable = new Set<FrameId>();
    await workerUpdate(id, signal, (current) => ({ ...current, detail: "Moving the drawings along the video’s pose", progress: { done, total } }));
    for (const frameId of candidates) {
      if (signal.aborted) return left;
      const frame = latest.frames.find((entry) => entry.id === frameId)!;
      const tick = tickOf(frame);
      const nearest = [...keys.entries()].filter(([keyId]) => !unusable.has(keyId)).sort((a, b) => Math.abs(a[1].tick - tick) - Math.abs(b[1].tick - tick))[0];
      if (!nearest || Math.abs(nearest[1].tick - tick) > MAX_FOLLOW_TICKS || !track[tick] || !track[nearest[1].tick]) { left.push(frameId); continue; }
      try {
        const made = await follow({ key: nearest[1].drawing, sourceKey: track[nearest[1].tick], sourceNow: track[tick], cacheDir: skeletonCacheDir(flipbookDir(id)), signal });
        if (signal.aborted) return left;
        const version = newVersionId();
        const dir = flipbookFiles.versionDir(id, frameId, version);
        await writeAtomic(path.join(dir, "raw.png"), made.raw);
        await writeAtomic(path.join(dir, "cutout.png"), made.cutout);
        await writeAtomic(path.join(dir, "measure.json"), JSON.stringify(made.measure));
        moved.add(frameId);
        drawn.push(frameId);
        done++;
        await workerUpdate(id, signal, (current) => ({
          ...patchFrame(current, frameId, (entry) => ({
            ...entry,
            status: "processing",
            version,
            versions: [...entry.versions, { id: version, source: "skeleton" as const, createdAt: new Date().toISOString() }].slice(-32),
            review: null,
            error: null,
          })),
          queuedDrawings: current.queuedDrawings?.filter((queued) => queued !== frameId),
          progress: { done, total },
        }));
      } catch (error) {
        if (signal.aborted) return left;
        if (!(error instanceof SkeletonRefused)) console.warn("[focus] flipbook video-follow failed", error instanceof Error ? error.message : error);
        else if (error.key) unusable.add(nearest[0]);
        left.push(frameId);
      }
    }
    return left;
  };
  try {
    let remaining = [...frameIds];
    if (anchors.length && !options.repair && !options.note) {
      const keyIds = anchors.map((index) => flipbook.order[index]);
      for (const key of keyIds) if (remaining.includes(key) && !signal.aborted) await drawOne(key);
      remaining = remaining.filter((id) => !keyIds.includes(id));
      const current = await getFlipbook(id);
      if (keyIds.some((id) => !current.frames.find((frame) => frame.id === id)?.version)) remaining = [];
      else remaining = await skeletonFill(remaining);
    } else if (flipbook.sequence && remaining.includes(flipbook.order[0])) {
      await drawOne(flipbook.order[0]);
      remaining = remaining.filter((id) => id !== flipbook.order[0]);
    }
    // Halving rounds in order: a round's in-betweens are drawn between keys and earlier rounds.
    const rounds = tasks ? [...new Set([...tasks.values()].map((task) => task.depth))].map((depth) => remaining.filter((frameId) => tasks.get(flipbook.frames.find((frame) => frame.id === frameId)!.poseIndex)?.depth === depth)) : cycle && !options.repair ? poseToPoseRounds(flipbook.order, remaining) : [remaining];
    if (tasks) rounds.push(remaining.filter((frameId) => !tasks.has(flipbook.frames.find((frame) => frame.id === frameId)!.poseIndex)));
    for (const round of rounds) {
      for (let offset = 0; offset < round.length && !signal.aborted; offset += 2) {
        await Promise.all(round.slice(offset, offset + 2).map(drawOne));
      }
    }
  } finally {
    await refundImages(id, refundable + frameIds.length - started);
    await updateFlipbook(id, (current) => ({ ...current, queuedDrawings: [] }), { evenIfCanceled: true });
  }
  if (signal.aborted) return;
  await workerUpdate(id, signal, (current) => ({ ...current, frames: current.frames.map((frame) => frameIds.includes(frame.id) && !startedIds.has(frame.id) && !moved.has(frame.id) ? { ...frame, status: "failed", error: { code: "keyframes_not_ready", message: "A surrounding key pose failed. Generate the pending drawings to continue." } } : frame) }));
  await cutOut(id, signal, [...drawn, ...(options.alsoCut ?? [])], options.stay);
  if (!options.stay) await autoInbetweens(id, signal);
}

/**
 * Draws the given drawings of a scene (the budget is already reserved). Each
 * is made from every character's own image and, when there is one, the
 * drawing before it, so the staging, the size and the line carry on from beat
 * to beat. A whole scene goes in two lanes: each drawing leans on the one two
 * beats back (the second beat on the first), so the image limiter keeps two
 * requests going at once.
 */
async function drawEnsembleFrames(id: string, signal: AbortSignal, frameIds: readonly FrameId[], options: { note?: string; withNeighbor?: boolean; repair?: boolean; marks?: Buffer; alsoCut?: readonly FrameId[] }): Promise<void> {
  const flipbook = await getFlipbook(id);
  assertDrawable(flipbook);
  const cast = await readCast(flipbook);
  const run = new Set<string>(frameIds);
  const total = frameIds.length;
  let done = 0;
  await workerUpdate(id, signal, (current) => ({
    ...current,
    status: "generating",
    detail: total === 1 ? `${options.repair ? "Repairing" : "Redrawing"} “${current.frames.find((frame) => frame.id === frameIds[0])?.label}” with Muse Image` : "Drawing the scene with Muse Image",
    progress: { done: 0, total },
    error: null,
    frames: current.frames.map((frame) => (run.has(frame.id) ? { ...frame, status: "generating", error: null } : frame)),
  }));

  const rawFile = (frame: FlipbookFrame) => path.join(flipbookFiles.versionDir(id, frame.id, frame.version!), "raw.png");
  const drawn: FrameId[] = [];
  const raws = new Map<string, Promise<Buffer | null>>();
  let refundable = 0;
  const drawOne = async (frameId: FrameId): Promise<Buffer | null> => {
    const frame = flipbook.frames.find((entry) => entry.id === frameId)!;
    const at = flipbook.order.indexOf(frameId);
    // The nearest earlier drawing of this run, two beats back so two lanes can go at once; the first beat after a drawing that is not in this run leans on that drawing as it is.
    const lead = [2, 1].map((lag) => flipbook.order[at - lag]).find((candidate) => candidate !== undefined && raws.has(candidate));
    try {
      let neighbor: Buffer | null = lead ? await raws.get(lead)! : null;
      if (!lead && (options.withNeighbor || run.size < flipbook.order.length)) {
        const previous = flipbook.frames.find((entry) => entry.id === flipbook.order[at - 1]);
        if (previous?.version && previous.status === "ready") neighbor = await readFile(rawFile(previous)).catch(() => null);
      }
      if (signal.aborted) return null;
      let repair: { png: Buffer; problems: string[] } | null = null;
      if (options.repair && frame.version) {
        const png = await readFile(rawFile(frame)).catch(() => null);
        if (!png) throw new AppError("drawing_missing", 409, "This drawing’s file is missing. Redraw the frame instead.");
        repair = options.marks ? { png: await markUp(png, options.marks), problems: [MARKS_PROBLEM] } : { png, problems: problemsOf(frame) };
      }
      const image = await services.drawEnsemble({ cast, neighbor, repair, analysis: flipbook.analysis, plan: flipbook.plan, scene: flipbook.prompt, index: frame.poseIndex, note: options.note, flipbookId: id, signal });
      if (signal.aborted) return null;
      const version = newVersionId();
      await writeAtomic(path.join(flipbookFiles.versionDir(id, frameId, version), "raw.png"), image.png);
      drawn.push(frameId);
      done++;
      await workerUpdate(id, signal, (current) => ({
        ...patchFrame(current, frameId, (entry) => ({
          ...entry,
          status: "processing",
          version,
          versions: [...entry.versions, { id: version, source: options.repair ? "enhanced" as const : "generated" as const, createdAt: new Date().toISOString(), ...(options.note ? { note: options.note } : {}) }].slice(-32),
          review: null,
          error: null,
        })),
        progress: { done, total },
      }));
      return image.png;
    } catch (error) {
      if (signal.aborted) return null;
      if (unbilled(error)) refundable++;
      const failure = error instanceof AppError ? error : new AppError("image_failed", 502, "This drawing failed. Redraw it.");
      if (!(error instanceof AppError)) console.error("[focus] flipbook scene drawing failed", error);
      await workerUpdate(id, signal, (current) => patchFrame(current, frameId, (entry) => ({
        ...entry,
        status: entry.version && current.alignment?.transforms[frameId]?.version === entry.version ? "ready" : "failed",
        error: { code: failure.code, message: failure.message },
      })));
      return null;
    }
  };
  for (const frameId of flipbook.order.filter((candidate) => run.has(candidate))) raws.set(frameId, drawOne(frameId));
  await Promise.all(raws.values());
  await refundImages(id, refundable);
  if (signal.aborted) return;
  await cutOut(id, signal, [...drawn, ...(options.alsoCut ?? [])]);
}

/** Cut-outs for freshly drawn or uploaded versions, then registration and checks. */
async function cutOut(id: string, signal: AbortSignal, frameIds: readonly FrameId[], stay = false): Promise<void> {
  if (frameIds.length) {
    const total = frameIds.length;
    let done = 0;
    await workerUpdate(id, signal, (current) => ({ ...current, status: "preparing", detail: current.importedFrom ? "Cutting out the imported frames" : "Cutting out the sprites", progress: { done: 0, total } }));
    for (const frameId of frameIds) {
      if (signal.aborted) return;
      const flipbook = await getFlipbook(id);
      const frame = flipbook.frames.find((entry) => entry.id === frameId);
      if (!frame?.version) continue;
      const dir = flipbookFiles.versionDir(id, frameId, frame.version);
      const source = frame.versions.find((version) => version.id === frame.version)?.source;
      try {
        const measured = await readMeasure(id, frame);
        if (!measured || !(await stat(path.join(dir, "cutout.png")).catch(() => null))) {
          // Drawn by Muse Image on a flat key color: cut out by the key, SAM only when the key can't. A scene of several characters, an upload and an import keep their own way.
          const keyed = (source === "generated" || source === "enhanced") && flipbook.cast.length === 0;
          const input = { png: await readFile(path.join(dir, "raw.png")), concept: flipbook.analysis?.subject ?? "character", flipbookId: id, allowAlpha: source === "uploaded" || source === "imported", useSegmentation: source !== "imported", ...(source === "imported" ? { keyMode: "lineart" as const } : {}), ...(flipbook.cast.length ? { group: { concepts: groupConcepts(flipbook.cast.map((member) => member.analysis)), expected: flipbook.cast.length } } : {}), signal };
          const extraction = keyed ? await extractKeyed(input) : await extractSubject(input);
          await writeAtomic(path.join(dir, "cutout.png"), extraction.cutout);
          await writeAtomic(path.join(dir, "measure.json"), JSON.stringify(extraction.measure));
        }
        // The first drawing that could be cut out is the one "Restore original" brings back, never one that failed.
        const prepared = frame.version;
        await workerUpdate(id, signal, (current) => patchFrame(current, frameId, (entry) => entry.version !== prepared ? entry : { ...entry, status: "processing", originalVersion: entry.originalVersion ?? prepared, error: null }));
      } catch (error) {
        if (signal.aborted) return;
        const failure = error instanceof AppError ? error : new AppError("extraction_failed", 422, "We couldn’t cut this character out. Redraw the frame.");
        if (!(error instanceof AppError)) console.error("[focus] flipbook cut-out failed", error);
        await workerUpdate(id, signal, (current) => patchFrame(current, frameId, (entry) => {
          // A redraw that can't be cut out leaves the last registered drawing in place.
          const registered = current.alignment?.transforms[frameId]?.version;
          return registered && registered !== entry.version
            ? { ...entry, status: "ready", version: registered, error: { code: failure.code, message: `${failure.message} The previous drawing was kept.` } }
            : { ...entry, status: "failed", error: { code: failure.code, message: failure.message } };
        }));
      }
      done++;
      await workerUpdate(id, signal, (current) => ({ ...current, progress: { done, total } }));
    }
  }
  if (signal.aborted) return;
  await workerUpdate(id, signal, (current) => ({ ...current, status: "checking", detail: "Checking consistency", progress: null }));
  await finalize(id, signal, { stay });
}

async function readMeasure(id: string, drawing: { readonly id: DrawingId; readonly version: string | null }): Promise<Measure | null> {
  if (!drawing.version) return null;
  return readJsonFile(path.join(flipbookFiles.versionDir(id, drawing.id, drawing.version), "measure.json"), (value) => MeasureSchema.parse(value));
}

/**
 * Registration and checks for every frame that has a cut-out. Local work
 * only: no AI call. Sprites whose pixels would not change keep their files.
 */
/** The resting state once a worker's last step is done. */
const resting = (current: Flipbook): Flipbook => ({
  ...current,
  status: current.plan && current.reference ? (current.frames.some((frame) => frame.version) ? "ready" : "reference_ready") : current.status,
  detail: null,
  progress: null,
});

/** Registers the drawings; `stay` keeps the working state for a worker with more steps, so the editor keeps following it. */
async function finalize(id: string, signal?: AbortSignal, options: { stay?: boolean } = {}): Promise<Flipbook> {
  const flipbook = await getFlipbook(id);
  const plan = flipbook.plan;
  const measured: { frame: FlipbookFrame; measure: Measure }[] = [];
  for (const frame of flipbook.frames) {
    if (frame.status === "failed" || frame.status === "pending" || frame.status === "generating") continue;
    const measure = await readMeasure(id, frame);
    if (measure) measured.push({ frame, measure });
  }
  const entries: AlignInput[] = measured.map(({ frame, measure }) => ({
    frameId: frame.id,
    version: frame.version!,
    phase: frame.phase,
    relativeRootY: plan?.poses[frame.poseIndex].relativeRootY ?? WALK_POSES[frame.poseIndex]?.relativeRootY ?? 0,
    lift: plan?.poses[frame.poseIndex].lift ?? 0,
    measure,
  }));
  // Register each in-between at its own progress along the keys' bob chart.
  const poseOf = (frameId: FrameId) => {
    const index = flipbook.frames.find((frame) => frame.id === frameId)?.poseIndex ?? 0;
    return { relativeRootY: plan?.poses[index].relativeRootY ?? WALK_POSES[index]?.relativeRootY ?? 0, lift: plan?.poses[index].lift ?? WALK_POSES[index]?.lift ?? 0 };
  };
  const inbetweens: { entry: Inbetween; measure: Measure }[] = [];
  for (const entry of flipbook.inbetweens) {
    if (entry.status !== "processing" && entry.status !== "ready") continue;
    const measure = await readMeasure(id, entry);
    if (measure) inbetweens.push({ entry, measure });
  }
  for (const { entry, measure } of inbetweens) {
    const from = poseOf(entry.from), to = poseOf(entry.to);
    // The body rides the bob chart as far along as the pose was drawn, not where the drawing sits in time.
    const position = inbetweenProgress(entry);
    entries.push({ frameId: entry.id, version: entry.version!, phase: "inbetween", relativeRootY: from.relativeRootY + (to.relativeRootY - from.relativeRootY) * position, lift: from.lift + (to.lift - from.lift) * position, measure });
  }
  // A scene's camera is fixed: its drawings keep the place they were drawn at instead of being registered on one body.
  const fixedGesture = flipbook.sequence && !flipbook.motionReference && (plan?.action === "wave" || plan?.action === "idle");
  // Video movement: each drawing sits where the guide's body is at its tick, not where Muse Image happened to draw it.
  const guideDir = flipbook.sequence && flipbook.motionReference && !flipbook.cast.length ? motionDir(id, flipbook.motionReference.version) : null;
  const guided = guideDir ? await guideTrack(guideDir, flipbook.motionReference!.durationSeconds * 24, id).catch(() => null) : null;
  // Pose to pose: every drawing at one size, lifted as planned off one ground line.
  const timedLift = !guided && plan?.timing ? liftTrack(plan.timing) : null;
  const tickOf = (frameId: string): number => {
    const frame = flipbook.frames.find((entry) => entry.id === frameId);
    if (frame) return Number(frame.phase.slice("sample_".length)) || 0;
    const between = flipbook.inbetweens.find((entry) => entry.id === frameId);
    return between ? tickOf(between.from) + (tickOf(between.to) - tickOf(between.from)) * (between.position ?? 0.5) : 0;
  };
  const alignment = entries.length
    ? guided ? computeGuidedAlignment(entries.map((entry) => ({ ...entry, tick: tickOf(entry.frameId) })), guided)
    : timedLift ? computeTimedAlignment(entries.map((entry) => ({ ...entry, lift: timedLift[flipbook.frames.find((frame) => frame.id === entry.frameId)?.poseIndex ?? -1] ?? 0 })))
    : (flipbook.cast.length || flipbook.sequence) && !fixedGesture ? computeEnsembleAlignment(entries) : computeAlignment(entries, flipbook.alignment, plan?.action, plan?.view)
    : flipbook.alignment;
  const sprites = new Map<string, Buffer>();
  const bodyColors = new Map<string, BodyColors>();
  if (alignment) {
    for (const { entry, measure } of inbetweens) {
      const transform = alignment.transforms[entry.id]!;
      const file = flipbookFiles.sprite(id, entry.id, transform.key);
      if (await stat(file).catch(() => null)) continue;
      const cutout = await readFile(path.join(flipbookFiles.versionDir(id, entry.id, entry.version!), "cutout.png"));
      await writeAtomic(file, await renderSprite(cutout, measure, transform, { width: alignment.cellWidth, height: alignment.cellHeight }));
    }
    for (const { frame, measure } of measured) {
      const transform = alignment.transforms[frame.id]!;
      const file = flipbookFiles.sprite(id, frame.id, transform.key);
      let sprite: Buffer | null = await readFile(file).catch(() => null);
      const cutout = !sprite || fixedGesture ? await readFile(path.join(flipbookFiles.versionDir(id, frame.id, frame.version!), "cutout.png")) : null;
      if (!sprite) {
        sprite = await renderSprite(cutout!, measure, transform, { width: alignment.cellWidth, height: alignment.cellHeight });
        await writeAtomic(file, sprite);
      }
      if (fixedGesture && cutout) bodyColors.set(frame.id, await stationaryBodyColors(cutout, { centerX: measure.torsoX, topY: measure.topY, footY: measure.footY }));
      sprites.set(frame.id, flipbook.sequence ? await sharp(sprite).resize(96, 96, { fit: "fill" }).png().toBuffer() : sprite);
    }
  }
  // Where each in-between landed between its keys, read from the sprites just registered.
  const landed = alignment && !flipbook.sequence && !flipbook.cast.length && inbetweens.length
    ? await inbetweenOrder(id, alignment, inbetweens.map(({ entry }) => entry), signal).catch((error: unknown) => { console.warn("[focus] flipbook in-between order not measured", error instanceof Error ? error.message : error); return new Map<InbetweenId, { version: string; seen: number }>(); })
    : new Map<InbetweenId, { version: string; seen: number }>();
  const reference = flipbook.reference ? await readReference(id, flipbook.reference.version).catch(() => null) : null;
  const stationaryReference = fixedGesture && reference?.measure ? await stationaryBodyColors(reference.png, {
    centerX: reference.measure.crop.left + reference.measure.torsoX,
    topY: reference.measure.crop.top + reference.measure.topY,
    footY: reference.measure.crop.top + reference.measure.footY,
  }) : undefined;
  const order = orderedFrames(flipbook).filter((frame) => sprites.has(frame.id));
  const keyTiming = new Map<string, { atSeconds: number; holdSeconds: number }>();
  // A timing chart holds its keys on purpose: no overlong-hold check.
  if (plan && !plan.timing && !inbetweens.length) {
    const sheet = exposureSheet(orderedFrames(flipbook), plan.drawingFps);
    let atSeconds = 0;
    sheet.drawings.forEach((frame, index) => {
      const holdSeconds = sheet.holds[index] / 24;
      keyTiming.set(frame.id, { atSeconds, holdSeconds });
      atSeconds += holdSeconds;
    });
  }
  const byId = new Map(measured.map((entry) => [entry.frame.id, entry.measure]));
  const checks = alignment
    ? await checkFrames(order.map((frame) => ({
      frameId: frame.id,
      label: frame.label,
      phase: frame.phase,
      measure: byId.get(frame.id)!,
      scale: alignment.transforms[frame.id]!.scale,
      relativeRootY: plan?.poses[frame.poseIndex].relativeRootY ?? WALK_POSES[frame.poseIndex]?.relativeRootY ?? 0,
      sprite: sprites.get(frame.id)!,
      stationaryColors: bodyColors.get(frame.id),
      timing: keyTiming.get(frame.id),
    })), reference?.measure?.histogram ?? null, plan?.action, plan?.view, Boolean(flipbook.sequence), stationaryReference, Boolean(flipbook.motionReference))
    : new Map();
  if (guided && guideDir && alignment) {
    // Pose and continuity against the guide, in playback order; added to each drawing's own checks.
    const cell = { width: alignment.cellWidth, height: alignment.cellHeight };
    const compared = await Promise.all(order.map(async (frame) => {
      const guide = await guideSprite(guideDir, guided, Math.round(tickOf(frame.id)), cell);
      return { frameId: frame.id, sprite: sprites.get(frame.id)!, guide: guide && await sharp(guide).resize(96, 96, { fit: "fill" }).png().toBuffer() };
    }));
    for (const [frameId, warnings] of await motionWarnings(compared)) checks.get(frameId)?.warnings.push(...warnings);
  }
  const update = (current: Flipbook): Flipbook => ({
    ...current,
    // Only transforms of the drawings each key or in-between still shows.
    alignment: alignment ? { ...alignment, transforms: Object.fromEntries(Object.entries(alignment.transforms).filter(([drawingId, transform]) => (current.frames.find((frame) => frame.id === drawingId) ?? current.inbetweens.find((entry) => entry.id === drawingId))?.version === transform?.version)) } : null,
    inbetweens: current.inbetweens.map((measuredEntry) => {
      const measured = landed.get(measuredEntry.id);
      const entry = measured && measured.version === measuredEntry.version ? { ...measuredEntry, seen: measured.seen } : measuredEntry;
      if (entry.status !== "processing") return entry;
      return alignment?.transforms[entry.id]?.version === entry.version
        ? { ...entry, status: "ready", error: null }
        : { ...entry, status: "failed", error: { code: "extraction_failed", message: "This in-between couldn’t be cut out. Draw the in-betweens again." } };
    }),
    ...(options.stay ? {} : { status: resting(current).status, detail: null, progress: null }),
    frames: current.frames.map((frame) => {
      const measure = byId.get(frame.id);
      const check = checks.get(frame.id);
      if (frame.status === "processing" && !measure) {
        return { ...frame, status: "failed", error: { code: "extraction_failed", message: "This drawing couldn’t be cut out. Redraw it or replace it." } };
      }
      if (!measure || !check || frame.version !== alignment?.transforms[frame.id]?.version) return frame;
      return {
        ...frame,
        status: "ready",
        // A failed redraw keeps the previous drawing and says why.
        error: frame.status === "processing" ? null : frame.error,
        // Imported frames are cut out by their flat background on purpose (SAM is never tried): not a warning.
        warnings: frame.versions.find((version) => version.id === frame.version)?.source === "imported" ? check.warnings.filter((warning: FrameWarning) => warning.code !== "key_extraction") : check.warnings,
        metrics: {
          rawWidth: measure.rawWidth,
          rawHeight: measure.rawHeight,
          subjectHeight: measure.footY - measure.topY + 1,
          subjectWidth: measure.crop.width,
          coverage: measure.coverage,
          relativeScale: Number(check.relativeScale.toFixed(4)),
          colorDistance: check.colorDistance === null ? null : Number(check.colorDistance.toFixed(4)),
          extraction: measure.method,
        },
      };
    }),
  });
  return signal ? workerUpdate(id, signal, update) : updateFlipbook(id, update);
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Starts a worker and shows its running state before the request returns:
 * the editor polls only while a flipbook is active, so an action must never
 * answer with a resting state its worker is about to leave.
 */
async function startVisible(id: string, show: (current: Flipbook) => Flipbook, work: (signal: AbortSignal) => Promise<void>): Promise<Flipbook> {
  startWorker(id, work, failWith);
  return updateFlipbook(id, (current) => (RESTING.has(current.status) && isRunning(id) ? show(current) : current));
}

const markGenerating = (frameIds: readonly FrameId[], detail: string) => (current: Flipbook): Flipbook => ({
  ...current,
  status: "generating",
  detail,
  progress: { done: 0, total: frameIds.length },
  error: null,
  frames: current.frames.map((frame) => (frameIds.includes(frame.id) ? { ...frame, status: "generating", error: null } : frame)),
});

/** Continue a failed preparation using the saved upload, analysis and plan. */
export async function retryPreparation(id: string, confirmExtra: boolean, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const source = await getFlipbook(id);
  assertIdle(source);
  const rejectedVideo = source.status === "unsupported" && source.sequence && source.motionReference && source.analysis && source.analysis.characterCount > 0;
  if (source.cast.length || source.reference || (!rejectedVideo && !["failed", "canceled"].includes(source.status))) throw new AppError("nothing_to_retry", 409, "Generate missing drawings or correct a drawing to continue this animation.");
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
  // Report a known allowance refusal before the worker starts so the UI can confirm it.
  const needsClean = source.analysis && decideReference(source.analysis, source.plan?.view).kind === "clean";
  if (needsClean && source.budget.used >= source.budget.limit && !confirmExtra) throw new AppError("budget_reached", 402, "Preparing this reference needs one more drawing. Confirm to continue.");
  return startVisible(id, (current) => ({ ...current, status: "analyzing", detail: "Retrying animation preparation", error: null }), (signal) => runPipeline(id, signal, { keepScene: source.requestedKeepScene ?? false, fromReading: false, retry: true, confirmExtra }));
}

/** Repair every flagged, finished drawing in one budgeted, cancelable run. */
export async function enhanceFlagged(id: string, confirmExtra: boolean, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const source = await getFlipbook(id);
  assertIdle(source);
  assertDrawable(source);
  const targets = repairableFrames(source).map((frame) => frame.id);
  if (!targets.length) throw new AppError("nothing_to_enhance", 409, "There are no unapproved drawings with warnings to fix.");
  assertImageAllowance(await getFlipbook(id), targets.length, confirmExtra);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: targets.length });
  await reserveImages(id, targets.length, confirmExtra);
  return startVisible(id, markGenerating(targets, `Fixing ${targets.length} flagged drawings with Muse Image`), (signal) => drawFrames(id, signal, targets, { withNeighbor: true, repair: true }));
}

export async function generateMissing(id: string, confirmExtra: boolean, gate?: PaidWorkGate): Promise<Flipbook> {
  const flipbook = await getFlipbook(id);
  assertIdle(flipbook);
  assertDrawable(flipbook);
  const targets = flipbook.frames.filter((frame) => !frame.approved && (frame.status === "pending" || frame.status === "failed")).map((frame) => frame.id);
  if (!targets.length) throw new AppError("nothing_to_generate", 409, "Every frame already has a drawing. Redraw a single frame instead.");
  const recut = targets.filter((frameId) => {
    const frame = flipbook.frames.find((entry) => entry.id === frameId)!;
    return frame.version && ["extraction_failed", "no_subject", "canceled", "interrupted"].includes(frame.error?.code ?? "");
  });
  const redraw = targets.filter((frameId) => !recut.includes(frameId));
  assertImageAllowance(await getFlipbook(id), redraw.length, confirmExtra);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: targets.length });
  await reserveImages(id, redraw.length, confirmExtra);
  return startVisible(id, markGenerating(targets, "Drawing the poses with Muse Image"), async (signal) => {
    if (recut.length) {
      await workerUpdate(id, signal, (state) => ({ ...state, frames: state.frames.map((frame) => (recut.includes(frame.id) ? { ...frame, status: "processing", error: null } : frame)) }));
    }
    if (redraw.length) await drawFrames(id, signal, redraw, { alsoCut: recut });
    else await cutOut(id, signal, recut);
  });
}

function revisionOf(current: Flipbook) {
  return { id: newVersionId(), createdAt: new Date().toISOString(), prompt: current.prompt, motionNote: current.motionNote, requestedView: current.requestedView, plan: current.plan!, frames: current.frames, order: current.order, alignment: current.alignment, motionReference: current.motionReference };
}

export async function reviseSequence(id: string, settings: SequenceSettings, gate?: PaidWorkGate, motion?: { reference: NonNullable<Flipbook["motionReference"]>; guide: (tick: number) => Promise<Buffer | null>; audio?: NonNullable<Flipbook["audio"]> }): Promise<Flipbook> {
  const source = await getFlipbook(id);
  assertIdle(source);
  const parsed = SequenceSettingsSchema.parse(settings);
  if (motion && source.motionSource === "video" && !source.plan) {
    await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
    const prepare = (current: Flipbook): Flipbook => ({ ...current, sequence: parsed, prompt: videoAnimationPrompt({ settings: parsed, start: motion.reference.start, note: source.motionNote }), motionReference: motion.reference, motionDraft: null, ...(motion.audio ? { audio: motion.audio } : {}), status: "analyzing", detail: "Preparing the character and the selected video movement", error: null });
    return startVisible(id, prepare, async (signal) => {
      await workerUpdate(id, signal, prepare);
      await runPipeline(id, signal, { keepScene: source.requestedKeepScene ?? false, fromReading: false });
    });
  }
  assertDrawable(source);
  if (source.cast.length || !source.analysis) throw new AppError("sequence_not_supported", 409, "Choose a single character with a prepared reference.");
  if (!motion && source.motionReference && parsed.durationSeconds > source.motionReference.durationSeconds) throw new AppError("invalid_motion_trim", 400, "Choose a longer segment in Video movement reference before extending this sequence.");
  const retainTiming = !motion && source.sequence?.durationSeconds === parsed.durationSeconds;
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 0 });
  return startVisible(id, (current) => ({ ...current, status: "planning", detail: `Planning ${parsed.durationSeconds * parsed.drawingFps} timed drawings`, error: null }), async (signal) => {
    const fromVideo = Boolean(motion || source.motionReference);
    const prompt = fromVideo ? videoAnimationPrompt({ settings: parsed, start: (motion?.reference ?? source.motionReference!).start, note: source.motionNote }) : source.prompt;
    const eligible = retainTiming ? (source.revisions ?? []).filter((entry) => source.plan?.motionId && entry.plan.motionId === source.plan.motionId && entry.motionReference?.version === source.motionReference?.version) : [];
    const posed = !fromVideo && source.plan!.action !== "ensemble" && posedToPose(source.plan!.action);
    const planned = posed
      ? await services.planPoseToPose({ analysis: source.analysis!, prompt, settings: parsed, flipbookId: id, view: source.requestedView, action: source.plan!.action as CycleAction, signal })
      : await services.planSequence({ analysis: source.analysis!, prompt, settings: parsed, flipbookId: id, view: fromVideo ? undefined : source.requestedView, action: fromVideo || source.plan!.action === "ensemble" ? undefined : source.plan!.action, previous: retainTiming ? source.plan! : undefined, reusePoses: eligible.flatMap((entry) => entry.plan.poses), guide: motion?.guide ?? (source.motionReference ? (tick) => motionGuide(id, source.motionReference!, tick) : undefined), signal });
    const plan = { ...planned, motionId: retainTiming ? source.plan?.motionId ?? randomUUID() : randomUUID() };
    const reusable = new Map(retainTiming ? [...eligible.flatMap((entry) => entry.frames), ...source.frames].map((frame) => [frame.id, frame] as const) : []);
    // A new timing chart moves every drawing: nothing is reused at its old tick.
    const frames = plan.timing ? planSkeleton(plan) : sequenceSkeleton(parsed).map((frame) => ({ ...(reusable.get(frame.id) ?? frame), poseIndex: frame.poseIndex, phase: frame.phase, label: plan.poses[frame.poseIndex].label }));
    await workerUpdate(id, signal, (current) => ({ ...current, prompt, sequence: parsed, plan, frames, order: frames.map((frame) => frame.id), inbetweens: [], revisions: [...(current.revisions ?? []), revisionOf(source)].slice(-20), ...(motion ? { motionSource: "video" as const, requestedView: undefined, motionReference: motion.reference, motionDraft: null, ...(motion.audio ? { audio: motion.audio } : {}) } : {}), look: { settings: { ...(current.look?.settings ?? { aspect: "16:9", speed: 1 }), ...parsed, motion: "in_place", cycleSeconds: undefined, smoothing: 0 }, background: current.look?.background ?? { kind: "color", color: "#ffffff" } }, alignment: null, status: "reference_ready", detail: null, error: null }));
    await finalize(id, signal);
  });
}

export async function restoreSequenceRevision(id: string, revisionId: string): Promise<Flipbook> {
  const source = await getFlipbook(id);
  assertIdle(source);
  const selected = source.revisions?.find((entry) => entry.id === revisionId);
  if (!selected) throw new AppError("revision_not_found", 404, "That motion revision is no longer available.");
  return updateFlipbook(id, (current) => ({ ...current, prompt: selected.prompt ?? current.prompt, motionNote: selected.motionNote, requestedView: selected.requestedView ?? (selected.motionReference ? undefined : selected.plan.view), motionSource: selected.motionReference ? "video" : undefined, plan: selected.plan, sequence: selected.plan.mode === "sequence" ? SequenceSettingsSchema.parse(selected.plan) : undefined, frames: selected.frames, order: selected.order, alignment: selected.alignment, motionReference: selected.motionReference, inbetweens: [], look: current.look ? { ...current.look, settings: { ...current.look.settings, drawingFps: selected.plan.drawingFps, durationSeconds: selected.plan.durationSeconds, motion: selected.plan.motion } } : null, revisions: [...(current.revisions ?? []).filter((entry) => entry.id !== revisionId), revisionOf(current)].slice(-20), status: "ready", error: null }));
}

export async function applyFrameAction(id: string, frameId: FrameId, action: FrameAction, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  const frame = flipbook.frames.find((entry) => entry.id === frameId);
  if (!frame) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");

  if (action.action === "approve") {
    assertIdle(flipbook);
    if (action.approved && frame.status !== "ready") throw new AppError("frame_not_ready", 409, "Only a finished frame can be approved.");
    return updateFlipbook(id, (current) => patchFrame(current, frameId, (entry) => ({ ...entry, approved: action.approved })));
  }

  assertIdle(flipbook);
  if (frame.approved) throw new AppError("frame_approved", 409, "This frame is approved. Unapprove it before changing it.");

  if (action.action === "restore") {
    if (!frame.originalVersion || frame.originalVersion === frame.version) throw new AppError("nothing_to_restore", 409, "This frame already shows its original drawing.");
    await updateFlipbook(id, (current) => patchFrame(current, frameId, (entry) => ({ ...entry, version: entry.originalVersion, status: "processing", review: null })));
    return finalize(id);
  }

  if (action.action === "use") {
    if (!frame.versions.some((entry) => entry.id === action.version)) throw new AppError("version_not_found", 404, "That drawing is no longer in this frame’s history.");
    if (action.version === frame.version) throw new AppError("already_shown", 409, "This frame already shows that drawing.");
    await updateFlipbook(id, (current) => patchFrame(current, frameId, (entry) => ({ ...entry, version: action.version, status: "processing", review: null, error: null })));
    return finalize(id);
  }

  assertDrawable(flipbook);
  const repair = action.action === "enhance";
  if (repair && !frame.version) throw new AppError("nothing_to_enhance", 409, "This frame has no drawing to improve yet. Draw it first.");
  assertImageAllowance(await getFlipbook(id), 1, action.confirmExtra === true);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
  await reserveImages(id, 1, action.confirmExtra === true);
  return startVisible(id, markGenerating([frameId], `${repair ? "Repairing" : "Redrawing"} “${frame.label}” with Muse Image`), (signal) => drawFrames(id, signal, [frameId], { note: action.note || undefined, withNeighbor: true, repair }));
}

/**
 * A pencil note on one drawing: the frame is repaired from its current
 * drawing with the animator's red marks over it and the comment. One drawing
 * from the budget, like Improve; the old version stays in the history.
 */
export async function correctFrame(id: string, frameId: FrameId, note: { comment: string; marks: Buffer }, confirmExtra: boolean, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  const frame = flipbook.frames.find((entry) => entry.id === frameId);
  if (!frame) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  assertIdle(flipbook);
  if (frame.approved) throw new AppError("frame_approved", 409, "This frame is approved. Unapprove it before changing it.");
  if (!frame.version) throw new AppError("nothing_to_enhance", 409, "This frame has no drawing to mark yet. Draw it first.");
  assertDrawable(flipbook);
  assertImageAllowance(await getFlipbook(id), 1, confirmExtra);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
  await reserveImages(id, 1, confirmExtra);
  return startVisible(id, markGenerating([frameId], `Redrawing “${frame.label}” from your pencil marks with Muse Image`), (signal) => drawFrames(id, signal, [frameId], { note: note.comment, marks: note.marks, withNeighbor: true, repair: true }));
}

/**
 * Applies what the chat proposed: each listed frame gets its new instruction
 * and is redrawn like a "Redraw" of that frame (same guards, one drawing from
 * the budget each, same cut-out and checks), all in one run. Approved frames
 * are never touched, and nothing changes if the budget or a guard refuses.
 */
export async function applyPoseChanges(id: string, changes: NonNullable<ApplyPoseChangesRequest["changes"]>, options: { confirmExtra?: boolean } = {}, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  if (flipbook.cast.length) throw new AppError("not_for_scenes", 409, "The movement chat is for one character.");
  assertIdle(flipbook);
  assertDrawable(flipbook);
  const descriptions = new Map(changes.map((change) => [change.frame, change.description] as const));
  const frames = [...descriptions.keys()].map((frameId) => {
    const frame = flipbook.frames.find((entry) => entry.id === frameId);
    if (!frame) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
    if (frame.approved) throw new AppError("frame_approved", 409, `“${frame.label}” is approved. Unapprove it before changing it.`);
    return frame;
  });
  assertImageAllowance(await getFlipbook(id), frames.length, options.confirmExtra === true);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: frames.length });
  await reserveImages(id, frames.length, options.confirmExtra === true);
  const frameIds = frames.map((frame) => frame.id);
  try {
    await updateFlipbook(id, (current) => {
      if (!current.plan) return current;
      const poseIndexes = new Map(frames.map((frame) => [frame.poseIndex, descriptions.get(frame.id)!] as const));
      return { ...current, ...(current.sequence ? { revisions: [...(current.revisions ?? []), revisionOf(current)].slice(-20) } : {}), plan: { ...current.plan, ...(current.sequence ? { motionId: randomUUID() } : {}), poses: current.plan.poses.map((pose, index) => (poseIndexes.has(index) ? { ...pose, description: poseIndexes.get(index)! } : pose)) } };
    });
  } catch (error) {
    await refundImages(id, frames.length);
    throw error;
  }
  return startVisible(id, markGenerating(frameIds, `Redrawing ${frames.length} ${frames.length === 1 ? "frame" : "frames"} with Muse Image`), (signal) => drawFrames(id, signal, frameIds, { withNeighbor: true }));
}

/**
 * "Calculate in-betweens": measures how far the body moves across every gap
 * between neighboring keys (the outline always; the skeleton's turn and joint
 * travel where the pose tool runs) and lets Muse Spark decide the cycle's
 * length and each gap's in-betweens and easing. Nothing is drawn and no
 * drawing is spent; playback takes the new cycle length.
 */
export async function planInbetweens(id: string, signal?: AbortSignal): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertScenelessCycle(flipbook, "Calculating in-betweens");
  assertIdle(flipbook);
  return calculateInbetweens(id, signal);
}

/** Measures every gap between the keys and stores Muse Spark's in-between plan; the guards are the caller's. */
async function calculateInbetweens(id: string, signal?: AbortSignal): Promise<Flipbook> {
  const flipbook = await getFlipbook(id);
  const frames = orderedFrames(flipbook);
  const alignment = flipbook.alignment;
  const unready = frames.filter((frame) => frame.status !== "ready" || !frame.version || alignment?.transforms[frame.id]?.version !== frame.version);
  if (!flipbook.plan || !alignment || frames.length < 2 || unready.length) {
    throw new AppError("frames_not_ready", 409, `Finish every key drawing before calculating in-betweens. Not ready: ${unready.map((frame) => frame.label).join(", ") || "all frames"}.`);
  }
  const plan = pacedPlan(flipbook.plan, flipbook.prompt);
  const shares = gapShares(flipbook, plan.drawingFps);
  const keyOf = async (frame: FlipbookFrame): Promise<KeyDrawing> => {
    const dir = flipbookFiles.versionDir(id, frame.id, frame.version!);
    return { raw: await readFile(path.join(dir, "raw.png")), cutout: await readFile(path.join(dir, "cutout.png")), measure: MeasureSchema.parse(JSON.parse(await readFile(path.join(dir, "measure.json"), "utf8"))) };
  };
  const measures: GapMeasure[] = [];
  for (const [index, from] of frames.entries()) {
    const to = frames[(index + 1) % frames.length];
    const sprite = (frame: FlipbookFrame) => readFile(flipbookFiles.sprite(id, frame.id, alignment.transforms[frame.id]!.key));
    const silhouette = await silhouetteChange(await sprite(from), await sprite(to));
    // The skeleton can fail on an unusual drawing; the outline still measures the gap.
    const move = services.measureMove ? await services.measureMove({ from: await keyOf(from), to: await keyOf(to), cacheDir: skeletonCacheDir(flipbookDir(id)), signal }).catch(() => null) : null;
    measures.push({ from: from.id, to: to.id, fromVersion: from.version!, toVersion: to.version!, fromLabel: from.label, toLabel: to.label, share: shares[index], turn: move?.turn ?? null, travel: move?.travel ?? null, silhouette });
  }
  const decided = await services.planInbetweens({ measures, plan, analysis: flipbook.analysis, instruction: flipbook.prompt, flipbookId: id, signal });
  // After keys are redrawn, a gap whose two keys didn't change keeps its count and spacing, so its in-betweens are
  // kept and nothing is paid for them again; Muse Spark's answer decides the gaps that changed. "Calculate again" on
  // unchanged keys decides every gap anew.
  const previous = flipbook.inbetweenPlan && !currentInbetweenPlan(flipbook) ? flipbook.inbetweenPlan : null;
  const timing = previous ? {
    ...decided,
    gaps: decided.gaps.map((gap, index) => {
      const old = previous.gaps.find((entry) => entry.from === gap.from && entry.to === gap.to && entry.fromVersion === gap.fromVersion && entry.toVersion === gap.toVersion);
      return old && old.count <= maxPlannedInbetweens(shares[index] * decided.cycleSeconds) ? { ...gap, count: old.count, ease: old.ease, note: old.note } : gap;
    }),
  } : decided;
  return updateFlipbook(id, (current) => ({
    ...current,
    inbetweenPlan: timing,
    ...(current.look ? { look: { ...current.look, settings: { ...current.look.settings, cycleSeconds: timing.cycleSeconds } } } : {}),
  }));
}

// ── Motion check ───────────────────────────────────────────────────────────

/** A rewritten key is kept only when it sits at least this much closer to its neighbors than the drawing it replaces. */
const KEEP_FIT = 0.85;

const percent = (value: number) => `${Math.round(value * 100)}%`;

function spriteReader(id: string, alignment: NonNullable<Flipbook["alignment"]>): SpriteOf {
  const sprites = new Map<DrawingId, Promise<Buffer>>();
  return (drawingId) => {
    if (!sprites.has(drawingId)) sprites.set(drawingId, readFile(flipbookFiles.sprite(id, drawingId, alignment.transforms[drawingId]!.key)));
    return sprites.get(drawingId)!;
  };
}

/** A repeated cycle of one character whose every played drawing, with at least one in-between, is registered. */
function motionCheckable(flipbook: Flipbook): flipbook is Flipbook & { alignment: NonNullable<Flipbook["alignment"]> } {
  if (flipbook.sequence || flipbook.cast.length || !flipbook.plan || !flipbook.alignment) return false;
  const cycle = playbackCycle(flipbook, true);
  return cycle.some((drawing) => drawing.inbetween) && cycle.every((drawing) => {
    const version = drawing.inbetween ? flipbook.inbetweens.find((entry) => entry.id === drawing.id)?.version : flipbook.frames.find((frame) => frame.id === drawing.id)?.version;
    return Boolean(version) && flipbook.alignment!.transforms[drawing.id]?.version === version;
  });
}

async function proposeMotionFix(input: { readonly flipbook: Flipbook; readonly request: string; readonly signal?: AbortSignal }): Promise<MotionFix | null> {
  const proposal = await proposeChange({ flipbook: input.flipbook, message: input.request, history: [], signal: input.signal });
  return proposal.changes.length ? { reply: proposal.reply, frames: proposal.changes.map(({ frame, label, summary, description }) => ({ frame, label, summary, description })) } : null;
}

/**
 * Measures the played loop step by step and, where it jumps, asks Muse Spark
 * which key poses to rewrite. Nothing is drawn; the correction waits for the
 * animator's "Fix". Runs after every in-between run and on request.
 */
async function checkMotion(id: string, signal?: AbortSignal, worker = Boolean(signal)): Promise<Flipbook> {
  const flipbook = await getFlipbook(id);
  if (!motionCheckable(flipbook)) return flipbook;
  const save = (change: (current: Flipbook) => Flipbook) => (worker && signal ? workerUpdate(id, signal, change) : updateFlipbook(id, change));
  // Inside a worker the caller settles the state afterwards.
  if (worker) await save((current) => ({ ...current, status: "checking", detail: "Checking the motion step by step", progress: null }));
  const sprite = spriteReader(id, flipbook.alignment);
  const measure = await measureLoop(flipbook, sprite, silhouetteChange);
  const fix = measure.snaps.length
    ? await services.motionFix({ flipbook, request: await motionFixRequest(flipbook, measure, sprite, silhouetteChange), signal }).catch((error: unknown) => {
      console.warn("[focus] flipbook motion fix not proposed", error instanceof Error ? error.message : error);
      return null;
    })
    : null;
  const check: MotionCheck = { ...measure, fix, outcome: null, at: new Date().toISOString() };
  return save((current) => ({ ...current, motionCheck: check }));
}

/** "Check the motion": the loop as it plays now, measured; free apart from Muse Spark reading the numbers. */
export async function checkFlipbookMotion(id: string, signal?: AbortSignal): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertScenelessCycle(flipbook, "The motion check");
  assertIdle(flipbook);
  if (!motionCheckable(flipbook)) throw new AppError("motion_not_ready", 409, "Make the in-betweens before checking the motion.");
  return checkMotion(id, signal, false);
}

/**
 * "Fix": applies the motion check's correction. Each listed key gets its new
 * description and one redraw from the budget; a redraw is kept only if it
 * now sits closer to its neighbors, otherwise the earlier drawing and its
 * description come back. Then the in-betweens are calculated and made again
 * (moved from the skeleton first) and the loop is checked again, so the
 * outcome says plainly whether the jump is gone.
 */
export async function fixMotion(id: string, confirmExtra: boolean, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertScenelessCycle(flipbook, "Fixing the motion");
  assertIdle(flipbook);
  assertDrawable(flipbook);
  const fix = currentMotionCheck(flipbook)?.fix;
  if (!fix || !flipbook.plan || !motionCheckable(flipbook)) throw new AppError("nothing_to_fix", 409, "There is no correction for the loop as it plays now. Check the motion again.");
  const frames = fix.frames.map((entry) => {
    const frame = flipbook.frames.find((candidate) => candidate.id === entry.frame);
    if (!frame?.version) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
    if (frame.approved) throw new AppError("frame_approved", 409, `“${frame.label}” is approved. Unapprove it before changing it.`);
    return { frame, description: entry.description };
  });
  const sprite = spriteReader(id, flipbook.alignment);
  const previous = new Map(await Promise.all(frames.map(async ({ frame }) => [frame.id, { version: frame.version!, description: flipbook.plan!.poses[frame.poseIndex].description, fit: await keyFit(flipbook, frame.id, sprite, silhouetteChange) }] as const)));
  assertImageAllowance(await getFlipbook(id), frames.length, confirmExtra);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: frames.length });
  await reserveImages(id, frames.length, confirmExtra);
  try {
    const descriptions = new Map(frames.map(({ frame, description }) => [frame.poseIndex, description] as const));
    await updateFlipbook(id, (current) => (current.plan ? { ...current, plan: { ...current.plan, poses: current.plan.poses.map((pose, index) => (descriptions.has(index) ? { ...pose, description: descriptions.get(index)! } : pose)) } } : current));
  } catch (error) {
    await refundImages(id, frames.length);
    throw error;
  }
  const frameIds = frames.map(({ frame }) => frame.id);
  return startVisible(id, markGenerating(frameIds, `Fixing the jump: redrawing ${frames.map(({ frame }) => `“${frame.label}”`).join(", ")} with Muse Image`), (signal) => repairMotion(id, signal, previous, confirmExtra));
}

async function repairMotion(id: string, signal: AbortSignal, previous: ReadonlyMap<FrameId, { version: string; description: string; fit: number }>, confirmExtra: boolean): Promise<void> {
  const worstBefore = (await getFlipbook(id)).motionCheck?.worst ?? null;
  const frameIds = [...previous.keys()];
  await drawFrames(id, signal, frameIds, { withNeighbor: true, stay: true });
  if (signal.aborted) return;

  // Each new key is kept only if it sits closer to its neighbors than the drawing it replaces.
  const drawn = await getFlipbook(id);
  const kept: string[] = [];
  const undone: FlipbookFrame[] = [];
  for (const frameId of frameIds) {
    const frame = drawn.frames.find((entry) => entry.id === frameId)!;
    const old = previous.get(frameId)!;
    const registered = frame.status === "ready" && frame.version !== old.version && drawn.alignment?.transforms[frameId]?.version === frame.version;
    const fit = registered ? await keyFit(drawn, frameId, spriteReader(id, drawn.alignment!), silhouetteChange) : null;
    if (fit !== null && fit < old.fit * KEEP_FIT) kept.push(frame.label);
    else undone.push(frame);
  }
  if (undone.length) {
    await workerUpdate(id, signal, (current) => {
      const back = new Map(undone.map((frame) => [frame.poseIndex, previous.get(frame.id)!.description] as const));
      const restored = undone.reduce((state, frame) => patchFrame(state, frame.id, (entry) => ({ ...entry, version: previous.get(frame.id)!.version, status: "processing", review: null, error: null })), current);
      return restored.plan ? { ...restored, plan: { ...restored.plan, poses: restored.plan.poses.map((pose, index) => (back.has(index) ? { ...pose, description: back.get(index)! } : pose)) } } : restored;
    });
    await finalize(id, signal, { stay: true });
  }
  const undoneLine = undone.length ? `The new ${undone.map((frame) => `“${frame.label}”`).join(", ")} didn’t sit closer to ${undone.length === 1 ? "its" : "their"} neighbors, so the earlier ${undone.length === 1 ? "drawing is" : "drawings are"} back. ` : "";
  // The outcome lands with the resting state, so the editor sees both at once.
  const note = (outcome: string) => workerUpdate(id, signal, (current) => resting(current.motionCheck ? { ...current, motionCheck: { ...current.motionCheck, outcome } } : current));
  if (!kept.length) {
    await note(`${undoneLine}Nothing else changed. Try the correction again, or describe the pose in the chat.`.trim());
    return;
  }

  await workerUpdate(id, signal, (current) => ({ ...current, status: "generating", detail: "Calculating the in-betweens for the new keys", progress: null }));
  await calculateInbetweens(id, signal);
  if (signal.aborted) return;
  const planned = await getFlipbook(id);
  const targets = plannedInbetweenTargets(planned);
  const skeleton = services.skeleton !== null;
  if (targets.length) {
    if (!skeleton) {
      assertImageAllowance(planned, targets.length, confirmExtra);
      await reserveImages(id, targets.length, confirmExtra);
    }
    const noun = targets.length === 1 ? "in-between" : "in-betweens";
    // Like "Make in-betweens": each target starts between the keys' current drawings.
    await workerUpdate(id, signal, (current) => ({ ...current, inbetweens: [...current.inbetweens.filter((entry) => !targets.some((target) => target.id === entry.id)), ...targets.map((target) => freshInbetween(current, target))] }));
    await runInbetweens(id, signal, targets, skeleton ? `Moving the character between the key drawings: ${targets.length} ${noun}` : `Drawing ${targets.length} ${noun} with Muse Image`, { skeleton, confirmExtra, stay: true });
  } else {
    await finalize(id, signal, { stay: true });
    await checkMotion(id, signal);
  }
  if (signal.aborted) return;
  const after = currentMotionCheck(await getFlipbook(id));
  const result = !after
    ? "The loop couldn’t be measured again; check the motion once every in-between is ready."
    : after.snaps.length
      ? `The loop still jumps: the largest step is ${percent(after.worst)}${worstBefore !== null ? ` (was ${percent(worstBefore)})` : ""}.${after.fix ? " Muse Spark has a new correction." : ""}`
      : `No jumps left: the largest step is ${percent(after.worst)}${worstBefore !== null ? ` (was ${percent(worstBefore)})` : ""}.`;
  await note(`Redrew ${kept.map((label) => `“${label}”`).join(", ")}. ${undoneLine}${result}`.slice(0, 400));
}

/**
 * Draws missing or stale exposure slots at the requested pace (one midpoint
 * per key for older requests): one drawing from
 * the budget each, refunded when Meta doesn't bill it. The key drawings never
 * change. Each is cut out and registered on the same cell as the keys.
 */
export async function drawInbetweens(id: string, confirmExtra: boolean, gate?: PaidWorkGate, drawingFps?: DrawingFps, planned = false): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertScenelessCycle(flipbook, "In-betweens");
  assertIdle(flipbook);
  assertDrawable(flipbook);
  const frames = orderedFrames(flipbook);
  const unready = frames.filter((frame) => frame.status !== "ready" || !frame.version || flipbook.alignment?.transforms[frame.id]?.version !== frame.version);
  if (frames.length < 2 || unready.length) {
    throw new AppError("frames_not_ready", 409, `Finish every key drawing before adding in-betweens. Not ready: ${unready.map((frame) => frame.label).join(", ") || "all frames"}.`);
  }
  if (planned && !currentInbetweenPlan(flipbook)) throw new AppError("inbetween_plan_stale", 409, "The key drawings changed since the in-betweens were calculated. Calculate them again.");
  const targets: InbetweenTarget[] = planned
    ? plannedInbetweenTargets(flipbook)
    : drawingFps
    ? denseInbetweenTargets(flipbook, drawingFps)
    : inbetweenTargets(flipbook).map((from) => ({ id: inbetweenAfter(from), from, position: 0.5 }));
  if (!targets.length) throw new AppError("nothing_to_generate", 409, "Every in-between is already drawn for the current drawings.");
  // With the skeleton engine the budget is spent only on the in-betweens it can't carry, one by one as they are needed.
  const skeleton = services.skeleton !== null;
  if (!skeleton) assertImageAllowance(await getFlipbook(id), targets.length, confirmExtra);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: targets.length });
  if (!skeleton) await reserveImages(id, targets.length, confirmExtra);
  const noun = targets.length === 1 ? "in-between" : "in-betweens";
  const detail = skeleton ? `Moving the character between the key drawings: ${targets.length} ${noun}` : `Drawing ${targets.length} ${noun} with Muse Image`;
  return startVisible(id, (current) => {
    const fresh = targets.map((target) => freshInbetween(current, target));
    return {
      ...current,
      status: "generating",
      detail,
      progress: { done: 0, total: targets.length },
      error: null,
      inbetweens: [...current.inbetweens.filter((entry) => !targets.some((target) => target.id === entry.id)), ...fresh],
    };
  }, (signal) => runInbetweens(id, signal, targets, detail, { skeleton, confirmExtra }));
}

/** The in-between a target stands for, as it begins: between the keys' current versions, keeping what an older one had drawn. */
function freshInbetween(current: Flipbook, { id: targetId, from: fromId, position, progress }: InbetweenTarget): Inbetween {
  const to = nextInOrder(current, fromId);
  const old = current.inbetweens.find((entry) => entry.id === targetId);
  return {
    id: targetId,
    from: fromId,
    to,
    fromVersion: current.frames.find((frame) => frame.id === fromId)!.version!,
    toVersion: current.frames.find((frame) => frame.id === to)!.version!,
    position,
    ...(progress !== undefined && Math.abs(progress - position) > 1e-6 ? { progress } : {}),
    status: "generating",
    version: old?.version ?? null,
    error: null,
  };
}

const upsertInbetween = (current: Flipbook, entry: Inbetween): Flipbook => ({ ...current, inbetweens: [...current.inbetweens.filter((candidate) => candidate.id !== entry.id), entry] });

/** The farthest a tick may be from the key it is moved from: the keys are a quarter second apart, so this only allows for a key that failed. */
const MAX_FOLLOW_TICKS = 12;

/** Most in-betweens moved on their own after the keys are drawn: a few seconds of local work. Past it the animator starts them. */
const AUTO_INBETWEEN_LIMIT = 48;

/**
 * Once every key drawing exists the in-betweens the skeleton can carry are
 * made without being asked: they cost no drawing and nothing about the keys
 * changes. Best effort and local only: what it can't carry is left for the
 * animator's "Make in-betweens", which draws it.
 */
async function autoInbetweens(id: string, signal: AbortSignal): Promise<void> {
  if (!services.skeleton || signal.aborted) return;
  try {
    const flipbook = await getFlipbook(id);
    if (flipbook.sequence || flipbook.cast.length || flipbook.importedFrom || !flipbook.plan) return;
    if (flipbook.frames.some((frame) => frame.status !== "ready" || !frame.version)) return;
    // A calculated plan that still fits the keys says which in-betweens to move; otherwise every exposure slot.
    const targets = currentInbetweenPlan(flipbook) ? plannedInbetweenTargets(flipbook) : denseInbetweenTargets(flipbook, flipbook.plan.drawingFps);
    if (!targets.length || targets.length > AUTO_INBETWEEN_LIMIT) return;
    const noun = targets.length === 1 ? "in-between" : "in-betweens";
    await runInbetweens(id, signal, targets, `Moving the character between the key drawings: ${targets.length} ${noun}`, { skeleton: true, confirmExtra: false, skeletonOnly: true });
  } catch (error) {
    if (signal.aborted) return;
    console.warn("[focus] flipbook automatic in-betweens skipped", error instanceof Error ? error.message : error);
  }
}

async function runInbetweens(id: string, signal: AbortSignal, allTargets: readonly InbetweenTarget[], detail: string, options: { skeleton: boolean; confirmExtra: boolean; /** Leave what the skeleton refuses undrawn: no Muse Image call, no budget. */ skeletonOnly?: boolean; /** The caller has more steps: no resting state at the end. */ stay?: boolean }): Promise<void> {
  const flipbook = await getFlipbook(id);
  assertDrawable(flipbook);
  const reference = await readReference(id, flipbook.reference.version);
  const extras = await readExtras(flipbook);
  const identityReference = flipbook.characterSource ? await readFile(flipbookFiles.identity(id)) : undefined;
  const frameOf = (frameId: FrameId) => flipbook.frames.find((frame) => frame.id === frameId)!;
  const raw = (frame: FlipbookFrame) => readFile(path.join(flipbookFiles.versionDir(id, frame.id, frame.version!), "raw.png"));
  const total = allTargets.length;
  let done = 0;
  let refundable = 0;
  const drawn: InbetweenId[] = [];
  const placed: InbetweenId[] = [];
  await workerUpdate(id, signal, (current) => ({ ...current, status: "generating", detail, progress: { done: 0, total } }));

  // First choice: move the keys' skeleton. What it refuses (keys too far apart, a fold, no pose found) is drawn.
  let targets = allTargets;
  if (options.skeleton && services.skeleton) {
    const move = services.skeleton;
    const keyOf = async (frame: FlipbookFrame) => {
      const dir = flipbookFiles.versionDir(id, frame.id, frame.version!);
      const measure = MeasureSchema.parse(JSON.parse(await readFile(path.join(dir, "measure.json"), "utf8")));
      return { raw: await readFile(path.join(dir, "raw.png")), cutout: await readFile(path.join(dir, "cutout.png")), measure };
    };
    const keys = new Map<FrameId, ReturnType<typeof keyOf>>();
    const keyFor = (frame: FlipbookFrame) => { if (!keys.has(frame.id)) keys.set(frame.id, keyOf(frame)); return keys.get(frame.id)!; };
    const refused: InbetweenTarget[] = [];
    /** Drawings moved in this run, by id: a refused neighbor in the same gap may be moved from one of them. */
    const moved = new Map<InbetweenId, { progress: number; drawing: KeyDrawing; from: FrameId }>();
    // A key the engine can't measure is tried once, not once per in-between around it.
    const unmeasurable = new Set<FrameId>();
    for (const target of allTargets) {
      if (signal.aborted) return;
      const from = frameOf(target.from);
      const to = frameOf(nextInOrder(flipbook, target.from));
      if (unmeasurable.has(from.id) || unmeasurable.has(to.id)) { refused.push(target); continue; }
      try {
        const made = await move({ from: await keyFor(from), to: await keyFor(to), position: target.progress ?? target.position, cacheDir: skeletonCacheDir(flipbookDir(id)), signal });
        if (signal.aborted) return;
        const version = newVersionId();
        const dir = flipbookFiles.versionDir(id, target.id, version);
        await writeAtomic(path.join(dir, "raw.png"), made.raw);
        await writeAtomic(path.join(dir, "cutout.png"), made.cutout);
        await writeAtomic(path.join(dir, "measure.json"), JSON.stringify(made.measure));
        placed.push(target.id);
        done++;
        await workerUpdate(id, signal, (current) => ({ ...upsertInbetween(current, { ...freshInbetween(current, target), status: "processing", method: "skeleton", version }), progress: { done, total } }));
        moved.set(target.id, { progress: target.progress ?? target.position, drawing: { raw: made.raw, cutout: made.cutout, measure: made.measure }, from: target.from });
      } catch (error) {
        if (signal.aborted) return;
        if (!(error instanceof SkeletonRefused)) console.warn("[focus] flipbook skeleton in-between failed", error instanceof Error ? error.message : error);
        else if (error.key) unmeasurable.add(error.key === "from" ? from.id : to.id);
        refused.push(target);
      }
    }
    // What a key's rig couldn't carry may still come step by step from the nearest drawing already moved in
    // the same gap, as long as each round fills something.
    const neighborMove = services.skeletonNeighbor;
    if (neighborMove && refused.length) {
      // In-betweens drawn before this run count too: a rerun only has the refused ones as targets.
      const gaps = new Set(refused.map((target) => target.from));
      for (const entry of flipbook.inbetweens) {
        if (moved.has(entry.id) || !gaps.has(entry.from) || !inbetweenCurrent(flipbook, entry) || allTargets.some((target) => target.id === entry.id)) continue;
        const dir = flipbookFiles.versionDir(id, entry.id, entry.version!);
        const drawing = await Promise.all([readFile(path.join(dir, "raw.png")), readFile(path.join(dir, "cutout.png")), readFile(path.join(dir, "measure.json"), "utf8")]).then(([raw, cutout, measure]) => ({ raw, cutout, measure: MeasureSchema.parse(JSON.parse(measure)) })).catch(() => null);
        if (drawing) moved.set(entry.id, { progress: inbetweenProgress(entry), drawing, from: entry.from });
      }
    }
    for (let filled = true; filled && neighborMove && refused.length && !signal.aborted;) {
      filled = false;
      for (const target of [...refused]) {
        const progress = target.progress ?? target.position;
        const from = frameOf(target.from);
        const to = frameOf(nextInOrder(flipbook, target.from));
        if (unmeasurable.has(from.id) || unmeasurable.has(to.id)) continue;
        const nearest = [...moved.values()].filter((entry) => entry.from === target.from).sort((x, y) => Math.abs(x.progress - progress) - Math.abs(y.progress - progress))[0];
        if (!nearest) continue;
        try {
          const made = await neighborMove({ from: await keyFor(from), to: await keyFor(to), neighbor: nearest.drawing, position: progress, cacheDir: skeletonCacheDir(flipbookDir(id)), signal });
          if (signal.aborted) return;
          const version = newVersionId();
          const dir = flipbookFiles.versionDir(id, target.id, version);
          await writeAtomic(path.join(dir, "raw.png"), made.raw);
          await writeAtomic(path.join(dir, "cutout.png"), made.cutout);
          await writeAtomic(path.join(dir, "measure.json"), JSON.stringify(made.measure));
          placed.push(target.id);
          done++;
          await workerUpdate(id, signal, (current) => ({ ...upsertInbetween(current, { ...freshInbetween(current, target), status: "processing", method: "skeleton", version }), progress: { done, total } }));
          moved.set(target.id, { progress, drawing: { raw: made.raw, cutout: made.cutout, measure: made.measure }, from: target.from });
          refused.splice(refused.indexOf(target), 1);
          filled = true;
        } catch (error) {
          if (signal.aborted) return;
          if (!(error instanceof SkeletonRefused)) console.warn("[focus] flipbook skeleton in-between failed", error instanceof Error ? error.message : error);
        }
      }
    }
    targets = options.skeletonOnly ? [] : refused;
    if (refused.length && !options.skeletonOnly) {
      const noun = refused.length === 1 ? "in-between" : "in-betweens";
      try {
        await reserveImages(id, refused.length, options.confirmExtra);
      } catch (error) {
        const failure = error instanceof AppError ? error : new AppError("image_failed", 502, "This in-between failed. Draw the in-betweens again.");
        for (const target of refused) await workerUpdate(id, signal, (current) => patchInbetween(current, target.id, (entry) => ({ ...entry, status: "failed", error: { code: failure.code, message: failure.message } })));
        targets = [];
      }
      if (targets.length) await workerUpdate(id, signal, (current) => ({ ...current, detail: `Drawing ${refused.length} ${noun} the skeleton couldn’t carry with Muse Image`, progress: { done, total } }));
    }
  }

  // A drawn in-between leans on the finished ones just before and after its point of the same gap, so the model
  // can't land it beside a key (it doesn't always honour a requested fraction from the keys alone).
  const finished = targets.length ? await getFlipbook(id) : flipbook;
  const bracket = async (fromId: FrameId, point: number, self: InbetweenId) => {
    const near = finished.inbetweens.filter((entry) => entry.from === fromId && entry.id !== self && !targets.some((target) => target.id === entry.id) && inbetweenCurrent(finished, entry)).map((entry) => ({ entry, at: entry.seen ?? inbetweenProgress(entry) }));
    const read = (entry: Inbetween | undefined) => entry ? readFile(path.join(flipbookFiles.versionDir(id, entry.id, entry.version!), "raw.png")).catch(() => undefined) : undefined;
    const before = near.filter((candidate) => candidate.at < point).sort((a, b) => b.at - a.at)[0]?.entry;
    const after = near.filter((candidate) => candidate.at > point).sort((a, b) => a.at - b.at)[0]?.entry;
    return { before: await read(before), after: await read(after) };
  };
  await Promise.all(targets.map(async ({ id: inbetweenId, from: fromId, position, progress }) => {
    const from = frameOf(fromId);
    const to = frameOf(nextInOrder(flipbook, fromId));
    try {
      const between = await bracket(fromId, progress ?? position, inbetweenId);
      const image = await services.inbetween({ reference: reference.png, from: await raw(from), to: await raw(to), between, extras, identityReference, analysis: flipbook.analysis, plan: pacedPlan(flipbook.plan, flipbook.prompt), fromIndex: from.poseIndex, toIndex: to.poseIndex, position: progress ?? position, flipbookId: id, signal });
      if (signal.aborted) return;
      const version = newVersionId();
      await writeAtomic(path.join(flipbookFiles.versionDir(id, inbetweenId, version), "raw.png"), image.png);
      drawn.push(inbetweenId);
      done++;
      await workerUpdate(id, signal, (current) => ({ ...patchInbetween(current, inbetweenId, (entry) => ({ ...entry, status: "processing", method: "image" as const, version, error: null })), progress: { done, total } }));
    } catch (error) {
      if (signal.aborted) return;
      if (unbilled(error)) refundable++;
      const failure = error instanceof AppError ? error : new AppError("image_failed", 502, "This in-between failed. Draw the in-betweens again.");
      if (!(error instanceof AppError)) console.error("[focus] flipbook in-between failed", error);
      await workerUpdate(id, signal, (current) => patchInbetween(current, inbetweenId, (entry) => ({ ...entry, status: "failed", error: { code: failure.code, message: failure.message } })));
    }
  }));
  await refundImages(id, refundable);
  if (signal.aborted) return;

  if (drawn.length) {
    let cut = 0;
    await workerUpdate(id, signal, (current) => ({ ...current, status: "preparing", detail: "Cutting out the in-betweens", progress: { done: 0, total: drawn.length } }));
    for (const inbetweenId of drawn) {
      if (signal.aborted) return;
      const current = await getFlipbook(id);
      const entry = current.inbetweens.find((candidate) => candidate.id === inbetweenId);
      if (!entry?.version) continue;
      const dir = flipbookFiles.versionDir(id, inbetweenId, entry.version);
      try {
        const extraction = await (current.cast.length ? extractSubject : extractKeyed)({ png: await readFile(path.join(dir, "raw.png")), concept: current.analysis?.subject ?? "character", flipbookId: id, allowAlpha: false, signal });
        await writeAtomic(path.join(dir, "cutout.png"), extraction.cutout);
        await writeAtomic(path.join(dir, "measure.json"), JSON.stringify(extraction.measure));
      } catch (error) {
        if (signal.aborted) return;
        const failure = error instanceof AppError ? error : new AppError("extraction_failed", 422, "This in-between couldn’t be cut out. Draw the in-betweens again.");
        if (!(error instanceof AppError)) console.error("[focus] flipbook in-between cut-out failed", error);
        await workerUpdate(id, signal, (state) => patchInbetween(state, inbetweenId, (value) => ({ ...value, status: "failed", error: { code: failure.code, message: failure.message } })));
      }
      cut++;
      await workerUpdate(id, signal, (state) => ({ ...state, progress: { done: cut, total: drawn.length } }));
    }
  }
  if (signal.aborted) return;
  await workerUpdate(id, signal, (current) => ({ ...current, status: "checking", detail: "Registering the in-betweens", progress: null }));
  await finalize(id, signal, { stay: true });
  await checkMotion(id, signal).catch((error: unknown) => { if (!signal.aborted) console.warn("[focus] flipbook motion check skipped", error instanceof Error ? error.message : error); });
  if (!options.stay) await workerUpdate(id, signal, resting);
}

/** Below this outline change the two keys are too alike for a drawing's place between them to be read. */
const MIN_ORDER_SPAN = 0.08;

/**
 * Where each registered in-between actually reads between its keys: its
 * outline's change from the first key over its change from both. A model
 * doesn't always draw the requested point of the movement (one asked for at
 * a sixth can come back nearly at the next key), and played in its planned
 * slot it would step forward and back. Playback fills a gap's slots in this
 * order instead (`playbackCycle`). Every in-between of a gap is measured, so
 * moved and drawn ones compare on one scale.
 */
async function inbetweenOrder(id: string, alignment: NonNullable<Flipbook["alignment"]>, entries: readonly Inbetween[], signal?: AbortSignal): Promise<Map<InbetweenId, { version: string; seen: number }>> {
  const sprites = new Map<string, Promise<Buffer>>();
  const sprite = (drawingId: string) => {
    if (!sprites.has(drawingId)) sprites.set(drawingId, readFile(flipbookFiles.sprite(id, drawingId, alignment.transforms[drawingId]!.key)));
    return sprites.get(drawingId)!;
  };
  const seen = new Map<InbetweenId, { version: string; seen: number }>();
  for (const entry of entries) {
    if (signal?.aborted) break;
    if (!entry.version || alignment.transforms[entry.id]?.version !== entry.version || !alignment.transforms[entry.from] || !alignment.transforms[entry.to]) continue;
    const [first, last, drawing] = await Promise.all([sprite(entry.from), sprite(entry.to), sprite(entry.id)]);
    if (await silhouetteChange(first, last) < MIN_ORDER_SPAN) continue;
    const [fromFirst, toLast] = await Promise.all([silhouetteChange(first, drawing), silhouetteChange(drawing, last)]);
    seen.set(entry.id, { version: entry.version, seen: Math.round((fromFirst / Math.max(1e-6, fromFirst + toLast)) * 1000) / 1000 });
  }
  return seen;
}

/** A drawing the animator made or fixed elsewhere becomes the frame's current version. */
export async function replaceFrame(id: string, frameId: FrameId, body: ReadableStream<Uint8Array> | null, declaredBytes: number | undefined, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  const frame = flipbook.frames.find((entry) => entry.id === frameId);
  if (!frame) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  assertIdle(flipbook);
  assertDrawable(flipbook, { allowImported: true });
  if (frame.approved) throw new AppError("frame_approved", 409, "This frame is approved. Unapprove it before replacing it.");
  const decoded = await decodeImage(await readUpload(body, declaredBytes), { minDimension: 64 });
  // SAM runs unless the drawing brings its own transparency.
  if (!decoded.hasAlpha) await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
  const version = newVersionId();
  await writeAtomic(path.join(flipbookFiles.versionDir(id, frameId, version), "raw.png"), decoded.png);
  await updateFlipbook(id, (current) => patchFrame(current, frameId, (entry) => ({
    ...entry,
    status: "processing",
    version,
    versions: [...entry.versions, { id: version, source: "uploaded" as const, createdAt: new Date().toISOString() }].slice(-32),
    review: null,
    error: null,
  })));
  return startVisible(id, (current) => ({ ...current, status: "preparing", detail: "Cutting out the sprites", progress: { done: 0, total: 1 }, error: null }), (signal) => cutOut(id, signal, [frameId]));
}

export async function reorderFrames(id: string, order: readonly FrameId[]): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertScenelessCycle(flipbook, "Reordering");
  assertIdle(flipbook);
  if (new Set(order).size !== FRAME_IDS.length || !FRAME_IDS.every((frameId) => order.includes(frameId))) {
    throw new AppError("invalid_order", 400, "The new order must contain every frame exactly once.");
  }
  await updateFlipbook(id, (current) => ({ ...current, order: [...order] }));
  // Neighbor checks depend on the order.
  return flipbook.alignment ? finalize(id) : getFlipbook(id);
}

export async function changeReference(id: string, kind: "original" | "clean" | "uploaded", options: { confirmExtra?: boolean; upload?: Buffer }, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertScenelessCycle(flipbook, "Changing the reference");
  if (flipbook.importedFrom) throw new AppError("imported_frames", 409, importedFramesMessage(flipbook.importedFrom));
  assertIdle(flipbook);
  if (!flipbook.plan) throw new AppError("flipbook_not_ready", 409, "The pose plan isn’t ready yet.");
  if (kind === "uploaded" && !options.upload) throw new AppError("empty_file", 400, "We didn’t receive a file.");
  if (kind === "uploaded") await decodeImage(options.upload!);
  if (kind === "clean") assertImageAllowance(flipbook, 1, options.confirmExtra === true);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
  if (kind === "clean") await reserveImages(id, 1, options.confirmExtra === true);
  const reason = kind === "clean" ? "A clean full-body reference in the selected camera view." : kind === "uploaded" ? "The reference image you uploaded." : "Your original illustration.";
  return startVisible(id, (current) => ({ ...current, status: "referencing", detail: "Preparing the character reference", error: null }), async (signal) => {
    await prepareReference(id, { kind, reason }, signal, options.upload);
    if (signal.aborted) return;
    // Color checks compare against the reference: re-check what exists.
    await finalize(id, signal);
  });
}

/**
 * Adds an image of the same character (another angle, the back of the outfit)
 * that travels beside the anchor with every drawing from now on. No AI call.
 */
export async function addExtraReference(id: string, body: ReadableStream<Uint8Array> | null, declaredBytes: number | undefined, name: string): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertScenelessCycle(flipbook, "Extra references");
  assertIdle(flipbook);
  if (flipbook.extraReferences.length >= MAX_EXTRA_REFERENCES) throw new AppError("too_many_references", 409, `A character can have up to ${MAX_EXTRA_REFERENCES} extra references. Remove one first.`);
  const decoded = await decodeImage(await readUpload(body, declaredBytes));
  const version = newVersionId();
  await writeAtomic(flipbookFiles.extraReference(id, version), decoded.flat);
  return updateFlipbook(id, (current) => {
    if (current.extraReferences.length >= MAX_EXTRA_REFERENCES) return current;
    return { ...current, extraReferences: [...current.extraReferences, { version, name: name.slice(0, 80), createdAt: new Date().toISOString() }] };
  });
}

export async function removeExtraReference(id: string, version: string): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertIdle(flipbook);
  if (!flipbook.extraReferences.some((extra) => extra.version === version)) throw new AppError("media_not_found", 404, "That reference is no longer there.");
  return updateFlipbook(id, (current) => ({ ...current, extraReferences: current.extraReferences.filter((extra) => extra.version !== version) }));
}

export async function createScene(id: string, confirmExtra: boolean, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertScenelessCycle(flipbook, "Keeping the uploaded scene");
  if (flipbook.analysis?.background === "plain") throw new AppError("scene_unavailable", 409, "Your illustration has a plain background, so there is no scene to keep. Choose a color or upload a background.");
  // The plate, SAM on the upload to keep it around the character, then SAM on the strip for the depth layers.
  assertImageAllowance(await getFlipbook(id), 1, confirmExtra);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 2 + FAR_CONCEPTS.length });
  await reserveImages(id, 1, confirmExtra);
  let depth: boolean;
  try {
    const plate = await services.scene({ sourceFlat: await readFile(flipbookFiles.sourceFlat(id)), analysis: flipbook.analysis, flipbookId: id });
    depth = await storePlate(id, "scene", await keptScene(id, flipbook, plate.png));
  } catch (error) {
    if (unbilled(error)) await refundImages(id, 1);
    throw error;
  }
  return updateFlipbook(id, (current) => ({ ...current, backgrounds: { ...current.backgrounds, scene: true, depth: { ...current.backgrounds.depth, scene: depth } } }));
}

export async function uploadBackground(id: string, body: ReadableStream<Uint8Array> | null, declaredBytes: number | undefined): Promise<Flipbook> {
  assertFlipbookEnabled();
  await getFlipbook(id);
  const decoded = await decodeImage(await readUpload(body, declaredBytes), { minDimension: 64 });
  await writeAtomic(flipbookFiles.background(id, "custom"), decoded.flat);
  return updateFlipbook(id, (current) => ({ ...current, backgrounds: { ...current.backgrounds, custom: true } }));
}

/** A picture of a place that inspires the next generated background; it is never used as the background itself. */
export async function uploadBackgroundReference(id: string, body: ReadableStream<Uint8Array> | null, declaredBytes: number | undefined): Promise<Flipbook> {
  assertFlipbookEnabled();
  await getFlipbook(id);
  const decoded = await decodeImage(await readUpload(body, declaredBytes), { minDimension: 64 });
  await writeAtomic(flipbookFiles.background(id, "bg-reference"), decoded.flat);
  return updateFlipbook(id, (current) => ({ ...current, backgrounds: { ...current.backgrounds, reference: true } }));
}

export async function removeBackgroundReference(id: string): Promise<Flipbook> {
  assertFlipbookEnabled();
  await getFlipbook(id);
  await rm(flipbookFiles.background(id, "bg-reference"), { force: true });
  return updateFlipbook(id, (current) => ({ ...current, backgrounds: { ...current.backgrounds, reference: false } }));
}

/**
 * A setting for a character that came without one: one Muse Image drawing in
 * the character's style, stored as drawn (still) and as a seamless strip
 * (scrolling). Drawing again replaces both.
 */
export async function generateBackground(id: string, input: { prompt?: string; confirmExtra: boolean }, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertIdle(flipbook);
  assertDrawable(flipbook, { allowImported: true });
  // The drawing, then SAM on its strip for the depth layers.
  assertImageAllowance(await getFlipbook(id), 1, input.confirmExtra);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 + FAR_CONCEPTS.length });
  await reserveImages(id, 1, input.confirmExtra);
  let depth: boolean;
  try {
    const place = flipbook.backgrounds.reference ? await readFile(flipbookFiles.background(id, "bg-reference")).catch(() => undefined) : undefined;
    const plate = await services.backdrop({ sourceFlat: await readFile(flipbookFiles.sourceFlat(id)), analysis: flipbook.analysis, view: flipbook.plan?.view, prompt: input.prompt, place, flipbookId: id });
    depth = await storePlate(id, "generated", plate.png);
  } catch (error) {
    if (unbilled(error)) await refundImages(id, 1);
    throw error;
  }
  return updateFlipbook(id, (current) => ({
    ...current,
    backgrounds: { ...current.backgrounds, generated: { prompt: input.prompt ?? "", createdAt: new Date().toISOString() }, depth: { ...current.backgrounds.depth, generated: depth } },
  }));
}

/** The playback settings and background last picked, kept for the next visit. No AI, allowed any time. */
export function saveLook(id: string, look: { settings: PlaybackSettings; background: FlipbookBackground }): Promise<Flipbook> {
  assertFlipbookEnabled();
  return updateFlipbook(parseFlipbookId(id), (current) => ({ ...current, look }), { evenIfCanceled: true });
}

// ── Reading an upload ──────────────────────────────────────────────────────

/**
 * One turn of the guided setup: Muse Spark sees the upload (and its reading,
 * when it was already made) and the conversation, and asks what it can't
 * decide or returns every setting. Nothing is drawn.
 */
export async function guideFlipbookSetup(input: { readonly imageId?: string; readonly characterSource?: CharacterSource; readonly ownerId?: string | null; readonly messages: readonly GuideMessage[]; readonly signal?: AbortSignal }): Promise<GuideReply> {
  assertFlipbookEnabled();
  if (input.characterSource) {
    // A saved character has no upload reading: the picture alone says what it is.
    const character = await animationCharacterSource(input.characterSource, input.ownerId);
    return services.guide({ imagePng: character.flat, look: null, messages: input.messages, imageId: character.image.id, signal: input.signal });
  }
  const { image, flat } = await getCharacterImage(input.imageId!);
  return services.guide({ imagePng: await readFile(flat), look: await readLook(image.id), messages: input.messages, imageId: image.id, signal: input.signal });
}

async function readLook(imageId: string): Promise<ImageLook | null> {
  return readJsonFile(imageFiles(imageId).look, (value) => ImageLookSchema.parse(value));
}

/**
 * What the upload shows, read once and kept with it: the character facts,
 * the scene, motions that suit it, and its layers (the character cut out by
 * SAM; the scene with the character's place emptied, as a preview of what the
 * redrawn plate will replace). One Muse Spark call and one SAM frame.
 */
export async function readUploadedImage(imageId: string, gate?: PaidWorkGate): Promise<ImageLook> {
  assertFlipbookEnabled();
  const { image, png, flat } = await getCharacterImage(imageId);
  const cached = await readLook(image.id);
  if (cached) return cached;
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
  const reading = await services.describe({ imagePng: await readFile(flat), imageId: image.id });
  const files = imageFiles(image.id);
  let layers = { character: false, scene: false };
  try {
    const source = await readFile(png);
    const extraction = await extractSubject({ png: source, concept: reading.analysis.subject, flipbookId: image.id, allowAlpha: image.hasAlpha });
    await writeAtomic(files.character, extraction.cutout);
    layers = { character: true, scene: false };
    if (!image.hasAlpha && reading.analysis.background !== "plain") {
      await writeAtomic(files.scene, await emptiedScene(source, extraction.cutout, extraction.measure));
      layers = { character: true, scene: true };
    }
  } catch (error) {
    if (!(error instanceof AppError)) console.error("[focus] flipbook layer separation failed", error);
  }
  const look: ImageLook = {
    imageId: image.id,
    summary: reading.summary,
    setting: reading.setting,
    analysis: reading.analysis,
    warnings: assessInput(reading.analysis).warnings,
    ideas: [...reading.ideas],
    layers,
  };
  await writeAtomic(files.look, JSON.stringify(look));
  return look;
}

/** The upload with the character's pixels made transparent (grown a little, so no outline is left behind). */
export async function emptiedScene(source: Buffer, cutout: Buffer, measure: Pick<Measure, "crop" | "rawWidth" | "rawHeight">): Promise<Buffer> {
  const { rawWidth: width, rawHeight: height } = measure;
  const grown = growMask(await subjectMask(cutout, measure), width, height, 4);
  const rgb = await sharp(source).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    rgba[index * 4] = rgb[index * 3];
    rgba[index * 4 + 1] = rgb[index * 3 + 1];
    rgba[index * 4 + 2] = rgb[index * 3 + 2];
    rgba[index * 4 + 3] = 255 - grown[index];
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// ── Saved animations ───────────────────────────────────────────────────────

export function summarizeFlipbook(flipbook: Flipbook): FlipbookSummary {
  return {
    id: flipbook.id,
    title: flipbookTitle(flipbook),
    action: flipbook.plan?.action ?? null,
    status: flipbook.status,
    frames: flipbook.frames.filter((frame) => frame.status === "ready").length,
    total: flipbook.frames.length,
    posterUrl: flipbookUrls.source(flipbook.id),
    updatedAt: flipbook.updatedAt,
  };
}

export async function listFlipbooks(ownerId: string): Promise<FlipbookSummary[]> {
  assertFlipbookEnabled();
  return (await allFlipbooks())
    .filter((flipbook) => flipbook.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summarizeFlipbook);
}

/**
 * Saves an animation to the account (made before signing in, or just now)
 * and renames it. Someone else's animation is "not found", never "forbidden".
 */
export async function saveFlipbook(id: string, ownerId: string, patch: { title?: string }): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  if (flipbook.ownerId && flipbook.ownerId !== ownerId) throw new AppError("flipbook_not_found", 404, "This animation no longer exists.");
  return updateFlipbook(flipbook.id, (current) => ({ ...current, ownerId, ...(patch.title ? { title: patch.title } : {}) }), { evenIfCanceled: true });
}

/** Takes the animation off the account; it then expires like any unsaved one. */
export async function unsaveFlipbook(id: string, ownerId: string): Promise<void> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  if (flipbook.ownerId !== ownerId) throw new AppError("flipbook_not_found", 404, "This animation no longer exists.");
  await updateFlipbook(flipbook.id, (current) => ({ ...current, ownerId: null }), { evenIfCanceled: true });
}

/**
 * Renders the cycle as a verified MP4 and opens it in the video editor as a
 * new clip, the same as an upload: normalized once, then every effect works on it.
 */
export async function sendToEditor(id: string, look: { settings: PlaybackSettings; background: FlipbookBackground }, options?: ExportOptions): Promise<{ flipbook: Flipbook; video: VideoAsset }> {
  if (look.background.kind === "transparent") throw new AppError("mp4_needs_background", 400, "The editor needs a background. Choose a color, a scene or an image.");
  const { flipbook, record } = await exportFlipbook(id, { format: "mp4", ...look }, options);
  const file = record.files[0];
  const name = flipbookTitle(flipbook).replace(/[^\p{L}\p{N} _-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Flipbook";
  const video = await ingestVideo({
    body: Readable.toWeb(createReadStream(path.join(flipbookFiles.exportDir(flipbook.id, record.key), file.name))) as ReadableStream<Uint8Array>,
    fileName: `${name}.mp4`,
    declaredBytes: file.bytes,
  });
  return { flipbook, video };
}

/** Muse Spark looks at the contact sheet next to the reference. An opinion, shown as one. */
export async function reviewFlipbook(id: string): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  assertIdle(flipbook);
  const alignment = flipbook.alignment;
  const frames = orderedFrames(flipbook).filter((frame) => frame.status === "ready" && alignment?.transforms[frame.id]);
  if (!alignment || frames.length < 2 || !flipbook.reference) throw new AppError("review_not_ready", 409, "Generate the frames before asking for a review.");
  const reference = await readReference(id, flipbook.reference.version);
  const reviewed = new Map<string, { version: string | null; review: FlipbookFrame["review"] }>();
  const results: Awaited<ReturnType<typeof services.review>>[] = [];
  const pageSize = flipbook.sequence ? 16 : frames.length;
  for (let start = 0; start < frames.length; start += pageSize) {
    const page = frames.slice(start, start + pageSize);
    const sprites = await Promise.all(page.map((frame) => readFile(flipbookFiles.sprite(id, frame.id, alignment.transforms[frame.id]!.key))));
    const sheet = await contactSheet(sprites, { width: alignment.cellWidth, height: alignment.cellHeight });
    const result = await services.review({ reference: reference.png, sheet, labels: page.map((frame) => flipbook.sequence ? `${frame.poseIndex + 1} at ${Number(frame.phase.slice(7)) / 24} s: ${frame.label}` : frame.label), analysis: flipbook.analysis, direction: cameraDescription(flipbook.plan?.view ?? "side", flipbook.plan?.direction ?? "right"), action: flipbook.plan?.action, flipbookId: id, finite: Boolean(flipbook.sequence), fromVideo: Boolean(flipbook.motionReference) });
    results.push(result);
    page.forEach((frame, index) => reviewed.set(frame.id, { version: frame.version, review: result.frames.get(index) ?? null }));
  }
  const result = { recognizableWalk: results.every((entry) => entry.recognizableWalk), summary: results.length === 1 ? results[0].summary : `${frames.length} drawings reviewed in ${results.length} windows. ${[...results].sort((a, b) => Number(a.recognizableWalk) - Number(b.recognizableWalk)).map((entry) => entry.summary).join(" ")}`.slice(0, 400) };
  return updateFlipbook(id, (current) => ({
    ...current,
    review: { summary: result.summary || "Review finished.", recognizableWalk: result.recognizableWalk, at: new Date().toISOString() },
    // A review only sticks to the drawing it looked at.
    frames: current.frames.map((frame) => {
      const entry = reviewed.get(frame.id);
      return entry && entry.version === frame.version ? { ...frame, review: entry.review } : frame;
    }),
  }));
}

export async function cancelFlipbook(id: string): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  if (!isRunning(flipbook.id)) return flipbook;
  abortWorker(flipbook.id);
  return updateFlipbook(flipbook.id, (current) => ({
    ...current,
    status: current.plan && current.reference ? (current.frames.some((frame) => frame.status === "ready") ? "ready" : "reference_ready") : "canceled",
    // An unfinished frame falls back to its last registered drawing, if it has one.
    frames: current.frames.map((frame) => {
      if (frame.status !== "generating" && frame.status !== "processing") return frame;
      const registered = current.alignment?.transforms[frame.id]?.version;
      return registered && frame.versions.some((version) => version.id === registered)
        ? { ...frame, status: "ready", version: registered, error: null }
        : { ...frame, status: "failed", error: { code: "canceled", message: "Canceled. Draw this frame again." } };
    }),
    inbetweens: current.inbetweens.map((entry) => (entry.status === "generating" || entry.status === "processing" ? { ...entry, status: "failed", error: { code: "canceled", message: "Canceled. Draw the in-betweens again." } } : entry)),
    error: null,
  }), { evenIfCanceled: true });
}

// ── Export ─────────────────────────────────────────────────────────────────

/**
 * The stored files a background is drawn from: the plate (the strip when it
 * scrolls, the near layer in parallax) and, in parallax, the far layer. None
 * for transparent and color.
 */
export function backgroundFiles(background: FlipbookBackground): { plate: BackgroundFile | null; far: BackgroundFile | null } {
  if (background.kind === "custom") return { plate: "custom", far: null };
  if (background.kind !== "scene" && background.kind !== "generated") return { plate: null, far: null };
  const motion = background.motion ?? "static";
  if (motion === "parallax") return { plate: `${background.kind}-near`, far: `${background.kind}-far` };
  return { plate: motion === "scroll" ? `${background.kind}-loop` : background.kind, far: null };
}

function exportKey(value: unknown): string {
  return `x-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;
}

/** A scene plays its own length, at its own pace, once through: nothing the request says about timing changes that. */
function sceneRequest(plan: FlipbookPlan, request: ExportRequest): ExportRequest {
  return { ...request, settings: { ...request.settings, drawingFps: plan.drawingFps, durationSeconds: plan.durationSeconds, motion: "in_place", inbetweens: false, cycleSeconds: undefined, ...(plan.mode === "sequence" ? { smoothing: 0 } : {}) } };
}

export async function exportFlipbook(id: string, asked: ExportRequest, options: ExportOptions = {}): Promise<{ flipbook: Flipbook; record: ExportRecord }> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  const request = (flipbook.cast.length || flipbook.sequence) && flipbook.plan ? sceneRequest(flipbook.plan, asked) : asked;
  const alignment = flipbook.alignment;
  const frames = orderedFrames(flipbook);
  const missing = frames.filter((frame) => frame.status !== "ready" || !alignment?.transforms[frame.id] || alignment.transforms[frame.id]!.version !== frame.version);
  if (!alignment || missing.length) {
    throw new AppError("export_not_ready", 409, `Every frame needs a finished drawing before export. Not ready: ${missing.map((frame) => frame.label).join(", ") || "all frames"}.`);
  }
  const { plate: plateFile, far: farFile } = backgroundFiles(request.background);
  if (plateFile === "scene-loop" && flipbook.backgrounds.scene) await ensureSceneLoop(id);
  if (farFile && !(request.background.kind === "scene" ? flipbook.backgrounds.depth.scene : flipbook.backgrounds.depth.generated)) {
    throw new AppError("depth_unavailable", 409, "This background has no sky to separate, so it can’t move in depth. Choose Slide or Slow zoom instead.");
  }
  const backgroundStamp = plateFile ? (await stat(flipbookFiles.background(id, plateFile)).catch(() => null))?.mtimeMs ?? null : null;
  if (plateFile && backgroundStamp === null) {
    throw new AppError("background_missing", 409, request.background.kind === "scene" ? "Create the scene background first." : request.background.kind === "generated" ? "Generate a background first." : "Upload a background image first.");
  }
    // The played cycle: keys, and their current in-betweens unless they're switched off.
  const cycle = playbackCycle(flipbook, request.settings.inbetweens !== false);
  // A legacy "smooth" setting renders exactly like "drawn", and the cycle itself says whether in-betweens play.
  const key = exportKey({ v: EXPORT_VERSION, request: { ...request, settings: { ...request.settings, renderMode: undefined, inbetweens: undefined } }, frames: cycle.map((drawing) => [drawing.id, alignment.transforms[drawing.id]!.key]), strideX: alignment.strideX, backgroundStamp, audio: request.format === "mp4" ? flipbook.audio : null });
  const existing = flipbook.exports.find((entry) => entry.key === key);
  const dir = flipbookFiles.exportDir(id, key);
  if (existing && (await stat(dir).catch(() => null))) return { flipbook, record: existing };

  return shareRender(`${id}:${key}`, async (signal) => {
  const result = await exportLimiter.run(async () => {
    if (signal.aborted) throw signal.reason;
    const temp = `${dir}.tmp-${process.pid}-${Date.now()}`;
    try {
      await mkdir(temp, { recursive: true });
      const audioFrom = request.format === "mp4" && flipbook.audio ? await prepareExportTrack(id, flipbook.audio, request.settings.durationSeconds, path.join(temp, "sound.m4a"), signal) : undefined;
      const output = await renderExport({
        audioFrom,
        finite: Boolean(flipbook.sequence),
        request,
        frames: cycle.map((drawing) => ({ frameId: drawing.id, label: drawing.label, phase: drawing.phase, inbetween: drawing.inbetween, position: drawing.position, spritePath: flipbookFiles.sprite(id, drawing.id, alignment.transforms[drawing.id]!.key) })),
        alignment,
        plate: plateFile ? flipbookFiles.background(id, plateFile) : null,
        far: farFile ? flipbookFiles.background(id, farFile) : null,
        facing: flipbook.plan?.direction ?? "right",
        outputDir: temp,
        baseName: `focus-flipbook-${flipbook.plan?.action ?? "walk"}`,
        action: flipbook.plan?.action ?? "walk",
        signal,
      });
      if (signal.aborted) throw signal.reason;
      await rm(path.join(temp, "sound.m4a"), { force: true });
      await rm(path.join(temp, "gif-source"), { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
      await rename(temp, dir);
      await writeFile(path.join(dir, "export.json"), JSON.stringify({ files: output.files.map((file) => ({ name: file.name, type: file.type })) }));
      return output;
    } catch (error) {
      await rm(temp, { recursive: true, force: true });
      throw error;
    }
  });
  const record: ExportRecord = {
    key,
    format: request.format,
    settings: request.settings,
    background: request.background,
    files: result.files.map((file) => ({ name: file.name, type: file.type, bytes: file.bytes, url: flipbookUrls.export(id, key, file.name) })),
    facts: result.facts,
    createdAt: new Date().toISOString(),
  };
  let dropped: string[] = [];
  const updated = await updateFlipbook(id, (current) => {
    const kept = [record, ...current.exports.filter((entry) => entry.key !== key)];
    dropped = kept.slice(24).map((entry) => entry.key);
    return { ...current, exports: kept.slice(0, 24) };
  }, { evenIfCanceled: true });
  // Exports that fell off the list leave the disk with it.
  for (const old of dropped) await rm(flipbookFiles.exportDir(id, old), { recursive: true, force: true });
  return { flipbook: updated, record };
  }, { signal: options.signal, beforeStart: options.beforeRender });
}
