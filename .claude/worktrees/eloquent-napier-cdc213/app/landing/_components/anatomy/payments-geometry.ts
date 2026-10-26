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
  slabOf,
  translateAlong,
  type Flat,
  type Plan,
  type Point3,
} from "@/components/iso/iso-kit";
import { LEDGER_LINES, PROVIDERS } from "./payments-model";
import { barBetween, orientedBox, roundAlong } from "./solids";

/**
 * Fig 05.6, built once: a shop's cash railway, on a bench.
 *
 * World units are about a pixel of the real thing: x along the wires, from the
 * counter out to the processors' booths, y across, z up. The carriers run by
 * translates along x; the launcher's lever, each booth's stamp and the
 * ledger's lines are the only other things that move.
 */

export const WIDTH = 600;
/** The capability cards' frame: 400 × 268, at this width. */
export const HEIGHT = 402;
const AZIMUTH = 40;
const ELEVATION = 32;

const BENCH: Plan = { x: 0, y: 0, w: 104, d: 64, r: 8 };
const BASE_H = 7;
const FOOT_H = 4;

/** One wire per processor: Stripe's behind, Mercado Pago's in front. */
export const WIRE_Y: Readonly<Record<(typeof PROVIDERS)[number], number>> = { stripe: 20, mercadopago: 44 };
export const WIRE_Z = 32;
/** Where a carrier docks at the counter (near, on the right), and where it stops at a booth (far, on the left). */
export const DOCK_X = 64;
export const BOOTH_X = 30;

// ── the projection ─────────────────────────────────────────────────────

const box = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

export const P = fitProjection([...box(BENCH, -BASE_H - FOOT_H, 0), [70, 18, WIRE_Z + 6], [14, 18, WIRE_Z + 10]], WIDTH, HEIGHT, {
  pad: 24,
  azimuth: AZIMUTH,
  elevation: ELEVATION,
});

const at = (point: Point3): Flat => iso(point, P);
const slab = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const post = (x: number, y: number, r: number, z: number, h: number, steps = 24, bevel = 0) => cylinder(x, y, r, z, h, P, steps, bevel);
const join = (paths: string[]) => paths.join("");
export const shift = (by: Point3) => translateAlong(P, by);

// ── the bench ──────────────────────────────────────────────────────────

const SCREWS = corners(BENCH, 6);
const LABEL: Plan = { x: 30, y: BENCH.d - 13, w: 14, d: 8, r: 1 };
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
};

// ── the counter and its ledger ─────────────────────────────────────────

const DESK: Plan = { x: 75, y: 12, w: 24, d: 40, r: 2 };
const DESK_TOP = 11;
const BOOK: Plan = { x: 77, y: 17, w: 20, d: 30, r: 0.8 };
const PAGE_Z = DESK_TOP + 1.6;
/** Where each of the ledger's lines runs on the page, and where its tick goes. */
const LINE_X = (line: number) => BOOK.x + 3.2 + line * 2.6;
const TICK_Y = BOOK.y + BOOK.d - 4;
export const COUNTER = {
  desk: slab(DESK, 0, DESK_TOP - 1.4, 4, 0.6),
  top: slab({ x: DESK.x - 1, y: DESK.y - 1, w: DESK.w + 2, d: DESK.d + 2, r: 2.4 }, DESK_TOP - 1.4, 1.4, 4, 0.5),
  drawer: slab({ x: DESK.x + 6, y: DESK.y + DESK.d, w: DESK.w - 12, d: 0.6, r: 0.3 }, 3, 4.4, 2),
  drawerKnob: post(DESK.x + DESK.w / 2, DESK.y + DESK.d + 1.2, 0.8, 4.6, 1.2, 12),
  /** The ledger: its cover, its two pages, the spine between them. */
  cover: slab({ x: BOOK.x - 0.8, y: BOOK.y - 0.8, w: BOOK.w + 1.6, d: BOOK.d + 1.6, r: 1 }, DESK_TOP, 0.8, 3),
  pages: [0, 1].map((half) => slab({ x: BOOK.x, y: BOOK.y + half * (BOOK.d / 2 + 0.3), w: BOOK.w, d: BOOK.d / 2 - 0.3, r: 0.4 }, DESK_TOP + 0.8, 0.8, 2)),
  /** The spine, showing on the cover between the two pages, edge to edge. */
  spine: onTop([[BOOK.x - 0.8, BOOK.y + BOOK.d / 2], [BOOK.x + BOOK.w + 0.8, BOOK.y + BOOK.d / 2]], DESK_TOP + 0.8, P),
  /** The ruled columns: a line down each page, the tick column at the end. */
  rules: join([BOOK.y + 6, TICK_Y - 2].map((y) => onTop([[BOOK.x, y], [BOOK.x + BOOK.w, y]], PAGE_Z, P))),
};

/** A ledger line written for charge `line` on the page: the item and its amount, printed. */
export const ledgerLine = (line: number, long: number) =>
  join([
    onTop([[LINE_X(line), BOOK.y + 1.6], [LINE_X(line), BOOK.y + 1.6 + long]], PAGE_Z, P),
    onTop([[LINE_X(line), BOOK.y + BOOK.d / 2 + 2], [LINE_X(line), BOOK.y + BOOK.d / 2 + 6]], PAGE_Z, P),
  ]);
