import sharp from "sharp";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "../ai/meta";
import { recordUsage } from "../ai/usage";
import { generateImage, type ImageReference } from "../animation/muse-image";
import { KEY_COLOR } from "./alpha";
import type { Check } from "./run-state";
import { toLine, type Marks } from "./grid";

// Muse Image draws one frame; Muse Spark judges it against the source frame.
// The generator never sees the source person in colour: it gets the character
// sheet, the pose skeleton on the character's proportions, a greyscale copy of
// the source frame for what a skeleton can't show (foreshortening, hands), and
// the last approved drawing for continuity.

/** Muse Image's portrait size: every frame is drawn and kept at this canvas. */
export const CANVAS = { width: 1024, height: 1536 } as const;

/** Letterboxes an image onto the 2:3 canvas without stretching it. */
export async function fitCanvas(png: Buffer, background: string): Promise<Buffer> {
  return sharp(png).resize(CANVAS.width, CANVAS.height, { fit: "contain", background, kernel: "lanczos3" }).flatten({ background }).png().toBuffer();
}

/** A transparent drawing flattened for a model or a person to look at. */
export const onColour = (png: Buffer, background: string) => sharp(png).flatten({ background }).png().toBuffer();

/** Source frame (left) and drawing (right) at the same scale on one grey sheet: the reviewer compares within one image. */
export async function sideBySide(source: Buffer, drawing: Buffer): Promise<Buffer> {
  const half = { width: CANVAS.width / 2, height: CANVAS.height / 2 };
  const cell = async (png: Buffer) => sharp(await fitCanvas(await onColour(png, "#d8d8d8"), "#d8d8d8")).resize(half.width, half.height).png().toBuffer();
  return sharp({ create: { width: CANVAS.width + 16, height: half.height, channels: 3, background: "#ffffff" } })
    .composite([{ input: await cell(source), left: 0, top: 0 }, { input: await cell(drawing), left: half.width + 16, top: 0 }])
    .png().toBuffer();
}

export async function describeCharacter(character: Buffer): Promise<string> {
  const config = requireMetaConfig();
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions: "Describe this character's fixed design for an animator who must redraw them identically in other poses: hair (shape, length, colour), face (eye shape and colour, default expression), body proportions (build, how many heads tall, leg length against the torso, arm length), every clothing item with colour and details (sleeves, collar, tie, belt, trousers or skirt, socks, shoes), accessories, line and colour style. One paragraph, under 120 words, English, no pose description.",
      reasoning: { effort: "low" },
      input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${character.toString("base64")}`, detail: "high" }] }],
    })));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    return response.output_text.trim();
  } catch (error) {
    throw metaError(error, "character description");
  }
}

/**
 * The video frame's pose in words, read by Muse Spark once per frame: what the joint
 * measurements can't say (closed eyes, a bowed head, a fist against a palm, which hand is in
 * front). Sides as the viewer sees them, the person's looks left out: only the character is drawn.
 */
export async function describeFrame(frame: Buffer, signal?: AbortSignal): Promise<string> {
  const config = requireMetaConfig();
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions: "This is one frame of a dance video. Describe ONLY the body pose for an animator who will redraw it with a different character: head (tilt, bowed or raised, turned), eyes (open, half-closed or closed) and mouth, torso lean, each arm (where the elbow points, where the hand is: height and next to which body part), each hand's shape (fist, open palm up, pointing), each leg (straight or bent, knees together or apart, which foot is forward, feet together or apart, weight on which leg). Name sides as the viewer sees them: \"the arm on the LEFT of the image\", never the person's own left or right. Never mention hair, face design, clothes, colours or body build. Plain sentences, under 90 words, English.",
      reasoning: { effort: "low" },
      input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${frame.toString("base64")}`, detail: "high" }] }],
    }, { signal }), { signal }));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    return response.output_text.trim();
  } catch (error) {
    throw metaError(error, "frame description");
  }
}

/** A director's note on an earlier drawing of this frame: red pencil marks over it and a comment. */
export type Correction = { readonly marked: Buffer; readonly comment: string };

