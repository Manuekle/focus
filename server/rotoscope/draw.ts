import sharp from "sharp";
import { AppError } from "../errors";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "../ai/meta";
import { recordUsage } from "../ai/usage";
import { generateImage, type ImageReference } from "../animation/muse-image";
import { KEY_COLOR } from "./alpha";
import type { Check } from "./run-state";
import { toLine, withGrid, type Marks } from "./grid";
import { MANNEQUIN_ROLE } from "./mannequin";

// Muse Image draws one frame; Muse Spark reads the video frame into that
// frame's specification first and judges the drawing against it after.
// The generator never sees the source person in colour: it gets the character
// sheet, the pose mannequin (or skeleton) on the character's proportions, a greyscale copy of
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

/**
 * Names each colour of the character's palette by the part it paints ("hair", "hair shadow",
 * "blouse", "skin shadow", "outline"), read off the character sheet once per run.
 */
export async function namePalette(character: Buffer, colours: readonly { readonly hex: string; readonly share: number }[]): Promise<string[]> {
  const config = requireMetaConfig();
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions: `These are the flat colours of the character in the image, measured on it, with the share of the figure each covers: ${colours.map((colour, i) => `${i + 1}. ${colour.hex} (${(colour.share * 100).toFixed(1)} %)`).join("; ")}. For each, in the same order, name in two to four English words the part of the character it paints, and say "shadow" or "highlight" when it is the shaded or lit tone of another colour: "hair", "hair shadow", "skin", "skin shadow", "blouse", "blouse shadow", "shorts", "socks", "shoes", "eyes", "ribbon and choker", "outlines". When one colour paints several parts, name them all ("shorts and socks"). Return exactly ${colours.length} names.`,
      reasoning: { effort: "low" },
      input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${character.toString("base64")}`, detail: "high" }] }],
      text: { format: { type: "json_schema", name: "palette_names", strict: true, schema: { type: "object", additionalProperties: false, required: ["names"], properties: { names: { type: "array", items: { type: "string" } } } } } },
    })));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    const names = (JSON.parse(response.output_text) as { names: string[] }).names;
    return colours.map((colour, i) => names[i]?.trim() || `colour ${colour.hex}`);
  } catch (error) {
    throw metaError(error, "palette names");
  }
}

/** The identity line's opening: the same form the character presets use (shared/characters.ts), which Muse Image follows closely. */
const IDENTITY_OPENING = "Keep the character exactly as drawn:";

/** Whether a stored description is already an identity line (older runs kept a plain design paragraph). */
export const isIdentityLine = (text: string) => /^keep\b/i.test(text.trim());

/** The description as the prompt's first line: an older plain paragraph is put into the identity form. */
export const identityLine = (description: string) => (isIdentityLine(description) ? description.trim() : `${IDENTITY_OPENING} ${description.trim()}`);

/**
 * What Muse Spark sees in the character sheet, written as the identity line that opens every drawing's
 * prompt: "Keep … exactly as drawn: <hair, face, each garment with every detail, shoes>. Preserve the
 * proportions, colours and line work." It is what /characters gets from a person looking at the sheet;
 * here the model looks, and is told to state the build as drawn (a curvy figure is not "slender").
 */
export async function describeCharacter(character: Buffer, body: string | null = null): Promise<string> {
  const config = requireMetaConfig();
  const started = Date.now();
  // The person who made the run gave the character's real height and weight: the build is stated from them and the image together.
  const measured = body ? `\nThe character is ${body}: open the proportions part with exactly that ("${body}, about … heads tall, …") and state a build that fits it and the image.` : "";
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions: `You write the identity line for an animator who must redraw the character in this image identically in other poses, from this line and the image alone. One paragraph in English, under 170 words, no pose description, no pronouns (say "the character"), in exactly this form:
"${IDENTITY_OPENING} <hair: shape, length, colour, fringe, buns or ties>, <face: eye shape and colour, default expression>, <every garment from head to toe with its colour and EVERY detail it has: collar, closures, buttons, embroidery, trim, piping, slits, hem, patterns>, <legwear and shoes with their colour, heel height and shape>, <accessories>. Preserve the character's proportions (<the build in plain words as drawn: how many heads tall; shoulder, bust, waist, hip, thigh and calf width against the head; leg length against the torso; arm length>), colours, anime line work, shading style and level of detail. Show the whole body on a plain background."
Look at the image and state the build as drawn: full or thick thighs, wide hips or a curvy figure are said so, and "slender" is used only when the figure clearly is. Name the colours of the details too (the colour of a trim or of embroidery). Never invent a detail that is not in the image, and never leave out one that is.${measured}`,
      reasoning: { effort: "low" },
      input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${character.toString("base64")}`, detail: "high" }] }],
    })));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    // Never a quoted line, and always the identity form even when the model dropped the opening.
    const text = response.output_text.trim().replace(/^["“]+|["”]+$/g, "").trim();
    if (!text) throw new Error("Muse Spark returned no description");
    return identityLine(text);
  } catch (error) {
    throw metaError(error, "character description");
  }
}

/**
 * The parts of the art style sheet, in the order the prompts list them: how the character sheet is DRAWN, never what
 * it shows (that is the identity line). Each is concrete enough to check a drawing against.
 */
const STYLE_PARTS = [
  ["lines", "Line work", "outline colour, thickness and how it varies (thicker at the silhouette, thinner inside?), inner lines, line ends, any texture"],
  ["face", "Face and eyes", "how the face is constructed: eye size against the face, iris and pupil drawing, highlights in the eyes, lashes, brows, how the nose and mouth are drawn"],
  ["shading", "Shading", "cel or soft shading, how many tones per colour, hard or soft shadow edges, where shadows typically sit, any rim light or highlight"],
  ["hair", "Hair", "how strands and clumps are drawn, highlight shapes on the hair, shadow placement in it"],
  ["clothing", "Clothing", "how folds and creases are drawn and how much the fabric is simplified"],
  ["colour", "Colour", "saturation, contrast and value range of the palette, flat fills or textured"],
  ["finish", "Finish", "the overall look in a few words: which kind of 2D animation production it belongs to, and what it never has (gradients, gloss, painterly texture, 3D rendering)"],
] as const;

const STYLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: STYLE_PARTS.map(([key]) => key),
  properties: Object.fromEntries(STYLE_PARTS.map(([key]) => [key, { type: "string" }])),
} as const;

/**
 * Muse Spark's art style sheet of the character sheet: line work, face and eye construction, shading, hair, folds,
 * colour and finish, one labelled line each. Made once per character (its kit) and given to every drawing beside the
 * sheet itself, so "drawn like Image 2" has concrete rules behind it.
 */
