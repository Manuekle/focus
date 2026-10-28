import { ANIMATION_ACTIONS, CharacterAnalysisSchema, actionSpec, type CycleAction, type CharacterAnalysis } from "../../shared/flipbook";
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
    view: { type: "string", enum: CharacterAnalysisSchema.shape.view.options },
    fullBodyVisible: { type: "boolean" },
    feetVisible: { type: "boolean" },
    background: { type: "string", enum: ["plain", "simple", "detailed"] },
    style: { type: "string" },
    hair: { type: "string" },
    clothing: { type: "string" },
    accessories: { type: "array", items: { type: "string" } },
    palette: { type: "array", items: { type: "string" } },
    proportions: { type: "string" },
    requestedAction: { type: "string", enum: ["walk", "run", "fight", "jump", "wave", "dance", "idle", "gesture", "other", "none"] },
    notes: nullable({ type: "string" }),
  },
} as const;

export const ANALYSIS_INSTRUCTIONS = `You inspect one character illustration for Focus Flipbook, a frame-by-frame animation tool, and return a JSON description. You never invent what is not visible. Write all text fields in English, regardless of the user’s language.

Fields:
- characterCount: how many distinct characters are drawn.
- subject: ONE short English noun phrase naming the main character for an image segmentation model (1–4 words, e.g. "girl", "cartoon fox", "robot", "boy in red hoodie"). No sentence, no punctuation.
- facing: which way the character faces from the viewer's point of view ("right" = looking toward the right edge of the image).
- view: side (profile), three_quarter, front, back, high (camera above the character), low (camera below the character), or unclear. Describe the source image's actual camera, independently of the camera the user requests for the animation.
- fullBodyVisible: true only when the whole body from the top of the head to both feet is inside the image.
- feetVisible: true only when both feet are visible.
- background: plain (flat color or transparent), simple (soft gradient or a few shapes), detailed (a scene).
- style: the illustration style in a few words (line weight, coloring, shading, e.g. "clean anime line art, cel shading, thin dark outlines").
- hair, clothing, proportions: precise visible facts for redrawing the same character (colors, lengths, which side an asymmetric element is on, head-to-body ratio). Write "not visible" for what cannot be seen.
- accessories: visible accessories, each with its color and on which side of the body it is.
- palette: up to 6 main colors of the character as #RRGGBB hex.
- requestedAction: what the user's instruction asks the character to do. "fight" for punching, boxing, shadowboxing, sparring or any fighting move. "run" for running, sprinting or jogging. "jump" for jumping, hopping or leaping. "wave" for waving, greeting or saying hello or goodbye with a hand. "idle" for resting in a posture, sitting, crouching, standing still, breathing, waiting or an idle loop. "dance" for dancing, choreography, rhythmic steps, hip sways and coordinated arm swings. "gesture" for other hand or arm gestures (pointing, clapping). "none" when the instruction names no movement.
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
    throw metaError(error, "character analysis");
  }
}

/**
 * What may make the result unreliable, said before any drawing is paid for.
 * Returns the caveats and whether the request is supported at all.
 */
export function assessInput(analysis: CharacterAnalysis): { supported: boolean; reason: string | null; warnings: string[] } {
  if (analysis.characterCount === 0) return { supported: false, reason: "We couldn’t find a character in this image. Upload an illustration of one character.", warnings: [] };
  if (![...ANIMATION_ACTIONS, "none"].includes(analysis.requestedAction as CycleAction)) {
    return { supported: false, reason: "Flipbook animates walks, runs, jumps, waves, idle loops, dance cycles and fighting combos. Ask your character for one of those.", warnings: [] };
  }
  const warnings: string[] = [];
  if (analysis.characterCount > 1) {
    warnings.push(analysis.requestedAction === "fight"
      ? `This image shows ${analysis.characterCount} characters. Two characters fighting each other isn’t supported yet: only “${analysis.subject}” will throw punches, on its own.`
      : `This image shows ${analysis.characterCount} characters. Only “${analysis.subject}” will be animated.`);
  }
  if (!analysis.fullBodyVisible || !analysis.feetVisible) warnings.push("The full body isn’t visible. Unseen parts (like legs or feet) will be invented, so they may not match your design.");
  if (analysis.background === "detailed") warnings.push("The background is detailed. The character will be cut out; edges may need checking.");
  if (analysis.notes) warnings.push(analysis.notes);
  return { supported: true, reason: null, warnings: warnings.map((warning) => warning.slice(0, 240)).slice(0, 6) };
}

// ── Reading an upload ──────────────────────────────────────────────────────
//
// Before anything is asked of it, Muse Spark looks at the upload once: the
// same character facts as the analysis above, plus what the picture shows as
// a whole and which supported motions would suit it. The result is kept with
// the upload, and a flipbook made from it reuses the facts instead of paying
// for a second look.

const LOOK_CHARACTER_PROPERTIES = Object.fromEntries(Object.entries(ANALYSIS_JSON_SCHEMA.properties).filter(([key]) => key !== "requestedAction"));

export const LOOK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...ANALYSIS_JSON_SCHEMA.required.filter((key) => key !== "requestedAction"), "summary", "setting", "ideas"],
  properties: {
    ...LOOK_CHARACTER_PROPERTIES,
    summary: { type: "string" },
    setting: nullable({ type: "string" }),
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "direction", "detail"],
        properties: {
          action: { type: "string", enum: ["walk", "run", "fight", "jump", "wave", "idle", "dance"] },
          direction: { type: "string", enum: ["left", "right", "in_place"] },
          detail: { type: "string" },
        },
      },
    },
  },
} as const;

const [ANALYSIS_INTRO, ANALYSIS_FIELDS] = ANALYSIS_INSTRUCTIONS.split("\n\nFields:\n");

/** The analysis brief without the user's instruction (there is none yet), plus what the picture shows and suggestions. */
export const LOOK_INSTRUCTIONS = `${ANALYSIS_INTRO.replace("and return a JSON description", "before the user has asked for anything, and return a JSON description")}

