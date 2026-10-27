import { CharacterAnalysisSchema, type CharacterAnalysis } from "../../shared/flipbook";
import { ConceptSchema } from "../../shared/schemas";
import { AppError } from "../errors";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "../ai/meta";
import { nullable } from "../ai/finish-schema";
import { recordUsage } from "../ai/usage";

// Muse Spark looks at the uploaded character and describes what is actually
// visible: orientation, framing, identity details and the action asked for.
// Those words become the identity lock repeated in every pose request. The
// output is a strict JSON schema, then Zod; unseen details stay unknown.

export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "characterCount", "subject", "facing", "view", "fullBodyVisible", "feetVisible", "background",
    "style", "hair", "clothing", "accessories", "palette", "proportions", "requestedAction", "notes",
  ],
  properties: {
    characterCount: { type: "integer" },
    subject: { type: "string" },
    facing: { type: "string", enum: ["left", "right", "front", "back", "unclear"] },
    view: { type: "string", enum: ["side", "three_quarter", "front", "back", "unclear"] },
    fullBodyVisible: { type: "boolean" },
    feetVisible: { type: "boolean" },
    background: { type: "string", enum: ["plain", "simple", "detailed"] },
    style: { type: "string" },
    hair: { type: "string" },
    clothing: { type: "string" },
    accessories: { type: "array", items: { type: "string" } },
    palette: { type: "array", items: { type: "string" } },
    proportions: { type: "string" },
    requestedAction: { type: "string", enum: ["walk", "run", "fight", "jump", "dance", "idle", "gesture", "other", "none"] },
    notes: nullable({ type: "string" }),
  },
} as const;

export const ANALYSIS_INSTRUCTIONS = `You inspect one character illustration for Focus Flipbook, a frame-by-frame animation tool, and return a JSON description. You never invent what is not visible.

Fields:
- characterCount: how many distinct characters are drawn.
- subject: ONE short English noun phrase naming the main character for an image segmentation model (1–4 words, e.g. "girl", "cartoon fox", "robot", "boy in red hoodie"). No sentence, no punctuation.
- facing: which way the character faces from the viewer's point of view ("right" = looking toward the right edge of the image).
- view: side (profile), three_quarter, front, back, or unclear.
- fullBodyVisible: true only when the whole body from the top of the head to both feet is inside the image.
- feetVisible: true only when both feet are visible.
- background: plain (flat color or transparent), simple (soft gradient or a few shapes), detailed (a scene).
- style: the illustration style in a few words (line weight, coloring, shading, e.g. "clean anime line art, cel shading, thin dark outlines").
- hair, clothing, proportions: precise visible facts for redrawing the same character (colors, lengths, which side an asymmetric element is on, head-to-body ratio). Write "not visible" for what cannot be seen.
- accessories: visible accessories, each with its color and on which side of the body it is.
- palette: up to 6 main colors of the character as #RRGGBB hex.
- requestedAction: what the user's instruction asks the character to do. "fight" for punching, boxing, shadowboxing, sparring or any fighting move. "run" for running, sprinting or jogging. "none" when the instruction names no movement.
- notes: anything that would make redrawing the same character in new poses unreliable (cropped body, heavy occlusion, several characters, very small character), in one short sentence, or null.`;

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null).map(([key, entry]) => [key, stripNulls(entry)]));
  }
  return value;
}

