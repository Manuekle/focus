import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import sharp from "sharp";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  FRAME_IDS,
  WALK_POSES,
  actionSpec,
  flipbookTitle,
  flipbookUrls,
  orderedFrames,
  type ExportRecord,
  type ExportRequest,
  type Flipbook,
  type FlipbookBackground,
  type FlipbookSummary,
  type ImageLook,
  type PlaybackSettings,
  ImageLookSchema,
  type FlipbookFrame,
  type AnimationAction,
  type BackgroundMotion,
  type FrameAction,
  type FrameId,
} from "../../shared/flipbook";
import { AppError } from "../errors";
import { Limiter } from "../ai/meta";
import { activeWorkCount, type PaidWorkGate } from "../jobs";
import { assessInput, analyzeCharacter, lookAtImage } from "./character-analysis";
import { computeAlignment, extractSubject, MeasureSchema, renderSprite, type AlignInput, type Measure } from "./frame-alignment";
import { renderExport } from "./export";
import { drawPose } from "./frame-generation";
import { decodeImage, getCharacterImage, imageFiles, readUpload } from "./image-input";
import { actionFor, planPoses } from "./pose-planning";
import { checkFrames, contactSheet, reviewFrames } from "./quality-control";
import { FAR_CONCEPTS, decideReference, growMask, drawBackdrop, drawCleanReference, drawScenePlate, readReference, seamlessPlate, splitDepth, storeReference } from "./reference-manager";
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
  draw: drawPose,
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
const EXPORT_VERSION = 1;

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

const RESTING = new Set<Flipbook["status"]>(["reference_ready", "ready", "failed"]);

function assertIdle(flipbook: Flipbook): void {
  if (isRunning(flipbook.id)) throw new AppError("flipbook_busy", 409, "This animation is still working. Wait for the current step to finish.");
  if (!RESTING.has(flipbook.status)) throw new AppError("flipbook_not_editable", 409, "This animation can’t be changed now.");
}

function assertDrawable(flipbook: Flipbook): asserts flipbook is Flipbook & { plan: NonNullable<Flipbook["plan"]>; reference: NonNullable<Flipbook["reference"]> } {
  if (!flipbook.plan || !flipbook.reference) throw new AppError("flipbook_not_ready", 409, "The character reference isn’t ready yet.");
}

/** Where a run lands when it fails: back to the last usable resting state. */
const failWith = (error: AppError) => (current: Flipbook): Flipbook => ({
  ...current,
  status: current.plan && current.reference ? (current.frames.some((frame) => frame.status === "ready") ? "ready" : "reference_ready") : "failed",
  frames: current.frames.map((frame) => (frame.status === "generating" || frame.status === "processing" ? { ...frame, status: "failed", error: { code: error.code, message: error.message } } : frame)),
  error: { code: error.code, message: error.message },
});

/** A change from a worker: dropped once that worker was canceled. */
function workerUpdate(id: string, signal: AbortSignal, change: (current: Flipbook) => Flipbook): Promise<Flipbook> {
  return updateFlipbook(id, (current) => (signal.aborted ? current : change(current)));
}

