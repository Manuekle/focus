import { readFile } from "node:fs/promises";
import { type CharacterAnalysis, type FlipbookDirection } from "../../shared/flipbook";
import { AppError } from "../errors";
import { extractSubject, MeasureSchema, type Measure } from "./frame-alignment";
import { generateImage, type GeneratedImage } from "./muse-image";
import { referencePrompt, scenePrompt } from "./pose-planning";
import { flipbookFiles, readJsonFile, writeAtomic } from "./store";

// The character anchor. Every drawing is made from one immutable reference
// image: the upload itself when it already is a usable side view, otherwise
// one clean side-view redraw made once and reused. A redraw never becomes the
// reference for the next one, so the cycle cannot drift away from it.

export const REFERENCE_SIZE = "1024x1536";

/** Whether the upload can anchor a side-view walk as it is. */
export function decideReference(analysis: CharacterAnalysis): { kind: "original" | "clean"; reason: string } {
  if (analysis.view === "side" && analysis.fullBodyVisible && analysis.feetVisible && analysis.background !== "detailed") {
    return { kind: "original", reason: "Your illustration is already a full-body side view, so it is the reference." };
  }
  const why = analysis.view !== "side" ? "isn’t in side view" : !analysis.fullBodyVisible || !analysis.feetVisible ? "doesn’t show the full body" : "has a detailed background";
  return { kind: "clean", reason: `Your illustration ${why}, so a clean full-body side view was drawn from it first.` };
}

export async function drawCleanReference(input: {
  readonly sourceFlat: Buffer;
  readonly analysis: CharacterAnalysis | null;
  readonly direction: FlipbookDirection;
  readonly flipbookId: string;
  readonly signal?: AbortSignal;
}): Promise<GeneratedImage> {
  return generateImage({
    prompt: referencePrompt(input.analysis, input.direction),
    references: [{ png: input.sourceFlat, role: "the original character illustration (identity reference)." }],
    size: REFERENCE_SIZE,
    flipbookId: input.flipbookId,
    signal: input.signal,
  });
}

/** Stores a reference image and its measurements (for color checks). A failed cut-out is a caveat, not a failure. */
export async function storeReference(input: {
  readonly flipbookId: string;
  readonly version: string;
  /** What the models receive: opaque. */
  readonly png: Buffer;
  /** What the character is cut out of; the upload with its alpha when it had one. */
  readonly measureFrom?: Buffer;
  readonly concept: string;
  readonly allowAlpha: boolean;
  readonly signal?: AbortSignal;
}): Promise<{ measure: Measure | null }> {
  await writeAtomic(flipbookFiles.reference(input.flipbookId, input.version), input.png);
  try {
    const { measure } = await extractSubject({ png: input.measureFrom ?? input.png, concept: input.concept, flipbookId: input.flipbookId, allowAlpha: input.allowAlpha, signal: input.signal });
    await writeAtomic(flipbookFiles.referenceMeasure(input.flipbookId, input.version), JSON.stringify(measure));
    return { measure };
  } catch (error) {
    if (error instanceof AppError && error.code === "canceled") throw error;
    return { measure: null };
  }
}

export async function readReference(flipbookId: string, version: string): Promise<{ png: Buffer; measure: Measure | null }> {
  const png = await readFile(flipbookFiles.reference(flipbookId, version)).catch(() => null);
  if (!png) throw new AppError("reference_missing", 409, "The character reference is missing. Choose a reference again.");
  const measure = await readJsonFile(flipbookFiles.referenceMeasure(flipbookId, version), (value) => MeasureSchema.parse(value));
  return { png, measure };
}

/** The uploaded scene without the character: one background plate, generated once. */
export async function drawScenePlate(input: { readonly sourceFlat: Buffer; readonly analysis: CharacterAnalysis | null; readonly width: number; readonly height: number; readonly flipbookId: string; readonly signal?: AbortSignal }): Promise<GeneratedImage> {
  const landscape = input.width >= input.height;
  return generateImage({
    prompt: scenePrompt(input.analysis),
    references: [{ png: input.sourceFlat, role: "the original illustration, scene and character." }],
    size: landscape ? "1536x1024" : "1024x1536",
    flipbookId: input.flipbookId,
    signal: input.signal,
  });
}
