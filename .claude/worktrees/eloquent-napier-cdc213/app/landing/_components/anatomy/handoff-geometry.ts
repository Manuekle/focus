import {
  corners,
  cylinder,
  extrude,
  fitProjection,
  insetPlan,
  iso,
  knurl,
  onTop,
  planOutline,
  ring,
  segment,
  sideArc,
  slabOf,
  translateAlong,
  type Flat,
  type Plan,
  type Plane,
  type Point3,
  type SolidPaths,
} from "@/components/iso/iso-kit";
import { around, barBetween, gearOf, roundAlong } from "./solids";

/**
 * Fig 05.2, built once: a tape transport with a manual override, on a bench.
 *
 * World units are about a pixel of the real thing: x along the tape, y across
 * the bench toward the viewer, z up. Static parts are paths computed here at
 * module load. The gears turn by swapping between precomputed phases, the
 * pinions slide up and down by a translate, and only the rocker, the flag and
 * the crank arm — the parts that tilt or swing — are rebuilt while they move.
 */

export const WIDTH = 600;
/** The capability cards' frame: 400 × 268, at this width. */
export const HEIGHT = 402;
const AZIMUTH = 55;
const ELEVATION = 32;

// ── the bench ──────────────────────────────────────────────────────────

const BASE: Plan = { x: 6, y: 14, w: 128, d: 68, r: 8 };
const BASE_H = 7;
const FOOT_H = 4;

// ── the tape ───────────────────────────────────────────────────────────

/** The supply spool, where the conversation comes from, and the take-up drum the gear turns. */
const SUPPLY: Plane = [26, 50];
export const DRUM: Plane = [82, 50];
/** Radius of the wound tape on either spool: the tape runs off their front tangent. */
export const PACK = 11;
const FLANGE = 12.5;
export const TAPE_Z0 = 8.4;
export const TAPE_Z1 = 20.6;
/** The tape's front face, where its print is. */
export const TAPE_FACE = DRUM[1] + PACK + 0.4;
const TAPE_FROM = SUPPLY[0];
const TAPE_TO = DRUM[0];
/** Where the head prints: a mark at tape position `u` is here when the tape has travelled `u`. */
export const HEAD_X = 54;
/** The run of tape the reader sees, between the two tangents. */
export const SPAN = { from: TAPE_FROM, to: TAPE_TO } as const;

/** The lanes: the customer's lines high on the tape, the agent's low. */
export const LANES = { customer: [18.7, 17.1], agent: [12.9, 11.3], ack: 12.1 } as const;

// ── the drive ──────────────────────────────────────────────────────────

const GEAR_Z = 26;
const GEAR_H = 3;
export const GEAR_TEETH = 32;
const GEAR_PITCH = 16;
export const PINION_TEETH = 16;
const PINION_PITCH = 8;
const TOOTH = 1.6;
const CENTRES = GEAR_PITCH + PINION_PITCH;
const RAD = Math.PI / 180;
/** Where each pinion meshes, by its angle round the drum. */
export const MESH = { motor: -35 * RAD, crank: 25 * RAD } as const;
const MOTOR: Plane = [DRUM[0] + CENTRES * Math.cos(MESH.motor), DRUM[1] + CENTRES * Math.sin(MESH.motor)];
const CRANK: Plane = [DRUM[0] + CENTRES * Math.cos(MESH.crank), DRUM[1] + CENTRES * Math.sin(MESH.crank)];
/** How far a pinion lifts to come out of mesh. */
export const LIFT = 5;

// ── the rocker ─────────────────────────────────────────────────────────

