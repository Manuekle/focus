import type { Pose } from "../rotoscope/pose-match";
import { angleOf, dist, norm, percentile, signedAngle, sub, unit, type Vec } from "./geometry";
import { BONES, boneLength, boneVector, skeletonFromPose, torsoLength, type BoneName, type Joint, type JointName, type Skeleton } from "./skeleton";

// Source pose → target skeleton in the character's space. Where the figure
// stands, how big it is and how its torso turns come from the run's pose
// guide (the source already placed on the character's proportions and laid
// out on the canvas). Each limb then takes the source's direction, the
// character's own length (from the mapping profile) and the source's
// foreshortening (how short the bone looks now against its full length in
// the clip). The result also carries every joint's rotation.

export type FullLengths = Partial<Record<BoneName, number>>;

/**
 * How long each source bone is, in source torso lengths, when it isn't
 * foreshortened: the 90th percentile of its look across the clip.
 */
export function sourceFullLengths(frames: readonly Pose[]): FullLengths {
  const out: FullLengths = {};
  const skeletons = frames.map((frame) => skeletonFromPose(frame));
  for (const def of BONES) {
    const ratios = skeletons.flatMap((s) => {
      const [length, torso] = [boneLength(s, def.name), torsoLength(s)];
      return length && torso ? [length / torso] : [];
    });
    if (ratios.length) out[def.name] = percentile(ratios, 0.9);
  }
  return out;
}

export type JointRotation = {
  readonly bone: BoneName;
  /** Screen angle of the bone, degrees (0 = pointing right, 90 = down). */
  readonly absolute: number;
  /** Angle against the parent bone, degrees; null for the torso. */
  readonly local: number | null;
  /** Shown length over full length: 1 = seen side-on, small = pointing at the camera. */
  readonly shortening: number;
};

export type Target = {
  readonly skeleton: Skeleton;
  readonly rotations: readonly JointRotation[];
  /** Bones the source frame doesn't show: kept from the guide, or left to follow their parent. */
  readonly unseen: readonly BoneName[];
};

const deg = (radians: number) => Math.round(((radians * 180) / Math.PI) * 10) / 10;

/**
 * `source` is the (stabilized) source pose; `guide` the same frame's guide on
 * the canvas; `character` the character's full bone lengths in torso lengths;
 * `sourceFull` the source's (sourceFullLengths). Joint overrides (a person's
 * correction in the inspector) replace the computed joints last.
 */
export function retarget(input: {
  readonly source: Pose;
  readonly guide: Pose;
  readonly character: FullLengths;
  readonly sourceFull: FullLengths;
  readonly overrides?: Partial<Record<JointName, Vec>>;
}): Target {
  const source = skeletonFromPose(input.source);
  const guide = skeletonFromPose(input.guide);
  const targetTorso = torsoLength(guide);
  if (!targetTorso || !guide.pelvis || !guide.neck) throw new Error("retarget: the guide has no torso");
  const sourceTorso = torsoLength(source);
  const joints: Record<JointName, Joint | null> = { ...guide };
  const unseen: BoneName[] = [];
  for (const def of BONES) {
    if (def.name === "torso" || def.name === "head") continue;
    const from = joints[def.from as JointName];
    const direction = boneVector(source, def.name);
    const ratio = input.character[def.name];
    const full = input.sourceFull[def.name];
    if (!from || !direction || !ratio || !full || !sourceTorso) {
      // The guide still places what the source can't show clearly; the deformer keeps it attached.
      if (!direction) unseen.push(def.name);
      continue;
    }
    const shortening = Math.max(0.12, Math.min(1, norm(direction) / sourceTorso / full));
    const d = unit(direction);
    // The guide's length when it has the bone: the firewall's proportions check measures against it.
    const length = boneLength(guide, def.name) ?? ratio * targetTorso * shortening;
    const score = Math.min(source[def.from as JointName]?.score ?? 0, source[def.to as JointName]?.score ?? 0);
    joints[def.to as JointName] = { p: [from.p[0] + d[0] * length, from.p[1] + d[1] * length], score };
  }
  for (const [name, p] of Object.entries(input.overrides ?? {}) as [JointName, Vec][]) {
    joints[name] = { p, score: Math.max(1, joints[name]?.score ?? 1) };
  }
  const skeleton = joints as Skeleton;
  return { skeleton, rotations: rotationsOf(skeleton, source, input.sourceFull), unseen };
}

