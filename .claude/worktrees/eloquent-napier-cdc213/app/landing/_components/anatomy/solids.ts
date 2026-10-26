import { cameraOf, extrude, iso, pathOf, type Flat, type Plane, type Point3, type Projection, type SolidPaths } from "@/components/iso/iso-kit";

/**
 * What the kit's extrusions can't draw: solids that tilt out of the vertical
 * (a rocker, a flag on its pivot) and toothed rings. Each returns the kit's
 * own `SolidPaths`, shaded by the kit's rules (side faces by facing, up faces
 * as the lighter top), so it paints like any other part.
 */

const add = (a: Point3, b: Point3): Point3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Point3, by: number): Point3 => [a[0] * by, a[1] * by, a[2] * by];
const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Point3, b: Point3): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: Point3): Point3 => scale(a, 1 / (Math.hypot(...a) || 1));

/** Rounded far below a drawn tenth, so points that tie exactly tie in every engine (see the kit's `convexHull`). */
const settled = ([x, y]: Flat): Flat => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6];

function hull(points: Flat[]): Flat[] {
  const sorted = points.map(settled).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const turn = (o: Flat, a: Flat, b: Flat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Flat[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Flat[] = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index]!;
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * A convex polyhedron from its corners and faces (corner indices, either
 * winding). Faces turned to the viewer are shaded; one facing up more than
 * it faces sideways is a top. Where two seen faces meet is a crease.
 */
export function convexSolid(corners: readonly Point3[], faces: readonly (readonly number[])[], projection: Projection): SolidPaths {
  const { sinA, cosA, sinE, cosE } = cameraOf(projection);
  const view: Point3 = [cosA * cosE, sinA * cosE, sinE];
  const centre = scale(corners.reduce(add, [0, 0, 0]), 1 / corners.length);
  const flat = corners.map((corner) => iso(corner, projection));
  const seen = faces.map((face) => {
    let normal: Point3 = [0, 0, 0];
    for (let index = 0; index < face.length; index++) {
      const a = corners[face[index]!]!;
      const b = corners[face[(index + 1) % face.length]!]!;
      normal = add(normal, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
    }
    const middle = scale(face.map((index) => corners[index]!).reduce(add, [0, 0, 0]), 1 / face.length);
    normal = unit(normal);
    if (dot(normal, add(middle, scale(centre, -1))) < 0) normal = scale(normal, -1);
    return { face, normal, facing: dot(normal, view) > 1e-6 };
  });
  const shades: string[][] = [[], [], [], []];
  const tops: string[] = [];
  for (const { face, normal, facing } of seen) {
    if (!facing) continue;
    const d = pathOf(face.map((index) => flat[index]!), true);
    const across = Math.hypot(normal[0], normal[1]);
    if (normal[2] > across) {
      tops.push(d);
      continue;
    }
    const lit = ((normal[0] * -sinA + normal[1] * cosA) / (across || 1) + 1) / 2;
    shades[Math.min(3, Math.max(0, Math.floor(lit * 4 + 1e-9)))]!.push(d);
  }
  const creases: string[] = [];
  for (let a = 0; a < seen.length; a++) {
    for (let b = a + 1; b < seen.length; b++) {
      // Neighbouring facets of a round part turn by a few degrees: no crease there.
      if (!seen[a]!.facing || !seen[b]!.facing || dot(seen[a]!.normal, seen[b]!.normal) > 0.82) continue;
      const shared = seen[a]!.face.filter((index) => seen[b]!.face.includes(index));
      if (shared.length === 2) creases.push(pathOf(shared.map((index) => flat[index]!)));
    }
  }
  const outline = pathOf(hull(flat), true);
  return { fill: outline, outline, crease: creases.join(""), top: tops.join(""), shades: shades.map((list) => list.join("")) };
}

const BOX_FACES = [
  [0, 1, 3, 2],
  [4, 6, 7, 5],
  [0, 4, 5, 1],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 5, 7, 3],
] as const;

/** A box from one corner and its three edges: `u`, `v` and `w`, in any orientation. */
export function orientedBox(origin: Point3, u: Point3, v: Point3, w: Point3, projection: Projection): SolidPaths {
  const corners: Point3[] = [];
  for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) corners.push(add(add(add(origin, scale(u, i)), scale(v, j)), scale(w, k)));
  // Index = i·4 + j·2 + k, matching BOX_FACES.
  return convexSolid(corners, BOX_FACES, projection);
}

/**
 * A box centred on a line from `from` to `to`, `width` across (along `side`)
 * and `height` thick, square to both: a bar, a lever, a flag.
 */
export function barBetween(from: Point3, to: Point3, side: Point3, width: number, height: number, projection: Projection): SolidPaths {
  const along = add(to, scale(from, -1));
  const across = unit(side);
  const up = unit(cross(unit(along), across));
  const origin = add(add(from, scale(across, -width / 2)), scale(up, -height / 2));
  return orientedBox(origin, along, scale(across, width), scale(up, height), projection);
}

/**
 * A spur gear's outline in plan: `teeth` trapezoid teeth `depth` deep about
 * the pitch radius, turned by `phase` teeth. Extruded unconvex, so the teeth
 * shade one by one.
 */
export function gearRing(cx: number, cy: number, pitch: number, teeth: number, depth: number, phase: number): Plane[] {
  const ring: Plane[] = [];
  const step = (Math.PI * 2) / teeth;
  const at = (angle: number, radius: number): Plane => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  for (let tooth = 0; tooth < teeth; tooth++) {
    const base = (tooth + phase) * step;
    ring.push(at(base, pitch - depth / 2));
    ring.push(at(base + step * 0.28, pitch - depth / 2));
    ring.push(at(base + step * 0.42, pitch + depth / 2));
    ring.push(at(base + step * 0.72, pitch + depth / 2));
    ring.push(at(base + step * 0.86, pitch - depth / 2));
  }
  return ring;
}

/**
 * A spur gear as line art reads it: a disc shaded like any round part, cut
 * with its teeth on top, and a rib down the side under every tooth tip seen.
 * The disc is as wide as the tips, so the gaps between teeth on top show the
 * paper (the page, so they read as cut away), and the outline follows the
 * teeth round the top and the rim's arc along the bottom. Drawing the teeth
 * as one unconvex extrusion instead puts the hidden edges of every gap on
 * top of the teeth in front of it.
 */
export function gearOf(cx: number, cy: number, pitch: number, teeth: number, depth: number, phase: number, z: number, height: number, projection: Projection): SolidPaths & { ribs: string } {
  const tip = pitch + depth / 2;
  const disc = cutDisc(cx, cy, tip, gearRing(cx, cy, pitch, teeth, depth, phase), z, height, projection);
  const { sinA, cosA } = cameraOf(projection);
  const facing = Math.atan2(sinA, cosA);
  const step = (Math.PI * 2) / teeth;
  const ribs: string[] = [];
  for (let tooth = 0; tooth < teeth; tooth++) {
    for (const at of [0.42, 0.72]) {
      const angle = (tooth + phase + at) * step;
      // Only where the rim faces the viewer, and not so near the silhouette that two ribs crowd into one.
      if (Math.cos(angle - facing) < 0.12) continue;
      ribs.push(pathOf([iso(around(cx, cy, tip, angle, z + height), projection), iso(around(cx, cy, tip, angle, z), projection)]));
    }
  }
  return { ...disc, ribs: ribs.join("") };
}

/**
 * A disc `radius` wide whose top is cut to `top` (a ring in plan, inside the
 * radius): shaded like any round part, its outline the cut shape round the top
 * and the rim's arc along the bottom. What is cut away shows the paper, which
 * is the page, so it reads as gone. A gear's teeth, a Geneva wheel's slots.
 */
export function cutDisc(cx: number, cy: number, radius: number, top: readonly Plane[], z: number, height: number, projection: Projection): SolidPaths {
  const disc = extrude(circleOf(cx, cy, radius, 64), z, height, projection, { convex: true });
  const { sinA, cosA } = cameraOf(projection);
  const facing = Math.atan2(sinA, cosA);
  const bottom: Flat[] = [];
  for (let step = 0; step <= 32; step++) bottom.push(iso(around(cx, cy, radius, facing - Math.PI / 2 + (step / 32) * Math.PI, z), projection));
  const sides = [-1, 1].map((sign) =>
    pathOf([iso(around(cx, cy, radius, facing + (sign * Math.PI) / 2, z), projection), iso(around(cx, cy, radius, facing + (sign * Math.PI) / 2, z + height), projection)]),
  );
  const cut = pathOf(top.map(([x, y]) => iso([x, y, z + height], projection)), true);
  return { fill: disc.fill, shades: disc.shades, top: cut, crease: "", outline: [cut, pathOf(bottom), ...sides].join("") };
}

function circleOf(cx: number, cy: number, radius: number, steps: number): Plane[] {
  return Array.from({ length: steps }, (_, index) => around(cx, cy, radius, (index / steps) * Math.PI * 2, 0).slice(0, 2) as Plane);
}

/** A point `radius` out from (cx, cy) at `angle`, at height z. */
export const around = (cx: number, cy: number, radius: number, angle: number, z: number): Point3 => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z];

/**
 * A round bar or disc along any `axis` (unit), `length` long from `base`: a
 * tilted eye, a grip, a pin. Drawn as a `sides`-gon, so keep it small.
 */
export function roundAlong(base: Point3, axis: Point3, radius: number, length: number, projection: Projection, sides = 16): SolidPaths {
  const along = unit(axis);
  const seed: Point3 = Math.abs(along[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(along, seed));
  const v = cross(along, u);
  const corners: Point3[] = [];
  for (let side = 0; side < sides; side++) {
    const angle = (side / sides) * Math.PI * 2;
    const rim = add(scale(u, radius * Math.cos(angle)), scale(v, radius * Math.sin(angle)));
    corners.push(add(base, rim), add(add(base, rim), scale(along, length)));
  }
  const faces: number[][] = [
    Array.from({ length: sides }, (_, side) => side * 2),
    Array.from({ length: sides }, (_, side) => side * 2 + 1),
    ...Array.from({ length: sides }, (_, side) => {
      const next = (side + 1) % sides;
      return [side * 2, next * 2, next * 2 + 1, side * 2 + 1];
    }),
  ];
  return convexSolid(corners, faces, projection);
}