/** Pure: raw model text into a validated analysis, or a user-facing error. */
export function parseAnalysisOutput(text: string): CharacterAnalysis {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("analysis_invalid_output", 502, "Muse Spark returned an unreadable character analysis. Try again.");
  }
  const clean = stripNulls(raw) as Record<string, unknown> | null;
  if (clean && typeof clean === "object") {
    // Lenient where it costs nothing: a bad color or a long phrase is dropped or trimmed, not a failed run.
    if (Array.isArray(clean.palette)) clean.palette = clean.palette.filter((entry) => typeof entry === "string" && /^#[0-9a-fA-F]{6}$/.test(entry)).slice(0, 6);
    if (Array.isArray(clean.accessories)) clean.accessories = clean.accessories.filter((entry) => typeof entry === "string").map((entry: string) => entry.slice(0, 80)).slice(0, 8);
    for (const key of ["style", "hair", "proportions"] as const) if (typeof clean[key] === "string") clean[key] = (clean[key] as string).slice(0, 240);
    if (typeof clean.clothing === "string") clean.clothing = clean.clothing.slice(0, 320);
    if (typeof clean.notes === "string") clean.notes = clean.notes.slice(0, 320);
    if (typeof clean.characterCount === "number") clean.characterCount = Math.max(0, Math.min(20, Math.round(clean.characterCount)));
    if (!ConceptSchema.safeParse(clean.subject).success) clean.subject = "character";
  }
  const parsed = CharacterAnalysisSchema.safeParse(clean);
  if (!parsed.success) {
    throw new AppError(
      "analysis_invalid_output",
      502,
      "We couldn’t read the character analysis. Try again.",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  return parsed.data;
}

export async function analyzeCharacter(input: { readonly imagePng: Buffer; readonly prompt: string; readonly flipbookId: string; readonly signal?: AbortSignal }): Promise<CharacterAnalysis> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() =>
      withRetry(
        () =>
          client.responses.create(
            {
              model: config.plannerModel,
              instructions: ANALYSIS_INSTRUCTIONS,
              reasoning: { effort: "low" },
              input: [
                {
                  type: "message",
                  role: "user",
                  content: [
                    { type: "input_text", text: `Instruction: ${input.prompt}` },
                    { type: "input_image", image_url: `data:image/png;base64,${input.imagePng.toString("base64")}`, detail: "high" },
                  ],
                },
              ],
              text: { format: { type: "json_schema", name: "character_analysis", strict: true, schema: ANALYSIS_JSON_SCHEMA as unknown as Record<string, unknown> } },
            },
            { signal: input.signal },
          ),
        { signal: input.signal },
      ),
    );
    await recordUsage({
      model: config.plannerModel,
      kind: "flipbook_analyze",
      cached: false,
      ok: true,
      flipbookId: input.flipbookId,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      durationMs: Date.now() - started,
    });
    if (response.status !== "completed" || !response.output_text) {
      throw new AppError("analysis_incomplete", 502, "Muse Spark didn’t finish analyzing the character. Try again.");
    }
    return parseAnalysisOutput(response.output_text);
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: false, flipbookId: input.flipbookId, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "el análisis del personaje");
  }
}

/**
 * What may make the result unreliable, said before any drawing is paid for.
 * Returns the caveats and whether the request is supported at all.
 */
export function assessInput(analysis: CharacterAnalysis): { supported: boolean; reason: string | null; warnings: string[] } {
  if (analysis.characterCount === 0) return { supported: false, reason: "We couldn’t find a character in this image. Upload an illustration of one character.", warnings: [] };
  if (!["walk", "run", "fight", "none"].includes(analysis.requestedAction)) {
    return { supported: false, reason: "Flipbook animates walks, runs and fighting combos for now. Ask your character to walk, run or throw punches.", warnings: [] };
  }
  const warnings: string[] = [];
  if (analysis.characterCount > 1) {
    warnings.push(analysis.requestedAction === "fight"
      ? `This image shows ${analysis.characterCount} characters. Two characters fighting each other isn’t supported yet: only “${analysis.subject}” will throw punches, on its own.`
      : `This image shows ${analysis.characterCount} characters. Only “${analysis.subject}” will be animated.`);
  }
  if (!analysis.fullBodyVisible || !analysis.feetVisible) warnings.push("The full body isn’t visible. Unseen parts (like legs or feet) will be invented, so they may not match your design.");
  if (analysis.view !== "side") warnings.push("The character isn’t in side view. A clean side-view reference will be drawn first; check that it still looks like your character.");
  if (analysis.background === "detailed") warnings.push("The background is detailed. The character will be cut out; edges may need checking.");
  if (analysis.notes) warnings.push(analysis.notes);
  return { supported: true, reason: null, warnings: warnings.map((warning) => warning.slice(0, 240)).slice(0, 6) };
}
