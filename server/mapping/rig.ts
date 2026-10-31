import { dist, dot, norm, segmentDistance, sub, unit, type Vec } from "./geometry";
import type { Rgba } from "../rotoscope/alpha";
import { components, fillHoles, type Mask } from "./mask";
import { BONES, BONE_NAMES, boneDef, normalFrame, toNormal, torsoLength, type BoneName, type Frame, type JointName, type Skeleton } from "./skeleton";

// The articulated 2D rig of one drawing of the character: its skeleton (from
// a pose estimator), the bones' widths and draw order, and which bone every
// pixel of the silhouette belongs to. The mask only says which pixels are the
// character; the skeleton says where the joints are. Where a limb lies over
// the body, the limb in front takes the pixels and the body under it is
// recorded as hidden: moving the limb away exposes it.

/** How wide each bone is against the torso when the silhouette can't tell (the limb lies over the body). */
const DEFAULT_RADIUS: Readonly<Record<BoneName, number>> = {
  torso: 0.5, head: 0.55,
  leftUpperArm: 0.17, leftForearm: 0.14, leftHand: 0.17, rightUpperArm: 0.17, rightForearm: 0.14, rightHand: 0.17,
  leftThigh: 0.25, leftShin: 0.18, leftFoot: 0.16, rightThigh: 0.25, rightShin: 0.18, rightFoot: 0.16,
};

export type RigBone = {
  readonly name: BoneName;
  readonly index: number;
  readonly from: Vec;
  readonly to: Vec;
  readonly length: number;
  /** Half-width of the limb, in pixels. */
  readonly radius: number;
  /** Draw order, higher in front. */
  readonly z: number;
  readonly confidence: number;
};

export type Rig = {
  readonly width: number;
  readonly height: number;
  readonly skeleton: Skeleton;
  readonly bones: readonly RigBone[];
  /** Per pixel: 0 outside the silhouette, else 1 + index of the bone in BONES. */
  readonly labels: Uint8Array;
  /** Per pixel: 1 + index of a bone lying behind a front limb there (its unseen surface), else 0. */
  readonly hidden: Uint8Array;
  readonly mask: Mask;
  /** Shoulders and hips: the torso's four corners. */
  readonly torsoQuad: readonly Vec[];
  readonly frame: Frame;
  /** Bone length over torso length: the character's proportions, independent of size. */
  readonly proportions: Partial<Record<BoneName, number>>;
};

export type RigOptions = {
  /** Draw order corrections (a hand behind the head, an arm behind the back). */
  readonly z?: Partial<Record<BoneName, number>>;
  /** A limb DWPose is unsure of is likely behind the body: it is drawn under the torso. */
  readonly behindBelow?: number;
};

const boneIndex = (name: BoneName) => BONE_NAMES.indexOf(name);

function insidePolygon(p: Vec, polygon: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i], polygon[j]];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function polygonDistance(p: Vec, polygon: readonly Vec[]): number {
  if (insidePolygon(p, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) best = Math.min(best, segmentDistance(p, polygon[i], polygon[(i + 1) % polygon.length]).distance);
  return best;
}

/** Half-width of a limb measured on the silhouette, perpendicular to the bone; null when it runs into the body. */
function measuredRadius(mask: Mask, a: Vec, b: Vec, limit: number): number | null {
  const along = unit(sub(b, a));
  const across: Vec = [-along[1], along[0]];
  const widths: number[] = [];
  for (const t of [0.3, 0.45, 0.6, 0.75]) {
    const c: Vec = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const reach = (sign: number) => {
      for (let r = 0; r <= limit; r++) {
        const x = Math.round(c[0] + across[0] * r * sign);
        const y = Math.round(c[1] + across[1] * r * sign);
        if (x < 0 || y < 0 || x >= mask.width || y >= mask.height || !mask.data[y * mask.width + x]) return r;
      }
      return null;
    };
    const [left, right] = [reach(1), reach(-1)];
    if (left !== null && right !== null) widths.push((left + right) / 2);
  }
  if (widths.length < 2) return null;
  widths.sort((x, y) => x - y);
  return widths[widths.length >> 1];
}

/** Luma of a pixel, 0–255. */
const luma = (data: Buffer, p: number) => 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2];

