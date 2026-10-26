import {
  corners,
  cylinder,
  fitProjection,
  insetPlan,
  iso,
  onTop,
  pathOf,
  planOutline,
  ring,
  sideArc,
  sideSeam,
  slabOf,
  topTicks,
  translateAlong,
  type Flat,
  type Plan,
  type Point3,
} from "@/components/iso/iso-kit";
import { DAYS, LENGTH, QUARTERS, type Block } from "./calendar-model";

/**
 * Fig 05.4, built once: a booking board with a go/no-go gauge, on a bench.
 *
 * World units are about a pixel of the real thing: x along the day (one
 * quarter hour is `Q`), y across the days, z up. Everything is built at rest
 * and moved with translates: the gantry along x, each feeler up and down, a
 * pin up out of its strip, a booked block down into its rail.
 */

export const WIDTH = 600;
/** The capability cards' frame: 400 × 268, at this width. */
export const HEIGHT = 402;
const AZIMUTH = 48;
const ELEVATION = 34;

/** One quarter hour along a rail. */
export const Q = 2.7;
/** Where quarter 0 starts. */
export const X0 = 12;
const RAIL_W = 6.4;
const PITCH = 9;
/** Each day's rail, its centre line across the board. */
export const RAIL_Y = Array.from({ length: DAYS }, (_, day) => 8 + day * PITCH);
const BOARD: Plan = { x: 0, y: 0, w: X0 + QUARTERS * Q + 6, d: RAIL_Y[DAYS - 1]! + 14, r: 2.4 };
const BOARD_TOP = 3.4;
export const TOP = BOARD_TOP;
const LIP_H = 1.2;
const BLOCK_H = 3.2;
const BENCH: Plan = { x: -10, y: -13, w: BOARD.w + 20, d: BOARD.d + 26, r: 8 };
const BASE_H = 7;
const FOOT_H = 4;

/** The x of quarter `at`'s start. */
export const xOf = (at: number) => X0 + at * Q;

// ── the gantry ─────────────────────────────────────────────────────────

const GUIDE_Y = [BOARD.y - 6, BOARD.y + BOARD.d + 6] as const;
const BEAM_Z = 24;
const BEAM_H = 3;
const FEELER_LONG = LENGTH * Q - 0.4;
const FOOT_H_FEELER = 2.4;
/** How high a feeler stands over a block: the block and a hair. */
export const RIDE = BLOCK_H + 0.3;

// ── the projection ─────────────────────────────────────────────────────

const box = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

export const P = fitProjection(
  [...box(BENCH, -BASE_H - FOOT_H, 0), ...box({ x: X0 - 3, y: GUIDE_Y[0] - 3, w: QUARTERS * Q + 6, d: GUIDE_Y[1] - GUIDE_Y[0] + 6, r: 0 }, 0, BEAM_Z + BEAM_H + 8)],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: AZIMUTH, elevation: ELEVATION },
);

const at = (point: Point3): Flat => iso(point, P);
const slab = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const post = (x: number, y: number, r: number, z: number, h: number, steps = 24, bevel = 0) => cylinder(x, y, r, z, h, P, steps, bevel);
const join = (paths: string[]) => paths.join("");
/** The screen offset of a world move, for `transform`. */
export const shift = (by: Point3) => translateAlong(P, by);

// ── the bench and the board ────────────────────────────────────────────

const SCREWS = corners(BENCH, 6);
/**
 * The maker's plate, on the board's front-left corner: the one patch of the
 * board no rail, tab or ruler covers. On the bench it sat under the front
 * guide's end stop.
 */
