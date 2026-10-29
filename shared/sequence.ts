import { z } from "zod";

export const SEQUENCE_CLOCK = 24;
export const MAX_DRAWING_HOLD_SECONDS = 3 / SEQUENCE_CLOCK;
export const MAX_SEQUENCE_FRAMES = 480;
export const SequenceSettingsSchema = z.object({
  durationSeconds: z.number().int().min(1).max(20),
  drawingFps: z.union([z.literal(8), z.literal(12), z.literal(24)]),
});
export type SequenceSettings = z.infer<typeof SequenceSettingsSchema>;
export const DEFAULT_SEQUENCE: SequenceSettings = { durationSeconds: 4, drawingFps: 24 };

export function sequenceTicks(settings: SequenceSettings): number[] {
  const parsed = SequenceSettingsSchema.parse(settings);
  return Array.from({ length: parsed.durationSeconds * parsed.drawingFps }, (_, index) => index * (SEQUENCE_CLOCK / parsed.drawingFps));
}
export function sequenceFrameId(tick: number): string {
  if (!Number.isInteger(tick) || tick < 0 || tick >= MAX_SEQUENCE_FRAMES) throw new RangeError("Sequence tick is out of range");
  return `s${tick}`;
}
export function sequenceIndexAt(seconds: number, settings: SequenceSettings): number {
  return Math.max(0, Math.min(settings.durationSeconds * settings.drawingFps - 1, Math.floor(seconds * settings.drawingFps)));
}

export const FlipbookAudioSchema = z.object({
  version: z.string().regex(/^[0-9a-f]{12}$/),
  name: z.string().max(120),
  durationSeconds: z.number().positive().max(61),
  offset: z.number().min(0).max(60).default(0),
  startsAt: z.number().min(0).max(20).default(0),
  volume: z.number().min(0).max(1).default(1),
});
export type FlipbookAudio = z.infer<typeof FlipbookAudioSchema>;
export const AudioSettingsSchema = FlipbookAudioSchema.pick({ offset: true, startsAt: true, volume: true });

export const MotionReferenceSchema = z.object({
  version: z.string().regex(/^[0-9a-f]{12}$/),
  name: z.string().max(120),
  sourceSeconds: z.number().positive(),
  start: z.number().min(0),
  durationSeconds: z.number().int().min(1).max(20),
  hasAudio: z.boolean(),
});
export type MotionReference = z.infer<typeof MotionReferenceSchema>;
