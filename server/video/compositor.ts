import path from "node:path";
import sharp from "sharp";
import { BREAK_FRAME_CANVAS, type RenderParams, type RenderParamsOf } from "../../shared/render";
import { BREAK_FRAME_WARNING, missingSubjectMaskWarning } from "../../shared/render-warnings";
import type { NormalizedMedia } from "../../shared/schemas";
import type { FreezePlan } from "../../shared/temporal";
import { selectionTrack, type TrackPoint } from "../../shared/temporal-track";
import { frameAt, type Box, type Tracking } from "../../shared/tracking";
import { AppError } from "../errors";
import { probe } from "../ffmpeg";
import { parseRate } from "../media-validation";
import { backgroundBlur, blendOver, blurSigma, cropGhost, drawGhost, padBox, selectiveColor, spotlight, trailOpacity, type Ghost } from "./effects";
import { createFinisher } from "./finish";
import { renderTimeFreeze, type FreezeSummary } from "./temporal";
import { readFrames, runFfmpeg, writeFrames } from "./frames";
import { computeBreakFrameLayout, insideRect, subjectMotion, visibleSourceRect, type BreakFrameLayout, type SubjectMotion } from "./layout";
import { feather, featherRadius, rasterizeSelection, type Alpha } from "./masks";

// One deterministic pipeline for every effect:
//   decode frame N → rasterize the selected masks of frame N → effect → encode.
// Effects only differ in their FrameProcessor; decoding, masking, encoding,
// the comparison video and verification are shared.

/** One finished effect frame and the subject's mask in the same (output) coordinates. */
export type ProcessedFrame = { readonly rgba: Buffer; readonly alpha: Uint8Array | null };

export type FrameProcessor = {
  readonly width: number;
  readonly height: number;
  process(index: number, frame: Buffer, alpha: Alpha): Promise<ProcessedFrame>;
  /** Extra per-render facts for the result. */
  summary(): { breakoutFrameRatio: number | null; warnings: string[] };
};

export const BACKGROUNDS = { dark: [0x14, 0x16, 0x1e], light: [0xf6, 0xf7, 0xfa] } as const;

/** Effects that keep the source size: the source mask is already in output coordinates. */
function sameSize(media: NormalizedMedia, effect: (index: number, frame: Buffer, alpha: Alpha) => Buffer | Promise<Buffer>): FrameProcessor {
  return {
    width: media.width,
    height: media.height,
    process: async (index, frame, alpha) => ({ rgba: await effect(index, frame, alpha), alpha: alpha.box ? alpha.data : null }),
    summary: () => ({ breakoutFrameRatio: null, warnings: [] }),
  };
}

export function selectiveColorProcessor(media: NormalizedMedia, params: RenderParamsOf<"selective_color">): FrameProcessor {
  return sameSize(media, async (_index, frame, alpha) => selectiveColor(frame, alpha.data, params.intensity));
}

export function backgroundBlurProcessor(media: NormalizedMedia, params: RenderParamsOf<"background_blur">): FrameProcessor {
  const sigma = blurSigma(params.level, media.width, media.height);
  return sameSize(media, (_index, frame, alpha) => backgroundBlur(frame, alpha.data, media.width, media.height, sigma));
}

export function spotlightProcessor(media: NormalizedMedia, params: RenderParamsOf<"spotlight">): FrameProcessor {
  // The pool of light follows the subject, smoothed so box jitter never flickers.
  let pool: { x: number; y: number; radius: number } | null = null;
  return sameSize(media, (_index, frame, alpha) => {
    if (alpha.box) {
      const target = {
        x: (alpha.box.left + alpha.box.right) / 2,
        y: (alpha.box.top + alpha.box.bottom) / 2,
        radius: Math.max(alpha.box.right - alpha.box.left, alpha.box.bottom - alpha.box.top) * 0.6,
      };
      pool = pool
        ? { x: pool.x + (target.x - pool.x) * 0.35, y: pool.y + (target.y - pool.y) * 0.35, radius: pool.radius + (target.radius - pool.radius) * 0.35 }
        : target;
    }
    return spotlight(frame, alpha.data, media.width, params.darkness, pool);
  });
}

