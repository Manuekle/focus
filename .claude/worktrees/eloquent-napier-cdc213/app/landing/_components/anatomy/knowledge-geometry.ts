import {
  corners,
  cylinder,
  depthOf,
  fitProjection,
  insetPlan,
  iso,
  knurl,
  onTop,
  pathOf,
  planOutline,
  ring,
  segment,
  sideArc,
  sideSeam,
  slabOf,
  translateAlong,
  type Flat,
  type Plan,
  type Plane,
  type Point3,
} from "@/components/iso/iso-kit";
import { DOCUMENTS, LIFT } from "./knowledge-model";

/**
 * Fig 05.1, built once: an edge-notched card file on a bench.
 *
 * World units are about a pixel of the real thing, x along the drawer, y across
 * it, z up from the bench top. Everything static is a path computed here at
 * module load; what moves (cards, the lifted rod, the selector) is built at
 * rest and moved with a translate, so a frame only writes transforms.
 */

export const WIDTH = 600;
/** The capability cards' frame: 400 × 268, at this width. */
export const HEIGHT = 402;
const AZIMUTH = 50;
const ELEVATION = 32;

// ── the bench ──────────────────────────────────────────────────────────

export const BASE: Plan = { x: -14, y: -20, w: 138, d: 84, r: 7 };
const BASE_H = 7;
const FOOT_H = 4;

// ── the drawer ─────────────────────────────────────────────────────────

/** Inside of the drawer: x from 0 to TX, y from 0 to TY. */
const TX = 92;
const TY = 44;
const SKID_Z = 1.4;
/** The drawer's inside floor. */
export const ZF = SKID_Z + 2;
const WALL_TOP = ZF + 13;
const FRONT_TOP = 29;
/** The drawer front's outside face, where the rods come out. */
const FACE_X = TX + 2.6;

// ── the cards ──────────────────────────────────────────────────────────

const CARD_Y = 2;
const CARD_D = 40;
const CARD_H = 24;
const CARD_T = 0.7;
const DIVIDER_T = 1;
const PITCH = 2.6;
const DIVIDER_GAP = 3.2;

// ── the rods and the selector ──────────────────────────────────────────

/** Where the four selector rods run across the drawer, one per question. */
export const RODS = [8, 16.5, 25, 33.5] as const;
const ROD_Z = ZF + 2.2;
const ROD_R = 0.75;
const STUB_END = FACE_X + 5.8;
const NUT_W = 2;
const NUT_R = 1.5;
const SADDLE_H = 1;
/** The lifter's arm top when its saddle just touches a rod at rest. */
const ARM_TOP = ROD_Z - ROD_R - SADDLE_H;
const ARM_H = 1.3;
/** How far below a rod the lifter drops to pass under the nuts. */
export const DROP = 2;

const GANTRY_X = 99;
const POSTS: readonly Plane[] = [
  [GANTRY_X, -12],
  [GANTRY_X, 56],
];
const BEAM: Plan = { x: GANTRY_X - 3, y: -16, w: 6, d: 76, r: 1.2 };
/**
 * High enough that the carriage rides clear above the lifted rod's nut: the
 * carriage stands in front of the slot it serves, so any lower and it hides
 * the one rod the reader is meant to watch rise.
 */
const BEAM_Z = 29;
const BEAM_H = 4;
const RAIL_X = BEAM.x + BEAM.w;
const CARRIAGE_X = RAIL_X + 1;
const CARRIAGE_W = 4.4;
export const HANGER_X = CARRIAGE_X + CARRIAGE_W / 2;
const CARRIAGE_Z = 27.5;
const CARRIAGE_TOP = 36;
const SCREW_TOP = CARRIAGE_TOP + 3;
const KNOB_H = 3;

// ── the projection ─────────────────────────────────────────────────────

const box = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

const TALLEST = ZF + CARD_H + 0.75 * (LIFT + 1.4);

