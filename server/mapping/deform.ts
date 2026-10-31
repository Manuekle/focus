import type { Rgba } from "../rotoscope/alpha";
import { apply, areaScale, boneTransform, fitAffine, invert, norm, segmentDistance, similarity, sub, unit, type Affine, type Vec } from "./geometry";
import { area, components, dilate, emptyMask, erode, type Mask } from "./mask";
import { blendRadius, neighbours, rigBone, sharedJoint, weightsFor, type Rig } from "./rig";
import { BONES, JOINT_NAMES, torsoLength, type BoneName, type JointName, type Skeleton } from "./skeleton";

// Deforms one drawing of the character onto a target skeleton: every bone
// gets a transform (attached to its parent, turned to the target direction,
// stretched along its own axis within limits), a grid mesh over each bone's
// pixels is skinned with seam-free joint weights, and every triangle is
// warped piecewise-affinely from the drawing, layer by layer in draw order.
// The original pixels (line art included) are resampled, never redrawn.
// Surfaces a moved limb no longer covers, which the drawing never showed,
// come back as `exposed`: the only places a generator may repaint.

export type DeformLimits = {
  /** Along-bone stretch allowed before the limb would visibly distort (foreshortening ≥ min). */
  readonly minStretch: number;
  readonly maxStretch: number;
  /** Torso shear and squash beyond these fall back to a similarity transform (solid drawing). */
  readonly torsoAnisotropy: number;
  readonly torsoArea: readonly [number, number];
  /** Triangle area change beyond these marks the pixels as needing repair. */
  readonly triangleArea: readonly [number, number];
};

export const DEFAULT_LIMITS: DeformLimits = { minStretch: 0.55, maxStretch: 1.3, torsoAnisotropy: 1.4, torsoArea: [0.6, 1.6], triangleArea: [0.45, 2.2] };

/** Head, hands and feet keep their drawn shape: they turn and scale, never stretch. */
const RIGID: ReadonlySet<BoneName> = new Set(["head", "leftHand", "rightHand", "leftFoot", "rightFoot"]);

export type BonePlan = {
  readonly transforms: ReadonlyMap<number, Affine>;
  /** The rig's joints carried by their bones: where the deformed drawing puts them. */
  readonly generated: Skeleton;
  /** Bones whose stretch hit a limit. */
  readonly clamped: readonly BoneName[];
  /** Bones the target doesn't show: they follow their parent rigidly. */
  readonly missing: readonly BoneName[];
  /** Overall size change: target torso over drawing torso. */
  readonly scale: number;
  /**
   * How the torso was placed: an affine fitted to its corners, or — when that fit would shear or
   * resize it past the limits — a similarity on the pelvis–neck line, which leaves the corners off target.
   */
  readonly torsoFit: "affine" | "similarity";
};

function singularRatio(m: Affine): number {
  // Singular values of the 2×2 linear part.
  const [a, b, c, d] = [m[0], m[1], m[3], m[4]];
  const s1 = a * a + b * b + c * c + d * d;
  const s2 = Math.sqrt(Math.max(0, (a * a + b * b - c * c - d * d) ** 2 + 4 * (a * c + b * d) ** 2));
  const big = Math.sqrt((s1 + s2) / 2);
  const small = Math.sqrt(Math.max(1e-12, (s1 - s2) / 2));
  return big / small;
}