/** Every bone's screen angle, angle to its parent and the source's foreshortening of it. */
function rotationsOf(skeleton: Skeleton, source: Skeleton, sourceFull: FullLengths): JointRotation[] {
  const sourceTorso = torsoLength(source);
  const rotations: JointRotation[] = [];
  for (const def of BONES) {
    const v = boneVector(skeleton, def.name);
    if (!v) continue;
    const parent = def.parent ? boneVector(skeleton, def.parent as BoneName) : null;
    const sv = boneVector(source, def.name);
    const full = sourceFull[def.name];
    rotations.push({
      bone: def.name,
      absolute: deg(angleOf(v)),
      local: parent ? deg(signedAngle(parent, v)) : null,
      shortening: sv && full && sourceTorso ? Math.round(Math.min(1, norm(sv) / sourceTorso / full) * 100) / 100 : 1,
    });
  }
  return rotations;
}

const rotate = (v: Vec, theta: number): Vec => [v[0] * Math.cos(theta) - v[1] * Math.sin(theta), v[0] * Math.sin(theta) + v[1] * Math.cos(theta)];

/**
 * The target pose in the base drawing's own skeleton, for a drawing deformed into the next frame (straight ahead or
 * pose to pose from an approved frame). retarget places the figure by the pose guide, whose joints are the video
 * person's: their hips, their limb proportions. A drawing's joints are where the estimator finds them on the drawing
 * (hips under a skirt sit higher than a person's), so deforming it onto the guide stretches its torso and limbs to fit
 * someone else's build. Here nothing of the person's build is used, only their motion:
 *
 *   - the torso turns and grows as the person's torso did from the base's frame to this one, and moves as their
 *     pelvis moved (in the drawing's pixels);
 *   - every limb points where the person's limb points now (absolute, so a base drawn a little off is not carried
 *     forward), at the character's own full length times the person's foreshortening now;
 *   - the head keeps its drawn length and turns as the person's head turned.
 *
 * `sourceBase` is the person in the base drawing's frame; `character` the character's full bone lengths in torso
 * lengths, as measured on its drawings (characterFullLengths: the same estimator, so the same convention).
 */
