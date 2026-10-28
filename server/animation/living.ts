import { growMask } from "./reference-manager";

// "Animate as is": the upload itself set in motion, with nothing redrawn.
// Every frame is made of the upload's own pixels: flowing parts (hair, a
// cape) bend in a wave that starts at their root, the body breathes, the sky
// drifts, and small floating things (leaves, petals) travel or flutter as cut
// out sprites. Where a sprite leaves its place, the gap is filled from its
// surroundings (push-pull), never by a model. Every motion is periodic in
// t ∈ [0, 1), so the loop closes exactly. Pixels no motion reaches are the
// upload's own, byte for byte.

export const LIVING_FPS = 60;
/**
 * The character moves on every frame, smoothly: the warp is continuous, not
 * a series of held poses, so a 60 Hz screen shows it at 60 fps. The camera,
 * the sky and floating pieces also move on every frame.
 */
export const LIVING_BODY_HOLD = 1;

/** Loop time of the character's pose at an output frame: it steps every LIVING_BODY_HOLD frames. */
export function bodyTime(frame: number, frames: number): number {
  return (frame - (frame % LIVING_BODY_HOLD)) / frames;
}

export type LivingStrength = number;

export type LivingScene = {
  readonly width: number;
  readonly height: number;
  /** The upload, 3 channels. */
  readonly rgb: Buffer;
  /** The character: breathes and leans a little from its lowest point. */
  readonly body: { readonly mask: Uint8Array; readonly strength: LivingStrength } | null;
  /** Parts that hang from the body and bend in a wave from their root. */
  readonly flows: readonly { readonly mask: Uint8Array; readonly strength: LivingStrength }[];
  /** Small floating things, one mask each. */
  readonly particles: readonly { readonly masks: readonly Uint8Array[]; readonly motion: "drift" | "flutter"; readonly strength: LivingStrength }[];
  readonly sky: { readonly mask: Uint8Array; readonly strength: LivingStrength } | null;
  /** The way the wind blows: 1 to the right, -1 to the left. */
  readonly wind: 1 | -1;
  /** The eyes closed (the whole picture, used only where `alpha` is): a blink once per loop. */
  readonly blink?: { readonly rgb: Buffer; readonly alpha: Float32Array; readonly at: number; readonly length: number } | null;
};

type Sprite = {
  /** Premultiplied RGBA, 0..1. */
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
  /** Where its center sits in the upload. */
  readonly x: number;
  readonly y: number;
  /** The same center, inside the sprite. */
  readonly originX: number;
  readonly originY: number;
  readonly radius: number;
  readonly motion: "drift" | "flutter";
  readonly strength: number;
  /** Crossings of the frame per loop (drift); bigger, nearer things go faster. */
  readonly laps: number;
  readonly phase: number;
  /** Passes behind the character: it didn't overlap it in the upload. */
  readonly behind: boolean;
};

type Flow = {
  readonly weight: Float32Array;
  readonly phase: Float32Array;
  readonly amplitude: number;
  /** How much of a wave travels from root to tip, in radians. */
  readonly wave: number;
};

/** A tip travels at most this share of its part's length; more, and a short part folds over itself. */
const MAX_REACH_OF_LENGTH = 0.25;
/** The steepest a bend may get (pixels moved per pixel along the part) before the picture folds. */
const MAX_BEND = 0.5;

export type PreparedLiving = {
  readonly width: number;
  readonly height: number;
  /** The upload with every sprite's place filled. */
  readonly base: Buffer;
  /** The drifting sky: a plate of sky only, where it shows (with how much), and how far it drifts per loop. */
  readonly sky: { readonly plate: Buffer; readonly indices: Int32Array; readonly alpha: Float32Array; readonly shift: number } | null;
  /** Pixels some displacement reaches, and per field its weight there. */
  readonly active: Int32Array;
  readonly breath: { readonly weight: Float32Array; readonly bottom: number; readonly strength: number } | null;
  /** The character's soft coverage, for sprites passing behind it and for the "depth" camera. */
  readonly cover: Float32Array | null;
  /** The character with its painted glow and the room breathing moves it, for "depth": the scene replaces all of it behind. */
  readonly wideCover: Float32Array | null;
  readonly flows: readonly Flow[];
  readonly sprites: readonly Sprite[];
  readonly wind: 1 | -1;
  readonly blink: { readonly indices: Int32Array; readonly alpha: Float32Array; readonly rgb: Buffer; readonly at: number; readonly length: number } | null;
};

// ── Field helpers ──────────────────────────────────────────────────────────

/** A box blur of radius r, three passes (close to a Gaussian of sigma ≈ r). */
export function blurField(field: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius < 1) return Float32Array.from(field);
  const current = Float32Array.from(field);
  const next = new Float32Array(field.length);
  const size = 2 * radius + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += current[y * width + Math.min(width - 1, Math.max(0, x))];
      for (let x = 0; x < width; x++) {
        next[y * width + x] = sum / size;
        sum += current[y * width + Math.min(width - 1, x + radius + 1)] - current[y * width + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += next[Math.min(height - 1, Math.max(0, y)) * width + x];
      for (let y = 0; y < height; y++) {
        current[y * width + x] = sum / size;
        sum += next[Math.min(height - 1, y + radius + 1) * width + x] - next[Math.max(0, y - radius) * width + x];
      }
    }
  }
  return current;
}