const LABEL: Plan = { x: 1.4, y: RAIL_Y[DAYS - 1]! + 4.2, w: 8, d: 6, r: 0.8 };
const RULER: Plan = { x: X0 - 1, y: BOARD.y + BOARD.d - 5.4, w: QUARTERS * Q + 2, d: 3.6, r: 0.6 };
const RULER_TICKS = topTicks(X0, X0 + QUARTERS * Q, Q, 4, RULER.y + 0.4, BOARD_TOP + 0.6, [0.9, 1.5], P, "x");
export const BOARD_ART = {
  halo: slab(BENCH, -BASE_H - FOOT_H, BASE_H, 8).fill,
  feet: corners(BENCH, 15).map(([x, y]) => [post(x, y, 6.5, -BASE_H - FOOT_H, 1.4, 28), post(x, y, 5, -BASE_H - FOOT_H + 1.4, FOOT_H - 1.4, 28)]),
  bench: slab(BENCH, -BASE_H, BASE_H, 8, 1.6),
  groove: planOutline(insetPlan(BENCH, 4), 0, P),
  screwRings: join(SCREWS.map(([x, y]) => ring(x, y, 2, 0, P, 16))),
  screws: SCREWS.map(([x, y]) => at([x, y, 0])),
  label: slab(LABEL, BOARD_TOP, 0.6, 4),
  labelLine: planOutline(insetPlan(LABEL, 1), BOARD_TOP + 0.6, P, 4),
  labelRules: join([0, 1, 2].map((row) => onTop([[LABEL.x + 2, LABEL.y + 1.9 + row * 1.1], [LABEL.x + (row === 1 ? 4.6 : 6), LABEL.y + 1.9 + row * 1.1]], BOARD_TOP + 0.6, P))),
  labelScrews: [at([LABEL.x + 1.6, LABEL.y + LABEL.d - 1.4, BOARD_TOP + 0.6]), at([LABEL.x + LABEL.w - 1.6, LABEL.y + LABEL.d - 1.4, BOARD_TOP + 0.6])],
  board: slab(BOARD, 0, BOARD_TOP, 4, 0.8),
  boardScrews: corners(BOARD, 2).map(([x, y]) => at([x, y, BOARD_TOP])),
  /** The hours, a tick each quarter and a long one each hour, on a strip along the front. */
  ruler: slab(RULER, BOARD_TOP, 0.6, 3),
  rulerMinor: RULER_TICKS.minor,
  rulerMajor: RULER_TICKS.major,
};

/**
 * A rail: its two lips, closed at each end by a stop so it reads as one
 * channel, and its day's tab at the left end, a flat plate rather than
 * anything a block could be mistaken for. Its pins come up behind it.
 */
const RAIL_X0 = X0 - 1.6;
const RAIL_X1 = X0 + QUARTERS * Q + 1.6;
export const RAILS = RAIL_Y.map((y, day) => ({
  day,
  y,
  back: slab({ x: RAIL_X0, y: y - RAIL_W / 2 - 0.8, w: RAIL_X1 - RAIL_X0, d: 0.8, r: 0.3 }, BOARD_TOP, LIP_H, 2),
  front: slab({ x: RAIL_X0, y: y + RAIL_W / 2, w: RAIL_X1 - RAIL_X0, d: 0.8, r: 0.3 }, BOARD_TOP, LIP_H, 2),
  ends: [RAIL_X0 - 0.9, RAIL_X1].map((x) => slab({ x, y: y - RAIL_W / 2 - 0.8, w: 0.9, d: RAIL_W + 1.6, r: 0.3 }, BOARD_TOP, LIP_H + 0.3, 2, 0.2)),
  endScrews: [RAIL_X0 - 0.45, RAIL_X1 + 0.45].map((x) => at([x, y, BOARD_TOP + LIP_H + 0.3])),
  /** The quarter-hour marks along the back lip's top, the hour ones longer. */
  ticks: topTicks(X0, X0 + QUARTERS * Q, Q, 4, y - RAIL_W / 2 - 0.8, BOARD_TOP + LIP_H, [0.5, 0.8], P, "x"),
  tab: slab({ x: 2.4, y: y - 2.4, w: RAIL_X0 - 3.4, d: 4.8, r: 0.6 }, BOARD_TOP, 0.5, 3),
  tabLine: planOutline(insetPlan({ x: 2.4, y: y - 2.4, w: RAIL_X0 - 3.4, d: 4.8, r: 0.6 }, 0.8), BOARD_TOP + 0.5, P, 3),
  tabRule: onTop([[3.8, y], [3.8 + (day % 2 ? 2.4 : 3.4), y]], BOARD_TOP + 0.5, P),
}));

