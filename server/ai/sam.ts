import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { toFile } from "openai";
import { buildObjectPrompt, decodeMaskToRaster, frameIndexOf, parseImageStream, parseVideoStream, recordsOfKind, type ResponsesEvent, type SegmentationMaskRecord } from "@meta-sam/parser";
import type { NormalizedMedia } from "../../shared/schemas";
import { buildTracking, type Box, type Tracking } from "../../shared/tracking";
import { AppError } from "../errors";
import { metaClient, metaError, readMetaConfig, requireMetaConfig, segmentationLimiter, withRetry } from "./meta";
import { recordUsage } from "./usage";

// SAM 3.1 receives the normalized video — the exact file the compositor
// renders — so mask frame N is video frame N at the same width and height.

export type SamPrompt =
  | { readonly kind: "concept"; readonly concept: string }
  | { readonly kind: "point"; readonly objectId: number; readonly frameIndex: number; readonly point: { readonly x: number; readonly y: number } }
  /** Re-prompts known objects with their own boxes, to track them on frames the concept pass missed. */
  | { readonly kind: "box"; readonly objects: readonly { readonly id: number; readonly frameIndex: number; readonly box: Box }[] };

type SegmentInput = {
  readonly id: string;
  readonly videoId: string;
  readonly videoDir: string;
  readonly normalizedPath: string;
  readonly media: NormalizedMedia;
  readonly prompt: SamPrompt;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
};

const FILE_CACHE = "meta-file.json";

type UploadTarget = Pick<SegmentInput, "videoId" | "videoDir" | "normalizedPath" | "signal">;

// One upload per video at a time, shared across route bundles: a prefetch
// started next to the planner and the segmentation that follows it wait on
// the same request instead of sending the video twice.
const inflightUploads = ((globalThis as { __focusUploads?: Map<string, Promise<string>> }).__focusUploads ??= new Map());

async function uploadVideo(input: UploadTarget, cachePath: string): Promise<string> {
  const client = metaClient();
  const started = Date.now();
  const file = await withRetry(
    async () => client.files.create({ file: await toFile(createReadStream(input.normalizedPath), "normalized.mp4", { type: "video/mp4" }), purpose: "user_data" }, { signal: input.signal }),
    { signal: input.signal },
  );
  await recordUsage({ model: "files", kind: "file_upload", cached: false, ok: true, videoId: input.videoId, durationMs: Date.now() - started });
  await writeFile(cachePath, JSON.stringify({ fileId: file.id, uploadedAt: new Date().toISOString(), bytes: file.bytes }));
  return file.id;
}

/** Uploads once per video; later passes reuse the returned file id. */
async function fileIdFor(input: UploadTarget, force = false): Promise<string> {
  const cachePath = path.join(input.videoDir, FILE_CACHE);
  if (force) return uploadVideo(input, cachePath);
  const cached = await readFile(cachePath, "utf8").then((raw) => JSON.parse(raw) as { fileId?: string }).catch(() => null);
  if (cached?.fileId) {
    await recordUsage({ model: "files", kind: "file_upload", cached: true, ok: true, videoId: input.videoId });
    return cached.fileId;
  }
  const pending = inflightUploads.get(cachePath);
  if (pending) {
    // Someone else's upload failed or was canceled: send our own.
    const shared = await pending.catch(() => null);
    if (shared) return shared;
    input.signal?.throwIfAborted();
  }
  const upload = uploadVideo(input, cachePath).finally(() => inflightUploads.delete(cachePath));
  inflightUploads.set(cachePath, upload);
  return upload;
}

/**
 * Starts the video upload while Muse Spark is still planning, so SAM can
 * begin as soon as the plan names a concept. Never throws: a failed prefetch
 * is retried by the segmentation itself. No abort signal, because the file id
 * is cached for every later edit of the same video.
 */
export function prefetchVideoFile(input: Omit<UploadTarget, "signal">): void {
  if (!readMetaConfig() || existsSync(path.join(input.videoDir, FILE_CACHE))) return;
  void fileIdFor(input).catch(() => undefined);
}

export function promptText(prompt: SamPrompt, media: NormalizedMedia): string {
  if (prompt.kind === "concept") return prompt.concept;
  if (prompt.kind === "box") {
    return buildObjectPrompt({
      size: { width: media.width, height: media.height },
      objects: prompt.objects.map((object) => ({ id: object.id, prompts: [{ frame: object.frameIndex, box: object.box }] })),
    });
  }
  return buildObjectPrompt({
    size: { width: media.width, height: media.height },
    objects: [{ id: prompt.objectId, prompts: [{ frame: prompt.frameIndex, points: [prompt.point] }] }],
  });
}

