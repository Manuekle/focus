// Plane geometry for the character mapping engine: points, segments and 2D
// affine transforms. An affine [a, b, c, d, e, f] maps (x, y) to
// (a·x + b·y + c, d·x + e·y + f).

export type Vec = readonly [number, number];
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0];
export const norm = (a: Vec) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const angleOf = (v: Vec) => Math.atan2(v[1], v[0]);

export function unit(v: Vec): Vec {
  const n = norm(v);
  return n > 1e-9 ? [v[0] / n, v[1] / n] : [0, 0];
}

/** Smallest absolute difference between two angles, in degrees (0–180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) * 180) / Math.PI) % 360;
  return d > 180 ? 360 - d : d;
}

/** Signed angle from a to b in radians, in (−π, π]. */
export function signedAngle(a: Vec, b: Vec): number {
  return Math.atan2(cross(a, b), dot(a, b));
}

/** Distance from p to the segment a–b, and where along it (0 at a, 1 at b) the closest point lies. */
export function segmentDistance(p: Vec, a: Vec, b: Vec): { distance: number; t: number } {
  const ab = sub(b, a);
  const length2 = dot(ab, ab);
  const t = length2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / length2)) : 0;
  return { distance: dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]), t };
}

export function apply(m: Affine, p: Vec): Vec {
  return [m[0] * p[0] + m[1] * p[1] + m[2], m[3] * p[0] + m[4] * p[1] + m[5]];
}

/** a ∘ b: apply b first, then a. */
export function compose(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[1] * b[3], a[0] * b[1] + a[1] * b[4], a[0] * b[2] + a[1] * b[5] + a[2],
    a[3] * b[0] + a[4] * b[3], a[3] * b[1] + a[4] * b[4], a[3] * b[2] + a[4] * b[5] + a[5],
  ];
}

export function invert(m: Affine): Affine | null {
  const det = m[0] * m[4] - m[1] * m[3];
  if (Math.abs(det) < 1e-12) return null;
  const [a, b, c, d, e, f] = [m[4] / det, -m[1] / det, 0, -m[3] / det, m[0] / det, 0];
  return [a, b, -(a * m[2] + b * m[5]) + c, d, e, -(d * m[2] + e * m[5]) + f];
}

export const translation = (v: Vec): Affine => [1, 0, v[0], 0, 1, v[1]];
export const rotation = (theta: number): Affine => [Math.cos(theta), -Math.sin(theta), 0, Math.sin(theta), Math.cos(theta), 0];

/** Linear part determinant: how much the transform scales area. */
export const areaScale = (m: Affine) => m[0] * m[4] - m[1] * m[3];

/**
 * The transform that carries bone a→b onto a2→b2: it rotates the bone onto
 * the new direction and stretches it along its own axis only, so a limb keeps
 * its width (volume) while it lengthens or foreshortens. `stretch` overrides
 * the along-axis factor (clamped by the caller); `width` is the across factor,
 * the overall size change.
 */
export function boneTransform(a: Vec, b: Vec, a2: Vec, b2: Vec, stretch?: number, width = 1): Affine {
  const from = angleOf(sub(b, a));
  const to = angleOf(sub(b2, a2));
  const s = stretch ?? norm(sub(b2, a2)) / Math.max(1e-6, norm(sub(b, a)));
  const along: Affine = [s, 0, 0, 0, width, 0];
  return compose(translation(a2), compose(rotation(to), compose(along, compose(rotation(-from), translation([-a[0], -a[1]])))));
}

/** Rotation plus uniform scale plus translation carrying a→a2 and turning a→b onto a2→b2 (b2 only for direction unless `uniform`). */
export function similarity(a: Vec, b: Vec, a2: Vec, b2: Vec, uniform = 1): Affine {
  const theta = angleOf(sub(b2, a2)) - angleOf(sub(b, a));
  return compose(translation(a2), compose(rotation(theta), compose([uniform, 0, 0, 0, uniform, 0], translation([-a[0], -a[1]]))));
}

/** Least-squares affine from ≥3 point pairs; null when they are collinear. */
export function fitAffine(source: readonly Vec[], target: readonly Vec[]): Affine | null {
  const n = Math.min(source.length, target.length);
  if (n < 3) return null;
  // Normal equations for [a b c] and [d e f] share the same 3×3 matrix.
  let [sxx, sxy, sx, syy, sy] = [0, 0, 0, 0, 0];
  let [tx, txx, txy, ty, tyx, tyy] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [x, y] = source[i];
    const [u, v] = target[i];
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
    txx += u * x; txy += u * y; tx += u;
    tyx += v * x; tyy += v * y; ty += v;
  }
  const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const solve = (r: readonly number[]): number[] | null => {
    const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if (Math.abs(det) < 1e-9) return null;
    const col = (k: number) => m.map((row, i) => row.map((value, j) => (j === k ? r[i] : value)));
    const d3 = (q: number[][]) => q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
    return [d3(col(0)) / det, d3(col(1)) / det, d3(col(2)) / det];
  };
  const first = solve([txx, txy, tx]);
  const second = solve([tyx, tyy, ty]);
  return first && second ? [first[0], first[1], first[2], second[0], second[1], second[2]] : null;
}

export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  const index = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * p));
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

export const median = (values: readonly number[]) => percentile(values, 0.5);
