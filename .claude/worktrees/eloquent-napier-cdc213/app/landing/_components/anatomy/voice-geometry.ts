import {
  cameraOf,
  corners,
  cylinder,
  fitProjection,
  insetPlan,
  iso,
  knurl,
  onTop,
  pathOf,
  planOutline,
  ring,
  sideArc,
  slabOf,
  translateAlong,
  type Flat,
  type Plan,
  type Plane,
  type Point3,
} from "@/components/iso/iso-kit";
import { around, barBetween, roundAlong } from "./solids";
import { BANDS, VOICES } from "./voice-model";

/**
 * Fig 05.5, built once: a desk telephone wired to a kymograph, on a bench.
 *
 * World units are about a pixel of the real thing: x and y on the bench, z
 * up. The handset lifts and the pen carriage climbs by translates; the drum's
 * turn shows in what is written on it, which is drawn each frame from the
 * pens' record, and in the marks on its cap.
 */

export const WIDTH = 600;
/** The capability cards' frame: 400 × 268, at this width. */
export const HEIGHT = 402;
const AZIMUTH = 50;
const ELEVATION = 32;
const RAD = Math.PI / 180;

const BENCH: Plan = { x: 0, y: 0, w: 122, d: 76, r: 8 };
const BASE_H = 7;
const FOOT_H = 4;

// ── the kymograph ─────────────────────────────────────────────────────

export const DRUM: Plane = [76, 32];
export const DRUM_R = 13;
const CLOCK: Plan = { x: DRUM[0] - 14, y: DRUM[1] - 14, w: 28, d: 28, r: 3 };
const CLOCK_TOP = 6;
export const DRUM_Z0 = CLOCK_TOP + 2.4;
export const DRUM_Z1 = DRUM_Z0 + 24;
/** The angle round the drum that faces the viewer. */
export const FACING = AZIMUTH * RAD;
/** Where the pens touch the drum: to the right of its front, where the stand can reach. */
export const PEN_ANGLE = FACING - 38 * RAD;
/** Each call's band: its centre height, then the caller's line above it and the agent's below. */
export const BAND_Z = Array.from({ length: BANDS }, (_, band) => DRUM_Z0 + 5 + band * 7);
export const LINE_GAP = 1.7;
export const AMPLITUDE = 1.1;

// ── the telephone ──────────────────────────────────────────────────────

const PHONE: Plan = { x: 14, y: 44, w: 26, d: 18, r: 3 };
const JACK: Plan = { x: 10, y: 20, w: 10, d: 7, r: 1.2 };
const PHONE_TOP = 7;
const DIAL: Plane = [PHONE.x + PHONE.w / 2 + 2, PHONE.y + PHONE.d / 2 + 2.6];
const HOOKS: Plane[] = [
  [PHONE.x + 3.6, PHONE.y + 4.4],
  [PHONE.x + PHONE.w - 3.6, PHONE.y + 4.4],
];
const HANDSET_Z = PHONE_TOP + 5.4;
/** How far the handset lifts off its hooks when the agent answers. */
export const PICK = 7;

// ── the selector ───────────────────────────────────────────────────────

const SELECTOR: Plan = { x: 52, y: 58, w: 26, d: 11, r: 2 };
const SELECTOR_TOP = 5.4;
const KNOB: Plane = [SELECTOR.x + 6.4, SELECTOR.y + SELECTOR.d / 2];
/** Where the knob's pointer stands for each voice: a quarter-turn sweep, a detent each. */
export const VOICE_ANGLE = VOICES.map((_, voice) => (-135 + voice * 30) * RAD);

// ── the projection ─────────────────────────────────────────────────────

const box = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

export const P = fitProjection(
  [...box(BENCH, -BASE_H - FOOT_H, 0), [DRUM[0], DRUM[1] - DRUM_R, DRUM_Z1 + 4], [DIAL[0], PHONE.y + 2, HANDSET_Z + PICK + 4], [104, 18, 40]],
  WIDTH,
  HEIGHT,
  { pad: 24, azimuth: AZIMUTH, elevation: ELEVATION },
);