/**
 * Fills the holes of an RGB image from their surroundings (push-pull): known
 * colors are averaged down a pyramid until every cell has one, then each
 * level's holes take the smooth upsampling of the level above. Known pixels
 * are returned unchanged.
 */
export function inpaint(rgb: Buffer, hole: Uint8Array, width: number, height: number): Buffer {
  type Level = { color: Float32Array; weight: Float32Array; width: number; height: number };
  const first: Level = { color: new Float32Array(width * height * 3), weight: new Float32Array(width * height), width, height };
  let known = 0;
  for (let index = 0; index < width * height; index++) {
    if (hole[index]) continue;
    known++;
    first.weight[index] = 1;
    for (let c = 0; c < 3; c++) first.color[index * 3 + c] = rgb[index * 3 + c];
  }
  if (known === 0 || known === width * height) return Buffer.from(rgb);
  const levels = [first];
  while (true) {
    const level = levels.at(-1)!;
    if (level.width === 1 && level.height === 1) break;
    let full = true;
    for (const value of level.weight) if (value === 0) { full = false; break; }
    if (full) break;
    const w = Math.ceil(level.width / 2), h = Math.ceil(level.height / 2);
    const coarse: Level = { color: new Float32Array(w * h * 3), weight: new Float32Array(w * h), width: w, height: h };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0;
      const color = [0, 0, 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const fx = 2 * x + dx, fy = 2 * y + dy;
        if (fx >= level.width || fy >= level.height) continue;
        const index = fy * level.width + fx;
        const weight = level.weight[index];
        sum += weight;
        for (let c = 0; c < 3; c++) color[c] += level.color[index * 3 + c] * weight;
      }
      const index = y * w + x;
      coarse.weight[index] = Math.min(1, sum);
      if (sum > 0) for (let c = 0; c < 3; c++) coarse.color[index * 3 + c] = color[c] / sum;
    }
    levels.push(coarse);
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const level = levels[l], coarse = levels[l + 1];
    for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) {
      const index = y * level.width + x;
      const weight = level.weight[index];
      if (weight >= 1) continue;
      const up = sampleColor(coarse.color, coarse.width, coarse.height, (x + 0.5) / 2 - 0.5, (y + 0.5) / 2 - 0.5);
      for (let c = 0; c < 3; c++) level.color[index * 3 + c] = level.color[index * 3 + c] * weight + up[c] * (1 - weight);
      level.weight[index] = 1;
    }
  }
  const out = Buffer.from(rgb);
  for (let index = 0; index < width * height; index++) {
    if (!hole[index]) continue;
    for (let c = 0; c < 3; c++) out[index * 3 + c] = Math.round(first.color[index * 3 + c]);
  }
  return out;
}

function sampleColor(color: Float32Array, width: number, height: number, x: number, y: number): [number, number, number] {
  const cx = Math.min(width - 1, Math.max(0, x)), cy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0, fy = cy - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const top = color[(y0 * width + x0) * 3 + c] * (1 - fx) + color[(y0 * width + x1) * 3 + c] * fx;
    const bottom = color[(y1 * width + x0) * 3 + c] * (1 - fx) + color[(y1 * width + x1) * 3 + c] * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

/** Steps from the nearest root, moving only inside the mask (8 neighbors); -1 where unreachable. */
export function geodesicDistance(inside: Uint8Array, roots: Uint8Array, width: number, height: number): Int32Array {
  const distance = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  for (let index = 0; index < inside.length; index++) if (inside[index] && roots[index]) { distance[index] = 0; queue[tail++] = index; }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width, y = (index - x) / width;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (!inside[next] || distance[next] !== -1) continue;
      distance[next] = distance[index] + 1;
      queue[tail++] = next;
    }
  }
  return distance;
}

const binary = (mask: Uint8Array) => mask.map((value) => (value >= 128 ? 1 : 0));

/** A fixed, well-spread phase per index: animations look the same on every render. */
const phaseOf = (index: number) => (index * 0.6180339887) % 1;

// ── Preparation ────────────────────────────────────────────────────────────

/** How far a fully flowing tip travels, as a share of the image's long side. */
export const FLOW_REACH = 0.018;
/** Breathing: the body's height changes by up to this share. */
export const BREATH_DEPTH = 0.007;
/** Sky drift per loop, as a share of the width. */
export const SKY_DRIFT = 0.04;