export function planBones(rig: Rig, target: Skeleton, limits: DeformLimits = DEFAULT_LIMITS): BonePlan {
  const transforms = new Map<number, Affine>();
  const generated: Record<JointName, { p: Vec; score: number } | null> = Object.fromEntries(JOINT_NAMES.map((name) => [name, null])) as never;
  const clamped: BoneName[] = [];
  const missing: BoneName[] = [];
  const [sourceTorso, targetTorso] = [torsoLength(rig.skeleton), torsoLength(target)];
  if (!sourceTorso || !targetTorso) throw new Error("deform: the target pose has no torso");
  const scale = targetTorso / sourceTorso;
  const score = (name: JointName) => target[name]?.score ?? 0;
  let torsoFit: BonePlan["torsoFit"] = "affine";

  for (const def of BONES) {
    const bone = rigBone(rig, def.name);
    if (!bone) continue;
    let m: Affine;
    if (def.name === "torso") {
      const corners: JointName[] = ["leftShoulder", "rightShoulder", "rightHip", "leftHip", "pelvis", "neck"];
      const pairs = corners.filter((name) => rig.skeleton[name] && target[name]);
      const fitted = pairs.length >= 4 ? fitAffine(pairs.map((name) => rig.skeleton[name]!.p), pairs.map((name) => target[name]!.p)) : null;
      const ok = fitted && singularRatio(fitted) <= limits.torsoAnisotropy && areaScale(fitted) / (scale * scale) >= limits.torsoArea[0] && areaScale(fitted) / (scale * scale) <= limits.torsoArea[1];
      m = ok ? fitted! : similarity(rig.skeleton.pelvis!.p, rig.skeleton.neck!.p, target.pelvis!.p, target.neck!.p, scale);
      if (!ok) torsoFit = "similarity";
      for (const name of corners) if (rig.skeleton[name]) generated[name] = { p: apply(m, rig.skeleton[name]!.p), score: score(name) };
      transforms.set(bone.index, m);
      continue;
    }
    const parent = rigBone(rig, def.parent as BoneName);
    const parentM = parent ? transforms.get(parent.index) : undefined;
    if (!parentM) continue;
    const a2 = apply(parentM, bone.from);
    const [ta, tb] = [target[def.from as JointName], target[def.to as JointName]];
    let direction: Vec;
    let wanted: number;
    if (ta && tb && norm(sub(tb.p, ta.p)) > 1e-6) {
      direction = unit(sub(tb.p, ta.p));
      wanted = norm(sub(tb.p, ta.p));
    } else {
      // Not in the target: the bone keeps its angle to the parent.
      const linear: Affine = [parentM[0], parentM[1], 0, parentM[3], parentM[4], 0];
      direction = unit(apply(linear, sub(bone.to, bone.from)));
      wanted = bone.length * scale;
      missing.push(def.name);
    }
    let stretch = wanted / bone.length;
    if (RIGID.has(def.name)) stretch = scale;
    else if (stretch < limits.minStretch * scale || stretch > limits.maxStretch * scale) {
      stretch = Math.max(limits.minStretch * scale, Math.min(limits.maxStretch * scale, stretch));
      clamped.push(def.name);
    }
    const b2: Vec = [a2[0] + direction[0] * bone.length * stretch, a2[1] + direction[1] * bone.length * stretch];
    m = RIGID.has(def.name) ? similarity(bone.from, bone.to, a2, b2, scale) : boneTransform(bone.from, bone.to, a2, b2, stretch, scale);
    transforms.set(bone.index, m);
    if (!generated[def.from as JointName]) generated[def.from as JointName] = { p: a2, score: score(def.from as JointName) };
    generated[def.to as JointName] = { p: b2, score: score(def.to as JointName) };
  }
  return { transforms, generated, clamped, missing, scale, torsoFit };
}

export type DeformResult = {
  /** The deformed drawing; exposed pixels are filled from their surroundings (a placeholder for repair). */
  readonly image: Rgba;
  /** Pixels resampled from the drawing. */
  readonly coverage: Mask;
  /** Body surface the drawing never showed and the new pose does: to repaint. */
  readonly exposed: Mask;
  /** Pixels from triangles stretched or squashed past the limits, or folded over. */
  readonly distorted: Mask;
  readonly plan: BonePlan;
  readonly stats: {
    readonly triangles: number;
    /** Triangles turned over (negative signed area): the mesh folds onto itself. */
    readonly flipped: number;
    /** Triangles squashed to no area at all: as broken as a fold, and drawn as nothing. */
    readonly collapsed: number;
    /** Folded or collapsed triangles per bone layer: where the mesh breaks. */
    readonly foldedBy: Readonly<Partial<Record<BoneName, number>>>;
    readonly exposedArea: number;
    readonly distortedArea: number;
    readonly coverageArea: number;
  };
};