function patchFrame(current: Flipbook, frameId: string, change: (frame: FlipbookFrame) => FlipbookFrame): Flipbook {
  return { ...current, frames: current.frames.map((frame) => (frame.id === frameId ? change(frame) : frame)) };
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
  input: { readonly imageId: string; readonly prompt: string; readonly ownerId?: string | null; readonly action?: AnimationAction; readonly keepScene?: boolean },
  gate?: PaidWorkGate,
): Promise<Flipbook> {
  assertFlipbookEnabled();
  const { image, png, flat } = await getCharacterImage(input.imageId);
  void cleanupFlipbooks();
  // A motion picked from the reading reuses its character facts: no second look.
  const reading = input.action ? await readLook(image.id) : null;
  const analysis = reading && input.action ? { ...reading.analysis, requestedAction: input.action } : null;
  const keepScene = Boolean(input.keepScene && !image.hasAlpha && (reading ? reading.layers.scene : true));
  // Analysis + plan + up to nine drawings, each cut out by SAM on one still frame; with the scene, its plate and depth layers too.
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: WALK_POSES.length + 1 + (keepScene ? 1 + FAR_CONCEPTS.length : 0) });
  const id = randomUUID();
  await mkdir(flipbookDir(id), { recursive: true });
  await copyFile(png, flipbookFiles.source(id));
  await copyFile(flat, flipbookFiles.sourceFlat(id));
  const now = new Date().toISOString();
  const flipbook = await createState({
    id,
    imageId: image.id,
    ownerId: input.ownerId ?? null,
    title: flipbookTitle({ title: "", prompt: input.prompt }),
    prompt: input.prompt,
    status: "analyzing",
    detail: analysis ? "Planning the poses" : "Analyzing your character with Muse Spark",
    progress: null,
    source: { width: image.width, height: image.height, hasAlpha: image.hasAlpha },
    analysis,
    plan: null,
    warnings: [],
    reference: null,
    frames: skeleton(),
    order: [...FRAME_IDS],
    alignment: null,
    budget: { limit: imageBudget(), used: 0 },
    backgrounds: { scene: false, custom: false, generated: null, depth: { scene: false, generated: false } },
    look: null,
    review: null,
    exports: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  startWorker(id, (signal) => runPipeline(id, signal, { keepScene, fromReading: Boolean(analysis) }), failWith);
  return flipbook;
}

async function runPipeline(id: string, signal: AbortSignal, options: { keepScene: boolean; fromReading: boolean }): Promise<void> {
  const flipbook = await getFlipbook(id);
  const sourceFlat = await readFile(flipbookFiles.sourceFlat(id));

  const analysis = flipbook.analysis ?? await services.analyze({ imagePng: sourceFlat, prompt: flipbook.prompt, flipbookId: id, signal });
  if (signal.aborted) return;
  const assessed = assessInput(analysis);
  if (!assessed.supported) {
    await workerUpdate(id, signal, (current) => ({ ...current, analysis, status: "unsupported", error: { code: "unsupported_animation", message: assessed.reason! } }));
    return;
  }
  await workerUpdate(id, signal, (current) => ({ ...current, analysis, warnings: assessed.warnings, status: "planning", detail: `Planning eight ${actionSpec(actionFor(analysis)).label} poses with Muse Spark` }));

  const plan = await services.plan({ analysis, prompt: flipbook.prompt, flipbookId: id, signal });
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
    const decision = decideReference(analysis);
    if (decision.kind === "clean") await reserveImages(id, 1, false);
    await prepareReference(id, decision, signal);
    if (signal.aborted) return;

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
      plate = await services.scene({ sourceFlat: await readFile(flipbookFiles.sourceFlat(id)), analysis: flipbook.analysis, width: flipbook.source.width, height: flipbook.source.height, flipbookId: id, signal });
    } catch (error) {
      if (unbilled(error)) await refundImages(id, 1);
      throw error;
    }
    if (signal.aborted) return;
    const depth = await storePlate(id, "scene", plate.png, signal);
    const background: FlipbookBackground = { kind: "scene", motion: defaultMotion(plan, depth) };
    await workerUpdate(id, signal, (current) => ({
      ...current,
      backgrounds: { ...current.backgrounds, scene: true, depth: { ...current.backgrounds.depth, scene: depth } },
      // The scene was asked for: it becomes the background, whatever was picked while it was drawn.
      look: { settings: current.look?.settings ?? { drawingFps: plan.drawingFps, durationSeconds: plan.durationSeconds, motion: plan.motion, speed: 1 }, background },
    }));
  } catch (error) {
    if (signal.aborted) return;
    if (!(error instanceof AppError)) console.error("[focus] flipbook scene separation failed", error);
    await workerUpdate(id, signal, (current) => ({ ...current, warnings: [...current.warnings, "The scene couldn’t be separated from the character. Use “Use your scene” to try again, or pick another background."].slice(-8) })).catch(() => undefined);
  }
}

/**
 * How a separated scene moves by default: in two depths (or sliding) behind
 * a walk or run on the spot, still behind one that travels, and a slow zoom
 * behind the motions that never travel (a jump, a wave, a breath, a fight).
 */
