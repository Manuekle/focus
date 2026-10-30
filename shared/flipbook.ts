import { z } from "zod";
import { ConceptSchema } from "./schemas";
import { PoseIdSchema } from "./pose-library";
import { CharacterSourceSchema } from "./characters";
import { CameraViewSchema, ViewPreferenceSchema } from "./animation-view";
import { MAX_SEQUENCE_FRAMES, SequenceSettingsSchema, FlipbookAudioSchema, MotionReferenceSchema, sequenceTicks } from "./sequence";
import { parseLimit } from "./media-limits";
import { TimingChartSchema, timeline } from "./timing-chart";

// Focus Flipbook: one character illustration becomes a short cycle of real,
// distinct drawings. Contracts shared by the studio, the API routes and the
// animation services, plus the timing and placement math both the browser
// player and the server exporter use, so a preview and its export always
// show the same drawing at the same place on the same frame.

export const FlipbookIdSchema = z.uuid();
export const FlipbookImageIdSchema = z.uuid();

// ── Uploads ────────────────────────────────────────────────────────────────

export const MAX_IMAGE_BYTES = parseLimit(process.env.NEXT_PUBLIC_FOCUS_MAX_IMAGE_UPLOAD_MB, 15, [1, 15]) * 1024 * 1024;
export const MIN_IMAGE_DIMENSION = 128;
export const MAX_IMAGE_DIMENSION = 6000;
/** Long side of the stored working copy and of the references sent to Muse Image. */
export const WORKING_LONG_SIDE = 1536;
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const ACCEPTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
export const IMAGE_ACCEPT_ATTRIBUTE = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_IMAGE_EXTENSIONS].join(",");

export function hasAcceptedImageExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export const FlipbookImageSchema = z.object({
  id: FlipbookImageIdSchema,
  originalName: z.string().min(1).max(255),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** The upload carried real transparency: its alpha is the character's mask. */
  hasAlpha: z.boolean(),
  createdAt: z.iso.datetime(),
  url: z.string(),
});
export type FlipbookImage = z.infer<typeof FlipbookImageSchema>;

// ── Actions ────────────────────────────────────────────────────────────────
//
// Every action is eight drawings that loop. The phases, their order and how
// the body rides on each are fixed here, so a model can add character detail
// but never reorder, drop or invent a phase.

export const ANIMATION_ACTIONS = ["walk", "run", "fight", "jump", "wave", "idle", "dance"] as const;
/** The six actions of one character: eight fixed phases that loop. */
export const CycleActionSchema = z.enum(ANIMATION_ACTIONS);
export type CycleAction = z.infer<typeof CycleActionSchema>;

/**
 * Several saved characters drawn together in every frame (a fight, a dance, a
 * chase). It is not a cycle: its length is the duration the person picks, at
 * a fixed pace, and every drawing is a beat of one choreographed scene.
 */
export const ENSEMBLE_ACTION = "ensemble" as const;
export const AnimationActionSchema = z.enum([...ANIMATION_ACTIONS, ENSEMBLE_ACTION]);
export type AnimationAction = z.infer<typeof AnimationActionSchema>;

/** Drawings per second of a scene: on threes at 24 fps, so a scene lasts exactly as long as its drawings. */
export const ENSEMBLE_FPS = 8;
export const MIN_ENSEMBLE_SECONDS = 1;
export const MAX_ENSEMBLE_SECONDS = 6;
export const MIN_CAST = 2;
export const MAX_CAST = 4;
/** The most drawings an animation can hold: a scene of the longest duration. */
export const MAX_FRAMES = MAX_ENSEMBLE_SECONDS * ENSEMBLE_FPS;

/** Drawings a scene of this length needs. */
export function ensembleDrawings(seconds: number): number {
  return seconds * ENSEMBLE_FPS;
}

export const WALK_PHASES = ["left_contact", "left_down", "left_passing", "left_up", "right_contact", "right_down", "right_passing", "right_up"] as const;
export const RUN_PHASES = ["left_strike", "left_load", "left_drive", "left_float", "right_strike", "right_load", "right_drive", "right_float"] as const;
export const FIGHT_PHASES = ["guard", "jab_load", "jab_hit", "jab_return", "cross_load", "cross_hit", "cross_return", "guard_bounce"] as const;
export const JUMP_PHASES = ["jump_ready", "jump_crouch", "jump_push", "jump_rise", "jump_apex", "jump_fall", "jump_land", "jump_recover"] as const;
export const WAVE_PHASES = ["wave_rest", "wave_raise", "wave_up", "wave_out", "wave_in", "wave_out_again", "wave_in_again", "wave_lower"] as const;
export const IDLE_PHASES = ["idle_rest", "idle_inhale", "idle_full", "idle_blink", "idle_exhale", "idle_settle", "idle_sway", "idle_return"] as const;
export const DANCE_PHASES = ["dance_center", "dance_reach", "dance_open", "dance_sway", "dance_point", "dance_step", "dance_cross", "dance_return"] as const;

const CyclePhaseSchema = z.enum([...WALK_PHASES, ...RUN_PHASES, ...FIGHT_PHASES, ...JUMP_PHASES, ...WAVE_PHASES, ...IDLE_PHASES, ...DANCE_PHASES]);
/** The phase of the nth drawing of a scene: beat_0, beat_1, … */
export type BeatPhase = `beat_${number}`;
export const beatPhase = (index: number): BeatPhase => `beat_${index}`;
const BeatPhaseSchema = z.custom<BeatPhase>((value) => typeof value === "string" && /^beat_(?:[0-9]|[1-3][0-9]|4[0-7])$/.test(value));
const SamplePhaseSchema = z.custom<`sample_${number}`>((value) => typeof value === "string" && /^sample_(?:0|[1-9][0-9]{0,2})$/.test(value) && Number(value.slice(7)) < MAX_SEQUENCE_FRAMES);
export const PhaseSchema = z.union([CyclePhaseSchema, BeatPhaseSchema, SamplePhaseSchema]);
export type Phase = z.infer<typeof PhaseSchema>;
/** Kept for the walk-only call sites and tests. */
export const WalkPhaseSchema = z.enum(WALK_PHASES);
export type WalkPhase = z.infer<typeof WalkPhaseSchema>;

export type PoseSpec = {
  readonly phase: Phase;
  readonly label: string;
  /** Spatial constraints for the drawing, in plain words. Never mirrored art: only the gait swaps sides. */
  readonly constraints: string;
  /**
   * Body height relative to the standing reference: the classic bob chart.
   * The feet stay on the ground line; the head rises and falls.
   */
  readonly relativeRootY: number;
  /** How far the lowest foot floats above the ground line, as a share of body height (a run's flight). */
  readonly lift: number;
  /**
   * Exposure frames (24 per second) this drawing stays on screen at 8 and at
   * 12 drawings per second: anime timing, where the anticipation and the hit
   * hold and the fast part goes by on ones. Absent, every drawing is held
   * evenly (on threes or twos), as a walk or a run should be.
   */
  readonly hold?: readonly [atEight: number, atTwelve: number];
};

const half = (lead: "left" | "right"): readonly PoseSpec[] => {
  const back = lead === "left" ? "right" : "left";
  const Lead = lead === "left" ? "Left" : "Right";
  return [
    {
      phase: `${lead}_contact`,
      label: `${Lead} contact`,
      constraints: `The ${lead} leg reaches forward, nearly straight, with only its heel touching the ground; the ${back} leg stretches behind with only its toes on the ground. The legs make an inverted V at their widest stride. The ${back} arm swings forward and the ${lead} arm swings back. Torso upright, head level.`,
      relativeRootY: -0.01,
      lift: 0,
    },
    {
      phase: `${lead}_down`,
      label: `${Lead} down`,
      constraints: `The weight drops onto the forward ${lead} leg: ${lead} foot flat on the ground, ${lead} knee clearly bent to absorb the step. The ${back} foot peels off the ground behind, heel raised, toes still touching. The body is at its lowest point. Arms at full swing, ${back} arm forward.`,
      relativeRootY: -0.035,
      lift: 0,
    },
    {
      phase: `${lead}_passing`,
      label: `${Lead} passing`,
      constraints: `The ${lead} leg is straight and vertical under the body, carrying all the weight, ${lead} foot flat. The ${back} leg is bent at the knee with its foot lifted off the ground, passing beside the ${lead} ankle. Arms hang close to the body, passing the hips. Body upright at middle height.`,
      relativeRootY: 0,
      lift: 0,
    },
    {
      phase: `${lead}_up`,
      label: `${Lead} up`,
      constraints: `The ${lead} leg pushes off behind the body, rising onto its toes; the ${back} leg swings forward, almost straight, its foot about to land. The body is at its highest point. The ${lead} arm starts swinging forward, the ${back} arm back.`,
      relativeRootY: 0.015,
      lift: 0,
    },
  ] as PoseSpec[];
};

const runHalf = (lead: "left" | "right"): readonly PoseSpec[] => {
  const back = lead === "left" ? "right" : "left";
  const Lead = lead === "left" ? "Left" : "Right";
  return [
    {
      phase: `${lead}_strike`,
      label: `${Lead} strike`,
      constraints: `Running. The ${lead} foot strikes the ground just ahead of the hips, knee slightly bent; the ${back} leg trails behind, knee bent, foot well off the ground. Both elbows bent at about 90 degrees: ${back} arm forward, ${lead} arm back. Torso leans slightly forward.`,
      relativeRootY: -0.02,
      lift: 0,
    },
    {
      phase: `${lead}_load`,
      label: `${Lead} load`,
      constraints: `Running. The weight compresses onto the ${lead} leg, its knee deeply bent under the body; the ${back} knee swings forward past the standing leg. The body is at its lowest point, torso leaning forward, arms pumping.`,
      relativeRootY: -0.06,
      lift: 0,
    },
    {
      phase: `${lead}_drive`,
      label: `${Lead} drive`,
      constraints: `Running. The ${lead} leg straightens and pushes off behind the body, only its toes touching the ground; the ${back} thigh drives forward and up, nearly horizontal, knee bent. Arms pump strongly: ${lead} arm forward, ${back} arm back. Torso leans forward.`,
      relativeRootY: 0,
      lift: 0,
    },
    {
      phase: `${lead}_float`,
      label: `${Lead} float`,
      constraints: `Running, flight phase: both feet are off the ground. The ${back} leg reaches forward to land next; the ${lead} leg folds up behind with its heel near the hip. The body is at its highest point, torso leaning forward, arms at full swing.`,
      relativeRootY: -0.03,
      lift: 0.07,
    },
  ] as PoseSpec[];
};

