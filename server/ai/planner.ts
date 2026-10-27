import { readFile } from "node:fs/promises";
import {
  EditPlanSchema,
  type EditPlan,
  type EditRequest,
  type NormalizedMedia,
} from "../../shared/schemas";
import { temporalEffectsEnabled } from "../../shared/features";
import { clampFinish, type FinishPatch } from "../../shared/render";
import { TEMPORAL_BOUNDS, TriggerEventSchema } from "../../shared/temporal";
import { AppError } from "../errors";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "./meta";
import { recordUsage } from "./usage";

// Muse Spark turns a free-form instruction into a restricted EditPlan. The
// model never produces commands, paths or FFmpeg arguments: its output is a
// fixed JSON schema, then Zod, then a consistency check against the effect the
// user picked.

import { FINISH_JSON_SCHEMA, nullable } from "./finish-schema";

const V1_EFFECTS = ["selective_color", "background_blur", "spotlight", "break_frame", "motion_echo"] as const;

/**
 * Strict-mode JSON schema: every key required, optional values are nullable.
 * Time Freeze keys exist only when temporal effects are enabled, so the v1
 * request is unchanged with the flag off.
 */
export function planJsonSchema(temporal: boolean) {
  return {
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
          selection: { type: "string", enum: ["single", "all", "several"] },
          description: nullable({ type: "string" }),
        },
      },
      effect: { type: "string", enum: temporal ? [...V1_EFFECTS, "time_freeze_echo"] : [...V1_EFFECTS] },
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["intensity", "trailCount", "trailSpacingMs", "finish", ...(temporal ? TEMPORAL_KEYS : [])],
        properties: {
          intensity: nullable({ type: "number" }),
          trailCount: nullable({ type: "integer" }),
          trailSpacingMs: nullable({ type: "integer" }),
          finish: nullable(FINISH_JSON_SCHEMA),
          ...(temporal
            ? {
                triggerEvent: nullable({ type: "string", enum: TriggerEventSchema.options }),
                echoCount: nullable({ type: "integer" }),
                echoSpacingMs: nullable({ type: "integer" }),
                freezeDurationMs: nullable({ type: "integer" }),
              }
            : {}),
        },
      },
      needsClarification: { type: "boolean" },
      clarificationQuestion: nullable({ type: "string" }),
    },
  };
}

const TEMPORAL_KEYS = ["triggerEvent", "echoCount", "echoSpacingMs", "freezeDurationMs"];

/** The v1 schema, kept for callers and tests that predate temporal effects. */
export const PLAN_JSON_SCHEMA = planJsonSchema(false);

export function plannerInstructions(temporal: boolean): string {
  return `You are the edit planner of Focus, a video editor. You read one user instruction about a short video and return a JSON edit plan. You never execute anything. Write all user-facing text in English, regardless of the instruction’s language.

Supported effects (and only these):
- selective_color: the target stays in color, everything else becomes black and white.
- background_blur: the target stays sharp, everything else is blurred.
- spotlight: the background goes dark around a soft pool of light that follows the target ("spotlight", "light only the singer", "dramatic darkness").
- break_frame: the target appears to step out of an inner frame, with depth.
- motion_echo: trailing silhouettes of the moving target.${temporal ? TEMPORAL_EFFECT_LINE : ""}

The user picked an effect family in the interface. Use it as the default:
- "reality-shift" → selective_color, background_blur or spotlight (choose by the wording; default selective_color).
- "break-the-frame" → break_frame.
- "motion-echo" → motion_echo.${temporal ? '\n- "time-freeze" → time_freeze_echo.' : ""}
When the instruction explicitly asks for an effect of another family (e.g. "blur the background" while "motion-echo" is picked), follow the instruction and return that effect. Never set supported=false because of the family.

target.concept is a segmentation prompt: ONE short English noun phrase naming the visible subject (1–4 words, e.g. "skateboarder", "red car", "dog", "woman in white dress"). Never a sentence, never a command, no punctuation. Translate to English if the instruction is in another language.
Use the simplest common noun SAM can recognise visually, plus at most one visible attribute (color, clothing). Never put actions, motion or position in the concept ("jumping rock", "running man", "car on the left" are wrong; use "rock", "man", "car"); put such details in target.description instead.
target.selection:
- "all" when the user wants more than one instance of the same kind: plurals, numbers or "both" ("the two people", "both dancers", "las personas", "everyone", "all the cars"). Use the singular noun as the concept ("person").
- "several" when the user wants subjects of different kinds ("the girl and her dog"): concept names the main one; target.description tells the user, in English, to click the other subject in the video to add it.
- "single" otherwise.
target.description: a short note (in English) to tell instances apart, or null.

parameters: intensity 0–1 (default 0.8 when unspecified, or null; for spotlight it is how dark the background gets), trailCount 2–8 and trailSpacingMs 40–1000 only for motion_echo, otherwise null.${temporal ? TEMPORAL_PARAMETER_LINES : ""}
parameters.finish: optional finishing touches on top of the effect, only when the instruction asks for them, otherwise null. Each key null unless asked:
- look: "cinematic" (teal-orange film), "noir" (contrasty black and white), "warm" (golden hour), "cool" (moonlight blue), "vintage" (faded film), "vivid" (punchy color), "natural" (no grade).
- subject: "glow" (soft halo around the subject) or "outline" (clean stroke around its silhouette); accent: "white", "gold", "cyan", "magenta" or "lime"; accentStrength 0.2–1.
- vignette 0–1, grain 0–1 (film grain), letterbox true for cinematic black bars.

Set supported=false with unsupportedReason (one sentence in English) only when the request needs something outside these effects: removing or adding objects, generating new content, changing faces or identity, text, audio. A color grade, glow, vignette, grain or letterbox alone is supported: pair it with the picked family's default effect and the most prominent subject. Still fill the other fields with your best guess.
Set needsClarification=true with clarificationQuestion (one short question in English) only when nothing in the instruction or the image could be the subject. Never ask which instance the user means: when several match, the user picks them on the video.
Use the attached frame to check the subject is visible and to pick the right noun phrase.
If "Already segmented" lists a concept that names the same subject, return that exact string as target.concept: it reuses existing masks at no cost.`;
}

