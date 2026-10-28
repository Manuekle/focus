import { z } from "zod";
import {
  DrawingFpsSchema,
  FrameIdSchema,
  MotionSchema,
  PlaybackSecondsSchema,
  SPEED_BOUNDS,
  type PlaybackSettings,
} from "./flipbook";
import { MAX_SEQUENCE_FRAMES } from "./sequence";
import { CHAT_MESSAGE_MAX_LENGTH } from "./schemas";

// The Flipbook chat: a sentence about the movement ("wave with the other
// hand", "slower", "raise the arm in frame 4") becomes a proposal that is
// shown first. Playback changes are free; changed poses cost one drawing
// each, and only an explicit apply redraws them.

export const POSE_DESCRIPTION_MAX = 900;
export const CHAT_HISTORY_LIMIT = 8;

export const ChatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(600),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/** The playback the studio shows now, so "slower" and "a bit faster" are relative to something. */
export const ChatPlaybackSchema = z.object({
  drawingFps: DrawingFpsSchema,
  durationSeconds: PlaybackSecondsSchema,
  motion: MotionSchema,
  speed: z.number().min(SPEED_BOUNDS[0]).max(SPEED_BOUNDS[1]),
});

export type ChatPlayback = z.infer<typeof ChatPlaybackSchema>;

export const FlipbookChatRequestSchema = z.object({
  message: z.string().trim().min(2).max(CHAT_MESSAGE_MAX_LENGTH),
  history: z.array(ChatTurnSchema).max(CHAT_HISTORY_LIMIT).default([]),
  playback: ChatPlaybackSchema.optional(),
});
export type FlipbookChatRequest = z.input<typeof FlipbookChatRequestSchema>;

/** The playback settings a proposal changes; absent keys stay as they are. */
export const PlaybackPatchSchema = z.object({
  drawingFps: DrawingFpsSchema.optional(),
  durationSeconds: PlaybackSecondsSchema.optional(),
  motion: MotionSchema.optional(),
  speed: z.number().min(SPEED_BOUNDS[0]).max(SPEED_BOUNDS[1]).optional(),
});
export type PlaybackPatch = z.infer<typeof PlaybackPatchSchema>;

export function applyPlaybackPatch(settings: PlaybackSettings, patch: PlaybackPatch): PlaybackSettings {
  return { ...settings, ...patch };
}

/** Short words for a patch, for the confirmation line and the log of changes. */
export function describePlaybackPatch(patch: PlaybackPatch): string[] {
  const parts: string[] = [];
  if (patch.drawingFps !== undefined) parts.push(`${patch.drawingFps} drawings per second`);
  if (patch.speed !== undefined) parts.push(`speed ×${patch.speed}`);
  if (patch.durationSeconds !== undefined) parts.push(`${patch.durationSeconds} s long`);
  if (patch.motion !== undefined) parts.push(patch.motion === "in_place" ? "in place" : `travels ${patch.motion}`);
  return parts;
}

export const PoseChangeSchema = z.object({
  frame: FrameIdSchema,
  /** Place in playback order, from 1: what the person sees on the strip. */
  position: z.number().int().min(1).max(MAX_SEQUENCE_FRAMES),
  label: z.string().max(40),
  /** One short sentence: what is different in this drawing. */
  summary: z.string().max(160),
  before: z.string().max(POSE_DESCRIPTION_MAX),
  /** The new instruction the drawing is made from. */
  description: z.string().min(1).max(POSE_DESCRIPTION_MAX),
});
export type PoseChange = z.infer<typeof PoseChangeSchema>;

export const SkippedFrameSchema = z.object({ frame: FrameIdSchema, position: z.number().int().min(1).max(MAX_SEQUENCE_FRAMES), label: z.string().max(40), reason: z.string().max(160) });
export type SkippedFrame = z.infer<typeof SkippedFrameSchema>;

export const ChatCostSchema = z.object({
  /** Muse Image drawings the pose changes would use. */
  drawings: z.number().int().min(0).max(MAX_SEQUENCE_FRAMES),
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  /** Drawings past the budget: applying them takes an explicit confirmation. */
  overBy: z.number().int().nonnegative(),
});
export type ChatCost = z.infer<typeof ChatCostSchema>;

export const FlipbookProposalSchema = z.object({
  proposalId: z.uuid().optional(),
  reply: z.string().min(1).max(400),
  changes: z.array(PoseChangeSchema).max(MAX_SEQUENCE_FRAMES),
  playback: PlaybackPatchSchema.nullable(),
  skipped: z.array(SkippedFrameSchema).max(MAX_SEQUENCE_FRAMES),
  cost: ChatCostSchema,
});
export type FlipbookProposal = z.infer<typeof FlipbookProposalSchema>;

/** Applies the poses of a proposal: the new instructions, then one redraw each. */
export const ApplyPoseChangesRequestSchema = z.object({
  proposalId: z.uuid().optional(),
  changes: z
    .array(z.object({ frame: FrameIdSchema, description: z.string().trim().min(1).max(POSE_DESCRIPTION_MAX) }))
    .min(1)
    .max(MAX_SEQUENCE_FRAMES).optional(),
  confirmExtra: z.boolean().optional(),
}).refine((input) => Boolean(input.proposalId) !== Boolean(input.changes), "Choose a stored proposal or explicit changes.");
export type ApplyPoseChangesRequest = z.infer<typeof ApplyPoseChangesRequestSchema>;

export const FLIPBOOK_CHAT_STARTERS = ["Make the movement smaller", "Slower, more relaxed", "Make it happier", "Bigger, more energetic"] as const;

/** "This will redraw 3 frames (3 drawings)". */
export function costLine(cost: ChatCost): string {
  const frames = `${cost.drawings} ${cost.drawings === 1 ? "frame" : "frames"}`;
  return `This will redraw ${frames} (${cost.drawings} ${cost.drawings === 1 ? "drawing" : "drawings"}).`;
}
