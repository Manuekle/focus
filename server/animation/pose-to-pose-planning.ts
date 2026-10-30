import { z } from "zod";
import { CycleActionSchema, FlipbookPlanSchema, type CharacterAnalysis, type CycleAction, type FlipbookDirection, type FlipbookPlan } from "../../shared/flipbook";
import { CameraViewSchema, resolveCameraView, type CameraView, type ViewPreference } from "../../shared/animation-view";
import { SEQUENCE_CLOCK, type SequenceSettings } from "../../shared/sequence";
import { EaseSchema, KEY_ROLES, MAX_HOLD_TICKS, MAX_INBETWEENS, MAX_KEYS, TimingChartSchema, deformInstruction, timeline, type TimingChart } from "../../shared/timing-chart";
import { AppError } from "../errors";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "../ai/meta";
import { recordUsage } from "../ai/usage";
import { actionFor } from "./pose-planning";

// Pose-to-pose planning of a described action: the key poses and breakdowns
// with their timing chart, instead of one independent pose per tick. The
// in-betweens aren't planned as poses: they are drawn later between finished
// drawings, at the spacing the chart gives them.

export type PoseToPosePlan = {
  readonly chart: TimingChart;
  readonly overview: string;
  readonly view: CameraView;
  readonly direction: FlipbookDirection;
  readonly action: CycleAction;
};

const KeyOutput = z.object({
  role: z.enum(KEY_ROLES),
  label: z.string(),
  description: z.string(),
  hold: z.number().int(),
  deform: z.enum(["none", "squash", "stretch"]),
  deformAmount: z.number(),
  lift: z.number(),
});
const SegmentOutput = z.object({ ease: EaseSchema, inbetweens: z.number().int(), exposure: z.number().int() });
const ChartOutput = z.object({ overview: z.string().max(4000), cameraView: CameraViewSchema, direction: z.enum(["left", "right"]), keys: z.array(KeyOutput), segments: z.array(SegmentOutput) });
const chartSchema = {
  type: "object", additionalProperties: false, required: ["overview", "cameraView", "direction", "keys", "segments"],
  properties: {
    overview: { type: "string" },
    cameraView: { type: "string", enum: CameraViewSchema.options },
    direction: { type: "string", enum: ["left", "right"] },
    keys: { type: "array", items: { type: "object", additionalProperties: false, required: ["role", "label", "description", "hold", "deform", "deformAmount", "lift"], properties: { role: { type: "string", enum: KEY_ROLES }, label: { type: "string" }, description: { type: "string" }, hold: { type: "integer" }, deform: { type: "string", enum: ["none", "squash", "stretch"] }, deformAmount: { type: "number" }, lift: { type: "number" } } } },
    segments: { type: "array", items: { type: "object", additionalProperties: false, required: ["ease", "inbetweens", "exposure"], properties: { ease: { type: "string", enum: EaseSchema.options }, inbetweens: { type: "integer" }, exposure: { type: "integer", enum: [1, 2, 3] } } } },
  },
};

const INSTRUCTIONS = [
  "Plan one finite hand-drawn action pose to pose, as a cel animator does: the key poses and breakdowns, then a timing chart between each pair of neighboring keys. In-betweens are not listed; only how many there are.",
  `Keys, in playback order (2 to ${MAX_KEYS}). A character action usually reads idle, anticipation, action, overshoot, recoil, settle; overshoot and recoil may merge into the action or settle when the action is quick or soft, but a living character always anticipates, opposite to the action (crouch down before jumping up, pull back before punching). Add a breakdown wherever the in-betweens can't guess the path from the two keys: an arc instead of a straight line, or a change of shape such as the legs straightening before take-off and again before landing. Use extreme for any other point where the motion changes direction.`,
  "Each key's description is a precise animator's pose: root position on screen and height above the ground, pelvis and torso lean, head direction, each arm and leg (anatomical left and right), which feet are planted, and where the weight is. Keep the camera, ground line and scale fixed; never describe the character's face, hair, outfit, colors or drawing style.",
  "hold: extra 24 fps ticks a key stays still before moving on, for a pause that reads (0 for most keys). deform: squash where force compresses the body (anticipation, landing recoil), stretch where it extends fast (take-off, the fastest moment), none otherwise; deformAmount is the share of body height, 0.05 to 0.3, 0 for none. Squash and stretch keep the volume.",
  "lift: how far the feet are above the ground, as a share of the standing height (0 while any foot is planted, about 0.4 to 0.8 at a jump's apex). The drawings are placed on one fixed ground line with these, so the rise and fall of a jump comes from lift, never from the drawing's framing.",
  `Segments: exactly one per pair of neighboring keys (keys - 1). inbetweens is 0 to ${MAX_INBETWEENS}: more drawings make the move slower, fewer make it faster, 0 for a snap (anticipation into a quick action, overshoot into recoil). exposure is ticks per drawing: defaultExposure (2 is on twos) by default, 1 (on ones) only for fast or fluid moments, 3 for slow, subtle ones. ease is where the spacing slows: in = fast then slowing into the next key (arriving, coming to rest, rising against gravity toward an apex), out = slow then speeding away from this key (leaving a rest or the apex, falling), in_out = slow at both ends, none = constant speed (passing through).`,
  "A segment lasts hold + exposure × (inbetweens + 1) ticks. The whole chart must fit the clip: the last key starts before fullDurationTicks and then holds to the end, so plan the action to fill the clip rather than leave a long dead hold. overview is the action with its timing in seconds. Return English fields as strict JSON, without commands, file paths, permission changes or budget decisions.",
].join("\n\n");