export function prepareLiving(scene: LivingScene, options: { readonly cover?: boolean } = {}): PreparedLiving {
  const { width, height, rgb } = scene;
  const total = width * height;
  const long = Math.max(width, height);
  // Painted glow and color fringes reach a few pixels past what SAM outlines; they go with the thing.
  const fringe = Math.max(3, Math.round(long * 0.003));
  const bodyInside = scene.body ? binary(scene.body.mask) : null;

  // Sprites: cut out of the upload; their places become holes in the base.
  const holes = new Uint8Array(total);
  const sprites: Sprite[] = [];
  for (const group of scene.particles) {
    if (group.strength <= 0) continue;
    const areas = group.masks.map((mask) => mask.reduce((sum, value) => sum + (value >= 128 ? 1 : 0), 0));
    const sorted = [...areas].sort((a, b) => b - a);
    const large = sorted[Math.floor(sorted.length / 3)] ?? 0;
    group.masks.forEach((mask, index) => {
      const sprite = cutSprite(rgb, mask, width, height);
      if (!sprite) return;
      const grown = growMask(mask, width, height, 2 * fringe);
      let overlap = 0;
      for (let i = 0; i < total; i++) {
        if (grown[i] >= 128) holes[i] = 1;
        if (bodyInside && bodyInside[i] && mask[i] >= 128) overlap++;
      }
      sprites.push({ ...sprite, motion: group.motion, strength: group.strength, laps: areas[index] >= large && large > 0 ? 2 : 1, phase: phaseOf(sprites.length), behind: Boolean(bodyInside) && overlap < areas[index] * 0.3 });
    });
  }
  const base = inpaint(rgb, holes, width, height);

  // The sky, with the holes sprites left in it.
  let sky: PreparedLiving["sky"] = null;
  if (scene.sky && scene.sky.strength > 0) {
    const region = binary(scene.sky.mask);
    const isSky = Uint8Array.from(region);
    // A hole surrounded mostly by sky is sky: the leaf was floating in it.
    const ring = growMask(holes.map((value) => value * 255), width, height, 3);
    for (const index of componentsOf(holes, width, height)) {
      let skyCount = 0, count = 0;
      for (const i of index.ring(ring)) { count++; if (isSky[i]) skyCount++; }
      if (count && skyCount / count > 0.7) for (const i of index.pixels) region[i] = 1;
    }
    // Only open sky drifts. SAM's sky reaches into the glow and blur around
    // what stands in it; drifting those pixels would slide ghost outlines
    // off the things they belong to. The drift fades in past them.
    const band = 3 * fringe;
    const solid = growMask(region.map((value) => (value ? 0 : 255)), width, height, band);
    const open = new Float32Array(total);
    for (let i = 0; i < total; i++) open[i] = region[i] && solid[i] < 128 ? 1 : 0;
    const soft = blurField(open, width, height, Math.ceil(band / 3));
    const indices: number[] = [];
    const outside = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (!open[i]) outside[i] = 1;
      if (open[i] && soft[i] > 1e-3) indices.push(i);
    }
    if (indices.length) {
      sky = {
        plate: inpaint(base, outside, width, height),
        indices: Int32Array.from(indices),
        alpha: Float32Array.from(indices, (i) => soft[i]),
        shift: scene.sky.strength * SKY_DRIFT * width * scene.wind,
      };
    }
  }

  // Displacement fields.
  const radius = Math.max(4, Math.round(long * 0.012));
  let bodyWeight: Float32Array | null = null;
  let bottom = height - 1;
  if (bodyInside && scene.body!.strength > 0) {
    bodyWeight = blurField(Float32Array.from(bodyInside), width, height, radius);
    bottom = 0;
    for (let i = 0; i < total; i++) if (bodyInside[i]) bottom = Math.max(bottom, Math.floor(i / width));
  }
  const flowFields: Flow[] = [];
  for (const flow of scene.flows) {
    if (flow.strength <= 0) continue;
    // What's around a flowing part follows it over more than its tip's whole travel: a shorter
    // reach would stop the picture before the tip and cut the part off at the field's edge.
    const asked = flow.strength * FLOW_REACH * long;
    // Three times the travel keeps the bend gentle enough that the picture never folds over itself.
    // Grown for its painted glow, but only over the background: never into the rest of the character.
    const grown = growMask(flow.mask, width, height, 2 * fringe);
    if (bodyInside) for (let i = 0; i < total; i++) if (bodyInside[i] && flow.mask[i] < 128) grown[i] = 0;
    const field = flowField(grown, bodyInside, width, height, Math.max(4 * radius, Math.ceil(asked * 3)));
    if (!field) continue;
    // A short part (a tail) moves less and carries less of a wave than a long one (a ponytail).
    const amplitude = Math.min(asked, MAX_REACH_OF_LENGTH * field.length);
    flowFields.push({ weight: field.weight, phase: field.phase, amplitude, wave: Math.min(1.5 * Math.PI, (MAX_BEND * field.length) / Math.max(1, amplitude)) });
  }

  const active: number[] = [];
  for (let i = 0; i < total; i++) {
    if ((bodyWeight && bodyWeight[i] > 1e-3) || flowFields.some((field) => field.weight[i] > 1e-3)) active.push(i);
  }
  const pick = (field: Float32Array) => Float32Array.from(active, (i) => field[i]);
  return {
    width,
    height,
    base,
    sky,
    active: Int32Array.from(active),
    breath: bodyWeight && scene.body ? { weight: pick(bodyWeight), bottom, strength: scene.body.strength } : null,
    // Kept when sprites pass behind the character, or when the camera moves it apart from the background
    // (then a pixel or two wider, so its outline goes with it).
    cover: bodyInside && (options.cover || sprites.some((sprite) => sprite.behind))
      ? blurField(Float32Array.from(options.cover ? binary(growMask(scene.body!.mask, width, height, 2)) : bodyInside), width, height, 1)
      : null,
    wideCover: bodyInside && options.cover ? blurField(Float32Array.from(binary(growMask(scene.body!.mask, width, height, 3 * fringe + Math.ceil(BREATH_DEPTH * height)))), width, height, fringe) : null,
    flows: flowFields.map((field) => ({ weight: pick(field.weight), phase: pick(field.phase), amplitude: field.amplitude, wave: field.wave })),
    sprites,
    wind: scene.wind,
    blink: blinkOf(scene),
  };
}

