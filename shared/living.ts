import { z } from "zod";
import { DurationSchema } from "./flipbook";

// "Animate as is": what Focus found in an upload that can move, and how the
// person chose to move it. Shared by the server and the browser.

/** What a layer is: the character, a part of it that hangs and flows, many small floating things, or the sky. */
export const LIVING_KINDS = ["character", "flowing", "floating", "sky"] as const;
export const LivingKindSchema = z.enum(LIVING_KINDS);
export type LivingKind = z.infer<typeof LivingKindSchema>;

export const LIVING_MOTIONS = ["breathe", "sway", "drift", "flutter", "still"] as const;
export const LivingMotionSchema = z.enum(LIVING_MOTIONS);
export type LivingMotion = z.infer<typeof LivingMotionSchema>;

/** The motions each kind can take; the first is its default. */
export const MOTIONS_FOR: Readonly<Record<LivingKind, readonly LivingMotion[]>> = {
  character: ["breathe", "still"],
  flowing: ["sway", "still"],
  floating: ["drift", "flutter", "still"],
  sky: ["drift", "still"],
};

export const MOTION_LABELS: Readonly<Record<LivingMotion, string>> = {
  breathe: "Breathe",
  sway: "Sway",
  drift: "Drift",
  flutter: "Flutter",
  still: "Keep still",
};

export const LivingWindSchema = z.enum(["left", "right"]);
export type LivingWind = z.infer<typeof LivingWindSchema>;

export const LivingLayerIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const LivingLayerSchema = z.object({
  id: LivingLayerIdSchema,
  /** What SAM was asked for, as shown to the person ("hair", "leaf"). */
  name: z.string().min(1).max(60),
  kind: LivingKindSchema,
  /** Separate masks: one for most layers, one per leaf for floating things. */
  pieces: z.number().int().min(1).max(200),
  /** Share of the picture it covers. */
  share: z.number().min(0).max(1),
  /** Picked by the person with a click, not found by SAM; only these can be removed. */
  custom: z.boolean().default(false),
});
export type LivingLayer = z.infer<typeof LivingLayerSchema>;

/** A part the person points at: the spot clicked, in the picture's pixels. */
export const LivingPartRequestSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(40).optional(),
}).strict();
export type LivingPartRequest = z.infer<typeof LivingPartRequestSchema>;

export const LivingInventorySchema = z.object({
  imageId: z.uuid(),
  wind: LivingWindSchema,
  layers: z.array(LivingLayerSchema).max(8),
  /** Things that were seen and stay as they are (people in the background, a building). */
  stills: z.array(z.string().max(60)).max(12),
  /** The scene with the character taken out exists: the "depth" camera can move them apart. */
  scene: z.boolean().default(false),
  /** A closed-eyes version of the eyes exists: the character can blink. */
  blink: z.boolean().default(false),
  createdAt: z.iso.datetime(),
});
export type LivingInventory = z.infer<typeof LivingInventorySchema>;

// ── Sound ──────────────────────────────────────────────────────────────────
//
// The Meta Model API has no audio generation. Sound is either an ambience
// synthesized locally from filtered noise (no files, no licenses, no paid
// call) or a track the person uploads.

export const AMBIENCES = ["wind", "leaves", "rain", "waves"] as const;
export const AmbienceSchema = z.enum(AMBIENCES);
export type Ambience = z.infer<typeof AmbienceSchema>;
export const AMBIENCE_LABELS: Readonly<Record<Ambience, string>> = { wind: "Wind", leaves: "Leaves in the wind", rain: "Rain", waves: "Waves" };

export const AudioVersionSchema = z.string().regex(/^[a-f0-9]{12}$/);

export const LivingAudioSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("ambience"), ambience: AmbienceSchema }).strict(),
  z.object({ kind: z.literal("upload"), version: AudioVersionSchema }).strict(),
]);
export type LivingAudio = z.infer<typeof LivingAudioSchema>;

/** An uploaded track, normalized to AAC and cut to this length. */
export const MAX_AUDIO_SECONDS = 60;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const AUDIO_ACCEPT_ATTRIBUTE = "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/webm,.mp3,.m4a,.aac,.wav,.ogg,.webm";

export const LivingTrackSchema = z.object({
  version: AudioVersionSchema,
  name: z.string().max(120),
  durationSeconds: z.number().positive(),
});
export type LivingTrack = z.infer<typeof LivingTrackSchema>;

/** How long the video plays: one loop (0), or whole loops repeated to at least this many seconds. */
export const VIDEO_LENGTHS = [0, 10, 20, 30] as const;
export const VideoLengthSchema = z.union([z.literal(0), z.literal(10), z.literal(20), z.literal(30)]);

