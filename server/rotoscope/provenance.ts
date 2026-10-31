import { createHash } from "node:crypto";
import type { ImageReference } from "../animation/muse-image";
import type { Crop } from "./extract";
import type { Pose } from "./pose-match";

// Where every input of a drawing comes from. A drawing has three sources that must never stand
// in for one another:
//   A — the video frame: motion and geometry only (PoseSource);
//   B — the character sheet: look, design and proportions (CharacterIdentity);
//   C — what a generator drew (GeneratedFrame).
// Each image sent to a generator is recorded with its hash and the entity it belongs to
// (GenerationTarget), and assertIsolation refuses a request where B's bytes aren't the run's
// character, A is missing, or an earlier output takes the place of A or B.

export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** canvas = source × scale + (x, y): one transform per clip (pipeline.ts clipLayout). */
export type Layout = { readonly scale: number; readonly x: number; readonly y: number };
export type Point = readonly [number, number];

export type PoseSource = {
  readonly kind: "pose-source";
  readonly frame: number;
  /** The extracted frame, relative to the run folder. */
  readonly file: string;
  readonly sha256: string;
  /** Where the frame sits in the original video: video = frame + (crop.x, crop.y). Null: uncropped. */
  readonly crop: Crop | null;
  /** Frame pixels → canvas pixels. */
  readonly layout: Layout;
};

export type CharacterIdentity = {
  readonly kind: "character-identity";
  readonly file: string;
  readonly sha256: string;
};

/** A: the video. B: the character. A+B: the video's pose drawn on the character's proportions. C: an earlier output. */
export type Entity = "A" | "B" | "A+B" | "C" | "aid";

export type ReferenceRecord = {
  /** 1-based, as the prompt names it ("Image 2"). */
  readonly position: number;
  readonly entity: Entity;
  /** The role's first words, enough to tell which reference it is. */
  readonly role: string;
  /** The reference's own bytes: what identity and substitution are checked on. */
  readonly sha256: string;
  /** The bytes this reference was rescaled from (the character sheet at the video person's size): what identity is checked on. */
  readonly of?: string;
  /** The bytes actually sent, when the request resized them (muse-image.ts keeps references ≤ 1024 px). */
  readonly sent?: string;
};

export type GenerationTarget = {
  readonly kind: "generation-target";
  readonly frame: number;
  readonly attempt: number;
  readonly pose: PoseSource;
  readonly identity: CharacterIdentity;
  readonly references: readonly ReferenceRecord[];
};

export type GeneratedFrame = {
  readonly kind: "generated-frame";
  readonly frame: number;
  readonly attempt: number;
  readonly generator: string;
  readonly sha256: string;
  /** sha256 of the GenerationTarget it was drawn from. */
  readonly target: string;
};

/** The roles framePrompt, swapFramePrompt and healFrame give their references (draw.ts), by their opening words. */
const ROLES: readonly (readonly [string, Entity])[] = [
  ["REFERENCE A, THE CHARACTER", "B"],
  ["REFERENCE C, THE TARGET POSE", "A"],
  ["THE CHARACTER", "B"],
  ["THE POSE", "A+B"],
  ["THE VIDEO FRAME", "A"],
  ["THE PREVIOUS FRAME", "C"],
  ["THE STYLE ANCHOR", "C"],
  ["AN EARLIER DRAWING", "C"],
  ["THE DRAWING TO EDIT", "C"],
  ["THE COLOUR PALETTE", "aid"],
];

export function entityOf(role: string): Entity {
  const found = ROLES.find(([prefix]) => role.startsWith(prefix));
  if (!found) throw new ProvenanceError(`reference with an unknown role: "${role.slice(0, 60)}"`);
  return found[1];
}

export class ProvenanceError extends Error {
  override readonly name = "ProvenanceError";
}

export function recordReferences(references: readonly ImageReference[]): ReferenceRecord[] {
  return references.map((reference, i) => ({ position: i + 1, entity: entityOf(reference.role), role: reference.role.split(/[.:]/)[0].slice(0, 60), sha256: sha256(reference.png), ...(reference.derivedFrom ? { of: sha256(reference.derivedFrom) } : {}) }));
}

/**
 * Refuses a generation whose references mix the entities up: Image 1 must be the run's character
 * (byte for byte), the video's frame or pose must be there, and no reference that stands for A or
 * B may be the bytes of an earlier output (`outputs`: hashes of drawings this run made).
 */