// Each column of holds sums to one cycle (24 frames at 8/s, 16 at 12/s).
const FIGHT_POSES: readonly PoseSpec[] = [
  { phase: "guard", label: "Guard", constraints: "Fighting stance, side view: feet a shoulder-width apart, lead foot forward, knees slightly bent; both fists up by the chin, elbows tucked, chin down, eyes forward.", relativeRootY: 0, lift: 0, hold: [4, 3] },
  { phase: "jab_load", label: "Jab load", constraints: "Weight shifts slightly onto the front foot; the lead fist starts moving forward from the chin; the rear fist stays guarding the face. Feet planted.", relativeRootY: -0.005, lift: 0, hold: [2, 1] },
  { phase: "jab_hit", label: "Jab", constraints: "The lead arm is fully extended straight forward at shoulder height, fist closed, lead shoulder raised to protect the chin; the rear fist guards the face. Feet planted in the stance.", relativeRootY: 0, lift: 0, hold: [4, 3] },
  { phase: "jab_return", label: "Jab return", constraints: "The lead fist snaps back halfway toward the chin; the stance is unchanged, rear fist still guarding.", relativeRootY: 0, lift: 0, hold: [2, 1] },
  { phase: "cross_load", label: "Cross load", constraints: "The rear hip and shoulder start rotating forward and the rear heel lifts; the lead fist is back at the chin, the rear fist starts forward.", relativeRootY: -0.005, lift: 0, hold: [2, 1] },
  { phase: "cross_hit", label: "Cross", constraints: "The rear arm is fully extended straight forward at shoulder height, torso rotated forward, rear heel raised and pivoted; the lead fist guards the chin. Feet stay in place.", relativeRootY: 0, lift: 0, hold: [4, 3] },
  { phase: "cross_return", label: "Cross return", constraints: "The rear fist pulls back toward the chin and the torso rotates back toward the stance; feet in place.", relativeRootY: 0, lift: 0, hold: [3, 2] },
  { phase: "guard_bounce", label: "Guard bounce", constraints: "Back in the fighting stance with the knees bent a little more, a small bounce on the balls of the feet; both fists up by the chin.", relativeRootY: -0.02, lift: 0, hold: [3, 2] },
];

// Jump, wave and idle stay on the spot. Heights follow the bob chart: a
// crouch is drawn shorter (relativeRootY), and the airborne drawings float
// above the ground line (lift). The cell has room above the head for a lift
// of about 0.15 of the body height, so the jump stays within it; hands stay
// at or below the top of the head, or the measured height would count them.
const HANDS = "Hands stay at or below the top of the head.";

const JUMP_POSES: readonly PoseSpec[] = [
  { phase: "jump_ready", label: "Ready", constraints: `Standing, side view, knees softly bent, weight on both feet, arms relaxed slightly behind the hips, looking ahead. ${HANDS}`, relativeRootY: -0.04, lift: 0, hold: [3, 2] },
  { phase: "jump_crouch", label: "Crouch", constraints: `A deep crouch to load the jump: knees and hips strongly bent, torso leaning forward, both feet flat on the ground, both arms swung far back behind the body. The body is clearly shorter than standing. ${HANDS}`, relativeRootY: -0.22, lift: 0, hold: [4, 3] },
  { phase: "jump_push", label: "Push off", constraints: `Exploding upward: legs almost straight, rising onto the toes, heels off the ground, torso upright, both arms swinging forward and up to shoulder height. ${HANDS}`, relativeRootY: 0.02, lift: 0, hold: [2, 1] },
  { phase: "jump_rise", label: "Rise", constraints: `Just left the ground: both feet in the air with the toes pointing down, legs straight and together, body stretched tall, arms forward at shoulder height. ${HANDS}`, relativeRootY: 0.02, lift: 0.07, hold: [2, 1] },
  { phase: "jump_apex", label: "Apex", constraints: `The top of the jump: both knees tucked up toward the chest, feet well off the ground, arms forward for balance, hair and clothing floating slightly. The body is compact, clearly shorter than standing. ${HANDS}`, relativeRootY: -0.14, lift: 0.14, hold: [4, 3] },
  { phase: "jump_fall", label: "Fall", constraints: `Coming down: legs extending toward the ground, feet still in the air, arms spread out to the sides for balance, hair and clothing trailing upward. ${HANDS}`, relativeRootY: 0, lift: 0.07, hold: [2, 1] },
  { phase: "jump_land", label: "Land", constraints: `Touchdown: both feet flat on the ground, knees deeply bent to absorb the landing, torso leaning forward, arms forward and down. The body is clearly shorter than standing. ${HANDS}`, relativeRootY: -0.16, lift: 0, hold: [4, 3] },
  { phase: "jump_recover", label: "Recover", constraints: `Rising out of the landing back toward the ready stance: knees half bent, torso upright, arms coming back down beside the hips. ${HANDS}`, relativeRootY: -0.07, lift: 0, hold: [3, 2] },
];

const WAVE_POSES: readonly PoseSpec[] = [
  { phase: "wave_rest", label: "Rest", constraints: "Standing, side view, feet planted, both arms relaxed at the sides, friendly expression.", relativeRootY: 0, lift: 0 },
  { phase: "wave_raise", label: "Raise", constraints: "The arm nearest the viewer lifts in front of the body, elbow bending, hand at chest height, palm open; the other arm stays at the side.", relativeRootY: 0, lift: 0 },
  { phase: "wave_up", label: "Hand up", constraints: `The near arm is raised with the elbow bent at shoulder height, open hand beside the head with the palm facing forward, fingers up. ${HANDS}`, relativeRootY: 0, lift: 0 },
  { phase: "wave_out", label: "Wave out", constraints: `The raised hand tilts outward, away from the head, fingers pointing up and out; the forearm leans clearly away. A small happy lean of the head. ${HANDS}`, relativeRootY: 0.005, lift: 0 },
  { phase: "wave_in", label: "Wave in", constraints: `The raised hand tilts back inward, toward the head, fingers pointing up and in; the forearm leans clearly the other way. ${HANDS}`, relativeRootY: 0, lift: 0 },
  { phase: "wave_out_again", label: "Wave out again", constraints: `Again the raised hand tilts outward, a little wider than before, fingers spread. ${HANDS}`, relativeRootY: 0.005, lift: 0 },
  { phase: "wave_in_again", label: "Wave in again", constraints: `Again the raised hand tilts inward toward the head. ${HANDS}`, relativeRootY: 0, lift: 0 },
  { phase: "wave_lower", label: "Lower", constraints: "The near arm comes back down in front of the body, hand at chest height, relaxing toward the side.", relativeRootY: 0, lift: 0 },
];

const IDLE_POSES: readonly PoseSpec[] = [
  { phase: "idle_rest", label: "Rest", constraints: "Standing at ease, side view, feet planted, arms relaxed at the sides, shoulders loose, eyes open.", relativeRootY: 0, lift: 0 },
  { phase: "idle_inhale", label: "Breathe in", constraints: "Breathing in: the chest rises a little and the shoulders lift slightly; arms hang a touch away from the body.", relativeRootY: 0.006, lift: 0 },
  { phase: "idle_full", label: "Full breath", constraints: "Top of the breath: chest at its fullest, shoulders at their highest, head a little higher.", relativeRootY: 0.012, lift: 0 },
  { phase: "idle_blink", label: "Blink", constraints: "Same as the full breath but the eyes are closed in a blink; everything else unchanged.", relativeRootY: 0.012, lift: 0 },
  { phase: "idle_exhale", label: "Breathe out", constraints: "Breathing out: the chest falls, the shoulders drop, the eyes open again.", relativeRootY: 0.005, lift: 0 },
  { phase: "idle_settle", label: "Settle", constraints: "Bottom of the breath: shoulders relaxed and slightly lowered, knees softly bent, head level.", relativeRootY: -0.008, lift: 0 },
  { phase: "idle_sway", label: "Sway", constraints: "A small weight shift onto the back foot: hips and torso lean back a little, arms swing slightly with it, feet stay in place.", relativeRootY: -0.004, lift: 0 },
  { phase: "idle_return", label: "Return", constraints: "Weight coming back to center, back to the resting stance.", relativeRootY: 0, lift: 0 },
];

