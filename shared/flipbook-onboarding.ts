import { z } from "zod";
import { CycleActionSchema, FlipbookImageIdSchema, IdeaDirectionSchema } from "./flipbook";
import { CharacterSourceSchema } from "./characters";
import { ViewPreferenceSchema } from "./animation-view";
import { descriptionAnimationPrompt } from "./animation-prompt";
import type { SequenceSettings } from "./sequence";

// Guided setup: after an upload, the animator says in their own words what
// the character should do and Muse Spark asks only what it can't decide,
// then picks every setting. The Advanced form keeps the manual controls.

export const GUIDE_MESSAGE_MAX = 1200;
/** Turns of the conversation sent back each time: at most three questions and their answers fit with room to spare. */
export const GUIDE_MAX_MESSAGES = 12;

export const GuideMessageSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(GUIDE_MESSAGE_MAX) });
export type GuideMessage = z.infer<typeof GuideMessageSchema>;

/** The picture is an upload (`imageId`) or a saved character's version (`characterSource`, its owner only). */
export const GuideRequestSchema = z.object({
  imageId: FlipbookImageIdSchema.optional(),
  characterSource: CharacterSourceSchema.optional(),
  messages: z.array(GuideMessageSchema).min(1).max(GUIDE_MAX_MESSAGES),
})
  .refine((input) => input.messages.at(-1)?.role === "user", "The last message is the animator's.")
  .refine((input) => Boolean(input.imageId) !== Boolean(input.characterSource), "Choose an upload or a character version.");
export type GuideRequest = z.infer<typeof GuideRequestSchema>;

/** Everything the create screen would otherwise ask for, decided by Muse Spark. */
export const GuidedSetupSchema = z.object({
  mode: z.enum(["cycle", "sequence"]),
  action: CycleActionSchema,
  view: ViewPreferenceSchema,
  direction: IdeaDirectionSchema,
  durationSeconds: z.number().int().min(1).max(20),
  drawingFps: z.union([z.literal(8), z.literal(12), z.literal(24)]),
  keepScene: z.boolean(),
  /** The motion for the drawing pipeline, in English. */
  instruction: z.string().trim().min(3).max(600),
  /** What will be made, in the animator's language. */
  summary: z.string().trim().max(500),
});
export type GuidedSetup = z.infer<typeof GuidedSetupSchema>;

export const GuideReplySchema = z.object({
  /** Muse Spark's answer in the animator's language: a question, or what it will make. */
  reply: z.string().trim().min(1).max(800),
  /** Set once nothing essential is missing. */
  setup: GuidedSetupSchema.nullable(),
});
export type GuideReply = z.infer<typeof GuideReplySchema>;

/** Paid drawings a setup will use before any in-betweens: one per pose of a cycle, one per timed drawing of a sequence. */
export function guidedDrawings(setup: Pick<GuidedSetup, "mode" | "durationSeconds" | "drawingFps">): number {
  return setup.mode === "sequence" ? setup.durationSeconds * setup.drawingFps : 8;
}

/** The sequence settings a setup asks for, or none for a cycle. */
export function guidedSequence(setup: GuidedSetup): SequenceSettings | undefined {
  return setup.mode === "sequence" ? { durationSeconds: setup.durationSeconds, drawingFps: setup.drawingFps } : undefined;
}

/** The full animation prompt a guided setup creates with, as the Advanced form would write it. */
export function guidedPrompt(setup: GuidedSetup): string {
  return descriptionAnimationPrompt(setup.instruction, guidedSequence(setup));
}
