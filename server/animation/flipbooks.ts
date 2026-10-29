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
  nextInOrder,
  orderedFrames,
  playbackCycle,
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
import { computeAlignment, computeEnsembleAlignment, extractSubject, MeasureSchema, renderSprite, type AlignInput, type Measure } from "./frame-alignment";
import { stationaryBodyColors, type BodyColors } from "./appearance-consistency";
import { renderExport } from "./export";
import { drawEnsembleFrame, drawInbetween, drawPose } from "./frame-generation";
import { ensembleView, groupConcepts, mergeAnalyses, planEnsemble, type CastEntry } from "./ensemble-planning";
import { loadPoseReference } from "./pose-references";
import { compatiblePoseId } from "./pose-catalog";
import { decodeImage, getCharacterImage, imageFiles, readUpload } from "./image-input";
import { actionFor, planPoses } from "./pose-planning";
import { planSequence, sequenceSkeleton } from "./sequence-planning";
import { SequenceSettingsSchema, type SequenceSettings } from "../../shared/sequence";
import { prepareExportTrack } from "./flipbook-audio";
import { motionGuide } from "./motion-reference";
import { waveAnchorIndexes } from "./wave-sequence";
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
//   → eight Muse Image drawings (anchored) → SAM 3.1 cut-outs → registration
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
  planEnsemble,
  draw: drawPose,
  drawEnsemble: drawEnsembleFrame,
  inbetween: drawInbetween,
  poseReference: loadPoseReference,
  cleanReference: drawCleanReference,
  scene: drawScenePlate,
  backdrop: drawBackdrop,
  review: reviewFrames,
};

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

const RESTING = new Set<Flipbook["status"]>(["reference_ready", "ready", "failed"]);

function assertIdle(flipbook: Flipbook): void {
  if (isRunning(flipbook.id)) throw new AppError("flipbook_busy", 409, "This animation is still working. Wait for the current step to finish.");
  if (!RESTING.has(flipbook.status)) throw new AppError("flipbook_not_editable", 409, "This animation can’t be changed now.");
}

/** Cycle-only features (in-betweens, reordering, a changed reference): a scene's drawings are fixed beats of one choreography. */
function assertScenelessCycle(flipbook: Flipbook, what: string): void {
  if (flipbook.sequence) throw new AppError("not_for_sequences", 409, `${what} is for repeated cycles. Edit the sequence's timed drawings instead.`);
  if (flipbook.cast.length) throw new AppError("not_for_scenes", 409, `${what} isn’t available for a scene with several characters. Redraw a drawing instead.`);
}