export async function describeStyle(character: Buffer, signal?: AbortSignal): Promise<string> {
  const config = requireMetaConfig();
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions: `You write the art style sheet an animation studio hands to animators who must draw new frames that look drawn by the same artist as this character sheet. Describe HOW the image is drawn, never WHAT it shows: no garment, hair colour or design detail, those are in another document. For each part write one short, concrete sentence a person could check a drawing against (thick or thin, how many tones, hard or soft edges), from looking at the image only; never generic praise like "high quality". Parts:\n${STYLE_PARTS.map(([key, label, what]) => `- ${key} (${label}): ${what}`).join("\n")}`,
      reasoning: { effort: "low" },
      input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${character.toString("base64")}`, detail: "high" }] }],
      text: { format: { type: "json_schema", name: "art_style_sheet", strict: true, schema: STYLE_SCHEMA } },
    }, { signal }), { signal }));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    const parts = JSON.parse(response.output_text) as Record<(typeof STYLE_PARTS)[number][0], string>;
    const lines = STYLE_PARTS.map(([key, label]) => (parts[key]?.trim() ? `${label}: ${parts[key].trim()}` : "")).filter(Boolean);
    if (lines.length < 3) throw new Error("Muse Spark returned no style sheet");
    return lines.join("\n");
  } catch (error) {
    throw metaError(error, "art style sheet");
  }
}

/**
 * The frame specification's parts, in the order the prompt lists them. Each is what that part of
 * the drawing must show in this one frame, read off the video frame: the joint measurements can't
 * say any of the expression, hair motion, creases or light, and only roughly where a hand is or
 * which is in front. Only position, motion and gesture: the look always comes from the character sheet.
 */
const READING_PARTS = [
  ["head", "Head", "tilt (toward which side of the image, how many degrees), turn (toward which side, how far: frontal, three-quarter, profile), bowed or raised, chin position"],
  ["face", "Face", "gaze (where the pupils point), each eye (open, half-closed, closed, squinting, winking: which side), eyebrows (raised, knitted, relaxed), mouth (closed, smiling, open: shape and how wide, teeth or tongue visible), blush or other marks"],
  ["hair", "Hair", "where the fringe and side strands fall in this frame: which way each swings or lifts with the motion, which eye or cheek they cover, the outline of the hair mass against the head"],
  ["torso", "Torso", "lean (toward which side of the image), twist of the shoulders against the hips, which shoulder is raised, chest facing the viewer or turned"],
  ["armLeft", "Arm on the left of the image", "upper arm direction, elbow (where it points, which grid cell it is in), forearm direction, foreshortening, in front of or behind the body or head"],
  ["handLeft", "Hand on the left of the image", "grid cell, exact position against the face or body (next to which ear, cheek, chin, shoulder; touching or how far), shape (fist, open, pointing, which fingers bent), which way the knuckles or palm face"],
  ["armRight", "Arm on the right of the image", "upper arm direction, elbow (where it points, which grid cell it is in), forearm direction, foreshortening, in front of or behind the body or head"],
  ["handRight", "Hand on the right of the image", "grid cell, exact position against the face or body (next to which ear, cheek, chin, shoulder; touching or how far), shape (fist, open, pointing, which fingers bent), which way the knuckles or palm face"],
  ["legs", "Legs", "each leg as seen on the image: straight or bent, knee direction, how far apart the knees and feet are in grid cells, which leg carries the weight, hip shift"],
  ["feet", "Feet", "each foot: grid cell, toes pointing toward the viewer, outward or sideways, which foot is in front, a heel lifted off the ground or not. How the foot rests is said for the character's own shoes (heel height and shape from the character sheet), never for the video person's footwear: flat shoes in the video do not make the character's heels flat"],
  ["overlaps", "Overlaps", "every place one part passes in front of another (a hand over the face, an arm over the torso, a leg over the other), and every part hidden by another"],
  ["clothing", "Clothing", "only what this pose and motion do to each of the character's own garments: where they crease, pull or stretch (under a raised arm, at the waist), which way loose parts (collar, ties, ribbons, hems) hang or swing, which side of each shoe is seen"],
  ["shading", "Shading", "only where the shadows go in this frame: the side the light comes from, and which areas fall in shadow (under the chin and fringe, under raised arms, the turned-away side of the torso and legs, inside folds). The video person's dark clothes (stockings, shorts) are not shadows: never describe them as shading on the character"],
] as const;

type ReadingKey = (typeof READING_PARTS)[number][0];

const READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: READING_PARTS.map(([key]) => key),
  properties: Object.fromEntries(READING_PARTS.map(([key]) => [key, { type: "string" }])),
} as const;

/** A reading in the current format: the first line is the first part's label (older readings were one paragraph). */
export const isFrameSpec = (text: string) => text.startsWith(`${READING_PARTS[0][1]}:`);

/**
 * The video frame read by Muse Spark once per frame into a specification of everything the
 * drawing must show in this one frame: pose part by part in grid cells, face and expression,
 * where the hair swings, how the garments crease, where the shadows fall. It sees the frame on
 * the same measuring grid as the generator, the character sheet (so it names the character's own
 * garments) and the frame before (which way things move). It never says how anything looks
 * (colours, line work, rendering, design): the drawing takes all of that from the character sheet,
 * never from the video. Sides as the viewer sees them.
 */
export async function describeFrame(input: { readonly frame: Buffer; readonly before: Buffer | null; readonly character: Buffer; readonly description: string; readonly measured?: string; readonly signal?: AbortSignal }): Promise<string> {
  const config = requireMetaConfig();
  const started = Date.now();
  const image = (png: Buffer) => ({ type: "input_image" as const, image_url: `data:image/png;base64,${png.toString("base64")}`, detail: "high" as const });
  const instructions = `You write the drawing specification for ONE frame of a rotoscoped hand-drawn anime animation. An illustrator will redraw the character of Image 1 in exactly this frame, and will only get your words, a pose mannequin and a greyscale copy of the frame, so everything you leave out comes out wrong.
Image 1: THE CHARACTER to draw (design: ${input.description}).
Image 2: THE VIDEO FRAME to copy, on a measuring grid: columns A–H from left to right, rows 1–12 from top to bottom, cells of 128 px. Name positions as grid cells ("the fist is in C4, touching the cheek").${input.before ? "\nImage 3: the video frame just BEFORE it, only to tell which way the head, arms, hair and clothes are moving. Describe Image 2, never Image 3." : ""}
For each part write one to three dense, concrete sentences, as measured as you can: angles in degrees, grid cells, which side, touching or how far. ${READING_PARTS.map(([key, label, what]) => `${key} (${label}): ${what}.`).join(" ")}
${input.measured ? `The video's joints, measured (exact; your arm descriptions must agree with these numbers — an elbow measured BENT is never "straight" or "nearly straight"): ${input.measured}\n` : ""}Hands: describe the fingers only as far as you can clearly see them; never call fingers spread unless the gaps between them are plainly visible.
Sides: ALWAYS as the viewer sees the picture ("on the left of the image", "the hand on the right of the image"), never the person's own left or right. If a part is hidden, say so and say what covers it.
Describe ONLY position, motion and gesture: where things are, which way they point, swing, crease or are lit. NEVER describe how anything looks — no colours, no line weight or line colour, no rendering or shading style, no face, hair or clothing design, no body proportions — even when the video shows it: the illustrator takes the whole look of the character from Image 1, never from the video, and the video's colours and drawing style must not reach the drawing. Hair, clothing and shading say what THIS frame's pose and motion do to the CHARACTER's own hair and garments (Image 1). Never mention a garment or accessory the character doesn't have.
English, no preamble, no hedging, no "appears to" or "seems".`;
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions,
      reasoning: { effort: "medium" },
      input: [{ type: "message", role: "user", content: [image(input.character), image(input.frame), ...(input.before ? [image(input.before)] : [])] }],
      text: { format: { type: "json_schema", name: "rotoscope_frame_spec", strict: true, schema: READING_SCHEMA } },
    }, { signal: input.signal }), { signal: input.signal }));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    if (response.status !== "completed" || !response.output_text) throw new Error("Muse Spark did not finish reading the frame");
    const parts = JSON.parse(response.output_text) as Record<ReadingKey, string>;
    return READING_PARTS.map(([key, label]) => `${label}: ${parts[key].trim()}`).join("\n");
  } catch (error) {
    throw metaError(error, "frame description");
  }
}

/**
 * The pose of ONE video frame in a few plain sentences, written by Muse Spark from that frame alone:
 * where the arms, hands, head and legs are and what the face does, sides as the viewer sees them.
 * Nothing of how anything looks, and nothing of any other frame.
 */
export async function describeMotion(input: { readonly frame: Buffer; readonly signal?: AbortSignal }): Promise<string> {
  const config = requireMetaConfig();
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions: "Describe the pose of the person in this video frame in two to four plain English sentences for an illustrator who will redraw another character in the same pose. Say where each arm and hand is and how it is held (open, fist, pointing, which way the palm faces), the head tilt and gaze, the expression, and how the legs and feet stand. Sides always as the viewer sees the picture (\"the arm on the left of the image\"), never the person's own left or right. Pose only: never clothes, colours, hair design, line style or body shape. No preamble, no hedging.",
      reasoning: { effort: "low" },
      input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${input.frame.toString("base64")}`, detail: "high" }] }],
    }, { signal: input.signal }), { signal: input.signal }));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    const text = response.output_text.trim();
    if (!text) throw new Error("Muse Spark returned no description");
    return text;
  } catch (error) {
    throw metaError(error, "frame pose note");
  }
}

/** A director's note on an earlier drawing of this frame: red pencil marks over it and a comment. */
export type Correction = { readonly marked: Buffer; readonly comment: string };