export async function segmentVideo(input: SegmentInput): Promise<Tracking> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const text = promptText(input.prompt, input.media);
  const started = Date.now();

  const attempt = async (fileId: string) => {
    let framesProcessed: number | null = null;
    const stream = await client.responses.create(
      {
        model: config.segmentationModel,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text },
              // The SDK's types predate video input; the wire format is documented.
              { type: "input_video", file_id: fileId } as unknown as { type: "input_text"; text: string },
            ],
          },
        ],
        stream: true,
        metadata: { mask_encoding: "one_bit", include_confidence: "true" },
      },
      { signal: input.signal },
    );
    async function* tap(): AsyncIterable<ResponsesEvent> {
      for await (const event of stream) {
        if (event.type === "response.completed") {
          const usage = event.response.usage as { video_frames_processed?: number } | undefined;
          framesProcessed = usage?.video_frames_processed ?? null;
        }
        yield event as unknown as ResponsesEvent;
      }
    }
    const parsed = parseVideoStream(tap());
    const seen = new Set<number>();
    for await (const snapshot of parsed) {
      for (const record of recordsOfKind(snapshot.records, "box")) {
        const frame = frameIndexOf(record);
        if (frame !== undefined) seen.add(frame);
      }
      input.onProgress?.(Math.min(1, seen.size / input.media.frameCount));
    }
    const result = await parsed.finalResult;
    return { result, framesProcessed };
  };

  try {
    const { result, framesProcessed } = await segmentationLimiter.run(async () => {
      const fileId = await fileIdFor(input);
      try {
        return await withRetry(() => attempt(fileId), { signal: input.signal, attempts: 2 });
      } catch (error) {
        // A file id can expire on Meta's side; re-upload once and try again.
        if (isMissingFile(error)) return attempt(await fileIdFor(input, true));
        throw error;
      }
    });
    await recordUsage({
      model: config.segmentationModel,
      kind: "segment",
      cached: false,
      ok: true,
      videoId: input.videoId,
      videoFramesProcessed: framesProcessed ?? undefined,
      durationMs: Date.now() - started,
    });
    return buildTracking({
      id: input.id,
      videoId: input.videoId,
      source: input.prompt.kind === "point" ? "point" : "concept",
      prompt:
        input.prompt.kind === "concept"
          ? input.prompt.concept
          : input.prompt.kind === "box"
            ? `box ${input.prompt.objects.map((object) => `#${object.id}@${object.frameIndex}`).join(" ")}`
            : `point ${input.prompt.point.x},${input.prompt.point.y} @ frame ${input.prompt.frameIndex}`,
      width: input.media.width,
      height: input.media.height,
      fps: input.media.fps,
      frameCount: input.media.frameCount,
      records: result.records,
      diagnostics: result.diagnostics,
      outcome: result.outcome,
      videoFramesProcessed: framesProcessed,
    });
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.segmentationModel, kind: "segment", cached: false, ok: false, videoId: input.videoId, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "subject tracking");
  }
}

function isMissingFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("file") && (message.includes("not found") || message.includes("no such"));
}

/** One object SAM 3.1 found on a still image, as a full-image 0/255 mask. */
export type ImageMask = {
  readonly objectId: string;
  readonly alpha: Uint8Array;
  readonly box: Box;
  readonly area: number;
  readonly confidence: number | null;
};

/**
 * Concept segmentation of a still image (Focus Flipbook sprites). Same model,
 * client, limiter and usage log as the video path; the image travels inline
 * as a PNG data URL, so the masks are in that PNG's own pixel grid.
 */
