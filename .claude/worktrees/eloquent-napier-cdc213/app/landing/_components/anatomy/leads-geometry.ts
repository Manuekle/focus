import {
  corners,
  cylinder,
  extrude,
  fitProjection,
  insetPlan,
  iso,
  onTop,
  pathOf,
  planOutline,
  radialTicks,
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
import { STATIONS } from "./leads-model";
import { around, barBetween, cutDisc, orientedBox } from "./solids";

/**
 * Fig 05.3, built once: an indexing table on a Geneva drive, on a bench.
 *
 * World units are about a pixel of the real thing: x and y on the bench, z
 * up. Fixed parts are paths computed here. What turns — the drive's arm and
 * pin, the Geneva wheel, the table and what rides on it — is rebuilt from an
 * angle, and the cards that slide (into a tray, into the contacts box) are
 * boxes built where they stand.
 */

export const WIDTH = 600;
/** The capability cards' frame: 400 × 268, at this width. */
export const HEIGHT = 402;
const AZIMUTH = 52;
const ELEVATION = 34;
const RAD = Math.PI / 180;

/** The table's axis. */
export const TABLE: Plane = [62, 56];
/** A round bench for a rotary machine: no empty corners. */
const BASE_R = 48;
const BASE: Plan = { x: TABLE[0] - BASE_R, y: TABLE[1] - BASE_R, w: BASE_R * 2, d: BASE_R * 2, r: BASE_R };
const BASE_H = 7;
const FOOT_H = 4;

// ── the Geneva drive ───────────────────────────────────────────────────

/** The pin's radius on the drive: for four slots the centres are √2 of it apart. */
const ARM = 13;
const CENTRES = ARM * Math.SQRT2;
/** Which way the drive sits from the table. */
const BETA = 45 * RAD;
export const DRIVE: Plane = [TABLE[0] + CENTRES * Math.cos(BETA), TABLE[1] + CENTRES * Math.sin(BETA)];
const WHEEL_R = Math.sqrt(CENTRES * CENTRES - ARM * ARM);
const SLOT_HALF = 1.5;
const SLOT_IN = CENTRES - ARM - 1.4;
const PIN_R = 1.2;
const LOCK_R = 7.4;
const WHEEL_Z = 5;
const WHEEL_H = 2.6;

/**
 * The table's angle when the drive has turned `turns` (clockwise, one turn a
 * poll). While the pin is in a slot the wheel follows it — the slot always
 * points at the pin — and for the other three quarters it is locked.
 */
export function tableAngle(turns: number) {
  const whole = Math.floor(turns);
  const local = turns - whole;
  if (local >= 0.25) return (whole + 1) * (Math.PI / 2);
  // The pin enters a quarter turn before the line of centres and leaves a quarter after.
  const pinAt = (t: number) => around(DRIVE[0], DRIVE[1], ARM, BETA + Math.PI + Math.PI / 4 - t * Math.PI * 2, 0);
  const slotOf = (t: number) => {
    const [x, y] = pinAt(t);
    return Math.atan2(y - TABLE[1], x - TABLE[0]);
  };
  let swept = slotOf(local) - slotOf(0);
  swept = ((swept % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return whole * (Math.PI / 2) + Math.abs(swept);
}

/** The drive's own angle: where its pin stands, after `turns`. */
export const pinAngle = (turns: number) => BETA + Math.PI + Math.PI / 4 - turns * Math.PI * 2;

/** The Geneva wheel's outline on top: four slots, and between them the arcs the locking disc rides. */
function wheelRing(angle: number): Plane[] {
  const out: Plane[] = [];
  for (let slot = 0; slot < STATIONS; slot++) {
    const axis = angle + slot * (Math.PI / 2);
    const [ux, uy] = [Math.cos(axis), Math.sin(axis)];
    const [nx, ny] = [-uy, ux];
    // The slot: in from the rim on one side, round its end, out on the other.
    const at = (r: number, side: number): Plane => [TABLE[0] + ux * r + nx * side, TABLE[1] + uy * r + ny * side];
    out.push(at(WHEEL_R, -SLOT_HALF), at(SLOT_IN, -SLOT_HALF));
    // Round the slot's inner end, from its −side through the axis to its +side.
    for (let step = 1; step < 6; step++) {
      const a = -Math.PI / 2 - (step / 6) * Math.PI;
      out.push(at(SLOT_IN + SLOT_HALF * Math.cos(a), SLOT_HALF * Math.sin(a)));
    }
    out.push(at(SLOT_IN, SLOT_HALF), at(WHEEL_R, SLOT_HALF));
    // The rim to the next slot, scooped where the locking disc turns against it.
    const centre = around(TABLE[0], TABLE[1], CENTRES, axis + Math.PI / 4, 0);
    const from = axis + Math.asin(SLOT_HALF / WHEEL_R);
    const to = axis + Math.PI / 2 - Math.asin(SLOT_HALF / WHEEL_R);
    for (let step = 0; step <= 18; step++) {
      const a = from + ((to - from) * step) / 18;
      const point = around(TABLE[0], TABLE[1], WHEEL_R, a, 0);
      const dx = point[0] - centre[0];
      const dy = point[1] - centre[1];
      const reach = Math.hypot(dx, dy);
      out.push(reach < LOCK_R + 0.4 ? [centre[0] + (dx / reach) * (LOCK_R + 0.4), centre[1] + (dy / reach) * (LOCK_R + 0.4)] : [point[0], point[1]]);
    }
  }
  return out;
}

// ── the table ──────────────────────────────────────────────────────────

const HUB_Z = 10;
const ARM_Z = 10.6;
export const TRAY_R = 24;
const TRAY_DEPTH = 7.6;
const TRAY_WIDTH = 13.6;
const FLOOR_Z = 11.8;
export const FLOOR_TOP = FLOOR_Z + 1;
/** Where a card stands in a tray, from the inside out. */
export const SLOTS_R = [22.2, 24.2, 26.2] as const;
export const CARD = { width: 11, thick: 0.7, height: 14 } as const;
/** Where each campaign's tab sits along the card's top. */
const TABS = [-3.6, -0.9, 1.8] as const;

/** The four stations, by the angle a tray stands at there: intake, stamp, first message, file. */
export const STATION_ANGLE = [270, 0, 90, 180].map((degrees) => degrees * RAD);

// ── the projection ─────────────────────────────────────────────────────

const box = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

export const P = fitProjection(
  [...box(BASE, -BASE_H - FOOT_H, 0), [TABLE[0] + 8, TABLE[1] - 42, 42], [TABLE[0], TABLE[1] + 37, 40]],
  WIDTH,
  HEIGHT,
  { pad: 24, azimuth: AZIMUTH, elevation: ELEVATION },
);

const at = (point: Point3): Flat => iso(point, P);
const slab = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const post = (x: number, y: number, r: number, z: number, h: number, steps = 32, bevel = 0) => cylinder(x, y, r, z, h, P, steps, bevel);
const join = (paths: string[]) => paths.join("");

/** A rounded rectangle on a face square to y (normal +y), at y = `y`: a slot, a window. */
function faceY(y: number, x0: number, x1: number, z0: number, z1: number) {
  return pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);
}

// ── the bench ──────────────────────────────────────────────────────────

/** Points round the bench at `inset` from its rim, between the stations. */
const rimPoints = (inset: number): Plane[] => [45, 135, 225, 315].map((degrees) => around(TABLE[0], TABLE[1], BASE_R - inset, degrees * RAD, 0).slice(0, 2) as Plane);
const SCREWS = rimPoints(6);
const LABEL: Plan = { x: TABLE[0] + 9, y: TABLE[1] + 28, w: 13, d: 8, r: 1 };
export const BENCH = {
  halo: slab(BASE, -BASE_H - FOOT_H, BASE_H, 24).fill,
  feet: rimPoints(15).map(([x, y]) => [post(x, y, 6.5, -BASE_H - FOOT_H, 1.4, 28), post(x, y, 5, -BASE_H - FOOT_H + 1.4, FOOT_H - 1.4, 28)]),
  slab: slab(BASE, -BASE_H, BASE_H, 24, 1.6),
  groove: planOutline(insetPlan(BASE, 4), 0, P, 24),
  screwRings: join(SCREWS.map(([x, y]) => ring(x, y, 2, 0, P, 16))),
  screws: SCREWS.map(([x, y]) => at([x, y, 0])),
  label: slab(LABEL, 0, 0.8, 4),
  labelLine: planOutline(insetPlan(LABEL, 1.4), 0.8, P, 4),
  labelRules: join([0, 1, 2].map((row) => onTop([[LABEL.x + 3.4, LABEL.y + 3.4 + row * 1.8], [LABEL.x + (row === 1 ? 7 : 9.4), LABEL.y + 3.4 + row * 1.8]], 0.8, P))),
  labelScrews: [at([LABEL.x + 2.4, LABEL.y + LABEL.d - 2.2, 0.8]), at([LABEL.x + LABEL.w - 2.4, LABEL.y + LABEL.d - 2.2, 0.8])],
};

// ── the drive: the five-minute clock ──────────────────────────────────

const GEARBOX: Plan = { x: DRIVE[0] - 7, y: DRIVE[1] - 7, w: 14, d: 14, r: 2 };
const DIAL_R = 16.5;
const DIAL_Z = 3.4;
const DIAL_TICKS = radialTicks(DRIVE[0], DRIVE[1], DIAL_R, 20, 4, DIAL_Z + 0.6, [0.7, 1.2], P);
export const DRIVE_ART = {
  gearbox: slab(GEARBOX, 0, DIAL_Z, 4, 0.5),
  gearboxScrews: corners(GEARBOX, 1.8).map(([x, y]) => at([x, y, DIAL_Z])),
  /** The clock motor that turns it, on the gearbox's side. */
  motor: post(DRIVE[0] + 7 + 3.4, DRIVE[1] - 2, 3.4, 0, 6.6, 28),
  motorSeams: join([1.6, 5].map((z) => sideArc(DRIVE[0] + 10.4, DRIVE[1] - 2, 3.4, z, P, 20))),
  motorCap: post(DRIVE[0] + 10.4, DRIVE[1] - 2, 1.6, 6.6, 0.8, 16),
  /** The dial the drive sweeps once every five minutes: a tick a quarter-minute, a long one a minute. */
  dial: post(DRIVE[0], DRIVE[1], DIAL_R, DIAL_Z, 0.6, 64, 0.2),
  dialMinor: DIAL_TICKS.minor,
  dialMajor: DIAL_TICKS.major,
  hub: post(DRIVE[0], DRIVE[1], 4.4, DIAL_Z + 0.6, WHEEL_Z - DIAL_Z - 0.6, 28),
};

/** The drive's pin, built at the drive's angle 0 and carried round by a translate: a round pin looks the same from every side. */
export const PIN = post(DRIVE[0] + ARM, DRIVE[1], PIN_R, WHEEL_Z - 0.4, WHEEL_H + 2, 16);

/** The drive's turning parts at `turns`: its locking disc, its arm, and where the pin has gone. */
export function drive(turns: number) {
  const angle = pinAngle(turns);
  const [px, py] = around(DRIVE[0], DRIVE[1], ARM, angle, 0);
  // The locking disc is cut away on the pin's side, so the wheel can turn past it while the pin drives.
  const lock: Plane[] = [];
  for (let step = 0; step <= 40; step++) {
    const a = angle + Math.PI / 2.6 + (step / 40) * (Math.PI * 2 - (2 * Math.PI) / 2.6);
    lock.push([DRIVE[0] + LOCK_R * Math.cos(a), DRIVE[1] + LOCK_R * Math.sin(a)]);
  }
  for (let step = 1; step < 12; step++) {
    const a = angle - Math.PI / 2.6 + (step / 12) * ((2 * Math.PI) / 2.6);
    lock.push([DRIVE[0] + 3.6 * Math.cos(a) + 1.2 * Math.cos(angle), DRIVE[1] + 3.6 * Math.sin(a) + 1.2 * Math.sin(angle)]);
  }
  return {
    lock: extrude(lock, WHEEL_Z, WHEEL_H, P, { convex: false }),
    arm: barBetween([DRIVE[0], DRIVE[1], WHEEL_Z + WHEEL_H + 0.7], [px, py, WHEEL_Z + WHEEL_H + 0.7], [-Math.sin(angle), Math.cos(angle), 0], 3, 1.4, P),
    pin: translateAlong(P, [px - DRIVE[0] - ARM, py - DRIVE[1], 0]),
    cap: post(DRIVE[0], DRIVE[1], 2.2, WHEEL_Z + WHEEL_H + 1.4, 1, 18),
  };
}

// ── the Geneva wheel and the table on it ───────────────────────────────

export const TABLE_ART = {
  pillar: slab({ x: TABLE[0] - 6, y: TABLE[1] - 6, w: 12, d: 12, r: 2 }, 0, 3, 4, 0.5),
  pillarScrews: corners({ x: TABLE[0] - 6, y: TABLE[1] - 6, w: 12, d: 12, r: 2 }, 1.8).map(([x, y]) => at([x, y, 3])),
  bearing: post(TABLE[0], TABLE[1], 4, 3, WHEEL_Z - 3, 28),
  shaft: post(TABLE[0], TABLE[1], 1.8, WHEEL_Z + WHEEL_H, HUB_Z - WHEEL_Z - WHEEL_H, 18),
};

/** The Geneva wheel at `angle`: a disc as wide as its rim, its slots and scoops cut on top. */
export const wheel = (angle: number): SolidPaths => cutDisc(TABLE[0], TABLE[1], WHEEL_R, wheelRing(angle), WHEEL_Z, WHEEL_H, P);

/** The table's hub and its four arms, turned to `angle`. */
export function spider(angle: number) {
  return {
    hub: post(TABLE[0], TABLE[1], 6.4, HUB_Z, 2.6, 36, 0.5),
    hubRing: ring(TABLE[0], TABLE[1], 2.8, HUB_Z + 2.6, P, 18),
    arms: Array.from({ length: STATIONS }, (_, arm) => {
      const a = angle + STATION_ANGLE[0]! + arm * (Math.PI / 2);
      return {
        depth: around(TABLE[0], TABLE[1], 14, a, 0),
        paths: barBetween(around(TABLE[0], TABLE[1], 5.6, a, ARM_Z + 0.6), around(TABLE[0], TABLE[1], TRAY_R - TRAY_DEPTH / 2 + 1, a, ARM_Z + 0.6), [-Math.sin(a), Math.cos(a), 0], 3.4, 1.4, P),
      };
    }),
  };
}

/** A box square to the radius at `a`: `r0`–`r1` out, `t0`–`t1` along, `z0`–`z1` up. */
function radialBox(a: number, r0: number, r1: number, t0: number, t1: number, z0: number, z1: number) {
  const out: Point3 = [Math.cos(a), Math.sin(a), 0];
  const along: Point3 = [-Math.sin(a), Math.cos(a), 0];
  const origin: Point3 = [TABLE[0] + out[0] * r0 + along[0] * t0, TABLE[1] + out[1] * r0 + along[1] * t0, z0];
  return orientedBox(origin, [out[0] * (r1 - r0), out[1] * (r1 - r0), 0], [along[0] * (t1 - t0), along[1] * (t1 - t0), 0], [0, 0, z1 - z0], P);
}

/** A tray at angle `a`: its floor, its inner wall and its two end walls. */
export function tray(a: number) {
  const r0 = TRAY_R - TRAY_DEPTH / 2;
  const r1 = TRAY_R + TRAY_DEPTH / 2;
  const half = TRAY_WIDTH / 2;
  return {
    floor: radialBox(a, r0, r1, -half, half, FLOOR_Z, FLOOR_TOP),
    inner: radialBox(a, r0, r0 + 1, -half, half, FLOOR_TOP, FLOOR_TOP + 5),
    ends: [-1, 1].map((side) => ({
      side,
      paths: radialBox(a, r0, r1, side < 0 ? -half : half - 1, side < 0 ? -half + 1 : half, FLOOR_TOP, FLOOR_TOP + 3.6),
    })),
  };
}

/** Where a point `r` out and `t` along stands, for a card at angle `a`. */
const onRadius = (a: number, r: number, t: number, z: number): Point3 => [TABLE[0] + Math.cos(a) * r - Math.sin(a) * t, TABLE[1] + Math.sin(a) * r + Math.cos(a) * t, z];

/**
 * A lead's card, standing square to the radius at angle `a`, `r` out from the
 * table's axis (its centre), and lifted `lift`: the card, its campaign tab, the
 * lines of the form on its outer face, the stamp once it has one, and the
 * first message's flag once it has been sent (`flag` 0–1 is how far it has risen).
 */
export function card(a: number, r: number, campaign: number, stamped: number, flag: number, lift = 0) {
  const half = CARD.width / 2;
  const z0 = FLOOR_TOP + lift;
  const z1 = z0 + CARD.height;
  const body = radialBox(a, r - CARD.thick / 2, r + CARD.thick / 2, -half, half, z0, z1);
  const tabAt = TABS[campaign % TABS.length]!;
  const tab = radialBox(a, r - CARD.thick / 2, r + CARD.thick / 2, tabAt - 1.1, tabAt + 1.1, z1, z1 + 1.4);
  const face = r + CARD.thick / 2;
  const rules = join(
    [2.8, 4.8, 6.8, 8.8].map((down, row) => pathOf([at(onRadius(a, face, -half + 1.4, z1 - down)), at(onRadius(a, face, -half + 1.4 + [7.4, 5.2, 6.4, 3.6][row]!, z1 - down))])),
  );
  const stamp = stamped > 0 ? pathOf([onRadius(a, face, 1, z0 + 1.4), onRadius(a, face, 4.4, z0 + 1.4), onRadius(a, face, 4.4, z0 + 3.4), onRadius(a, face, 1, z0 + 3.4)].map(at), true) : "";
  const rise = Math.max(0, Math.min(1, flag));
  const stalkTop = z1 + 0.6 + 3.4 * rise;
  return {
    depth: onRadius(a, r, 0, z0),
    body,
    tab,
    rules,
    stamp,
    stalk: rise > 0 ? radialBox(a, r - 0.2, r + 0.2, 4.4 - 0.2, 4.4 + 0.2, z1, stalkTop) : null,
    flag: rise > 0 ? radialBox(a, r - 0.3, r + 0.3, 3.2, 6.2, stalkTop - 2.6 * rise, stalkTop) : null,
  };
}

// ── the intake: the Meta feeder and the channel ────────────────────────

const CHANNEL = { x0: TABLE[0] - TRAY_WIDTH / 2, x1: TABLE[0] + TRAY_WIDTH / 2, y0: TABLE[1] - 38, y1: TABLE[1] - TRAY_R - TRAY_DEPTH / 2 } as const;
/** Where the waiting cards stand in the channel, the gate end first. */
export const QUEUE_Y = [CHANNEL.y1 - 1.6, CHANNEL.y1 - 4.2, CHANNEL.y1 - 6.8, CHANNEL.y1 - 9.4] as const;
/** Where a card comes out of the feeder. */
export const FEED_Y = CHANNEL.y0 + 0.4;
const FEEDER: Plan = { x: TABLE[0] - 10, y: CHANNEL.y0 - 8, w: 20, d: 8, r: 1.4 };
const FEEDER_Z = FLOOR_Z - 6;
const FEEDER_TOP = FLOOR_TOP + CARD.height + 4;
export const INTAKE = {
  posts: [
    [CHANNEL.x0 + 1.4, CHANNEL.y0 + 2.4],
    [CHANNEL.x1 - 1.4, CHANNEL.y0 + 2.4],
    [CHANNEL.x0 + 1.4, CHANNEL.y1 - 4],
    [CHANNEL.x1 - 1.4, CHANNEL.y1 - 4],
  ].map(([x, y]) => post(x!, y!, 1.2, 0, FLOOR_Z, 16)),
  floor: slab({ x: CHANNEL.x0, y: CHANNEL.y0, w: CHANNEL.x1 - CHANNEL.x0, d: CHANNEL.y1 - CHANNEL.y0, r: 0.4 }, FLOOR_Z, 1, 2),
  wallFar: slab({ x: CHANNEL.x0 - 0.8, y: CHANNEL.y0, w: 0.8, d: CHANNEL.y1 - CHANNEL.y0, r: 0.3 }, FLOOR_Z, 5, 2),
  wallNear: slab({ x: CHANNEL.x1, y: CHANNEL.y0, w: 0.8, d: CHANNEL.y1 - CHANNEL.y0, r: 0.3 }, FLOOR_Z, 5, 2),
  wallSeam: segment([CHANNEL.x1 + 0.8, CHANNEL.y0, FLOOR_Z + 2.6], [CHANNEL.x1 + 0.8, CHANNEL.y1, FLOOR_Z + 2.6], P),
  /** The feeder Meta's leads come out of, on its stand, with the slot they come through and its aerial. */
  stand: slab({ x: FEEDER.x + 2, y: FEEDER.y + 1, w: FEEDER.w - 4, d: FEEDER.d - 2, r: 1 }, 0, FEEDER_Z, 3, 0.4),
  feeder: slab(FEEDER, FEEDER_Z, FEEDER_TOP - FEEDER_Z, 4, 0.8),
  slot: faceY(FEEDER.y + FEEDER.d, CHANNEL.x0 + 0.6, CHANNEL.x1 - 0.6, FLOOR_TOP - 0.4, FLOOR_TOP + CARD.height + 2),
  feederScrews: [at([FEEDER.x + 1.8, FEEDER.y + FEEDER.d, FEEDER_TOP - 2]), at([FEEDER.x + FEEDER.w - 1.8, FEEDER.y + FEEDER.d, FEEDER_TOP - 2])],
  mastFoot: post(FEEDER.x + FEEDER.w - 3, FEEDER.y + 3, 1.4, FEEDER_TOP, 1, 16),
  mast: post(FEEDER.x + FEEDER.w - 3, FEEDER.y + 3, 0.5, FEEDER_TOP + 1, 9, 12),
  mastTip: post(FEEDER.x + FEEDER.w - 3, FEEDER.y + 3, 1, FEEDER_TOP + 10, 1.4, 14, 0.3),
};

/** The gate across the channel's end, raised `open` (0–1) to let the cards through. */
const GATE_Y = CHANNEL.y1;
export const GATE = {
  guides: [CHANNEL.x0 - 1.4, CHANNEL.x1 + 1.4].map((x) => post(x, GATE_Y, 0.8, FLOOR_TOP, 24, 14)),
  bar: slab({ x: CHANNEL.x0 - 2.2, y: GATE_Y - 0.8, w: CHANNEL.x1 - CHANNEL.x0 + 4.4, d: 1.6, r: 0.6 }, FLOOR_TOP + 24, 1.4, 3, 0.3),
  plate: slab({ x: CHANNEL.x0 + 0.2, y: GATE_Y - 0.3, w: CHANNEL.x1 - CHANNEL.x0 - 0.4, d: 0.6, r: 0.2 }, FLOOR_TOP, 7, 2),
  lift: 13,
};

/** A waiting card in the channel at `y`, square to it (its face toward the table). */
export function queued(y: number, campaign: number) {
  const half = CARD.width / 2;
  const x = TABLE[0];
  const z1 = FLOOR_TOP + CARD.height;
  const body = slabOf({ x: x - half, y: y - CARD.thick / 2, w: CARD.width, d: CARD.thick, r: 0 }, FLOOR_TOP, CARD.height, P, 1);
  const tabAt = TABS[campaign % TABS.length]!;
  const tab = slabOf({ x: x - tabAt - 1.1, y: y - CARD.thick / 2, w: 2.2, d: CARD.thick, r: 0 }, z1, 1.4, P, 1);
  return { depth: [x, y, FLOOR_TOP] as Point3, body, tab };
}

// ── the stamp: the lead becomes a contact ──────────────────────────────

const STAMP_X = TABLE[0] + TRAY_R + TRAY_DEPTH / 2 + 10;
/** The stamp's housing sits level with the middle of a card. */
const STAMP_Z = FLOOR_TOP + 3.6;
export const STAMP = {
  foot: slab({ x: STAMP_X - 4, y: TABLE[1] - 4, w: 8, d: 8, r: 1.2 }, 0, 1.4, 3, 0.3),
  post: post(STAMP_X + 1, TABLE[1], 1.6, 1.4, STAMP_Z - 1.4, 18),
  housing: slab({ x: STAMP_X - 4, y: TABLE[1] - 3.4, w: 8, d: 6.8, r: 1.2 }, STAMP_Z, 6.8, 3, 0.5),
  housingScrews: [at([STAMP_X - 2.4, TABLE[1] + 3.4, STAMP_Z + 5]), at([STAMP_X + 2.4, TABLE[1] + 3.4, STAMP_Z + 5])],
  /** The ram and its pad, at rest; they move in toward the card by `stroke`. */
  ram: slab({ x: STAMP_X - 7.6, y: TABLE[1] - 0.7, w: 3.6, d: 1.4, r: 0.6 }, STAMP_Z + 2.6, 1.4, 2),
  pad: slab({ x: STAMP_X - 8.6, y: TABLE[1] - 2.2, w: 1, d: 4.4, r: 0.3 }, STAMP_Z + 1.4, 3.8, 2),
  stroke: STAMP_X - 8.6 - (TABLE[0] + SLOTS_R[2] + CARD.thick / 2) - 0.1,
};

// ── the first message ──────────────────────────────────────────────────

const MESSAGE_POST: Plane = [TABLE[0], TABLE[1] + TRAY_R + 13];
const HEAD_Z = FLOOR_TOP + CARD.height + 4.6;
const HINGE: Point3 = [MESSAGE_POST[0], MESSAGE_POST[1], HEAD_Z + 7];
const HEAD_AT: Point3 = [TABLE[0], TABLE[1] + TRAY_R, HEAD_Z + 5.2];
export const MESSAGE = {
  foot: slab({ x: MESSAGE_POST[0] - 4, y: MESSAGE_POST[1] - 4, w: 8, d: 8, r: 1.2 }, 0, 1.4, 3, 0.3),
  footScrews: corners({ x: MESSAGE_POST[0] - 4, y: MESSAGE_POST[1] - 4, w: 8, d: 8, r: 1.2 }, 1.3).map(([x, y]) => at([x, y, 1.4])),
  post: post(MESSAGE_POST[0], MESSAGE_POST[1], 1.6, 1.4, HINGE[2] - 2.4 - 1.4, 18),
  seams: join([10, 22].map((z) => sideArc(MESSAGE_POST[0], MESSAGE_POST[1], 1.6, z, P, 14))),
  /** The hinge the arm swings on, at the post's top. */
  knuckle: post(MESSAGE_POST[0], MESSAGE_POST[1], 2.4, HINGE[2] - 2.4, 4.4, 20, 0.3),
  /** The head that sets each card's flag, at rest; it drops by `dip` as the arm swings down. */
  head: slab({ x: HEAD_AT[0] - 5, y: HEAD_AT[1] - 3, w: 10, d: 6, r: 1.2 }, HEAD_Z, 4.4, 3, 0.5),
  headScrews: [at([HEAD_AT[0] - 3.4, HEAD_AT[1] + 3, HEAD_Z + 3.2]), at([HEAD_AT[0] + 3.4, HEAD_AT[1] + 3, HEAD_Z + 3.2])],
  dip: 3.2,
};

/** The arm from the hinge to the head, with the head dropped by `down`. */
export function messageArm(down: number) {
  const end: Point3 = [HEAD_AT[0], HEAD_AT[1], HEAD_AT[2] - down];
  const along: Point3 = [end[0] - HINGE[0], end[1] - HINGE[1], 0];
  return barBetween(HINGE, end, [-along[1], along[0], 0], 2.2, 1.6, P);
}

// ── the contacts box ───────────────────────────────────────────────────

const BOX = { x0: TABLE[0] - 44, x1: TABLE[0] - TRAY_R - TRAY_DEPTH / 2 - 0.6, y0: TABLE[1] - 7.8, y1: TABLE[1] + 7.8 } as const;
/** Where a filed card stands: the newest by the opening, each older one a step further in. */
export const FILE_X = (place: number) => BOX.x1 - 2 - place * 1.7;
export const FILED_MAX = 9;
export const CONTACTS = {
  legs: [
    [BOX.x0 + 2, BOX.y0 + 2],
    [BOX.x1 - 2, BOX.y0 + 2],
    [BOX.x0 + 2, BOX.y1 - 2],
    [BOX.x1 - 2, BOX.y1 - 2],
  ].map(([x, y]) => post(x!, y!, 1.2, 0, FLOOR_Z, 16)),
  floor: slab({ x: BOX.x0, y: BOX.y0, w: BOX.x1 - BOX.x0, d: BOX.y1 - BOX.y0, r: 0.6 }, FLOOR_Z, 1, 3),
  back: slab({ x: BOX.x0, y: BOX.y0, w: BOX.x1 - BOX.x0, d: 0.8, r: 0.3 }, FLOOR_TOP, 6, 2),
  far: slab({ x: BOX.x0, y: BOX.y0, w: 0.8, d: BOX.y1 - BOX.y0, r: 0.3 }, FLOOR_TOP, 6, 2),
  front: slab({ x: BOX.x0, y: BOX.y1 - 0.8, w: BOX.x1 - BOX.x0, d: 0.8, r: 0.3 }, FLOOR_TOP, 6, 2),
  frontSeam: segment([BOX.x0, BOX.y1, FLOOR_TOP + 3], [BOX.x1, BOX.y1, FLOOR_TOP + 3], P),
};

/** A filed card in the box at `x`, square to x (its face toward the opening): stamped, its flag folded down once it is filed. */
export const filedCard = (x: number, campaign: number) => card(Math.PI, TABLE[0] - x, campaign, 1, 0);
