import { z } from "zod";
import type { EditPlan, PlanEffect } from "./schemas";

// Effect parameters: the only knobs the compositor accepts. Every value is
// bounded, so a model or a client can never push the renderer out of range.

/** Bump when output pixels change for the same inputs; invalidates cached renders. */
export const RENDERER_VERSION = 1;

export const BlurLevelSchema = z.enum(["low", "medium", "high"]);
export type BlurLevel = z.infer<typeof BlurLevelSchema>;

export const SelectiveColorParamsSchema = z.object({
  effect: z.literal("selective_color"),
  /** 1 = background fully grayscale. */
  intensity: z.number().min(0.2).max(1).default(1),
  feather: z.number().min(0).max(4).default(1.5),
});

export const BackgroundBlurParamsSchema = z.object({
  effect: z.literal("background_blur"),
  level: BlurLevelSchema.default("medium"),
  feather: z.number().min(0).max(4).default(1.5),
});

export const BreakFrameParamsSchema = z.object({
  effect: z.literal("break_frame"),
  background: z.enum(["dark", "light"]).default("dark"),
  /** Inner frame size relative to the canvas. */
  frameSize: z.enum(["compact", "balanced", "wide"]).default("balanced"),
  feather: z.number().min(0).max(4).default(1.2),
});

export const MotionEchoParamsSchema = z.object({
  effect: z.literal("motion_echo"),
  trailCount: z.number().int().min(2).max(6).default(3),
  trailSpacingMs: z.number().int().min(60).max(400).default(120),
  intensity: z.number().min(0.2).max(1).default(0.6),
  feather: z.number().min(0).max(4).default(1.2),
});

export const RenderParamsSchema = z.discriminatedUnion("effect", [
  SelectiveColorParamsSchema,
  BackgroundBlurParamsSchema,
  BreakFrameParamsSchema,
  MotionEchoParamsSchema,
]);
export type RenderParams = z.infer<typeof RenderParamsSchema>;
export type RenderParamsOf<E extends PlanEffect> = Extract<RenderParams, { effect: E }>;

/** Defaults derived from a validated plan; the plan's intensity maps into each effect's own scale. */
export function defaultParams(plan: EditPlan): RenderParams {
  const intensity = plan.parameters.intensity;
  switch (plan.effect) {
    case "selective_color":
      return SelectiveColorParamsSchema.parse({ effect: "selective_color", intensity: intensity === undefined ? 1 : Math.max(0.2, intensity) });
    case "background_blur":
      return BackgroundBlurParamsSchema.parse({
        effect: "background_blur",
        level: intensity === undefined ? "medium" : intensity < 0.4 ? "low" : intensity < 0.75 ? "medium" : "high",
      });
    case "break_frame":
      return BreakFrameParamsSchema.parse({ effect: "break_frame" });
    case "motion_echo":
      return MotionEchoParamsSchema.parse({
        effect: "motion_echo",
        trailCount: plan.parameters.trailCount === undefined ? 3 : Math.min(6, plan.parameters.trailCount),
        trailSpacingMs: plan.parameters.trailSpacingMs === undefined ? 120 : Math.min(400, Math.max(60, plan.parameters.trailSpacingMs)),
      });
  }
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
  renderMs: z.number().nonnegative(),
  createdAt: z.iso.datetime(),
  urls: z.object({ video: z.string(), compare: z.string(), download: z.string() }),
});
export type RenderResult = z.infer<typeof RenderResultSchema>;
