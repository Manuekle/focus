import { readFile } from "node:fs/promises";
import {
  EFFECT_PLAN_EFFECTS,
  EditPlanSchema,
  type EditPlan,
  type EditRequest,
  type NormalizedMedia,
} from "../../shared/schemas";
import { AppError } from "../errors";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "./meta";
import { recordUsage } from "./usage";

// Muse Spark turns a free-form instruction into a restricted EditPlan. The
// model never produces commands, paths or FFmpeg arguments: its output is a
// fixed JSON schema, then Zod, then a consistency check against the effect the
// user picked.

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** Strict-mode JSON schema: every key required, optional values are nullable. */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["supported", "unsupportedReason", "target", "effect", "parameters", "needsClarification", "clarificationQuestion"],
  properties: {
    supported: { type: "boolean" },
    unsupportedReason: nullable({ type: "string" }),
    target: {
      type: "object",
      additionalProperties: false,
      required: ["concept", "selection", "description"],
      properties: {
        concept: { type: "string" },
        selection: { type: "string", enum: ["single", "all"] },
        description: nullable({ type: "string" }),
      },
    },
    effect: { type: "string", enum: ["selective_color", "background_blur", "break_frame", "motion_echo"] },
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["intensity", "trailCount", "trailSpacingMs"],
      properties: {
        intensity: nullable({ type: "number" }),
        trailCount: nullable({ type: "integer" }),
        trailSpacingMs: nullable({ type: "integer" }),
      },
    },
    needsClarification: { type: "boolean" },
    clarificationQuestion: nullable({ type: "string" }),
  },
} as const;

export const PLANNER_INSTRUCTIONS = `You are the edit planner of Focus, a video editor. You read one user instruction about a short video and return a JSON edit plan. You never execute anything.

Supported effects (and only these):
- selective_color: the target stays in color, everything else becomes black and white.
- background_blur: the target stays sharp, everything else is blurred.
- break_frame: the target appears to step out of an inner frame, with depth.
- motion_echo: trailing silhouettes of the moving target.

The user already picked an effect family in the interface; the plan's effect must belong to it:
- "reality-shift" → selective_color or background_blur (choose by the wording; default selective_color).
- "break-the-frame" → break_frame.
- "motion-echo" → motion_echo.

target.concept is a segmentation prompt: ONE short English noun phrase naming the visible subject (1–4 words, e.g. "skateboarder", "red car", "dog", "woman in white dress"). Never a sentence, never a command, never two different subjects, no punctuation. Translate to English if the instruction is in another language.
target.selection is "all" only when the user clearly wants every instance ("all the cars", "everyone"); otherwise "single".
target.description: a short note (in the user's language) to tell instances apart, or null.

parameters: intensity 0–1 (default 0.8 when unspecified, or null), trailCount 2–8 and trailSpacingMs 40–1000 only for motion_echo, otherwise null.

Set supported=false with unsupportedReason (one sentence in the user's language) when the request needs something outside these effects: removing or adding objects, generating new content, changing faces or identity, text, audio, color grading the whole frame, several different subjects at once. Still fill the other fields with your best guess.
Set needsClarification=true with clarificationQuestion (one short question in the user's language) only when no subject can be identified from the instruction and the image.
Use the attached frame to check the subject is visible and to pick the right noun phrase.
If "Already segmented" lists a concept that names the same subject, return that exact string as target.concept: it reuses existing masks at no cost.`;

/** Pure: turns raw model text into a validated plan, or a user-facing error. */
export function parsePlanOutput(text: string, request: Pick<EditRequest, "effect">): EditPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("planner_invalid_output", 502, "Muse Spark devolvió una respuesta ilegible. Vuelve a intentarlo.");
  }
  const parsed = EditPlanSchema.safeParse(stripNulls(raw));
  if (!parsed.success) {
    throw new AppError(
      "planner_invalid_output",
      502,
      "No pudimos convertir la instrucción en un plan válido. Nombra el sujeto con más claridad.",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  const plan = parsed.data;
  const allowed = EFFECT_PLAN_EFFECTS[request.effect];
  // The interface choice wins over the model's guess.
  const effect = allowed.includes(plan.effect) ? plan.effect : allowed[0];
  return {
    ...plan,
    effect,
    parameters:
      effect === "motion_echo"
        ? plan.parameters
        : { intensity: plan.parameters.intensity },
  };
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== null).map(([key, entry]) => [key, stripNulls(entry)]),
    );
  }
  return value;
}

export async function interpretInstruction(input: {
  readonly request: EditRequest;
  readonly posterPath: string;
  readonly media: NormalizedMedia;
  /** Concepts this video already has masks for. */
  readonly knownConcepts?: readonly string[];
  readonly signal?: AbortSignal;
}): Promise<EditPlan> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const poster = `data:image/jpeg;base64,${(await readFile(input.posterPath)).toString("base64")}`;
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() =>
      withRetry(
        () =>
          client.responses.create(
            {
              model: config.plannerModel,
              instructions: PLANNER_INSTRUCTIONS,
              reasoning: { effort: "low" },
              input: [
                {
                  type: "message",
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: `Effect family: ${input.request.effect}\nVideo: ${input.media.width}x${input.media.height}, ${input.media.durationSeconds.toFixed(1)} s\nAlready segmented: ${input.knownConcepts?.length ? input.knownConcepts.map((concept) => JSON.stringify(concept)).join(", ") : "none"}\nInstruction: ${input.request.prompt}`,
                    },
                    { type: "input_image", image_url: poster, detail: "low" },
                  ],
                },
              ],
              text: { format: { type: "json_schema", name: "edit_plan", strict: true, schema: PLAN_JSON_SCHEMA as unknown as Record<string, unknown> } },
            },
            { signal: input.signal },
          ),
        { signal: input.signal },
      ),
    );
    await recordUsage({
      model: config.plannerModel,
      kind: "plan",
      cached: false,
      ok: true,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      durationMs: Date.now() - started,
    });
    if (response.status !== "completed" || !response.output_text) {
      throw new AppError("planner_incomplete", 502, "Muse Spark no completó la interpretación. Vuelve a intentarlo.");
    }
    return parsePlanOutput(response.output_text, input.request);
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.plannerModel, kind: "plan", cached: false, ok: false, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "la interpretación");
  }
}