export function motionEchoProcessor(media: NormalizedMedia, params: RenderParamsOf<"motion_echo">): FrameProcessor {
  const spacing = Math.max(1, Math.round((params.trailSpacingMs * media.fps) / 1000));
  const span = spacing * params.trailCount;
  const margin = featherRadius(params.feather, media.width, media.height) * 2 + 1;
  // Only cropped subject ghosts are kept, never whole frames: bounded memory.
  const ghosts = new Map<number, Ghost>();
  return sameSize(media, async (index, frame, alpha) => {
    const out = Buffer.from(frame);
    for (let k = params.trailCount; k >= 1; k--) {
      const ghost = ghosts.get(index - k * spacing);
      if (ghost) drawGhost(out, ghost, trailOpacity(k, params.trailCount, params.intensity), media.width);
    }
    if (alpha.box) {
      const box = padBox(alpha.box, margin, media.width, media.height);
      // The present subject stays fully visible above its own trail.
      blendOver(out, frame, alpha.data, 1, box, media.width);
      ghosts.set(index, cropGhost(frame, alpha.data, box, media.width));
    }
    ghosts.delete(index - span);
    return out;
  });
}

export function breakFrameProcessor(media: NormalizedMedia, params: RenderParamsOf<"break_frame">, layout: BreakFrameLayout): FrameProcessor {
  const { width, height } = layout.canvas;
  const { scale, offsetX, offsetY } = layout.transform;
  const visible = visibleSourceRect(layout, media);
  const scaledWidth = Math.round(media.width * scale);
  const scaledHeight = Math.round(media.height * scale);
  const extract = { left: visible.x - offsetX, top: visible.y - offsetY, width: visible.width, height: visible.height };
  const [br, bg, bb] = BACKGROUNDS[params.background];
  const edge = params.background === "dark" ? [255, 255, 255, 0.12] : [35, 39, 53, 0.1];
  const frameRect = layout.frame;
  let breakoutFrames = 0;
  let framesWithSubject = 0;

  const empty = Buffer.allocUnsafe(width * height * 4);
  for (let p = 0; p < empty.length; p += 4) {
    empty[p] = br;
    empty[p + 1] = bg;
    empty[p + 2] = bb;
    empty[p + 3] = 255;
  }

  return {
    width,
    height,
    async process(_index, frame, alpha) {
      // Layer B and C share one resample of the same source frame.
      const [video, mask] = await Promise.all([
        sharp(frame, { raw: { width: media.width, height: media.height, channels: 4 } })
          .resize(scaledWidth, scaledHeight, { fit: "fill", kernel: "lanczos3" })
          .extract(extract)
          .raw()
          .toBuffer(),
        sharp(Buffer.from(alpha.data.buffer, alpha.data.byteOffset, alpha.data.length), { raw: { width: media.width, height: media.height, channels: 1 } })
          .resize(scaledWidth, scaledHeight, { fit: "fill", kernel: "linear" })
          .extract(extract)
          // Keep one band: Sharp would otherwise return the mask as RGB.
          .toColourspace("b-w")
          .raw()
          .toBuffer(),
      ]);
      // Layer A: the composition background.
      const out = Buffer.from(empty);
      let outside = 0;
      for (let vy = 0; vy < visible.height; vy++) {
        const y = visible.y + vy;
        for (let vx = 0; vx < visible.width; vx++) {
          const x = visible.x + vx;
          const v = (vy * visible.width + vx) * 4;
          const p = (y * width + x) * 4;
          const inFrame = insideRect(frameRect, x, y);
          // Layer B: the video, clipped to the inner frame.
          if (inFrame) {
            out[p] = video[v];
            out[p + 1] = video[v + 1];
            out[p + 2] = video[v + 2];
          }
          // Layer C: the subject, not clipped. Inside the frame it is the same
          // pixel, so only outside the frame does it change anything.
          const a = mask[vy * visible.width + vx];
          if (!inFrame && a > 0) {
            const t = a / 255;
            out[p] = Math.round(out[p] + (video[v] - out[p]) * t);
            out[p + 1] = Math.round(out[p + 1] + (video[v + 1] - out[p + 1]) * t);
            out[p + 2] = Math.round(out[p + 2] + (video[v + 2] - out[p + 2]) * t);
            if (a > 127) outside++;
          }
        }
      }
      drawFrameEdge(out, width, frameRect, edge, mask, visible);
      if (alpha.box) framesWithSubject++;
      if (outside > 200) breakoutFrames++;
      let subject: Uint8Array | null = null;
      if (alpha.box) {
        subject = new Uint8Array(width * height);
        for (let vy = 0; vy < visible.height; vy++) subject.set(mask.subarray(vy * visible.width, (vy + 1) * visible.width), (visible.y + vy) * width + visible.x);
      }
      return { rgba: out, alpha: subject };
    },
    summary() {
      const ratio = framesWithSubject ? breakoutFrames / framesWithSubject : 0;
      const warnings = ratio < 0.25 ? [BREAK_FRAME_WARNING] : [];
      return { breakoutFrameRatio: ratio, warnings };
    },
  };
}