function blinkOf(scene: LivingScene): PreparedLiving["blink"] {
  if (!scene.blink) return null;
  const indices: number[] = [];
  for (let i = 0; i < scene.blink.alpha.length; i++) if (scene.blink.alpha[i] > 1e-3) indices.push(i);
  if (!indices.length) return null;
  return { indices: Int32Array.from(indices), alpha: Float32Array.from(indices, (i) => scene.blink!.alpha[i]), rgb: scene.blink.rgb, at: scene.blink.at, length: scene.blink.length };
}

/**
 * How closed the eyes are at loop time t: shutting over the first quarter
 * of the blink, shut for half, opening over the last quarter. Pure.
 */
export function blinkAmount(t: number, at: number, length: number): number {
  const into = (((t - at) % 1) + 1) % 1;
  if (into >= length) return 0;
  const step = into / length;
  return step < 0.25 ? step / 0.25 : step < 0.75 ? 1 : (1 - step) / 0.25;
}

/** Connected groups of set pixels, each with a way to list its surrounding ring. */
function* componentsOf(mask: Uint8Array, width: number, height: number): Generator<{ pixels: number[]; ring: (grown: Uint8Array) => Generator<number> }> {
  const seen = new Uint8Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const pixels: number[] = [start];
    seen[start] = 1;
    let left = width, right = 0, top = height, bottomRow = 0;
    for (let k = 0; k < pixels.length; k++) {
      const index = pixels[k];
      const x = index % width, y = (index - x) / width;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottomRow = Math.max(bottomRow, y);
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= mask.length || seen[next] || !mask[next]) continue;
        if ((next === index - 1 && x === 0) || (next === index + 1 && x === width - 1)) continue;
        seen[next] = 1;
        pixels.push(next);
      }
    }
    yield {
      pixels,
      *ring(grown: Uint8Array) {
        for (let y = Math.max(0, top - 3); y <= Math.min(height - 1, bottomRow + 3); y++) {
          for (let x = Math.max(0, left - 3); x <= Math.min(width - 1, right + 3); x++) {
            const index = y * width + x;
            if (grown[index] >= 128 && !mask[index]) yield index;
          }
        }
      },
    };
  }
}

/**
 * For every pixel, the nearest set pixel and how far it is (two raster
 * passes propagating the nearest source, Euclidean distance to it). Pure.
 */
export function nearestSet(mask: Uint8Array, width: number, height: number): { distance: Float32Array; source: Int32Array } {
  const distance = new Float32Array(width * height).fill(Infinity);
  const source = new Int32Array(width * height).fill(-1);
  for (let i = 0; i < mask.length; i++) if (mask[i]) { distance[i] = 0; source[i] = i; }
  const visit = (index: number, x: number, y: number, nx: number, ny: number) => {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
    const from = source[ny * width + nx];
    if (from < 0) return;
    const fx = from % width, fy = (from - fx) / width;
    const d = Math.hypot(x - fx, y - fy);
    if (d < distance[index]) { distance[index] = d; source[index] = from; }
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    visit(index, x, y, x - 1, y); visit(index, x, y, x - 1, y - 1); visit(index, x, y, x, y - 1); visit(index, x, y, x + 1, y - 1);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const index = y * width + x;
    visit(index, x, y, x + 1, y); visit(index, x, y, x + 1, y + 1); visit(index, x, y, x, y + 1); visit(index, x, y, x - 1, y + 1);
  }
  return { distance, source };
}

/**
 * A flowing part's weight (0 at its root, 1 at its farthest tip) and wave
 * phase. Past its edge, each pixel takes the weight of the part's nearest
 * pixel, fading to nothing over `reach` (a cosine), so the background
 * around the part bends along continuously instead of tearing at its
 * outline; the rest of the character never does. The root is where it
 * touches the rest of the body; without a body, its top.
 */