const at = (point: Point3): Flat => iso(point, P);
const slab = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const post = (x: number, y: number, r: number, z: number, h: number, steps = 24, bevel = 0) => cylinder(x, y, r, z, h, P, steps, bevel);
const join = (paths: string[]) => paths.join("");
export const shift = (by: Point3) => translateAlong(P, by);

// ── the bench ──────────────────────────────────────────────────────────

const SCREWS = corners(BENCH, 6);
const LABEL: Plan = { x: BENCH.x + BENCH.w - 24, y: BENCH.y + BENCH.d - 15, w: 14, d: 9, r: 1 };
export const BENCH_ART = {
  halo: slab(BENCH, -BASE_H - FOOT_H, BASE_H, 8).fill,
  feet: corners(BENCH, 15).map(([x, y]) => [post(x, y, 6.5, -BASE_H - FOOT_H, 1.4, 28), post(x, y, 5, -BASE_H - FOOT_H + 1.4, FOOT_H - 1.4, 28)]),
  slab: slab(BENCH, -BASE_H, BASE_H, 8, 1.6),
  groove: planOutline(insetPlan(BENCH, 4), 0, P),
  screwRings: join(SCREWS.map(([x, y]) => ring(x, y, 2, 0, P, 16))),
  screws: SCREWS.map(([x, y]) => at([x, y, 0])),
  label: slab(LABEL, 0, 0.8, 4),
  labelLine: planOutline(insetPlan(LABEL, 1.4), 0.8, P, 4),
  labelRules: join([0, 1, 2].map((row) => onTop([[LABEL.x + 3.4, LABEL.y + 3.4 + row * 1.8], [LABEL.x + (row === 1 ? 7 : 9.4), LABEL.y + 3.4 + row * 1.8]], 0.8, P))),
  labelScrews: [at([LABEL.x + 2.4, LABEL.y + LABEL.d - 2.2, 0.8]), at([LABEL.x + LABEL.w - 2.4, LABEL.y + LABEL.d - 2.2, 0.8])],
  /**
   * The cords along the bench: the telephone's to the recorder, the
   * selector's to the telephone, and the line in from the wall jack, each
   * leaving its box through a sleeve and bent round its corners.
   */
  phoneCord: [
    at([PHONE.x + PHONE.w + 1, PHONE.y + 9, 2.2]),
    at([PHONE.x + PHONE.w + 3.4, PHONE.y + 9, 2.2]),
    at([PHONE.x + PHONE.w + 3.4, PHONE.y + 9, 0.6]),
    at([CLOCK.x + 4, PHONE.y + 9, 0.6]),
    at([CLOCK.x + 4, CLOCK.y + CLOCK.d + 1.4, 0.6]),
  ],
  selectorCord: [
    at([SELECTOR.x - 1, PHONE.y + PHONE.d - 2, 2.2]),
    at([SELECTOR.x - 3.4, PHONE.y + PHONE.d - 2, 2.2]),
    at([SELECTOR.x - 3.4, PHONE.y + PHONE.d - 2, 0.6]),
    at([PHONE.x + PHONE.w + 3.4, PHONE.y + PHONE.d - 2, 0.6]),
    at([PHONE.x + PHONE.w + 3.4, PHONE.y + PHONE.d - 2, 2.2]),
    at([PHONE.x + PHONE.w + 1, PHONE.y + PHONE.d - 2, 2.2]),
  ],
  lineCord: [
    at([JACK.x + JACK.w / 2, JACK.y + JACK.d + 1, 2.2]),
    at([JACK.x + JACK.w / 2, JACK.y + JACK.d + 3, 2.2]),
    at([JACK.x + JACK.w / 2, JACK.y + JACK.d + 3, 0.6]),
    at([JACK.x + JACK.w / 2, PHONE.y - 3, 0.6]),
    at([PHONE.x + 8, PHONE.y - 3, 0.6]),
    at([PHONE.x + 8, PHONE.y, 0.6]),
  ],
  sleeves: [
    roundAlong([PHONE.x + PHONE.w, PHONE.y + 9, 2.2], [1, 0, 0], 0.8, 1, P, 12),
    roundAlong([PHONE.x + PHONE.w, PHONE.y + PHONE.d - 2, 2.2], [1, 0, 0], 0.8, 1, P, 12),
    roundAlong([SELECTOR.x, PHONE.y + PHONE.d - 2, 2.2], [-1, 0, 0], 0.8, 1, P, 12),
    roundAlong([JACK.x + JACK.w / 2, JACK.y + JACK.d, 2.2], [0, 1, 0], 0.8, 1, P, 12),
  ],
  /** Where the recorder's cord goes into the clockwork: a socket on its front face. */
  clockSocket: slab({ x: CLOCK.x + 2.6, y: CLOCK.y + CLOCK.d, w: 2.8, d: 1.4, r: 0.4 }, 0, 1.8, 2, 0.2),
};