const DANCE_POSES: readonly PoseSpec[] = [
  { phase: "dance_center", label: "Center bounce", constraints: `Dancing, facing the selected camera. Feet a shoulder width apart, knees softly bent on the beat, hips centered, both elbows bent and open hands near the waist. A small confident smile. ${HANDS}`, relativeRootY: -0.03, lift: 0 },
  { phase: "dance_reach", label: "Reach right", constraints: `Continue the dance from the center bounce: weight on the right foot, left heel lifted, hips shifting right. Right arm sweeps outward to shoulder height, left forearm lifts diagonally across the chest without covering the face. ${HANDS}`, relativeRootY: -0.01, lift: 0 },
  { phase: "dance_open", label: "Open arms", constraints: `Both arms open in a relaxed curved shape at shoulder height, palms outward, elbows slightly bent. Feet apart, knees spring gently upward, shoulders and chest open toward the camera, hips returning toward center. ${HANDS}`, relativeRootY: 0, lift: 0 },
  { phase: "dance_sway", label: "Sway left", constraints: `Weight flows onto the left foot with the left knee bent, right heel lifts, hips sway left while shoulders counter-rotate gently right. Left hand rises beside the cheek and right arm curves down and outward. No stiff straight limbs. ${HANDS}`, relativeRootY: -0.025, lift: 0 },
  { phase: "dance_point", label: "Point left", constraints: `Continue the leftward dance arc: left arm extends left at shoulder height, right elbow bends with the open hand near the upper chest. Head tips slightly toward the left shoulder, feet stay a shoulder width apart, knees softly bent. ${HANDS}`, relativeRootY: -0.01, lift: 0 },
  { phase: "dance_step", label: "Step right", constraints: `A light side step to the right inside the same small dance area. Weight on the right leg, left foot slides inward without crossing the standing leg. Both hands sweep downward in a shallow arc in front of the hips, shoulders turn gently left. ${HANDS}`, relativeRootY: -0.035, lift: 0 },
  { phase: "dance_cross", label: "Cross and bounce", constraints: `A soft knee bounce with both feet apart again. Both forearms pass loosely across the lower chest, wrists relaxed, elbows point outward. Hips centered and shoulders swing back toward the camera. Hair and tie follow the movement slightly. ${HANDS}`, relativeRootY: -0.04, lift: 0 },
  { phase: "dance_return", label: "Open to center", constraints: `Uncross the arms outward and down, hands returning close to the waist, feet a shoulder width apart, weight shared, knees rising gently from the bounce. This is immediately before the center-bounce pose: maintain the same camera, foot positions and friendly expression so the cycle closes smoothly. ${HANDS}`, relativeRootY: -0.025, lift: 0 },
];

export type ActionSpec = {
  readonly action: AnimationAction;
  /** "walk cycle", for prompts and the interface. */
  readonly label: string;
  readonly poses: readonly PoseSpec[];
  /** Whether the action can carry the character across the stage. */
  readonly travels: boolean;
  /** Stride per cycle: measured from these phases when possible, else this share of body height. */
  readonly stride: { readonly contact: readonly Phase[]; readonly passing: readonly Phase[]; readonly fallback: number } | null;
  /** Drawings per second when the instruction asks for no particular pace. */
  readonly drawingFps: DrawingFps;
  /** Neighboring drawings are meant to be close (a breath, a wave): no "near duplicate" warning. */
  readonly subtle: boolean;
};

export const ACTION_SPECS: Readonly<Record<AnimationAction, ActionSpec>> = {
  walk: { action: "walk", label: "walk cycle", poses: [...half("left"), ...half("right")], travels: true, stride: { contact: ["left_contact", "right_contact"], passing: ["left_passing", "right_passing"], fallback: 0.76 }, drawingFps: 8, subtle: false },
  run: { action: "run", label: "run cycle", poses: [...runHalf("left"), ...runHalf("right")], travels: true, stride: { contact: [], passing: [], fallback: 1.7 }, drawingFps: 12, subtle: false },
  fight: { action: "fight", label: "fighting combo", poses: FIGHT_POSES, travels: false, stride: null, drawingFps: 12, subtle: false },
  jump: { action: "jump", label: "jump", poses: JUMP_POSES, travels: false, stride: null, drawingFps: 12, subtle: false },
  wave: { action: "wave", label: "wave", poses: WAVE_POSES, travels: false, stride: null, drawingFps: 8, subtle: true },
  idle: { action: "idle", label: "idle loop", poses: IDLE_POSES, travels: false, stride: null, drawingFps: 8, subtle: true },
  dance: { action: "dance", label: "dance cycle", poses: DANCE_POSES, travels: false, stride: null, drawingFps: 4, subtle: false },
  // A scene's drawings come from its plan, not from a fixed list of phases.
  ensemble: { action: "ensemble", label: "scene", poses: [], travels: false, stride: null, drawingFps: ENSEMBLE_FPS, subtle: true },
};

export function actionSpec(action: AnimationAction | null | undefined): ActionSpec {
  return ACTION_SPECS[action ?? "walk"];
}

/** The eight drawings of one complete stride, in playback order. Frame 8 leads straight back into frame 1. */
export const WALK_POSES: readonly PoseSpec[] = ACTION_SPECS.walk.poses;
/** Every action has eight drawings. */
export const WALK_FRAME_COUNT = 8;
export const FRAME_COUNT = WALK_FRAME_COUNT;

const POSES_BY_PHASE: ReadonlyMap<string, PoseSpec> = new Map(Object.values(ACTION_SPECS).flatMap((spec) => spec.poses).map((pose) => [pose.phase, pose]));

export function poseFor(phase: Phase): PoseSpec {
  return POSES_BY_PHASE.get(phase)!;
}

// ── Timing ─────────────────────────────────────────────────────────────────

/**
 * The exposure clock: anime holds are counted in 24ths of a second, so a
 * walk on threes keeps each drawing for three of these frames. It is not the
 * frame rate of the video or the preview.
 */
export const EXPOSURE_FPS = 24;
/**
 * The clock of the preview and the MP4: the background, the camera and the
 * root move on every frame, at 60 fps, while the drawings still change on the
 * exposure clock. Drawings are never blended.
 */
export const OUTPUT_FPS = 60;
export const DrawingFpsSchema = z.union([z.literal(4), z.literal(8), z.literal(12), z.literal(24)]);
export type DrawingFps = z.infer<typeof DrawingFpsSchema>;
/** The lengths a cycle is exported at: whole numbers of cycles. */
export const DurationSchema = z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(20)]);
export type FlipbookDuration = z.infer<typeof DurationSchema>;
export const DURATIONS: readonly FlipbookDuration[] = [2, 4, 6, 20];
export const DRAWING_RATES: readonly DrawingFps[] = [4, 8, 12];
/** Any whole number of seconds a scene can last; a cycle only takes the three above. */
export const SceneSecondsSchema = z.number().int().min(MIN_ENSEMBLE_SECONDS).max(MAX_ENSEMBLE_SECONDS);
export const PlaybackSecondsSchema = z.number().int().min(MIN_ENSEMBLE_SECONDS).max(20);

/** Average exposure frames per drawing: 8 drawings/s on a 24 fps exposure clock is "on threes". */
export function holdFrames(drawingFps: DrawingFps): number {
  return EXPOSURE_FPS / drawingFps;
}

/** Exposure frames in an export of this length. */
export function exposureFrameCount(durationSeconds: number): number {
  return durationSeconds * EXPOSURE_FPS;
}

/** Frames written to the MP4 and shown by the player: 60 per second. */
export function outputFrameCount(durationSeconds: number): number {
  return durationSeconds * OUTPUT_FPS;
}

/** Drawing ticks in an export of this length. Every supported length is a whole number of cycles. */
export function tickCount(durationSeconds: number, drawingFps: DrawingFps): number {
  return durationSeconds * drawingFps;
}

/**
 * The exposure sheet: exposure frames each drawing stays on screen, in
 * playback order. Sequence drawings hold until the next one's tick, the last
 * until `totalTicks`. Phases with anime timing (PoseSpec.hold) keep it; a cycle
 * whose holds don't add up to the even total (a partial or foreign set)
 * falls back to even holds, so every length is still a whole number of cycles.
 */
export function exposures(phases: readonly string[], drawingFps: DrawingFps, totalTicks?: number): number[] {
  const even = holdFrames(drawingFps);
  // A sequence's drawings sit at their own ticks: each stays until the next
  // one, the last until the clip ends. Even sequences get even holds; a timing
  // chart gets its holds, eases and ones or twos.
  const ticks = phases.map((phase) => /^sample_\d+$/.test(phase) ? Number(phase.slice(7)) : NaN);
  if (ticks.length && ticks.every((tick, index) => Number.isInteger(tick) && (index === 0 || tick > ticks[index - 1]))) {
    return ticks.map((tick, index) => (ticks[index + 1] ?? Math.max(tick + even, totalTicks ?? 0)) - tick);
  }
  const holds = phases.map((phase) => {
    const hold = POSES_BY_PHASE.get(phase)?.hold;
    return hold ? drawingFps === 4 ? hold[0] * 2 : hold[drawingFps === 8 ? 0 : 1] : even;
  });
  return holds.reduce((sum, hold) => sum + hold, 0) === phases.length * even ? holds : phases.map(() => even);
}

/**
 * The drawing on screen at an exposure frame. `tick` counts the drawings
 * shown since the start; `index` is its
 * place in the cycle. Drawings change in steps: no in-betweening, no blending.
 */
export function drawingAtFrame(outputFrame: number, holds: readonly number[]): { tick: number; index: number } {
  const cycle = holds.reduce((sum, hold) => sum + hold, 0);
  if (!holds.length || cycle <= 0) return { tick: 0, index: 0 };
  const lap = Math.floor((outputFrame + 1e-8) / cycle);
  let rest = Math.max(0, outputFrame - lap * cycle);
  let index = 0;
  while (index < holds.length - 1 && rest + 1e-8 >= holds[index]) rest -= holds[index++];
  return { tick: lap * holds.length + index, index };
}

/**
 * In-betweens occupy their positions within each key's exposure. A dense
 * set fills every slot at 24 drawings/s; partial or legacy sets hold where
 * drawings are missing. Every set keeps the key cycle's original length.
 */