function flowField(mask: Uint8Array, body: Uint8Array | null, width: number, height: number, reach: number): { weight: Float32Array; phase: Float32Array; length: number } | null {
  const total = width * height;
  const inside = binary(mask);
  const roots = new Uint8Array(total);
  let any = false;
  if (body) {
    const rest = new Uint8Array(total);
    for (let i = 0; i < total; i++) rest[i] = body[i] && !inside[i] ? 255 : 0;
    const touching = growMask(rest, width, height, 2);
    for (let i = 0; i < total; i++) if (inside[i] && touching[i] >= 128) { roots[i] = 1; any = true; }
  }
  if (!any) {
    let top = -1;
    for (let i = 0; i < total && top < 0; i++) if (inside[i]) top = Math.floor(i / width);
    if (top < 0) return null;
    for (let x = 0; x < width; x++) if (inside[top * width + x]) roots[top * width + x] = 1;
  }
  const distance = geodesicDistance(inside, roots, width, height);
  let far = 1;
  for (const value of distance) if (value > far) far = value;
  const weight = new Float32Array(total);
  const phase = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    if (!inside[i]) continue;
    const s = distance[i] < 0 ? 1 : distance[i] / far;
    weight[i] = s ** 1.6;
    phase[i] = s;
  }
  const near = nearestSet(inside, width, height);
  for (let i = 0; i < total; i++) {
    // Only the background bends along: the rest of the character (a leg a tail hangs behind) keeps its shape.
    if (inside[i] || near.distance[i] >= reach || (body && body[i])) continue;
    const from = near.source[i];
    weight[i] = weight[from] * 0.5 * (1 + Math.cos((Math.PI * near.distance[i]) / reach));
    phase[i] = phase[from];
  }
  return { weight, phase, length: far };
}

function cutSprite(rgb: Buffer, mask: Uint8Array, width: number, height: number): Omit<Sprite, "motion" | "strength" | "laps" | "phase" | "behind"> | null {
  let left = width, right = -1, top = height, bottom = -1, sumX = 0, sumY = 0, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (mask[y * width + x] < 128) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    sumX += x; sumY += y; count++;
  }
  if (!count) return null;
  const pad = 2;
  left = Math.max(0, left - pad); top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad); bottom = Math.min(height - 1, bottom + pad);
  const w = right - left + 1, h = bottom - top + 1;
  // Edges softened by one pixel, so a moved leaf has no jagged outline.
  const local = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) local[y * w + x] = mask[(top + y) * width + left + x] >= 128 ? 1 : 0;
  const soft = blurField(local, w, h, 1);
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = Math.min(1, local[y * w + x] ? Math.max(soft[y * w + x], 0.6) : soft[y * w + x] * 0.8);
    const source = ((top + y) * width + left + x) * 3;
    const target = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) data[target + c] = (rgb[source + c] / 255) * a;
    data[target + 3] = a;
  }
  const x = sumX / count, y = sumY / count;
  return { data, width: w, height: h, x, y, originX: x - left, originY: y - top, radius: Math.hypot(w, h) / 2 };
}

// ── Frames ─────────────────────────────────────────────────────────────────

/** One frame at loop time t ∈ [0, 1), RGBA. */
export function livingFrame(prepared: PreparedLiving, t: number, body = t): Buffer {
  return livingLayers(prepared, t, body).rgba;
}

/**
 * One frame, and where the character covers it at that moment (0..1, when
 * the character is kept). `body` is the loop time of the character's own
 * motion (breathing, flowing parts, the blink); the sky and floating pieces
 * follow `t`. The renderer advances both every frame at 60 fps.
 */
export function livingLayers(prepared: PreparedLiving, t: number, body = t): { rgba: Buffer; cover: Float32Array | null } {
  const { width, height, base } = prepared;
  const total = width * height;
  const phase = ((t % 1) + 1) % 1;
  const pose = ((body % 1) + 1) % 1;
  const turn = 2 * Math.PI * pose;

  // The background at t: the base, with the sky drifting (two shifted copies
  // crossfaded, so the drift loops).
  let backdrop = base;
  if (prepared.sky) {
    backdrop = Buffer.from(base);
    const { plate, indices, alpha, shift } = prepared.sky;
    const a = shift * phase, b = shift * (phase - 1);
    for (let k = 0; k < indices.length; k++) {
      const index = indices[k];
      const x = index % width, y = (index - x) / width;
      const weight = alpha[k];
      for (let c = 0; c < 3; c++) {
        const drift = sampleRow(plate, width, y, x - a, c) * (1 - phase) + sampleRow(plate, width, y, x - b, c) * phase;
        backdrop[index * 3 + c] = Math.round(base[index * 3 + c] * (1 - weight) + drift * weight);
      }
    }
  }

  // The blink: the closed eyes faded in over the open ones, before anything bends, so they move with the face.
  if (prepared.blink) {
    const shut = blinkAmount(pose, prepared.blink.at, prepared.blink.length);
    if (shut > 0) {
      if (backdrop === base) backdrop = Buffer.from(base);
      const { indices, alpha, rgb: closed } = prepared.blink;
      for (let k = 0; k < indices.length; k++) {
        const index = indices[k], w = alpha[k] * shut;
        for (let c = 0; c < 3; c++) backdrop[index * 3 + c] = Math.round(backdrop[index * 3 + c] * (1 - w) + closed[index * 3 + c] * w);
      }
    }
  }

  const out = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    out[i * 4] = backdrop[i * 3];
    out[i * 4 + 1] = backdrop[i * 3 + 1];
    out[i * 4 + 2] = backdrop[i * 3 + 2];
    out[i * 4 + 3] = 255;
  }

  // Displacement: breathing and flowing parts, sampled backward. The
  // character's coverage moves with it, so sprites pass behind where it is now.
  const { active, breath, flows } = prepared;
  const cover = prepared.cover ? Float32Array.from(prepared.cover) : null;
  const lift = breath ? breath.strength * BREATH_DEPTH * Math.sin(turn) : 0;
  const lean = breath ? breath.strength * BREATH_DEPTH * 0.5 * Math.sin(turn + Math.PI / 2) : 0;
  for (let k = 0; k < active.length; k++) {
    const index = active[k];
    const x = index % width, y = (index - x) / width;
    let dx = 0, dy = 0;
    if (breath) {
      const g = breath.weight[k];
      const above = y - breath.bottom;
      dy += above * lift * g;
      dx += above * lean * g;
    }
    for (const flow of flows) {
      const w = flow.weight[k];
      if (w <= 0) continue;
      const angle = turn - flow.wave * flow.phase[k];
      dx += flow.amplitude * w * Math.sin(angle) * prepared.wind;
      dy += flow.amplitude * w * 0.35 * Math.cos(angle);
    }
    if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) continue;
    for (let c = 0; c < 3; c++) out[index * 4 + c] = Math.round(sampleRgb(backdrop, width, height, x - dx, y - dy, c));
    if (cover) cover[index] = sampleField(prepared.cover!, width, height, x - dx, y - dy);
  }

  for (const sprite of prepared.sprites) drawSprite(out, width, height, sprite, phase, prepared.wind, sprite.behind ? cover : null);
  return { rgba: out, cover };
}