/** Rotation angle and the remaining stretch of an affine's linear part (polar decomposition). */
function polar(m: Affine): { angle: number; stretch: readonly [number, number, number, number] } {
  const angle = Math.atan2(m[3] - m[1], m[0] + m[4]);
  const [c, s] = [Math.cos(-angle), Math.sin(-angle)];
  return { angle, stretch: [c * m[0] - s * m[3], c * m[1] - s * m[4], s * m[0] + c * m[3], s * m[1] + c * m[4]] };
}

/**
 * Point v carried w of the way from transform a to transform b, about the joint they share:
 * both carry the joint to the same place, and the rotation and stretch between them are
 * interpolated separately (not the positions), so the blend never collapses.
 */
export function blendAbout(a: Affine, b: Affine, joint: Vec, w: number, v: Vec): Vec {
  const [pa, pb] = [polar(a), polar(b)];
  let turn = pb.angle - pa.angle;
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn < -Math.PI) turn += 2 * Math.PI;
  const angle = pa.angle + turn * w;
  const k = pa.stretch.map((value, i) => value * (1 - w) + pb.stretch[i] * w);
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const ja = apply(a, joint);
  const jb = apply(b, joint);
  const pivot: Vec = [ja[0] * (1 - w) + jb[0] * w, ja[1] * (1 - w) + jb[1] * w];
  const [dx, dy] = [v[0] - joint[0], v[1] - joint[1]];
  const [sx, sy] = [k[0] * dx + k[1] * dy, k[2] * dx + k[3] * dy];
  return [pivot[0] + c * sx - s * sy, pivot[1] + s * sx + c * sy];
}

/** Bilinear sample of the drawing at (x, y), only from pixels `allowed` says belong to the layer; premultiplied RGBA. */
function sample(image: Rgba, x: number, y: number, allowed: (p: number) => boolean, out: Float64Array): void {
  out.fill(0);
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0;
  const fy = y - 0.5 - y0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const [px, py] = [x0 + i, y0 + j];
      if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
      const p = py * image.width + px;
      if (!allowed(p)) continue;
      const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      const a = (image.data[p * 4 + 3] / 255) * w;
      out[0] += image.data[p * 4] * a;
      out[1] += image.data[p * 4 + 1] * a;
      out[2] += image.data[p * 4 + 2] * a;
      out[3] += a;
    }
  }
}

