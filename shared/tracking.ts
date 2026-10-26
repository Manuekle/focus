import { z } from "zod";
import {
  decodeMaskToRaster,
  frameIndexOf,
  recordsOfKind,
  type SegmentationDiagnostic,
  type SegmentationRecord,
  type ResponseStreamOutcome,
} from "@meta-sam/parser";
import type { TrackedObjectSummary } from "./schemas";

// The one representation of a segmentation pass, shared by the server (which
// builds and stores it), the overlay (which draws it) and the compositor
// (which will read masks from it). Frame indices are normalized-video indices.

export const MaskSchema = z.object({
  encoding: z.enum(["lossless", "one_bit"]),
  payload: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const BoxSchema = z.object({
  left: z.number().int(),
  top: z.number().int(),
  /** Half-open, like the parser's records. */
  right: z.number().int(),
  bottom: z.number().int(),
});
export type Box = z.infer<typeof BoxSchema>;

export const FrameObjectSchema = z.object({
  objectId: z.string(),
  box: BoxSchema,
  confidence: z.number().min(0).max(1).nullable(),
  /** The raster covers `box`; null when only a box arrived. */
  mask: MaskSchema.nullable(),
});
export type FrameObject = z.infer<typeof FrameObjectSchema>;

export const TrackingFrameSchema = z.object({
  frameIndex: z.number().int().nonnegative(),
  timestamp: z.number().nonnegative(),
  objects: z.array(FrameObjectSchema),
});
export type TrackingFrame = z.infer<typeof TrackingFrameSchema>;

export const TrackingSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  source: z.enum(["concept", "point"]),
  /** Concept text, or a description of the point prompt. */
  prompt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  frameCount: z.number().int().positive(),
  /** Sorted by frame index; only frames where at least one object is visible. */
  frames: z.array(TrackingFrameSchema),
  objects: z.array(
    z.object({
      id: z.string(),
      framesPresent: z.number().int().nonnegative(),
      firstFrame: z.number().int().nonnegative(),
      lastFrame: z.number().int().nonnegative(),
      meanConfidence: z.number().min(0).max(1).nullable(),
      meanArea: z.number().nonnegative(),
      source: z.enum(["concept", "point"]),
    }),
  ),
  /** Frames with no object at all, between the first and last detection. */
  missingFrames: z.array(z.number().int()),
  diagnostics: z.array(z.object({ severity: z.string(), code: z.string(), message: z.string() })),
  outcome: z.object({ status: z.enum(["completed", "incomplete"]), reason: z.string().optional() }),
  videoFramesProcessed: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
});
export type Tracking = z.infer<typeof TrackingSchema>;

export type BuildTrackingInput = {
  readonly id: string;
  readonly videoId: string;
  readonly source: "concept" | "point";
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly records: readonly SegmentationRecord[];
  readonly diagnostics: readonly SegmentationDiagnostic[];
  readonly outcome: ResponseStreamOutcome;
  readonly videoFramesProcessed: number | null;
  /** Remaps parsed object ids, e.g. to keep point-prompt objects distinct. */
  readonly objectIdPrefix?: string;
};

/**
 * Turns parser records into frames keyed by their explicit frame index — never
 * by arrival order, since SAM may stream frames backwards — and keeps only the
 * latest mask revision per frame/object.
 */