function sampleField(field: Float32Array, width: number, height: number, x: number, y: number): number {
  const cx = Math.min(width - 1, Math.max(0, x)), cy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0, fy = cy - y0;
  return (field[y0 * width + x0] * (1 - fx) + field[y0 * width + x1] * fx) * (1 - fy) + (field[y1 * width + x0] * (1 - fx) + field[y1 * width + x1] * fx) * fy;
}

function sampleRow(rgb: Buffer, width: number, y: number, x: number, c: number): number {
  const cx = Math.min(width - 1, Math.max(0, x));
  const x0 = Math.floor(cx), x1 = Math.min(width - 1, x0 + 1), f = cx - x0;
  return rgb[(y * width + x0) * 3 + c] * (1 - f) + rgb[(y * width + x1) * 3 + c] * f;
}

function sampleRgb(rgb: Buffer, width: number, height: number, x: number, y: number, c: number): number {
  const cx = Math.min(width - 1, Math.max(0, x)), cy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0, fy = cy - y0;
  const top = rgb[(y0 * width + x0) * 3 + c] * (1 - fx) + rgb[(y0 * width + x1) * 3 + c] * fx;
  const bottom = rgb[(y1 * width + x0) * 3 + c] * (1 - fx) + rgb[(y1 * width + x1) * 3 + c] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Where a sprite is at loop time t, and how far it has turned. */
export function spritePlacement(sprite: Pick<Sprite, "x" | "y" | "radius" | "motion" | "strength" | "laps" | "phase">, t: number, width: number, height: number, wind: 1 | -1): { x: number; y: number; angle: number } {
  const turn = 2 * Math.PI;
  const bob = sprite.strength * 0.012 * height;
  if (sprite.motion === "flutter") {
    return {
      x: sprite.x + sprite.strength * 0.01 * width * Math.sin(turn * (t + sprite.phase)) - sprite.strength * 0.01 * width * Math.sin(turn * sprite.phase),
      y: sprite.y + bob * (Math.sin(turn * (2 * t + sprite.phase)) - Math.sin(turn * sprite.phase)),
      angle: sprite.strength * 0.4 * Math.sin(turn * t),
    };
  }
  // Drift: across the frame and back in from the other side, whole crossings per loop.
  const margin = sprite.radius + 2;
  const span = width + 2 * margin;
  const travelled = sprite.x + margin + wind * sprite.laps * span * t;
  return {
    x: (((travelled % span) + span) % span) - margin,
    y: sprite.y + bob * Math.sin(turn * sprite.laps * t),
    angle: sprite.strength * 0.5 * Math.sin(turn * t),
  };
}

function drawSprite(out: Buffer, width: number, height: number, sprite: Sprite, t: number, wind: 1 | -1, cover: Float32Array | null): void {
  const place = spritePlacement(sprite, t, width, height, wind);
  const cos = Math.cos(place.angle), sin = Math.sin(place.angle);
  const reach = Math.ceil(sprite.radius) + 1;
  const left = Math.max(0, Math.floor(place.x - reach)), right = Math.min(width - 1, Math.ceil(place.x + reach));
  const top = Math.max(0, Math.floor(place.y - reach)), bottom = Math.min(height - 1, Math.ceil(place.y + reach));
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    // Back into the sprite: undo the move, then the turn.
    const rx = x - place.x, ry = y - place.y;
    const sx = cos * rx + sin * ry + sprite.originX;
    const sy = -sin * rx + cos * ry + sprite.originY;
    if (sx < -1 || sy < -1 || sx > sprite.width || sy > sprite.height) continue;
    const pixel = samplePremultiplied(sprite, sx, sy);
    const hidden = cover ? cover[y * width + x] : 0;
    if (pixel[3] <= 0 || hidden >= 1) continue;
    const index = (y * width + x) * 4;
    const seen = 1 - hidden;
    for (let c = 0; c < 3; c++) out[index + c] = Math.round(pixel[c] * 255 * seen + out[index + c] * (1 - pixel[3] * seen));
  }
}

