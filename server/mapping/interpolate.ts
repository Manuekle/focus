import { angleOf, lerp, norm, type Vec } from "./geometry";
import { BONES, JOINT_NAMES, fromNormal, normalFrame, toNormal, type Frame, type Joint, type JointName, type Skeleton } from "./skeleton";

// A pose between two poses of the same character. Joints are not lerped
// point by point (an arm swinging through 90° would shrink at the middle):
// the torso frame is lerped, the shoulders and hips ride in it, and every
// other bone takes the angle to its parent bone and the length (in torsos)
// that the two keys give it, lerped the short way round. Easing is the
// caller's: `t` is already the position along the move.

const TAU = Math.PI * 2;

/** An angle brought into (−π, π]. */
export const wrap = (angle: number): number => {
  const a = ((angle % TAU) + TAU) % TAU;
  return a > Math.PI ? a - TAU : a;
};

/** The way round that is shorter: a + t · wrap(b − a). */
const lerpAngle = (a: number, b: number, t: number): number => a + wrap(b - a) * t;

const lerpNumber = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Joints no bone ends at: they ride in the torso's frame (the torso's four corners). */
export const ROOTS: readonly JointName[] = JOINT_NAMES.filter((name) => !BONES.some((bone) => bone.to === name) && name !== "pelvis");

const both = <T>(a: T | null, b: T | null, mix: (a: T, b: T) => T): T | null => (a && b ? mix(a, b) : (a ?? b));

/**
 * The skeleton `t` of the way from `a` to `b` (0 is `a`, 1 is `b`). Null when
 * either key has no torso: nothing to hang a pose on.
 */
export function interpolateSkeleton(a: Skeleton, b: Skeleton, t: number): Skeleton | null {
  const [fa, fb] = [normalFrame(a), normalFrame(b)];
  if (!fa || !fb) return null;
  const frame: Frame = {
    origin: lerp(fa.origin, fb.origin, t),
    unit: lerpNumber(fa.unit, fb.unit, t),
    angle: lerpAngle(fa.angle, fb.angle, t),
  };
  const out: Record<JointName, Joint | null> = Object.fromEntries(JOINT_NAMES.map((name) => [name, null])) as never;
  const score = (name: JointName) => Math.min(a[name]?.score ?? 1, b[name]?.score ?? 1);

  out.pelvis = { p: frame.origin, score: score("pelvis") };
  out.neck = { p: fromNormal(frame, [0, 1]), score: score("neck") };
  for (const name of ROOTS) {
    const q = both<Vec>(a[name] ? toNormal(fa, a[name]!.p) : null, b[name] ? toNormal(fb, b[name]!.p) : null, (x, y) => lerp(x, y, t));
    if (q) out[name] = { p: fromNormal(frame, q), score: score(name) };
  }

  // Screen angle of each placed bone, so a child can hang on its parent.
  const heading = new Map<string, number>([["torso", angleOf([out.neck.p[0] - out.pelvis.p[0], out.neck.p[1] - out.pelvis.p[1]])]]);
  for (const def of BONES) {
    if (def.parent === null) continue;
    const from = out[def.from as JointName];
    const parent = heading.get(def.parent);
    if (!from || parent === undefined) continue;
    const reading = (s: Skeleton, f: Frame) => {
      const [p, q] = [s[def.from as JointName], s[def.to as JointName]];
      const parentBone = BONES.find((bone) => bone.name === def.parent)!;
      const [pp, pq] = [s[parentBone.from as JointName], s[parentBone.to as JointName]];
      if (!p || !q || !pp || !pq) return null;
      const length = norm([q.p[0] - p.p[0], q.p[1] - p.p[1]]) / f.unit;
      const relative = wrap(angleOf([q.p[0] - p.p[0], q.p[1] - p.p[1]]) - angleOf([pq.p[0] - pp.p[0], pq.p[1] - pp.p[1]]));
      return { length, relative };
    };
    const [ra, rb] = [reading(a, fa), reading(b, fb)];
    const read = both(ra, rb, (x, y) => ({ length: lerpNumber(x.length, y.length, t), relative: lerpAngle(x.relative, y.relative, t) }));
    if (!read) continue;
    const angle = parent + read.relative;
    const length = read.length * frame.unit;
    heading.set(def.name, angle);
    out[def.to as JointName] = { p: [from.p[0] + Math.cos(angle) * length, from.p[1] + Math.sin(angle) * length], score: score(def.to as JointName) };
  }
  return out;
}

/** The largest turn of any bone against its parent between two keys, in degrees: how far apart the poses are. */
export function largestTurn(a: Skeleton, b: Skeleton): number {
  let worst = 0;
  for (const def of BONES) {
    if (def.parent === null) continue;
    const parentBone = BONES.find((bone) => bone.name === def.parent)!;
    const relative = (s: Skeleton) => {
      const [p, q, pp, pq] = [s[def.from as JointName], s[def.to as JointName], s[parentBone.from as JointName], s[parentBone.to as JointName]];
      return p && q && pp && pq ? wrap(angleOf([q.p[0] - p.p[0], q.p[1] - p.p[1]]) - angleOf([pq.p[0] - pp.p[0], pq.p[1] - pp.p[1]])) : null;
    };
    const [x, y] = [relative(a), relative(b)];
    if (x !== null && y !== null) worst = Math.max(worst, (Math.abs(wrap(y - x)) * 180) / Math.PI);
  }
  return worst;
}