export function buildRig(image: Rgba, mask: Mask, skeleton: Skeleton, options: RigOptions = {}): Rig {
  const torso = torsoLength(skeleton);
  const frame = normalFrame(skeleton);
  const { leftShoulder, rightShoulder, leftHip, rightHip } = skeleton;
  if (!torso || !frame || !leftShoulder || !rightShoulder || !leftHip || !rightHip) throw new Error("rig: the pose has no torso (both shoulders and hips)");
  if (image.width !== mask.width || image.height !== mask.height) throw new Error("rig: the image and its mask differ in size");
  const torsoQuad: Vec[] = [leftShoulder.p, rightShoulder.p, rightHip.p, leftHip.p];
  const behindBelow = options.behindBelow ?? 0.35;

  const bones: RigBone[] = [];
  for (const def of BONES) {
    const [a, b] = [skeleton[def.from as JointName], skeleton[def.to as JointName]];
    if (!a || !b) continue;
    const length = dist(a.p, b.p);
    const fallback = DEFAULT_RADIUS[def.name] * torso;
    const measured = def.name === "torso" ? null : measuredRadius(mask, a.p, b.p, Math.round(fallback * 1.6));
    const radius = def.name === "torso"
      ? Math.max(dist(leftShoulder.p, rightShoulder.p), dist(leftHip.p, rightHip.p)) / 2
      : def.name === "head"
        ? Math.max(fallback, measured ?? 0, length * 0.9)
        : measured !== null && measured > fallback * 0.5 ? Math.min(measured * 1.15, fallback * 1.5) : fallback;
    const confidence = Math.min(a.score, b.score);
    const z = options.z?.[def.name] ?? (def.z >= 3 && confidence < behindBelow ? -1 : def.z);
    bones.push({ name: def.name, index: boneIndex(def.name), from: a.p, to: b.p, length, radius, z, confidence });
  }

  const { width, height } = mask;
  const labels = new Uint8Array(width * height);
  const second = new Uint8Array(width * height);
  const hidden = new Uint8Array(width * height);
  const torsoBone = bones.find((bone) => bone.name === "torso")!;
  const headBone = bones.find((bone) => bone.name === "head");
  const cost = (bone: RigBone, q: Vec) => {
    // Outside the torso's corners a pixel belongs to a limb leaving it unless nothing else is near.
    if (bone.name === "torso") return (polygonDistance(q, torsoQuad) / (bone.radius * 0.5)) * 2;
    // The head (and its hair) starts at the shoulders: below them is body.
    if (bone.name === "head" && toNormal(frame, q)[1] < 0.9) return Infinity;
    // Past a bone's end (round the joint) the next bone along the limb is the better owner.
    const along = sub(bone.to, bone.from);
    const t = dot(sub(q, bone.from), along) / Math.max(1e-9, dot(along, along));
    const beyond = t < 0 || t > 1 ? 1.5 : 1;
    return (segmentDistance(q, bone.from, bone.to).distance / bone.radius) * beyond;
  };

  // 1. Every pixel to its nearest bone, in each bone's own width.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!mask.data[p]) continue;
      const q: Vec = [x + 0.5, y + 0.5];
      let [best, bestCost, runner, runnerCost, back, backCost] = [-1, Infinity, -1, Infinity, -1, Infinity];
      for (const bone of bones) {
        const c = cost(bone, q);
        if (c < bestCost) { runner = best; runnerCost = bestCost; best = bone.index; bestCost = c; }
        else if (c < runnerCost) { runner = bone.index; runnerCost = c; }
        if (bone.z < 3 && c < backCost) { back = bone.index; backCost = c; }
      }
      // Within the body's own extent a pixel stays with the body: arms and hands take
      // pixels over it only by the claim below, through the line art.
      const chosen = backCost <= 1 ? back : best;
      labels[p] = chosen + 1;
      second[p] = (chosen === best ? runner : best) + 1;
    }
  }

  // 2. Limbs in front (arms, hands) claim their pixels over the body: grown from the bone's
  // core through the drawing, stopping at line art, so a fist beside the hair takes the fist
  // and its outline, not the hair. What they cover of the torso or head is hidden surface.
  const front = bones.filter((bone) => bone.z >= 3).sort((a, b) => a.z - b.z || a.index - b.index);
  const centre: Vec = [torsoQuad.reduce((sum, v) => sum + v[0], 0) / 4, torsoQuad.reduce((sum, v) => sum + v[1], 0) / 4];
  const core = torsoQuad.map((v): Vec => [centre[0] + (v[0] - centre[0]) * 0.85, centre[1] + (v[1] - centre[1]) * 0.85]);
  const claimed = new Uint8Array(width * height);
  const headUnder: number[] = [];
  const queue = new Int32Array(width * height);
  for (const bone of front) {
    claimed.fill(0);
    let [head, tail] = [0, 0];
    const seeds: number[] = [];
    const left = Math.max(0, Math.floor(Math.min(bone.from[0], bone.to[0]) - bone.radius * 1.4));
    const right = Math.min(width - 1, Math.ceil(Math.max(bone.from[0], bone.to[0]) + bone.radius * 1.4));
    const top = Math.max(0, Math.floor(Math.min(bone.from[1], bone.to[1]) - bone.radius * 1.4));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(bone.from[1], bone.to[1]) + bone.radius * 1.4));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const p = y * width + x;
      const { distance, t } = segmentDistance([x + 0.5, y + 0.5], bone.from, bone.to);
      if (mask.data[p] && distance <= bone.radius * 0.35 && t >= 0.12 && t <= 0.95) seeds.push(p);
    }
    if (!seeds.length) continue;
    const seedLuma = seeds.map((p) => luma(image.data, p)).sort((a, b) => a - b);
    const line = Math.min(85, 0.5 * seedLuma[seedLuma.length >> 1]);
    const inside = (p: number, reach: number) => {
      const q: Vec = [(p % width) + 0.5, Math.floor(p / width) + 0.5];
      return segmentDistance(q, bone.from, bone.to).distance <= bone.radius * reach;
    };
    for (const p of seeds) if (luma(image.data, p) >= line) { claimed[p] = 1; queue[tail++] = p; }
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q < 0 || q >= labels.length || claimed[q] || !mask.data[q] || luma(image.data, q) < line || !inside(q, 1.3)) continue;
        claimed[q] = 1;
        queue[tail++] = q;
      }
    }
    // The limb's own outline: line pixels touching the grown region.
    const grown = tail;
    for (let i = 0; i < grown; i++) {
      const p = queue[i];
      const [x, y] = [p % width, Math.floor(p / width)];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const [qx, qy] = [x + dx, y + dy];
        if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
        const q = qy * width + qx;
        if (!claimed[q] && mask.data[q] && luma(image.data, q) < line && inside(q, 1.45)) { claimed[q] = 2; queue[tail++] = q; }
      }
    }
    for (let i = 0; i < tail; i++) {
      const p = queue[i];
      const previous = labels[p] - 1;
      if (previous === bone.index) continue;
      const q: Vec = [(p % width) + 0.5, Math.floor(p / width) + 0.5];
      // The torso hidden under an arm: well inside the shoulders and hips, not the arm's own shoulder.
      if (previous === torsoBone.index && insidePolygon(q, core) && dist(q, bone.name.startsWith("left") ? leftShoulder.p : rightShoulder.p) > bone.radius * 1.5) hidden[p] = torsoBone.index + 1;
      else if (headBone && previous === headBone.index) headUnder.push(p);
      second[p] = previous + 1;
      labels[p] = bone.index + 1;
    }
  }

  // The head is hidden only where the hair surrounds the hand (a hole in the hair's outline):
  // beside or past the hair edge there may be nothing at all behind a fist.
  if (headBone && headUnder.length) {
    const hair = fillHoles({ width, height, data: labels.map((label) => (label === headBone.index + 1 ? 1 : 0)) });
    for (const p of headUnder) if (hair.data[p]) hidden[p] = headBone.index + 1;
  }

  // 3. A patch cut off from its own bone (hair on the far side of a raised hand) goes to the next-closest bone.
  for (const bone of bones) {
    const own: Mask = { width, height, data: labels.map((label) => (label === bone.index + 1 ? 1 : 0)) };
    const { labels: parts, sizes } = components(own);
    if (sizes.length < 2) continue;
    const anchored = new Set<number>();
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const x = Math.round(bone.from[0] + (bone.to[0] - bone.from[0]) * t);
      const y = Math.round(bone.from[1] + (bone.to[1] - bone.from[1]) * t);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const [px, py] = [x + dx, y + dy];
        if (px >= 0 && py >= 0 && px < width && py < height && parts[py * width + px]) anchored.add(parts[py * width + px]);
      }
    }
    // Without any part on the bone line (a bone drawn over another layer), keep the largest.
    if (!anchored.size) anchored.add(sizes.indexOf(Math.max(...sizes)) + 1);
    for (let p = 0; p < labels.length; p++) {
      if (parts[p] && !anchored.has(parts[p]) && second[p] && second[p] !== bone.index + 1) {
        labels[p] = second[p];
        if (hidden[p] === second[p]) hidden[p] = 0;
      }
    }
  }

  const proportions: Partial<Record<BoneName, number>> = {};
  for (const bone of bones) proportions[bone.name] = bone.length / torso;
  return { width, height, skeleton, bones, labels, hidden, mask, torsoQuad, frame, proportions };
}

