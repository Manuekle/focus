import { actionSpec, type CharacterAnalysis, type FlipbookPlan } from "../../shared/flipbook";
import { generateImage, type GeneratedImage, type ImageReference } from "./muse-image";
import { posePrompt } from "./pose-planning";

// One drawing per pose. Image 1 is always the immutable character anchor;
// a redraw may add its neighboring drawing as a second, weaker reference for
// line weight and size, never in place of the anchor.

export const FRAME_SIZE = "1024x1536";

export async function drawPose(input: {
  readonly reference: Buffer;
  readonly neighbor: Buffer | null;
  readonly analysis: CharacterAnalysis | null;
  readonly plan: FlipbookPlan;
  readonly index: number;
  readonly note?: string;
  readonly flipbookId: string;
  readonly signal?: AbortSignal;
}): Promise<GeneratedImage> {
  const references: ImageReference[] = [{ png: input.reference, role: "the character reference. Its design is the identity to keep." }];
  if (input.neighbor) references.push({ png: input.neighbor, role: `the neighboring drawing of this ${actionSpec(input.plan.action).label} (size, line weight and color only).` });
  return generateImage({
    prompt: posePrompt({ analysis: input.analysis, plan: input.plan, index: input.index, note: input.note, hasNeighbor: Boolean(input.neighbor) }),
    references,
    size: FRAME_SIZE,
    flipbookId: input.flipbookId,
    signal: input.signal,
  });
}
