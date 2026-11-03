import sharp from "sharp";
import { fromRgba, keyBackground, toRgba } from "./alpha";
import { drawSwap, fitCanvas, swapFramePrompt } from "./draw";

// The test page (/rotoscope?test=…): one drawing from a video frame and a character, with the run's own prompt
// (swapFramePrompt: the pose from the picture alone), nothing measured or kept. A way to try the prompt on any picture.

export type TestBackground = "scene" | "none";

export type TestDrawing = {
  /** The drawing on the canvas: the video's background kept ("scene"), or cut out on transparency ("none"). */
  readonly png: Buffer;
  /** The exact words and image roles Muse Image got. */
  readonly prompt: string;
};

export async function testDraw(input: {
  /** The video frame, any size: letterboxed on the canvas as the run shows it to Muse Image. */
  readonly frame: Buffer;
  /** The character as drawn for the frame (a run's scaled sheet, or an uploaded picture). */
  readonly character: Buffer;
  /** The run's sheet when `character` was rescaled from it. */
  readonly characterSheet?: Buffer;
  /** The run's identity line; empty for an uploaded character. */
  readonly description: string;
  /** The run's face close-up (likeness.ts), when the character is the run's. */
  readonly face?: Buffer | null;
  readonly background: TestBackground;
  readonly signal?: AbortSignal;
}): Promise<TestDrawing> {
  const corner = await sharp(input.frame).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const frame = await fitCanvas(input.frame, `rgb(${corner[0]},${corner[1]},${corner[2]})`);
  const built = swapFramePrompt({
    frame, character: input.character, ...(input.characterSheet ? { characterSheet: input.characterSheet } : {}),
    description: input.description, face: input.face ?? null, correction: null, feedback: [], background: input.background === "scene" ? "scene" : "key",
  });
  const drawn = await drawSwap(built, input.signal);
  const png = input.background === "scene" ? drawn : await fromRgba(keyBackground(await toRgba(drawn)).image);
  return { png, prompt: `${built.references.map((reference, i) => `Image ${i + 1}: ${reference.role}`).join("\n")}\n\n${built.prompt}` };
}