export const P = fitProjection(
  [
    ...box(BASE, -BASE_H - FOOT_H, 0),
    ...box({ x: 0, y: CARD_Y, w: TX, d: CARD_D, r: 0 }, 0, TALLEST),
    ...box({ x: CARRIAGE_X, y: RODS[0] - 3, w: CARRIAGE_W, d: RODS[3] - RODS[0] + 6, r: 0 }, 0, SCREW_TOP + KNOB_H + LIFT),
  ],
  WIDTH,
  HEIGHT,
  { pad: 30, azimuth: AZIMUTH, elevation: ELEVATION },
);

const at = (point: Point3): Flat => iso(point, P);
const seg = (a: Point3, b: Point3) => segment(a, b, P);
const slab = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const post = (x: number, y: number, r: number, z: number, h: number, steps = 32) => cylinder(x, y, r, z, h, P, steps);
const join = (paths: string[]) => paths.join("");

/** A closed outline in the plane x = `x`, from points given as (y, z). */
const onFace = (x: number, points: Plane[]) => pathOf(points.map(([y, z]) => at([x, y, z])), true);

/** A rounded rectangle standing in the plane x = `x`: a slot, a label window. */
function faceRect(x: number, y0: number, y1: number, z0: number, z1: number, r = 0) {
  const radius = Math.min(r, (y1 - y0) / 2, (z1 - z0) / 2);
  const points: Plane[] = [];
  const arc = (cy: number, cz: number, from: number) => {
    for (let step = 0; step <= 6; step++) {
      const angle = ((from + (step / 6) * 90) * Math.PI) / 180;
      points.push([cy + radius * Math.cos(angle), cz + radius * Math.sin(angle)]);
    }
  };
  if (radius <= 0) return onFace(x, [[y0, z0], [y1, z0], [y1, z1], [y0, z1]]);
  arc(y1 - radius, z0 + radius, -90);
  arc(y1 - radius, z1 - radius, 0);
  arc(y0 + radius, z1 - radius, 90);
  arc(y0 + radius, z0 + radius, 180);
  return onFace(x, points);
}

/** The screen offset of a world move, for `transform`. */
export const shift = (by: Point3) => translateAlong(P, by);

// ── the bench ──────────────────────────────────────────────────────────

const FEET = corners(BASE, 15).sort((a, b) => depthOf([a[0], a[1], 0], P) - depthOf([b[0], b[1], 0], P));
const SCREWS = corners(BASE, 6);
const RULER: Plan = { x: 0, y: 50, w: 90, d: 5, r: 0.8 };
const LABEL: Plan = { x: 105, y: 43, w: 13, d: 10, r: 1 };

/** Where each card and divider stands, back to front. */
export type Standing = { readonly kind: "divider"; readonly document: number; readonly x: number } | { readonly kind: "card"; readonly card: number; readonly x: number };

export const STANDING: readonly Standing[] = (() => {
  const out: Standing[] = [];
  let x = 3;
  let card = 0;
  DOCUMENTS.forEach((document, index) => {
    out.push({ kind: "divider", document: index, x });
    x += DIVIDER_GAP;
    for (let at = 0; at < document.passages; at++) {
      out.push({ kind: "card", card: card++, x });
      x += PITCH;
    }
  });
  return out;
})();

const FOLLOWER_X = STANDING[STANDING.length - 1]!.x + 1.6;

/** One tick per passage on the ruler strip, and a long one at each divider: the file, counted. Ticks hang from the strip's far edge. */
function rulerTicks() {
  const minor: string[] = [];
  const major: string[] = [];
  const edge = RULER.y;
  for (const item of STANDING) {
    const long = item.kind === "divider";
    (long ? major : minor).push(seg([item.x, edge, 0.6], [item.x, edge + (long ? 1.8 : 1.3), 0.6]));
  }
  return { minor: join(minor), major: join(major) };
}

const TICKS = rulerTicks();

