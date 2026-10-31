import type { ImageReference } from "../animation/muse-image";

// The single-frame debug prompt: two images and plain priorities, nothing else.
// No grid, no coordinates, no previous frame, no lessons from other frames:
// whatever goes wrong in this drawing comes from these two images and these lines.

export const SINGLE_FRAME_PROMPT = `Image A is the pose reference.
Image B is the character reference.

Generate one full-body anime illustration.

Match the pose of Image A as closely as possible:
- same head tilt
- same arm positions
- same hand placement
- same torso orientation
- same leg spacing
- same foot placement
- same overall silhouette

Preserve the character identity from Image B:
- same face
- same hair shape and color
- same eye color
- same outfit
- same proportions
- same illustration style

Keep the full body visible.
Do not crop hands or feet.
Do not change the pose.
Do not redesign the character.
Do not merge the legs.
Do not fuse limbs.
Use clean anime lineart, simple shading, and a plain background.`;

/** Image A (pose) then Image B (character), named the way the prompt names them. */
export function singleFrameReferences(pose: Buffer, character: Buffer): ImageReference[] {
  return [
    { png: pose, label: "Image A", role: "the pose reference" },
    { png: character, label: "Image B", role: "the character reference" },
  ];
}

/**
 * What a run tries, one change at a time against "base" (the prompt above):
 *   edit       Muse Image EDITS Image A into the character, so A's pose and silhouette are the
 *              starting point rather than something to copy;
 *   mannequin  adds Image C, a posing mannequin of A's skeleton (coloured volumes, no grid): the
 *              pose without the other person's clothes and body;
 *   describe   the base prompt plus A's pose in words, measured on its joints (arms, legs, hands
 *              at the head): no coordinates, only what a skeleton says plainly;
 *   stance     describe plus A's leg spacing against B's, naming B's stance as the one not to copy.
 */
export const VARIANTS = ["base", "edit", "mannequin", "describe", "stance"] as const;
export type Variant = (typeof VARIANTS)[number];

export const EDIT_PROMPT = `Image A is the drawing to edit.
Image B is the character reference.

Redraw the figure in Image A as the character from Image B.
Keep Image A's pose exactly:
- same head tilt
- same arm positions
- same hand placement
- same torso orientation
- same leg spacing
- same foot placement
- same overall silhouette

Everything about how the figure looks comes from Image B:
- same face
- same hair shape and color
- same eye color
- same outfit
- same proportions
- same illustration style
Nothing of the person in Image A may remain: not their hair, face, clothes, socks, shoes or colors.

Keep the full body visible.
Do not crop hands or feet.
Do not merge the legs.
Do not fuse limbs.
Use clean anime lineart, simple shading, and a plain background.`;

const MANNEQUIN_LINE = "Image C is a posing mannequin of the pose in Image A: one coloured volume per body part. Red volumes are the character's right arm and leg (on the left of the picture), blue volumes the left arm and leg, green the torso, yellow the head. Lighter volumes are nearer the viewer. Use it to read Image A's pose exactly; never draw the mannequin or its colours.";

export type VariantRequest = { readonly prompt: string; readonly references: ImageReference[]; readonly action?: "edit" };

/** The prompt and images for one variant; `mannequin`, `described` and `stance` are needed by their variants only. */
export function variantRequest(variant: Variant, input: { readonly pose: Buffer; readonly character: Buffer; readonly mannequin?: Buffer; readonly described?: string; readonly stance?: string | null }): VariantRequest {
  const references = singleFrameReferences(input.pose, input.character);
  if (variant === "edit") return { prompt: EDIT_PROMPT, references: [{ ...references[0], role: "the drawing to edit" }, references[1]], action: "edit" };
  if (variant === "mannequin") {
    if (!input.mannequin) throw new Error("the mannequin variant needs Image A's pose (pose estimator)");
    return {
      prompt: SINGLE_FRAME_PROMPT.replace("Image B is the character reference.\n", `Image B is the character reference.\n${MANNEQUIN_LINE}\n`),
      references: [...references, { png: input.mannequin, label: "Image C", role: "the posing mannequin of Image A's pose" }],
    };
  }
  if (variant === "describe" || variant === "stance") {
    if (!input.described) throw new Error(`the ${variant} variant needs Image A's pose (pose estimator)`);
    if (variant === "stance" && !input.stance) throw new Error("the stance variant needs both poses, with Image B standing wider than Image A");
    const prompt = `${SINGLE_FRAME_PROMPT}\n\nImage A's pose, measured on its joints (sides as seen in the image, never mirrored):\n${input.described}`;
    return { prompt: variant === "stance" ? `${prompt}\n\n${input.stance}` : prompt, references };
  }
  return { prompt: SINGLE_FRAME_PROMPT, references };
}

/** Muse Image's aspect hint closest to the pose reference: portrait, landscape or square. */
export function sizeFor(width: number, height: number): string {
  const ratio = height / Math.max(1, width);
  return ratio > 1.15 ? "1024x1536" : ratio < 0.87 ? "1536x1024" : "1024x1024";
}