export type FrameInput = {
  readonly character: Buffer;
  readonly description: string;
  /** The character sheet's art style sheet (describeStyle); absent for a run that has none. */
  readonly style?: string | null;
  /** Pose skeleton on the canvas, with the measuring grid and the target lines. */
  readonly guide: Buffer;
  /**
   * The pose mannequin (mannequin.ts) on the canvas, with the same grid and target lines: shown
   * instead of the skeleton guide when there is one, the reference Muse Image follows best.
   */
  readonly mannequin?: Buffer | null;
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
  /** Each arm's bone angles and elbow bend in degrees on the video's joints (measureArms); exact, so it wins over any reading. */
  readonly measured?: string;
  /** The run's colour palette (colour.ts): named swatches as a picture, and the same in words. */
  readonly palette?: { readonly image: Buffer; readonly text: string } | null;
  /** Every joint, limb length and the head size in grid cells (body-map.ts bodySpec). */
  readonly bodyMap: string;
  /** The video frame's face in screen terms (body-map.ts describeFace). */
  readonly face: string;
  /** This frame's specification read off the video frame by Muse Spark (describeFrame); empty when unavailable. */
  readonly reading?: string;
  readonly correction: Correction | null;
  readonly feedback: readonly string[];
  /** What this run's rejected attempts taught (lessons.ts lessonLines). */
  readonly lessons?: readonly string[];
  /** The character's real height and weight in words (measuresText); absent when nobody gave them. */
  readonly body?: string | null;
  readonly signal?: AbortSignal;
};

/** The line every drawing's prompt carries when the character's height and weight are known. */
export const bodyLine = (body: string) => `Body: the character is ${body}. Draw that height and that build, exactly as the character sheet shows it: never slimmer, heavier, taller or shorter, and never the video person's body.`;

/** What every generator gets for one frame: the same images in the same order and the same prompt. */
export function framePrompt(input: FrameInput): { prompt: string; references: ImageReference[] } {
  const pose = input.mannequin
    ? { png: input.mannequin, role: `${MANNEQUIN_ROLE} Dashed green line = top of the hair, solid green line = soles of the shoes, vertical dashed green line = centre of the hips.` }
    : { png: input.guide, role: "THE POSE SKELETON on the character's own proportions, at the exact position and size to draw, over a measuring grid (columns A–H, lines numbered 0–12, cells of 128 px). Red limbs are the subject's right arm and leg, blue limbs the left ones, green = torso, neck and head (the green arc is the top of the skull, the green curve the jaw). Dashed green line = top of the hair, solid green line = soles of the shoes, vertical dashed green line = centre of the hips." };
  const references: ImageReference[] = [
    { png: input.character, role: "THE CHARACTER, the immutable identity reference: redraw exactly this character. Everything about how the drawing LOOKS comes from this image: face, eyes and their exact colour, hair, every garment with its colours and every detail on it (trim, embroidery, closures, slits), shoes with their heel height, skin tone, line weight and colour, shading style, level of detail, and the body build — shoulder, bust, waist, hip, thigh and calf widths against the head. Limb lengths come from Image 2 and the measurements below, not from this sheet's pose." },
    pose,
    { png: input.sourceGrey, role: "THE VIDEO FRAME to rotoscope (greyscale), over the same grid. Take from it ONLY the motion: pose, hand shapes, head tilt and turn, expression, hair swing, creases and shadows, as the frame specification below spells out. Take NOTHING of its look: it is a different person, and their clothes, colours, line weight, face, hair and proportions never reach the drawing." },
    ...(input.previous ? [{ png: input.previous, role: "THE PREVIOUS FRAME of this animation over the same grid, for consistency ONLY: keep the line weight, colours, head size and limb lengths identical to it. Where it differs from Image 1 (body build, thigh and calf width, outfit, trim, embroidery, closures, shoes, skin), Image 1 wins: never copy a difference or a lost detail forward, draw it as Image 1 has it. Its pose is the OLD pose — do NOT copy its pose, expression or hair; those come from Image 2, Image 3 and the frame specification." }] : []),
    ...(input.anchor ? [{ png: input.anchor, role: "THE STYLE ANCHOR: the first approved frame of this animation, which fixes its line work. Match its outlines (weight and colour) and its cel rendering. Never render more polished, glossier or softer than this drawing. Its pose is NOT the pose to draw, and its body build, outfit and design never override Image 1: if it lost or simplified a detail Image 1 has (trim, embroidery, closures, thigh width), draw that detail as Image 1 has it." }] : []),
    ...(input.correction ? [{ png: input.correction.marked, role: "AN EARLIER DRAWING OF THIS SAME FRAME with the director's RED pencil marks over the parts that are wrong. Keep what is not marked; redraw the marked parts as the director asks. The red marks are notes only: never draw them." }] : []),
    ...(input.palette ? [{ png: input.palette.image, role: "THE COLOUR PALETTE of the character, measured on Image 1: its main flat colours, named by the part each paints. Small accents (trim and embroidery, closures, eye colour) are not swatches: they stay exactly as in Image 1." }] : []),
  ];
  const n = (role: string) => references.findIndex((reference) => reference.role.startsWith(role)) + 1;
  const spec = input.reading && isFrameSpec(input.reading);
  const prompt = [
    // The identity line opens the prompt as it does in /characters: what to keep, written from looking at the sheet.
    identityLine(input.description),
    `Draw ONE frame of a hand-drawn anime animation: the character of Image 1, alone, in exactly the pose of Image 2 and Image 3. Every frame of this animation is different: draw THIS frame as its specification below says, line by line. Every line is mandatory.`,
    `Image 1 decides EVERYTHING about how the character looks and is drawn: colours, line weight, shading, face, hair, clothes and the build (heads-tall ratio, shoulder, bust, waist, hip, thigh and calf widths against the head, shoes and heel height). The video frame (Image 3) and its specification decide ONLY the pose, the expression and the motion of hair and clothes. Where they differ, Image 1 wins: the result is Image 1 redrawn in this pose, never slimmer, straighter or bulkier because of the pose model or the video person.`,
    input.mannequin
      ? "Pose: every joint where the mannequin has it — same grid cells, limb angles, overlaps (which arm or hand is in front) and foreshortening. The mannequin is a pose model only: its volumes are a generic dummy, NOT the character's body. Draw Image 1's body, clothes and hair over that pose, never the coloured volumes."
      : "Pose: match every limb angle, the head tilt and the hand shapes of Image 3, over the skeleton of Image 2.",
    // Kept even with a specification: its "never mirrored" is the guard against Muse Image's most frequent failure.
    `Measured pose, sides as seen in the image, never mirrored: ${input.poseText}`,
    ...(input.measured ? [`Arm angles measured on the video's joints, EXACT — they win over any word below; draw each elbow bent exactly this much: ${input.measured}`] : []),
    // The specification sees what joints can't (expression, hair, folds, shadows); the measured face is only the fallback.
    ...(spec
      ? [`FRAME SPECIFICATION, read off the video frame (sides as seen in the image; a cell like "C4" is column C, between grid lines 3 and 4):\n${input.reading}`]
      : input.reading ? [`The video frame, described by a person who watched the video (trust it for the head, eyes, mouth and hands): ${input.reading}`] : [input.face]),
    ...(input.body ? [bodyLine(input.body)] : []),
    ...(input.palette ? [`Colours (Image ${n("THE COLOUR PALETTE")}): the character's main flat colours — ${input.palette.text}. Paint each part in its colour, the same in every frame. Shadows use only the shadow tones of that same part, in the places the specification says; never a darker, greyer, warmer, cooler or tinted version of a colour, never a gradient. Accents that are not swatches (trim and embroidery, closures, eyes) stay exactly as in Image 1: never drop them or repaint them in a swatch colour.`] : []),
    `Size and placement (grid lines counted from the top, 0 to 12): the top of the hair touches grid line ${toLine(input.marks.head)}, the soles of the shoes stand on grid line ${toLine(input.marks.feet)}, the hips are centred on the vertical green line. Keep this exact size: never bigger, never smaller. Full body visible, nothing cropped; leave at least one empty grid cell above the highest hand: nothing may touch any edge of the image.`,
    // With the mannequin the joints are already placed: coordinates on top of it made the lab's results worse.
    ...(input.mannequin ? [] : [input.bodyMap]),
    input.anchor
      ? `Style: identical to Image ${n("THE STYLE ANCHOR")} (the style anchor) — the same black outlines and line weight and the same cel rendering — with the design, outfit details and level of detail of Image 1: every embroidery, trim, closure and accessory Image 1 has is drawn, even where the style anchor lost it. Shadows are flat cel shapes placed as the specification says. Do not upgrade the rendering: no glossy highlights, no gradient shading, no detail Image 1 doesn't have, no thinner or lost outlines.`
      : `Style: identical to Image 1 — its outlines, its colouring and shading as drawn there, its level of detail and its proportions: every embroidery, trim, closure and accessory it has is drawn. Shadows are flat cel shapes placed as the specification says. No glossy highlights, no gradient shading, no detail Image 1 doesn't have.`,
    ...(input.style ? [`ART STYLE SHEET of Image 1, the rules its drawing follows; the frame must look drawn by the same artist:\n${input.style}`] : []),
    `Background: the entire background is perfectly flat solid ${KEY_COLOR} magenta. The grid, letters, numbers, mannequin colours, skeleton and green lines are measuring aids only: do NOT draw any of them, nor any text. No floor, no cast shadow on the ground, no gradient, no border. Never use that magenta on the character (Image 1's own pink skin, blush or clothes are fine).`,
    ...(input.correction ? [`DIRECTOR'S CORRECTION for this frame (see the red marks in Image ${n("AN EARLIER DRAWING")}): ${input.correction.comment}`] : []),
    ...(input.lessons ?? []),
    ...(input.feedback.length ? [`The previous attempt at this frame was rejected. Fix: ${input.feedback.join(" ")}`] : []),
    `Check the drawing against ${spec ? "the frame specification part by part" : "Image 2 and Image 3 part by part"}: an arm or leg on the wrong side of the image, a hand in another cell or shape, a different expression or gaze, or hair falling the other way are failures.`,
  ].filter(Boolean).join("\n");
  return { prompt, references };
}