export async function segmentImage(input: {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  readonly concept: string;
  readonly flipbookId?: string;
  readonly signal?: AbortSignal;
}): Promise<ImageMask[]> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const started = Date.now();
  try {
    const result = await segmentationLimiter.run(() =>
      withRetry(
        async () => {
          const stream = await client.responses.create(
            {
              model: config.segmentationModel,
              input: [
                {
                  type: "message",
                  role: "user",
                  content: [
                    { type: "input_text", text: input.concept },
                    // Documented SAM image part: image_url only, no detail level.
                    { type: "input_image", image_url: `data:image/png;base64,${input.png.toString("base64")}` } as unknown as { type: "input_text"; text: string },
                  ],
                },
              ],
              stream: true,
              metadata: { mask_encoding: "one_bit", include_confidence: "true" },
            },
            { signal: input.signal },
          );
          return parseImageStream(stream as AsyncIterable<{ readonly type: string }>).finalResult;
        },
        { signal: input.signal, attempts: 2 },
      ),
    );
    await recordUsage({ model: config.segmentationModel, kind: "segment_image", cached: false, ok: true, flipbookId: input.flipbookId, durationMs: Date.now() - started });
    // The newest mask per object wins; an image has a single frame.
    const latest = new Map<string, SegmentationMaskRecord>();
    for (const record of recordsOfKind(result.records, "mask")) latest.set(record.objectId, record);
    const masks: ImageMask[] = [];
    for (const record of latest.values()) {
      const raster = decodeMaskToRaster(record.mask);
      const { left, top, right, bottom } = record.bounds;
      const boxWidth = right - left;
      const boxHeight = bottom - top;
      if (boxWidth <= 0 || boxHeight <= 0) continue;
      const alpha = new Uint8Array(input.width * input.height);
      let area = 0;
      for (let y = Math.max(0, top); y < Math.min(input.height, bottom); y++) {
        const row = Math.min(record.mask.height - 1, Math.floor(((y - top) * record.mask.height) / boxHeight)) * record.mask.width;
        for (let x = Math.max(0, left); x < Math.min(input.width, right); x++) {
          const column = Math.min(record.mask.width - 1, Math.floor(((x - left) * record.mask.width) / boxWidth));
          if (raster[row + column] === 1) {
            alpha[y * input.width + x] = 255;
            area++;
          }
        }
      }
      if (area > 0) masks.push({ objectId: record.objectId, alpha, box: { left, top, right, bottom }, area, confidence: record.confidence ?? null });
    }
    return masks.sort((a, b) => b.area - a.area);
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.segmentationModel, kind: "segment_image", cached: false, ok: false, flipbookId: input.flipbookId, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "image segmentation");
  }
}

/**
 * SAM 3.1 on a still image with object prompts (a box and positive/negative
 * points per object, built by buildObjectPrompt) instead of a noun phrase.
 * Returns each prompted object's mask under the id it was given. The mapping
 * engine uses it to isolate body regions on a character sheet; it never
 * places a joint from a mask.
 */
export async function segmentImageObjects(input: {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  readonly objects: Parameters<typeof buildObjectPrompt>[0]["objects"];
  readonly signal?: AbortSignal;
}): Promise<ImageMask[]> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const started = Date.now();
  const text = buildObjectPrompt({ size: { width: input.width, height: input.height }, objects: input.objects });
  try {
    const result = await segmentationLimiter.run(() =>
      withRetry(
        async () => {
          const stream = await client.responses.create(
            {
              model: config.segmentationModel,
              input: [{
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text },
                  { type: "input_image", image_url: `data:image/png;base64,${input.png.toString("base64")}` } as unknown as { type: "input_text"; text: string },
                ],
              }],
              stream: true,
              metadata: { mask_encoding: "one_bit", include_confidence: "true" },
            },
            { signal: input.signal },
          );
          return parseImageStream(stream as AsyncIterable<{ readonly type: string }>).finalResult;
        },
        { signal: input.signal, attempts: 2 },
      ),
    );
    await recordUsage({ model: config.segmentationModel, kind: "segment_image", cached: false, ok: true, durationMs: Date.now() - started });
    const latest = new Map<string, SegmentationMaskRecord>();
    for (const record of recordsOfKind(result.records, "mask")) latest.set(record.objectId, record);
    return [...latest.values()].flatMap((record) => {
      const raster = decodeMaskToRaster(record.mask);
      const { left, top, right, bottom } = record.bounds;
      if (right <= left || bottom <= top) return [];
      const alpha = new Uint8Array(input.width * input.height);
      let area = 0;
      for (let y = Math.max(0, top); y < Math.min(input.height, bottom); y++) {
        const row = Math.min(record.mask.height - 1, Math.floor(((y - top) * record.mask.height) / (bottom - top))) * record.mask.width;
        for (let x = Math.max(0, left); x < Math.min(input.width, right); x++) {
          if (raster[row + Math.min(record.mask.width - 1, Math.floor(((x - left) * record.mask.width) / (right - left)))] === 1) { alpha[y * input.width + x] = 255; area++; }
        }
      }
      return area ? [{ objectId: record.objectId, alpha, box: { left, top, right, bottom }, area, confidence: record.confidence ?? null }] : [];
    });
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.segmentationModel, kind: "segment_image", cached: false, ok: false, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "region segmentation");
  }
}
