import path from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { comparePoses, type Pose } from "../rotoscope/pose-match";
import fixture from "./__fixtures__/frame20.json";
import { measuredPose, renderFigure } from "./__fixtures__/figure";
import { deform } from "./deform";
import { fromAlpha } from "./mask";
import { poseToolAvailable } from "./pose-estimator";
import { retarget } from "./retarget";
import { buildRig } from "./rig";
import { skeletonFromPose } from "./skeleton";

// Regression: the frame 20 failure. In run 558b6cef (a 9 fps dance, 2026-10-30)
// Muse Image drew frame 20 six times and the firewall rejected all six on the
// pose check (upper arm 30–71° off, once mirrored); the run halted there. The
// keypoints below are the real ones: the approved frame 19 drawing, the source
// frame 20 and its guide. The character mapping engine deforms frame 19 onto
// frame 20's pose, and the same pose check must pass.

const pose = (p: { keypoints: (number | null)[][]; scores: number[] }): Pose => ({
  keypoints: [...p.keypoints, ...Array.from({ length: 133 - p.keypoints.length }, () => [null, null])] as unknown as Pose["keypoints"],
  scores: [...p.scores, ...new Array<number>(133 - p.scores.length).fill(0)],
});

describe("frame 20 regression", () => {
  const source = pose(fixture.source20);

  it("is the pose check that failed every Muse Image attempt", () => {
    const results = fixture.museAttempts.map((attempt) => comparePoses(source, pose(attempt)));
    expect(results.every((result) => !result.passed)).toBe(true);
    expect(results.some((result) => result.detail.startsWith("MIRRORED"))).toBe(true);
  });

  it("passes when frame 19 is deformed onto frame 20's pose (measured on the pixels)", () => {
    // The drawing of frame 19 as a synthetic figure on the same skeleton: every bone its own colour,
    // so the result's pose is measured from its pixels, not taken from the rig.
    const nineteen = skeletonFromPose(pose(fixture.drawing19));
    const image = renderFigure(nineteen, fixture.canvas);
    const rig = buildRig(image, fromAlpha(image), nineteen);
    const target = retarget({ source: pose(fixture.stabilized20), guide: pose(fixture.guide20), character: fixture.characterFull, sourceFull: fixture.sourceFull });
    const result = deform(image, rig, target.skeleton);
    const check = comparePoses(source, measuredPose(result.image));
    expect(check.passed, check.detail).toBe(true);
    expect(check.detail.startsWith("MIRRORED")).toBe(false);
    const leftUpperArm = check.bones.find((bone) => bone.name === "left upper arm");
    expect(leftUpperArm?.degrees).toBeLessThan(15);
    expect(result.stats.flipped).toBe(0);
    expect(result.plan.clamped).toEqual([]);
  });

  // The same scenario on the real run with the real pose estimator, when this machine has both
  // (local only: the run is user data under .focus-data and DWPose lives in the worker's venv).
  const run = path.join(process.cwd(), ".focus-data/rotoscope/558b6cef-0d0e-4404-9a49-9549a277e5a5");
  it.skipIf(!existsSync(path.join(run, "manifest.json")) || !poseToolAvailable())("passes on the real run with DWPose re-estimating the deformed drawing", async () => {
    const data = await mkdtemp(path.join(tmpdir(), "focus-frame20-"));
    const previous = { dir: process.env.FOCUS_DATA_DIR, sam: process.env.FOCUS_MAPPING_SAM };
    try {
      await cp(run, path.join(data, "rotoscope", "frame20"), { recursive: true, filter: (from) => !/[\\/](attempts|work|report|frames-backup-pre-anchor|mapping)([\\/]|$)/.test(from) });
      process.env.FOCUS_DATA_DIR = data;
      process.env.FOCUS_MAPPING_SAM = "off";
      const { mapPreview } = await import("../rotoscope/pipeline");
      const { pose: check } = await mapPreview(path.join(data, "rotoscope", "frame20"), 20);
      expect(check.passed, check.detail).toBe(true);
    } finally {
      process.env.FOCUS_DATA_DIR = previous.dir;
      if (previous.sam === undefined) delete process.env.FOCUS_MAPPING_SAM; else process.env.FOCUS_MAPPING_SAM = previous.sam;
      await rm(data, { recursive: true, force: true });
    }
  }, 180_000);
});
