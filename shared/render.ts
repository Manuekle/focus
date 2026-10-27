import { z } from "zod";
import type { EditPlan, PlanEffect } from "./schemas";
import { EchoSchema, FreezeDurationSchema, TEMPORAL_BOUNDS, TriggerSchema } from "./temporal";

// Effect parameters: the only knobs the compositor accepts. Every value is
// bounded, so a model or a client can never push the renderer out of range.

/** Bump when output pixels change for the same inputs; invalidates cached renders. */
export const RENDERER_VERSION = 2;
/** Temporal audio/comparison changes invalidate only Time Freeze caches. */
export const TEMPORAL_RENDERER_VERSION = 4;

export const BlurLevelSchema = z.enum(["low", "medium", "high"]);
export type BlurLevel = z.infer<typeof BlurLevelSchema>;

/** Color grades applied to the whole finished frame. */
export const LookSchema = z.enum(["natural", "cinematic", "noir", "warm", "cool", "vintage", "vivid"]);
export type Look = z.infer<typeof LookSchema>;

/** A light drawn around the subject's own mask. */
export const SubjectAccentSchema = z.enum(["none", "glow", "outline"]);
export const AccentColorSchema = z.enum(["white", "gold", "cyan", "magenta", "lime"]);
export type AccentColor = z.infer<typeof AccentColorSchema>;

/**
 * The finishing layer, shared by every effect: grade, subject light, vignette,
 * film grain and letterbox. The defaults change no pixel.
 */
export const FinishSchema = z.object({
  look: LookSchema.default("natural"),
  subject: SubjectAccentSchema.default("none"),
  accent: AccentColorSchema.default("white"),
  accentStrength: z.number().min(0.2).max(1).default(0.7),
  vignette: z.number().min(0).max(1).default(0),
  grain: z.number().min(0).max(1).default(0),
  letterbox: z.boolean().default(false),
});
export type Finish = z.infer<typeof FinishSchema>;
/** A partial finish with no defaults: an absent key means "keep it" (Zod's partial() would still fill defaults). */
export const FinishPatchSchema = z.object({
  look: LookSchema.optional(),
  subject: SubjectAccentSchema.optional(),
  accent: AccentColorSchema.optional(),
  accentStrength: z.number().min(0.2).max(1).optional(),
  vignette: z.number().min(0).max(1).optional(),
  grain: z.number().min(0).max(1).optional(),
  letterbox: z.boolean().optional(),
});
export type FinishPatch = z.infer<typeof FinishPatchSchema>;

const finish = FinishSchema.prefault({});

export const SelectiveColorParamsSchema = z.object({
  effect: z.literal("selective_color"),
  /** 1 = background fully grayscale. */
  intensity: z.number().min(0.2).max(1).default(1),
  feather: z.number().min(0).max(4).default(1.5),
  finish,
});

export const BackgroundBlurParamsSchema = z.object({
  effect: z.literal("background_blur"),
  level: BlurLevelSchema.default("medium"),
  feather: z.number().min(0).max(4).default(1.5),
  finish,
});

export const SpotlightParamsSchema = z.object({
  effect: z.literal("spotlight"),
  /** How dark the background gets away from the subject's pool of light. */
  darkness: z.number().min(0.2).max(0.95).default(0.7),
  feather: z.number().min(0).max(4).default(2),
  finish,
});

export const BreakFrameParamsSchema = z.object({
  effect: z.literal("break_frame"),
  background: z.enum(["dark", "light"]).default("dark"),
  /** Inner frame size relative to the canvas. */
  frameSize: z.enum(["compact", "balanced", "wide"]).default("balanced"),
  feather: z.number().min(0).max(4).default(1.2),
  finish,
});

export const MotionEchoParamsSchema = z.object({
  effect: z.literal("motion_echo"),
  trailCount: z.number().int().min(2).max(6).default(3),
  trailSpacingMs: z.number().int().min(60).max(400).default(120),
  intensity: z.number().min(0.2).max(1).default(0.6),
  feather: z.number().min(0).max(4).default(1.2),
  finish,
});