export const BENCH = {
  halo: slab(BASE, -BASE_H - FOOT_H, BASE_H, 8).fill,
  feet: FEET.map(([x, y]) => [post(x, y, 6.5, -BASE_H - FOOT_H, 1.4, 28), post(x, y, 5, -BASE_H - FOOT_H + 1.4, FOOT_H - 1.4, 28)]),
  slab: slab(BASE, -BASE_H, BASE_H, 8, 1.6),
  groove: planOutline(insetPlan(BASE, 4), 0, P),
  screwRings: join(SCREWS.map(([x, y]) => ring(x, y, 2, 0, P, 16))),
  screws: SCREWS.map(([x, y]) => at([x, y, 0])),
  ruler: slab(RULER, 0, 0.6, 3),
  rulerMinor: TICKS.minor,
  rulerMajor: TICKS.major,
  rulerScrews: [at([RULER.x + 2.2, RULER.y + RULER.d - 1.5, 0.6]), at([RULER.x + RULER.w - 2.2, RULER.y + RULER.d - 1.5, 0.6])],
  label: slab(LABEL, 0, 0.8, 4),
  labelLine: planOutline(insetPlan(LABEL, 1.4), 0.8, P, 4),
  labelRules: join(
    [0, 1, 2].map((row) => onTop([[LABEL.x + 3.4, LABEL.y + 3.4 + row * 1.8], [LABEL.x + (row === 1 ? 7 : 9.4), LABEL.y + 3.4 + row * 1.8]], 0.8, P)),
  ),
  labelScrews: [at([LABEL.x + 2.4, LABEL.y + LABEL.d - 2.2, 0.8]), at([LABEL.x + LABEL.w - 2.4, LABEL.y + LABEL.d - 2.2, 0.8])],
};

// ── the drawer ─────────────────────────────────────────────────────────

const FLOOR: Plan = { x: -2, y: -2, w: TX + 2, d: TY + 4, r: 1 };
const FAR_WALL: Plan = { x: -2, y: -2, w: 2, d: TY + 4, r: 0.6 };
const BACK_WALL: Plan = { x: 0, y: -2, w: TX, d: 2, r: 0.4 };
const NEAR_WALL: Plan = { x: 0, y: TY, w: TX, d: 2, r: 0.4 };
const DRAWER_FRONT: Plan = { x: TX, y: -3.5, w: FACE_X - TX, d: TY + 7, r: 0.8 };
const SKIDS: Plan[] = [6, 34].map((y) => ({ x: 4, y, w: TX - 8, d: 4, r: 1 }));

/** Rivets at the ends of the near wall and the corners of the drawer front. */
const nearRivets: Flat[] = [4, TX - 4].flatMap((x) => [at([x, TY + 2, ZF + 2.4]), at([x, TY + 2, WALL_TOP - 2.4])]);
const frontRivets: Flat[] = [DRAWER_FRONT.y + 2.4, DRAWER_FRONT.y + DRAWER_FRONT.d - 2.4].flatMap((y) => [at([FACE_X, y, SKID_Z + 2.6]), at([FACE_X, y, FRONT_TOP - 2.4])]);

/** The slot each rod rides up and down in, cut through the drawer front. */
const SLOTS = RODS.map((y) => faceRect(FACE_X, y - 1.25, y + 1.25, ROD_Z - 1.25, ROD_Z + LIFT + 1.25, 1.25));

/** The card-catalogue label holder above the slots: a frame, its card and two rivets. */
const HOLDER = { y0: TY / 2 - 8, y1: TY / 2 + 8, z0: 21.8, z1: 27 };

export const DRAWER = {
  halo: slab({ x: -3, y: -3, w: TX + 7, d: TY + 6, r: 2 }, 0, 4, 6).fill,
  skids: SKIDS.map((plan) => slab(plan, 0, SKID_Z, 3)),
  floor: slab(FLOOR, SKID_Z, ZF - SKID_Z, 4, 0.5),
  farWall: slab(FAR_WALL, ZF, WALL_TOP + 3 - ZF, 3, 0.4),
  backWall: slab(BACK_WALL, ZF, WALL_TOP - ZF, 3, 0.4),
  nearWall: slab(NEAR_WALL, ZF, WALL_TOP - ZF, 3, 0.4),
  nearSeam: seg([0, TY + 2, ZF + 4.8], [TX, TY + 2, ZF + 4.8]),
  nearRivets,
  front: slab(DRAWER_FRONT, SKID_Z, FRONT_TOP - SKID_Z, 4, 0.8),
  frontRivets,
  slots: join(SLOTS),
  holder: faceRect(FACE_X, HOLDER.y0, HOLDER.y1, HOLDER.z0, HOLDER.z1, 0.6),
  holderCard: faceRect(FACE_X, HOLDER.y0 + 1.2, HOLDER.y1 - 1.2, HOLDER.z0 + 1, HOLDER.z1 - 1.1, 0.2),
  holderRules: join(
    [0, 1].map((row) => {
      const z = HOLDER.z1 - 2.3 - row * 1.5;
      return seg([FACE_X, HOLDER.y0 + 2.6, z], [FACE_X, HOLDER.y0 + (row ? 8 : 11.5), z]);
    }),
  ),
  holderRivets: [at([FACE_X, HOLDER.y0 - 1.2, (HOLDER.z0 + HOLDER.z1) / 2]), at([FACE_X, HOLDER.y1 + 1.2, (HOLDER.z0 + HOLDER.z1) / 2])],
};