/** The wall jack the telephone line comes in by, at the back of the bench. */
export const JACK_ART = {
  box: slab(JACK, 0, 5.6, 3, 0.5),
  plate: slab({ x: JACK.x + 1.4, y: JACK.y + JACK.d, w: JACK.w - 2.8, d: 0.3, r: 0.3 }, 1.2, 3.8, 2),
  screws: [at([JACK.x + 2.2, JACK.y + JACK.d + 0.3, 4.4]), at([JACK.x + JACK.w - 2.2, JACK.y + JACK.d + 0.3, 4.4])],
};

// ── the kymograph ─────────────────────────────────────────────────────

export const KYMO = {
  clock: slab(CLOCK, 0, CLOCK_TOP, 4, 0.6),
  clockScrews: corners(CLOCK, 2.2).map(([x, y]) => at([x, y, CLOCK_TOP])),
  /** The winding key on the clockwork's side. */
  keyBoss: slab({ x: CLOCK.x + CLOCK.w, y: DRUM[1] - 2, w: 1.2, d: 4, r: 0.6 }, 2, 2.4, 2),
  key: barBetween([CLOCK.x + CLOCK.w + 1.2, DRUM[1], 3.2], [CLOCK.x + CLOCK.w + 4.4, DRUM[1], 3.2], [0, 1, 0], 4.6, 0.8, P),
  collar: post(DRUM[0], DRUM[1], 5, CLOCK_TOP, 2.4, 32, 0.4),
  drum: post(DRUM[0], DRUM[1], DRUM_R, DRUM_Z0, DRUM_Z1 - DRUM_Z0, 64),
  /** The sheet's edges on the drum: where its seam overlaps. Rides round with the drum, so drawn live. */
  rim: post(DRUM[0], DRUM[1], DRUM_R + 0.6, DRUM_Z1, 1, 64, 0.3),
  rimBottom: post(DRUM[0], DRUM[1], DRUM_R + 0.6, DRUM_Z0 - 0.6, 0.6, 64),
  spindle: post(DRUM[0], DRUM[1], 1.4, DRUM_Z1 + 1, 2.4, 16),
  spindleCap: post(DRUM[0], DRUM[1], 2.2, DRUM_Z1 + 3.4, 0.8, 18, 0.3),
};

/** The drum's top, turned by `angle`: four holes in its cap. */
export const drumMarks = (angle: number) =>
  join([0, 1, 2, 3].map((hole) => ring(...(around(DRUM[0], DRUM[1], 8.4, angle + (hole * Math.PI) / 2, 0).slice(0, 2) as Plane), 1.4, DRUM_Z1 + 1, P, 12)));

/** A point on the drum's surface at world angle `angle`, height z. */
export const onDrum = (angle: number, z: number): Flat => at(around(DRUM[0], DRUM[1], DRUM_R + 0.05, angle, z));

/**
 * The drum's visible half, sampled every `step` radians from just inside one
 * limb to just inside the other: each sample's angle and where it lands on
 * screen at z = 0, and the screen step for one unit up. A pen line is then a
 * sum per sample, not a projection.
 */
