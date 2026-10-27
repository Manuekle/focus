import {
  ANIMATION_ACTIONS,
  DirectionSchema,
  FlipbookPlanSchema,
  actionSpec,
  type AnimationAction,
  type CharacterAnalysis,
  type FlipbookPlan,
  type FlipbookDirection,
} from "../../shared/flipbook";
import { AppError } from "../errors";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "../ai/meta";
import { nullable } from "../ai/finish-schema";
import { recordUsage } from "../ai/usage";

// The pose plan. The action itself (walk, run, fight, jump, wave, idle) — which eight phases,
// in which order, how the body rides on each — is fixed in code (shared/flipbook.ts),
// so a model can never reorder, drop or invent a phase. Muse Spark reads the
// instruction and the character analysis and returns the direction, timing
// hints and, per phase, the character-specific detail a drawing needs
// ("the scarf trails behind", "the tail swings opposite the arms").

const PLANNED = new Set<string>(ANIMATION_ACTIONS);

/** The action an analysis asks for: one Focus can animate, otherwise a walk. */
export function actionFor(analysis: Pick<CharacterAnalysis, "requestedAction">): AnimationAction {
  return PLANNED.has(analysis.requestedAction) ? analysis.requestedAction as AnimationAction : "walk";
}

export function planJsonSchema(action: AnimationAction) {
  return {
  type: "object",
  additionalProperties: false,
  required: ["direction", "motion", "drawingFps", "durationSeconds", "poses"],
  properties: {
    direction: { type: "string", enum: ["left", "right"] },
    motion: { type: "string", enum: ["in_place", "across"] },
    drawingFps: nullable({ type: "integer", enum: [8, 12] }),
    durationSeconds: nullable({ type: "integer", enum: [2, 4, 6] }),
    poses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["phase", "detail"],
        properties: {
          phase: { type: "string", enum: actionSpec(action).poses.map((pose) => pose.phase) },
          detail: { type: "string" },
        },
      },
    },
  },
  };
}

/** The walk schema, kept for callers and tests that predate run and fight. */
export const PLAN_JSON_SCHEMA = planJsonSchema("walk");

export function planInstructions(action: AnimationAction = "walk"): string {
  const spec = actionSpec(action);
  const travel = spec.travels
    ? `- motion: "across" when the instruction asks the character to move across the screen or travel somewhere, "in_place" otherwise (the ${spec.label} on the spot).`
    : `- motion: always "in_place" (a ${spec.label} stays on the spot).`;
  return `You plan a hand-drawn ${spec.label} for Focus Flipbook. Eight drawings make one complete cycle and loop forever. You never draw and never execute anything; you return JSON. Write all text fields in English, regardless of the user’s language.

The eight phases, always in this order, with their fixed body mechanics:
${spec.poses.map((pose, index) => `${index + 1}. ${pose.phase}: ${pose.constraints}`).join("\n")}

Return:
- direction: "right" or "left", the way the character faces${spec.travels ? " and moves" : ""}. Use the instruction; when it names none, use the character's current facing when it is left or right, otherwise "right".
${travel}
- drawingFps: 12 only when the instruction asks for fast, energetic or very smooth motion, 8 when it asks for slow or relaxed motion, otherwise null.
- durationSeconds: 2, 4 or 6 only when the instruction names a length, otherwise null.
- poses: exactly eight entries, one per phase in the order above. detail is at most two short sentences about THIS character in that phase: how its clothing, hair, tail, accessories or props move or hang, and anything about its build that changes the pose (short legs take shorter steps, a long coat hides the knees). Never contradict the body mechanics, never change the character's design, never mirror asymmetric details, no camera moves, no background. Use an empty string when nothing needs adding.`;
}

function describeCharacter(analysis: CharacterAnalysis): string {
  return [
    `Subject: ${analysis.subject}`,
    `Facing: ${analysis.facing}; view: ${analysis.view}`,
    `Style: ${analysis.style}`,
    `Hair: ${analysis.hair}`,
    `Clothing: ${analysis.clothing}`,
    `Accessories: ${analysis.accessories.length ? analysis.accessories.join("; ") : "none"}`,
    `Proportions: ${analysis.proportions}`,
  ].join("\n");
}