export function exposureSheet<T extends { readonly phase: string; readonly inbetween?: boolean; readonly position?: number }>(drawings: readonly T[], drawingFps: DrawingFps, cycleSeconds?: number, totalTicks?: number): { drawings: T[]; holds: number[] } {
  const keyHolds = exposures(drawings.filter((drawing) => !drawing.inbetween).map((drawing) => drawing.phase), drawingFps, totalTicks);
  const originalLength = keyHolds.reduce((sum, hold) => sum + hold, 0);
  const shown: T[] = [];
  const holds: number[] = [];
  let key = 0;
  for (let index = 0; index < drawings.length; index++) {
    const drawing = drawings[index];
    if (drawing.inbetween) continue;
    const originalDuration = keyHolds[key++];
    const duration = cycleSeconds === undefined ? originalDuration : originalDuration * cycleSeconds * EXPOSURE_FPS / originalLength;
    const slots = new Map<number, T>();
    while (drawings[index + 1]?.inbetween) {
      const middle = drawings[++index];
      // An explicit cycle length retimes every saved pose at its actual
      // fraction. Changing the tempo must not discard poses by rounding
      // them into the old 24 Hz slots.
      const at = cycleSeconds === undefined
        ? middle.position === undefined ? duration - 1 : Math.round(middle.position * duration)
        : (middle.position ?? 0.5) * duration;
      if (at <= 0 || at >= duration) continue;
      const previous = slots.get(at);
      // Several saved densities can share a slot. Prefer the drawing made
      // for that exact time, rather than showing two poses at once.
      if (!previous || Math.abs((middle.position ?? 0.5) - at / duration) < Math.abs((previous.position ?? 0.5) - at / duration)) slots.set(at, middle);
    }
    const timed = [{ at: 0, drawing }, ...[...slots].map(([at, drawing]) => ({ at, drawing })).sort((a, b) => a.at - b.at)];
    for (let slot = 0; slot < timed.length; slot++) {
      shown.push(timed[slot].drawing);
      holds.push((timed[slot + 1]?.at ?? duration) - timed[slot].at);
    }
  }
  return { drawings: shown, holds };
}

/** The first exposure frame of a drawing tick. */
export function frameAtTick(tick: number, holds: readonly number[]): number {
  const cycle = holds.reduce((sum, hold) => sum + hold, 0);
  if (!holds.length) return 0;
  const lap = Math.floor(tick / holds.length);
  const index = tick - lap * holds.length;
  let frame = lap * cycle;
  for (let i = 0; i < index; i++) frame += holds[i];
  return frame;
}

/**
 * The camera clock at an exposure frame, in average drawings. Backgrounds,
 * pans and zooms run on it: they move on every frame, like an anime follow
 * pan, while the character keeps its drawings.
 */
export function stageClock(exposureFrame: number, drawingFps: DrawingFps): number {
  return exposureFrame / holdFrames(drawingFps);
}

/** The exposure frame on screen at an output (60 fps) frame. */
export function exposureFrameAt(outputFrame: number): number {
  return Math.floor((outputFrame * EXPOSURE_FPS) / OUTPUT_FPS);
}

/** The first output frame of a drawing tick: where stepping or picking a drawing lands. */
export function outputFrameAtTick(tick: number, holds: readonly number[]): number {
  return Math.ceil((frameAtTick(tick, holds) * OUTPUT_FPS) / EXPOSURE_FPS - 1e-8);
}

/** The drawing on screen at an output (60 fps) frame. Drawings still change in steps. */
export function drawingAtOutputFrame(outputFrame: number, holds: readonly number[]): { tick: number; index: number } {
  return drawingAtFrame(outputFrame * EXPOSURE_FPS / OUTPUT_FPS, holds);
}

/** A short, bounded temporal filter. It never morphs the character. */
export function poseSmoothingAt(outputFrame: number, holds: readonly number[], strength = 0): { tick: number; index: number; previousIndex: number; previousWeight: number } {
  const pose = drawingAtOutputFrame(outputFrame, holds);
  const elapsed = outputFrame / OUTPUT_FPS - frameAtTick(pose.tick, holds) / EXPOSURE_FPS;
  const window = Math.min(1 / 30, (holds[pose.index] ?? 0) / EXPOSURE_FPS * 0.4);
  const t = window > 0 ? Math.max(0, Math.min(1, elapsed / window)) : 1;
  const eased = t * t * (3 - 2 * t);
  const weight = holds.length > 1 ? Math.max(0, Math.min(0.2, strength)) * (1 - eased) : 0;
  return { ...pose, previousIndex: (pose.index + holds.length - 1) % Math.max(1, holds.length), previousWeight: Math.round(weight * 1e6) / 1e6 };
}

/**
 * The camera clock at an output frame, in average drawings. At 60 fps it
 * advances on every frame, so pans and zooms never judder on a 60 Hz screen.
 */
export function outputClock(outputFrame: number, drawingFps: DrawingFps): number {
  return (outputFrame * drawingFps) / OUTPUT_FPS;
}

/** Camera travel keeps the measured stride per cycle when the tempo changes. */
export function playbackClock(outputFrame: number, settings: Pick<PlaybackSettings, "drawingFps" | "cycleSeconds">, keyCount: number): number {
  return settings.cycleSeconds === undefined ? outputClock(outputFrame, settings.drawingFps) : outputFrame * keyCount / (OUTPUT_FPS * settings.cycleSeconds);
}

/**
 * The clock at a drawing tick's first exposure frame, for pose-boundary
 * calculations. Continuous travel uses outputClock instead.
 */
export function tickClock(tick: number, holds: readonly number[], drawingFps: DrawingFps): number {
  return (frameAtTick(tick, holds) * drawingFps) / EXPOSURE_FPS;
}

// ── Placement ──────────────────────────────────────────────────────────────

/** Walk in place, or the same cycle carried across the stage. */
export const MotionSchema = z.enum(["in_place", "left", "right"]);
export type FlipbookMotion = z.infer<typeof MotionSchema>;
export const DirectionSchema = z.enum(["left", "right"]);
export type FlipbookDirection = z.infer<typeof DirectionSchema>;

export const SPEED_BOUNDS = [0.5, 1.5] as const;

/** Shape of the video: landscape or portrait. Separate from the file format. */
export const AspectSchema = z.enum(["16:9", "9:16"]);
export type FlipbookAspect = z.infer<typeof AspectSchema>;

export const PlaybackSettingsSchema = z.object({
  drawingFps: DrawingFpsSchema,
  /** Playback tempo, independent of how densely the poses were generated. */
  cycleSeconds: z.number().min(0.5).max(8).optional(),
  /** At most 20% of the previous pose, fading within 33 ms. Absent is sharp. */
  smoothing: z.number().min(0).max(0.2).optional(),
  /** A cycle plays 2, 4, 6 or 20 s; a scene always plays its own length (the server holds it to the plan). */
  durationSeconds: PlaybackSecondsSchema,
  motion: MotionSchema,
  /** Landscape (16:9) or portrait (9:16) stage. Drawings saved before this existed are landscape. */
  aspect: AspectSchema.default("16:9"),
  /** Multiplier of the stride measured from the drawings; 1 keeps the feet planted. */
  speed: z.number().min(SPEED_BOUNDS[0]).max(SPEED_BOUNDS[1]),
  /**
   * Legacy: interpolated 60 fps playback was retired because it morphed the
   * drawings. Saved values still parse; every render is drawn.
   */
  renderMode: z.enum(["drawn", "smooth"]).optional(),
  /** Play the current in-betweens between the key drawings. Absent means yes, when there are any. */
  inbetweens: z.boolean().optional(),
});
export type PlaybackSettings = z.infer<typeof PlaybackSettingsSchema>;

export type Cell = { readonly width: number; readonly height: number; readonly strideX: number };

const evenDown = (n: number) => Math.round(n / 2) * 2;
const evenUp = (n: number) => Math.ceil(n / 2) * 2;

/**
 * Stage size: a 16:9 or 9:16 frame that always holds the whole sprite cell.
 * Landscape keeps the cell height and widens; portrait keeps the cell width
 * (or more) and grows taller. Both dimensions are even, as H.264 needs.
 */
export function stageSize(settings: Pick<PlaybackSettings, "aspect">, cell: Pick<Cell, "width" | "height">): { width: number; height: number } {
  if (settings.aspect === "9:16") {
    const height = Math.max(evenUp(cell.height), evenUp((cell.width * 16) / 9));
    return { width: evenUp((height * 9) / 16), height };
  }
  return { width: Math.max(cell.width, evenDown((cell.height * 16) / 9)), height: cell.height };
}

/** Top edge of the sprite cell: it stands on the bottom of the stage, so a portrait frame leaves sky above. */
export function cellTopAt(settings: Pick<PlaybackSettings, "aspect">, cell: Pick<Cell, "width" | "height">): number {
  return stageSize(settings, cell).height - cell.height;
}

/**
 * Left edge of the sprite cell on the stage. `tick` is the continuous camera
 * clock in average key drawings, so travel advances on every output frame,
 * independently of the current pose. It wraps around the stage so
 * a walk across never runs out of room. `frameCount` is the number of keys.
 */
export function cellLeftAt(tick: number, settings: Pick<PlaybackSettings, "motion" | "speed" | "aspect">, cell: Cell, frameCount: number): number {
  const stage = stageSize(settings, cell);
  const center = Math.round((stage.width - cell.width) / 2);
  if (settings.motion === "in_place" || frameCount <= 0) return center;
  const perDrawing = (cell.strideX * settings.speed) / frameCount;
  const direction = settings.motion === "right" ? 1 : -1;
  const span = stage.width + cell.width;
  const raw = center + cell.width + direction * tick * perDrawing;
  return (((raw % span) + span) % span) - cell.width;
}