/**
 * The same references as framePrompt with a short structured prompt: one labelled line per concern,
 * the measured pose and arm angles, the design, the colours and the framing — no frame reading, no
 * body map, no repeated warnings. Strategy B of the prompt comparison (docs/focus-pipeline-repair/PHASE_04.md).
 */
export function structuredFramePrompt(input: FrameInput): { prompt: string; references: ImageReference[] } {
  const { references } = framePrompt(input);
  const n = (role: string) => references.findIndex((reference) => reference.role.startsWith(role)) + 1;
  const palette = input.palette ? n("THE COLOUR PALETTE") : 0;
  const prompt = [
    "TASK: one frame of a hand-drawn anime animation — the character of Image 1, alone, in the pose of Images 2 and 3.",
    "SOURCES: Image 1 decides the whole look (face, hair, outfit, shoes, colours, line style, proportions and body build). Image 2 is a pose model: joints and limb angles only, its volumes' thickness is not the character's. Image 3 is the video frame of a different person: motion only, nothing of its look (not their clothes, stockings or shoes).",
    "BODY: Image 1's build unchanged — shoulder, bust, waist, hip, thigh and calf widths against the head, heads-tall ratio, shoes and heel height.",
    `POSE (sides as seen in the image, never mirrored): ${input.poseText}`,
    ...(input.measured ? [`ARM ANGLES (exact): ${input.measured}`] : []),
    identityLine(input.description),
    ...(palette ? [`COLOURS (Image ${palette}): main flat colours ${input.palette!.text}. Accents (trim and embroidery, closures, eyes) as in Image 1.`] : []),
    `FRAMING: hair top on grid line ${toLine(input.marks.head)}, soles on grid line ${toLine(input.marks.feet)}, hips on the vertical green line; full body, nothing touching an edge.`,
    `BACKGROUND: flat solid ${KEY_COLOR}. Draw no grid, letters, numbers, mannequin, skeleton or guide lines.`,
    "STYLE: as Image 1 — its outlines, colouring and level of detail (trim, embroidery, closures), no gradients or glossy highlights.",
  ].join("\n");
  return { prompt, references };
}

/**
 * The character's body measured by Muse Spark on the measuring grid (columns A–H, lines 0–12, cells of 128 px),
 * once per run before anything is drawn: where the landmarks stand on the sheet and how wide it is across. Kept
 * as ratios of the head's height, so it holds at any size: it is what every drawing's build is checked against.
 */
export type BuildProfile = {
  readonly headTop: number;
  readonly chin: number;
  readonly shoulders: number;
  readonly waist: number;
  readonly hips: number;
  readonly knees: number;
  readonly soles: number;
  readonly shoulderWidth: number;
  readonly waistWidth: number;
  readonly hipWidth: number;
  readonly thighWidth: number;
  readonly notes: string;
};

const BUILD_KEYS = ["headTop", "chin", "shoulders", "waist", "hips", "knees", "soles", "shoulderWidth", "waistWidth", "hipWidth", "thighWidth"] as const;
const BUILD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...BUILD_KEYS, "notes"],
  properties: { ...Object.fromEntries(BUILD_KEYS.map((key) => [key, { type: "number" }])), notes: { type: "string" } },
} as const;

/** Whether a profile's landmarks run top to bottom and its widths are plausible: a misread grid is refused, not kept. */
export function validBuild(profile: BuildProfile): boolean {
  const lines = [profile.headTop, profile.chin, profile.shoulders, profile.waist, profile.hips, profile.knees, profile.soles];
  return lines.every((line, i) => Number.isFinite(line) && line >= 0 && line <= 12 && (i === 0 || line > lines[i - 1]))
    && [profile.shoulderWidth, profile.waistWidth, profile.hipWidth, profile.thighWidth].every((width) => Number.isFinite(width) && width > 0 && width <= 8);
}

/**
 * Muse Spark reads positions off the grid to a few tenths of a cell, and an error of a few tenths on a head
 * 1.7 cells tall changes how many heads tall the character is by one. The landmark lines DWPose and the
 * silhouette already measure on the sheet therefore replace Spark's; Spark's waist stays when it lies
 * between the shoulders and the hips, and its widths and notes (nothing else measures those) are kept.
 */
export function reconcileBuild(spark: BuildProfile, measured: Pick<BuildProfile, "headTop" | "chin" | "shoulders" | "hips" | "knees" | "soles">): BuildProfile {
  const waist = spark.waist > measured.shoulders && spark.waist < measured.hips ? spark.waist : measured.shoulders + 0.6 * (measured.hips - measured.shoulders);
  return { ...spark, ...measured, waist };
}

/**
 * The profile as the reviewer reads it: every measure as a multiple of the head's height, so it is the same at any size.
 * Spark's one-line notes stay in build.json only: a second reading of the same sheet can word the build differently
 * from the identity line, and the numbers already say it.
 */
export function buildText(profile: BuildProfile): string {
  const head = profile.chin - profile.headTop;
  const heads = (cells: number) => (Math.round((cells / head) * 100) / 100).toString();
  return [
    `${heads(profile.soles - profile.headTop)} heads tall (hair top to soles)`,
    `shoulder line ${heads(profile.shoulders - profile.chin)} heads under the chin, waist ${heads(profile.waist - profile.chin)}, hips ${heads(profile.hips - profile.chin)}, knees ${heads(profile.knees - profile.chin)}`,
    `shoulders ${heads(profile.shoulderWidth)} heads wide, waist ${heads(profile.waistWidth)}, hips ${heads(profile.hipWidth)}, widest thigh ${heads(profile.thighWidth)}`,
  ].join("; ");
}

/**
 * Muse Spark reads the character sheet on the measuring grid into its BuildProfile. Landmarks are grid lines
 * counted from the top (tenths allowed); widths are in grid cells, measured across the body at that landmark.
 */
