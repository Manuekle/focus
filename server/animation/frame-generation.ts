import { actionSpec, type CharacterAnalysis, type FlipbookPlan } from "../../shared/flipbook";
import { generateImage, type GeneratedImage, type ImageReference } from "./muse-image";
import { posePrompt, repairPrompt } from "./pose-planning";
import { AppError } from "../errors";

// One drawing per pose. Image 1 is always the immutable character anchor;
// a redraw may add its neighboring drawing as a second, weaker reference for
// line weight and size, never in place of the anchor.

export const FRAME_SIZE = "1024x1536";

export async function drawPose(input: {
  readonly reference: Buffer;
  readonly neighbor: Buffer | null;
  /** More images of the same character, after the anchor. */
  readonly extras?: readonly Buffer[];
  /** The gallery mannequin controls posture only; the character remains Image 1. */
  readonly poseReference?: Buffer;
  /** Only older explicit selections require a download; automatic guides can fall back to text. */
  readonly requirePoseReference?: boolean;
  /** The current drawing, when it is being repaired rather than drawn from scratch. */
  readonly repair?: { readonly png: Buffer; readonly problems: readonly string[] } | null;
  readonly analysis: CharacterAnalysis | null;
  readonly plan: FlipbookPlan;
  readonly index: number;
  readonly note?: string;
  readonly flipbookId: string;
  readonly signal?: AbortSignal;
}): Promise<GeneratedImage> {
  const extras = input.extras ?? [];
  const references: ImageReference[] = [{ png: input.reference, role: "the character reference. Its design is the identity to keep." }];
  if (input.repair) references.push({ png: input.repair.png, role: "the drawing to repair: keep its pose, fix its mistakes." });
  if (input.neighbor) references.push({ png: input.neighbor, role: `the neighboring drawing of this ${actionSpec(input.plan.action).label} (size, line weight and color only).` });
  for (const extra of extras) references.push({ png: extra, role: "an extra reference of the same character (design details only, never the pose)." });
  const guideId = input.plan.poseId ?? input.plan.poses[input.index]?.referenceId;
  if (guideId && input.requirePoseReference && !input.poseReference) throw new AppError("pose_unavailable", 502, "The pose reference is missing. Try drawing this frame again.");
  if (guideId && input.poseReference) references.push({ png: input.poseReference, role: "a mannequin for posture and anatomy only. The phase mechanics take priority. Never copy its identity, proportions, gray body or style." });
  const poseImageNumber = guideId && input.poseReference ? references.length : undefined;
  const hasNeighbor = Boolean(input.neighbor);
  return generateImage({
    prompt: input.repair
      ? repairPrompt({ analysis: input.analysis, plan: input.plan, index: input.index, note: input.note, problems: input.repair.problems, hasNeighbor, extraCount: extras.length, poseImageNumber })
      : posePrompt({ analysis: input.analysis, plan: input.plan, index: input.index, note: input.note, hasNeighbor, extraCount: extras.length, poseImageNumber }),
    references,
    size: FRAME_SIZE,
    flipbookId: input.flipbookId,
    signal: input.signal,
  });
}