/** How a scene or generated background moves: still, sliding, sliding in two depths, or a slow zoom. */
export const BackgroundMotionSchema = z.enum(["static", "scroll", "parallax", "zoom"]);
export type BackgroundMotion = z.infer<typeof BackgroundMotionSchema>;

/** The far layer (the sky) slides at this share of the near layer's speed. */
export const PARALLAX_FAR = 0.3;
/** How far a slow zoom pushes in at its deepest point. */
export const ZOOM_DEPTH = 0.06;

/**
 * Scale of a slowly zooming background at a stage clock (stageClock): in
 * from 1 to 1 + ZOOM_DEPTH and back out over the whole length, so the export
 * loops. The clock is fractional, so the zoom moves on every output frame.
 */
export function backgroundZoomAt(clock: number, settings: Pick<PlaybackSettings, "durationSeconds" | "drawingFps" | "cycleSeconds">, keyCount = 8): number {
  const total = settings.durationSeconds * (settings.cycleSeconds === undefined ? settings.drawingFps : keyCount / settings.cycleSeconds);
  const t = (((clock % total) + total) % total) / total;
  return 1 + (ZOOM_DEPTH * (1 - Math.cos(2 * Math.PI * t))) / 2;
}

/** How fast a moving background slides, relative to the stride: full speed in place, a slow pan while travelling. */
const BACKGROUND_PARALLAX = { inPlace: 1, travelling: 0.35 } as const;

/**
 * Horizontal scroll of a moving background at a stage clock (stageClock), in
 * stage pixels (unbounded; wrap it by the plate width). In place, the ground
 * slides back at exactly the stride per cycle. The clock is fractional: the
 * background pans on every output frame while the character holds each
 * drawing, as in an anime follow pan, so the screen never stutters.
 */
export function backgroundShiftAt(clock: number, settings: Pick<PlaybackSettings, "motion" | "speed">, cell: Cell, frameCount: number, facing: FlipbookDirection): number {
  if (frameCount <= 0) return 0;
  const inPlace = settings.motion === "in_place";
  const heading = inPlace ? facing : settings.motion;
  // Actions that don't travel (fight) have no stride: a slow drift.
  const perDrawing = cell.strideX > 0 ? (cell.strideX * (inPlace ? 1 : settings.speed)) / frameCount : cell.width * 0.03;
  const shift = Math.round(clock * perDrawing * (inPlace ? BACKGROUND_PARALLAX.inPlace : BACKGROUND_PARALLAX.travelling));
  return heading === "right" ? shift : -shift;
}

// ── Model output contracts ─────────────────────────────────────────────────

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** What Muse Spark sees in the uploaded character. Unseen details are never facts here. */
export const CharacterAnalysisSchema = z.object({
  characterCount: z.number().int().min(0).max(20),
  /** A short noun phrase SAM 3.1 can segment ("girl", "cartoon fox"). */
  subject: ConceptSchema,
  facing: z.enum(["left", "right", "front", "back", "unclear"]),
  view: z.enum(["side", "three_quarter", "front", "back", "high", "low", "unclear"]),
  fullBodyVisible: z.boolean(),
  feetVisible: z.boolean(),
  background: z.enum(["plain", "simple", "detailed"]),
  style: z.string().max(240),
  hair: z.string().max(240),
  clothing: z.string().max(320),
  accessories: z.array(z.string().max(80)).max(8),
  palette: z.array(Hex).max(8),
  proportions: z.string().max(240),
  requestedAction: z.enum(["walk", "run", "fight", "jump", "wave", "dance", "idle", "gesture", "other", "none"]),
  notes: z.string().max(320).optional(),
});
export type CharacterAnalysis = z.infer<typeof CharacterAnalysisSchema>;

export const AnimationPoseSchema = z.object({
  index: z.number().int().min(0).max(MAX_SEQUENCE_FRAMES - 1),
  phase: PhaseSchema,
  label: z.string().max(40),
  /** Internal visual guide, selected by the planner; absent in older plans. */
  referenceId: PoseIdSchema.optional(),
  /** The canonical constraints plus character-specific detail from Muse Spark. */
  description: z.string().max(900),
  relativeRootY: z.number().min(-0.3).max(0.3),
  /** Feet above the ground line, share of body height (a run's flight). Older plans have none. */
  lift: z.number().min(0).max(0.3).default(0),
});
export type AnimationPose = z.infer<typeof AnimationPoseSchema>;

export const FlipbookPlanSchema = z
  .object({
    mode: z.enum(["cycle", "sequence"]).optional(),
    motionOutline: z.string().max(4000).optional(),
    motionId: z.uuid().optional(),
    action: AnimationActionSchema,
    /** A gallery posture animated through the idle phases; absent in ordinary cycles. */
    poseId: PoseIdSchema.optional(),
    direction: DirectionSchema,
    view: CameraViewSchema.optional(),
    motion: MotionSchema,
    drawingFps: DrawingFpsSchema,
    durationSeconds: PlaybackSecondsSchema,
    loop: z.boolean(),
    /** Pose to pose: the keys and timing chart the drawings follow. Absent in straight-ahead sequences and cycles. */
    timing: TimingChartSchema.optional(),
    poses: z.array(AnimationPoseSchema).min(2).max(MAX_SEQUENCE_FRAMES),
  })
  .superRefine((plan, context) => {
    if (plan.mode === "sequence") {
      const settings = SequenceSettingsSchema.safeParse(plan);
      if (!settings.success || plan.action === ENSEMBLE_ACTION || plan.loop || plan.motion !== "in_place") {
        context.addIssue({ code: "custom", message: "A sequence needs 8, 12 or 24 drawings/s, finite timing and a fixed stage." });
        return;
      }
      // Pose to pose: one drawing per key and in-between, each at its tick on the timing chart.
      const ticks = plan.timing ? timeline(plan.timing).map((drawing) => drawing.tick) : sequenceTicks(settings.data);
      if (plan.timing && plan.timing.durationSeconds !== plan.durationSeconds) context.addIssue({ code: "custom", path: ["timing"], message: "The timing chart must last as long as the sequence." });
      if (plan.poses.length !== ticks.length || plan.poses.some((pose, index) => pose.index !== index || pose.phase !== `sample_${ticks[index]}`)) {
        context.addIssue({ code: "custom", path: ["poses"], message: "Every sequence drawing must have its own ordered absolute timestamp." });
      }
      return;
    }
    if (plan.timing) context.addIssue({ code: "custom", path: ["timing"], message: "Only a sequence is timed pose to pose." });
    if (!plan.loop || plan.drawingFps === 24) context.addIssue({ code: "custom", message: "Legacy cycles retain their original pace and loop." });
    if (plan.action === ENSEMBLE_ACTION) {
      // A scene is one drawing per beat: its length is its duration at the fixed pace.
      if (plan.drawingFps !== ENSEMBLE_FPS || plan.motion !== "in_place") {
        context.addIssue({ code: "custom", path: ["drawingFps"], message: `A scene is drawn at ${ENSEMBLE_FPS} drawings per second, in place.` });
      }
      if (plan.poses.length !== ensembleDrawings(plan.durationSeconds)) {
        context.addIssue({ code: "custom", path: ["poses"], message: `A ${plan.durationSeconds} s scene needs ${ensembleDrawings(plan.durationSeconds)} drawings.` });
      }
      plan.poses.forEach((pose, index) => {
        if (pose.index !== index || pose.phase !== beatPhase(index)) {
          context.addIssue({ code: "custom", path: ["poses", index], message: `pose ${index} must be ${beatPhase(index)}` });
        }
      });
      return;
    }
    if (!DurationSchema.safeParse(plan.durationSeconds).success) {
      context.addIssue({ code: "custom", path: ["durationSeconds"], message: "A cycle lasts 2, 4, 6 or 20 seconds." });
    }
    if (plan.poses.length !== WALK_FRAME_COUNT) {
      context.addIssue({ code: "custom", path: ["poses"], message: `A cycle has ${WALK_FRAME_COUNT} drawings.` });
    }
    if (plan.poseId && (plan.action !== "idle" || plan.motion !== "in_place")) {
      context.addIssue({ code: "custom", path: ["poseId"], message: "A selected pose must use an idle cycle in place." });
    }
    plan.poses.forEach((pose, index) => {
      const expected = ACTION_SPECS[plan.action].poses[index]?.phase;
      if (pose.index !== index || pose.phase !== expected) {
        context.addIssue({ code: "custom", path: ["poses", index], message: `pose ${index} must be ${expected}` });
      }
    });
  });
export type FlipbookPlan = z.infer<typeof FlipbookPlanSchema>;

// ── Frames ─────────────────────────────────────────────────────────────────

/** The eight drawings of a cycle. A scene numbers its drawings f0…f47 (frameIdAt). */
export const FRAME_IDS = ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"] as const;
const INDEX = "(?:[0-9]|[1-3][0-9]|4[0-7])";
export const FrameIdSchema = z.string().refine((value) => new RegExp(`^f${INDEX}$`).test(value) || (/^s(?:0|[1-9][0-9]{0,2})$/.test(value) && Number(value.slice(1)) < MAX_SEQUENCE_FRAMES), "Invalid drawing ID");
export type FrameId = z.infer<typeof FrameIdSchema>;
export function frameIdAt(index: number): FrameId {
  return `f${index}`;
}
/** In-between drawings: "i3" goes after key drawing "f3", toward the key that follows it in playback order. */
export const INBETWEEN_IDS = ["i0", "i1", "i2", "i3", "i4", "i5", "i6", "i7"] as const;
export const InbetweenIdSchema = z.union([z.enum(INBETWEEN_IDS), z.string().regex(/^i[0-7]-(?:[12]of3|[13]of4|[15]of6|[1357]of8)$/)]);
export type InbetweenId = z.infer<typeof InbetweenIdSchema>;
/** Any drawing with files on disk: a key pose or an in-between. */
export const DrawingIdSchema = z.union([FrameIdSchema, InbetweenIdSchema]);
export type DrawingId = z.infer<typeof DrawingIdSchema>;