export function defaultMotion(plan: Pick<NonNullable<Flipbook["plan"]>, "action" | "motion">, depth: boolean): BackgroundMotion {
  if (!actionSpec(plan.action).travels) return "zoom";
  if (plan.motion !== "in_place") return "static";
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
      drawn = await services.cleanReference({ sourceFlat: await readFile(flipbookFiles.sourceFlat(id)), analysis: flipbook.analysis, direction: flipbook.plan?.direction ?? "right", flipbookId: id, signal });
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

/**
 * Draws the given frames from the anchor (the budget is already reserved),
 * cuts them out, re-registers the cycle and checks it.
 */
async function drawFrames(id: string, signal: AbortSignal, frameIds: readonly FrameId[], options: { note?: string; withNeighbor?: boolean; alsoCut?: readonly FrameId[] }): Promise<void> {
  const flipbook = await getFlipbook(id);
  assertDrawable(flipbook);
  const reference = await readReference(id, flipbook.reference.version);
  const total = frameIds.length;
  let done = 0;
  await workerUpdate(id, signal, (current) => ({
    ...current,
    status: "generating",
    detail: total === 1 ? `Redrawing “${current.frames.find((frame) => frame.id === frameIds[0])?.label}” with Muse Image` : "Drawing the poses with Muse Image",
    progress: { done: 0, total },
    error: null,
    frames: current.frames.map((frame) => (frameIds.includes(frame.id) ? { ...frame, status: "generating", error: null } : frame)),
  }));

  const drawn: FrameId[] = [];
  let refundable = 0;
  await Promise.all(frameIds.map(async (frameId) => {
    const frame = flipbook.frames.find((entry) => entry.id === frameId)!;
    try {
      let neighbor: Buffer | null = null;
      if (options.withNeighbor) {
        const order = flipbook.order;
        const previousId = order[(order.indexOf(frameId) - 1 + order.length) % order.length];
        const previous = flipbook.frames.find((entry) => entry.id === previousId);
        if (previous?.version && previous.status === "ready") neighbor = await readFile(path.join(flipbookFiles.versionDir(id, previous.id, previous.version), "raw.png")).catch(() => null);
      }
      const image = await services.draw({ reference: reference.png, neighbor, analysis: flipbook.analysis, plan: flipbook.plan, index: frame.poseIndex, note: options.note, flipbookId: id, signal });
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
          originalVersion: entry.originalVersion ?? version,
          versions: [...entry.versions, { id: version, source: "generated" as const, createdAt: new Date().toISOString(), ...(options.note ? { note: options.note } : {}) }].slice(-32),
          review: null,
          error: null,
        })),
        progress: { done, total },
      }));
    } catch (error) {
      if (signal.aborted) return;
      if (unbilled(error)) refundable++;
      const failure = error instanceof AppError ? error : new AppError("image_failed", 502, "This drawing failed. Redraw it.");
      if (!(error instanceof AppError)) console.error("[focus] flipbook drawing failed", error);
      await workerUpdate(id, signal, (current) => patchFrame(current, frameId, (entry) => ({
        ...entry,
        // A failed redraw keeps a drawing that is already registered on the cycle.
        status: entry.version && current.alignment?.transforms[frameId]?.version === entry.version ? "ready" : "failed",
        error: { code: failure.code, message: failure.message },
      })));
    }
  }));
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
        const extraction = await extractSubject({ png: await readFile(path.join(dir, "raw.png")), concept: flipbook.analysis?.subject ?? "character", flipbookId: id, allowAlpha: source === "uploaded", signal });
        await writeAtomic(path.join(dir, "cutout.png"), extraction.cutout);
        await writeAtomic(path.join(dir, "measure.json"), JSON.stringify(extraction.measure));
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

