import OpenAI from "openai";
import sharp from "sharp";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { AppError } from "../errors";
import { concurrency, Limiter, metaClient, metaError, requireMetaConfig, withRetry } from "../ai/meta";
import { recordUsage } from "../ai/usage";

// Muse Image through the Responses API with its image_generation tool. Each
// drawing is one stateless turn (store: false) that carries the immutable
// character anchor as an input image: consistency comes from re-sending the
// same reference every time, never from a growing conversation that drifts.
// Built-in image search, web search and shell stay off: a pose drawing must
// come from the reference, not from the internet.

const limiter = ((globalThis as { __focusImageLimiter?: Limiter }).__focusImageLimiter ??= new Limiter(concurrency("FOCUS_IMAGE_CONCURRENCY", 2)));

export type ImageReference = {
  readonly png: Buffer;
  /** What this image is for, said to the model right before it. */
  readonly role: string;
  /** How the prompt names this image; default "Image <n>" by position. */
  readonly label?: string;
  /** The bytes this image was made from by a fixed transform (a character sheet rescaled), when it isn't sent as they were. */
  readonly derivedFrom?: Buffer;
};

export type GeneratedImage = {
  /** The drawing as an sRGB PNG with alpha: what every later step reads. */
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  /** The bytes Muse Image returned, decoded from base64 and otherwise untouched. */
  readonly raw?: Buffer;
  /** What the provider said about the call, without the image: for the debug record. */
  readonly response?: ImageResponse;
};

export type ImageResponse = {
  readonly id: string | null;
  readonly status: string | null;
  readonly model: string | null;
  readonly usage: { readonly inputTokens: number | null; readonly outputTokens: number | null } | null;
  /** How many requests reached the provider for this one drawing (retries after a transient error included). */
  readonly requests: number;
  readonly durationMs: number;
};

/** References travel at most this large: enough detail, bounded request size. */
const REFERENCE_LONG_SIDE = 1024;

async function dataUrl(png: Buffer): Promise<string> {
  const meta = await sharp(png).metadata();
  const long = Math.max(meta.width ?? 0, meta.height ?? 0);
  const sized = long > REFERENCE_LONG_SIDE
    ? await sharp(png).resize(REFERENCE_LONG_SIDE, REFERENCE_LONG_SIDE, { fit: "inside", kernel: "lanczos3" }).png().toBuffer()
    : png;
  return `data:image/png;base64,${sized.toString("base64")}`;
}

function blocked(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  const code = String((error as { code?: unknown }).code ?? "");
  return code === "content_policy_violation" || error.message.toLowerCase().includes("content_policy");
}

export type ImageRequest = {
  readonly prompt: string;
  readonly references: readonly ImageReference[];
  /** Aspect ratio hint, "WxH"; Muse Image may return other exact pixels. Omitted, an edit keeps Image 1's aspect. */
  readonly size?: string;
  /** "edit" reworks Image 1 instead of drawing a new picture. */
  readonly action?: "edit";
  /** "low" is a single refinement pass (same price); default "high". */
  readonly reasoning?: "high" | "low";
};

/** The exact Responses API body generateImage sends (images as data URLs, already resized). */
export async function imageRequestBody(input: ImageRequest, model: string): Promise<ResponseCreateParamsNonStreaming> {
  const content: unknown[] = [];
  for (const [index, reference] of input.references.entries()) {
    content.push({ type: "input_text", text: `${reference.label ?? `Image ${index + 1}`}: ${reference.role}` });
    content.push({ type: "input_image", image_url: await dataUrl(reference.png) });
  }
  content.push({ type: "input_text", text: input.prompt });
  return {
    model,
    input: [{ type: "message", role: "user", content }],
    store: false,
    tools: [
      {
        type: "image_generation",
        ...(input.size ? { size: input.size } : {}),
        ...(input.action ? { action: input.action } : {}),
        output_format: "png",
        reasoning_strength: input.reasoning ?? "high",
        enable_image_search: false,
        enable_web_search: false,
        enable_shell: false,
      },
    ],
  } as unknown as ResponseCreateParamsNonStreaming;
}

export async function generateImage(input: ImageRequest & {
  readonly flipbookId?: string;
  readonly characterId?: string;
  readonly signal?: AbortSignal;
  /**
   * Requests allowed for this drawing (default 2: one retry after a transient error). A timeout is
   * retried too, and the provider may have drawn — and billed — the first one: 1 guarantees at most
   * one generation per call.
   */
  readonly attempts?: number;
}): Promise<GeneratedImage> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const body = await imageRequestBody(input, config.imageModel);

  const started = Date.now();
  let requests = 0;
  try {
    const response = await limiter.run(() => withRetry(() => { requests++; return client.responses.create(body, { signal: input.signal }); }, { signal: input.signal, attempts: input.attempts ?? 2, baseDelayMs: 1500 }));
    const call = response.output.find((item) => item.type === "image_generation_call");
    await recordUsage({
      model: config.imageModel,
      kind: "image_generate",
      cached: false,
      ok: Boolean(call && "result" in call && call.result),
      flipbookId: input.flipbookId,
      characterId: input.characterId,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      durationMs: Date.now() - started,
    });
    const result = call && "result" in call ? call.result : null;
    if (!result) {
      throw new AppError("image_incomplete", 502, "Muse Image didn’t return a drawing. Try again.", call && "status" in call ? `status ${call.status}` : `response ${response.status}`);
    }
    const decoded = Buffer.from(result, "base64");
    try {
      const png = await sharp(decoded, { failOn: "error" }).toColourspace("srgb").ensureAlpha().png().toBuffer();
      const meta = await sharp(png).metadata();
      if (!meta.width || !meta.height) throw new Error("no size");
      const usage = response.usage ? { inputTokens: response.usage.input_tokens ?? null, outputTokens: response.usage.output_tokens ?? null } : null;
      return { png, width: meta.width, height: meta.height, raw: decoded, response: { id: response.id ?? null, status: response.status ?? null, model: response.model ?? null, usage, requests, durationMs: Date.now() - started } };
    } catch {
      throw new AppError("image_unreadable", 502, "Muse Image returned an image we couldn’t read. Try again.");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    await recordUsage({ model: config.imageModel, kind: "image_generate", cached: false, ok: false, flipbookId: input.flipbookId, characterId: input.characterId, error: String(error), durationMs: Date.now() - started });
    if (blocked(error)) {
      throw new AppError("image_blocked", 422, "Muse Image’s content filter declined this request, so nothing was drawn and it wasn’t counted against your allowance. Try a different reference image or reword the change.");
    }
    throw metaError(error, "drawing generation");
  }
}