export function inbetweenAfter(frameId: FrameId): InbetweenId {
  return `i${frameId.slice(1)}` as InbetweenId;
}

/** Stable ids let different playback densities coexist without losing saved drawings. */
export function inbetweenAt(frameId: FrameId, step: number, divisions: number): InbetweenId {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(step, divisions);
  step /= divisor;
  divisions /= divisor;
  return step * 2 === divisions ? inbetweenAfter(frameId) : `${inbetweenAfter(frameId)}-${step}of${divisions}`;
}
export const MAX_INBETWEENS = 88;
export const VersionIdSchema = z.string().regex(/^v-[0-9a-f]{12}$/);

export const FrameWarningCodeSchema = z.enum([
  "subject_cropped",
  "scale_corrected",
  "color_shift",
  "background_not_plain",
  "near_duplicate",
  "overlong_hold",
  "reference_hold_review",
  "exposure_too_long",
  "stride_unclear",
  "body_offset",
  "multiple_subjects",
  "key_extraction",
  "alpha_extraction",
  "cutout_leak",
  /** Video movement: the drawing's silhouette doesn't match the guide's at its tick. */
  "pose_mismatch",
  /** Video movement: the drawing changes much more from its neighbor than the guide does. */
  "motion_jump",
]);
export type FrameWarningCode = z.infer<typeof FrameWarningCodeSchema>;
export const FrameWarningSchema = z.object({ code: FrameWarningCodeSchema, message: z.string().max(240) });
export type FrameWarning = z.infer<typeof FrameWarningSchema>;

export const ReviewIssueCodeSchema = z.enum(["wrong_facing", "identity_change", "missing_limb", "extra_limb", "wrong_pose", "cropped", "style_change", "same_as_neighbor", "other"]);
export const FrameReviewSchema = z.object({
  ok: z.boolean(),
  issues: z.array(z.object({ code: ReviewIssueCodeSchema, note: z.string().max(200) })).max(6),
});
export type FrameReview = z.infer<typeof FrameReviewSchema>;

export const FrameVersionSchema = z.object({
  id: VersionIdSchema,
  /** "imported": a frame of a Reference Motion render, never drawn by Muse Image. */
  source: z.enum(["generated", "uploaded", "enhanced", "imported"]),
  createdAt: z.iso.datetime(),
  /** The user's correction note for a redraw. */
  note: z.string().max(240).optional(),
});

export const FrameMetricsSchema = z.object({
  rawWidth: z.number().int().positive(),
  rawHeight: z.number().int().positive(),
  subjectHeight: z.number().nonnegative(),
  subjectWidth: z.number().nonnegative(),
  /** Subject pixels / image pixels. */
  coverage: z.number().min(0).max(1),
  /** How much the frame was scaled to match the cycle (1 = unchanged relative to the others). */
  relativeScale: z.number().positive(),
  /** Histogram distance from the reference character, 0–1. */
  colorDistance: z.number().min(0).max(1).nullable(),
  extraction: z.enum(["sam", "key", "alpha"]),
});
export type FrameMetrics = z.infer<typeof FrameMetricsSchema>;

export const FrameStatusSchema = z.enum(["pending", "generating", "processing", "ready", "failed"]);
export type FrameStatus = z.infer<typeof FrameStatusSchema>;

export const FlipbookFrameSchema = z.object({
  id: FrameIdSchema,
  poseIndex: z.number().int().min(0).max(MAX_SEQUENCE_FRAMES - 1),
  phase: PhaseSchema,
  label: z.string().max(40),
  status: FrameStatusSchema,
  approved: z.boolean(),
  /** The drawing shown and exported. */
  version: VersionIdSchema.nullable(),
  /** The first generated drawing, for "Restore original". */
  originalVersion: VersionIdSchema.nullable(),
  versions: z.array(FrameVersionSchema).max(32),
  metrics: FrameMetricsSchema.nullable(),
  warnings: z.array(FrameWarningSchema).max(12),
  review: FrameReviewSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type FlipbookFrame = z.infer<typeof FlipbookFrameSchema>;

export const ReferenceSchema = z.object({
  kind: z.enum(["original", "clean", "uploaded"]),
  version: VersionIdSchema,
  reason: z.string().max(240),
  createdAt: z.iso.datetime(),
});
export type FlipbookReference = z.infer<typeof ReferenceSchema>;

/** Extra images of the same character (another angle, the back of the outfit) sent beside the anchor with every drawing. */
export const MAX_EXTRA_REFERENCES = 3;
export const ExtraReferenceSchema = z.object({
  version: VersionIdSchema,
  name: z.string().max(80),
  createdAt: z.iso.datetime(),
});
export type FlipbookExtraReference = z.infer<typeof ExtraReferenceSchema>;

export const FrameTransformSchema = z.object({
  version: VersionIdSchema,
  scale: z.number().positive(),
  left: z.number().int(),
  top: z.number().int(),
  /** Names the aligned sprite file; changes whenever its pixels would. */
  key: z.string().regex(/^[0-9a-f]{16}$/),
});

export const AlignmentSchema = z.object({
  cellWidth: z.number().int().positive(),
  cellHeight: z.number().int().positive(),
  baselineY: z.number().int().positive(),
  targetHeight: z.number().int().positive(),
  /** Horizontal travel of one full cycle, measured from the contact and passing drawings. */
  strideX: z.number().nonnegative(),
  strideMeasured: z.boolean(),
  /** Key drawings and in-betweens, registered on the same cell. */
  transforms: z.partialRecord(DrawingIdSchema, FrameTransformSchema),
});
export type FlipbookAlignment = z.infer<typeof AlignmentSchema>;

/**
 * One in-between drawing: a pose along the arc from one key drawing to the next,
 * drawn from both. It remembers which drawings it was made from; when either
 * key is redrawn or the order changes, it is stale and stops playing until it
 * is drawn again.
 */
export const InbetweenSchema = z.object({
  id: InbetweenIdSchema,
  from: FrameIdSchema,
  to: FrameIdSchema,
  fromVersion: VersionIdSchema,
  toVersion: VersionIdSchema,
  /** Progress along the arc between the keys. Older drawings are halfway. */
  position: z.number().gt(0).lt(1).optional(),
  status: z.enum(["generating", "processing", "ready", "failed"]),
  version: VersionIdSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type Inbetween = z.infer<typeof InbetweenSchema>;

// ── Export ─────────────────────────────────────────────────────────────────

export const ExportFormatSchema = z.enum(["mp4", "gif", "spritesheet", "frames"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;
export const BackgroundFitSchema = z.enum(["contain", "cover"]);
export type BackgroundFit = z.infer<typeof BackgroundFitSchema>;

/** Center an entire image by default; filling the stage is an explicit crop. */
export function backgroundImageRect(stage: { width: number; height: number }, image: { width: number; height: number }, fit: BackgroundFit = "contain", zoom = 1): { left: number; top: number; width: number; height: number } {
  const scale = (fit === "cover" ? Math.max : Math.min)(stage.width / image.width, stage.height / image.height) * zoom;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  return { left: Math.floor((stage.width - width) / 2), top: Math.floor((stage.height - height) / 2), width, height };
}

export const BackgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transparent") }),
  z.object({ kind: z.literal("color"), color: Hex }),
  /** Muse Image's character-free plate of the uploaded scene, generated once: still, or scrolling. Older looks have no motion (still). */
  z.object({ kind: z.literal("scene"), motion: BackgroundMotionSchema.optional(), fit: BackgroundFitSchema.optional() }),
  z.object({ kind: z.literal("custom"), fit: BackgroundFitSchema.optional() }),
  /** A setting Muse Image drew for a character without one: still, or scrolling behind the cycle. */
  z.object({ kind: z.literal("generated"), motion: BackgroundMotionSchema, fit: BackgroundFitSchema.optional() }),
]);
export type FlipbookBackground = z.infer<typeof BackgroundSchema>;
/** The motion of a background that can move; transparent, color and an uploaded image stand still. */
export function backgroundMotion(background: FlipbookBackground): BackgroundMotion {
  return background.kind === "generated" || background.kind === "scene" ? background.motion ?? "static" : "static";
}

/** Whether a background slides behind the cycle (one or two seamless strips). */
export function backgroundScrolls(background: FlipbookBackground): boolean {
  const motion = backgroundMotion(background);
  return motion === "scroll" || motion === "parallax";
}

/** Whether a background changes over time at all: then a GIF needs the whole length, not one cycle. */
export function backgroundMoves(background: FlipbookBackground): boolean {
  return backgroundMotion(background) !== "static";
}
export const BACKGROUND_PROMPT_MAX = 240;

export const ExportRequestSchema = z.object({
  format: ExportFormatSchema,
  settings: PlaybackSettingsSchema,
  background: BackgroundSchema,
});
export type ExportRequest = z.infer<typeof ExportRequestSchema>;

export const ExportRecordSchema = z.object({
  key: z.string().regex(/^x-[0-9a-f]{16}$/),
  format: ExportFormatSchema,
  settings: PlaybackSettingsSchema,
  background: BackgroundSchema,
  files: z.array(z.object({ name: z.string().max(80), type: z.string().max(60), bytes: z.number().int().nonnegative(), url: z.string() })).min(1).max(129),
  /** What verification measured on the written files. */
  facts: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frames: z.number().int().positive(),
    durationSeconds: z.number().nonnegative().nullable(),
    fps: z.number().positive().optional(),
  }),
  createdAt: z.iso.datetime(),
});
export type ExportRecord = z.infer<typeof ExportRecordSchema>;

// ── The flipbook ───────────────────────────────────────────────────────────

export const FlipbookStatusSchema = z.enum([
  "awaiting_motion",
  "analyzing",
  "planning",
  "referencing",
  "reference_ready",
  "generating",
  "preparing",
  "checking",
  "ready",
  "unsupported",
  "failed",
  "canceled",
]);
export type FlipbookStatus = z.infer<typeof FlipbookStatusSchema>;
export const ACTIVE_FLIPBOOK_STATUSES: readonly FlipbookStatus[] = ["analyzing", "planning", "referencing", "generating", "preparing", "checking"];

export const FLIPBOOK_TITLE_MAX = 80;

/** One of the characters drawn together in a scene: the exact saved version, and what Muse Spark saw in it. */
export const CastMemberSchema = CharacterSourceSchema.extend({
  name: z.string().max(80),
  versionName: z.string().max(60),
  analysis: CharacterAnalysisSchema.nullable(),
});
export type CastMember = z.infer<typeof CastMemberSchema>;

/**
 * Frames that came from outside Muse Image: they can be replaced or reordered,
 * not redrawn. A Reference Motion render, or a Rotoscope run used as the
 * sandbox before Flipbook.
 */
export const ImportedFromSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reference-motion"),
    jobId: z.uuid(),
    engine: z.string().max(40),
    /** The test engine's output: a pipeline check, not an animation. */
    synthetic: z.boolean(),
  }),
  z.object({
    kind: z.literal("rotoscope"),
    runId: z.uuid(),
    /** The run's frame rate; the frames were resampled to Flipbook's 24ths. */
    fps: z.number().int().min(1).max(24),
  }),
]);