function samplePremultiplied(sprite: Sprite, x: number, y: number): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  for (const [dx, dy, weight] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
    const px = x0 + dx, py = y0 + dy;
    if (px < 0 || py < 0 || px >= sprite.width || py >= sprite.height || weight === 0) continue;
    const index = (py * sprite.width + px) * 4;
    for (let c = 0; c < 4; c++) out[c] += sprite.data[index + c] * weight;
  }
  return out;
}

// ── Framing ────────────────────────────────────────────────────────────────

/** How much closer a moving camera gets, at most. */
export const CAMERA_ZOOM = 0.08;

export type View = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** The video's size for an aspect: the picture's own, or the largest crop of that shape. Even sides, as H.264 needs. */
export function framedSize(aspect: "original" | "9:16" | "1:1", width: number, height: number): { width: number; height: number } {
  if (aspect === "original") return { width: width & ~1, height: height & ~1 };
  const ratio = aspect === "9:16" ? 9 / 16 : 1;
  const fit = width / height > ratio ? { width: Math.round(height * ratio), height } : { width, height: Math.round(width / ratio) };
  return { width: fit.width & ~1, height: fit.height & ~1 };
}

/** Share of the character's height, from its top, that sets where a narrow crop looks: the head and shoulders. */
const FOCUS_TOP = 0.4;

/**
 * Where the camera looks: across, the center of mass of the character's top
 * (its head and hair, not an outstretched arm's reach); down, the middle of
 * the character. The picture's middle without one.
 */
export function focusOf(mask: Uint8Array | null, width: number, height: number): { x: number; y: number } {
  let top = height, bottom = -1;
  if (mask) for (let i = 0; i < mask.length; i++) {
    if (mask[i] < 128) continue;
    const y = Math.floor(i / width);
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  if (!mask || bottom < 0) return { x: width / 2, y: height / 2 };
  const limit = top + (bottom - top + 1) * FOCUS_TOP;
  let sum = 0, count = 0;
  for (let y = top; y < limit; y++) for (let x = 0; x < width; x++) if (mask[y * width + x] >= 128) { sum += x; count++; }
  return { x: sum / count, y: (top + bottom + 1) / 2 };
}

/**
 * The part of the picture shown at loop time t: a crop of the video's shape
 * around the focus, closer during a slow zoom (in and back out), sliding
 * side to side for a pan. Periodic, so the loop still closes; always inside
 * the picture.
 */
export function cameraView(camera: "still" | "zoom" | "pan", t: number, source: { width: number; height: number }, crop: { width: number; height: number }, focus: { x: number; y: number }): View {
  const turn = 2 * Math.PI * (((t % 1) + 1) % 1);
  const zoom = camera === "zoom" ? 1 + (CAMERA_ZOOM * (1 - Math.cos(turn))) / 2 : camera === "pan" ? 1 + CAMERA_ZOOM : 1;
  const width = crop.width / zoom, height = crop.height / zoom;
  // A pan travels across the room the zoom makes inside the crop.
  const x = focus.x + (camera === "pan" ? ((crop.width - width) / 2) * Math.sin(turn) : 0);
  const clamp = (value: number, size: number, limit: number) => Math.min(Math.max(0, value - size / 2), limit - size);
  return { x: clamp(x, width, source.width), y: clamp(focus.y, height, source.height), width, height };
}

/** How much more the character slides than the background with the "depth" camera: it is nearer. */
export const DEPTH_NEAR = 1;
export const DEPTH_FAR = 0.35;

/**
 * The "depth" camera: one slightly closer view per layer, the background's
 * sliding a little and the character's more, side to side over the loop, as
 * when a camera passes a near subject in front of a far scene. Periodic.
 */
export function depthViews(t: number, source: { width: number; height: number }, crop: { width: number; height: number }, focus: { x: number; y: number }): { back: View; front: View } {
  const turn = 2 * Math.PI * (((t % 1) + 1) % 1);
  const zoom = 1 + CAMERA_ZOOM;
  const width = crop.width / zoom, height = crop.height / zoom;
  const room = (crop.width - width) / 2;
  const clamp = (value: number, size: number, limit: number) => Math.min(Math.max(0, value - size / 2), limit - size);
  const at = (share: number): View => ({ x: clamp(focus.x + room * share * Math.sin(turn), width, source.width), y: clamp(focus.y, height, source.height), width, height });
  return { back: at(DEPTH_FAR), front: at(DEPTH_NEAR) };
}

/** A 0..1 field seen through a view, resized to the video, bilinear. */
export function viewField(field: Float32Array, sourceWidth: number, sourceHeight: number, view: View, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  const sx = view.width / width, sy = view.height / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = sampleField(field, sourceWidth, sourceHeight, view.x + (x + 0.5) * sx - 0.5, view.y + (y + 0.5) * sy - 0.5);
  return out;
}

/**
 * A "depth" frame: the background (the frame with the character's place
 * taken from the scene plate) through its view, the character through its
 * own, laid over it by its coverage. What the character uncovers as it
 * slides is the plate, never a hole.
 */
export function depthFrame(rgba: Buffer, cover: Float32Array, plate: Buffer, sourceWidth: number, sourceHeight: number, views: { back: View; front: View }, width: number, height: number, behind: Float32Array = cover): Buffer {
  // Behind the character, its glow included (`behind`): the scene, so no outline is left on the background as it slides.
  const background = Buffer.from(rgba);
  for (let i = 0; i < behind.length; i++) {
    const k = behind[i];
    if (k <= 0) continue;
    for (let c = 0; c < 3; c++) background[i * 4 + c] = Math.round(rgba[i * 4 + c] * (1 - k) + plate[i * 3 + c] * k);
  }
  const back = viewFrame(background, sourceWidth, sourceHeight, views.back, width, height);
  const front = viewFrame(rgba, sourceWidth, sourceHeight, views.front, width, height);
  const alpha = viewField(cover, sourceWidth, sourceHeight, views.front, width, height);
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) back[i * 4 + c] = Math.round(back[i * 4 + c] * (1 - a) + front[i * 4 + c] * a);
  }
  return back;
}

