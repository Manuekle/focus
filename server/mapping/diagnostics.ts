import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { PolicyOutcome } from "../policies/rules";
import type { JointRotation } from "./retarget";
import type { BoneName, JointName, Skeleton } from "./skeleton";
import { JOINT_NAMES } from "./skeleton";

// What the mapping engine stores for every attempt at a frame, whichever
// method drew it: the source keypoints, the character rig it deformed (if
// any), the masks, the target skeleton and the skeleton measured on the
// result, per-joint errors, silhouette alignment, missing and occluded
// joints, a character consistency score, the rendering method and every
// policy outcome. The overlay inspector reads these files; nothing in the
// firewall depends on them, so runs made before them still load.

export type RenderMethod = "rig-deform" | "rig-deform+muse-repair" | "muse-image" | "higgsfield";

export type JointMap = Partial<Record<JointName, readonly [number, number, number]>>;

export type FrameDiagnostics = {
  readonly version: 1;
  readonly frame: number;
  readonly attempt: number;
  readonly at: string;
  readonly method: RenderMethod;
  /** The drawing the frame was deformed from; null when a generator drew it from scratch. */
  readonly base: { readonly id: string; readonly index: number | null; readonly mode: string; readonly distance: number | null; readonly depth: number } | null;
  /** Source-frame pixels (stabilized), and what the stabilizer did to this frame. */
  readonly source: { readonly joints: JointMap; readonly raw: JointMap; readonly swapped: boolean; readonly occluded: readonly string[]; readonly bridged: readonly string[]; readonly offSubject: readonly string[] };
  /** The deformed drawing's rig joints, on the canvas. */
  readonly rig: { readonly joints: JointMap; readonly bones: readonly { name: BoneName; z: number }[] } | null;
  readonly masks: { readonly character: string | null; readonly segmentation: string; readonly subjectTracked: boolean; readonly exposed: string | null; readonly labels: string | null };
  /** Canvas pixels. */
  readonly target: { readonly joints: JointMap; readonly rotations: readonly JointRotation[]; readonly unseen: readonly BoneName[] };
  /** Measured on the finished drawing by the pose estimator; null when no body was found. */
  readonly generated: { readonly joints: JointMap; readonly estimator: string } | null;
  /** Generated vs target, in target torso lengths. */
  readonly jointError: Partial<Record<JointName, number>>;
  /** Generated vs target bone directions, degrees. */
  readonly boneError: Partial<Record<BoneName, number>>;
  readonly meanJointError: number | null;
  /** IoU of the drawing's silhouette with the one the rig predicts; null without a prediction. */
  readonly silhouette: number | null;
  readonly missing: readonly JointName[];
  readonly occluded: readonly string[];
  /** Colour palette overlap with the character sheet (0–1). */
  readonly consistency: number | null;
  readonly exposedArea: number;
  readonly repair: { readonly applied: boolean; readonly kept: boolean; readonly note: string } | null;
  readonly policies: readonly PolicyOutcome[];
};

export function jointMap(skeleton: Skeleton | null): JointMap {
  const out: Record<string, readonly [number, number, number]> = {};
  if (!skeleton) return out;
  for (const name of JOINT_NAMES) {
    const joint = skeleton[name];
    if (joint) out[name] = [Math.round(joint.p[0] * 10) / 10, Math.round(joint.p[1] * 10) / 10, Math.round(joint.score * 100) / 100];
  }
  return out;
}

export function skeletonFromMap(map: JointMap): Skeleton {
  return Object.fromEntries(JOINT_NAMES.map((name) => [name, map[name] ? { p: [map[name]![0], map[name]![1]], score: map[name]![2] } : null])) as unknown as Skeleton;
}

const stem = (frame: number, attempt: number) => `frame_${String(frame).padStart(4, "0")}_a${attempt}`;
export const diagnosticsFile = (frame: number, attempt: number) => `mapping/diagnostics/${stem(frame, attempt)}.json`;
export const exposedFile = (frame: number, attempt: number) => `mapping/diagnostics/${stem(frame, attempt)}_exposed.png`;

export async function writeDiagnostics(dir: string, record: FrameDiagnostics): Promise<void> {
  const file = path.join(dir, diagnosticsFile(record.frame, record.attempt));
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temp, file);
}

export async function readDiagnostics(dir: string, frame: number, attempt: number): Promise<FrameDiagnostics | null> {
  return readFile(path.join(dir, diagnosticsFile(frame, attempt)), "utf8").then((raw) => JSON.parse(raw) as FrameDiagnostics, () => null);
}