export function deform(image: Rgba, rig: Rig, target: Skeleton, options: { readonly grid?: number; readonly limits?: DeformLimits } = {}): DeformResult {
  if (image.width !== rig.width || image.height !== rig.height) throw new Error("deform: the image and its rig differ in size");
  const limits = options.limits ?? DEFAULT_LIMITS;
  const plan = planBones(rig, target, limits);
  const step = options.grid ?? 6;
  const { width, height } = image;
  const columns = Math.ceil(width / step);
  const out = new Float32Array(width * height * 4);
  const layer = new Float32Array(width * height * 4);
  const touched: number[] = [];
  const distorted = emptyMask(width, height);
  const pixel = new Float64Array(4);
  let [triangles, flipped, collapsed] = [0, 0, 0];
  const foldedBy: Partial<Record<BoneName, number>> = {};

  const mapped = rig.bones.filter((bone) => plan.transforms.has(bone.index)).sort((a, b) => a.z - b.z || a.index - b.index);
  for (const bone of mapped) {
    // The layer samples its own pixels, plus its neighbours' right at the shared joint (no seam).
    const joints = neighbours(rig, bone.name).flatMap((other) => {
      const pair = sharedJoint(rig, bone, other);
      if (!pair) return [];
      const parent = pair.child === bone ? other : bone;
      return [{ label: other.index + 1, joint: pair.joint, radius: blendRadius(parent, pair.child) }];
    });
    const own = bone.index + 1;
    // A layer samples only its own pixels: a neighbour's pixels near the joint would travel with
    // this layer's rotation and stick out (a sock edge off the knee). Seam cracks are filled below.
    const allowed = (p: number) => rig.labels[p] === own;
    const cells = new Set<number>();
    for (let p = 0; p < rig.labels.length; p++) {
      if (!rig.labels[p] || !allowed(p)) continue;
      cells.add(Math.floor(Math.floor(p / width) / step) * columns + Math.floor((p % width) / step));
    }
    if (!cells.size) continue;
    const vertices = new Map<number, Vec>();
    const ownTransform = plan.transforms.get(bone.index)!;
    const pivots = new Map(joints.map((j) => [j.label - 1, j.joint]));
    const vertex = (vx: number, vy: number): { source: Vec; target: Vec } => {
      const source: Vec = [vx * step, vy * step];
      const key = vy * (columns + 1) + vx;
      let moved = vertices.get(key);
      if (!moved) {
        // Each neighbour's share turns the point about the joint they share, rotation and stretch
        // interpolated separately: a joint bent far (an arm raised overhead) doesn't fold the mesh.
        const base = apply(ownTransform, source);
        let [x, y] = base;
        for (const [index, w] of weightsFor(rig, bone, source)) {
          const other = plan.transforms.get(index);
          const pivot = pivots.get(index);
          if (index === bone.index || !other || !pivot) continue;
          const q = blendAbout(ownTransform, other, pivot, w, source);
          x += q[0] - base[0];
          y += q[1] - base[1];
        }
        moved = [x, y];
        vertices.set(key, moved);
      }
      return { source, target: moved };
    };

    for (const cell of cells) {
      const [cx, cy] = [cell % columns, Math.floor(cell / columns)];
      const corners = [vertex(cx, cy), vertex(cx + 1, cy), vertex(cx + 1, cy + 1), vertex(cx, cy + 1)];
      for (const tri of [[corners[0], corners[1], corners[2]], [corners[0], corners[2], corners[3]]]) {
        triangles++;
        const [s0, s1, s2] = tri.map((v) => v.source);
        const [d0, d1, d2] = tri.map((v) => v.target);
        const sourceArea = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
        const targetArea = (d1[0] - d0[0]) * (d2[1] - d0[1]) - (d2[0] - d0[0]) * (d1[1] - d0[1]);
        const ratio = targetArea / sourceArea / (plan.scale * plan.scale);
        // Squashed past the limit to under half a pixel: it rasterizes to nothing, so the distorted-pixel count
        // never sees it, yet a triangle squashed flat is the worst distortion there is. Counted, never skipped.
        if (Math.abs(targetArea) < 1e-6 || (Math.abs(targetArea) / 2 < 0.5 && Math.abs(ratio) < limits.triangleArea[0])) {
          collapsed++;
          foldedBy[bone.name] = (foldedBy[bone.name] ?? 0) + 1;
          continue;
        }
        const folded = ratio < 0;
        if (folded) {
          flipped++;
          foldedBy[bone.name] = (foldedBy[bone.name] ?? 0) + 1;
        }
        const bad = folded || Math.abs(ratio) < limits.triangleArea[0] || Math.abs(ratio) > limits.triangleArea[1];
        const left = Math.max(0, Math.floor(Math.min(d0[0], d1[0], d2[0])));
        const right = Math.min(width - 1, Math.ceil(Math.max(d0[0], d1[0], d2[0])));
        const top = Math.max(0, Math.floor(Math.min(d0[1], d1[1], d2[1])));
        const bottom = Math.min(height - 1, Math.ceil(Math.max(d0[1], d1[1], d2[1])));
        for (let y = top; y <= bottom; y++) {
          for (let x = left; x <= right; x++) {
            const [px, py] = [x + 0.5, y + 0.5];
            // Barycentric coordinates in the target triangle.
            const l1 = ((px - d0[0]) * (d2[1] - d0[1]) - (d2[0] - d0[0]) * (py - d0[1])) / targetArea;
            const l2 = ((d1[0] - d0[0]) * (py - d0[1]) - (px - d0[0]) * (d1[1] - d0[1])) / targetArea;
            const l0 = 1 - l1 - l2;
            if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
            sample(image, l0 * s0[0] + l1 * s1[0] + l2 * s2[0], l0 * s0[1] + l1 * s1[1] + l2 * s2[1], allowed, pixel);
            if (pixel[3] <= 0) continue;
            const q = (y * width + x) * 4;
            if (layer[q + 3] === 0) touched.push(q);
            if (pixel[3] >= layer[q + 3]) {
              layer[q] = pixel[0]; layer[q + 1] = pixel[1]; layer[q + 2] = pixel[2]; layer[q + 3] = pixel[3];
            }
            if (bad) distorted.data[y * width + x] = 1;
          }
        }
      }
    }
    // This layer over everything drawn so far (premultiplied "over").
    for (const q of touched) {
      const a = layer[q + 3];
      out[q] = layer[q] + out[q] * (1 - a);
      out[q + 1] = layer[q + 1] + out[q + 1] * (1 - a);
      out[q + 2] = layer[q + 2] + out[q + 2] * (1 - a);
      out[q + 3] = a + out[q + 3] * (1 - a);
      layer[q] = layer[q + 1] = layer[q + 2] = layer[q + 3] = 0;
    }
    touched.length = 0;
  }

  const data = Buffer.alloc(width * height * 4);
  const coverage = emptyMask(width, height);
  for (let p = 0; p < width * height; p++) {
    const a = out[p * 4 + 3];
    if (a <= 0) continue;
    data[p * 4] = Math.round(Math.min(255, out[p * 4] / a));
    data[p * 4 + 1] = Math.round(Math.min(255, out[p * 4 + 1] / a));
    data[p * 4 + 2] = Math.round(Math.min(255, out[p * 4 + 2] / a));
    data[p * 4 + 3] = Math.round(Math.min(1, a) * 255);
    if (a >= 0.5) coverage.data[p] = 1;
  }
  // Layers meeting at a seam leave pixels partly covered by each: inside the figure (no clear
  // pixel within 3 px) they are body, not edge antialiasing, so they become opaque.
  const clear = dilate({ width, height, data: Uint8Array.from({ length: width * height }, (_, p) => (data[p * 4 + 3] < 24 ? 1 : 0)) }, 3);
  for (let p = 0; p < width * height; p++) {
    if (data[p * 4 + 3] > 0 && data[p * 4 + 3] < 255 && !clear.data[p]) { data[p * 4 + 3] = 255; coverage.data[p] = 1; }
  }
  const exposed = exposedSurface(rig, plan, coverage);
  const result: Rgba = { data, width, height };
  // Cracks where two layers meet: uncovered pixels a 2 px closing of the drawing would cover.
  const closed = erode(dilate(coverage, 2), 2);
  const cracks: Mask = { width, height, data: closed.data.map((v, p) => (v && !coverage.data[p] && !exposed.data[p] ? 1 : 0)) };
  fillFromSurroundings(result, { width, height, data: exposed.data.map((v, p) => (v || cracks.data[p] ? 1 : 0)) });
  // Filled holes no longer count as clear: their soft rims are inside the figure now.
  const open = dilate({ width, height, data: Uint8Array.from({ length: width * height }, (_, p) => (data[p * 4 + 3] < 24 ? 1 : 0)) }, 3);
  for (let p = 0; p < width * height; p++) if (data[p * 4 + 3] > 0 && data[p * 4 + 3] < 255 && !open.data[p]) data[p * 4 + 3] = 255;
  return {
    image: result,
    coverage,
    exposed,
    distorted: { ...distorted, data: distorted.data.map((v, p) => (v && data[p * 4 + 3] > 0 ? 1 : 0)) },
    plan,
    stats: { triangles, flipped, collapsed, foldedBy, exposedArea: area(exposed), distortedArea: area(distorted), coverageArea: area(coverage) },
  };
}