/** The view, resized to the video. A view as large as the video is copied pixel for pixel. */
export function viewFrame(rgba: Buffer, sourceWidth: number, sourceHeight: number, view: View, width: number, height: number): Buffer {
  const out = Buffer.alloc(width * height * 4);
  if (Math.abs(view.width - width) < 1e-6 && Math.abs(view.height - height) < 1e-6) {
    const left = Math.round(view.x), top = Math.round(view.y);
    for (let y = 0; y < height; y++) rgba.copy(out, y * width * 4, ((top + y) * sourceWidth + left) * 4, ((top + y) * sourceWidth + left + width) * 4);
    return out;
  }
  const sx = view.width / width, sy = view.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(sourceHeight - 1, Math.max(0, view.y + (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sourceHeight - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(sourceWidth - 1, Math.max(0, view.x + (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sourceWidth - 1, x0 + 1), wx = fx - x0;
      const target = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = rgba[(y0 * sourceWidth + x0) * 4 + c] * (1 - wx) + rgba[(y0 * sourceWidth + x1) * 4 + c] * wx;
        const bottom = rgba[(y1 * sourceWidth + x0) * 4 + c] * (1 - wx) + rgba[(y1 * sourceWidth + x1) * 4 + c] * wx;
        out[target + c] = Math.round(top * (1 - wy) + bottom * wy);
      }
      out[target + 3] = 255;
    }
  }
  return out;
}

// ── Picking a part ─────────────────────────────────────────────────────────

/** A step to a neighboring pixel larger than this is an edge (a line, a different color). */
export const PICK_STEP = 12;
/** How far from the clicked color a part may drift through a gradient. */
export const PICK_RANGE = 90;

/**
 * The part around a clicked pixel, the way a cel-shaded drawing separates
 * its parts: grow while each step to a neighbor changes the color only a
 * little (following shading gradients) and stays within range of the
 * clicked color, never past `inside` (the character). Then close the small
 * gaps that thin lines inside the part leave. Null when the click isn't
 * inside. Pure.
 */
export function pickPart(rgb: Buffer, width: number, height: number, x: number, y: number, inside: Uint8Array | null): Uint8Array | null {
  const seed = y * width + x;
  if (x < 0 || y < 0 || x >= width || y >= height || (inside && inside[seed] < 128)) return null;
  const distance = (a: number, b: number) => Math.hypot(rgb[a * 3] - rgb[b * 3], rgb[a * 3 + 1] - rgb[b * 3 + 1], rgb[a * 3 + 2] - rgb[b * 3 + 2]);
  const picked = new Uint8Array(width * height);
  picked[seed] = 255;
  const stack = [seed];
  while (stack.length) {
    const index = stack.pop()!;
    const px = index % width;
    for (const next of [px > 0 ? index - 1 : -1, px < width - 1 ? index + 1 : -1, index - width, index + width]) {
      if (next < 0 || next >= picked.length || picked[next]) continue;
      if (inside && inside[next] < 128) continue;
      if (distance(next, index) > PICK_STEP || distance(next, seed) > PICK_RANGE) continue;
      picked[next] = 255;
      stack.push(next);
    }
  }
  // Closing: grow, then shrink back (grow the outside), so line-thin gaps fill and the outline stays.
  const radius = Math.max(2, Math.round(Math.max(width, height) * 0.002));
  const grown = growMask(picked, width, height, radius);
  const outside = growMask(grown.map((value) => (value >= 128 ? 0 : 255)), width, height, radius);
  const closed = new Uint8Array(width * height);
  for (let i = 0; i < closed.length; i++) closed[i] = outside[i] < 128 && (!inside || inside[i] >= 128) ? 255 : 0;
  return closed;
}
