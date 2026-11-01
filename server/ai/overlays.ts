import { z } from "zod";
import type { NormalizedMedia } from "../../shared/schemas";
import type { Box } from "../../shared/tracking";
import { AppError } from "../errors";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "./meta";
import { recordUsage } from "./usage";

// Text removal needs every piece of writing, and SAM's concept pass only
// finds the big captions: small brand lines, handles and pill buttons slip
// through. Muse Spark looks at a few frames and boxes each line of overlaid
// text or graphic; those boxes then prompt SAM, which draws the real masks.
// The model only returns numbers in a fixed schema, clamped to the frame.

export const OVERLAY_MAX_REGIONS = 24;

export const OVERLAY_INSTRUCTIONS = `You find on-screen text in frames of a short video, so it can be erased. For each frame, list every line of text, caption, title, handle, watermark, logo, icon or button that is overlaid on the footage (graphics added in editing), one region per line of text or per graphic. Leave out writing that belongs to the filmed scene (a shop sign, a T-shirt print). box = [left, top, right, bottom] in 0–1000 coordinates of that frame, tight around the ink. An empty list when a frame has no overlay.`;

export const OVERLAY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["frames"],
  properties: {
    frames: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["frame", "regions"],
        properties: {
          frame: { type: "integer" },
          regions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "box"],
              properties: { label: { type: "string" }, box: { type: "array", items: { type: "integer" } } },
            },
          },
        },
      },
    },
  },
} as const;

const OverlayOutputSchema = z.object({
  frames: z.array(
    z.object({
      frame: z.number().int().nonnegative(),
      regions: z.array(z.object({ label: z.string().max(200), box: z.array(z.number()).length(4) })).max(OVERLAY_MAX_REGIONS * 2),
    }),
  ),
});

/** One overlaid region on one sampled frame, in source pixels. */
export type OverlayRegion = { readonly frameIndex: number; readonly box: Box; readonly label: string };

/** Pure: raw model text to pixel boxes on the sampled frames. Malformed or degenerate boxes are dropped. */
export function parseOverlayOutput(text: string, sampled: readonly number[], media: Pick<NormalizedMedia, "width" | "height">): OverlayRegion[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("overlay_invalid_output", 502, "Muse Spark returned an unreadable response. Try again.");
  }
  const parsed = OverlayOutputSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("overlay_invalid_output", 502, "We couldn’t read where the text is. Try again.");
  const toPixels = (value: number, size: number) => Math.round((Math.min(1000, Math.max(0, value)) * size) / 1000);
  const regions: OverlayRegion[] = [];
  for (const frame of parsed.data.frames) {
    if (!sampled.includes(frame.frame)) continue;
    for (const region of frame.regions) {
      const [l, t, r, b] = region.box;
      const box = { left: toPixels(Math.min(l, r), media.width), top: toPixels(Math.min(t, b), media.height), right: toPixels(Math.max(l, r), media.width), bottom: toPixels(Math.max(t, b), media.height) };
      if (box.right - box.left < 2 || box.bottom - box.top < 2) continue;
      regions.push({ frameIndex: frame.frame, box, label: region.label.trim().slice(0, 80) });
    }
  }
  return regions.slice(0, OVERLAY_MAX_REGIONS);
}

/** Muse Spark boxes the overlaid text and graphics on a few frames of the clip. */
export async function locateOverlays(input: {
  readonly frames: readonly { readonly index: number; readonly png: Buffer }[];
  readonly media: NormalizedMedia;
  readonly videoId: string;
  readonly signal?: AbortSignal;
}): Promise<OverlayRegion[]> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() =>
      withRetry(
        () =>
          client.responses.create(
            {
              model: config.plannerModel,
              instructions: OVERLAY_INSTRUCTIONS,
              reasoning: { effort: "low" },
              input: [
                {
                  type: "message",
                  role: "user",
                  content: input.frames.flatMap((frame) => [
                    { type: "input_text" as const, text: `Frame ${frame.index} (${input.media.width}x${input.media.height})` },
                    { type: "input_image" as const, image_url: `data:image/png;base64,${frame.png.toString("base64")}`, detail: "high" as const },
                  ]),
                },
              ],
              text: { format: { type: "json_schema", name: "overlays", strict: true, schema: OVERLAY_JSON_SCHEMA } },
            },
            { signal: input.signal },
          ),
        { signal: input.signal },
      ),
    );
    await recordUsage({
      model: config.plannerModel,
      kind: "plan",
      cached: false,
      ok: true,
      videoId: input.videoId,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      durationMs: Date.now() - started,
    });
    if (response.status !== "completed" || !response.output_text) {
      throw new AppError("overlay_incomplete", 502, "Muse Spark didn’t finish finding the text. Try again.");
    }
    return parseOverlayOutput(response.output_text, input.frames.map((frame) => frame.index), input.media);
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.plannerModel, kind: "plan", cached: false, ok: false, videoId: input.videoId, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "text location");
  }
}

/** Share of `box` covered by any of `covers`, from box overlap (cheap and good enough to skip known text). */
export function coveredShare(box: Box, covers: readonly Box[]): number {
  const area = (box.right - box.left) * (box.bottom - box.top);
  if (area <= 0) return 1;
  let covered = 0;
  for (const other of covers) {
    const w = Math.min(box.right, other.right) - Math.max(box.left, other.left);
    const h = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
    if (w > 0 && h > 0) covered += w * h;
  }
  return Math.min(1, covered / area);
}

/** Frames Muse Spark looks at: spread over the clip, so text that comes and goes is seen. */
export function overlaySampleFrames(frameCount: number): number[] {
  return [...new Set([0.1, 0.5, 0.9].map((at) => Math.min(frameCount - 1, Math.round(at * (frameCount - 1)))))];
}
