import { actionSpec, type CharacterAnalysis, type FlipbookPlan } from "../../shared/flipbook";
import { generateImage, type GeneratedImage, type ImageReference } from "./muse-image";
import { inbetweenPrompt, posePrompt, repairPrompt } from "./pose-planning";
import { castLabel, ensemblePrompt, type CastEntry } from "./ensemble-planning";
import { AppError } from "../errors";

// One drawing per pose. Image 1 is always the immutable character anchor;
// a redraw may add its neighboring drawing as a second, weaker reference for
// line weight and size, never in place of the anchor.

export const FRAME_SIZE = "1024x1536";
/** A scene is wide: several characters side by side need more width than height. */
export const ENSEMBLE_FRAME_SIZE = "1536x1024";

export async function drawPose(input: {
  readonly reference: Buffer;
  readonly neighbor: Buffer | null;
  /** More images of the same character, after the anchor. */
  readonly extras?: readonly Buffer[];
  /** Original portrait: identity only, never a replacement for the selected outfit. */
  readonly identityReference?: Buffer;
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
  if (input.identityReference) references.push({ png: input.identityReference, role: "the immutable ORIGINAL character identity. Match its face, eyes, ears, hair and illustration style when visible in the selected view. Never turn a rear view around to show the face. Ignore its clothing and pose: Image 1 defines the selected outfit and the phase instructions define the pose." });
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

/**
 * One in-between drawing, from the two key drawings around it. The anchor
 * stays Image 1 for identity; the keys (as drawn, on their key color) carry
 * the pose, the size and the framing.
 */
export async function drawInbetween(input: {
  readonly reference: Buffer;
  readonly from: Buffer;
  readonly to: Buffer;
  readonly extras?: readonly Buffer[];
  readonly identityReference?: Buffer;
  readonly analysis: CharacterAnalysis | null;
  readonly plan: FlipbookPlan;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly flipbookId: string;
  readonly signal?: AbortSignal;
}): Promise<GeneratedImage> {
  const extras = input.extras ?? [];
  const fromPose = input.plan.poses[input.fromIndex];
  const toPose = input.plan.poses[input.toIndex];
  const references: ImageReference[] = [
    { png: input.reference, role: "the character reference. Its design is the identity to keep." },
    { png: input.from, role: `the key drawing before the in-between ("${fromPose.label}").` },
    { png: input.to, role: `the key drawing after the in-between ("${toPose.label}").` },
  ];
  for (const extra of extras) references.push({ png: extra, role: "an extra reference of the same character (design details only, never the pose)." });
  if (input.identityReference) references.push({ png: input.identityReference, role: "the immutable ORIGINAL character identity: face, eyes, ears, hair and illustration style only. Ignore its clothing and pose." });
  return generateImage({
    prompt: inbetweenPrompt({ analysis: input.analysis, plan: input.plan, fromIndex: input.fromIndex, toIndex: input.toIndex, extraCount: extras.length }),
    references,
    size: FRAME_SIZE,
    flipbookId: input.flipbookId,
    signal: input.signal,
  });
}

/**
 * One drawing of a scene. Images 1…n are the characters, each its own
 * reference and identity; a drawing to repair and the drawing before this one
 * (staging, size, line weight) follow them, never in place of a character.
 */
export async function drawEnsembleFrame(input: {
  readonly cast: readonly (CastEntry & { readonly png: Buffer })[];
  readonly neighbor: Buffer | null;
  readonly repair?: { readonly png: Buffer; readonly problems: readonly string[] } | null;
  readonly analysis: CharacterAnalysis | null;
  readonly plan: FlipbookPlan;
  readonly scene: string;
  readonly index: number;
  readonly note?: string;
  readonly flipbookId: string;
  readonly signal?: AbortSignal;
}): Promise<GeneratedImage> {
  const references: ImageReference[] = input.cast.map((entry, index) => ({ png: entry.png, role: `${castLabel(entry, index)}. Its design is that character’s identity to keep.` }));
  if (input.repair) references.push({ png: input.repair.png, role: "the drawing to repair: keep its pose and staging, fix its mistakes." });
  if (input.neighbor) references.push({ png: input.neighbor, role: "the neighboring drawing of this scene (camera, size, ground line, line weight and color only)." });
  return generateImage({
    prompt: ensemblePrompt({ cast: input.cast, analysis: input.analysis, plan: input.plan, index: input.index, scene: input.scene, note: input.note, hasNeighbor: Boolean(input.neighbor), repair: input.repair ?? null }),
    references,
    size: ENSEMBLE_FRAME_SIZE,
    flipbookId: input.flipbookId,
    signal: input.signal,
  });
}