/** A block on a rail: busy (or booked) from quarter `from` to `to`. Built at rest; a booking drops in from above. */
export function blockOf({ day, from, to }: Block) {
  const y = RAIL_Y[day]!;
  const plan: Plan = { x: xOf(from) + 0.2, y: y - RAIL_W / 2 + 0.4, w: (to - from) * Q - 0.4, d: RAIL_W - 0.8, r: 0.8 };
  const long = to - from >= 8;
  return {
    day,
    from,
    paths: slab(plan, BOARD_TOP, BLOCK_H, 3, 0.4),
    /** A long event carries its title as two printed lines; a short one, one. */
    rules: join(
      (long ? [0, 1] : [0]).map((row) => onTop([[plan.x + 1.4, plan.y + 1.6 + row * 1.6], [plan.x + 1.4 + Math.min(plan.w - 2.8, row ? 4 : 7), plan.y + 1.6 + row * 1.6]], BOARD_TOP + BLOCK_H, P)),
    ),
  };
}

/** Pins kept ready per rail: as many as any day of this week ever offers (a model test holds it). */
export const PINS_PER_DAY = 12;

/** How far a pin stands up out of its hole once its slot is offered. */
export const PIN_UP = 2.6;
const PIN_R = 0.42;
const HEAD_R = 0.75;
const HEAD_H = 0.7;
const HOLE_R = HEAD_R + 0.15;
const pinAt = (day: number, quarter: number): [number, number] => [xOf(quarter) + 1.1, RAIL_Y[day]! - RAIL_W / 2 - 2.4];

/**
 * The pin beside quarter `quarter` of `day`, all the way up: a shank and a
 * round head, so a row of them reads as pegs in a board. It rises and sinks by
 * a translate, clipped at the front of its hole (`pinHole`), so nothing is
 * rebuilt while it moves.
 */
export function pinOf(day: number, quarter: number) {
  const [x, y] = pinAt(day, quarter);
  return {
    shank: post(x, y, PIN_R, BOARD_TOP, PIN_UP - HEAD_H, 12),
    head: post(x, y, HEAD_R, BOARD_TOP + PIN_UP - HEAD_H, HEAD_H, 16, 0.15),
  };
}

/**
 * Where a pin's hole cuts it off: everything above the hole's near rim, and
 * that rim itself, drawn over the pin so the cut is an edge and not a stop.
 */
export function pinHole(day: number, quarter: number) {
  const [x, y] = pinAt(day, quarter);
  const rim = Array.from({ length: 48 }, (_, step) => at(around2(x, y, HOLE_R, (step / 48) * Math.PI * 2)));
  let left = 0;
  let right = 0;
  rim.forEach(([px], index) => {
    if (px < rim[left]![0]) left = index;
    if (px > rim[right]![0]) right = index;
  });
  // The near half runs from the left end to the right end the way that passes lowest on screen.
  const chain = (from: number, to: number, step: number) => {
    const out: Flat[] = [];
    for (let index = from; ; index = (index + step + rim.length) % rim.length) {
      out.push(rim[index]!);
      if (index === to) break;
    }
    return out;
  };
  const one = chain(left, right, 1);
  const other = chain(left, right, -1);
  const lowest = (points: Flat[]) => points.reduce((sum, [, py]) => sum + py, 0) / points.length;
  const near = lowest(one) > lowest(other) ? one : other;
  const top = near[0]![1] - 60;
  return {
    clip: pathOf([...near, [near[near.length - 1]![0], top], [near[0]![0], top]], true),
    rim: pathOf(near),
  };
}