export type FrameInput = {
  readonly character: Buffer;
  readonly description: string;
  /** Pose skeleton on the canvas, with the measuring grid and the target lines. */
  readonly guide: Buffer;
  /** Greyscale source frame on the canvas, with the same grid. */
  readonly sourceGrey: Buffer;
  /** Last approved drawing on magenta, with the same grid. */
  readonly previous: Buffer | null;
  /**
   * The first approved drawing of the run on magenta, with the same grid: it never moves, so the
   * style can't drift as each frame copies the one before it. Null for the first frames.
   */
  readonly anchor?: Buffer | null;
  readonly marks: Marks;
  /** The source pose in screen terms (describePose). */
  readonly poseText: string;
  /** Every joint, limb length and the head size in grid cells (body-map.ts bodySpec). */
  readonly bodyMap: string;
  /** The video frame's face in screen terms (body-map.ts describeFace). */
  readonly face: string;
  /** The video frame's pose in words, read by Muse Spark (describeFrame); empty when unavailable. */
  readonly reading?: string;
  readonly correction: Correction | null;
  readonly feedback: readonly string[];
  /** What this run's rejected attempts taught (lessons.ts lessonLines). */
  readonly lessons?: readonly string[];
  readonly signal?: AbortSignal;
};

/** What every generator gets for one frame: the same images in the same order and the same prompt. */
export function framePrompt(input: FrameInput): { prompt: string; references: ImageReference[] } {
  const references: ImageReference[] = [
    { png: input.character, role: "THE CHARACTER. Copy this exact design: face, hair, every clothing item, colours, line style, head size and build. Limb lengths come from the skeleton of Image 2 and the measurements below, not from this sheet's pose." },
    { png: input.guide, role: "THE POSE SKELETON on the character's own proportions, at the exact position and size to draw, over a measuring grid (columns and lines numbered in cells of 128 px). Red limbs are the subject's right arm and leg, blue limbs the left ones, green = torso, neck and head (the green arc is the top of the skull, the green curve the jaw). Dashed green line = top of the hair, solid green line = soles of the shoes, vertical dashed green line = centre of the hips." },
    { png: input.sourceGrey, role: "POSE PHOTO of a different person (greyscale), over the same grid. Copy ONLY the body pose from it: limb angles, which arm crosses in front, hand shapes, head tilt, facial expression. Ignore this person's hair, face design, clothes and body size and proportions." },
    ...(input.previous ? [{ png: input.previous, role: "THE PREVIOUS FRAME of this animation over the same grid, for design and size consistency ONLY: keep the character, line weight, colours, head size and limb lengths identical to it. Its pose is the OLD pose — do NOT copy its pose; the pose comes from Image 2 and Image 3." }] : []),
    ...(input.anchor ? [{ png: input.anchor, role: "THE STYLE ANCHOR: the first approved frame of this animation, which fixes its drawing style. Match its outlines (weight and colour), its flat cel colouring, its level of detail and the look of the face, hair and skin exactly. Never render more polished, glossier, softer, more shaded or more detailed than this drawing. Its pose is NOT the pose to draw." }] : []),
    ...(input.correction ? [{ png: input.correction.marked, role: "AN EARLIER DRAWING OF THIS SAME FRAME with the director's RED pencil marks over the parts that are wrong. Keep what is not marked; redraw the marked parts as the director asks. The red marks are notes only: never draw them." }] : []),
  ];
  const n = (role: string) => references.findIndex((reference) => reference.role.startsWith(role)) + 1;
  const prompt = [
    `Draw one frame of a hand-drawn anime animation: the character from Image 1 holding exactly the pose of Image 2 and Image 3.`,
    `Character design (must not change): ${input.description}`,
    `Size and placement (use the numbered grid, lines counted from the top, 0 to 12): the top of the hair touches grid line ${toLine(input.marks.head)}, the soles of the shoes stand on grid line ${toLine(input.marks.feet)}, the hips are centred on the vertical green line. Keep this exact size: never bigger, never smaller. Leave at least one empty grid cell above the highest hand: nothing may touch any edge of the image.`,
    input.bodyMap,
    `Pose: match every limb angle, the head tilt and the hand shapes of Image 3, over the skeleton of Image 2. Full body visible, nothing cropped. Sides are as seen in the image, never mirrored: ${input.poseText}`,
    // The reading sees what joints can't (closed eyes, a bowed head); the measured face is only the fallback.
    ...(input.reading ? [`The pose photo, described by a person who watched the video (trust it for the head, eyes, mouth and hands): ${input.reading}`] : [input.face]),
    input.anchor
      ? `Style: identical to Image ${n("THE STYLE ANCHOR")} (the style anchor) — the same black outlines and line weight, the same flat cel colours and the same level of detail, with the design of Image 1. Do not upgrade the rendering: no soft or gradient shading, no glossy highlights, no extra detail, no thinner or lost outlines. Only one character, facing the camera as in the pose photo.`
      : `Style: identical to Image 1 — clean black outlines, flat cel colours, same proportions. No soft or gradient shading, no glossy highlights, no extra detail. Only one character, facing the camera as in the pose photo.`,
    `Background: the entire background is perfectly flat solid ${KEY_COLOR} magenta. The grid, numbers, skeleton and green lines are measuring aids only: do NOT draw any grid, line, number or text. No floor, no shadow, no gradient, no border. Never use magenta or pink on the character.`,
    ...(input.correction ? [`DIRECTOR'S CORRECTION for this frame (see the red marks in Image ${n("AN EARLIER DRAWING")}): ${input.correction.comment}`] : []),
    ...(input.lessons ?? []),
    ...(input.feedback.length ? [`The previous attempt at this frame was rejected. Fix: ${input.feedback.join(" ")}`] : []),
  ].filter(Boolean).join("\n");
  return { prompt, references };
}