export async function profileCharacter(sheetOnGrid: Buffer, signal?: AbortSignal): Promise<BuildProfile> {
  const config = requireMetaConfig();
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions: `You measure a character's body for an animator. The image is the character on a measuring grid: columns A–H left to right, lines 0 (top edge) to 12 (bottom edge) from the top, cells of 128 px; read positions to a tenth of a cell.
Give grid LINES (numbers from the top, counted as the lines are numbered on the image) for: headTop (top of the hair), chin, shoulders (the shoulder line), waist (narrowest point of the torso), hips (widest point of the hips), knees, soles (bottom of the shoes). They must increase in that order.
Give widths in grid CELLS, measured straight across the body in the picture: shoulderWidth (edge to edge of the shoulders, arms excluded), waistWidth, hipWidth, thighWidth (the widest single thigh).
notes: one sentence, under 30 words, in plain English on the build as drawn (full or slim thighs, curvy or straight, long legs or short): never the clothes or colours.
Measure what is drawn, never what a typical body looks like.`,
      reasoning: { effort: "medium" },
      input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${sheetOnGrid.toString("base64")}`, detail: "high" }] }],
      text: { format: { type: "json_schema", name: "character_build", strict: true, schema: BUILD_SCHEMA } },
    }, { signal }), { signal }));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    const profile = JSON.parse(response.output_text) as BuildProfile;
    if (!validBuild(profile)) throw new Error("Muse Spark's measurements don't run top to bottom");
    return profile;
  } catch (error) {
    throw metaError(error, "character build profile");
  }
}

/**
 * The drawing ghosted over the video frame it was edited from, on the measuring grid: where the two
 * coincide the pose matches. A different build shows as a different thickness or length; only the
 * direction and position of the limbs, hands and head are the pose.
 */
export async function ghostOverlay(frame: Buffer, drawing: Buffer): Promise<Buffer> {
  const ghost = await sharp(drawing).ensureAlpha().linear([1, 1, 1, 0.62], [0, 0, 0, 0]).png().toBuffer();
  return withGrid(await sharp(frame).modulate({ brightness: 0.95, saturation: 0.35 }).composite([{ input: ghost }]).png().toBuffer());
}

/** The character sheet and the drawing at one scale, side by side on the same grid and the same lines: height and build, not pose. */
export async function buildPair(character: Buffer, drawing: Buffer): Promise<Buffer> {
  const half = { width: CANVAS.width / 2, height: CANVAS.height / 2 };
  const cell = async (png: Buffer) => withGrid(await sharp(await onColour(png, "#ffffff")).resize(CANVAS.width, CANVAS.height, { fit: "fill" }).png().toBuffer());
  const [left, right] = await Promise.all([cell(character), cell(drawing)]);
  return sharp({ create: { width: CANVAS.width * 2 + 16, height: CANVAS.height, channels: 3, background: "#888888" } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: CANVAS.width + 16, top: 0 }])
    .png().toBuffer().then((sheet) => sharp(sheet).resize(half.width * 2 + 8, half.height).png().toBuffer());
}

/**
 * What Muse Image gets for one frame, written like /characters edits a design: the video frame is
 * Image 1 and the character Image 2, and the person is replaced by the character, so the pose comes
 * from the picture itself. The rest is this frame alone: Muse Spark's short note of its pose
 * (describeMotion), the character's identity line, and, only on a retry or a pencil note, what was
 * wrong with the earlier attempt. Nothing from any other frame.
 */
export type SwapInput = {
  /** The video frame in colour on the canvas, at the placement the drawing must keep. */
  readonly frame: Buffer;
  readonly character: Buffer;
  /** The character sheet this `character` was rescaled from (the figure as tall as the video person), when it was. */
  readonly characterSheet?: Buffer;
  /** The character's identity line (describeCharacter); empty leaves it out. */
  readonly description: string;
  /** The character sheet's art style sheet (describeStyle); absent leaves the style to the sheet alone. */
  readonly style?: string | null;
  readonly note: string;
  readonly correction: Correction | null;
  readonly feedback: readonly string[];
  /** The character's real height and weight in words (measuresText); absent when nobody gave them. */
  readonly body?: string | null;
  /** The character drawn in other poses before the run (drawPoseSheet): how its joints bend. */
  readonly poseSheet?: Buffer | null;
  readonly signal?: AbortSignal;
};

/** How the model sheet is named to the generators and the reviewer. */
export const POSE_SHEET_ROLE = "THE CHARACTER IN OTHER POSES, a model sheet drawn from the character before this animation: how its body bends and turns. Its joints, limb lengths and limb thickness stay exactly as there; elbows and knees never bend backwards or further than there. Its poses are not the pose to draw.";

/**
 * The prompt in sections, each image with one job: Image 1 (the video frame) is the target pose, Image 2 (the
 * character) the authority on identity and on drawing style, the pose sheet how that body bends. The style sheet
 * turns "drawn like Image 2" into rules, and the priorities settle what wins when they pull apart.
 */
export function swapFramePrompt(input: SwapInput): { prompt: string; references: ImageReference[] } {
  const references: ImageReference[] = [
    { png: input.frame, role: "REFERENCE C, THE TARGET POSE: the video frame to edit. Take from it only the pose, the camera angle and framing, and the figure's size and place in the picture. Its person is replaced; nothing of their look stays." },
    { png: input.character, role: `REFERENCE A, THE CHARACTER: the authority on the character's identity (face, eyes, hair, body proportions, outfit, colours, silhouette) and on the drawing style (line work, eyes, shading, hair rendering, finish).${input.characterSheet ? " It is drawn as tall as the person of Image 1." : ""} Its own pose is not the pose to draw.`, ...(input.characterSheet ? { derivedFrom: input.characterSheet } : {}) },
    ...(input.poseSheet ? [{ png: input.poseSheet, role: POSE_SHEET_ROLE }] : []),
    ...(input.correction ? [{ png: input.correction.marked, role: "AN EARLIER DRAWING OF THIS SAME FRAME with the director's RED pencil marks over the parts that are wrong. The red marks are notes only: never draw them." }] : []),
  ];
  const n = (role: string) => references.findIndex((reference) => reference.role.startsWith(role)) + 1;
  // The checks' measurements speak of grid cells and percentages of a picture this prompt doesn't have: only what is wrong, in words.
  const fixes = input.feedback.join(" ").split(/(?<=\.)\s+/).filter((sentence) => sentence && !/\bcells?\b|\d\s?%/.test(sentence));
  const section = (title: string, lines: readonly string[]) => (lines.length ? [`${title}\n${lines.join("\n")}`] : []);
  const prompt = [
    ...section("TASK", ["Edit Image 1 into one finished frame of a 2D anime animation: replace the person with the character of Image 2, keeping Image 1's pose exactly, at the same size and position in the picture."]),
    ...section("CHARACTER IDENTITY (Image 2)", [
      ...(input.description ? [identityLine(input.description)] : []),
      "Preserve exactly: the face structure and proportions; eye size, shape and spacing; the hair silhouette, length, colour and arrangement; the body proportions (shoulder width, torso length, limb length and thickness); every garment, colour, accessory and detail; the overall silhouette. Do not redesign, beautify, exaggerate or reinterpret the character, and take nothing of the video person's clothes, colours or look.",
      ...(input.body ? [bodyLine(input.body)] : []),
      ...(input.poseSheet ? [`Joints: Image ${n("THE CHARACTER IN OTHER POSES")} shows how this character's arms, legs and torso bend: keep its limb lengths and thickness, and bend every elbow, knee and wrist only as far as a body can.`] : []),
    ]),
    ...section("ART STYLE (as Image 2 is drawn)", [
      ...(input.style ? [input.style] : []),
      "The frame must look drawn by the same artist, for the same production, as Image 2.",
    ]),
    ...section("TARGET POSE (Image 1)", [
      ...(input.note ? [input.note] : []),
      "Match the head turn and tilt, the shoulder and hip line, the torso lean and twist, every arm, elbow, wrist, hand and finger, every leg, knee, ankle and foot, the weight, the gaze and the expression, and the camera angle and framing.",
      // Muse Image's most frequent failure is a mirrored pose (framePrompt guards the same way).
      "Sides as seen in the picture, never mirrored: a limb on the left of Image 1 stays on the left of the frame, a raised arm stays the raised one, a lowered arm stays lowered.",
    ]),
    ...section("CORRECTIONS", [
      ...(input.correction ? [`Director's correction (see the red marks in Image ${n("AN EARLIER DRAWING")}): ${input.correction.comment}`] : []),
      ...(fixes.length ? [`The previous attempt at this frame was rejected. Fix: ${fixes.join(" ")}`] : []),
    ]),
    ...section("RENDERING", ["Clean hand-drawn 2D anime line art with the cel shading of Image 2. Avoid enlarged eyes, inflated faces, stretched or thickened limbs, glossy hair, artificial highlights, airbrushed gradients, plastic skin, 3D rendering and generic AI-illustration looks, unless Image 2 has them."]),
    ...section("COMPOSITION", [`One character, whole body visible; no other characters, panels, text or watermark. Background: perfectly flat solid ${KEY_COLOR} magenta everywhere; no floor, no shadow. Never use magenta on the character.`]),
    ...section("PRIORITIES when these pull apart", ["1. The character's identity and proportions, from Image 2.", "2. The pose, never mirrored, at Image 1's size and placement.", "3. The drawing style, from Image 2.", "4. Everything not asked to change stays as it is."]),
  ].join("\n\n");
  return { prompt, references };
}

