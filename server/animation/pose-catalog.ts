import catalog from "./pose-catalog.json";
import { PoseIdSchema, type PoseId } from "../../shared/pose-library";
import type { AnimationAction } from "../../shared/flipbook";
import type { CameraView } from "../../shared/animation-view";

// Preserve the English geometry descriptions of already-saved pose loops.
const LEGACY_DESCRIPTIONS = [
  { id: "full_single_P015_side", label: "Hand on hip", description: "Standing with weight on one leg and one hand on the hip." },
  { id: "full_single_P018_side", label: "Hands on hips", description: "Standing with both hands resting on the hips." },
  { id: "full_single_P020_side", label: "Hand behind head", description: "Standing with one hand resting behind the head." },
  { id: "full_single_P022_side", label: "Arms behind back", description: "Standing with the arms behind the back and the chest open." },
  { id: "full_single_P001_side", label: "Lean back, knee up", description: "Seated, leaning back with one knee raised." },
  { id: "full_single_P003_side", label: "Hands behind", description: "Seated with both hands supporting the body from behind and the chest open." },
  { id: "full_single_P012_side", label: "Resting on a hand", description: "Seated with one knee raised and the cheek resting on one hand." },
  { id: "full_single_P041_side", label: "Legs folded", description: "Seated on folded legs with both hands resting on the thighs." },
  { id: "full_single_P061_side", label: "Hands on knees", description: "Crouching low with both hands resting on the knees." },
  { id: "full_single_P062_side", label: "Hand on the ground", description: "Crouching with one hand touching the ground for support." },
  { id: "full_single_P063_side", label: "Chin on a hand", description: "Crouching with the cheek resting on one hand." },
  { id: "full_single_P064_side", label: "Hand in hair", description: "Crouching with one hand resting in the hair." },
];



const images = new Map(catalog.poses.flatMap((pose) => pose.images.map((image) => [image.id, {
  ...pose,
  image,
  label: LEGACY_DESCRIPTIONS.find((entry) => entry.id === image.id)?.label ?? pose.name,
  description: LEGACY_DESCRIPTIONS.find((entry) => entry.id === image.id)?.description
    ?? `Keep the ${pose.body === "upper" ? "upper-body" : "full-body"} posture shown in the mannequin reference.`,
}] as const)));

export const POSE_CATALOG = catalog;

export function poseReferenceFor(id: PoseId) {
  const pose = images.get(id);
  if (!pose) throw new Error("Unknown pose reference");
  return pose;
}

/** Match the requested camera; never substitute a side guide for another view. */
export function compatiblePoseId(value: unknown, action: AnimationAction = "idle", view: CameraView = "side"): PoseId | undefined {
  const parsed = PoseIdSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const pose = poseReferenceFor(parsed.data);
  if (pose.subjects !== 1 || !fitsAction(pose, action)) return undefined;
  const angle = view === "three_quarter" ? "diag" : view;
  return pose.images.find((image) => image.angle === angle)?.id;
}

/** Compact data for the existing planner, with one entry per compatible
 * posture. Every angle stays indexed; the renderer's camera chooses the view. */
function fitsAction(pose: (typeof catalog.poses)[number], action: AnimationAction): boolean {
  return action === "idle" || pose.body === "upper" || pose.category === "立ち" || (action === "jump" && pose.category === "しゃがみ");
}

export function poseCandidates(action: AnimationAction = "idle", view: CameraView = "side") {
  return catalog.poses.filter((pose) => pose.subjects === 1 && fitsAction(pose, action)).flatMap((pose) => {
    const angle = view === "three_quarter" ? "diag" : view;
    const image = pose.images.find((image) => image.angle === angle);
    return image ? [{ id: image.id, body: pose.body, name: pose.name, category: pose.category }] : [];
  });
}