export const rigBone = (rig: Rig, name: BoneName) => rig.bones.find((bone) => bone.name === name) ?? null;

/** Bones sharing a joint with `name`: its parent and its children present in the rig. */
export function neighbours(rig: Rig, name: BoneName): RigBone[] {
  const def = boneDef(name);
  return rig.bones.filter((bone) => bone.name === def.parent || boneDef(bone.name).parent === name);
}

/** The joint two adjacent bones share, and the child's direction away from it. */
export function sharedJoint(rig: Rig, a: RigBone, b: RigBone): { joint: Vec; child: RigBone } | null {
  const [parent, child] = boneDef(b.name).parent === a.name ? [a, b] : boneDef(a.name).parent === b.name ? [b, a] : [null, null];
  if (!parent || !child) return null;
  return { joint: child.from, child };
}

/** How far around a joint two bones blend: about a limb width, never more than a third of either bone. */
export function blendRadius(parent: RigBone, child: RigBone): number {
  // Wide enough to span the whole limb at the joint, so the seam between the two layers lies inside the blend.
  const limit = parent.name === "torso" ? child.length * 0.45 : Math.min(parent.length, child.length) * 0.45;
  return Math.max(2, Math.min(Math.max(child.radius, parent.name === "torso" ? 0 : parent.radius) * 1.2, limit));
}