/** Time Freeze + Echo. The target is the job's selection, like every other effect. */
export const TimeFreezeEchoParamsSchema = z.object({
  effect: z.literal("time_freeze_echo"),
  trigger: TriggerSchema.default({ mode: "manual" }),
  freezeDurationMs: FreezeDurationSchema.default(1500),
  echo: EchoSchema.prefault({}),
  /** Continue the clip after the freeze (from the frame after the trigger), or end on the hold. */
  resume: z.boolean().default(true),
  feather: z.number().min(0).max(4).default(1.2),
  finish,
});

export const RenderParamsSchema = z.discriminatedUnion("effect", [
  SelectiveColorParamsSchema,
  BackgroundBlurParamsSchema,
  SpotlightParamsSchema,
  BreakFrameParamsSchema,
  MotionEchoParamsSchema,
  TimeFreezeEchoParamsSchema,
]);
export type RenderParams = z.infer<typeof RenderParamsSchema>;
export type RenderParamsInput = z.input<typeof RenderParamsSchema>;
export type RenderParamsOf<E extends PlanEffect> = Extract<RenderParams, { effect: E }>;

/** An effect's own defaults, before any plan or user choice. */
export function effectDefaults(effect: PlanEffect): RenderParams {
  return RenderParamsSchema.parse({ effect });
}