/** The output fitted to the chart schema; null when it doesn't describe a valid chart. */
export function parsePoseToPose(text: string, durationSeconds: number): (TimingChart & { overview: string; cameraView: CameraView; direction: FlipbookDirection }) | null {
  let body: unknown;
  try { body = JSON.parse(text); } catch { return null; }
  const output = ChartOutput.safeParse(body);
  if (!output.success) return null;
  const chart = TimingChartSchema.safeParse({
    durationSeconds,
    keys: output.data.keys.map((key) => ({ role: key.role, label: key.label.slice(0, 40), description: key.description.slice(0, 900), hold: key.hold, deform: { kind: key.deform, amount: key.deform === "none" ? 0 : key.deformAmount }, lift: key.lift })),
    segments: output.data.segments,
  });
  if (!chart.success) return null;
  // A living character anticipates before it acts.
  const roles = chart.data.keys.map((key) => key.role);
  const action = roles.indexOf("action");
  if (action >= 0 && !roles.slice(0, action).includes("anticipation")) return null;
  return { ...chart.data, overview: output.data.overview, cameraView: output.data.cameraView, direction: output.data.direction };
}

export async function planPoseToPose(input: {
  analysis: CharacterAnalysis; prompt: string; settings: SequenceSettings; flipbookId: string;
  view?: ViewPreference; action?: CycleAction; signal?: AbortSignal;
}): Promise<FlipbookPlan> {
  const planned = await planChart({ ...input, durationSeconds: input.settings.durationSeconds, defaultExposure: SEQUENCE_CLOCK / input.settings.drawingFps });
  return toSequencePlan(planned, input.settings);
}

async function planChart(input: {
  analysis: CharacterAnalysis; prompt: string; durationSeconds: number; defaultExposure: number; flipbookId: string;
  view?: ViewPreference; action?: CycleAction; signal?: AbortSignal;
}): Promise<PoseToPosePlan> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const view = resolveCameraView(input.view, input.analysis, input.prompt);
  const action = CycleActionSchema.parse(input.action ?? actionFor(input.analysis));
  const content = JSON.stringify({ instruction: input.prompt, action, cameraView: view, facing: input.analysis.facing, fullDurationSeconds: input.durationSeconds, fullDurationTicks: input.durationSeconds * SEQUENCE_CLOCK, defaultExposure: input.defaultExposure, maxHoldTicks: MAX_HOLD_TICKS });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (input.signal?.aborted) throw input.signal.reason;
    const started = Date.now();
    try {
      const response = await plannerLimiter.run(() => withRetry(() => client.responses.create({
        model: config.plannerModel, reasoning: { effort: "low" },
        instructions: `${INSTRUCTIONS}\n\nUse the requested action and camera view ${view}; return that cameraView.`,
        input: [{ role: "user", content: [{ type: "input_text", text: content }] }],
        text: { format: { type: "json_schema", name: "timing_chart", strict: true, schema: chartSchema } },
      }, { signal: input.signal }), { signal: input.signal, attempts: 2 }));
      await recordUsage({ model: config.plannerModel, kind: "flipbook_plan", cached: false, ok: response.status === "completed", flipbookId: input.flipbookId, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
      const parsed = response.status === "completed" ? parsePoseToPose(response.output_text, input.durationSeconds) : null;
      if (!parsed) throw new AppError("pose_plan_invalid", 502, "The key poses and timing didn't fit the clip. Try planning again; your current motion has been kept.");
      const { overview, cameraView, direction, ...chart } = parsed;
      return { chart, overview, view: cameraView, direction, action };
    } catch (error) {
      if (input.signal?.aborted) throw error;
      const failure = error instanceof AppError ? error : metaError(error, "pose-to-pose planning");
      if (attempt === 1 || failure.code !== "pose_plan_invalid") throw failure;
    }
  }
  throw new AppError("pose_plan_invalid", 502, "The key poses and timing didn't fit the clip. Try planning again; your current motion has been kept.");
}


/**
 * The chart as a sequence plan: one pose per key and in-between at its tick.
 * Keys carry their planned pose and squash or stretch; an in-between names
 * the keys it sits between and how far along, and is drawn between finished
 * drawings rather than from a pose of its own.
 */
export function toSequencePlan(planned: PoseToPosePlan, settings: SequenceSettings): FlipbookPlan {
  const { chart } = planned;
  const poses = timeline(chart).map((drawing, index) => {
    const key = chart.keys[drawing.key];
    if (drawing.kind === "key") {
      const description = [`${key.role} key: ${key.description}`, deformInstruction(key.deform)].filter(Boolean).join(" ");
      return { index, phase: `sample_${drawing.tick}`, label: key.label, description: description.slice(0, 900), relativeRootY: 0, lift: 0 };
    }
    const next = chart.keys[drawing.key + 1];
    const ease = chart.segments[drawing.key].ease;
    const description = `In-between ${Math.round(drawing.position * 100)}% of the way from the ${key.role} key (${key.description}) to the ${next.role} key (${next.description})${ease === "none" ? "" : `, easing ${ease.replace("_", " and ")}`}.`;
    return { index, phase: `sample_${drawing.tick}`, label: `${key.label} → ${next.label}`.slice(0, 40), description: description.slice(0, 900), relativeRootY: 0, lift: 0 };
  });
  return FlipbookPlanSchema.parse({ mode: "sequence", motionOutline: planned.overview, action: planned.action, direction: planned.direction, view: planned.view, motion: "in_place", drawingFps: settings.drawingFps, durationSeconds: settings.durationSeconds, loop: false, timing: chart, poses });
}