function assertDrawable(flipbook: Flipbook): asserts flipbook is Flipbook & { plan: NonNullable<Flipbook["plan"]>; reference: NonNullable<Flipbook["reference"]> } {
  if (!flipbook.plan || !flipbook.reference) throw new AppError("flipbook_not_ready", 409, "The character reference isn’t ready yet.");
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
async function reserveImages(id: string, count: number, confirmExtra: boolean): Promise<void> {
  await updateFlipbook(id, (current) => {
    const next = current.budget.used + count;
    if (next > current.budget.limit && !confirmExtra) {
      throw new AppError(
        "budget_reached",
        402,
        `This animation has used ${current.budget.used} of its ${current.budget.limit} drawings. Confirm to draw ${count} more.`,
      );
    }
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
  input: { readonly imageId?: string; readonly characterSource?: CharacterSource; readonly view?: ViewPreference; readonly prompt: string; readonly ownerId?: string | null; readonly action?: CycleAction; readonly poseId?: PoseId; readonly keepScene?: boolean; readonly sequence?: SequenceSettings },
  gate?: PaidWorkGate,
): Promise<Flipbook> {
  assertFlipbookEnabled();
  const sequence = input.sequence ? SequenceSettingsSchema.parse(input.sequence) : undefined;
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
    status: "analyzing",
    detail: analysis ? "Planning the poses" : "Analyzing your character with Muse Spark",
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
  startWorker(id, (signal) => runPipeline(id, signal, { keepScene, fromReading: Boolean(analysis), action }), failWith);
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

async function runPipeline(id: string, signal: AbortSignal, options: { keepScene: boolean; fromReading: boolean; action?: CycleAction }): Promise<void> {
  const flipbook = await getFlipbook(id);
  // Fail before paid model work if the selected posture cannot be retrieved.
  if (flipbook.poseId) await services.poseReference(flipbook.poseId, signal);
  const sourceFlat = await readFile(flipbookFiles.sourceFlat(id));

  const analyzed = flipbook.analysis ?? await services.analyze({ imagePng: sourceFlat, prompt: flipbook.prompt, flipbookId: id, signal });
  const action = flipbook.poseId ? "idle" : options.action;
  const analysis = action ? { ...analyzed, requestedAction: action } : analyzed;
  if (signal.aborted) return;
  const assessed = assessInput(analysis);
  if (!assessed.supported) {
    await workerUpdate(id, signal, (current) => ({ ...current, analysis, status: "unsupported", error: { code: "unsupported_animation", message: assessed.reason! } }));
    return;
  }
  await workerUpdate(id, signal, (current) => ({ ...current, analysis, warnings: assessed.warnings, status: "planning", detail: flipbook.sequence ? `Planning ${flipbook.frames.length} drawings across ${flipbook.sequence.durationSeconds} seconds` : `Planning eight ${actionSpec(actionFor(analysis)).label} poses with Muse Spark` }));

  const proposedPlan = flipbook.sequence
    ? await services.planSequence({ analysis, prompt: flipbook.prompt, flipbookId: id, settings: flipbook.sequence, view: flipbook.requestedView, action, signal })
    : await services.plan({ analysis, prompt: flipbook.prompt, flipbookId: id, imagePng: sourceFlat, poseId: flipbook.poseId, view: flipbook.requestedView, signal });
  // The camera is user intent, not a model suggestion. Keep it even if a
  // provider or an older injected planner omits the new plan field.
  const cameraView = resolveCameraView(flipbook.requestedView, analysis, flipbook.prompt);
  const plan = { ...proposedPlan, ...(flipbook.sequence ? { motionId: randomUUID() } : {}), view: cameraView,
    poseId: compatiblePoseId(proposedPlan.poseId, proposedPlan.action, cameraView),
    poses: proposedPlan.poses.map((pose) => ({ ...pose, referenceId: compatiblePoseId(pose.referenceId, proposedPlan.action, cameraView), description: phaseForView(pose.description, cameraView) })),
  };
  if (signal.aborted) return;
  await workerUpdate(id, signal, (current) => ({
    ...current,
    plan,
    frames: current.frames.map((frame) => ({ ...frame, phase: plan.poses[frame.poseIndex].phase, label: plan.poses[frame.poseIndex].label })),
    status: "referencing",
    detail: "Preparing the character reference",
  }));

  // The scene is redrawn without the character alongside the poses.
  const scene = options.keepScene ? separateScene(id, signal, plan) : Promise.resolve();
  try {
    const decision = decideReference(analysis, plan.view);
    if (decision.kind === "clean") await reserveImages(id, 1, false);
    await prepareReference(id, decision, signal);
    if (signal.aborted) return;
    if (flipbook.sequence) {
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
function problemsOf(frame: FlipbookFrame): string[] {
  return [
    ...frame.warnings.map((warning) => warning.message),
    ...(frame.review?.issues ?? []).map((issue) => `${issue.code.replaceAll("_", " ")}: ${issue.note}`),
  ].map((text) => text.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 6);
}

/**
 * Draws the given frames from the anchor (the budget is already reserved),
 * cuts them out, re-registers the cycle and checks it.
 */
async function drawFrames(id: string, signal: AbortSignal, frameIds: readonly FrameId[], options: { note?: string; withNeighbor?: boolean; repair?: boolean; alsoCut?: readonly FrameId[] }): Promise<void> {
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
  const waveAnchors = flipbook.sequence && flipbook.plan.action === "wave" && !flipbook.motionReference ? waveAnchorIndexes(flipbook.plan) : [];
  const startedIds = new Set<FrameId>();
  let refundable = 0;
  let started = 0;
  const drawOne = async (frameId: FrameId) => {
    if (signal.aborted) return;
    await workerUpdate(id, signal, (current) => ({ ...current, queuedDrawings: current.queuedDrawings?.filter((id) => id !== frameId) }));
    if (signal.aborted) return;
    started++;
    startedIds.add(frameId);
    const frame = flipbook.frames.find((entry) => entry.id === frameId)!;
    try {
      let neighbor: Buffer | null = null;
      const latest = flipbook.sequence ? await getFlipbook(id) : flipbook;
      if (options.withNeighbor || flipbook.sequence) {
        const order = flipbook.order;
        const previousIndex = order.indexOf(frameId) - 1;
        const previousIds = flipbook.sequence ? order.slice(0, previousIndex + 1).reverse() : [order[(previousIndex + order.length) % order.length]];
        const previous = previousIds.map((id) => latest.frames.find((entry) => entry.id === id)).find((entry) => entry?.version && (entry.status !== "failed" || ["canceled", "interrupted", "extraction_failed"].includes(entry.error?.code ?? "")));
        if (previous?.version) neighbor = await readFile(path.join(flipbookFiles.versionDir(id, previous.id, previous.version), "raw.png")).catch(() => null);
      }
      let temporalPair: Parameters<typeof services.draw>[0]["temporalPair"];
      if (waveAnchors.length && !waveAnchors.includes(frame.poseIndex) && !options.repair) {
        const fromIndex = waveAnchors.filter((index) => index < frame.poseIndex).at(-1)!;
        const toIndex = waveAnchors.find((index) => index > frame.poseIndex)!;
        const from = latest.frames.find((entry) => entry.poseIndex === fromIndex)!;
        const to = latest.frames.find((entry) => entry.poseIndex === toIndex)!;
        if (!from.version || !to.version) throw new AppError("keyframes_not_ready", 409, "Finish the surrounding key poses before drawing this transition.");
        temporalPair = { from: await readFile(path.join(flipbookFiles.versionDir(id, from.id, from.version), "raw.png")), to: await readFile(path.join(flipbookFiles.versionDir(id, to.id, to.version), "raw.png")), fromIndex, toIndex, position: (frame.poseIndex - fromIndex) / (toIndex - fromIndex) };
      }
      let repair: { png: Buffer; problems: string[] } | null = null;
      if (options.repair && frame.version) {
        const png = await readFile(path.join(flipbookFiles.versionDir(id, frameId, frame.version), "raw.png")).catch(() => null);
        if (!png) throw new AppError("drawing_missing", 409, "This drawing’s file is missing. Redraw the frame instead.");
        repair = { png, problems: problemsOf(frame) };
      }
      const guideId = compatiblePoseId(flipbook.plan.poseId ?? flipbook.plan.poses[frame.poseIndex].referenceId, flipbook.plan.action, flipbook.plan.view ?? "side");
      const tick = flipbook.sequence ? Number(frame.phase.slice(7)) : -1;
      const guide = flipbook.motionReference ? await motionGuide(id, flipbook.motionReference, tick) : null;
      const image = await services.draw({ reference: reference.png, neighbor, extras, identityReference, repair, temporalPair, motionGuide: guide ?? undefined, poseReference: guideId ? poseReferences.get(guideId) : undefined, requirePoseReference: Boolean(flipbook.poseId), analysis: flipbook.analysis, plan: flipbook.plan, index: frame.poseIndex, note: options.note, flipbookId: id, signal });
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
  try {
    let remaining = [...frameIds];
    if (waveAnchors.length && !options.repair && !options.note) {
      const keyIds = waveAnchors.map((index) => flipbook.order[index]);
      for (const key of keyIds) if (remaining.includes(key) && !signal.aborted) await drawOne(key);
      remaining = remaining.filter((id) => !keyIds.includes(id));
      const current = await getFlipbook(id);
      if (keyIds.some((id) => !current.frames.find((frame) => frame.id === id)?.version)) remaining = [];
    } else if (flipbook.sequence && remaining.includes(flipbook.order[0])) {
      await drawOne(flipbook.order[0]);
      remaining = remaining.filter((id) => id !== flipbook.order[0]);
    }
    for (let offset = 0; offset < remaining.length && !signal.aborted; offset += 2) {
      await Promise.all(remaining.slice(offset, offset + 2).map(drawOne));
    }
  } finally {
    await refundImages(id, refundable + frameIds.length - started);
    await updateFlipbook(id, (current) => ({ ...current, queuedDrawings: [] }), { evenIfCanceled: true });
  }
  if (signal.aborted) return;
  await workerUpdate(id, signal, (current) => ({ ...current, frames: current.frames.map((frame) => frameIds.includes(frame.id) && !startedIds.has(frame.id) ? { ...frame, status: "failed", error: { code: "keyframes_not_ready", message: "A surrounding key pose failed. Generate the pending drawings to continue." } } : frame) }));
  await cutOut(id, signal, [...drawn, ...(options.alsoCut ?? [])]);
}

/**
 * Draws the given drawings of a scene (the budget is already reserved). Each
 * is made from every character's own image and, when there is one, the
 * drawing before it, so the staging, the size and the line carry on from beat
 * to beat. A whole scene goes in two lanes: each drawing leans on the one two
 * beats back (the second beat on the first), so the image limiter keeps two
 * requests going at once.
 */
async function drawEnsembleFrames(id: string, signal: AbortSignal, frameIds: readonly FrameId[], options: { note?: string; withNeighbor?: boolean; repair?: boolean; alsoCut?: readonly FrameId[] }): Promise<void> {
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
        repair = { png, problems: problemsOf(frame) };
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

/** SAM 3.1 cut-outs for freshly drawn or uploaded versions, then registration and checks. */
async function cutOut(id: string, signal: AbortSignal, frameIds: readonly FrameId[]): Promise<void> {
  if (frameIds.length) {
    const total = frameIds.length;
    let done = 0;
    await workerUpdate(id, signal, (current) => ({ ...current, status: "preparing", detail: "Cutting out the sprites with SAM 3.1", progress: { done: 0, total } }));
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
          const extraction = await extractSubject({ png: await readFile(path.join(dir, "raw.png")), concept: flipbook.analysis?.subject ?? "character", flipbookId: id, allowAlpha: source === "uploaded", ...(flipbook.cast.length ? { group: { concepts: groupConcepts(flipbook.cast.map((member) => member.analysis)), expected: flipbook.cast.length } } : {}), signal });
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
  await finalize(id, signal);
}

async function readMeasure(id: string, drawing: { readonly id: DrawingId; readonly version: string | null }): Promise<Measure | null> {
  if (!drawing.version) return null;
  return readJsonFile(path.join(flipbookFiles.versionDir(id, drawing.id, drawing.version), "measure.json"), (value) => MeasureSchema.parse(value));
}

/**
 * Registration and checks for every frame that has a cut-out. Local work
 * only: no AI call. Sprites whose pixels would not change keep their files.
 */
async function finalize(id: string, signal?: AbortSignal): Promise<Flipbook> {
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
    const position = entry.position ?? 0.5;
    entries.push({ frameId: entry.id, version: entry.version!, phase: "inbetween", relativeRootY: from.relativeRootY + (to.relativeRootY - from.relativeRootY) * position, lift: from.lift + (to.lift - from.lift) * position, measure });
  }
  // A scene's camera is fixed: its drawings keep the place they were drawn at instead of being registered on one body.
  const fixedGesture = flipbook.sequence && !flipbook.motionReference && (plan?.action === "wave" || plan?.action === "idle");
  const alignment = entries.length ? ((flipbook.cast.length || flipbook.sequence) && !fixedGesture ? computeEnsembleAlignment(entries) : computeAlignment(entries, flipbook.alignment, plan?.action, plan?.view)) : flipbook.alignment;
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
  const reference = flipbook.reference ? await readReference(id, flipbook.reference.version).catch(() => null) : null;
  const stationaryReference = fixedGesture && reference?.measure ? await stationaryBodyColors(reference.png, {
    centerX: reference.measure.crop.left + reference.measure.torsoX,
    topY: reference.measure.crop.top + reference.measure.topY,
    footY: reference.measure.crop.top + reference.measure.footY,
  }) : undefined;
  const order = orderedFrames(flipbook).filter((frame) => sprites.has(frame.id));
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
    })), reference?.measure?.histogram ?? null, plan?.action, plan?.view, Boolean(flipbook.sequence), stationaryReference)
    : new Map();
  const update = (current: Flipbook): Flipbook => ({
    ...current,
    // Only transforms of the drawings each key or in-between still shows.
    alignment: alignment ? { ...alignment, transforms: Object.fromEntries(Object.entries(alignment.transforms).filter(([drawingId, transform]) => (current.frames.find((frame) => frame.id === drawingId) ?? current.inbetweens.find((entry) => entry.id === drawingId))?.version === transform?.version)) } : null,
    inbetweens: current.inbetweens.map((entry) => {
      if (entry.status !== "processing") return entry;
      return alignment?.transforms[entry.id]?.version === entry.version
        ? { ...entry, status: "ready", error: null }
        : { ...entry, status: "failed", error: { code: "extraction_failed", message: "This in-between couldn’t be cut out. Draw the in-betweens again." } };
    }),
    status: current.plan && current.reference ? (current.frames.some((frame) => frame.version) ? "ready" : "reference_ready") : current.status,
    detail: null,
    progress: null,
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
        warnings: check.warnings,
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
  return { id: newVersionId(), createdAt: new Date().toISOString(), plan: current.plan!, frames: current.frames, order: current.order, alignment: current.alignment, motionReference: current.motionReference };
}

export async function reviseSequence(id: string, settings: SequenceSettings, gate?: PaidWorkGate, motion?: { reference: NonNullable<Flipbook["motionReference"]>; guide: (tick: number) => Promise<Buffer | null>; audio?: NonNullable<Flipbook["audio"]> }): Promise<Flipbook> {
  const source = await getFlipbook(id);
  assertIdle(source);
  assertDrawable(source);
  if (source.cast.length || !source.analysis) throw new AppError("sequence_not_supported", 409, "Choose a single character with a prepared reference.");
  const parsed = SequenceSettingsSchema.parse(settings);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 0 });
  return startVisible(id, (current) => ({ ...current, status: "planning", detail: `Planning ${parsed.durationSeconds * parsed.drawingFps} timed drawings`, error: null }), async (signal) => {
    const eligible = motion ? [] : (source.revisions ?? []).filter((entry) => source.plan?.motionId && entry.plan.motionId === source.plan.motionId && entry.motionReference?.version === source.motionReference?.version);
    const planned = await services.planSequence({ analysis: source.analysis!, prompt: source.prompt, settings: parsed, flipbookId: id, view: source.requestedView, action: source.plan!.action === "ensemble" ? undefined : source.plan!.action, previous: motion ? undefined : source.plan!, reusePoses: eligible.flatMap((entry) => entry.plan.poses), guide: motion?.guide ?? (source.motionReference ? (tick) => motionGuide(id, source.motionReference!, tick) : undefined), signal });
    const plan = { ...planned, motionId: motion ? randomUUID() : source.plan?.motionId ?? randomUUID() };
    const reusable = new Map(motion ? [] : [...eligible.flatMap((entry) => entry.frames), ...source.frames].map((frame) => [frame.id, frame]));
    const frames = sequenceSkeleton(parsed).map((frame) => ({ ...(reusable.get(frame.id) ?? frame), poseIndex: frame.poseIndex, phase: frame.phase, label: plan.poses[frame.poseIndex].label }));
    await workerUpdate(id, signal, (current) => ({ ...current, sequence: parsed, plan, frames, order: frames.map((frame) => frame.id), inbetweens: [], revisions: [...(current.revisions ?? []), revisionOf(source)].slice(-20), ...(motion ? { motionReference: motion.reference, ...(motion.audio ? { audio: motion.audio } : {}) } : {}), look: { settings: { ...(current.look?.settings ?? { aspect: "16:9", speed: 1 }), ...parsed, motion: "in_place", cycleSeconds: undefined, smoothing: 0 }, background: current.look?.background ?? { kind: "color", color: "#ffffff" } }, alignment: null, status: "reference_ready", detail: null, error: null }));
    await finalize(id, signal);
  });
}

export async function restoreSequenceRevision(id: string, revisionId: string): Promise<Flipbook> {
  const source = await getFlipbook(id);
  assertIdle(source);
  const selected = source.revisions?.find((entry) => entry.id === revisionId);
  if (!selected) throw new AppError("revision_not_found", 404, "That motion revision is no longer available.");
  return updateFlipbook(id, (current) => ({ ...current, plan: selected.plan, sequence: selected.plan.mode === "sequence" ? SequenceSettingsSchema.parse(selected.plan) : undefined, frames: selected.frames, order: selected.order, alignment: selected.alignment, motionReference: selected.motionReference, inbetweens: [], look: current.look ? { ...current.look, settings: { ...current.look.settings, drawingFps: selected.plan.drawingFps, durationSeconds: selected.plan.durationSeconds, motion: selected.plan.motion } } : null, revisions: [...(current.revisions ?? []).filter((entry) => entry.id !== revisionId), revisionOf(current)].slice(-20), status: "ready", error: null }));
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

  assertDrawable(flipbook);
  const repair = action.action === "enhance";
  if (repair && !frame.version) throw new AppError("nothing_to_enhance", 409, "This frame has no drawing to improve yet. Draw it first.");
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
  await reserveImages(id, 1, action.confirmExtra === true);
  return startVisible(id, markGenerating([frameId], `${repair ? "Repairing" : "Redrawing"} “${frame.label}” with Muse Image`), (signal) => drawFrames(id, signal, [frameId], { note: action.note || undefined, withNeighbor: true, repair }));
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
 * Draws missing or stale exposure slots at the requested pace (one midpoint
 * per key for older requests): one drawing from
 * the budget each, refunded when Meta doesn't bill it. The key drawings never
 * change. Each is cut out and registered on the same cell as the keys.
 */
export async function drawInbetweens(id: string, confirmExtra: boolean, gate?: PaidWorkGate, drawingFps?: DrawingFps): Promise<Flipbook> {
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
  const targets: InbetweenTarget[] = drawingFps
    ? denseInbetweenTargets(flipbook, drawingFps)
    : inbetweenTargets(flipbook).map((from) => ({ id: inbetweenAfter(from), from, position: 0.5 }));
  if (!targets.length) throw new AppError("nothing_to_generate", 409, "Every in-between is already drawn for the current drawings.");
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: targets.length });
  await reserveImages(id, targets.length, confirmExtra);
  const detail = `Drawing ${targets.length} ${targets.length === 1 ? "in-between" : "in-betweens"} with Muse Image`;
  return startVisible(id, (current) => {
    const fresh = targets.map(({ id: targetId, from: fromId, position }): Inbetween => {
      const to = nextInOrder(current, fromId);
      const old = current.inbetweens.find((entry) => entry.id === targetId);
      return {
        id: targetId,
        from: fromId,
        to,
        fromVersion: current.frames.find((frame) => frame.id === fromId)!.version!,
        toVersion: current.frames.find((frame) => frame.id === to)!.version!,
        position,
        status: "generating",
        version: old?.version ?? null,
        error: null,
      };
    });
    return {
      ...current,
      status: "generating",
      detail,
      progress: { done: 0, total: targets.length },
      error: null,
      inbetweens: [...current.inbetweens.filter((entry) => !targets.some((target) => target.id === entry.id)), ...fresh],
    };
  }, (signal) => runInbetweens(id, signal, targets, detail));
}

async function runInbetweens(id: string, signal: AbortSignal, targets: readonly InbetweenTarget[], detail: string): Promise<void> {
  const flipbook = await getFlipbook(id);
  assertDrawable(flipbook);
  const reference = await readReference(id, flipbook.reference.version);
  const extras = await readExtras(flipbook);
  const identityReference = flipbook.characterSource ? await readFile(flipbookFiles.identity(id)) : undefined;
  const frameOf = (frameId: FrameId) => flipbook.frames.find((frame) => frame.id === frameId)!;
  const raw = (frame: FlipbookFrame) => readFile(path.join(flipbookFiles.versionDir(id, frame.id, frame.version!), "raw.png"));
  const total = targets.length;
  let done = 0;
  let refundable = 0;
  const drawn: InbetweenId[] = [];
  await workerUpdate(id, signal, (current) => ({ ...current, status: "generating", detail, progress: { done: 0, total } }));
  await Promise.all(targets.map(async ({ id: inbetweenId, from: fromId, position }) => {
    const from = frameOf(fromId);
    const to = frameOf(nextInOrder(flipbook, fromId));
    try {
      const image = await services.inbetween({ reference: reference.png, from: await raw(from), to: await raw(to), extras, identityReference, analysis: flipbook.analysis, plan: flipbook.plan, fromIndex: from.poseIndex, toIndex: to.poseIndex, position, flipbookId: id, signal });
      if (signal.aborted) return;
      const version = newVersionId();
      await writeAtomic(path.join(flipbookFiles.versionDir(id, inbetweenId, version), "raw.png"), image.png);
      drawn.push(inbetweenId);
      done++;
      await workerUpdate(id, signal, (current) => ({ ...patchInbetween(current, inbetweenId, (entry) => ({ ...entry, status: "processing", version, error: null })), progress: { done, total } }));
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
    await workerUpdate(id, signal, (current) => ({ ...current, status: "preparing", detail: "Cutting out the in-betweens with SAM 3.1", progress: { done: 0, total: drawn.length } }));
    for (const inbetweenId of drawn) {
      if (signal.aborted) return;
      const current = await getFlipbook(id);
      const entry = current.inbetweens.find((candidate) => candidate.id === inbetweenId);
      if (!entry?.version) continue;
      const dir = flipbookFiles.versionDir(id, inbetweenId, entry.version);
      try {
        const extraction = await extractSubject({ png: await readFile(path.join(dir, "raw.png")), concept: current.analysis?.subject ?? "character", flipbookId: id, allowAlpha: false, signal });
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
  await finalize(id, signal);
}

/** A drawing the animator made or fixed elsewhere becomes the frame's current version. */
export async function replaceFrame(id: string, frameId: FrameId, body: ReadableStream<Uint8Array> | null, declaredBytes: number | undefined, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  const frame = flipbook.frames.find((entry) => entry.id === frameId);
  if (!frame) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  assertIdle(flipbook);
  assertDrawable(flipbook);
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
  assertIdle(flipbook);
  if (!flipbook.plan) throw new AppError("flipbook_not_ready", 409, "The pose plan isn’t ready yet.");
  if (kind === "uploaded" && !options.upload) throw new AppError("empty_file", 400, "We didn’t receive a file.");
  if (kind === "uploaded") await decodeImage(options.upload!);
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
  // The drawing, then SAM on its strip for the depth layers.
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
    const result = await services.review({ reference: reference.png, sheet, labels: page.map((frame) => flipbook.sequence ? `${frame.poseIndex + 1} at ${Number(frame.phase.slice(7)) / 24} s: ${frame.label}` : frame.label), analysis: flipbook.analysis, direction: cameraDescription(flipbook.plan?.view ?? "side", flipbook.plan?.direction ?? "right"), action: flipbook.plan?.action, flipbookId: id, finite: Boolean(flipbook.sequence) });
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
