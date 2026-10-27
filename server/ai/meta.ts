import OpenAI from "openai";
import { AppError } from "../errors";

// Meta Model API access. Server-only: the key never leaves this process.
//
// Responsibility split:
//   Planner   (planner.ts) — Muse Spark understands the instruction and returns
//                            a validated EditPlan.
//   Segmenter (sam.ts)     — SAM 3.1 receives a concrete concept or point
//                            prompt and returns tracked masks.
//   Renderer  (../video)   — deterministic compositing.
//   Drawings  (../animation) — Muse Image redraws a character pose by pose
//                            for Focus Flipbook; SAM 3.1 cuts the sprites out.

export type MetaConfig = {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly plannerModel: string;
  readonly segmentationModel: string;
  /** Muse Image: Focus Flipbook's drawings. */
  readonly imageModel: string;
};

export const META_DEFAULTS = {
  baseUrl: "https://api.meta.ai/v1",
  plannerModel: "muse-spark-1.3",
  segmentationModel: "sam-3.1",
  imageModel: "muse-image-1.0",
} as const;

/** Returns null when no key is configured. */
export function readMetaConfig(env: Readonly<Record<string, string | undefined>> = process.env): MetaConfig | null {
  // MODEL_API_KEY is the documented name; META_API_KEY is what the existing
  // local .env uses.
  const apiKey = env.MODEL_API_KEY ?? env.META_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env.META_BASE_URL ?? META_DEFAULTS.baseUrl,
    plannerModel: env.META_PLANNER_MODEL ?? META_DEFAULTS.plannerModel,
    segmentationModel: env.META_SEGMENTATION_MODEL ?? META_DEFAULTS.segmentationModel,
    imageModel: env.META_IMAGE_MODEL ?? META_DEFAULTS.imageModel,
  };
}

export function requireMetaConfig(): MetaConfig {
  const config = readMetaConfig();
  if (!config) {
    throw new AppError("meta_not_configured", 503, "The Meta AI API key is missing on the server. Add MODEL_API_KEY to .env and restart.");
  }
  return config;
}

let cached: { key: string; client: OpenAI } | null = null;

export function metaClient(config: MetaConfig = requireMetaConfig()): OpenAI {
  if (cached?.key === config.apiKey) return cached.client;
  // Retries are ours (withRetry), so they stay bounded and visible in usage.
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, maxRetries: 0, timeout: 180_000 });
  cached = { key: config.apiKey, client };
  return client;
}

/** Translates SDK errors into messages the editor can show. */
export function metaError(error: unknown, what: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof OpenAI.APIUserAbortError || (error instanceof Error && error.name === "AbortError")) {
    return new AppError("canceled", 499, "Processing canceled.");
  }
  // Connection errors subclass APIError: check them first.
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AppError("meta_timeout", 504, `Meta AI took too long during ${what}. Try again to continue from your saved progress.`);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AppError("meta_unreachable", 502, "We couldn’t connect to Meta AI. Check the server’s connection.");
  }
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 502;
    if (status === 401) return new AppError("meta_unauthorized", 502, "Meta AI rejected the API key. Check MODEL_API_KEY.");
    if (status === 402 || status === 403) return new AppError("meta_forbidden", 502, "The Meta AI account doesn’t have access or enough credits for this action.");
    if (status === 404) return new AppError("meta_model_not_found", 502, "This Meta AI model isn’t available for the connected account.");
    if (status === 429) return new AppError("meta_rate_limited", 429, "Meta AI is receiving too many requests. Wait a moment and try again.");
    if (status === 400) return new AppError("meta_bad_request", 502, `Meta AI couldn’t accept the request for ${what}.`, error.message);
    return new AppError("meta_unavailable", 502, `Meta AI didn’t respond correctly during ${what}. Try again.`, error.message);
  }
  return new AppError("meta_failed", 502, `The ${what} step failed.`, error instanceof Error ? error.message : undefined);
}

function retryable(error: unknown): boolean {
  if (error instanceof OpenAI.APIUserAbortError) return false;
  if (error instanceof OpenAI.APIConnectionError) return true;
  if (error instanceof OpenAI.APIError) return error.status === 429 || (error.status ?? 0) >= 500;
  return false;
}

/** At most `attempts` tries, exponential backoff, only for transient failures. */
export async function withRetry<T>(
  run: () => Promise<T>,
  { attempts = 3, baseDelayMs = 800, signal }: { attempts?: number; baseDelayMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw new OpenAI.APIUserAbortError();
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}

/** A tiny FIFO semaphore: expensive calls queue instead of piling onto the API. */
export class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

// Shared across route bundles for the same reason as the job runtime.
const limiters = ((globalThis as { __focusLimiters?: { planner: Limiter; segmentation: Limiter } }).__focusLimiters ??= {
  planner: new Limiter(2),
  segmentation: new Limiter(1),
});
export const plannerLimiter = limiters.planner;
export const segmentationLimiter = limiters.segmentation;