const PIVOT_R = Math.hypot(MOTOR[0] + CRANK[0] - 2 * DRUM[0], MOTOR[1] + CRANK[1] - 2 * DRUM[1]) / 2;
const PIVOT: Plane = [DRUM[0] + PIVOT_R * Math.cos((MESH.motor + MESH.crank) / 2), DRUM[1] + PIVOT_R * Math.sin((MESH.motor + MESH.crank) / 2)];
/** Half the rocker, pivot to pinion. */
const HALF = Math.hypot(CRANK[0] - PIVOT[0], CRANK[1] - PIVOT[1]);
/** Height of the rocker's centre line at the pivot. */
const PIVOT_Z = GEAR_Z + GEAR_H + 6;
/** The rocker's tilt either way: enough to lift a pinion `LIFT` clear. */
export const TILT = Math.asin(LIFT / 2 / HALF);
/** From the motor's end toward the crank's, level. */
const ALONG: Point3 = [(CRANK[0] - MOTOR[0]) / (2 * HALF), (CRANK[1] - MOTOR[1]) / (2 * HALF), 0];
const ACROSS: Point3 = [ALONG[1], -ALONG[0], 0];
/** The handle sits past the crank, on the person's side. */
const HANDLE_T = HALF + 8;

// ── the projection ─────────────────────────────────────────────────────

const box = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

export const P = fitProjection(
  [
    ...box(BASE, -BASE_H - FOOT_H, 0),
    [CRANK[0] - 6, CRANK[1] - 6, 52],
    [PIVOT[0] + ALONG[0] * HANDLE_T, PIVOT[1] + ALONG[1] * HANDLE_T, 48],
    [SUPPLY[0], SUPPLY[1] - FLANGE, 26],
  ],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: AZIMUTH, elevation: ELEVATION },
);

const at = (point: Point3): Flat => iso(point, P);
const seg = (a: Point3, b: Point3) => segment(a, b, P);
const slab = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const post = (x: number, y: number, r: number, z: number, h: number, steps = 32, bevel = 0) => cylinder(x, y, r, z, h, P, steps, bevel);
const join = (paths: string[]) => paths.join("");
const square = ([x, y]: Plane, size: number, r: number): Plan => ({ x: x - size / 2, y: y - size / 2, w: size, d: size, r });

/** The screen offset of a world move, for `transform`. */
export const shift = (by: Point3) => translateAlong(P, by);
export const up = (z: number) => shift([0, 0, z]);

// ── the bench ──────────────────────────────────────────────────────────

const FEET = corners(BASE, 15);
const SCREWS = corners(BASE, 6);
const LABEL: Plan = { x: 108, y: 66, w: 14, d: 10, r: 1 };
const SOCKET: Plan = { x: 114, y: 18, w: 8, d: 7, r: 1.2 };

export const BENCH = {
  halo: slab(BASE, -BASE_H - FOOT_H, BASE_H, 8).fill,
  feet: FEET.map(([x, y]) => [post(x, y, 6.5, -BASE_H - FOOT_H, 1.4, 28), post(x, y, 5, -BASE_H - FOOT_H + 1.4, FOOT_H - 1.4, 28)]),
  slab: slab(BASE, -BASE_H, BASE_H, 8, 1.6),
  groove: planOutline(insetPlan(BASE, 4), 0, P),
  screwRings: join(SCREWS.map(([x, y]) => ring(x, y, 2, 0, P, 16))),
  screws: SCREWS.map(([x, y]) => at([x, y, 0])),
  label: slab(LABEL, 0, 0.8, 4),
  labelLine: planOutline(insetPlan(LABEL, 1.4), 0.8, P, 4),
  labelRules: join(
    [0, 1, 2].map((row) => onTop([[LABEL.x + 3.4, LABEL.y + 3.4 + row * 1.8], [LABEL.x + (row === 1 ? 7 : 9.4), LABEL.y + 3.4 + row * 1.8]], 0.8, P)),
  ),
  labelScrews: [at([LABEL.x + 2.4, LABEL.y + LABEL.d - 2.2, 0.8]), at([LABEL.x + LABEL.w - 2.4, LABEL.y + LABEL.d - 2.2, 0.8])],
  /** The motor's supply: a socket on the bench, two pins showing on its face. */
  socket: slab(SOCKET, 0, 4.2, 3, 0.4),
  socketPins: [at([SOCKET.x + 2.4, SOCKET.y + SOCKET.d, 2.6]), at([SOCKET.x + SOCKET.w - 2.4, SOCKET.y + SOCKET.d, 2.6])],
};

// ── the spools ─────────────────────────────────────────────────────────