/** A hairline on the inner frame edge, hidden wherever the subject passes over it. */
function drawFrameEdge(out: Buffer, width: number, rect: BreakFrameLayout["frame"], color: readonly number[], mask: Buffer, visible: BreakFrameLayout["frame"]): void {
  const [r, g, b, opacity] = color;
  const paint = (x: number, y: number) => {
    let a = opacity;
    if (insideRect(visible, x, y)) a *= 1 - mask[(y - visible.y) * visible.width + (x - visible.x)] / 255;
    const p = (y * width + x) * 4;
    out[p] = Math.round(out[p] + (r - out[p]) * a);
    out[p + 1] = Math.round(out[p + 1] + (g - out[p + 1]) * a);
    out[p + 2] = Math.round(out[p + 2] + (b - out[p + 2]) * a);
  };
  for (let x = rect.x; x < rect.x + rect.width; x++) {
    paint(x, rect.y);
    paint(x, rect.y + rect.height - 1);
  }
  for (let y = rect.y + 1; y < rect.y + rect.height - 1; y++) {
    paint(rect.x, y);
    paint(rect.x + rect.width - 1, y);
  }
}

/** Where per-frame subject masks come from: SAM tracking in the app, synthetic masks in tests. */
export type MaskSource = {
  /** Binary (0/255) full-frame mask of the selected subject at a frame. */
  alphaAt(index: number): Alpha;
  /** Where the subject sits and travels across the clip, for layout. */
  subjectMotion(): SubjectMotion | null;
  /** Per-frame summary of the selected objects (boxes, mask presence, confidence), when tracking provides one. */
  track?(): TrackPoint[];
};

export function trackingMaskSource(tracking: Tracking, selection: readonly string[], media: NormalizedMedia): MaskSource {
  if (tracking.width !== media.width || tracking.height !== media.height || tracking.frameCount !== media.frameCount) {
    throw new AppError("tracking_mismatch", 409, "The subject masks don’t match this video. Generate subject tracking again.");
  }
  const chosen = new Set(selection);
  return {
    alphaAt: (index) => rasterizeSelection(frameAt(tracking, index), chosen, media.width, media.height),
    subjectMotion: () => subjectMotion(subjectBoxes(tracking, chosen)),
    track: () => selectionTrack(tracking, selection),
  };
}

/** Per-frame union boxes of the selected objects, in source pixels. */
export function subjectBoxes(tracking: Tracking, selection: ReadonlySet<string>): Box[] {
  const boxes: Box[] = [];
  for (const frame of tracking.frames) {
    let union: Box | null = null;
    for (const object of frame.objects) {
      if (!selection.has(object.objectId)) continue;
      union = union
        ? { left: Math.min(union.left, object.box.left), top: Math.min(union.top, object.box.top), right: Math.max(union.right, object.box.right), bottom: Math.max(union.bottom, object.box.bottom) }
        : object.box;
    }
    if (union) boxes.push(union);
  }
  return boxes;
}

export function createProcessor(media: NormalizedMedia, params: RenderParams, masks: MaskSource): FrameProcessor {
  switch (params.effect) {
    case "selective_color":
      return selectiveColorProcessor(media, params);
    case "background_blur":
      return backgroundBlurProcessor(media, params);
    case "spotlight":
      return spotlightProcessor(media, params);
    case "motion_echo":
      return motionEchoProcessor(media, params);
    case "break_frame":
      return breakFrameProcessor(
        media,
        params,
        computeBreakFrameLayout({ source: media, canvas: BREAK_FRAME_CANVAS, frameSize: params.frameSize, subject: masks.subjectMotion() }),
      );
    case "time_freeze_echo":
      // Changes the clip's length: rendered by renderTimeFreeze, never per frame.
      throw new AppError("effect_unavailable", 500, "Time Freeze isn’t a per-frame effect.");
  }
}

