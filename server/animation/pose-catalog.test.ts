import { describe, expect, it } from "vitest";
import { PoseIdSchema } from "../../shared/pose-library";
import { POSE_CATALOG, compatiblePoseId, poseCandidates, poseReferenceFor } from "./pose-catalog";

describe("complete internal pose catalog", () => {
  it("indexes all 288 poses and all 1,439 original images without inventing a missing angle", () => {
    expect(POSE_CATALOG.poseCount).toBe(288);
    expect(POSE_CATALOG.poses).toHaveLength(288);
    const images = POSE_CATALOG.poses.flatMap((pose) => pose.images);
    expect(images).toHaveLength(1439);
    expect(POSE_CATALOG.imageCount).toBe(images.length);
    expect(new Set(images.map((image) => image.id)).size).toBe(1439);
    for (const image of images) {
      expect(PoseIdSchema.safeParse(image.id).success).toBe(true);
      expect(poseReferenceFor(image.id).image.angle).toBe(image.angle);
    }
    expect(POSE_CATALOG.poses.filter((pose) => pose.images.length < 5)).toHaveLength(1);
    expect(PoseIdSchema.safeParse("full_sexy_P018_low").success).toBe(false);
  });

  it("uses one profile image per compatible posture and keeps the other angles indexed", () => {
    expect(poseCandidates()).toHaveLength(233);
    expect(poseCandidates().some((pose) => pose.body === "upper")).toBe(true);
    for (const candidate of poseCandidates()) {
      expect(compatiblePoseId(candidate.id)).toBe(candidate.id);
      expect(poseReferenceFor(candidate.id).subjects).toBe(1);
      expect(poseReferenceFor(candidate.id).image.angle).toBe("side");
    }
    expect(compatiblePoseId("full_single_P061_front")).toBe("full_single_P061_side");
    expect(compatiblePoseId("pair60_P001_side")).toBeUndefined();
    expect(compatiblePoseId("full_single_P041_side", "walk")).toBeUndefined();
    expect(compatiblePoseId("upper80v2_P001_side", "wave")).toBe("upper80v2_P001_side");
    expect(compatiblePoseId("full_single_P061_side", "jump")).toBe("full_single_P061_side");
    expect(compatiblePoseId("https://example.com/pose.png")).toBeUndefined();
  });
});