/** A spool on its pillow block: everything below the wound tape, the tape, and the flange over it. */
function spool([x, y]: Plane, hub: number) {
  const pillow = square([x, y], 14, 3);
  return {
    pillow: slab(pillow, 0, 3, 4, 0.5),
    pillowScrews: corners(pillow, 2.2).map(([px, py]) => at([px, py, 3])),
    boss: post(x, y, 4.2, 3, TAPE_Z0 - 1.2 - 3, 28),
    lower: post(x, y, FLANGE, TAPE_Z0 - 1.2, 1.2, 48),
    pack: post(x, y, PACK, TAPE_Z0, TAPE_Z1 - TAPE_Z0, 48),
    /** Layers in the wound tape, under its outline. */
    windings: join([TAPE_Z0 + 3, TAPE_Z1 - 3].map((z) => sideArc(x, y, PACK, z, P, 32))),
    upper: post(x, y, FLANGE, TAPE_Z1, 1.2, 48),
    hub: post(x, y, 3.6, TAPE_Z1 + 1.2, hub, 24),
    hubTop: TAPE_Z1 + 1.2 + hub,
  };
}

export const SUPPLY_ART = { ...spool(SUPPLY, 1.6), centre: SUPPLY };
export const DRUM_ART = { ...spool(DRUM, GEAR_Z - TAPE_Z1 - 1.2), centre: DRUM };

/** Three holes in a flange's top, turned by `angle`: what shows a spool turning. */
export function flangeHoles([x, y]: Plane, angle: number) {
  return join([0, 1, 2].map((hole) => ring(...(around(x, y, 7.6, angle + (hole * Math.PI * 2) / 3, 0).slice(0, 2) as Plane), 1.5, TAPE_Z1 + 1.2, P, 14)));
}

// ── the tape and the head ──────────────────────────────────────────────

/**
 * The run of tape between the packs. It leaves the supply pack and winds onto
 * the drum's at their front tangents, so it has no ends to draw: only its long
 * edges are stroked, and where it meets a pack the two faces run together.
 */
export const TAPE: SolidPaths = (() => {
  const solid = slab({ x: TAPE_FROM, y: TAPE_FACE - 0.8, w: TAPE_TO - TAPE_FROM, d: 0.8, r: 0 }, TAPE_Z0, TAPE_Z1 - TAPE_Z0, 1);
  const edge = (y: number, z: number) => seg([TAPE_FROM, y, z], [TAPE_TO, y, z]);
  return { ...solid, outline: edge(TAPE_FACE, TAPE_Z1) + edge(TAPE_FACE, TAPE_Z0) + edge(TAPE_FACE - 0.8, TAPE_Z1), crease: "" };
})();

/** A printed line on the tape's face, from x0 to x1 at height z. */
export const tapeLine = (x0: number, x1: number, z: number) => seg([x0, TAPE_FACE, z], [x1, TAPE_FACE, z]);