/** An earlier prompt as the writer is shown it: its frame, its target pose part and, for a failed one, what was wrong. */
export type PromptExample = { readonly frame: number; readonly pose: string; readonly problems: string };

const WRITTEN_PROMPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prompt"],
  properties: { prompt: { type: "string" } },
} as const;

/**
 * Muse Spark writes Muse Image's prompt for one frame itself: it sees the very images Muse Image will get, with their
 * labels, and the studio's template prompt for this frame as the model of a well-made one (its sections, the job it
 * gives each image, its priorities and rules). It keeps the template's facts (identity line, art style sheet, body,
 * joints, corrections), describes the target pose in its own words from Image 1, adds what it sees that the template
 * misses, and steers clear of the mistakes earlier frames of the run were rejected for. The images stay the template's.
 */
export async function writeFramePrompt(input: {
  readonly template: { readonly prompt: string; readonly references: readonly ImageReference[] };
  /** What earlier drawings of this run were rejected for (lessonLines). */
  readonly lessons: readonly string[];
  /** Earlier prompts of this character whose drawings were approved, and those whose drawings failed (prompt-memory.ts). */
  readonly memory?: { readonly worked: readonly PromptExample[]; readonly failed: readonly PromptExample[] };
  readonly signal?: AbortSignal;
}): Promise<string> {
  const config = requireMetaConfig();
  const started = Date.now();
  const content = [
    ...input.template.references.flatMap((reference, i) => [
      { type: "input_text" as const, text: `Image ${i + 1}: ${reference.role}` },
      { type: "input_image" as const, image_url: `data:image/png;base64,${reference.png.toString("base64")}`, detail: "high" as const },
    ]),
    { type: "input_text" as const, text: `THE STUDIO'S TEMPLATE PROMPT FOR THIS FRAME:\n${input.template.prompt}` },
    ...(input.lessons.length ? [{ type: "input_text" as const, text: `WHAT EARLIER DRAWINGS OF THIS ANIMATION WERE REJECTED FOR:\n${input.lessons.join("\n")}` }] : []),
    ...(input.memory?.worked.length ? [{ type: "input_text" as const, text: `TARGET POSE PARTS THAT WORKED for this character before (their drawings were approved). Learn how they say things; their poses are other frames', never copy them:\n${input.memory.worked.map((entry) => `- frame ${entry.frame}: ${entry.pose}`).join("\n")}` }] : []),
    ...(input.memory?.failed.length ? [{ type: "input_text" as const, text: `TARGET POSE PARTS THAT FAILED for this character before, with what was wrong in the drawing. Avoid what most likely caused it:\n${input.memory.failed.map((entry) => `- frame ${entry.frame}: ${entry.pose}\n  Wrong: ${entry.problems}`).join("\n")}` }] : []),
  ];
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions: `You write the prompt for Muse Image, an image model that edits Image 1 (a frame of a video) by replacing its person with the character of Image 2, in the same pose and at the same size, for a rotoscoped 2D anime animation. Muse Image gets exactly the labelled images above and then your prompt.
The studio's template prompt is your model of a well-made prompt: learn from it and keep its sections in capitals (TASK, CHARACTER IDENTITY, ART STYLE, TARGET POSE, CORRECTIONS when it has them, RENDERING, COMPOSITION, PRIORITIES), the job it gives each image, its priorities and its rules. Then write a better one for THIS frame:
- Keep every fact the template states word for word where it matters: the identity line, the art style sheet, the body, the joints line, any correction. Never add a garment, colour or detail that is not in Image 2.
- Write TARGET POSE yourself from looking at Image 1: the head turn and tilt, the gaze and expression, each arm and hand, each leg and foot, sides as seen in the picture (left of the image, right of the image), never mirrored. Be concrete about what is raised, lowered, bent or straight, and where each hand is against the head or body.
- Add what you see that the template misses and that decides this frame: what the character's own clothes and hair do in this pose, which limb passes in front of which.
- Never describe the video person's look (their clothes, colours, face, hair): only their pose.
- Steer clear of the mistakes listed from earlier drawings, in plain words: never mention checks, grid cells or percentages.
- Keep the background rule exactly: perfectly flat solid magenta (#FF00FF) everywhere, never on the character, one character, whole body visible.
Plain text, in English, under 450 words.`,
      reasoning: { effort: "medium" },
      input: [{ type: "message", role: "user", content }],
      text: { format: { type: "json_schema", name: "frame_prompt", strict: true, schema: WRITTEN_PROMPT_SCHEMA } },
    }, { signal: input.signal }), { signal: input.signal }));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    if (response.status !== "completed" || !response.output_text) throw new Error("Muse Spark did not finish the prompt");
    const written = (JSON.parse(response.output_text) as { prompt: string }).prompt.trim();
    if (written.length < 200) throw new Error("Muse Spark wrote no usable prompt");
    // The key colour is what the cut-out depends on: never left to the writer.
    return /magenta|#FF00FF/i.test(written) ? written : `${written}\n\nBackground: perfectly flat solid ${KEY_COLOR} magenta everywhere; no floor, no shadow. Never use magenta on the character.`;
  } catch (error) {
    throw metaError(error, "frame prompt");
  }
}

/** Muse Image's edit of the video frame into the character, on the canvas. */
export async function drawSwap(built: { readonly prompt: string; readonly references: ImageReference[] }, signal?: AbortSignal): Promise<Buffer> {
  const draw = () => generateImage({ prompt: built.prompt, references: built.references, size: `${CANVAS.width}x${CANVAS.height}`, action: "edit", signal });
  // Muse Image's content filter sometimes declines an edit of a person's picture and accepts the same request a moment
  // later (seen on frames 1 and 6 of one run): nothing was drawn or billed, so the same request goes once more before
  // the run stops on it.
  const image = await draw().catch((error: unknown) => {
    if (error instanceof AppError && error.code === "image_blocked" && !signal?.aborted) return draw();
    throw error;
  });
  return toCanvas(image.png);
}

/** Muse Image's drawing of one frame, on the canvas. */
export async function drawFrame(input: FrameInput): Promise<Buffer> {
  const { prompt, references } = framePrompt(input);
  const image = await generateImage({ prompt, references, size: `${CANVAS.width}x${CANVAS.height}`, signal: input.signal });
  return toCanvas(image.png);
}

/**
 * Muse Image closing the cuts of the character rig's drawing of this frame: the rig puts every
 * limb exactly where the video has it, but deforming cut-out pieces can leave gaps, torn edges or
 * doubled outlines where they meet (wrists, elbows, shoulders). An edit of that drawing, never a
 * new one, so the pose it got right stays.
 */
