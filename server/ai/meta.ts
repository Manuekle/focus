import type { EditPlan, EditRequest, NormalizedMedia } from "../../shared/schemas";
import { AppError } from "../errors";

// Service boundaries for Meta AI. Phase 1 defines the contracts only; the
// real clients (Muse Spark for planning, SAM 3.1 for segmentation) land in
// Phase 2. Nothing here returns placeholder results.
//
// Responsibility split:
//   Planner   — understands the instruction, returns a validated EditPlan.
//   Segmenter — receives a concrete concept and the normalized video, returns
//               per-frame masks aligned to the normalized frame indexing.
//   Renderer  — deterministic compositing (server/video/renderer.ts).

export type MetaConfig = {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly plannerModel: string;
  readonly segmentationModel: string;
};

export const META_DEFAULTS = {
  baseUrl: "https://api.meta.ai/v1",
  plannerModel: "muse-spark-1.3",
  segmentationModel: "sam-3.1",
} as const;

/** Server-only. Returns null when no key is configured. */
export function readMetaConfig(env: NodeJS.ProcessEnv = process.env): MetaConfig | null {
  // MODEL_API_KEY is the documented name; META_API_KEY is what the existing
  // local .env uses.
  const apiKey = env.MODEL_API_KEY ?? env.META_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env.META_BASE_URL ?? META_DEFAULTS.baseUrl,
    plannerModel: env.META_PLANNER_MODEL ?? META_DEFAULTS.plannerModel,
    segmentationModel: env.META_SEGMENTATION_MODEL ?? META_DEFAULTS.segmentationModel,
  };
}

export function requireMetaConfig(): MetaConfig {
  const config = readMetaConfig();
  if (!config) {
    throw new AppError("meta_not_configured", 503, "Falta la clave de Meta AI en el servidor. Añade MODEL_API_KEY a .env y reinicia.");
  }
  return config;
}

export interface EditPlanner {
  /** Interprets a natural-language instruction. Output is parsed with EditPlanSchema. */
  plan(request: EditRequest, context: { readonly posterPath: string; readonly media: NormalizedMedia }): Promise<EditPlan>;
}

/** One mask per normalized frame, same width/height as NormalizedMedia. */
export type MaskFrame = {
  readonly frameIndex: number;
  /** Path to a single-channel PNG on local disk. */
  readonly maskPath: string;
  readonly score: number;
};

export type SegmentationResult = {
  readonly concept: string;
  readonly objectCount: number;
  readonly frames: readonly MaskFrame[];
};

export interface VideoSegmenter {
  segment(input: {
    readonly normalizedVideoPath: string;
    readonly media: NormalizedMedia;
    readonly concept: string;
    readonly selection: EditPlan["target"]["selection"];
    readonly outputDir: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (fraction: number) => void;
  }): Promise<SegmentationResult>;
}