// ── the cards and dividers ─────────────────────────────────────────────

/** Line lengths for the passages' text, seeded by the card so no two cards read alike. */
function textOf(card: number) {
  const lengths: number[] = [];
  let seed = card * 7919 + 13;
  for (let row = 0; row < 6; row++) {
    seed = (seed * 16807) % 2147483647;
    lengths.push(row === 5 ? 9 + (seed % 9) : 22 + (seed % 12));
  }
  return lengths;
}

const TAB_Y = [4, 16, 28];

export type CardArt = {
  readonly x: number;
  readonly body: ReturnType<typeof slab>;
  readonly header: string;
  readonly text: string;
};

export type DividerArt = {
  readonly x: number;
  readonly body: ReturnType<typeof slab>;
  readonly tab: ReturnType<typeof slab>;
  readonly window: string;
};

export const CARD_ART: readonly CardArt[] = STANDING.filter((item) => item.kind === "card").map((item) => {
  const face = item.x + CARD_T / 2;
  const top = ZF + CARD_H;
  const lengths = textOf(item.kind === "card" ? item.card : 0);
  return {
    x: item.x,
    // Square-cornered, so the header rule ends on the card's corner edge rather than past a rounding.
    body: slab({ x: item.x - CARD_T / 2, y: CARD_Y, w: CARD_T, d: CARD_D, r: 0 }, ZF, CARD_H, 2),
    // The header rule runs the card's full width and round its edge, from outline to outline.
    header: sideSeam({ x: item.x - CARD_T / 2, y: CARD_Y, w: CARD_T, d: CARD_D, r: 0 }, top - 3.4, P, 2),
    text: join(lengths.map((length, row) => seg([face, CARD_Y + 3, top - 5.8 - row * 2.2], [face, CARD_Y + 3 + length, top - 5.8 - row * 2.2]))),
  };
});

export const DIVIDER_ART: readonly DividerArt[] = STANDING.flatMap((item) => {
  if (item.kind !== "divider") return [];
  const face = item.x + DIVIDER_T / 2;
  const top = ZF + CARD_H + 0.6;
  const y0 = TAB_Y[item.document] ?? 4;
  return [
    {
      x: item.x,
      body: slab({ x: item.x - DIVIDER_T / 2, y: CARD_Y - 0.5, w: DIVIDER_T, d: CARD_D + 1, r: 0.3 }, ZF, CARD_H + 0.6, 2),
      tab: slab({ x: item.x - DIVIDER_T / 2, y: y0, w: DIVIDER_T, d: 12, r: 0.5 }, top, 4.6, 3),
      window: faceRect(face, y0 + 1.6, y0 + 10.4, top + 0.9, top + 3.7, 0.4),
    },
  ];
});

/** The follower: a plate that keeps the last cards upright, on a block locked by a thumb screw. */
export const FOLLOWER = {
  plate: slab({ x: FOLLOWER_X, y: 3, w: 1.2, d: 38, r: 0.4 }, ZF, 17, 3, 0.3),
  block: slab({ x: FOLLOWER_X + 1.2, y: 15, w: 6.4, d: 14, r: 1 }, ZF, 3.6, 3, 0.4),
  screw: post(FOLLOWER_X + 4.6, 22, 1.7, ZF + 3.6, 3.2, 20),
  knurl: knurl(FOLLOWER_X + 4.6, 22, 1.7, ZF + 3.6, ZF + 6.8, 14, P),
  /** The chamfers the knurl band runs between. */
  chamfers: join([ZF + 4, ZF + 6.4].map((z) => sideArc(FOLLOWER_X + 4.6, 22, 1.7, z, P, 16))),
  screwTop: ring(FOLLOWER_X + 4.6, 22, 0.7, ZF + 6.8, P, 12),
};