/** Pure: model text plus the fixed library into a validated plan. */
export function parsePlanOutput(text: string, analysis: CharacterAnalysis, action: AnimationAction = actionFor(analysis)): FlipbookPlan {
  const spec = actionSpec(action);
  let raw: { direction?: unknown; motion?: unknown; drawingFps?: unknown; durationSeconds?: unknown; poses?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("pose_plan_invalid", 502, "Muse Spark returned an unreadable pose plan. Try again.");
  }
  const poses = Array.isArray(raw.poses) ? raw.poses as { phase?: unknown; detail?: unknown }[] : [];
  if (poses.length !== spec.poses.length || poses.some((pose, index) => pose?.phase !== spec.poses[index].phase)) {
    throw new AppError("pose_plan_invalid", 502, `Muse Spark’s pose plan didn’t follow the eight ${spec.label} phases. Try again.`, `phases: ${poses.map((pose) => String(pose?.phase)).join(",")}`);
  }
  const direction = DirectionSchema.safeParse(raw.direction).success ? raw.direction as FlipbookDirection : analysis.facing === "left" ? "left" : "right";
  const plan = {
    action,
    direction,
    motion: raw.motion === "across" && spec.travels ? direction : "in_place",
    drawingFps: raw.drawingFps === 12 || raw.drawingFps === 8 ? raw.drawingFps : spec.drawingFps,
    durationSeconds: raw.durationSeconds === 2 || raw.durationSeconds === 6 ? raw.durationSeconds : 4,
    loop: true,
    poses: spec.poses.map((pose, index) => {
      const detail = typeof poses[index].detail === "string" ? (poses[index].detail as string).trim().slice(0, 300) : "";
      return {
        index,
        phase: pose.phase,
        label: pose.label,
        description: detail ? `${pose.constraints} ${detail}` : pose.constraints,
        relativeRootY: pose.relativeRootY,
        lift: pose.lift,
      };
    }),
  };
  const parsed = FlipbookPlanSchema.safeParse(plan);
  if (!parsed.success) {
    throw new AppError("pose_plan_invalid", 502, "We couldn’t build a valid pose plan. Try again.", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  return parsed.data;
}

export async function planPoses(input: { readonly analysis: CharacterAnalysis; readonly prompt: string; readonly flipbookId: string; readonly signal?: AbortSignal }): Promise<FlipbookPlan> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const action = actionFor(input.analysis);
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() =>
      withRetry(
        () =>
          client.responses.create(
            {
              model: config.plannerModel,
              instructions: planInstructions(action),
              reasoning: { effort: "low" },
              input: [{ type: "message", role: "user", content: [{ type: "input_text", text: `Character:\n${describeCharacter(input.analysis)}\n\nInstruction: ${input.prompt}` }] }],
              text: { format: { type: "json_schema", name: `${action}_plan`, strict: true, schema: planJsonSchema(action) as unknown as Record<string, unknown> } },
            },
            { signal: input.signal },
          ),
        { signal: input.signal },
      ),
    );
    await recordUsage({
      model: config.plannerModel,
      kind: "flipbook_plan",
      cached: false,
      ok: true,
      flipbookId: input.flipbookId,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      durationMs: Date.now() - started,
    });
    if (response.status !== "completed" || !response.output_text) {
      throw new AppError("pose_plan_incomplete", 502, "Muse Spark didn’t finish the pose plan. Try again.");
    }
    return parsePlanOutput(response.output_text, input.analysis, action);
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.plannerModel, kind: "flipbook_plan", cached: false, ok: false, flipbookId: input.flipbookId, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "pose planning");
  }
}

// ── Drawing prompts ────────────────────────────────────────────────────────

/** A flat key color far from the character's palette, so the cut-out has a clean edge. */
export function keyColorFor(analysis: CharacterAnalysis | null): { hex: string; name: string; rgb: readonly [number, number, number] } {
  const candidates = [
    { hex: "#FFFFFF", name: "pure white", rgb: [255, 255, 255] as const },
    { hex: "#00B140", name: "chroma green", rgb: [0, 177, 64] as const },
    { hex: "#FF00FF", name: "pure magenta", rgb: [255, 0, 255] as const },
  ];
  const palette = (analysis?.palette ?? []).map((hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)));
  if (!palette.length) return candidates[0];
  const distance = (rgb: readonly number[]) => Math.min(...palette.map((color) => Math.hypot(color[0] - rgb[0], color[1] - rgb[1], color[2] - rgb[2])));
  // White unless the character itself is close to white; then the farthest key.
  if (distance(candidates[0].rgb) > 90) return candidates[0];
  return [...candidates].sort((a, b) => distance(b.rgb) - distance(a.rgb))[0];
}