/** The platen the head strikes against, standing behind the tape. */
const PLATEN: Plan = { x: HEAD_X - 1.4, y: TAPE_FACE - 2.6, w: 2.8, d: 1.6, r: 0.4 };
const HEAD: Plan = { x: HEAD_X - 3.6, y: TAPE_FACE + 1.4, w: 7.2, d: 5.4, r: 1.2 };
const HEAD_FOOT: Plan = { x: HEAD_X - 5, y: TAPE_FACE + 2.2, w: 10, d: 8, r: 1.5 };
export const PRINTER = {
  platenFoot: slab({ x: HEAD_X - 3.5, y: TAPE_FACE - 6, w: 7, d: 4.6, r: 1 }, 0, 1.5, 3, 0.3),
  platen: slab(PLATEN, 1.5, TAPE_Z1 + 2.4 - 1.5, 2, 0.3),
  foot: slab(HEAD_FOOT, 0, 1.6, 3, 0.4),
  footScrews: [at([HEAD_FOOT.x + 1.8, HEAD_FOOT.y + HEAD_FOOT.d - 1.8, 1.6]), at([HEAD_FOOT.x + HEAD_FOOT.w - 1.8, HEAD_FOOT.y + HEAD_FOOT.d - 1.8, 1.6])],
  post: post(HEAD_X, HEAD.y + HEAD.d / 2 + 0.6, 1.6, 1.6, 9.4 - 1.6, 20),
  head: slab(HEAD, 9.4, 6.2, 3, 0.6),
  /** Where it bolts to its post, on the block's face. */
  headScrews: [at([HEAD.x + 1.6, HEAD.y + HEAD.d, 14]), at([HEAD.x + HEAD.w - 1.6, HEAD.y + HEAD.d, 14])],
  /** The type hammer, between the head and the tape, level with the agent's lane. */
  hammer: slab({ x: HEAD_X - 0.8, y: TAPE_FACE + 0.15, w: 1.6, d: 1.3, r: 0.3 }, 10.9, 2.4, 2),
  /** The ribbon cartridge on top, and its two spools. */
  ribbon: slab({ x: HEAD.x + 0.8, y: HEAD.y + 1, w: HEAD.w - 1.6, d: HEAD.d - 2, r: 0.8 }, 15.6, 1.2, 3, 0.3),
  ribbonSpools: [HEAD.x + 2.4, HEAD.x + HEAD.w - 2.4].map((x) => ring(x, HEAD.y + HEAD.d / 2, 1, 16.8, P, 14)),
};

// ── the gear and the pinions ───────────────────────────────────────────

/** Phases a tooth is cut into: the gears turn by swapping between them. */
export const PHASES = 16;
const phases = (make: (phase: number) => SolidPaths) => Array.from({ length: PHASES }, (_, phase) => make(phase / PHASES));

export const GEAR = {
  phases: phases((phase) => gearOf(DRUM[0], DRUM[1], GEAR_PITCH, GEAR_TEETH, TOOTH, phase, GEAR_Z, GEAR_H, P)),
  cap: post(DRUM[0], DRUM[1], 2.6, GEAR_Z + GEAR_H, 1.2, 24),
  capRing: ring(DRUM[0], DRUM[1], 1.2, GEAR_Z + GEAR_H + 1.2, P, 14),
};

/** Five lightening holes in the gear's web, turned by `angle`. */
export function gearHoles(angle: number) {
  return join([0, 1, 2, 3, 4].map((hole) => ring(...(around(DRUM[0], DRUM[1], 9.6, angle + (hole * Math.PI * 2) / 5, 0).slice(0, 2) as Plane), 2.2, GEAR_Z + GEAR_H, P, 16)));
}

/**
 * The pinion's tooth phase that meshes with the gear at `gear`, for the
 * pinion at angle `mesh` round it: a pinion tooth sits in the gear's gap on
 * the line between the centres, and the two turn opposite ways.
 */
export function meshPhase(gear: number, mesh: number) {
  const gap = (mesh * GEAR_TEETH) / (Math.PI * 2) - 1.07;
  const tooth = ((mesh + Math.PI) * PINION_TEETH) / (Math.PI * 2) - 0.57;
  return (((gap + tooth - gear) % 1) + 1) % 1;
}

/** A pinion's angle from its tooth phase and how many whole teeth it has turned. */
export const pinionAngle = (phase: number) => (phase * Math.PI * 2) / PINION_TEETH;

/** Where a rocker eye's centre sits over a pinion in mesh: on its collar. */
const EYE_Z = PIVOT_Z - LIFT / 2;

function pinion([x, y]: Plane) {
  return {
    phases: phases((phase) => gearOf(x, y, PINION_PITCH, PINION_TEETH, TOOTH, phase, GEAR_Z, GEAR_H, P)),
    /** The collar the rocker's eye bears on. */
    collar: post(x, y, 2.4, GEAR_Z + GEAR_H, EYE_Z - 0.8 - GEAR_Z - GEAR_H, 20),
  };
}

// ── the motor: the agent ───────────────────────────────────────────────