/** Muse Image's drawing of one frame, on the canvas. */
export async function drawFrame(input: FrameInput): Promise<Buffer> {
  const { prompt, references } = framePrompt(input);
  const image = await generateImage({ prompt, references, size: `${CANVAS.width}x${CANVAS.height}`, signal: input.signal });
  return toCanvas(image.png);
}

/** Any generator's picture stretched onto the 2:3 canvas (they all draw at 2:3). */
export const toCanvas = (png: Buffer) => sharp(png).resize(CANVAS.width, CANVAS.height, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();

const LIMBS = ["right arm (upper arm and forearm)", "right hand", "left arm (upper arm and forearm)", "left hand", "legs and feet", "head and torso"] as const;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["limbs", "sameCharacter", "identityNotes", "sameStyle", "anatomyOk", "anatomyNotes", "correctionDone", "correctionNotes", "fix"],
  properties: {
    limbs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["part", "source", "drawing", "same"],
        properties: { part: { type: "string", enum: [...LIMBS] }, source: { type: "string" }, drawing: { type: "string" }, same: { type: "boolean" } },
      },
    },
    sameCharacter: { type: "boolean" },
    identityNotes: { type: "string" },
    sameStyle: { type: "boolean" },
    anatomyOk: { type: "boolean" },
    anatomyNotes: { type: "string" },
    correctionDone: { type: "boolean" },
    correctionNotes: { type: "string" },
    fix: { type: "string" },
  },
} as const;

export type Review = {
  limbs: { part: string; source: string; drawing: string; same: boolean }[];
  sameCharacter: boolean;
  identityNotes: string;
  sameStyle: boolean;
  anatomyOk: boolean;
  anatomyNotes: string;
  correctionDone: boolean;
  correctionNotes: string;
  fix: string;
};

export function reviewCheck(review: Review, correction: Correction | null = null): Check {
  const covered = new Set(review.limbs.map((limb) => limb.part));
  const failed = [
    ...review.limbs.filter((limb) => !limb.same).map((limb) => `${limb.part}: video ${limb.source}; drawing ${limb.drawing}`),
    ...LIMBS.filter((part) => !covered.has(part)).map((part) => `${part}: not compared`),
    !review.sameCharacter && `identity: ${review.identityNotes}`,
    !review.sameStyle && "style differs from the character sheet",
    !review.anatomyOk && `anatomy: ${review.anatomyNotes}`,
    correction && !review.correctionDone && `your note not done: ${review.correctionNotes}`,
  ].filter(Boolean) as string[];
  return failed.length
    ? { name: "review", passed: false, detail: failed.join(" | "), feedback: review.fix || failed.join(" ") }
    : { name: "review", passed: true, detail: "same pose part by part, same character, same style" };
}

