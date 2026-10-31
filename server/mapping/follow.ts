import { angleOf, norm, type Vec } from "./geometry";
import { wrap, ROOTS } from "./interpolate";
import { BONES, JOINT_NAMES, fromNormal, normalFrame, toNormal, type Frame, type Joint, type JointName, type Skeleton } from "./skeleton";

// A character's pose following a video. `key` is the character as drawn at
// one moment (its own skeleton), `sourceKey` the video's person at that same
// moment and `sourceNow` the video's person at the moment wanted. The
// character takes the video's *change* since the key, not the video's pose:
// every bone turns by what the same bone turned in the video, the figure
// moves by what the person moved (in character torsos), and a bone the camera
// sees shorter or longer is shortened or lengthened by the same share. What
// the key drawing got only approximately right stays the character's.

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

const bonePoints = (s: Skeleton, from: JointName, to: JointName) => (s[from] && s[to] ? ([s[from]!.p, s[to]!.p] as const) : null);

/** A bone's screen angle and length in torsos, or null when either end is missing. */
const read = (s: Skeleton, f: Frame, from: JointName, to: JointName) => {
  const points = bonePoints(s, from, to);
  if (!points) return null;
  const v: Vec = [points[1][0] - points[0][0], points[1][1] - points[0][1]];
  return { angle: angleOf(v), length: norm(v) / f.unit };
};

export function followSkeleton(key: Skeleton, sourceKey: Skeleton, sourceNow: Skeleton): Skeleton | null {
  const [fk, fa, fb] = [normalFrame(key), normalFrame(sourceKey), normalFrame(sourceNow)];
  if (!fk || !fa || !fb || !key.pelvis || !sourceKey.pelvis || !sourceNow.pelvis) return null;
  // The person's travel in the video, in torsos, is the character's travel in its own.
  const move: Vec = [(sourceNow.pelvis.p[0] - sourceKey.pelvis.p[0]) / fa.unit * fk.unit, (sourceNow.pelvis.p[1] - sourceKey.pelvis.p[1]) / fa.unit * fk.unit];
  const frame: Frame = {
    origin: [fk.origin[0] + move[0], fk.origin[1] + move[1]],
    unit: fk.unit * clamp(fb.unit / fa.unit, 0.7, 1.3),
    angle: fk.angle + wrap(fb.angle - fa.angle),
  };
  const out: Record<JointName, Joint | null> = Object.fromEntries(JOINT_NAMES.map((name) => [name, null])) as never;
  const score = (name: JointName) => key[name]?.score ?? 1;
  out.pelvis = { p: frame.origin, score: score("pelvis") };
  out.neck = { p: fromNormal(frame, [0, 1]), score: score("neck") };

  // Shoulders and hips ride in the torso; a turn of the body narrows them by the share the video's narrowed.
  const width = (s: Skeleton, f: Frame, left: JointName, right: JointName) => (s[left] && s[right] ? Math.abs(toNormal(f, s[left]!.p)[0] - toNormal(f, s[right]!.p)[0]) : null);
  const narrowing = (left: JointName, right: JointName) => {
    const [before, now] = [width(sourceKey, fa, left, right), width(sourceNow, fb, left, right)];
    return before && now ? clamp(now / before, 0.3, 1.5) : 1;
  };
  for (const name of ROOTS) {
    if (!key[name]) continue;
    const q = toNormal(fk, key[name]!.p);
    const factor = name.endsWith("Shoulder") ? narrowing("leftShoulder", "rightShoulder") : narrowing("leftHip", "rightHip");
    out[name] = { p: fromNormal(frame, [q[0] * factor, q[1]]), score: score(name) };
  }

  const heading = new Map<string, number>([["torso", angleOf([out.neck.p[0] - out.pelvis.p[0], out.neck.p[1] - out.pelvis.p[1]])]]);
  for (const def of BONES) {
    if (def.parent === null) continue;
    const from = out[def.from as JointName];
    const parentHeading = heading.get(def.parent);
    if (!from || parentHeading === undefined) continue;
    const parent = BONES.find((bone) => bone.name === def.parent)!;
    const [kb, kp] = [read(key, fk, def.from as JointName, def.to as JointName), read(key, fk, parent.from as JointName, parent.to as JointName)];
    if (!kb || !kp) continue;
    const [ab, ap, bb, bp] = [read(sourceKey, fa, def.from as JointName, def.to as JointName), read(sourceKey, fa, parent.from as JointName, parent.to as JointName), read(sourceNow, fb, def.from as JointName, def.to as JointName), read(sourceNow, fb, parent.from as JointName, parent.to as JointName)];
    const seen = ab && ap && bb && bp;
    const relative = wrap(kb.angle - kp.angle) + (seen ? wrap(wrap(bb.angle - bp.angle) - wrap(ab.angle - ap.angle)) : 0);
    const length = kb.length * (seen && ab.length > 0.05 ? clamp(bb.length / ab.length, 0.4, 1.3) : 1);
    const angle = parentHeading + relative;
    heading.set(def.name, angle);
    out[def.to as JointName] = { p: [from.p[0] + Math.cos(angle) * length * frame.unit, from.p[1] + Math.sin(angle) * length * frame.unit], score: score(def.to as JointName) };
  }
  return out;
}