const CAN_R = 7;
const CAN_TOP = 19;
const CRADLE = square(MOTOR, 14, 2);
export const MOTOR_ART = {
  cradle: slab(CRADLE, 0, 1.8, 4, 0.4),
  cradleScrews: corners(CRADLE, 2).map(([x, y]) => at([x, y, 1.8])),
  can: post(MOTOR[0], MOTOR[1], CAN_R, 1.8, CAN_TOP - 1.8, 40),
  /** The cooling fins, between two seams. */
  fins: knurl(MOTOR[0], MOTOR[1], CAN_R, 3.4, CAN_TOP - 1.4, 30, P),
  finSeams: join([3.8, CAN_TOP - 1.8].map((z) => sideArc(MOTOR[0], MOTOR[1], CAN_R, z, P, 32))),
  /** The terminal box, on the can's far side from the gear, where the cable comes in. */
  box: slab({ x: MOTOR[0] + CAN_R - 1, y: MOTOR[1] - 3, w: 3.6, d: 6, r: 0.6 }, 7, 5.4, 2, 0.3),
  boxScrews: [at([MOTOR[0] + CAN_R - 0.2, MOTOR[1] + 3, 11.6]), at([MOTOR[0] + CAN_R + 1.8, MOTOR[1] + 3, 11.6])],
  bell: post(MOTOR[0], MOTOR[1], 6, CAN_TOP, 2, 36, 0.4),
  boss: post(MOTOR[0], MOTOR[1], 2.6, CAN_TOP + 2, 2, 20),
  /** The splined shaft the pinion slides on: shows only while the pinion is up. */
  shaft: post(MOTOR[0], MOTOR[1], 1.1, CAN_TOP + 4, GEAR_Z + LIFT - CAN_TOP - 4, 16),
  /** The cable gland on the terminal box's face, where the cable leaves it. */
  gland: roundAlong([MOTOR[0] + CAN_R + 2.6, MOTOR[1], 9.2], [1, 0, 0], 0.9, 0.9, P, 14),
  /** The cable, out of the gland, down to the bench and round to the socket's plug. */
  cable: [
    at([MOTOR[0] + CAN_R + 3.5, MOTOR[1], 9.2]),
    at([MOTOR[0] + CAN_R + 4.4, MOTOR[1], 9.2]),
    at([MOTOR[0] + CAN_R + 4.4, MOTOR[1], 0.6]),
    at([MOTOR[0] + CAN_R + 4.4, SOCKET.y + SOCKET.d + 4.2, 0.6]),
    at([SOCKET.x + SOCKET.w / 2, SOCKET.y + SOCKET.d + 4.2, 0.6]),
    at([SOCKET.x + SOCKET.w / 2, SOCKET.y + SOCKET.d + 1.8, 0.6]),
  ],
  /** The plug in the socket's face. */
  plug: slab({ x: SOCKET.x + SOCKET.w / 2 - 1.3, y: SOCKET.y + SOCKET.d, w: 2.6, d: 1.8, r: 0.4 }, 0, 2.2, 2, 0.2),
  pinion: pinion(MOTOR),
  /** Above the eye: the stub's end and its nut. */
  stub: post(MOTOR[0], MOTOR[1], 1.1, PIVOT_Z - LIFT / 2 + 0.8, 1.8, 16),
  nut: post(MOTOR[0], MOTOR[1], 1.8, PIVOT_Z - LIFT / 2 + 2.6, 1, 6),
  centre: MOTOR,
};

// ── the crank: the person ──────────────────────────────────────────────

const PEDESTAL_TOP = 23;
export const CRANK_ART = {
  flange: post(CRANK[0], CRANK[1], 4.6, 0, 1.6, 32, 0.4),
  flangeScrews: [0, 1, 2].map((screw) => at(around(CRANK[0], CRANK[1], 3.4, ((screw * 120 + 30) * Math.PI) / 180, 1.6))),
  tube: post(CRANK[0], CRANK[1], 2.4, 1.6, PEDESTAL_TOP - 1.6, 24),
  tubeSeam: sideArc(CRANK[0], CRANK[1], 2.4, 12, P, 20),
  bearing: post(CRANK[0], CRANK[1], 3.1, PEDESTAL_TOP, 1.4, 24, 0.3),
  shaft: post(CRANK[0], CRANK[1], 1.1, PEDESTAL_TOP + 1.4, GEAR_Z + LIFT - PEDESTAL_TOP - 1.4, 16),
  pinion: pinion(CRANK),
  /** The sleeve from the eye up to the arm. */
  sleeve: post(CRANK[0], CRANK[1], 1.3, PIVOT_Z - LIFT / 2 + 0.8, 4.2, 16),
  centre: CRANK,
};