export function followDrawing(input: {
  readonly base: Skeleton;
  readonly sourceBase: Pose;
  readonly source: Pose;
  readonly character: FullLengths;
  readonly sourceFull: FullLengths;
  readonly overrides?: Partial<Record<JointName, Vec>>;
}): Target {
  const { base } = input;
  const [before, now] = [skeletonFromPose(input.sourceBase), skeletonFromPose(input.source)];
  const [drawnTorso, torsoBefore, torsoNow] = [torsoLength(base), torsoLength(before), torsoLength(now)];
  if (!drawnTorso || !torsoBefore || !torsoNow || !base.pelvis || !base.neck || !before.pelvis || !before.neck || !now.pelvis || !now.neck) {
    throw new Error("followDrawing: no torso to follow in the drawing or the video");
  }
  const pixels = drawnTorso / torsoBefore;
  const grow = torsoNow / torsoBefore;
  const turn = angleOf(sub(now.neck.p, now.pelvis.p)) - angleOf(sub(before.neck.p, before.pelvis.p));
  const pelvis: Vec = [base.pelvis.p[0] + (now.pelvis.p[0] - before.pelvis.p[0]) * pixels, base.pelvis.p[1] + (now.pelvis.p[1] - before.pelvis.p[1]) * pixels];
  const carry = (p: Vec): Vec => {
    const r = rotate(sub(p, base.pelvis!.p), turn);
    return [pelvis[0] + r[0] * grow, pelvis[1] + r[1] * grow];
  };
  const joints: Record<JointName, Joint | null> = { ...base };
  // The torso as drawn, carried: its corners keep the drawing's own build.
  for (const name of ["pelvis", "neck", "leftShoulder", "rightShoulder", "leftHip", "rightHip"] as const) {
    const joint = base[name];
    joints[name] = joint ? { p: carry(joint.p), score: Math.min(joint.score, now[name]?.score ?? joint.score) } : null;
  }
  // The head keeps its drawn length and turns as the person's head turned (absolute angles differ: a drawn face isn't a person's).
  const [headBefore, headNow, drawnHead] = [boneVector(before, "head"), boneVector(now, "head"), boneVector(base, "head")];
  if (drawnHead && joints.neck) {
    const theta = headBefore && headNow ? angleOf(headNow) - angleOf(headBefore) : turn;
    const v = rotate(drawnHead, theta);
    joints.head = { p: [joints.neck.p[0] + v[0] * grow, joints.neck.p[1] + v[1] * grow], score: base.head?.score ?? 1 };
  }
  const unseen: BoneName[] = [];
  const targetTorso = drawnTorso * grow;
  for (const def of BONES) {
    if (def.name === "torso" || def.name === "head") continue;
    const from = joints[def.from as JointName];
    const drawn = boneVector(base, def.name);
    if (!from) continue;
    const direction = boneVector(now, def.name);
    const full = input.sourceFull[def.name];
    const ratio = input.character[def.name];
    // The character's full length when its drawings measured one, else the bone as this drawing has it.
    const length = ratio ? ratio * targetTorso : drawn ? norm(drawn) * grow : null;
    if (!direction || !length) {
      // The person doesn't show it clearly: the bone keeps its drawn angle, turned with the body.
      if (!direction) unseen.push(def.name);
      if (drawn) {
        const v = rotate(drawn, turn);
        joints[def.to as JointName] = { p: [from.p[0] + v[0] * grow, from.p[1] + v[1] * grow], score: base[def.to as JointName]?.score ?? 0.5 };
      }
      continue;
    }
    // Without the clip's full length of this bone its foreshortening is unknown: drawn at full length.
    const shortening = full ? Math.max(0.12, Math.min(1, norm(direction) / torsoNow / full)) : 1;
    const d = unit(direction);
    const score = Math.min(now[def.from as JointName]?.score ?? 0, now[def.to as JointName]?.score ?? 0);
    joints[def.to as JointName] = { p: [from.p[0] + d[0] * length * shortening, from.p[1] + d[1] * length * shortening], score };
  }
  for (const [name, p] of Object.entries(input.overrides ?? {}) as [JointName, Vec][]) {
    joints[name] = { p, score: Math.max(1, joints[name]?.score ?? 1) };
  }
  const skeleton = joints as Skeleton;
  return { skeleton, rotations: rotationsOf(skeleton, now, input.sourceFull), unseen };
}

/** Per-joint distance between two skeletons, in torso lengths of `reference`. */
export function jointErrors(reference: Skeleton, other: Skeleton): Partial<Record<JointName, number>> {
  const torso = torsoLength(reference) ?? 1;
  const out: Partial<Record<JointName, number>> = {};
  for (const name of Object.keys(reference) as JointName[]) {
    const [a, b] = [reference[name], other[name]];
    if (a && b) out[name] = Math.round((dist(a.p, b.p) / torso) * 1000) / 1000;
  }
  return out;
}

/** Per-bone direction error in degrees between two skeletons. */
export function boneAngleErrors(reference: Skeleton, other: Skeleton): Partial<Record<BoneName, number>> {
  const out: Partial<Record<BoneName, number>> = {};
  for (const def of BONES) {
    const [a, b] = [boneVector(reference, def.name), boneVector(other, def.name)];
    if (!a || !b || norm(a) < 1 || norm(b) < 1) continue;
    out[def.name] = Math.round(Math.abs(deg(signedAngle(a, b))));
  }
  return out;
}