// ── the rods ───────────────────────────────────────────────────────────

/** A rod's end where it comes out through its slot, and the nut that holds it. Built at rest. */
export const STUB_ART = RODS.map((y) => ({
  y,
  rod: slab({ x: FACE_X - 0.4, y: y - ROD_R, w: STUB_END - FACE_X + 0.4, d: ROD_R * 2, r: ROD_R }, ROD_Z - ROD_R, ROD_R * 2, 4),
  nut: slab({ x: STUB_END, y: y - NUT_R, w: NUT_W, d: NUT_R * 2, r: 0.4 }, ROD_Z - NUT_R, NUT_R * 2, 2, 0.3),
  nutFace: faceRect(STUB_END + NUT_W, y - 0.6, y + 0.6, ROD_Z - 0.6, ROD_Z + 0.6, 0.6),
}));

// ── the selector ───────────────────────────────────────────────────────

/** The lifter, built under the first rod at rest: an arm, the saddle the rod sits in, and the hanger's foot. */
const y0 = RODS[0];
export const LIFTER = {
  arm: slab({ x: FACE_X + 1.2, y: y0 - 1, w: HANGER_X - FACE_X + 0.2, d: 2, r: 0.6 }, ARM_TOP - ARM_H, ARM_H, 3, 0.3),
  saddle: slab({ x: FACE_X + 1.6, y: y0 - 1.2, w: 2.4, d: 2.4, r: 0.4 }, ARM_TOP, SADDLE_H, 2),
  boss: post(HANGER_X, y0, 1.7, ARM_TOP - ARM_H, ARM_H + 0.8, 20),
};

/**
 * The lead screw the lifter hangs from. One rod, drawn twice: below the
 * carriage and above it, each through a clip that stays put while the screw
 * moves, so it slides through the carriage rather than through two copies.
 */
const SCREW_FROM = ARM_TOP + 0.8;
export const SCREW = {
  rod: post(HANGER_X, y0, 1, SCREW_FROM, SCREW_TOP - SCREW_FROM, 20),
  threads: join(
    Array.from({ length: Math.floor((SCREW_TOP - CARRIAGE_TOP + LIFT + DROP) / 1.1) }, (_, index) =>
      sideArc(HANGER_X, y0, 1, CARRIAGE_TOP - LIFT - DROP + 0.6 + index * 1.1, P, 12),
    ),
  ),
  knob: post(HANGER_X, y0, 2.5, SCREW_TOP, KNOB_H, 32),
  knobKnurl: knurl(HANGER_X, y0, 2.5, SCREW_TOP, SCREW_TOP + KNOB_H, 30, P),
  /** The chamfers the knurl band runs between. */
  knobChamfers: join([SCREW_TOP + 0.4, SCREW_TOP + KNOB_H - 0.4].map((z) => sideArc(HANGER_X, y0, 2.5, z, P, 24))),
  knobRing: ring(HANGER_X, y0, 1.4, SCREW_TOP + KNOB_H, P, 20),
  /** Everything below the carriage's underside, around the screw. */
  below: cylinder(HANGER_X, y0, 3, -40, CARRIAGE_Z + 40, P, 24).fill,
  /** Everything above the carriage's top, around the screw. */
  above: cylinder(HANGER_X, y0, 3, CARRIAGE_TOP, 80, P, 24).fill,
};