const around2 = (x: number, y: number, r: number, angle: number): Point3 => [x + r * Math.cos(angle), y + r * Math.sin(angle), BOARD_TOP];

/** The holes the pins come up through, every quarter, in the strip behind each rail. */
export const PIN_HOLES = join(
  RAIL_Y.flatMap((_, day) => Array.from({ length: QUARTERS - LENGTH + 1 }, (__, quarter) => ring(...pinAt(day, quarter), HOLE_R, BOARD_TOP, P, 12))),
);

// ── the gantry, at the first quarter ───────────────────────────────────

const GX = xOf(0);
/** Where a feeler's rod stands: over its foot's middle, just clear of the beam's face. */
const ROD_X = GX + 0.2 + FEELER_LONG / 2;
export const GANTRY = {
  guides: GUIDE_Y.map((y) => {
    const rail: Plan = { x: X0 - 4, y: y - 1.6, w: QUARTERS * Q + 8, d: 3.2, r: 0.8 };
    return {
      rail: slab(rail, 0, 2, 3, 0.4),
      stops: [X0 - 4, X0 + QUARTERS * Q + 2.6].map((x) => slab({ x, y: y - 2.2, w: 1.4, d: 4.4, r: 0.4 }, 0, 3.4, 2, 0.3)),
      /** The way the rail is ground, round its visible side from silhouette to silhouette. */
      seam: sideSeam(rail, 1, P, 3),
    };
  }),
  /** What moves along x: carriages, uprights, the beam, and a feeler per day hanging from it. */
  carriages: GUIDE_Y.map((y) => slab({ x: GX - 3.6, y: y - 2.6, w: 7.2, d: 5.2, r: 1 }, 2, 3.2, 3, 0.5)),
  carriageScrews: GUIDE_Y.map((y) => [at([GX - 2.2, y + 2.6, 4.2]), at([GX + 2.2, y + 2.6, 4.2])]),
  uprights: GUIDE_Y.map((y) => post(GX, y, 1.6, 5.2, BEAM_Z - 5.2, 20)),
  upSeams: GUIDE_Y.map((y) => join([11, 18].map((z) => sideArc(GX, y, 1.6, z, P, 14)))),
  beam: slab({ x: GX - 2, y: GUIDE_Y[0] - 2, w: 4, d: GUIDE_Y[1] - GUIDE_Y[0] + 4, r: 0.8 }, BEAM_Z, BEAM_H, 3, 0.5),
  beamScrews: GUIDE_Y.map((y) => at([GX, y, BEAM_Z + BEAM_H])),
  /** Each feeler, built down on the board: its foot (as long as an appointment), its rod, its bushing on the beam. */
  feelers: RAIL_Y.map((y) => ({
    foot: slab({ x: GX + 0.2, y: y - RAIL_W / 2 + 0.6, w: FEELER_LONG, d: RAIL_W - 1.2, r: 0.6 }, BOARD_TOP, FOOT_H_FEELER, 3, 0.4),
    rod: post(ROD_X, y, 0.6, BOARD_TOP + FOOT_H_FEELER, BEAM_Z + BEAM_H + 5 - BOARD_TOP - FOOT_H_FEELER, 12),
    cap: post(ROD_X, y, 1, BEAM_Z + BEAM_H + 5, 0.8, 14, 0.2),
  })),
  bushings: RAIL_Y.map((y) => slab({ x: GX + 2, y: y - 1.6, w: ROD_X + 1.4 - GX - 2, d: 3.2, r: 0.6 }, BEAM_Z, BEAM_H, 2, 0.3)),
  /** How far the gantry moves for quarter `at`. */
  along: (quarter: number) => shift([quarter * Q, 0, 0]),
};

/** A feeler's lift as a transform, up by `z`. */
export const up = (z: number) => shift([0, 0, z]);
/** The gantry at quarter `at`, and a feeler there lifted by `z`. */
export const alongUp = (quarter: number, z: number) => shift([quarter * Q, 0, z]);