export async function healFrame(input: { readonly drawing: Buffer; readonly character: Buffer; readonly description: string; readonly problem?: string; readonly signal?: AbortSignal }): Promise<Buffer> {
  const references: ImageReference[] = [
    { png: await onColour(input.drawing, KEY_COLOR), role: "THE DRAWING TO EDIT: this frame of the animation, already in its final pose, size and position, assembled from cut-out pieces." },
    { png: input.character, role: "THE CHARACTER SHEET: only to know how a missing piece of skin, cloth or outline looks." },
  ];
  const prompt = [
    "Edit Image 1. It is assembled from cut-out pieces, and where the pieces meet (wrists, elbows, shoulders, knees, neck) there are cuts, gaps, torn or jagged edges, missing slivers, stray fragments or doubled outlines. Redraw it as one clean, continuous hand-drawn drawing: close every gap, join every limb to the next, make every outline continuous, fill missing skin or cloth with the same flat colour as around it, remove stray fragments.",
    ...(input.problem ? [`The checker found: ${input.problem}`] : []),
    "Keep EVERYTHING else exactly as it is: the same pose, every limb at the same angle and in the same place, every hand in the same place and shape, the same size and position on the canvas, the same face and expression, hair, clothes, colours and line weight. Do not move, straighten, lengthen or re-pose anything; do not add or remove fingers.",
    `Character design, for the missing pieces: ${input.description}`,
    `Background: perfectly flat solid ${KEY_COLOR} magenta everywhere, as in Image 1. Never use that magenta on the character (Image 1's own pink skin, blush or clothes are fine).`,
  ].join("\n");
  const image = await generateImage({ prompt, references, action: "edit", signal: input.signal });
  return toCanvas(image.png);
}

/** Any generator's picture stretched onto the 2:3 canvas (they all draw at 2:3). */
export const toCanvas = (png: Buffer) => sharp(png).resize(CANVAS.width, CANVAS.height, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();

const LIMBS = ["right arm (upper arm and forearm)", "right hand", "left arm (upper arm and forearm)", "left hand", "legs and feet", "head and torso"] as const;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["limbs", "sameCharacter", "identityNotes", "sameStyle", "anatomyOk", "anatomyNotes", "buildOk", "buildNotes", "clean", "cleanNotes", "correctionDone", "correctionNotes", "fix"],
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
    buildOk: { type: "boolean" },
    buildNotes: { type: "string" },
    clean: { type: "boolean" },
    cleanNotes: { type: "string" },
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
  /** The drawing keeps the character's own build and height against its measured profile (absent in older reviews). */
  buildOk?: boolean;
  buildNotes?: string;
  /** No cuts, gaps, torn edges, loose fragments or broken outlines anywhere (judged on the full-size drawing). */
  clean?: boolean;
  cleanNotes?: string;
  correctionDone: boolean;
  correctionNotes: string;
  fix: string;
};

/** Parts the joint measurement covers: when it says they match within a few degrees, it outranks the reviewer's eye. */
const MEASURED_PARTS: readonly string[] = LIMBS.filter((part) => part !== "head and torso");

/**
 * The review as a check. With `measured`, the joints already matched the video almost exactly, so a
 * reviewer who sees the arms or legs differently is noted, not obeyed: it misjudges angles at a glance.
 */
export function reviewCheck(review: Review, correction: Correction | null = null, measured = false): Check {
  const covered = new Set(review.limbs.map((limb) => limb.part));
  const overruled = measured ? review.limbs.filter((limb) => !limb.same && MEASURED_PARTS.includes(limb.part)) : [];
  const failed = [
    ...review.limbs.filter((limb) => !limb.same && !overruled.includes(limb)).map((limb) => `${limb.part}: video ${limb.source}; drawing ${limb.drawing}`),
    ...LIMBS.filter((part) => !covered.has(part)).map((part) => `${part}: not compared`),
    !review.sameCharacter && `identity: ${review.identityNotes}`,
    !review.sameStyle && "style differs from the character sheet",
    !review.anatomyOk && `anatomy: ${review.anatomyNotes}`,
    review.buildOk === false && `build: ${review.buildNotes ?? ""}`,
    review.clean === false && `cuts or fragments: ${review.cleanNotes ?? ""}`,
    correction && !review.correctionDone && `your note not done: ${review.correctionNotes}`,
  ].filter(Boolean) as string[];
  return failed.length
    ? { name: "review", passed: false, detail: failed.join(" | "), feedback: review.fix || failed.join(" ") }
    : { name: "review", passed: true, detail: `same pose part by part, same character, same style${overruled.length ? `; the joints measured the same where the reviewer saw a difference (${overruled.map((limb) => limb.part).join(", ")})` : ""}` };
}

export async function reviewFrame(input: { readonly character: Buffer; readonly pair: Buffer; readonly drawing?: Buffer; readonly previous: Buffer | null; readonly anchor?: Buffer | null; readonly correction?: Correction | null; readonly legs?: string; /** The drawing ghosted over its video frame, on the grid (ghostOverlay). */ readonly overlay?: Buffer; /** The character and the drawing at one scale (buildPair) with the character's measured profile (buildText). */ readonly build?: { readonly pair: Buffer; readonly profile: string }; /** The character in other poses (drawPoseSheet): how far its joints bend. */ readonly poseSheet?: Buffer | null; readonly signal?: AbortSignal }): Promise<Review> {
  const config = requireMetaConfig();
  const started = Date.now();
  const image = (png: Buffer) => ({ type: "input_image" as const, image_url: `data:image/png;base64,${png.toString("base64")}`, detail: "high" as const });
  const anchorImage = input.previous ? 4 : 3;
  const correctionImage = anchorImage + (input.anchor ? 1 : 0);
  // The drawing alone at full size, last: at half size beside the video a torn wrist or a loose shard is a few pixels.
  const drawingImage = correctionImage + (input.correction ? 1 : 0);
  const overlayImage = drawingImage + (input.drawing ? 1 : 0);
  const pairImage = overlayImage + (input.overlay ? 1 : 0);
  const sheetImage = pairImage + (input.build ? 1 : 0);
  const instructions = `You are the strict final checker of a rotoscoped anime animation. Image 1 is the character sheet. Image 2 shows two panels at the same scale: LEFT is a frame of the source video (a DIFFERENT person in the target pose), RIGHT is the new drawing of the character for that frame.${input.previous ? " Image 3 is the previous approved frame of the same animation." : ""}${input.anchor ? ` Image ${anchorImage} is the first approved frame of the animation: the style anchor.` : ""}
"Right" and "left" always mean the subject's own right and left (a subject facing the camera has their right arm on the viewer's left).
limbs: for each body part (${LIMBS.join("; ")}) describe in under 12 words where it is in the LEFT panel and where it is in the RIGHT panel (direction it points, bent or straight, in front of or beside the body, head tilt and torso lean), then same=true only if they match. ${input.legs ? `Measured on the video's joints, true for the LEFT panel whatever it looks like at a glance: ${input.legs} Judge the drawing's legs against that. ` : ""}Hands are judged ONLY by where the hand is and which way it points (up, down, toward the camera, across the body); finger shape, spread fingers, a pointing finger or palm orientation do not count as a difference. The character's own proportions may differ; the pose may not. Mirrored poses are wrong.${input.previous ? " Do not accept a drawing that repeats the previous frame's pose when the video pose changed." : ""}
The LEFT panel gives ONLY the pose, expression and motion; Image 1 gives the whole look. The RIGHT drawing must look like Image 1 redrawn in the LEFT panel's pose, never like the LEFT panel, even where the LEFT person resembles the character.
sameCharacter: is the RIGHT drawing the same character as Image 1 — same hair shape and colour, face and eye colour, skin tone, every clothing item and its colours? false if any of them follows the LEFT panel instead of Image 1 (a colour, a garment, the hair, the face or the body build taken from the LEFT person).
sameStyle: ${input.anchor ? `same line art and flat colouring as Image ${anchorImage}, the animation's established style, and as Image 1: same outline weight and colour, flat cel colours, same level of detail. false if the RIGHT drawing looks more polished, glossier, softer, more shaded, more detailed or more painterly than Image ${anchorImage}, or has thinner, lost or differently coloured outlines, even if it looks nicer; false too if its line work, colouring or shading follow the LEFT panel's drawing style instead.` : "same line art and flat colouring as Image 1: same outline weight and colour, same colours, same shading style. false if its line work, colouring or shading follow the LEFT panel's drawing style instead of Image 1."}
anatomyOk: no missing, extra, merged or broken limbs, hands or fingers; nothing cropped; arms, legs and head keep the character sheet's proportions (a limb clearly longer than on Image 1, or a head clearly smaller, is an anatomy error).${input.poseSheet ? ` Image ${sheetImage} is the character's model sheet in other poses: a limb longer or thinner than there, or an elbow, knee or wrist bent backwards or past what it shows, is an anatomy error.` : ""}${input.correction ? ` correctionDone: Image ${correctionImage} is an earlier drawing of this frame with the director's red pencil marks, and the director asked: "${input.correction.comment.replace(/"/g, "'")}". true only if the RIGHT drawing fixes exactly that in the marked places.` : " correctionDone: always true (no correction was asked)."}
clean: ${input.drawing ? `Image ${drawingImage} is the RIGHT drawing alone at full size, on grey. Inspect it closely, part by part — head and neck, each shoulder, each elbow, each wrist and hand, the waist, between the legs, each knee and ankle. ` : ""}true only if it is one clean, continuous drawing: false for ANY cut or slit across a limb, a gap or step in an outline, a torn, jagged or doubled edge, a sliver of missing skin or cloth, a loose fragment or stray black mark floating beside or between body parts, or a limb that looks pasted on. These come from cut-out pieces and are easy to miss: look for them before answering. cleanNotes: where each one is, sides as seen in the image; empty when clean.
${input.overlay ? `Image ${overlayImage} is the new drawing ghosted over the video frame it was made from, on the measuring grid: where the ghost and the frame's person coincide the pose matches. The two bodies differ in build ON PURPOSE (the character is not the video person): thickness, limb length and a different outfit are never pose errors. Judge only where each limb, hand and the head point and sit: an arm or hand on the other side, a bent elbow that is straight, a hand on the wrong cell is a pose error (limbs: same=false). ` : ""}${input.build ? `buildOk: Image ${pairImage} shows the character sheet (LEFT) and the new drawing (RIGHT) at the same scale on the same grid. The character's measured build, as multiples of its head's height: ${input.build.profile}. buildOk=false only if the drawing's body clearly departs from that build in height (heads tall), shoulder, waist, hip or thigh width, or leg length (a slimmer, shorter, stockier or longer body than the character's); the pose differs and does not count. buildNotes: what differs, under 25 words. ` : "buildOk is true and buildNotes empty. "}Be honest; do not praise, do not assume. Notes under 25 words, English. fix: one or two imperative sentences telling the illustrator exactly what to change, naming sides as the viewer sees them ("the arm on the left of the image") because illustrators confuse the subject's left and right; empty when everything matches.`;
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions,
      reasoning: { effort: "medium" },
      input: [{ type: "message", role: "user", content: [image(input.character), image(input.pair), ...(input.previous ? [image(input.previous)] : []), ...(input.anchor ? [image(input.anchor)] : []), ...(input.correction ? [image(input.correction.marked)] : []), ...(input.drawing ? [image(input.drawing)] : []), ...(input.overlay ? [image(input.overlay)] : []), ...(input.build ? [image(input.build.pair)] : []), ...(input.poseSheet ? [image(input.poseSheet)] : [])] }],
      text: { format: { type: "json_schema", name: "rotoscope_review", strict: true, schema: REVIEW_SCHEMA } },
    }, { signal: input.signal }), { signal: input.signal }));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_review", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    if (response.status !== "completed" || !response.output_text) throw new Error("Muse Spark did not finish the review");
    return JSON.parse(response.output_text) as Review;
  } catch (error) {
    throw metaError(error, "frame review");
  }
}

