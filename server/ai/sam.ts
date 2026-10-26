import path from "node:path";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { toFile } from "openai";
import { buildObjectPrompt, frameIndexOf, parseVideoStream, recordsOfKind, type ResponsesEvent } from "@meta-sam/parser";
import type { NormalizedMedia } from "../../shared/schemas";
import { buildTracking, type Box, type Tracking } from "../../shared/tracking";
import { AppError } from "../errors";
import { metaClient, metaError, requireMetaConfig, segmentationLimiter, withRetry } from "./meta";
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

/** Uploads once per video; later passes reuse the returned file id. */
async function fileIdFor(input: SegmentInput, force = false): Promise<string> {
  const cachePath = path.join(input.videoDir, FILE_CACHE);
  if (!force) {
    const cached = await readFile(cachePath, "utf8").then((raw) => JSON.parse(raw) as { fileId?: string }).catch(() => null);
    if (cached?.fileId) {
      await recordUsage({ model: "files", kind: "file_upload", cached: true, ok: true, videoId: input.videoId });
      return cached.fileId;
    }
  }
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
    throw metaError(error, "la segmentación");
  }
}

function isMissingFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("file") && (message.includes("not found") || message.includes("no such"));
}