const CARRIAGE: Plan = { x: CARRIAGE_X, y: y0 - 4.5, w: CARRIAGE_W, d: 9, r: 1 };
const carriageFace = CARRIAGE_X + CARRIAGE_W;
export const CARRIAGE_ART = {
  block: slab(CARRIAGE, CARRIAGE_Z, CARRIAGE_TOP - CARRIAGE_Z, 3, 0.5),
  /** Four cap screws on its face, where it bolts to the guide's runner. */
  screws: [
    [y0 - 3, CARRIAGE_TOP - 2],
    [y0 + 3, CARRIAGE_TOP - 2],
    [y0 - 3, CARRIAGE_Z + 2],
    [y0 + 3, CARRIAGE_Z + 2],
  ].map(([y, z]) => at([carriageFace, y!, z!])),
  /** The nut the screw turns in, seated in the carriage top. */
  nut: post(HANGER_X, y0, 1.9, CARRIAGE_TOP, 0.9, 20),
  /** An index finger reaching back over the beam's scale. */
  finger: slab({ x: BEAM.x + 1.4, y: y0 - 0.45, w: CARRIAGE_X - BEAM.x - 1.4, d: 0.9, r: 0.3 }, BEAM_Z + BEAM_H + 1.1, 0.6, 2),
  index: seg([BEAM.x + 1.6, y0, BEAM_Z + BEAM_H + 1.7], [BEAM.x + 1.6, y0, BEAM_Z + BEAM_H + 1.1]),
};

const SCALE: Plan = { x: BEAM.x + 0.8, y: RODS[0] - 6, w: 2.2, d: RODS[3] - RODS[0] + 12, r: 0.4 };
function scaleTicks() {
  const minor: string[] = [];
  const major: string[] = [];
  const edge = SCALE.x + 0.5;
  const top = BEAM_Z + BEAM_H + 0.4;
  for (let y = Math.ceil((SCALE.y + 1) * 2) / 2; y <= SCALE.y + SCALE.d - 1; y += 1.0625) {
    const near = RODS.some((rod) => Math.abs(rod - y) < 0.5);
    if (near) continue;
    minor.push(seg([edge, y, top], [edge + 0.9, y, top]));
  }
  for (const rod of RODS) major.push(seg([edge, rod, top], [edge + 1.6, rod, top]));
  return { minor: join(minor), major: join(major) };
}
const SCALE_TICKS = scaleTicks();

export const GANTRY = {
  backPost: POSTS[0]!,
  frontPost: POSTS[1]!,
  posts: POSTS.map(([x, y]) => ({
    foot: slab({ x: x - 5, y: y - 5, w: 10, d: 10, r: 1.4 }, 0, 1.6, 3, 0.4),
    footScrews: [at([x - 3.4, y - 3.4, 1.6]), at([x + 3.4, y + 3.4, 1.6]), at([x - 3.4, y + 3.4, 1.6]), at([x + 3.4, y - 3.4, 1.6])],
    collar: post(x, y, 3.6, 1.6, 2.4, 28),
    post: post(x, y, 2.4, 4, BEAM_Z - 4, 28),
    seams: join([10, 17, 24].map((z) => sideArc(x, y, 2.4, z, P, 16))),
  })),
  beam: slab(BEAM, BEAM_Z, BEAM_H, 3, 0.6),
  beamScrews: POSTS.map(([x, y]) => at([x, y, BEAM_Z + BEAM_H])),
  rail: slab({ x: RAIL_X, y: BEAM.y + 2, w: 1, d: BEAM.d - 4, r: 0.3 }, BEAM_Z + 0.8, BEAM_H - 1.6, 2),
  stops: [BEAM.y + 2.6, BEAM.y + BEAM.d - 3.6].map((y) => slab({ x: RAIL_X, y, w: 1.8, d: 1, r: 0.3 }, BEAM_Z + 0.6, BEAM_H - 1.2, 2)),
  scale: slab(SCALE, BEAM_Z + BEAM_H, 0.4, 2),
  scaleMinor: SCALE_TICKS.minor,
  scaleMajor: SCALE_TICKS.major,
};

/** World offsets, as screen transforms, for the live code. */
export const MOVE = {
  /** The carriage and lifter from rod 0 to `y`. */
  across: (y: number) => shift([0, y - y0, 0]),
  /** Up by `z`. */
  up: (z: number) => shift([0, 0, z]),
  /** Both at once. */
  both: (y: number, z: number) => shift([0, y - y0, z]),
};

export const LIMITS = { DROP, LIFT };