/**
 * Where the new pose shows body the drawing has no pixels for: a layer behind
 * a front limb (torso, head) where the limb moved off it, carried by the
 * bone's transform, and the core of every limb (a joint opened wider than it
 * was drawn), minus what the deformed drawing covers. Slivers a pixel or two
 * wide are antialiasing, not surface.
 */
export function exposedSurface(rig: Rig, plan: BonePlan, coverage: Mask): Mask {
  const { width, height } = rig;
  const expected = emptyMask(width, height);
  const backs = new Set<number>();
  for (let p = 0; p < rig.hidden.length; p++) if (rig.hidden[p]) backs.add(rig.hidden[p] - 1);
  for (const index of backs) {
    const m = plan.transforms.get(index);
    const inverse = m ? invert(m) : null;
    if (!inverse) continue;
    const surface = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const p = y * width + x;
      return rig.labels[p] === index + 1 || rig.hidden[p] === index + 1;
    };
    // Target-space bounds of the bone's surface.
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let p = 0; p < rig.labels.length; p++) {
      if (rig.labels[p] !== index + 1 && rig.hidden[p] !== index + 1) continue;
      const q = apply(m!, [(p % width) + 0.5, Math.floor(p / width) + 0.5]);
      left = Math.min(left, q[0]); right = Math.max(right, q[0]); top = Math.min(top, q[1]); bottom = Math.max(bottom, q[1]);
    }
    for (let y = Math.max(0, Math.floor(top)); y <= Math.min(height - 1, Math.ceil(bottom)); y++) {
      for (let x = Math.max(0, Math.floor(left)); x <= Math.min(width - 1, Math.ceil(right)); x++) {
        const s = apply(inverse, [x + 0.5, y + 0.5]);
        if (surface(Math.floor(s[0]), Math.floor(s[1]))) expected.data[y * width + x] = 1;
      }
    }
  }
  // Limb cores: a joint opening wider than drawn (an elbow straightening) needs surface the drawing
  // never had — but only gaps the drawing encloses: a bone's estimated width can overhang its outline.
  const enclosed = erode(dilate(coverage, 6), 6);
  for (const bone of rig.bones) {
    const m = plan.transforms.get(bone.index);
    if (!m || bone.name === "torso" || bone.name === "head") continue;
    const [a, b] = [apply(m, bone.from), apply(m, bone.to)];
    const r = bone.radius * plan.scale * 0.55;
    for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)); y <= Math.min(height - 1, Math.ceil(Math.max(a[1], b[1]) + r)); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)); x <= Math.min(width - 1, Math.ceil(Math.max(a[0], b[0]) + r)); x++) {
        if (enclosed.data[y * width + x] && segmentDistance([x + 0.5, y + 0.5], a, b).distance <= r) expected.data[y * width + x] = 1;
      }
    }
  }
  const raw: Mask = { width, height, data: expected.data.map((v, p) => (v && !coverage.data[p] ? 1 : 0)) };
  const opened = dilate(erode(raw, 1), 1);
  const { labels, sizes } = components(opened);
  return { width, height, data: opened.data.map((v, p) => (v && sizes[labels[p] - 1] >= 24 ? 1 : 0)) };
}