/** Each reference's record with the hash of the bytes a request body carries for it (data URLs, in order). */
export function withSentBytes(records: readonly ReferenceRecord[], body: unknown): ReferenceRecord[] {
  const urls: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (key === "image_url" && typeof inner === "string" && inner.startsWith("data:")) urls.push(inner);
        else walk(inner);
      }
    }
  };
  walk(body);
  if (urls.length !== records.length) throw new ProvenanceError(`the request carries ${urls.length} images for ${records.length} references`);
  return records.map((record, i) => {
    const sent = sha256(Buffer.from(urls[i].slice(urls[i].indexOf(",") + 1), "base64"));
    return sent === record.sha256 ? record : { ...record, sent };
  });
}

export function assertIsolation(target: GenerationTarget, outputs: ReadonlySet<string> = new Set()): void {
  // The character is the run's own, byte for byte, wherever the request puts it (an edit of the video frame sends that first).
  const character = target.references.find((reference) => reference.entity === "B");
  if (!character) throw new ProvenanceError(`frame ${target.frame}: the request has no character sheet`);
  const origin = character.of ?? character.sha256;
  if (origin !== target.identity.sha256) throw new ProvenanceError(`frame ${target.frame}: the character image sent (${origin.slice(0, 12)}) is not the run's character (${target.identity.sha256.slice(0, 12)})`);
  if (!target.references.some((reference) => reference.entity === "A" || reference.entity === "A+B")) throw new ProvenanceError(`frame ${target.frame}: no reference carries the video's pose`);
  for (const reference of target.references) {
    if ((reference.entity === "A" || reference.entity === "B" || reference.entity === "A+B") && (outputs.has(reference.sha256) || (reference.of !== undefined && outputs.has(reference.of)))) {
      throw new ProvenanceError(`frame ${target.frame}: Image ${reference.position} (${reference.role}) is an earlier output, not the ${reference.entity === "B" ? "character" : "video"}`);
    }
  }
}

// Coordinate systems. Frame pixels are the extracted, cropped frame (DWPose works on them);
// video pixels are the original video; canvas pixels are the 1024×1536 drawing.

export const frameToVideo = (p: Point, crop: Crop | null): Point => (crop ? [p[0] + crop.x, p[1] + crop.y] : p);
export const videoToFrame = (p: Point, crop: Crop | null): Point => (crop ? [p[0] - crop.x, p[1] - crop.y] : p);
export const frameToCanvas = (p: Point, layout: Layout): Point => [p[0] * layout.scale + layout.x, p[1] * layout.scale + layout.y];
export const canvasToFrame = (p: Point, layout: Layout): Point => [(p[0] - layout.x) / layout.scale, (p[1] - layout.y) / layout.scale];

/** The subject's own side. */
export type AnatomicalSide = "left" | "right";
/** The side of the image as the viewer sees it. */
export type ImageSide = "LEFT" | "RIGHT";
/** Toward the camera, away from it, or turned too far to the side to tell. */
export type Facing = "camera" | "away" | "profile";

/** COCO-WholeBody: 5/6 shoulders (subject's left/right), 0 nose, 1/2 eyes. */
export function facingOf(pose: Pose, profileShare = 0.25): Facing | null {
  const at = (i: number) => (pose.keypoints[i]?.[0] == null || pose.keypoints[i]?.[1] == null ? null : pose.keypoints[i] as Point);
  const [left, right, lh, rh] = [at(5), at(6), at(11), at(12)];
  if (!left || !right) return null;
  const torso = lh && rh ? Math.hypot((left[0] + right[0]) / 2 - (lh[0] + rh[0]) / 2, (left[1] + right[1]) / 2 - (lh[1] + rh[1]) / 2) : Math.hypot(right[0] - left[0], right[1] - left[1]) * 2;
  // Shoulders nearly on top of each other: a profile, where left and right can't be read off their order.
  if (Math.abs(left[0] - right[0]) < profileShare * torso) return "profile";
  // Facing the camera, the subject's right shoulder is on the viewer's left.
  return right[0] < left[0] ? "camera" : "away";
}

/** Which side of the image a limb of the subject's `side` is on. Null in profile: the order can't tell. */
export function imageSideOf(side: AnatomicalSide, facing: Facing): ImageSide | null {
  if (facing === "profile") return null;
  return (side === "right") === (facing === "camera") ? "LEFT" : "RIGHT";
}
