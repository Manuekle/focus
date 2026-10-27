import { z } from "zod";
import { temporalEffectsEnabled } from "../../shared/features";
import { BlurLevelSchema, FinishPatchSchema, clampFinish, type FinishPatch, type ParamsPatch, type RenderParams } from "../../shared/render";
import { PlanEffectSchema, type ChatMessage, type EffectId } from "../../shared/schemas";
import { AppError } from "../errors";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "./meta";
import { FINISH_JSON_SCHEMA, nullable } from "./finish-schema";
import { recordUsage } from "./usage";

// The AI editor: a conversation about a finished render. Muse Spark reads the
// current parameters and the request, and answers with a short reply plus a
// patch of the same bounded knobs the sliders expose. The masks never change
// here, so applying a turn is a local re-render, never a new SAM pass.

const V1_EFFECTS = ["selective_color", "background_blur", "spotlight", "break_frame", "motion_echo"] as const;
const TEMPORAL_SETTINGS = ["echoCount", "echoSpacingMs", "freezeDurationMs"] as const;

/** Strict-mode schema of one turn. Time Freeze knobs exist only with temporal effects enabled. */
export function assistantJsonSchema(temporal: boolean) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["reply", "action", "effect", "settings", "finish", "newInstruction"],
    properties: {
      reply: { type: "string" },
      action: { type: "string", enum: ["adjust", "new_edit", "none"] },
      effect: nullable({ type: "string", enum: temporal ? [...V1_EFFECTS, "time_freeze_echo"] : [...V1_EFFECTS] }),
      settings: {
        type: "object",
        additionalProperties: false,
        required: ["intensity", "darkness", "level", "background", "frameSize", "trailCount", "trailSpacingMs", "feather", ...(temporal ? TEMPORAL_SETTINGS : [])],
        properties: {
          intensity: nullable({ type: "number" }),
          darkness: nullable({ type: "number" }),
          level: nullable({ type: "string", enum: ["low", "medium", "high"] }),
          background: nullable({ type: "string", enum: ["dark", "light"] }),
          frameSize: nullable({ type: "string", enum: ["compact", "balanced", "wide"] }),
          trailCount: nullable({ type: "integer" }),
          trailSpacingMs: nullable({ type: "integer" }),
          feather: nullable({ type: "number" }),
          ...(temporal ? Object.fromEntries(TEMPORAL_SETTINGS.map((key) => [key, nullable({ type: "integer" })])) : {}),
        },
      },
      finish: FINISH_JSON_SCHEMA,
      newInstruction: nullable({ type: "string" }),
    },
  };
}

export function assistantInstructions(temporal: boolean): string {
  return `You are the AI editor inside Focus, a video editor. The user already has a finished edit of a short clip: a subject was tracked frame by frame with SAM and an effect was rendered around it. They now tell you, in a chat, what else they want. You change the edit by returning new values for a fixed set of knobs. You never execute anything.

Effects (the subject's masks work with all of them):
- selective_color: subject in color, background black and white. intensity 0.2–1 = how gray the background gets.
- background_blur: subject sharp, background blurred. level low | medium | high.
- spotlight: background dark except a soft pool of light following the subject. darkness 0.2–0.95.
- break_frame: subject steps out of an inner frame on a 1080×1350 canvas. background dark | light, frameSize compact | balanced | wide.
- motion_echo: fading trails of the subject. trailCount 2–6, trailSpacingMs 60–400, intensity 0.2–1. Best with a still camera.${temporal ? TEMPORAL_EFFECT_LINE : ""}
All effects: feather 0–4 = edge softness in px.

Finish (on top of any effect):
- look: natural | cinematic (teal-orange film) | noir (contrasty black and white, note: removes the subject's color too) | warm (golden hour) | cool (moonlight blue) | vintage (faded film) | vivid (punchy color).
- subject: none | glow (luminous halo around the subject) | outline (clean stroke around the silhouette); accent white | gold | cyan | magenta | lime; accentStrength 0.2–1.
- vignette 0–1 (darker corners), grain 0–1 (film grain), letterbox true/false (cinematic black bars).

Return:
- action "adjust" with only the knobs that must change (every other knob null). Set effect only to switch effect, else null. Interpret taste words: "more dramatic" → stronger values, darker look; "subtle" → smaller values; "undo the glow" → subject "none". Relative requests ("a bit more") move from the current value.
- action "new_edit" when the request needs a different or additional subject, or a new tracking ("now the dog", "also the car"): put a complete standalone instruction for a new edit in newInstruction (English, imperative, names the subject and the effect), all knobs null.
- action "none" for questions, greetings or anything Focus cannot do (removing objects, generating content, text, audio, changing faces, cutting or speeding the clip): explain briefly what you can do instead.
reply: one or two short, warm sentences in the user's language saying what you changed or why not. No lists, no markdown, no knob names in code style.`;
}

const TEMPORAL_EFFECT_LINE = `
- time_freeze_echo: the clip freezes on one moment and copies of the subject from just before appear over it, then it plays on. echoCount 2–6 (copies), echoSpacingMs 80–400 (gap between copies), freezeDurationMs 500–3000 (how long the freeze lasts), intensity 0.2–1 (how solid the copies look). You cannot move the moment of the freeze: when asked to, use action "none" and tell the user to drag the freeze marker on the timeline.`;