export async function reviewFrame(input: { readonly character: Buffer; readonly pair: Buffer; readonly previous: Buffer | null; readonly anchor?: Buffer | null; readonly correction?: Correction | null; readonly legs?: string; readonly signal?: AbortSignal }): Promise<Review> {
  const config = requireMetaConfig();
  const started = Date.now();
  const image = (png: Buffer) => ({ type: "input_image" as const, image_url: `data:image/png;base64,${png.toString("base64")}`, detail: "high" as const });
  const anchorImage = input.previous ? 4 : 3;
  const correctionImage = anchorImage + (input.anchor ? 1 : 0);
  const instructions = `You are the strict final checker of a rotoscoped anime animation. Image 1 is the character sheet. Image 2 shows two panels at the same scale: LEFT is a frame of the source video (a DIFFERENT person in the target pose), RIGHT is the new drawing of the character for that frame.${input.previous ? " Image 3 is the previous approved frame of the same animation." : ""}${input.anchor ? ` Image ${anchorImage} is the first approved frame of the animation: the style anchor.` : ""}
"Right" and "left" always mean the subject's own right and left (a subject facing the camera has their right arm on the viewer's left).
limbs: for each body part (${LIMBS.join("; ")}) describe in under 12 words where it is in the LEFT panel and where it is in the RIGHT panel (direction it points, bent or straight, in front of or beside the body, head tilt and torso lean), then same=true only if they match. ${input.legs ? `Measured on the video's joints, true for the LEFT panel whatever it looks like at a glance: ${input.legs} Judge the drawing's legs against that. ` : ""}Hands are judged ONLY by where the hand is and which way it points (up, down, toward the camera, across the body); finger shape, spread fingers, a pointing finger or palm orientation do not count as a difference. The character's own proportions may differ; the pose may not. Mirrored poses are wrong.${input.previous ? " Do not accept a drawing that repeats the previous frame's pose when the video pose changed." : ""}
sameCharacter: is the RIGHT drawing the same character as Image 1 — same hair, face, every clothing item and colour? Anything taken from the person on the LEFT (their hair, clothes, body) is wrong.
sameStyle: ${input.anchor ? `same line art and flat colouring as Image ${anchorImage}, the animation's established style: same outline weight and colour, flat cel colours, same level of detail. false if the RIGHT drawing looks more polished, glossier, softer, more shaded, more detailed or more painterly than Image ${anchorImage}, or has thinner, lost or differently coloured outlines, even if it looks nicer.` : "same line art and flat colouring as Image 1."}
anatomyOk: no missing, extra, merged or broken limbs, hands or fingers; nothing cropped; arms, legs and head keep the character sheet's proportions (a limb clearly longer than on Image 1, or a head clearly smaller, is an anatomy error).${input.correction ? ` correctionDone: Image ${correctionImage} is an earlier drawing of this frame with the director's red pencil marks, and the director asked: "${input.correction.comment.replace(/"/g, "'")}". true only if the RIGHT drawing fixes exactly that in the marked places.` : " correctionDone: always true (no correction was asked)."}
Be honest; do not praise, do not assume. Notes under 25 words, English. fix: one or two imperative sentences telling the illustrator exactly what to change, naming sides as the viewer sees them ("the arm on the left of the image") because illustrators confuse the subject's left and right; empty when everything matches.`;
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions,
      reasoning: { effort: "medium" },
      input: [{ type: "message", role: "user", content: [image(input.character), image(input.pair), ...(input.previous ? [image(input.previous)] : []), ...(input.anchor ? [image(input.anchor)] : []), ...(input.correction ? [image(input.correction.marked)] : [])] }],
      text: { format: { type: "json_schema", name: "rotoscope_review", strict: true, schema: REVIEW_SCHEMA } },
    }, { signal: input.signal }), { signal: input.signal }));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_review", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    if (response.status !== "completed" || !response.output_text) throw new Error("Muse Spark did not finish the review");
    return JSON.parse(response.output_text) as Review;
  } catch (error) {
    throw metaError(error, "frame review");
  }
}