export function drumSamples(step: number) {
  const angles: number[] = [];
  for (let angle = FACING - Math.PI / 2 + 0.02; angle <= FACING + Math.PI / 2 - 0.02; angle += step) angles.push(angle);
  const base = angles.map((angle) => onDrum(angle, 0));
  const lift = onDrum(FACING, 1);
  const ground = onDrum(FACING, 0);
  return { angles, base, up: [lift[0] - ground[0], lift[1] - ground[1]] as Flat };
}

/** Whether a world angle round the drum faces the viewer. */
export const seen = (angle: number) => Math.cos(angle - FACING) > 0;

// ── the pen stand ──────────────────────────────────────────────────────

const STAND: Plane = [DRUM[0] + (DRUM_R + 12) * Math.cos(PEN_ANGLE), DRUM[1] + (DRUM_R + 12) * Math.sin(PEN_ANGLE)];
const STAND_TOP = DRUM_Z1 + 2;
const CARRIAGE_Z = BAND_Z[0]!;
const tipAt = (z: number): Point3 => [DRUM[0] + (DRUM_R + 0.3) * Math.cos(PEN_ANGLE), DRUM[1] + (DRUM_R + 0.3) * Math.sin(PEN_ANGLE), z];
const inward: Point3 = [-Math.cos(PEN_ANGLE), -Math.sin(PEN_ANGLE), 0];
const across: Point3 = [-inward[1], inward[0], 0];
export const STAND_ART = {
  foot: slab({ x: STAND[0] - 4.4, y: STAND[1] - 4.4, w: 8.8, d: 8.8, r: 1.4 }, 0, 1.6, 3, 0.4),
  footScrews: corners({ x: STAND[0] - 4.4, y: STAND[1] - 4.4, w: 8.8, d: 8.8, r: 1.4 }, 1.4).map(([x, y]) => at([x, y, 1.6])),
  post: post(STAND[0], STAND[1], 1.5, 1.6, STAND_TOP - 1.6, 20),
  postCap: post(STAND[0], STAND[1], 2, STAND_TOP, 0.8, 18, 0.3),
  /** The carriage at the first band: a block on the post, and the two pen arms from it to the drum. */
  carriage: post(STAND[0], STAND[1], 2.6, CARRIAGE_Z - 2.6, 5.2, 24, 0.4),
  screw: (() => {
    const [x, y] = around(STAND[0], STAND[1], 2.6, PEN_ANGLE + Math.PI / 2 + 0.6, 0);
    return knurl(x, y, 1, CARRIAGE_Z - 0.6, CARRIAGE_Z + 0.6, 8, P, 0.1);
  })(),
  arms: [1, -1].map((side) => {
    const z = CARRIAGE_Z + side * LINE_GAP;
    const from: Point3 = [STAND[0] + inward[0] * 2.4, STAND[1] + inward[1] * 2.4, z];
    const tip = tipAt(z);
    const shoulder: Point3 = [tip[0] - inward[0] * 2.2, tip[1] - inward[1] * 2.2, z];
    return {
      side,
      arm: barBetween(from, shoulder, across, 0.9, 0.7, P),
      pen: barBetween(shoulder, tip, across, 0.5, 0.5, P),
      tip: at(tip),
    };
  }),
};

// ── the telephone ──────────────────────────────────────────────────────

