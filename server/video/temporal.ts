import path from "node:path";
import type { RenderParamsOf } from "../../shared/render";
import type { NormalizedMedia } from "../../shared/schemas";
import { echoOpacity, echoReveal, planFreeze, type FreezePlan } from "../../shared/temporal";
import { checkTemporalTracking, type TrackPoint } from "../../shared/temporal-track";
import { AppError } from "../errors";
import type { MaskSource, RenderOutput } from "./compositor";
import { blendOver, cropGhost, drawGhost, padBox, type Ghost } from "./effects";
import { createFinisher } from "./finish";
import { readFrames, writeFrames } from "./frames";
import { feather, featherRadius, type Alpha } from "./masks";

// Time Freeze + Echo. Temporal compositing, not synthesis: every pixel of an
// echo is the subject's own pixels at an earlier frame, cut out with that
// frame's SAM mask and drawn back at its original position over the frozen
// trigger frame. One decode pass; only cropped cutouts are kept.

/** An echo covered this much by the frozen subject or a nearer echo is a smear, not a moment: left out. */
export const MAX_ECHO_OVERLAP = 0.6;

export type FreezeSummary = {
  readonly plan: FreezePlan;
  /** Echo source frames actually drawn, oldest first. */
  readonly echoFrames: readonly number[];
  readonly warnings: readonly string[];
};

/** Share of `candidate`'s pixels that are also set in `other`. */
export function overlapShare(candidate: Alpha, other: Alpha, width: number): number {
  if (!candidate.box || !other.box) return 0;
  const left = Math.max(candidate.box.left, other.box.left);
  const top = Math.max(candidate.box.top, other.box.top);
  const right = Math.min(candidate.box.right, other.box.right);
  const bottom = Math.min(candidate.box.bottom, other.box.bottom);
  let shared = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) if (candidate.data[y * width + x] && other.data[y * width + x]) shared++;
  }
  let total = 0;
  for (let y = candidate.box.top; y < candidate.box.bottom; y++) {
    for (let x = candidate.box.left; x < candidate.box.right; x++) if (candidate.data[y * width + x]) total++;
  }
  return total ? shared / total : 1;
}

/** Track points for the frames that matter, from the mask source itself when tracking gives no summary. */
function pointsFor(masks: MaskSource, frames: readonly number[], fps: number): TrackPoint[] {
  const tracked = masks.track?.();
  if (tracked) return tracked;
  return frames.flatMap((frameIndex) => {
    const { box } = masks.alphaAt(frameIndex);
    if (!box) return [];
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    return [{ frameIndex, timestamp: frameIndex / fps, box, center: { x: box.left + width / 2, y: box.top + height / 2 }, width, height, masked: true, confidence: null }];
  });
}

/**
 * Decides which echo moments are drawn: tracked with a real mask (checked
 * first), then, from the newest back, only those that stay visibly apart from
 * the frozen subject and from each other.
 */
export function chooseEchoes(masks: MaskSource, media: NormalizedMedia, plan: FreezePlan): FreezeSummary {
  const check = checkTemporalTracking(pointsFor(masks, [plan.triggerFrame, ...plan.requestedSamples], media.fps), {
    triggerFrame: plan.triggerFrame,
    sampleFrames: plan.requestedSamples,
  });
  if (check.error) throw new AppError("tracking_unreliable", 422, check.error);
  const accepted: { frame: number; alpha: Alpha }[] = [];
  const base = masks.alphaAt(plan.triggerFrame);
  let overlapping = 0;
  for (const frame of [...check.usableSamples].reverse()) {
    const alpha = masks.alphaAt(frame);
    if (!alpha.box) continue;
    const covered = [base, ...accepted.map((entry) => entry.alpha)].some((other) => overlapShare(alpha, other, media.width) > MAX_ECHO_OVERLAP);
    if (covered) overlapping++;
    else accepted.push({ frame, alpha });
  }
  if (accepted.length < 2) {
    throw new AppError(
      "echoes_overlap",
      422,
      "The subject barely moves before the freeze point, so its echoes would sit on top of each other. Pick a moment with more movement or widen the echo spacing.",
    );
  }
  const warnings = [...check.warnings];
  if (overlapping) warnings.push(`${overlapping} echo ${overlapping === 1 ? "moment overlapped" : "moments overlapped"} the subject too much and ${overlapping === 1 ? "was" : "were"} left out.`);
  return { plan, echoFrames: accepted.map((entry) => entry.frame).reverse(), warnings };
}