export type RenderOutput = {
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly framesWithoutMask: number;
  readonly breakoutFrameRatio: number | null;
  readonly warnings: string[];
  /** Time Freeze only: the output timeline and the echoes drawn. */
  readonly freeze?: FreezeSummary;
};

export async function renderVideo(input: {
  readonly normalizedPath: string;
  readonly media: NormalizedMedia;
  readonly masks: MaskSource;
  readonly params: RenderParams;
  readonly outputDir: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}): Promise<RenderOutput> {
  const { media, masks, params, signal } = input;
  // Changes the clip's length, so it has its own frame loop.
  if (params.effect === "time_freeze_echo") return renderTimeFreeze({ ...input, params });
  const processor = createProcessor(media, params, masks);
  const finisher = createFinisher(processor.width, processor.height, params.finish);
  const radius = featherRadius(params.feather, media.width, media.height);
  const output = path.join(input.outputDir, "output.mp4");
  const writer = writeFrames({
    output,
    width: processor.width,
    height: processor.height,
    fps: media.fps,
    frameCount: media.frameCount,
    audioFrom: media.hasAudio ? input.normalizedPath : undefined,
    signal,
  });

  let index = 0;
  let framesWithoutMask = 0;
  try {
    for await (const frame of readFrames(input.normalizedPath, media.width, media.height, signal)) {
      if (signal?.aborted) throw new AppError("canceled", 499, "Processing canceled.");
      if (index >= media.frameCount) break;
      const raw = masks.alphaAt(index);
      if (!raw.box) framesWithoutMask++;
      const alpha: Alpha = raw.box ? { data: feather(raw.data, media.width, media.height, radius), box: raw.box } : raw;
      const processed = await processor.process(index, frame, alpha);
      await writer.write(finisher ? await finisher.apply(index, processed.rgba, processed.alpha) : processed.rgba);
      index++;
      input.onProgress?.(index / media.frameCount);
    }
    if (index !== media.frameCount) {
      throw new AppError("frame_count_mismatch", 500, `Decoded ${index} of ${media.frameCount} frames.`);
    }
    await writer.finish();
  } catch (error) {
    writer.abort();
    if (signal?.aborted) throw new AppError("canceled", 499, "Processing canceled.");
    throw error;
  }

  const summary = processor.summary();
  const warnings = [...summary.warnings];
  if (framesWithoutMask > 0) {
    warnings.push(missingSubjectMaskWarning(framesWithoutMask, media.frameCount));
  }
  return { width: processor.width, height: processor.height, frameCount: index, framesWithoutMask, breakoutFrameRatio: summary.breakoutFrameRatio, warnings };
}

/**
 * Original above, edited below, in one stream: the comparison slider draws
 * both halves from a single decoder, so they can never drift apart.
 */