export function buildTracking(input: BuildTrackingInput): Tracking {
  const prefix = input.objectIdPrefix ?? "";
  const byFrame = new Map<number, Map<string, FrameObject>>();
  const slot = (frameIndex: number, objectId: string): FrameObject => {
    let frame = byFrame.get(frameIndex);
    if (!frame) byFrame.set(frameIndex, (frame = new Map()));
    let entry = frame.get(objectId);
    if (!entry) {
      entry = { objectId, box: { left: 0, top: 0, right: 0, bottom: 0 }, confidence: null, mask: null };
      frame.set(objectId, entry);
    }
    return entry;
  };

  for (const box of recordsOfKind(input.records, "box")) {
    const frameIndex = frameIndexOf(box);
    if (frameIndex === undefined || frameIndex >= input.frameCount) continue;
    const entry = slot(frameIndex, prefix + box.objectId);
    entry.box = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    if (box.confidence !== undefined) entry.confidence = box.confidence;
  }
  for (const mask of recordsOfKind(input.records, "mask")) {
    const frameIndex = frameIndexOf(mask);
    if (frameIndex === undefined || frameIndex >= input.frameCount) continue;
    const entry = slot(frameIndex, prefix + mask.objectId);
    // Records are in output order, so a later revision simply overwrites.
    entry.mask = { encoding: mask.mask.encoding, payload: mask.mask.payload, width: mask.mask.width, height: mask.mask.height };
    entry.box = { ...mask.bounds };
    if (mask.confidence !== undefined) entry.confidence = mask.confidence;
  }

  const frames: TrackingFrame[] = [...byFrame.entries()]
    .sort(([a], [b]) => a - b)
    .map(([frameIndex, objects]) => ({
      frameIndex,
      timestamp: frameIndex / input.fps,
      objects: [...objects.values()].sort((a, b) => compareIds(a.objectId, b.objectId)),
    }));

  const stats = new Map<string, { frames: number[]; confidence: number[]; area: number[] }>();
  for (const frame of frames) {
    for (const object of frame.objects) {
      let stat = stats.get(object.objectId);
      if (!stat) stats.set(object.objectId, (stat = { frames: [], confidence: [], area: [] }));
      stat.frames.push(frame.frameIndex);
      if (object.confidence !== null) stat.confidence.push(object.confidence);
      stat.area.push(Math.max(0, object.box.right - object.box.left) * Math.max(0, object.box.bottom - object.box.top));
    }
  }
  const objects: TrackedObjectSummary[] = [...stats.entries()]
    .sort(([a], [b]) => compareIds(a, b))
    .map(([id, stat]) => ({
      id,
      framesPresent: stat.frames.length,
      firstFrame: stat.frames[0],
      lastFrame: stat.frames[stat.frames.length - 1],
      meanConfidence: stat.confidence.length ? mean(stat.confidence) : null,
      meanArea: mean(stat.area),
      source: input.source,
    }));

  const present = new Set(frames.map((frame) => frame.frameIndex));
  const missingFrames: number[] = [];
  if (frames.length > 0) {
    for (let index = frames[0].frameIndex; index <= frames[frames.length - 1].frameIndex; index++) {
      if (!present.has(index)) missingFrames.push(index);
    }
  }

  return {
    id: input.id,
    videoId: input.videoId,
    source: input.source,
    prompt: input.prompt,
    width: input.width,
    height: input.height,
    fps: input.fps,
    frameCount: input.frameCount,
    frames,
    objects,
    missingFrames,
    diagnostics: input.diagnostics.map(({ severity, code, message }) => ({ severity, code, message })),
    outcome: input.outcome.status === "completed" ? { status: "completed" } : { status: "incomplete", reason: input.outcome.reason },
    videoFramesProcessed: input.videoFramesProcessed,
    createdAt: new Date().toISOString(),
  };
}

/** Merges a point-prompt pass into an existing tracking, keeping both sets of objects. */
export function mergeTracking(base: Tracking, extra: Tracking): Tracking {
  const frames = new Map(base.frames.map((frame) => [frame.frameIndex, { ...frame, objects: [...frame.objects] }]));
  for (const frame of extra.frames) {
    const target = frames.get(frame.frameIndex);
    if (target) target.objects.push(...frame.objects);
    else frames.set(frame.frameIndex, { ...frame, objects: [...frame.objects] });
  }
  const sorted = [...frames.values()].sort((a, b) => a.frameIndex - b.frameIndex);
  const present = new Set(sorted.map((frame) => frame.frameIndex));
  const missingFrames: number[] = [];
  if (sorted.length) {
    for (let index = sorted[0].frameIndex; index <= sorted[sorted.length - 1].frameIndex; index++) {
      if (!present.has(index)) missingFrames.push(index);
    }
  }
  return {
    ...base,
    frames: sorted,
    objects: [...base.objects, ...extra.objects],
    missingFrames,
    diagnostics: [...base.diagnostics, ...extra.diagnostics],
    videoFramesProcessed:
      base.videoFramesProcessed === null && extra.videoFramesProcessed === null
        ? null
        : (base.videoFramesProcessed ?? 0) + (extra.videoFramesProcessed ?? 0),
  };
}

/** The object whose mask (or, without a mask, box) covers a source pixel at a frame. Smallest area wins. */
export function hitTest(frame: TrackingFrame | undefined, x: number, y: number): string | null {
  if (!frame) return null;
  let best: { id: string; area: number } | null = null;
  for (const object of frame.objects) {
    const { left, top, right, bottom } = object.box;
    if (x < left || x >= right || y < top || y >= bottom) continue;
    if (object.mask) {
      const raster = decodeMaskToRaster(object.mask);
      const column = Math.floor(((x - left) * object.mask.width) / Math.max(1, right - left));
      const row = Math.floor(((y - top) * object.mask.height) / Math.max(1, bottom - top));
      if (raster[row * object.mask.width + column] !== 1) continue;
    }
    const area = (right - left) * (bottom - top);
    if (!best || area < best.area) best = { id: object.objectId, area };
  }
  return best?.id ?? null;
}

export function frameAt(tracking: Tracking, frameIndex: number): TrackingFrame | undefined {
  // Frames are sorted: binary search.
  let low = 0;
  let high = tracking.frames.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const value = tracking.frames[middle].frameIndex;
    if (value === frameIndex) return tracking.frames[middle];
    if (value < frameIndex) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

function compareIds(a: string, b: string): number {
  const numberA = Number(a);
  const numberB = Number(b);
  if (Number.isFinite(numberA) && Number.isFinite(numberB)) return numberA - numberB;
  return a.localeCompare(b);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