async function readMeasure(id: string, frame: FlipbookFrame): Promise<Measure | null> {
  if (!frame.version) return null;
  return readJsonFile(path.join(flipbookFiles.versionDir(id, frame.id, frame.version), "measure.json"), (value) => MeasureSchema.parse(value));
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
    relativeRootY: plan?.poses[frame.poseIndex].relativeRootY ?? WALK_POSES[frame.poseIndex].relativeRootY,
    lift: plan?.poses[frame.poseIndex].lift ?? 0,
    measure,
  }));
  const alignment = entries.length ? computeAlignment(entries, flipbook.alignment, plan?.action) : flipbook.alignment;
  const sprites = new Map<string, Buffer>();
  if (alignment) {
    for (const { frame, measure } of measured) {
      const transform = alignment.transforms[frame.id]!;
      const file = flipbookFiles.sprite(id, frame.id, transform.key);
      let sprite: Buffer | null = await readFile(file).catch(() => null);
      if (!sprite) {
        const cutout = await readFile(path.join(flipbookFiles.versionDir(id, frame.id, frame.version!), "cutout.png"));
        sprite = await renderSprite(cutout, measure, transform, { width: alignment.cellWidth, height: alignment.cellHeight });
        await writeAtomic(file, sprite);
      }
      sprites.set(frame.id, sprite);
    }
  }
  const reference = flipbook.reference ? await readReference(id, flipbook.reference.version).catch(() => null) : null;
  const order = orderedFrames(flipbook).filter((frame) => sprites.has(frame.id));
  const byId = new Map(measured.map((entry) => [entry.frame.id, entry.measure]));
  const checks = alignment
    ? await checkFrames(order.map((frame) => ({
      frameId: frame.id,
      label: frame.label,
      phase: frame.phase,
      measure: byId.get(frame.id)!,
      scale: alignment.transforms[frame.id]!.scale,
      relativeRootY: plan?.poses[frame.poseIndex].relativeRootY ?? WALK_POSES[frame.poseIndex].relativeRootY,
      sprite: sprites.get(frame.id)!,
    })), reference?.measure?.histogram ?? null, plan?.action)
    : new Map();
  const update = (current: Flipbook): Flipbook => ({
    ...current,
    alignment: alignment ? { ...alignment, transforms: Object.fromEntries(Object.entries(alignment.transforms).filter(([frameId]) => current.frames.find((frame) => frame.id === frameId)?.version === alignment.transforms[frameId as FrameId]?.version)) } : null,
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
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: targets.length });
  await reserveImages(id, targets.length, confirmExtra);
  return startVisible(id, markGenerating(targets, "Drawing the poses with Muse Image"), async (signal) => {
    // A failed cut-out keeps its drawing: only cut it out again.
    const current = await getFlipbook(id);
    const recut = targets.filter((frameId) => {
      const frame = current.frames.find((entry) => entry.id === frameId)!;
      return frame.version && ["extraction_failed", "no_subject"].includes(frame.error?.code ?? "");
    });
    const redraw = targets.filter((frameId) => !recut.includes(frameId));
    await refundImages(id, recut.length);
    if (recut.length) {
      await workerUpdate(id, signal, (state) => ({ ...state, frames: state.frames.map((frame) => (recut.includes(frame.id) ? { ...frame, status: "processing", error: null } : frame)) }));
    }
    if (redraw.length) await drawFrames(id, signal, redraw, { alsoCut: recut });
    else await cutOut(id, signal, recut);
  });
}