/**
 * Its tick box at the end of the line, and the tick once paid, inside the box.
 * The page reads along y (right) and down along x, so the tick is drawn in
 * those directions: a short stroke down-right, a long one up-right.
 */
const BOX = 1.5;
export const tickBox = (line: number) => {
  const x = LINE_X(line) - BOX / 2;
  return onTop([[x, TICK_Y], [x + BOX, TICK_Y], [x + BOX, TICK_Y + BOX], [x, TICK_Y + BOX]], PAGE_Z, P, true);
};
export const tick = (line: number) => {
  const x = LINE_X(line) - BOX / 2;
  return onTop([[x + 0.8, TICK_Y + 0.3], [x + 1.15, TICK_Y + 0.6], [x + 0.3, TICK_Y + 1.25]], PAGE_Z, P);
};
export const LINES = LEDGER_LINES;

// ── the wires, the launcher and the booths ─────────────────────────────

const COUNTER_POST_X = DOCK_X + 6;
const BOOTH_POST_X = 14;
export const RAILWAY = PROVIDERS.map((provider) => {
  const y = WIRE_Y[provider];
  const booth: Plan = { x: 4, y: y - 9, w: 20, d: 18, r: 1.6 };
  const boothTop = 20;
  return {
    provider,
    y,
    counterPost: {
      foot: slab({ x: COUNTER_POST_X - 3, y: y - 3, w: 6, d: 6, r: 1 }, 0, 1.4, 3, 0.3),
      post: post(COUNTER_POST_X, y, 1.4, 1.4, WIRE_Z + 3 - 1.4, 18),
      seams: join([12, 22].map((z) => sideArc(COUNTER_POST_X, y, 1.4, z, P, 14))),
      head: slab({ x: COUNTER_POST_X - 1.8, y: y - 1.8, w: 3.6, d: 3.6, r: 0.6 }, WIRE_Z - 1, 3.4, 2, 0.3),
    },
    wire: barBetween([BOOTH_POST_X + 1.8, y, WIRE_Z], [COUNTER_POST_X - 1.8, y, WIRE_Z], [0, 1, 0], 0.5, 0.5, P),
    /** The stop at each end the carrier's trolley meets. */
    stops: [DOCK_X + 3.6, BOOTH_X - 4.4].map((x) => roundAlong([x, y, WIRE_Z], [1, 0, 0], 0.9, 0.8, P, 12)),
    booth: {
      body: slab(booth, 0, boothTop, 4, 0.6),
      roof: slab({ x: booth.x - 1, y: booth.y - 1, w: booth.w + 2, d: booth.d + 2, r: 2 }, boothTop, 1.4, 4, 0.5),
      /** The window on its counter side, where the carrier comes in, and its sill. */
      window: pathOf([at([booth.x + booth.w, y - 5, 8]), at([booth.x + booth.w, y + 5, 8]), at([booth.x + booth.w, y + 5, 16]), at([booth.x + booth.w, y - 5, 16])], true),
      sill: slab({ x: booth.x + booth.w, y: y - 6, w: 2.4, d: 12, r: 0.4 }, 7.2, 0.8, 2),
      screws: [at([booth.x + booth.w, booth.y + 1.6, boothTop - 1.6]), at([booth.x + booth.w, booth.y + booth.d - 1.6, boothTop - 1.6])],
      /** The processor's sign over the window: a plate with its name as two printed lines. */
      sign: slab({ x: booth.x + booth.w, y: y - 6, w: 0.4, d: 12, r: 0.2 }, 16.8, 2.4, 2),
      signRules: join(
        [18.5, 17.3].map((z, row) => pathOf([at([booth.x + booth.w + 0.4, y - 4.6, z]), at([booth.x + booth.w + 0.4, y - 4.6 + (row ? 5.2 : 8), z])])),
      ),
      signScrews: [at([booth.x + booth.w + 0.4, y - 5.3, 18]), at([booth.x + booth.w + 0.4, y + 5.3, 18])],
      post: post(BOOTH_POST_X, y, 1.4, boothTop + 1.4, WIRE_Z + 9 - boothTop - 1.4, 18),
      head: slab({ x: BOOTH_POST_X - 1.8, y: y - 1.8, w: 3.6, d: 3.6, r: 0.6 }, WIRE_Z - 1, 3.4, 2, 0.3),
      /** The stamp beside the carrier's stop: its arm off the post, and its plunger and head, which drop past the trolley onto the ticket. */
      stampArm: barBetween([BOOTH_POST_X + 1.4, y, WIRE_Z + 7.4], [BOOTH_X + 0.6, y - 2.2, WIRE_Z + 7.4], [0.14, 1, 0], 1.6, 1.2, P),
      stampBoss: post(BOOTH_X, y - 2.2, 1.2, WIRE_Z + 6.8, 1.6, 16, 0.2),
      plunger: post(BOOTH_X, y - 2.2, 0.45, WIRE_Z + 5.6, 5.6, 10),
      stampHead: slab({ x: BOOTH_X - 1.8, y: y - 3, w: 3.6, d: 1.6, r: 0.4 }, WIRE_Z + 3.6, 2, 2, 0.3),
    },
  };
});