const HOLES = Array.from({ length: 10 }, (_, hole) => -120 + hole * 26).map((degrees) => degrees * RAD);
export const PHONE_ART = {
  base: slab(PHONE, 0, PHONE_TOP - 2, 4, 0.8),
  top: slab(insetPlan(PHONE, 1.6), PHONE_TOP - 2, 2, 4, 0.6),
  feetDots: corners(PHONE, 2.4).map(([x, y]) => at([x, y, 0.6])),
  dial: post(DIAL[0], DIAL[1], 6, PHONE_TOP, 1, 40, 0.3),
  dialHoles: join(HOLES.map((angle) => ring(...(around(DIAL[0], DIAL[1], 4.3, angle, 0).slice(0, 2) as Plane), 1, PHONE_TOP + 1, P, 12))),
  /** The finger stop, a little bar at the end of the holes. */
  stop: barBetween(around(DIAL[0], DIAL[1], 4.2, 150 * RAD, PHONE_TOP + 1.3), around(DIAL[0], DIAL[1], 6.2, 150 * RAD, PHONE_TOP + 1.3), [-Math.sin(150 * RAD), Math.cos(150 * RAD), 0], 0.6, 0.6, P),
  centre: post(DIAL[0], DIAL[1], 2, PHONE_TOP + 1, 0.6, 20, 0.2),
  hooks: HOOKS.map(([x, y]) => ({
    post: post(x, y, 0.9, PHONE_TOP, HANDSET_Z - PHONE_TOP - 1.2, 14),
    fork: slab({ x: x - 1.6, y: y - 1.6, w: 3.2, d: 3.2, r: 0.6 }, HANDSET_Z - 1.2, 0.8, 2, 0.2),
  })),
  /** The handset on its hooks: the grip, its two cups, and the cord's boot. */
  grip: barBetween([HOOKS[0]![0] - 3, HOOKS[0]![1], HANDSET_Z + 0.4], [HOOKS[1]![0] + 3, HOOKS[1]![1], HANDSET_Z + 0.4], [0, 1, 0], 2.6, 2, P),
  cups: [HOOKS[0]![0] - 4.4, HOOKS[1]![0] + 4.4].map((x) => post(x, HOOKS[0]![1], 2.8, HANDSET_Z - 1.4, 2.4, 24, 0.4)),
  cupHoles: [HOOKS[0]![0] - 4.4, HOOKS[1]![0] + 4.4].map((x) => ring(x, HOOKS[0]![1], 1.2, HANDSET_Z + 1, P, 14)),
};

/**
 * The handset lifter that answers for the agent: a post beside the telephone
 * and, sliding on it, a collar whose arm runs under the earpiece. When a call
 * comes in it rises and takes the handset off its hooks with it.
 */
const LIFTER: Plane = [PHONE.x + PHONE.w + 6.4, HOOKS[1]![1]];
const ARM_Z = HANDSET_Z - 1.4 - 0.8;
export const LIFTER_ART = {
  foot: slab({ x: LIFTER[0] - 3, y: LIFTER[1] - 3, w: 6, d: 6, r: 1 }, 0, 1.4, 3, 0.3),
  footScrews: corners({ x: LIFTER[0] - 3, y: LIFTER[1] - 3, w: 6, d: 6, r: 1 }, 1.1).map(([x, y]) => at([x, y, 1.4])),
  post: post(LIFTER[0], LIFTER[1], 1.1, 1.4, HANDSET_Z + PICK + 3 - 1.4, 18),
  cap: post(LIFTER[0], LIFTER[1], 1.6, HANDSET_Z + PICK + 3, 0.7, 18, 0.2),
  /** What rises with the handset: the collar and its arm, at rest. */
  collar: post(LIFTER[0], LIFTER[1], 1.9, ARM_Z - 1.2, 3.2, 20, 0.3),
  arm: slab({ x: HOOKS[1]![0] + 4.4 - 0.8, y: LIFTER[1] - 0.8, w: LIFTER[0] - 1.6 - (HOOKS[1]![0] + 4.4 - 0.8), d: 1.6, r: 0.4 }, ARM_Z, 0.8, 2, 0.2),
};

/** The bell, on its own post in front of the telephone, and its hammer, which shakes `by` when it rings. */
const BELL: Plane = [PHONE.x - 7, PHONE.y + PHONE.d + 5];
export const BELL_ART = {
  post: post(BELL[0], BELL[1], 1, 0, 8, 14),
  dome: post(BELL[0], BELL[1], 3.6, 8, 2.6, 28, 1.2),
  domeTop: post(BELL[0], BELL[1], 1.2, 10.6, 0.8, 14),
  hammerPost: post(BELL[0] + 5.6, BELL[1], 0.6, 0, 9, 10),
  hammer: barBetween([BELL[0] + 5.6, BELL[1], 9.4], [BELL[0] + 3.8, BELL[1], 9.4], [0, 1, 0], 1.2, 1.2, P),
};

