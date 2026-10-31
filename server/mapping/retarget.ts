import type { Pose } from "../rotoscope/pose-match";
import { angleOf, dist, norm, percentile, signedAngle, unit, type Vec } from "./geometry";
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
  const rotations: JointRotation[] = [];
  for (const def of BONES) {
    const v = boneVector(skeleton, def.name);
    if (!v) continue;
    const parent = def.parent ? boneVector(skeleton, def.parent as BoneName) : null;
    const sv = boneVector(source, def.name);
    const full = input.sourceFull[def.name];
    rotations.push({
      bone: def.name,
      absolute: deg(angleOf(v)),
      local: parent ? deg(signedAngle(parent, v)) : null,
      shortening: sv && full && sourceTorso ? Math.round(Math.min(1, norm(sv) / sourceTorso / full) * 100) / 100 : 1,
    });
  }
  return { skeleton, rotations, unseen };
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