const TEMPORAL_EFFECT_LINE = `
- time_freeze_echo: the footage freezes on one moment while several copies of the subject from the moments just before appear over the frozen frame, then the clip plays on ("freeze time when I jump", "stop time and make copies of me", "bullet time").`;

const TEMPORAL_PARAMETER_LINES = `
For time_freeze_echo only (otherwise null): echoCount 2–6 = how many copies ("five copies of me" → 5); echoSpacingMs 80–400 only when the user describes the gap between copies; freezeDurationMs 500–3000 only when the user gives how long the freeze lasts ("freeze for two seconds" → 2000); intensity = how solid the copies look.
triggerEvent: "jump_apex" when the freeze should happen at the top of a jump or leap, "peak_motion" when it should happen at the fastest or most energetic moment, null when no moment is named. Never return a time, a frame number or a guess of when it happens: the moment is found from the tracked motion or picked by the user.
When the user means themselves ("me", "I", "myself"), target.concept is "person".`;

/** Pure: turns raw model text into a validated plan, or a user-facing error. */
export function parsePlanOutput(text: string, options: { readonly temporal?: boolean } = {}): EditPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("planner_invalid_output", 502, "Muse Spark returned an unreadable response. Try again.");
  }
  const clean = stripNulls(raw) as { parameters?: Record<string, unknown> } | null;
  // A finishing value slightly out of range is clamped, not a failed plan.
  if (clean?.parameters?.finish && typeof clean.parameters.finish === "object") clean.parameters.finish = clampFinish(clean.parameters.finish as FinishPatch);
  // So are Time Freeze numbers: "ten copies" means the most there can be.
  if (clean?.parameters) {
    for (const [key, [min, max]] of Object.entries(TEMPORAL_PLAN_BOUNDS)) {
      const value = clean.parameters[key];
      if (typeof value === "number" && Number.isFinite(value)) clean.parameters[key] = Math.round(Math.min(max, Math.max(min, value)));
    }
  }
  const parsed = EditPlanSchema.safeParse(clean);
  if (!parsed.success || (parsed.data.effect === "time_freeze_echo" && !options.temporal)) {
    throw new AppError(
      "planner_invalid_output",
      502,
      "We couldn’t turn your instruction into a valid plan. Describe the subject more clearly.",
      parsed.success ? "effect: time_freeze_echo is disabled" : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  const plan = parsed.data;
  // The instruction may name an effect outside the picked family; the job
  // then moves to that family. Choosing which instance is never a question:
  // with "all" every instance is used, otherwise the user picks on the video.
  const effect = plan.effect;
  const finish = plan.parameters.finish && Object.keys(plan.parameters.finish).length ? plan.parameters.finish : undefined;
  const { intensity, trailCount, trailSpacingMs, triggerEvent, echoCount, echoSpacingMs, freezeDurationMs } = plan.parameters;
  return {
    ...plan,
    needsClarification: plan.needsClarification && plan.target.selection !== "all",
    effect,
    // Each effect keeps only its own knobs.
    parameters:
      effect === "motion_echo"
        ? { intensity, trailCount, trailSpacingMs, finish }
        : effect === "time_freeze_echo"
          ? { intensity, triggerEvent, echoCount, echoSpacingMs, freezeDurationMs, finish }
          : { intensity, finish },
  };
}

const TEMPORAL_PLAN_BOUNDS = {
  echoCount: TEMPORAL_BOUNDS.echoCount,
  echoSpacingMs: TEMPORAL_BOUNDS.echoSpacingMs,
  freezeDurationMs: TEMPORAL_BOUNDS.freezeDurationMs,
} as const;

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
  const temporal = temporalEffectsEnabled();
  const poster = `data:image/jpeg;base64,${(await readFile(input.posterPath)).toString("base64")}`;
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() =>
      withRetry(
        () =>
          client.responses.create(
            {
              model: config.plannerModel,
              instructions: plannerInstructions(temporal),
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
              text: { format: { type: "json_schema", name: "edit_plan", strict: true, schema: planJsonSchema(temporal) } },
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
      throw new AppError("planner_incomplete", 502, "Muse Spark didn’t finish interpreting your instruction. Try again.");
    }
    return parsePlanOutput(response.output_text, { temporal });
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.plannerModel, kind: "plan", cached: false, ok: false, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "instruction interpretation");
  }
}