/** How far a stamp drops to meet the ticket. */
export const STAMP_DROP = 5.2;

/**
 * The lever that fires a carrier, on the side of the counter post that faces
 * the viewer: a boss out of the post, and the lever on it, at `pull` (0 rest,
 * 1 pulled) swinging along the wire.
 */
const LEVER_Z = 16;
const BOSS_OUT = 2;
export const leverBoss = (y: number) => roundAlong([COUNTER_POST_X, y + 1.1, LEVER_Z], [0, 1, 0], 0.8, BOSS_OUT - 1.1, P, 14);
export function lever(y: number, pull: number) {
  const angle = (-35 + 70 * pull) * (Math.PI / 180);
  const side = y + BOSS_OUT + 0.45;
  const pivot: Point3 = [COUNTER_POST_X, side, LEVER_Z];
  const end: Point3 = [pivot[0] + 7 * Math.sin(angle), side, pivot[2] - 7 * Math.cos(angle)];
  return {
    bar: barBetween(pivot, end, [0, 1, 0], 0.9, 0.9, P),
    grip: roundAlong(end, [Math.sin(angle), 0, -Math.cos(angle)], 1, 2.4, P, 14),
    pin: at([pivot[0], side + 0.45, pivot[2]]),
  };
}

// ── the spike: every ticket that came back paid ────────────────────────

const SPIKE: [number, number] = [58, 52];
const SLIP = 5;
const SLIP_H = 0.25;
export const SPIKE_MAX = 9;
const SPIKE_TOP = 1.6 + SPIKE_MAX * (SLIP_H + 0.14) + 5.5;
export const SPIKE_ART = {
  base: post(SPIKE[0], SPIKE[1], 3.6, 0, 1.2, 32, 0.4),
  collar: post(SPIKE[0], SPIKE[1], 1, 1.2, 0.4, 16),
};
/** The paid slips on the spike, bottom up, each turned a little, and the needle above the top one. */
export function spike(count: number) {
  const slips = Array.from({ length: Math.min(count, SPIKE_MAX) }, (_, index) => {
    const turn = ((index * 47) % 31) * (Math.PI / 180) - 0.25;
    const z = 1.6 + index * (SLIP_H + 0.14);
    const u: Point3 = [SLIP * Math.cos(turn), SLIP * Math.sin(turn), 0];
    const v: Point3 = [-SLIP * Math.sin(turn), SLIP * Math.cos(turn), 0];
    return orientedBox([SPIKE[0] - (u[0] + v[0]) / 2, SPIKE[1] - (u[1] + v[1]) / 2, z], u, v, [0, 0, SLIP_H], P);
  });
  const stack = 1.6 + Math.min(count, SPIKE_MAX) * (SLIP_H + 0.14);
  return {
    slips,
    below: post(SPIKE[0], SPIKE[1], 0.26, 1.6, Math.max(0.1, stack - 1.6), 10),
    above: post(SPIKE[0], SPIKE[1], 0.26, stack, SPIKE_TOP - stack, 10),
  };
}

// ── the carrier ───────────────────────────────────────────────────────

/** A carrier at the dock on wire `y`: its trolley on the wire, the canister under it, and its ticket. */
export function carrier(y: number) {
  const x = DOCK_X;
  return {
    wheels: [-1.6, 1.6].map((dx) => roundAlong([x + dx, y - 0.9, WIRE_Z + 1.1], [0, 1, 0], 1.1, 1.8, P, 14)),
    trolley: slab({ x: x - 2.8, y: y - 0.7, w: 5.6, d: 1.4, r: 0.4 }, WIRE_Z - 2.2, 2.2, 2),
    hanger: post(x, y, 0.5, WIRE_Z - 5, 2.8, 10),
    canister: post(x, y, 2.6, WIRE_Z - 12, 7, 24, 0.5),
    bands: join([WIRE_Z - 10.6, WIRE_Z - 6.4].map((z) => sideArc(x, y, 2.6, z, P, 20))),
    lid: post(x, y, 2.9, WIRE_Z - 5.4, 0.6, 24, 0.2),
    /** The ticket — the payment link — standing out of the lid's slot, beside the hanger. */
    ticket: slab({ x: x - 1.8, y: y - 1.8, w: 3.6, d: 0.5, r: 0 }, WIRE_Z - 5, 3.2, 1),
    ticketRule: pathOf([at([x - 1.2, y - 1.3, WIRE_Z - 3.2]), at([x + 1, y - 1.3, WIRE_Z - 3.2])]),
    /** The booth's mark once paid, a box stamped across the ticket's top. */
    stamped: pathOf([at([x - 1.3, y - 1.3, WIRE_Z - 2.6]), at([x + 1.3, y - 1.3, WIRE_Z - 2.6]), at([x + 1.3, y - 1.3, WIRE_Z - 2.1]), at([x - 1.3, y - 1.3, WIRE_Z - 2.1])], true),
  };
}