const NumberField = z.number().finite();

const AssistantOutputSchema = z.object({
  reply: z.string().trim().min(1).max(400),
  action: z.enum(["adjust", "new_edit", "none"]),
  effect: PlanEffectSchema.optional(),
  settings: z
    .object({
      intensity: NumberField.optional(),
      darkness: NumberField.optional(),
      level: BlurLevelSchema.optional(),
      background: z.enum(["dark", "light"]).optional(),
      frameSize: z.enum(["compact", "balanced", "wide"]).optional(),
      trailCount: NumberField.optional(),
      trailSpacingMs: NumberField.optional(),
      feather: NumberField.optional(),
      echoCount: NumberField.optional(),
      echoSpacingMs: NumberField.optional(),
      freezeDurationMs: NumberField.optional(),
    })
    .default({}),
  finish: z.record(z.string(), z.unknown()).default({}),
  newInstruction: z.string().trim().min(3).max(300).optional(),
});

export type AssistantTurn = {
  readonly reply: string;
  readonly action: "adjust" | "new_edit" | "none";
  readonly patch: ParamsPatch;
  readonly newInstruction?: string;
};

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null).map(([key, entry]) => [key, stripNulls(entry)]));
  }
  return value;
}

/** Pure: raw model text to a validated turn. Out-of-range numbers are clamped later, never trusted. */
export function parseAssistantOutput(text: string, options: { readonly temporal?: boolean } = {}): AssistantTurn {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("assistant_invalid_output", 502, "Muse Spark devolvió una respuesta ilegible. Vuelve a intentarlo.");
  }
  const parsed = AssistantOutputSchema.safeParse(stripNulls(raw));
  if (!parsed.success) {
    throw new AppError("assistant_invalid_output", 502, "No pudimos entender la respuesta del editor de IA. Vuelve a intentarlo.", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  const turn = parsed.data;
  // Finish keys are validated one by one: one bad value drops itself, not the turn.
  const finish: FinishPatch = {};
  for (const [key, value] of Object.entries(clampFinish(turn.finish as FinishPatch))) {
    const single = FinishPatchSchema.safeParse({ [key]: value });
    if (single.success) Object.assign(finish, single.data);
  }
  if (turn.action === "new_edit" && !turn.newInstruction) return { reply: turn.reply, action: "none", patch: {} };
  // With temporal effects off, a switch to Time Freeze is dropped, not applied.
  const effect = turn.effect === "time_freeze_echo" && !options.temporal ? undefined : turn.effect;
  return {
    reply: turn.reply,
    action: turn.action,
    patch: turn.action === "adjust" ? { effect, settings: turn.settings, finish } : {},
    newInstruction: turn.action === "new_edit" ? turn.newInstruction : undefined,
  };
}

/** The last few turns, oldest first, as plain text for the model. */
export function historyText(history: readonly ChatMessage[], limit = 8): string {
  const recent = history.slice(-limit);
  if (!recent.length) return "none";
  return recent.map((message) => `${message.role === "user" ? "User" : "Editor"}: ${message.text}${message.changes?.length ? ` [changed: ${message.changes.join(", ")}]` : ""}`).join("\n");
}

export async function assistEdit(input: {
  readonly message: string;
  readonly history: readonly ChatMessage[];
  readonly params: RenderParams;
  readonly family: EffectId;
  readonly concept: string;
  readonly media: { readonly width: number; readonly height: number; readonly durationSeconds: number };
  readonly videoId: string;
  readonly signal?: AbortSignal;
}): Promise<AssistantTurn> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const temporal = temporalEffectsEnabled();
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() =>
      withRetry(
        () =>
          client.responses.create(
            {
              model: config.plannerModel,
              instructions: assistantInstructions(temporal),
              reasoning: { effort: "low" },
              input: [
                {
                  type: "message",
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: [
                        `Clip: ${input.media.width}x${input.media.height}, ${input.media.durationSeconds.toFixed(1)} s`,
                        `Tracked subject: ${input.concept}`,
                        `Current edit: ${JSON.stringify(input.params)}`,
                        `Conversation so far:\n${historyText(input.history)}`,
                        `User: ${input.message}`,
                      ].join("\n"),
                    },
                  ],
                },
              ],
              text: { format: { type: "json_schema", name: "editor_turn", strict: true, schema: assistantJsonSchema(temporal) } },
            },
            { signal: input.signal },
          ),
        { signal: input.signal },
      ),
    );
    await recordUsage({
      model: config.plannerModel,
      kind: "assist",
      cached: false,
      ok: true,
      videoId: input.videoId,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      durationMs: Date.now() - started,
    });
    if (response.status !== "completed" || !response.output_text) {
      throw new AppError("assistant_incomplete", 502, "El editor de IA no completó la respuesta. Vuelve a intentarlo.");
    }
    return parseAssistantOutput(response.output_text, { temporal });
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.plannerModel, kind: "assist", cached: false, ok: false, videoId: input.videoId, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "el editor de IA");
  }
}