/**
 * The character drawn in four other poses on one landscape sheet, before anything is animated: a reference for how
 * its arms, legs and torso bend (elbows and knees never past where they can go, limbs never longer or thinner), shown
 * to Muse Image with every frame and to the reviewer. One Muse Image drawing per run.
 */
export async function drawPoseSheet(input: { readonly character: Buffer; readonly description: string; readonly body: string | null; readonly signal?: AbortSignal }): Promise<Buffer> {
  const references: ImageReference[] = [{ png: input.character, role: "THE CHARACTER: draw exactly this character, nobody else." }];
  const prompt = [
    "Draw a character model sheet of the character of Image 1: four full-body views of it side by side in one row, evenly spaced, every view whole from the top of the hair to the soles and at the same size, on a plain white background. No text, no numbers, no grid, no panel borders, no floor shadow.",
    "The four poses, left to right: 1) both arms raised straight above the head, facing the viewer; 2) one hand behind the head with the elbow out, the other hand on the hip, facing the viewer; 3) a low wide stance with both knees bent and both arms stretched out to the sides; 4) a three-quarter view mid-stride, one knee lifted, arms swinging.",
    identityLine(input.description),
    ...(input.body ? [bodyLine(input.body)] : []),
    "In every view: the same face, hair, outfit, shoes, colours, line work, shading and level of detail as Image 1, and the same body build. Arms and legs keep their length and thickness from view to view; elbows, knees and wrists bend only the way and as far as a real body can, never backwards.",
  ].join("\n");
  const image = await generateImage({ prompt, references, size: "1536x1024", signal: input.signal });
  return image.png;
}

/** What Muse Spark makes of a frame's prompt and the drawing it gave (analyzePrompt). */
export type PromptAnalysis = {
  readonly summary: string;
  readonly issues: readonly { readonly problem: string; readonly cause: string; readonly fix: string }[];
  /** The prompt rewritten to fix those issues; the images stay the same. */
  readonly prompt: string;
};

const PROMPT_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "issues", "prompt"],
  properties: {
    summary: { type: "string" },
    issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["problem", "cause", "fix"], properties: { problem: { type: "string" }, cause: { type: "string" }, fix: { type: "string" } } } },
    prompt: { type: "string" },
  },
} as const;

/**
 * Muse Spark reads a frame's prompt with the images it goes with and, when there is one, the drawing an earlier prompt
 * gave and what the checks measured on it: which words most likely caused each problem, and the prompt rewritten to
 * fix them. For trial and error in the debug panel; nothing is drawn.
 */
export async function analyzePrompt(input: {
  readonly prompt: string;
  /** The labelled images the prompt is sent after, in order. */
  readonly references: readonly { readonly png: Buffer; readonly role: string }[];
  readonly drawing: Buffer | null;
  readonly checks: readonly string[];
  readonly signal?: AbortSignal;
}): Promise<PromptAnalysis> {
  const config = requireMetaConfig();
  const started = Date.now();
  const image = (png: Buffer) => ({ type: "input_image" as const, image_url: `data:image/png;base64,${png.toString("base64")}`, detail: "high" as const });
  const content = [
    ...input.references.flatMap((reference, i) => [{ type: "input_text" as const, text: `Image ${i + 1}: ${reference.role}` }, image(reference.png)]),
    ...(input.drawing ? [{ type: "input_text" as const, text: "THE DRAWING the image model made from these images and a prompt (on grey):" }, image(input.drawing)] : []),
    { type: "input_text" as const, text: `THE PROMPT:\n${input.prompt}` },
    ...(input.checks.length ? [{ type: "input_text" as const, text: `WHAT THE CHECKS MEASURED ON THE DRAWING:\n${input.checks.join("\n")}` }] : []),
  ];
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions: `You debug prompts for Muse Image, an image model that edits Image 1 (a frame of a video) by replacing its person with the character of Image 2, in the same pose and at the same size, on a flat magenta background, for a rotoscoped anime animation. You get the labelled images, the prompt, and${input.drawing ? " the drawing the model made with the checks measured on it" : " no drawing yet"}.
summary: one or two sentences on how well ${input.drawing ? "the drawing follows the images and the prompt" : "the prompt states what the images need"}: pose, size and placement, the character's look and build, style, background.
issues: each concrete problem (${input.drawing ? "in the drawing, or" : ""} in the prompt: a missing instruction, a contradiction, an ambiguous side, words that invite the wrong body or style), the words of the prompt that most likely cause it (quote them, or say what is missing), and the change that fixes it. Most important first; at most 6; none when nothing is wrong.
prompt: the whole prompt rewritten with those fixes, in English, same structure and image numbering, keeping every line that works. Never mention the checks, grid cells or percentages: the model doesn't see them. Under 400 words.`,
      reasoning: { effort: "medium" },
      input: [{ type: "message", role: "user", content }],
      text: { format: { type: "json_schema", name: "prompt_analysis", strict: true, schema: PROMPT_ANALYSIS_SCHEMA } },
    }, { signal: input.signal }), { signal: input.signal }));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    if (response.status !== "completed" || !response.output_text) throw new Error("Muse Spark did not finish the analysis");
    return JSON.parse(response.output_text) as PromptAnalysis;
  } catch (error) {
    throw metaError(error, "prompt analysis");
  }
}