/** Defaults derived from a validated plan; the plan's intensity maps into each effect's own scale. */
export function defaultParams(plan: EditPlan): RenderParams {
  const intensity = plan.parameters.intensity;
  const finishPatch = plan.parameters.finish ?? {};
  const base = ((): RenderParamsInput => {
    switch (plan.effect) {
      case "selective_color":
        return { effect: "selective_color", intensity: intensity === undefined ? 1 : Math.max(0.2, intensity) };
      case "background_blur":
        return { effect: "background_blur", level: intensity === undefined ? "medium" : intensity < 0.4 ? "low" : intensity < 0.75 ? "medium" : "high" };
      case "spotlight":
        return { effect: "spotlight", darkness: intensity === undefined ? 0.7 : clamp(intensity, 0.2, 0.95) };
      case "break_frame":
        return { effect: "break_frame" };
      case "motion_echo":
        return {
          effect: "motion_echo",
          trailCount: plan.parameters.trailCount === undefined ? 3 : Math.min(6, plan.parameters.trailCount),
          trailSpacingMs: plan.parameters.trailSpacingMs === undefined ? 120 : Math.min(400, Math.max(60, plan.parameters.trailSpacingMs)),
        };
      case "time_freeze_echo": {
        const { triggerEvent, echoCount, echoSpacingMs, freezeDurationMs } = plan.parameters;
        return {
          effect: "time_freeze_echo",
          // A named event is resolved by motion detection; otherwise the user places the freeze.
          trigger: triggerEvent ? { mode: "auto", event: triggerEvent } : { mode: "manual" },
          ...(freezeDurationMs === undefined ? {} : { freezeDurationMs }),
          echo: {
            ...(echoCount === undefined ? {} : { count: echoCount }),
            ...(echoSpacingMs === undefined ? {} : { spacingMs: echoSpacingMs }),
            ...(intensity === undefined ? {} : { opacity: clamp(intensity, 0, 1) }),
          },
        };
      }
    }
  })();
  return RenderParamsSchema.parse({ ...base, finish: FinishSchema.parse(clampFinish(finishPatch)) });
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Numeric bounds of every knob, used to clamp model suggestions instead of rejecting them. */
export const PARAM_BOUNDS = {
  intensity: [0.2, 1],
  darkness: [0.2, 0.95],
  trailCount: [2, 6],
  trailSpacingMs: [60, 400],
  feather: [0, 4],
} as const;
const FINISH_BOUNDS = { accentStrength: [0.2, 1], vignette: [0, 1], grain: [0, 1] } as const;

/** Clamps a finish patch's numbers into range; other keys pass through for validation. */
export function clampFinish(patch: FinishPatch): FinishPatch {
  const out: FinishPatch = { ...patch };
  for (const [key, [min, max]] of Object.entries(FINISH_BOUNDS) as [keyof typeof FINISH_BOUNDS, readonly [number, number]][]) {
    if (typeof out[key] === "number") out[key] = clamp(out[key], min, max);
  }
  return out;
}

/** A requested change: any knob may be absent (keep it). */
export type ParamsPatch = {
  readonly effect?: PlanEffect;
  readonly settings?: Partial<Record<"intensity" | "darkness" | "trailCount" | "trailSpacingMs" | "feather" | "echoCount" | "echoSpacingMs" | "freezeDurationMs", number>> &
    Partial<{ level: BlurLevel; background: "dark" | "light"; frameSize: "compact" | "balanced" | "wide" }>;
  readonly finish?: FinishPatch;
};

/**
 * Applies a patch to the current parameters. Switching effect starts from that
 * effect's defaults but keeps edge softness and the finish. Numbers are clamped
 * to their bounds; knobs that do not belong to the effect are dropped.
 */
export function applyParamsPatch(current: RenderParams, patch: ParamsPatch): RenderParams {
  const effect = patch.effect ?? current.effect;
  const base: RenderParams = effect === current.effect ? current : { ...effectDefaults(effect), feather: current.feather, finish: current.finish } as RenderParams;
  const settings: Record<string, unknown> = { ...patch.settings };
  for (const [key, [min, max]] of Object.entries(PARAM_BOUNDS)) {
    const value = settings[key];
    if (typeof value === "number") settings[key] = key === "trailCount" || key === "trailSpacingMs" ? Math.round(clamp(value, min, max)) : clamp(value, min, max);
  }
  if (base.effect === "time_freeze_echo") {
    // Flat chat knobs land in the nested temporal edit; the freeze point never changes here.
    const [count, spacing, freeze] = (["echoCount", "echoSpacingMs", "freezeDurationMs"] as const).map((key) => settings[key]);
    const bound = (value: unknown, [min, max]: readonly [number, number]) => (typeof value === "number" && Number.isFinite(value) ? Math.round(clamp(value, min, max)) : undefined);
    settings.echo = {
      ...base.echo,
      ...(bound(count, TEMPORAL_BOUNDS.echoCount) === undefined ? {} : { count: bound(count, TEMPORAL_BOUNDS.echoCount) }),
      ...(bound(spacing, TEMPORAL_BOUNDS.echoSpacingMs) === undefined ? {} : { spacingMs: bound(spacing, TEMPORAL_BOUNDS.echoSpacingMs) }),
      ...(typeof settings.intensity === "number" ? { opacity: settings.intensity } : {}),
    };
    if (bound(freeze, TEMPORAL_BOUNDS.freezeDurationMs) !== undefined) settings.freezeDurationMs = bound(freeze, TEMPORAL_BOUNDS.freezeDurationMs);
    delete settings.trigger;
  }
  const parsed = RenderParamsSchema.safeParse({ ...base, ...settings, effect, finish: { ...base.finish, ...clampFinish(patch.finish ?? {}) } });
  return parsed.success ? parsed.data : base;
}

export const LOOK_LABEL: Record<Look, string> = {
  natural: "Natural",
  cinematic: "Cinematic",
  noir: "Noir",
  warm: "Golden hour",
  cool: "Moonlight",
  vintage: "Vintage film",
  vivid: "Vivid",
};

export const ACCENT_LABEL: Record<AccentColor, string> = { white: "White", gold: "Gold", cyan: "Cyan", magenta: "Magenta", lime: "Lime" };

/** sRGB of each accent color, for the compositor and the swatches. */
export const ACCENT_RGB: Record<AccentColor, readonly [number, number, number]> = {
  white: [255, 255, 255],
  gold: [255, 196, 92],
  cyan: [80, 220, 255],
  magenta: [255, 92, 200],
  lime: [176, 255, 96],
};

const EFFECT_LABEL: Record<PlanEffect, string> = {
  selective_color: "Selective color",
  background_blur: "Background blur",
  spotlight: "Spotlight",
  break_frame: "Break the Frame",
  motion_echo: "Motion Echo",
  time_freeze_echo: "Time Freeze",
};

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** Short human labels for what changed between two parameter sets, for the AI editor's history. */
export function describeParamChanges(before: RenderParams, after: RenderParams): string[] {
  const changes: string[] = [];
  if (before.effect !== after.effect) changes.push(`Effect: ${EFFECT_LABEL[after.effect]}`);
  const was = before as Record<string, unknown>;
  const now = after as Record<string, unknown>;
  const same = before.effect === after.effect;
  const knob = (key: string, label: string, format: (value: never) => string) => {
    if (now[key] !== undefined && (!same || was[key] !== now[key]) && (same || now[key] !== (effectDefaults(after.effect) as Record<string, unknown>)[key])) {
      changes.push(`${label}: ${format(now[key] as never)}`);
    }
  };
  knob("intensity", after.effect === "motion_echo" ? "Trail intensity" : "Desaturation", pct);
  knob("darkness", "Darkness", pct);
  knob("level", "Blur", (value: string) => value);
  knob("background", "Background", (value: string) => value);
  knob("frameSize", "Frame", (value: string) => value);
  knob("trailCount", "Trails", String);
  knob("trailSpacingMs", "Spacing", (value: number) => `${value} ms`);
  if (after.effect === "time_freeze_echo") {
    const prev = before.effect === "time_freeze_echo" ? before : (effectDefaults("time_freeze_echo") as RenderParamsOf<"time_freeze_echo">);
    if (after.trigger.timestampMs !== undefined && prev.trigger.timestampMs !== after.trigger.timestampMs) {
      changes.push(`Freeze point: ${(after.trigger.timestampMs / 1000).toFixed(2)} s`);
    }
    if (prev.freezeDurationMs !== after.freezeDurationMs) changes.push(`Freeze: ${(after.freezeDurationMs / 1000).toFixed(1)} s`);
    if (prev.echo.count !== after.echo.count) changes.push(`Echoes: ${after.echo.count}`);
    if (prev.echo.spacingMs !== after.echo.spacingMs) changes.push(`Echo spacing: ${after.echo.spacingMs} ms`);
    if (prev.echo.opacity !== after.echo.opacity) changes.push(`Echo intensity: ${pct(after.echo.opacity)}`);
    if (prev.resume !== after.resume) changes.push(after.resume ? "Resume after freeze" : "End on the freeze");
  }
  if (same && before.feather !== after.feather) changes.push(`Edge softness: ${after.feather} px`);
  const a = before.finish;
  const b = after.finish;
  if (a.look !== b.look) changes.push(`Look: ${LOOK_LABEL[b.look]}`);
  if (a.subject !== b.subject || (b.subject !== "none" && a.accent !== b.accent)) {
    changes.push(b.subject === "none" ? "Subject light: off" : `Subject ${b.subject}: ${ACCENT_LABEL[b.accent].toLowerCase()}`);
  }
  if (b.subject !== "none" && a.accentStrength !== b.accentStrength) changes.push(`Light strength: ${pct(b.accentStrength)}`);
  if (a.vignette !== b.vignette) changes.push(b.vignette ? `Vignette: ${pct(b.vignette)}` : "Vignette: off");
  if (a.grain !== b.grain) changes.push(b.grain ? `Film grain: ${pct(b.grain)}` : "Film grain: off");
  if (a.letterbox !== b.letterbox) changes.push(b.letterbox ? "Letterbox: on" : "Letterbox: off");
  return changes;
}

/** Effects that keep the source size, versus Break the Frame's 1080×1350 composition. */
export const BREAK_FRAME_CANVAS = { width: 1080, height: 1350 } as const;

export const RenderResultSchema = z.object({
  key: z.string(),
  params: RenderParamsSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  frameCount: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  hasAudio: z.boolean(),
  /** Frames where the selected objects had no mask; the effect treats them as background. */
  framesWithoutMask: z.number().int().nonnegative(),
  /** Break the Frame only: share of frames where subject pixels cross the inner frame. */
  breakoutFrameRatio: z.number().min(0).max(1).nullable(),
  warnings: z.array(z.string()),
  /** Time Freeze only: where the freeze sits in the output and which moments became echoes. */
  temporal: z
    .object({
      triggerFrame: z.number().int().nonnegative(),
      /** Output frame index where the inserted frozen frames begin. */
      freezeStart: z.number().int().nonnegative(),
      freezeFrames: z.number().int().positive(),
      /** Source frames whose cutouts were drawn, oldest first. */
      echoFrames: z.array(z.number().int().nonnegative()),
      resume: z.boolean(),
    })
    .nullable()
    .default(null),
  renderMs: z.number().nonnegative(),
  createdAt: z.iso.datetime(),
  urls: z.object({ video: z.string(), compare: z.string(), download: z.string() }),
});
export type RenderResult = z.infer<typeof RenderResultSchema>;