export type ImportedFrom = z.infer<typeof ImportedFromSchema>;

/** What the frames were imported from, for copy and error messages. */
export function importedFromLabel(importedFrom: ImportedFrom): string {
  return importedFrom.kind === "rotoscope" ? "Rotoscope" : "Reference Motion";
}

/** Where an imported animation came from, to go back to it. */
export function importedFromUrl(importedFrom: ImportedFrom): string {
  return importedFrom.kind === "rotoscope" ? `/rotoscope?run=${importedFrom.runId}` : `/animate?job=${importedFrom.jobId}`;
}

export const FlipbookSchema = z.object({
  importedFrom: ImportedFromSchema.optional(),
  motionSource: z.literal("video").optional(),
  motionNote: z.string().max(400).optional(),
  requestedKeepScene: z.boolean().optional(),
  queuedDrawings: z.array(FrameIdSchema).max(MAX_SEQUENCE_FRAMES).optional(),
  sequence: SequenceSettingsSchema.optional(),
  audio: FlipbookAudioSchema.nullable().optional(),
  motionReference: MotionReferenceSchema.nullable().optional(),
  motionDraft: MotionReferenceSchema.nullable().optional(),
  revisions: z.array(z.object({
    prompt: z.string().max(3000).optional(),
    motionNote: z.string().max(400).optional(),
    requestedView: ViewPreferenceSchema.optional(),
    id: VersionIdSchema,
    createdAt: z.iso.datetime(),
    plan: FlipbookPlanSchema,
    frames: z.array(FlipbookFrameSchema).max(MAX_SEQUENCE_FRAMES),
    order: z.array(FrameIdSchema).max(MAX_SEQUENCE_FRAMES),
    alignment: AlignmentSchema.nullable(),
    motionReference: MotionReferenceSchema.nullable().optional(),
  })).max(20).optional(),
  id: FlipbookIdSchema,
  imageId: FlipbookImageIdSchema,
  /** The account it is saved to. Saved animations skip the 24-hour cleanup. */
  ownerId: z.uuid().nullable().default(null),
  characterSource: CharacterSourceSchema.extend({ name: z.string().max(80), versionName: z.string().max(60) }).optional(),
  /** The characters of a scene, in the order they were picked. Empty for a single character. */
  cast: z.array(CastMemberSchema).max(MAX_CAST).default([]),
  requestedView: ViewPreferenceSchema.optional(),
  title: z.string().max(FLIPBOOK_TITLE_MAX).default(""),
  prompt: z.string().max(3000),
  poseId: PoseIdSchema.optional(),
  status: FlipbookStatusSchema,
  /** The real step running now. */
  detail: z.string().max(240).nullable(),
  /** Counted work inside the current step (drawings generated, sprites cut out). Never estimated. */
  progress: z.object({ done: z.number().int().nonnegative(), total: z.number().int().positive() }).nullable(),
  source: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), hasAlpha: z.boolean() }),
  analysis: CharacterAnalysisSchema.nullable(),
  plan: FlipbookPlanSchema.nullable(),
  /** Input caveats: what may make the result unreliable. */
  warnings: z.array(z.string().max(240)).max(8),
  reference: ReferenceSchema.nullable(),
  /** Saved animations from before extra references existed have none. */
  extraReferences: z.array(ExtraReferenceSchema).max(MAX_EXTRA_REFERENCES).default([]),
  frames: z.array(FlipbookFrameSchema).max(MAX_SEQUENCE_FRAMES),
  /** Playback order, by frame id. */
  order: z.array(FrameIdSchema).max(MAX_SEQUENCE_FRAMES),
  alignment: AlignmentSchema.nullable(),
  /** Saved animations from before in-betweens existed have none. */
  inbetweens: z.array(InbetweenSchema).max(MAX_INBETWEENS).default([]),
  budget: z.object({ limit: z.number().int().nonnegative(), used: z.number().int().nonnegative() }),
  backgrounds: z.object({
    scene: z.boolean(),
    custom: z.boolean(),
    /** A picture of a place the person gave to inspire the next generated background. */
    reference: z.boolean().default(false),
    generated: z.object({ prompt: z.string().max(BACKGROUND_PROMPT_MAX), createdAt: z.iso.datetime() }).nullable().default(null),
    /** Whether the plate was split into a far layer (the sky) and a near one, for parallax. */
    depth: z.object({ scene: z.boolean(), generated: z.boolean() }).default({ scene: false, generated: false }),
  }),
  /** The last playback settings and background picked, so a saved animation reopens as it was left. */
  look: z.object({ settings: PlaybackSettingsSchema, background: BackgroundSchema }).nullable().default(null),
  review: z.object({ summary: z.string().max(400), recognizableWalk: z.boolean(), at: z.iso.datetime() }).nullable(),
  exports: z.array(ExportRecordSchema).max(24),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Flipbook = z.infer<typeof FlipbookSchema>;

/** Several saved characters, one scene: what happens, and for how many seconds. */
export const CreateEnsembleRequestSchema = z.object({
  cast: z.array(CharacterSourceSchema).min(MIN_CAST).max(MAX_CAST),
  view: ViewPreferenceSchema.optional(),
  prompt: z.string().trim().min(3).max(500),
  seconds: SceneSecondsSchema,
}).refine((input) => new Set(input.cast.map((member) => `${member.characterId}:${member.versionId}`)).size === input.cast.length, { path: ["cast"], message: "Each character version can be in the scene once." });
export type CreateEnsembleRequest = z.infer<typeof CreateEnsembleRequestSchema>;

export const CreateFlipbookRequestSchema = z.object({
  motionSource: z.literal("video").optional(),
  motionNote: z.string().max(400).optional(),
  sequence: SequenceSettingsSchema.optional(),
  imageId: FlipbookImageIdSchema.optional(),
  characterSource: CharacterSourceSchema.optional(),
  view: ViewPreferenceSchema.optional(),
  prompt: z.string().trim().min(3).max(3000),
  /** The motion picked from the reading; with it, the reading's character facts are reused. */
  action: CycleActionSchema.optional(),
  poseId: PoseIdSchema.optional(),
  /** Separate the uploaded scene from the character and use it as the background (one drawing). */
  keepScene: z.boolean().optional(),
}).refine((input) => !input.motionSource || Boolean(input.sequence && !input.action && !input.poseId && !input.view), { path: ["motionSource"], message: "Video movement needs a continuous sequence without a preset action or camera override." }).refine((input) => Boolean(input.imageId) !== Boolean(input.characterSource), { path: ["imageId"], message: "Choose an upload or a character version." }).refine((input) => !input.poseId || !input.action || input.action === "idle", {
  path: ["poseId"], message: "A selected pose uses an idle cycle.",
});

// ── Reading an upload ──────────────────────────────────────────────────────

export const IdeaDirectionSchema = z.enum(["left", "right", "in_place"]);
export type IdeaDirection = z.infer<typeof IdeaDirectionSchema>;

export const ImageIdeaSchema = z.object({ action: CycleActionSchema, direction: IdeaDirectionSchema, detail: z.string().max(80) });
export type ImageIdea = z.infer<typeof ImageIdeaSchema>;

/** What Focus saw in an upload before anything was asked: the character, the scene, motions that suit it, and its layers. */
export const ImageLookSchema = z.object({
  imageId: FlipbookImageIdSchema,
  summary: z.string().max(240),
  setting: z.string().max(120).nullable(),
  analysis: CharacterAnalysisSchema,
  /** Caveats about the input, said before anything is drawn. */
  warnings: z.array(z.string().max(240)).max(8),
  ideas: z.array(ImageIdeaSchema).max(3),
  /** The character cut out, and the scene with the character's place emptied (a preview: the plate is redrawn on create). */
  layers: z.object({ character: z.boolean(), scene: z.boolean() }),
});
export type ImageLook = z.infer<typeof ImageLookSchema>;

export const imageUrls = {
  look: (id: string) => `/api/flipbooks/images/${id}/look`,
  layer: (id: string, layer: "character" | "scene") => `/api/flipbooks/images/${id}?layer=${layer}`,
};