export async function renderComparison(input: {
  readonly normalizedPath: string;
  readonly outputPath: string;
  readonly comparePath: string;
  readonly width: number;
  readonly height: number;
  readonly background: "dark" | "light";
  /** Time Freeze: the original half holds on the same frame for as long, so both halves share one clock. */
  readonly freeze?: FreezePlan & { readonly resume: boolean };
  readonly signal?: AbortSignal;
}): Promise<void> {
  const color = input.background === "dark" ? "0x14161e" : "0xf6f7fa";
  const { freeze } = input;
  const fps = freeze ? parseRate((await probe(input.outputPath)).streams.find((stream) => stream.codec_type === "video")?.avg_frame_rate) : 0;
  if (freeze && fps <= 0) throw new AppError("export_invalid", 500, "We couldn’t verify the comparison video’s frame rate.");
  // Concat uses a microsecond clock; the edited MP4 uses its track timebase.
  // Framesync can round the final EOF differently depending on input order.
  // Give both temporal halves exact integer frame timestamps before stacking.
  const clock = freeze ? `,settb=expr=1/${fps},setpts=N` : "";
  // Frame counts only: trim keeps 0…T, tpad repeats frame T, the rest follows.
  const original = freeze
    ? freeze.resume && freeze.outputFrameCount > freeze.freezeStart + freeze.freezeFrames
      ? `[0:v]split=2[o1][o2];[o1]trim=end_frame=${freeze.freezeStart},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${freeze.freezeFrames}[o3];[o2]trim=start_frame=${freeze.freezeStart},setpts=PTS-STARTPTS[o4];[o3][o4]concat=n=2:v=1:a=0[original];[original]`
      : `[0:v]trim=end_frame=${freeze.freezeStart},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${freeze.freezeFrames}[original];[original]`
    : "[0:v]";
  await runFfmpeg(
    [
      "-i", input.normalizedPath,
      "-i", input.outputPath,
      "-filter_complex",
      `${original}scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2:color=${color},setsar=1${clock}[before];[1:v]setsar=1${clock}[after];[before][after]vstack=inputs=2${freeze ? `,trim=end_frame=${freeze.outputFrameCount}` : ""}[v]`,
      "-map", "[v]",
      // Temporal comparisons play the edited audio verbatim: the same mute
      // and resume policy as the exported MP4. Existing v1 comparisons stay silent.
      ...(freeze ? ["-map", "1:a:0?", "-c:a", "copy"] : ["-an"]),
      // CFR at the encoder preserves every integer-timestamped frame. An
      // fps filter after vstack drops its last frame with FFmpeg 5's EOF PTS.
      ...(freeze ? ["-r", String(fps), "-fps_mode", "cfr"] : []),
      // Trim the video in the graph. -frames:v would stop demuxing early
      // and drop the last AAC packets from the copied edited soundtrack.
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      input.comparePath,
    ],
    input.signal,
  );
}

/** Checks the encoded file against what was requested. Throws on any mismatch. */
export async function verifyOutput(file: string, expected: { width: number; height: number; fps: number; frameCount: number; hasAudio: boolean; timingToleranceSeconds?: number }) {
  const facts = await probe(file).catch(() => null);
  if (!facts) throw new AppError("export_invalid", 500, "The exported video couldn’t be read.");
  const video = facts.streams.find((stream) => stream.codec_type === "video");
  const problems: string[] = [];
  if (!video) problems.push("missing video track");
  else {
    if (video.codec_name !== "h264") problems.push(`codec ${video.codec_name}`);
    if (video.width !== expected.width || video.height !== expected.height) problems.push(`size ${video.width}×${video.height}`);
    if (Math.abs(parseRate(video.avg_frame_rate) - expected.fps) > 0.01) problems.push(`frame rate ${video.avg_frame_rate}`);
    if (Number(video.nb_frames) !== expected.frameCount) problems.push(`${video.nb_frames} frames`);
    if ((video as { pix_fmt?: string }).pix_fmt !== "yuv420p") problems.push(`pixel format ${(video as { pix_fmt?: string }).pix_fmt}`);
  }
  const duration = Number(video?.duration ?? facts.format.duration);
  if (!(Math.abs(duration - expected.frameCount / expected.fps) <= 1.5 / expected.fps)) problems.push(`duration ${duration}`);
  const hasAudio = facts.streams.some((stream) => stream.codec_type === "audio");
  if (hasAudio !== expected.hasAudio) problems.push(hasAudio ? "unexpected audio" : "missing audio");
  if (expected.timingToleranceSeconds !== undefined) {
    const tolerance = expected.timingToleranceSeconds;
    if (!video || !(Math.abs(Number(video.start_time)) <= tolerance)) problems.push("misaligned video start");
    if (video && Math.abs(parseRate(video.r_frame_rate) - expected.fps) > 0.01) problems.push("irregular video frame rate");
    const audio = facts.streams.find((stream) => stream.codec_type === "audio");
    if (audio) {
      if (audio.codec_name !== "aac") problems.push(`audio codec ${audio.codec_name}`);
      if (!(Math.abs(Number(audio.start_time)) <= tolerance)) problems.push("misaligned audio start");
      if (!(Math.abs(Number(audio.duration) - expected.frameCount / expected.fps) <= tolerance)) problems.push(`audio duration ${audio.duration}`);
    }
  }
  if (problems.length) throw new AppError("export_invalid", 500, "The export failed verification. Try exporting again.", problems.join(", "));
  return { durationSeconds: duration };
}