const ARM_Z = PIVOT_Z - LIFT / 2 + 5;
const ARM_LONG = 8;

/** The crank's arm and its grip, turned to `angle` and built at the crank's lowest. */
export function crankArm(angle: number) {
  const [x, y] = CRANK;
  const [ex, ey] = around(x, y, ARM_LONG, angle, 0);
  const width = 2.2;
  const [nx, ny] = [-Math.sin(angle) * (width / 2), Math.cos(angle) * (width / 2)];
  const ringOf: Plane[] = [
    [x + nx, y + ny],
    [ex + nx, ey + ny],
    [ex - nx, ey - ny],
    [x - nx, y - ny],
  ];
  return {
    hub: post(x, y, 2.1, ARM_Z, 1.6, 20),
    arm: extrude(ringOf, ARM_Z + 0.1, 1.4, P, { convex: true }),
    boss: post(ex, ey, 1.4, ARM_Z, 1.6, 16),
    grip: post(ex, ey, 1.1, ARM_Z + 1.6, 3.6, 16),
    knob: post(ex, ey, 1.4, ARM_Z + 5.2, 0.9, 18, 0.3),
  };
}

// ── the rocker ─────────────────────────────────────────────────────────

const PIVOT_POST_TOP = PIVOT_Z - 0.8 - 2.6;
export const PIVOT_ART = {
  foot: slab(square(PIVOT, 7, 1.4), 0, 1.4, 3, 0.3),
  footScrews: corners(square(PIVOT, 7, 1.4), 1.4).map(([x, y]) => at([x, y, 1.4])),
  post: post(PIVOT[0], PIVOT[1], 1.7, 1.4, PIVOT_POST_TOP - 1.4, 20),
  seams: join([10, 20].map((z) => sideArc(PIVOT[0], PIVOT[1], 1.7, z, P, 14))),
  /** The yoke the rocker rides on, square to it. */
  yoke: barBetween(
    [PIVOT[0] - ALONG[0] * 1.8, PIVOT[1] - ALONG[1] * 1.8, PIVOT_POST_TOP + 1.3],
    [PIVOT[0] + ALONG[0] * 1.8, PIVOT[1] + ALONG[1] * 1.8, PIVOT_POST_TOP + 1.3],
    ACROSS,
    4.2,
    2.6,
    P,
  ),
};

/**
 * A point on the rocker's centre line, `t` from the pivot toward the crank,
 * at tilt `tilt`. Its eyes stay over their shafts (the slots they ride in take
 * up the few hundredths a tilt shortens it by), so plan positions don't tilt.
 */
const onRocker = (t: number, tilt: number): Point3 => [PIVOT[0] + ALONG[0] * t, PIVOT[1] + ALONG[1] * t, PIVOT_Z + t * Math.sin(tilt)];

/** How far each pinion stands above its mesh at tilt `tilt`. */
export const liftsAt = (tilt: number) => ({
  motor: LIFT / 2 - HALF * Math.sin(tilt),
  crank: LIFT / 2 + HALF * Math.sin(tilt),
});