// ── the voice selector ─────────────────────────────────────────────────

export const SELECTOR_ART = {
  box: slab(SELECTOR, 0, SELECTOR_TOP, 4, 0.6),
  boxScrews: corners(SELECTOR, 1.8).map(([x, y]) => at([x, y, SELECTOR_TOP])),
  /** A short tick for each voice round the knob. */
  detents: join(VOICE_ANGLE.map((angle) => pathOf([at(around(KNOB[0], KNOB[1], 3.4, angle, SELECTOR_TOP)), at(around(KNOB[0], KNOB[1], 4.5, angle, SELECTOR_TOP))]))),
  knobSkirt: post(KNOB[0], KNOB[1], 3.4, SELECTOR_TOP, 0.8, 32, 0.2),
  knob: post(KNOB[0], KNOB[1], 2.6, SELECTOR_TOP + 0.8, 2.4, 28, 0.4),
  knobKnurl: knurl(KNOB[0], KNOB[1], 2.6, SELECTOR_TOP + 0.8, SELECTOR_TOP + 3.2, 22, P),
  knobSeams: join([SELECTOR_TOP + 1.2, SELECTOR_TOP + 2.8].map((z) => sideArc(KNOB[0], KNOB[1], 2.6, z, P, 24))),
  /** The speaker the voice comes out of: a grille of slots on the box's top. */
  grille: slab({ x: SELECTOR.x + 13, y: SELECTOR.y + 2, w: 10.4, d: SELECTOR.d - 4, r: 1 }, SELECTOR_TOP, 0.4, 3),
  /** Closed slots, so no line stops on the grille. */
  slots: join(
    Array.from({ length: 6 }, (_, slot) => {
      const x = SELECTOR.x + 14.2 + slot * 1.5;
      return onTop([[x, SELECTOR.y + 3.2], [x + 0.6, SELECTOR.y + 3.2], [x + 0.6, SELECTOR.y + SELECTOR.d - 3.2], [x, SELECTOR.y + SELECTOR.d - 3.2]], SELECTOR_TOP + 0.4, P, true);
    }),
  ),
};

/** The knob's pointer at `angle`: a line across its top from the middle to the rim. */
export const pointer = (angle: number) => pathOf([at(around(KNOB[0], KNOB[1], 0.6, angle, SELECTOR_TOP + 3.2)), at(around(KNOB[0], KNOB[1], 2.4, angle, SELECTOR_TOP + 3.2))]);

// ── the filed sheets ───────────────────────────────────────────────────

const TRAY: Plan = { x: 100, y: 10, w: 16, d: 20, r: 1.4 };
export const TRAY_ART = {
  tray: slab(TRAY, 0, 1.6, 3, 0.4),
  lip: slab({ x: TRAY.x, y: TRAY.y, w: 1, d: TRAY.d, r: 0.4 }, 1.6, 2.4, 2),
};
/** The `index`-th filed sheet on the tray. */
export const sheet = (index: number) => slab({ x: TRAY.x + 1.6, y: TRAY.y + 1.6, w: TRAY.w - 3.2, d: TRAY.d - 3.2, r: 0.6 }, 1.6 + index * 0.7, 0.6, 2);
/** What the top sheet of `count` shows: its three calls' bands, as printed lines across it. */
export const sheetLines = (count: number) => {
  if (count <= 0) return "";
  const z = 1.6 + (count - 1) * 0.7 + 0.6;
  return join(
    [4, 9, 14].flatMap((y, band) =>
      [0, 1.4].map((offset, row) => onTop([[TRAY.x + 3.4, TRAY.y + y + offset], [TRAY.x + 3.4 + [9, 7.4, 8.2][band]! - row * 2.6, TRAY.y + y + offset]], z, P)),
    ),
  );
};
export const SHEETS_MAX = 7;

/** The camera's sine and cosine, for the figure's own sums. */
export const CAMERA = cameraOf(P);