/** Onion-peel fill: each exposed pixel takes the mean of its already-known neighbours, outside in. A placeholder for repair, never a final surface. */
export function fillFromSurroundings(image: Rgba, region: Mask): void {
  const { width, height, data } = image;
  const known = new Uint8Array(width * height);
  for (let p = 0; p < known.length; p++) known[p] = !region.data[p] && data[p * 4 + 3] >= 128 ? 1 : 0;
  let frontier: number[] = [];
  for (let p = 0; p < known.length; p++) if (region.data[p]) frontier.push(p);
  while (frontier.length) {
    const next: number[] = [];
    const fill: [number, number, number, number][] = [];
    for (const p of frontier) {
      const [x, y] = [p % width, Math.floor(p / width)];
      let [r, g, b, n] = [0, 0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const [qx, qy] = [x + dx, y + dy];
        if ((dx || dy) && qx >= 0 && qy >= 0 && qx < width && qy < height && known[qy * width + qx]) {
          const q = qy * width + qx;
          r += data[q * 4]; g += data[q * 4 + 1]; b += data[q * 4 + 2]; n++;
        }
      }
      if (n) fill.push([p, r / n, g / n, b / n]);
      else next.push(p);
    }
    if (!fill.length) break;
    for (const [p, r, g, b] of fill) {
      data[p * 4] = Math.round(r); data[p * 4 + 1] = Math.round(g); data[p * 4 + 2] = Math.round(b); data[p * 4 + 3] = 255;
      known[p] = 1;
    }
    frontier = next;
  }
}