/** The rocker at tilt `tilt`: the bar, an eye round each pinion's stub, the handle. */
export function rocker(tilt: number) {
  const lifts = liftsAt(tilt);
  const motorEye: Point3 = [MOTOR[0], MOTOR[1], EYE_Z + lifts.motor];
  const crankEye: Point3 = [CRANK[0], CRANK[1], EYE_Z + lifts.crank];
  const handle = onRocker(HANDLE_T, tilt);
  const axis: Point3 = [-ALONG[0] * Math.sin(tilt), -ALONG[1] * Math.sin(tilt), Math.cos(tilt)];
  const eye = (centre: Point3) => roundAlong([centre[0] - axis[0] * 0.8, centre[1] - axis[1] * 0.8, centre[2] - axis[2] * 0.8], axis, 2.6, 1.6, P, 18);
  const top = (point: Point3, by: number): Point3 => [point[0] + axis[0] * by, point[1] + axis[1] * by, point[2] + axis[2] * by];
  return {
    bar: barBetween(motorEye, handle, ACROSS, 2.2, 1.6, P),
    motorEye: eye(motorEye),
    crankEye: eye(crankEye),
    grip: roundAlong(top(handle, 0.8), axis, 0.7, 5.2, P, 12),
    /** A ball, as near as a short round bar gets: wide, and as tall as it is wide. */
    knob: roundAlong(top(handle, 5.6), axis, 2, 3.2, P, 18),
    pin: at(onRocker(0, tilt)),
  };
}

// ── the person's corner: the note and the flag ─────────────────────────

const STATION: Plan = { x: 12, y: 66, w: 30, d: 10, r: 1.6 };
const CARD: Plan = { x: 16, y: 70.2, w: 10, d: 0.6, r: 0 };
const CARD_Z = 4.4;
const CARD_H = 9.4;
const FLAG_AT: Point3 = [33, 71.2, 13.6];

export const STATION_ART = {
  base: slab(STATION, 0, 2, 4, 0.4),
  screws: [at([STATION.x + 2, STATION.y + STATION.d - 2, 2]), at([STATION.x + STATION.w - 2, STATION.y + STATION.d - 2, 2])],
  /** The holder the card stands in. */
  holder: slab({ x: CARD.x - 0.6, y: CARD.y - 1.2, w: CARD.w + 1.2, d: 3, r: 0.6 }, 2, CARD_Z - 2, 3, 0.3),
  card: slab(CARD, CARD_Z, CARD_H, 1),
  /** What they asked, in three lines: printed text, so its ends may stop on the card. */
  note: join(
    [7.2, 5.6, 4].map((height, row) =>
      seg([CARD.x + 1.4, CARD.y + CARD.d, CARD_Z + height], [CARD.x + 1.4 + [7, 5.6, 3.4][row]!, CARD.y + CARD.d, CARD_Z + height]),
    ),
  ),
  /** The clip over the card, on its own spring. */
  clip: slab({ x: CARD.x + CARD.w / 2 - 1.2, y: CARD.y - 0.4, w: 2.4, d: 1.4, r: 0.4 }, CARD_Z + CARD_H - 2.2, 3, 2),
  flagPost: post(FLAG_AT[0], FLAG_AT[1], 0.9, 2, FLAG_AT[2] - 2 - 0.9, 14),
  pivot: post(FLAG_AT[0], FLAG_AT[1], 1.4, FLAG_AT[2] - 0.9, 1.4, 16),
};

/**
 * The flag at `raise` (0 down along the bench, 1 straight up): an arm and its
 * plate, swinging in the plane facing the viewer about the pivot on its post.
 */
export function flag(raise: number) {
  const angle = (raise * Math.PI) / 2;
  const out: Point3 = [Math.cos(angle), 0, Math.sin(angle)];
  const side: Point3 = [0, 1, 0];
  const from: Point3 = [FLAG_AT[0], FLAG_AT[1] + 0.6, FLAG_AT[2]];
  const point = (by: number): Point3 => [from[0] + out[0] * by, from[1], from[2] + out[2] * by];
  const normal: Point3 = [-out[2], 0, out[0]];
  const plate = (a: number, b: number, width: number, offset: number) => {
    const start = point(a);
    return barBetween([start[0] + normal[0] * offset, start[1], start[2] + normal[2] * offset], [point(b)[0] + normal[0] * offset, start[1], point(b)[2] + normal[2] * offset], side, 0.5, width, P);
  };
  return {
    arm: plate(0, 8.2, 0.8, 0),
    plate: plate(3.8, 8.4, 3.6, 1.4),
  };
}

export const LIMITS = { LIFT, TILT, HALF };