export const FrameActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("regenerate"), note: z.string().trim().max(240).optional(), confirmExtra: z.boolean().optional() }),
  /** Muse Image repairs the current drawing: same pose, with the generation's mistakes fixed. */
  z.object({ action: z.literal("enhance"), note: z.string().trim().max(240).optional(), confirmExtra: z.boolean().optional() }),
  z.object({ action: z.literal("restore") }),
  z.object({ action: z.literal("approve"), approved: z.boolean() }),
]);
export type FrameAction = z.infer<typeof FrameActionSchema>;

/** The same attention state drives the timeline badge and the repair action. */
export function frameNeedsAttention(frame: FlipbookFrame): boolean {
  return frame.warnings.length > 0 || Boolean(frame.review && (!frame.review.ok || frame.review.issues.length)) || Boolean(frame.error);
}

export function repairableFrames(flipbook: Pick<Flipbook, "frames">): FlipbookFrame[] {
  return flipbook.frames.filter((frame) => frame.status === "ready" && frame.version && !frame.approved && (
    frame.warnings.some((warning) => warning.code !== "exposure_too_long" && warning.code !== "reference_hold_review") || Boolean(frame.review && (!frame.review.ok || frame.review.issues.length)) || Boolean(frame.error)
  ));
}

export const FlipbookActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry"), confirmExtra: z.boolean().optional() }),
  z.object({ action: z.literal("enhance_flagged"), confirmExtra: z.boolean().optional() }),
  z.object({ action: z.literal("sequence"), settings: SequenceSettingsSchema }),
  z.object({ action: z.literal("revision"), id: VersionIdSchema }),
  /** Draw every frame that has no drawing yet (first run after a reference check, or after failures). */
  z.object({ action: z.literal("generate"), confirmExtra: z.boolean().optional() }),
  /** Fill the exposure slots for a pace; older requests draw one midpoint per key. */
  z.object({ action: z.literal("inbetweens"), drawingFps: DrawingFpsSchema.optional(), confirmExtra: z.boolean().optional() }),
  z.object({ action: z.literal("reorder"), order: z.array(FrameIdSchema).min(WALK_FRAME_COUNT).max(MAX_FRAMES) }),
  z.object({ action: z.literal("reference"), kind: z.enum(["original", "clean"]), confirmExtra: z.boolean().optional() }),
  z.object({ action: z.literal("scene"), confirmExtra: z.boolean().optional() }),
  /** Draw a new setting behind the character (one drawing). */
  z.object({ action: z.literal("background"), prompt: z.string().trim().max(BACKGROUND_PROMPT_MAX).optional(), confirmExtra: z.boolean().optional() }),
  z.object({ action: z.literal("look"), settings: PlaybackSettingsSchema, background: BackgroundSchema }),
  z.object({ action: z.literal("review") }),
  z.object({ action: z.literal("cancel") }),
]);
export type FlipbookAction = z.infer<typeof FlipbookActionSchema>;

export const UpdateFlipbookRequestSchema = z.object({ title: z.string().trim().min(1).max(FLIPBOOK_TITLE_MAX).optional() });

/** Hands the animation to the video editor as an MP4 clip. */
export const SendToEditorRequestSchema = z.object({ settings: PlaybackSettingsSchema, background: BackgroundSchema });

/** A saved animation as the sidebar lists it. */
export const FlipbookSummarySchema = z.object({
  id: FlipbookIdSchema,
  title: z.string().max(FLIPBOOK_TITLE_MAX),
  action: AnimationActionSchema.nullable(),
  status: FlipbookStatusSchema,
  frames: z.number().int().nonnegative(),
  /** How many drawings the animation has when complete: eight, or a scene's duration at its pace. */
  total: z.number().int().positive().default(WALK_FRAME_COUNT),
  posterUrl: z.string(),
  updatedAt: z.iso.datetime(),
});
export type FlipbookSummary = z.infer<typeof FlipbookSummarySchema>;

export function flipbookTitle(flipbook: Pick<Flipbook, "title" | "prompt">): string {
  if ((!flipbook.title || flipbook.title === flipbook.prompt.slice(0, FLIPBOOK_TITLE_MAX)) && flipbook.prompt.startsWith("Animate the selected character by following the single performer's movement in the supplied video segment")) return "Video movement";
  return flipbook.title || flipbook.prompt.slice(0, FLIPBOOK_TITLE_MAX) || "Untitled animation";
}

// ── URLs ───────────────────────────────────────────────────────────────────

export type BackgroundMedia = "scene" | "scene-loop" | "scene-far" | "scene-near" | "custom" | "bg-reference" | "generated" | "generated-loop" | "generated-far" | "generated-near";

export const flipbookUrls = {
  source: (id: string) => `/api/flipbooks/${id}/media?kind=source`,
  extraReference: (id: string, version: string) => `/api/flipbooks/${id}/media?kind=extra&v=${version}`,
  reference: (id: string, version: string) => `/api/flipbooks/${id}/media?kind=reference&v=${version}`,
  raw: (id: string, frame: string, version: string) => `/api/flipbooks/${id}/media?kind=raw&frame=${frame}&v=${version}`,
  sprite: (id: string, frame: string, key: string) => `/api/flipbooks/${id}/media?kind=sprite&frame=${frame}&a=${key}`,
  background: (id: string, which: BackgroundMedia, stamp: string) => `/api/flipbooks/${id}/media?kind=${which}&t=${encodeURIComponent(stamp)}`,
  contactSheet: (id: string, stamp: string) => `/api/flipbooks/${id}/media?kind=contact&t=${encodeURIComponent(stamp)}`,
  export: (id: string, key: string, name: string) => `/api/flipbooks/${id}/media?kind=export&x=${key}&name=${encodeURIComponent(name)}`,
};

/** The frames in playback order, skipping ids the order no longer names. */
export function orderedFrames(flipbook: Pick<Flipbook, "frames" | "order">): FlipbookFrame[] {
  return flipbook.order.map((id) => flipbook.frames.find((frame) => frame.id === id)).filter((frame): frame is FlipbookFrame => Boolean(frame));
}

/** The key drawing that follows a frame in playback order: an in-between goes toward it. */
export function nextInOrder(flipbook: Pick<Flipbook, "order">, frameId: FrameId): FrameId {
  const at = flipbook.order.indexOf(frameId);
  return flipbook.order[(at + 1) % flipbook.order.length];
}

/** Whether an in-between is registered and still sits between the drawings it was made from. */
export function inbetweenCurrent(flipbook: Pick<Flipbook, "frames" | "order" | "alignment">, inbetween: Inbetween): boolean {
  if (inbetween.status !== "ready" || !inbetween.version) return false;
  if (flipbook.alignment?.transforms[inbetween.id]?.version !== inbetween.version) return false;
  if (!flipbook.order.includes(inbetween.from) || nextInOrder(flipbook, inbetween.from) !== inbetween.to) return false;
  const version = (frameId: FrameId) => flipbook.frames.find((frame) => frame.id === frameId)?.version;
  return version(inbetween.from) === inbetween.fromVersion && version(inbetween.to) === inbetween.toVersion;
}

/** Key drawings whose in-between is missing, failed or no longer matches its keys: what "Add in-betweens" draws. */
export function inbetweenTargets(flipbook: Pick<Flipbook, "frames" | "order" | "alignment" | "inbetweens">): FrameId[] {
  return orderedFrames(flipbook).filter((frame) => {
    const inbetween = flipbook.inbetweens.find((entry) => entry.id === inbetweenAfter(frame.id));
    return !inbetween || !inbetweenCurrent(flipbook, inbetween);
  }).map((frame) => frame.id);
}

export type InbetweenTarget = { readonly id: InbetweenId; readonly from: FrameId; readonly position: number };

/** Fill every exposure slot: 24 distinct drawings/s without shortening the cycle. */
export function denseInbetweenTargets(flipbook: Pick<Flipbook, "frames" | "order" | "alignment" | "inbetweens">, drawingFps: DrawingFps): InbetweenTarget[] {
  const frames = orderedFrames(flipbook);
  const holds = exposures(frames.map((frame) => frame.phase), drawingFps);
  return frames.flatMap((frame, index) => Array.from({ length: holds[index] - 1 }, (_, offset) => {
    const step = offset + 1;
    return { id: inbetweenAt(frame.id, step, holds[index]), from: frame.id, position: step / holds[index] };
  })).filter((target) => {
    const current = flipbook.inbetweens.find((entry) => entry.id === target.id);
    return !current || !inbetweenCurrent(flipbook, current);
  });
}

/** A drawing of the played cycle: a key pose, or the in-between after one. */
export type CycleDrawing = { readonly id: DrawingId; readonly phase: string; readonly label: string; readonly inbetween: boolean; readonly position?: number };

/** The played cycle: key drawings in order, each followed by its current in-between when in-betweens are on. */
export function playbackCycle(flipbook: Pick<Flipbook, "frames" | "order" | "alignment" | "inbetweens">, useInbetweens: boolean): CycleDrawing[] {
  const cycle: CycleDrawing[] = [];
  for (const frame of orderedFrames(flipbook)) {
    cycle.push({ id: frame.id, phase: frame.phase, label: frame.label, inbetween: false });
    const middles = useInbetweens ? flipbook.inbetweens.filter((entry) => entry.from === frame.id && inbetweenCurrent(flipbook, entry)).sort((a, b) => (a.position ?? 0.5) - (b.position ?? 0.5)) : [];
    for (const inbetween of middles) {
      const to = flipbook.frames.find((entry) => entry.id === inbetween.to);
      cycle.push({ id: inbetween.id, phase: frame.phase, label: `${frame.label} → ${to?.label ?? ""}`, inbetween: true, position: inbetween.position ?? 0.5 });
    }
  }
  return cycle;
}