function identityLock(analysis: CharacterAnalysis | null): string {
  if (!analysis) return "Keep the character exactly as in the reference.";
  return [
    `The character: ${analysis.subject}.`,
    `Hair: ${analysis.hair}.`,
    `Clothing: ${analysis.clothing}.`,
    analysis.accessories.length ? `Accessories: ${analysis.accessories.join("; ")}.` : "",
    `Proportions: ${analysis.proportions}.`,
    `Art style: ${analysis.style}.`,
    analysis.palette.length ? `Palette: ${analysis.palette.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

const FRAMING = (key: string) =>
  `Framing: the whole body from the top of the head to the soles of both feet is inside the image, centered, about 78% of the image height, feet near the bottom with a clear margin; nothing is cropped. Background: one flat uniform ${key} color filling the whole image, no floor line, no cast shadow, no scenery, no motion lines, no text, no border, no frame number. Exactly one character.`;

/** The clean, side-view reference every drawing will be made from. */
export function referencePrompt(analysis: CharacterAnalysis | null, direction: FlipbookDirection): string {
  const key = keyColorFor(analysis);
  return [
    "Redraw the character from Image 1 as a clean character reference for animation.",
    identityLock(analysis),
    "Keep its design identical: same face, hairstyle, outfit, accessories and where each sits on the body (never mirror them), same colors, proportions, line art and shading.",
    `Pose: strict side view (profile), facing ${direction}, standing upright in a neutral relaxed pose, both feet flat on the ground, arms relaxed at the sides.`,
    FRAMING(`${key.name} (${key.hex})`),
  ].join("\n");
}

export function posePrompt(input: {
  readonly analysis: CharacterAnalysis | null;
  readonly plan: FlipbookPlan;
  readonly index: number;
  readonly note?: string;
  readonly hasNeighbor: boolean;
}): string {
  const pose = input.plan.poses[input.index];
  const spec = actionSpec(input.plan.action);
  const key = keyColorFor(input.analysis);
  return [
    `Draw the character from Image 1 as one drawing of a hand-drawn ${spec.label}: drawing ${input.index + 1} of ${input.plan.poses.length}, the "${pose.label}" pose.`,
    identityLock(input.analysis),
    "Only the pose changes. Keep identical: face, hairstyle, outfit, accessories and their placement on the body (never mirror asymmetric details), colors, proportions, line weight, shading, and the same camera distance and angle as Image 1.",
    input.hasNeighbor ? `Image 2 is the neighboring drawing of the same ${spec.label}: match its size, line weight and colors, but do NOT copy its pose.` : "",
    spec.travels
      ? `View: strict side view (profile), facing ${input.plan.direction}, moving toward the ${input.plan.direction} edge of the image.`
      : `View: strict side view (profile), facing ${input.plan.direction}, toward the ${input.plan.direction} edge of the image, staying on the spot.${input.plan.action === "fight" ? " Only one character: no opponent, no target, no impact effects." : ""}`,
    `Pose: ${pose.description}`,
    input.note ? `Correction requested by the animator: ${input.note}` : "",
    FRAMING(`${key.name} (${key.hex})`),
  ].filter(Boolean).join("\n");
}

/** The uploaded scene with the character removed: one stable background plate. */
export function scenePrompt(analysis: CharacterAnalysis | null): string {
  return [
    `Remove ${analysis ? `the ${analysis.subject}` : "the character"} from Image 1 completely and redraw the empty scene behind it.`,
    "Keep everything else identical: composition, perspective, colors, lighting and illustration style. Fill the area where the character was with what would naturally be behind it.",
    "No characters, no people, no animals, no text.",
  ].join("\n");
}


/**
 * A new setting for a character drawn without one. One wide side-on plate
 * with a level ground band, so the same picture works still and scrolling.
 */
export function backdropPrompt(analysis: CharacterAnalysis | null, request: string | undefined): string {
  const setting = request?.trim() || `a simple setting that suits ${analysis ? `this ${analysis.subject}` : "this character"}`;
  return [
    `Draw an empty background scene for a 2D animation: ${setting}.`,
    `Match the illustration style of Image 1${analysis?.style ? ` (${analysis.style})` : ""}: same line work, shading and color treatment, so the character from Image 1 could stand in it. Do not draw the character.`,
    "Camera: straight side-on view at the height of a person, like a side-scrolling game. A flat, level ground runs across the whole width and fills the bottom fifth of the image; the horizon is horizontal.",
    "The scene continues past both side edges: the left and right edges must line up so the picture can repeat horizontally. Nothing important sits only at the edges.",
    "No characters, no people, no animals, no text, no border.",
  ].join("\n");
}