export async function renderTimeFreeze(input: {
  readonly normalizedPath: string;
  readonly media: NormalizedMedia;
  readonly masks: MaskSource;
  readonly params: RenderParamsOf<"time_freeze_echo">;
  readonly outputDir: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}): Promise<RenderOutput & { readonly freeze: FreezeSummary }> {
  const { media, masks, params, signal } = input;
  const { width, height, fps } = media;
  const plan = planFreeze(params, media);
  const summary = chooseEchoes(masks, media, plan);
  const echoFrames = new Set(summary.echoFrames);
  const count = summary.echoFrames.length;
  const radius = featherRadius(params.feather, width, height);
  const margin = radius * 2 + 1;
  const soft = (alpha: Alpha): Alpha => (alpha.box && radius > 0 ? { data: feather(alpha.data, width, height, radius), box: alpha.box } : alpha);
  const finisher = createFinisher(width, height, params.finish);
  const writer = writeFrames({
    output: path.join(input.outputDir, "output.mp4"),
    width,
    height,
    fps,
    frameCount: plan.outputFrameCount,
    audioFrom: media.hasAudio ? input.normalizedPath : undefined,
    audioFreeze: { atSeconds: plan.freezeStart / fps, silenceSeconds: plan.freezeFrames / fps, resume: params.resume },
    signal,
  });

  const ghosts: Ghost[] = [];
  let written = 0;
  const emit = async (rgba: Buffer, alpha: Uint8Array | null) => {
    await writer.write(finisher ? await finisher.apply(written, rgba, alpha) : rgba);
    written++;
    input.onProgress?.(written / plan.outputFrameCount);
  };

  try {
    let index = 0;
    for await (const frame of readFrames(input.normalizedPath, width, height, signal)) {
      if (signal?.aborted) throw new AppError("canceled", 499, "Processing canceled.");
      if (index >= media.frameCount) break;
      // Cutouts are taken as their frames pass: all echoes precede the trigger.
      if (echoFrames.has(index)) {
        const alpha = soft(masks.alphaAt(index));
        ghosts.push(cropGhost(frame, alpha.data, padBox(alpha.box!, margin, width, height), width));
      }
      const needsAlpha = finisher !== null || index === plan.triggerFrame;
      const alpha = needsAlpha ? soft(masks.alphaAt(index)) : null;
      await emit(frame, alpha?.box ? alpha.data : null);

      if (index === plan.triggerFrame) {
        const base = alpha;
        if (!base?.box) throw new AppError("tracking_unreliable", 422, "The subject isn’t tracked at the freeze point. Move the freeze point to a moment where it is visible, or complete the tracking.");
        const subjectBox = padBox(base.box, margin, width, height);
        for (let f = 0; f < plan.freezeFrames; f++) {
          const out = Buffer.from(frame);
          const light = finisher ? new Uint8Array(base.data) : null;
          ghosts.forEach((ghost, rank) => {
            const reveal = echoReveal(f, rank, count, plan.freezeFrames, fps);
            if (reveal <= 0) return;
            drawGhost(out, ghost, echoOpacity(rank, count, params.echo.opacity) * reveal, width);
            if (light && reveal >= 1) mergeGhostAlpha(light, ghost, width);
          });
          // The frozen subject is the present moment: always solid, above its echoes.
          blendOver(out, frame, base.data, 1, subjectBox, width);
          await emit(out, light);
        }
        if (!params.resume) break;
      }
      index++;
    }
    if (written !== plan.outputFrameCount) {
      throw new AppError("frame_count_mismatch", 500, `Wrote ${written} of ${plan.outputFrameCount} frames.`);
    }
    await writer.finish();
  } catch (error) {
    writer.abort();
    if (signal?.aborted) throw new AppError("canceled", 499, "Processing canceled.");
    throw error;
  }

  return {
    width,
    height,
    frameCount: plan.outputFrameCount,
    framesWithoutMask: 0,
    breakoutFrameRatio: null,
    warnings: [...summary.warnings],
    freeze: summary,
  };
}

/** Adds a fully revealed echo's mask to the subject light's mask (max), so glow and outline wrap every moment. */
function mergeGhostAlpha(target: Uint8Array, ghost: Ghost, width: number): void {
  const w = ghost.box.right - ghost.box.left;
  for (let y = 0; y < ghost.box.bottom - ghost.box.top; y++) {
    for (let x = 0; x < w; x++) {
      const p = (ghost.box.top + y) * width + ghost.box.left + x;
      const a = ghost.alpha[y * w + x];
      if (a > target[p]) target[p] = a;
    }
  }
}