export async function applyFrameAction(id: string, frameId: FrameId, action: FrameAction, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  const frame = flipbook.frames.find((entry) => entry.id === frameId);
  if (!frame) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");

  if (action.action === "approve") {
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
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
  await reserveImages(id, 1, action.confirmExtra === true);
  return startVisible(id, markGenerating([frameId], `Redrawing “${frame.label}” with Muse Image`), (signal) => drawFrames(id, signal, [frameId], { note: action.note || undefined, withNeighbor: true }));
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
  assertIdle(flipbook);
  if (!flipbook.plan) throw new AppError("flipbook_not_ready", 409, "The pose plan isn’t ready yet.");
  if (kind === "uploaded" && !options.upload) throw new AppError("empty_file", 400, "We didn’t receive a file.");
  if (kind === "uploaded") await decodeImage(options.upload!);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
  if (kind === "clean") await reserveImages(id, 1, options.confirmExtra === true);
  const reason = kind === "clean" ? "A clean full-body side view drawn from your illustration." : kind === "uploaded" ? "The reference image you uploaded." : "Your original illustration.";
  return startVisible(id, (current) => ({ ...current, status: "referencing", detail: "Preparing the character reference", error: null }), async (signal) => {
    await prepareReference(id, { kind, reason }, signal, options.upload);
    if (signal.aborted) return;
    // Color checks compare against the reference: re-check what exists.
    await finalize(id, signal);
  });
}

export async function createScene(id: string, confirmExtra: boolean, gate?: PaidWorkGate): Promise<Flipbook> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
  if (flipbook.analysis?.background === "plain") throw new AppError("scene_unavailable", 409, "Your illustration has a plain background, so there is no scene to keep. Choose a color or upload a background.");
  // The plate, then SAM on its strip for the depth layers.
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 + FAR_CONCEPTS.length });
  await reserveImages(id, 1, confirmExtra);
  let depth: boolean;
  try {
    const plate = await services.scene({ sourceFlat: await readFile(flipbookFiles.sourceFlat(id)), analysis: flipbook.analysis, width: flipbook.source.width, height: flipbook.source.height, flipbookId: id });
    depth = await storePlate(id, "scene", plate.png);
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
    const plate = await services.backdrop({ sourceFlat: await readFile(flipbookFiles.sourceFlat(id)), analysis: flipbook.analysis, prompt: input.prompt, flipbookId: id });
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
  const { crop, rawWidth: width, rawHeight: height } = measure;
  const alpha = await sharp(cutout).ensureAlpha().extractChannel(3).raw().toBuffer();
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < crop.height; y++) mask.set(alpha.subarray(y * crop.width, (y + 1) * crop.width), (crop.top + y) * width + crop.left);
  const grown = growMask(mask, width, height, 4);
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
export async function sendToEditor(id: string, look: { settings: PlaybackSettings; background: FlipbookBackground }): Promise<{ flipbook: Flipbook; video: VideoAsset }> {
  if (look.background.kind === "transparent") throw new AppError("mp4_needs_background", 400, "The editor needs a background. Choose a color, a scene or an image.");
  const { flipbook, record } = await exportFlipbook(id, { format: "mp4", ...look });
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
  const sprites = await Promise.all(frames.map((frame) => readFile(flipbookFiles.sprite(id, frame.id, alignment.transforms[frame.id]!.key))));
  const sheet = await contactSheet(sprites, { width: alignment.cellWidth, height: alignment.cellHeight });
  const reference = await readReference(id, flipbook.reference.version);
  const result = await services.review({
    reference: reference.png,
    sheet,
    labels: frames.map((frame) => frame.label),
    analysis: flipbook.analysis,
    direction: flipbook.plan?.direction ?? "right",
    action: flipbook.plan?.action,
    flipbookId: id,
  });
  const reviewed = new Map(frames.map((frame, index) => [frame.id, { version: frame.version, review: result.frames.get(index) ?? null }]));
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

export async function exportFlipbook(id: string, request: ExportRequest): Promise<{ flipbook: Flipbook; record: ExportRecord }> {
  assertFlipbookEnabled();
  const flipbook = await getFlipbook(id);
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
  const key = exportKey({ v: EXPORT_VERSION, request, frames: frames.map((frame) => [frame.id, alignment.transforms[frame.id]!.key]), strideX: alignment.strideX, backgroundStamp });
  const existing = flipbook.exports.find((entry) => entry.key === key);
  const dir = flipbookFiles.exportDir(id, key);
  if (existing && (await stat(dir).catch(() => null))) return { flipbook, record: existing };

  const result = await exportLimiter.run(async () => {
    const temp = `${dir}.tmp-${process.pid}-${Date.now()}`;
    try {
      const output = await renderExport({
        request,
        frames: frames.map((frame) => ({ frameId: frame.id, label: frame.label, phase: frame.phase, spritePath: flipbookFiles.sprite(id, frame.id, alignment.transforms[frame.id]!.key) })),
        alignment,
        plate: plateFile ? flipbookFiles.background(id, plateFile) : null,
        far: farFile ? flipbookFiles.background(id, farFile) : null,
        facing: flipbook.plan?.direction ?? "right",
        outputDir: temp,
        baseName: `focus-flipbook-${flipbook.plan?.action ?? "walk"}`,
        action: flipbook.plan?.action ?? "walk",
      });
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
}