Fields:
${ANALYSIS_FIELDS.split("\n").filter((line) => !line.startsWith("- requestedAction")).join("\n")}
- summary: one short sentence saying what the picture shows, for the person who uploaded it (e.g. "A girl with horse ears running through falling leaves under a blue sky.").
- setting: the scene behind the character in a few words ("blue sky with falling green leaves"), or null when the background is plain.
- ideas: up to 3 different motions this character could do, chosen from what Focus can animate: "walk", "run", "fight" (one character shadowboxing), "jump" (a jump on the spot), "wave" (waving hello) "idle" (breathing and blinking on the spot), or "dance" (coordinated arm swings, side steps and a rhythmic bounce). Pick what suits the picture: its pose, its energy, its expression, its setting; a calm portrait suits wave or idle, an action shot suits run, jump or fight. direction: for walk and run, "left" or "right" to travel across the screen or "in_place" to stay on the spot; for fight, jump, wave, idle and dance, the side the character should face, "left" or "right" (never "in_place"). detail: 2 to 6 words of manner that fit this character ("hair and tail flowing", "sneaking, wary"), no action verb, no direction.`;

export type ImageReading = {
  readonly analysis: CharacterAnalysis;
  readonly summary: string;
  readonly setting: string | null;
  readonly ideas: readonly { action: CycleAction; direction: "left" | "right" | "in_place"; detail: string }[];
};

/** Pure: raw model text into the character facts (no action asked yet) and the suggestions. */
export function parseLookOutput(text: string): ImageReading {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AppError("analysis_invalid_output", 502, "Muse Spark returned an unreadable description of your drawing. Try again.");
  }
  const { summary, setting, ideas, ...character } = raw ?? {};
  const analysis = parseAnalysisOutput(JSON.stringify({ ...character, requestedAction: "none" }));
  const cleanIdeas = (Array.isArray(ideas) ? ideas : [])
    .filter((idea): idea is { action: string; direction: string; detail: unknown } => Boolean(idea) && typeof idea === "object")
    .filter((idea) => (ANIMATION_ACTIONS as readonly string[]).includes(idea.action) && ["left", "right", "in_place"].includes(idea.direction))
    .map((idea) => ({
      action: idea.action as CycleAction,
      // Only walks and runs travel; the others face a side.
      direction: (!actionSpec(idea.action as CycleAction).travels && idea.direction === "in_place" ? (analysis.facing === "left" ? "left" : "right") : idea.direction) as "left" | "right" | "in_place",
      detail: typeof idea.detail === "string" ? idea.detail.trim().replace(/[.\s]+$/, "").slice(0, 80) : "",
    }))
    .slice(0, 3);
  return {
    analysis,
    summary: typeof summary === "string" ? summary.trim().slice(0, 240) : "",
    setting: typeof setting === "string" && setting.trim() && analysis.background !== "plain" ? setting.trim().slice(0, 120) : null,
    ideas: cleanIdeas,
  };
}

export async function lookAtImage(input: { readonly imagePng: Buffer; readonly imageId: string; readonly signal?: AbortSignal }): Promise<ImageReading> {
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
              instructions: LOOK_INSTRUCTIONS,
              reasoning: { effort: "low" },
              input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${input.imagePng.toString("base64")}`, detail: "high" }] }],
              text: { format: { type: "json_schema", name: "image_reading", strict: true, schema: LOOK_JSON_SCHEMA as unknown as Record<string, unknown> } },
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
      flipbookId: input.imageId,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      durationMs: Date.now() - started,
    });
    if (response.status !== "completed" || !response.output_text) {
      throw new AppError("analysis_incomplete", 502, "Muse Spark didn’t finish reading your drawing. Try again.");
    }
    return parseLookOutput(response.output_text);
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: false, flipbookId: input.imageId, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "drawing description");
  }
}