const smoothstep = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/**
 * Skinning weights of point v for a pixel owned by `owner`: the owner, and
 * near each of its joints the bone across that joint. The weight across a
 * joint depends only on the point and the joint, so the same mesh vertex gets
 * the same weights from both sides: the limb bends without a seam.
 */
export function weightsFor(rig: Rig, owner: RigBone, v: Vec): Map<number, number> {
  const weights = new Map<number, number>();
  let shared = 0;
  for (const other of neighbours(rig, owner.name)) {
    const pair = sharedJoint(rig, owner, other);
    if (!pair) continue;
    const parent = pair.child === owner ? other : owner;
    const h = blendRadius(parent, pair.child);
    const offset = sub(v, pair.joint);
    if (norm(offset) > 2.5 * h) continue;
    const along = dot(offset, unit(sub(pair.child.to, pair.child.from)));
    // Across the joint the weight depends only on the point (the same from both layers); it fades
    // out only past 1.5 blend radii, beyond any seam vertex the two layers share.
    const radial = 1 - smoothstep((norm(offset) - 1.5 * h) / h);
    const across = smoothstep((along + h) / (2 * h));
    const w = radial * (other === pair.child ? across : 1 - across);
    if (w <= 1e-4) continue;
    weights.set(other.index, w);
    shared += w;
  }
  weights.set(owner.index, Math.max(0, 1 - shared));
  const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
  for (const [k, w] of weights) weights.set(k, w / total);
  return weights;
}