/** Seconds of the video: whole loops, at least the length asked for. */
export function videoSeconds(request: Pick<LivingRequest, "durationSeconds" | "lengthSeconds">): number {
  return request.lengthSeconds > 0 ? Math.ceil(request.lengthSeconds / request.durationSeconds) * request.durationSeconds : request.durationSeconds;
}

/** The ambience that suits what moves: rustling leaves, wind for a sky or flowing hair, else none. */
export function suggestAmbience(inventory: Pick<LivingInventory, "layers">): Ambience | null {
  const names = inventory.layers.map((layer) => layer.name);
  if (inventory.layers.some((layer) => layer.kind === "floating" && /leaf|petal|feather|grass/.test(layer.name))) return "leaves";
  if (names.some((name) => /rain|drop/.test(name))) return "rain";
  if (names.some((name) => /wave|sea|ocean/.test(name))) return "waves";
  if (inventory.layers.some((layer) => layer.kind === "sky" || layer.kind === "flowing")) return "wind";
  return null;
}

// ── Framing ────────────────────────────────────────────────────────────────

/** A camera that moves within the loop (and is back where it started at its end). */
export const LIVING_CAMERAS = ["still", "zoom", "pan", "depth"] as const;
export const LivingCameraSchema = z.enum(LIVING_CAMERAS);
export type LivingCamera = z.infer<typeof LivingCameraSchema>;
export const CAMERA_LABELS: Readonly<Record<LivingCamera, string>> = { still: "Still", zoom: "Slow zoom", pan: "Pan", depth: "Depth" };

/** The shape of the video: the picture's own, or a crop around the character. */
export const LIVING_ASPECTS = ["original", "9:16", "1:1"] as const;
export const LivingAspectSchema = z.enum(LIVING_ASPECTS);
export type LivingAspect = z.infer<typeof LivingAspectSchema>;
export const ASPECT_LABELS: Readonly<Record<LivingAspect, string>> = { original: "Original", "9:16": "9:16", "1:1": "1:1" };

/** Motion strength: 1 is the default amount, 0 none, 2 twice as much. */
export const LIVING_STRENGTH = [0, 2] as const;

export const LivingRequestSchema = z.object({
  durationSeconds: DurationSchema,
  wind: LivingWindSchema,
  layers: z.array(z.object({
    id: LivingLayerIdSchema,
    motion: LivingMotionSchema,
    strength: z.number().min(LIVING_STRENGTH[0]).max(LIVING_STRENGTH[1]),
  }).strict()).max(8),
  audio: LivingAudioSchema,
  lengthSeconds: VideoLengthSchema,
  camera: LivingCameraSchema,
  aspect: LivingAspectSchema,
  /** The character blinks once per loop (needs the closed-eyes version). */
  blink: z.boolean(),
}).strict();
export type LivingRequest = z.infer<typeof LivingRequestSchema>;

export const LivingFileSchema = z.object({ name: z.string(), type: z.string(), bytes: z.number().int().nonnegative() });

export const LivingRenderSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{16}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frames: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  hasAudio: z.boolean().default(false),
  files: z.array(LivingFileSchema),
  createdAt: z.iso.datetime(),
});
export type LivingRender = z.infer<typeof LivingRenderSchema>;

/** The request that moves every layer its default way, at default strength. */
export function defaultLivingRequest(inventory: Pick<LivingInventory, "wind" | "layers">): LivingRequest {
  return {
    durationSeconds: 4,
    wind: inventory.wind,
    layers: inventory.layers.map((layer) => ({ id: layer.id, motion: MOTIONS_FOR[layer.kind][0], strength: 1 })),
    audio: { kind: "none" },
    lengthSeconds: 0,
    camera: "still",
    aspect: "original",
    blink: false,
  };
}

export const livingUrls = {
  layers: (imageId: string) => `/api/flipbooks/images/${imageId}/living`,
  render: (imageId: string) => `/api/flipbooks/images/${imageId}/living/render`,
  audio: (imageId: string) => `/api/flipbooks/images/${imageId}/living/audio`,
  editor: (imageId: string) => `/api/flipbooks/images/${imageId}/living/editor`,
  parts: (imageId: string) => `/api/flipbooks/images/${imageId}/living/parts`,
  scene: (imageId: string) => `/api/flipbooks/images/${imageId}/living/scene`,
  blink: (imageId: string) => `/api/flipbooks/images/${imageId}/living/blink`,
  mask: (imageId: string, layerId: string) => `/api/flipbooks/images/${imageId}/living/media?layer=${encodeURIComponent(layerId)}`,
  file: (imageId: string, key: string, name: string, download = false) =>
    `/api/flipbooks/images/${imageId}/living/media?x=${key}&name=${encodeURIComponent(name)}${download ? "&download=1" : ""}`,
};
