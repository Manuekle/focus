import type { EditPlan, NormalizedMedia } from "../../shared/schemas";
import type { SegmentationResult } from "../ai/meta";

// Deterministic compositor contract. Implementations read the normalized
// video and the masks produced for that same file, and write an H.264 MP4.
// Effect parameters come from a validated EditPlan, never from model text.

export type RenderInput = {
  readonly normalizedVideoPath: string;
  readonly media: NormalizedMedia;
  readonly plan: EditPlan;
  readonly segmentation: SegmentationResult;
  readonly outputPath: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
};

export interface EffectRenderer {
  readonly effect: EditPlan["effect"];
  render(input: RenderInput): Promise<{ readonly outputPath: string }>;
}
