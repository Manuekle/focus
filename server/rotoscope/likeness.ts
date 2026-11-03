import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "../ai/meta";
import { recordUsage } from "../ai/usage";
import type { Pose } from "./pose-match";

// What keeps a directly drawn frame (direct.ts) the same character in the video's pose, without checks:
//   - the face: a close-up of the sheet's face sent with every drawing (the sheet alone shows it small, and the face,
//     the eyes and the head's size drifted from frame to frame);
//   - the sides: Muse Spark compares the drawing with the frame and says when a limb's pose came out on the other side
//     of the picture (the arm raised to the head on the right instead of the left), which DWPose misses because it
//     misreads the video person's arm at the head.

/** The face close-up, kept next to the run's sheet. */
const FACE_FILE = "face.png";
/** The close-up's side, in pixels: large enough that the eyes read clearly. */
const FACE_SIZE = 768;

/**
 * The head's square on the sheet, from its own pose: centred on the nose, 2.4 jaw widths wide (hair and bun
 * included), a little more above the nose than below. Null without a nose and both ends of the jaw.
 */
export function faceBox(sheet: Pose, width: number, height: number): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null {
  const at = (index: number) => {
    const [x, y] = sheet.keypoints[index] ?? [null, null];
    return x === null || y === null ? null : [x, y] as const;
  };
  // COCO-WholeBody: 0 the nose, 23 and 39 the jaw's ends.
  const [nose, left, right] = [at(0), at(23), at(39)];
  if (!nose || !left || !right) return null;
  const size = Math.round(Math.hypot(left[0] - right[0], left[1] - right[1]) * 2.4);
  if (size < 8) return null;
  const x = Math.max(0, Math.round(nose[0] - size / 2));
  const y = Math.max(0, Math.round(nose[1] - size * 0.6));
  return { left: x, top: y, width: Math.min(size, width - x), height: Math.min(size, height - y) };
}

/** The character's face close up (face.png in the run, made once), or null when the sheet's face wasn't found. */
export async function faceReference(dir: string): Promise<Buffer | null> {
  const file = path.join(dir, FACE_FILE);
  if (existsSync(file)) return readFile(file);
  const sheetFile = path.join(dir, "character.png");
  const sheet = (JSON.parse(await readFile(path.join(dir, "character-pose.json"), "utf8")) as { frames: Pose[] }).frames[0];
  const { width = 0, height = 0 } = await sharp(sheetFile).metadata();
  const box = sheet ? faceBox(sheet, width, height) : null;
  if (!box) return null;
  const face = await sharp(sheetFile).flatten({ background: "#ffffff" }).extract(box).resize(FACE_SIZE, FACE_SIZE, { fit: "contain", background: "#ffffff", kernel: "lanczos3" }).png().toBuffer();
  await writeFile(file, face);
  return face;
}

export type SidesReading = {
  /** The arm and leg on the left of the picture, in the frame and then in the drawing. */
  readonly leftOfImage: string;
  readonly rightOfImage: string;
  /** A limb's distinctive pose came out on the other side of the picture. */
  readonly swapped: boolean;
};

const SIDES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["leftOfImage", "rightOfImage", "swapped"],
  properties: { leftOfImage: { type: "string" }, rightOfImage: { type: "string" }, swapped: { type: "boolean" } },
} as const;

/**
 * Muse Spark reads whether a drawing put a limb's pose on the other side of the picture from the video frame. On 14
 * drawn frames it found the 3 it was shown with an arm on the wrong side and called none of the 10 right ones swapped.
 */
export async function swappedSides(input: { readonly frame: Buffer; readonly drawing: Buffer; readonly signal?: AbortSignal }): Promise<SidesReading> {
  const config = requireMetaConfig();
  const started = Date.now();
  const image = (png: Buffer) => ({ type: "input_image" as const, image_url: `data:image/png;base64,${png.toString("base64")}`, detail: "high" as const });
  try {
    const response = await plannerLimiter.run(() => withRetry(() => metaClient(config).responses.create({
      model: config.plannerModel,
      instructions: `Image 1 is a frame of a video. Image 2 is a drawing of a different character that must copy the person's pose exactly as seen in the picture, never mirrored. Ignore the character's look, the background and small differences in angle.
Look only at which side of the PICTURE each limb is on (left of the image, right of the image), not the person's own left and right.
leftOfImage: in under 25 words, the arm and leg on the left of the image in Image 1, then in Image 2 (raised, bent to the head, stretched out, down, across the body, lifted leg...).
rightOfImage: the same for the right of the image.
swapped=true only when a limb's distinctive pose is on the opposite side of the picture in Image 2: the arm raised to the head is on the left of Image 1 but on the right of Image 2, or the lifted leg changed sides. A limb that is merely a bit off is not swapped.`,
      reasoning: { effort: "medium" },
      input: [{ type: "message", role: "user", content: [image(input.frame), image(input.drawing)] }],
      text: { format: { type: "json_schema", name: "rotoscope_sides", strict: true, schema: SIDES_SCHEMA } },
    }, { signal: input.signal }), { signal: input.signal }));
    await recordUsage({ model: config.plannerModel, kind: "flipbook_review", cached: false, ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    if (response.status !== "completed" || !response.output_text) throw new Error("Muse Spark did not finish reading the sides");
    return JSON.parse(response.output_text) as SidesReading;
  } catch (error) {
    throw metaError(error, "sides check");
  }
}
