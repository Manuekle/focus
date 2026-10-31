import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Rgba } from "../rotoscope/alpha";
import type { Manifest } from "../rotoscope/run-state";
import { measuredPose, renderFigure, standing } from "./__fixtures__/figure";
import { readDiagnostics, writeDiagnostics, type FrameDiagnostics } from "./diagnostics";
import { mapFrame, openMapping, writeOverrides } from "./engine";
import type { PoseEstimator } from "./pose-estimator";
import { localMask, samSegmenter, type Segmenter } from "./segmenter";
import { dist } from "./geometry";
import { mapSkeleton, poseFromSkeleton, type Skeleton } from "./skeleton";
import { sha256 } from "./profile";

const png = (image: Rgba) => sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer();
const CANVAS = { width: 1024, height: 1536 };

describe("character mapping engine on a run", () => {
  let dir = "";
  const calls = { estimator: 0, character: 0 };
  // The synthetic figure's pose, measured from its colours: stands in for DWPose without Python.
  const estimator: PoseEstimator = async (image, out) => {
    calls.estimator++;
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pose = measuredPose({ data, width: info.width, height: info.height });
    await writeFile(out, JSON.stringify({ width: info.width, height: info.height, frames: [pose] }));
    return pose;
  };
  const segmenter: Segmenter = { character: async (image) => { calls.character++; return localMask(image); }, regions: null, subject: null };
  const base = standing();
  const lifted = (s: Skeleton, dy: number): Skeleton => ({ ...s, leftElbow: { p: [s.leftElbow!.p[0] + 40, s.leftElbow!.p[1] - dy], score: 0.9 }, leftWrist: { p: [s.leftWrist!.p[0] + 90, s.leftWrist!.p[1] - dy * 2], score: 0.9 }, leftHand: null });
  const poses = [base, lifted(base, 40), lifted(base, 80)];
  let manifest: Manifest;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "focus-mapping-"));
    await mkdir(path.join(dir, "frames"), { recursive: true });
    await mkdir(path.join(dir, "source"), { recursive: true });
    // An opaque character sheet, smaller than the canvas, on a warm white backdrop.
    const sheet = await png(renderFigure(mapSkeleton(base, (p) => [p[0] * 0.75, p[1] * 0.75]), { width: 768, height: 1152 }, [250, 247, 240]));
    await writeFile(path.join(dir, "character.png"), sheet);
    const first = await png(renderFigure(base));
    await writeFile(path.join(dir, "frames/frame_0001.png"), first);
    // The source subject: same poses, another place and size in the video frame.
    const toSource = (s: Skeleton) => mapSkeleton(s, (p) => [p[0] * 0.8 + 20, p[1] * 0.8 + 10]);
    await writeFile(path.join(dir, "source-poses.json"), JSON.stringify({ width: 828, height: 1472, frames: poses.map((s) => poseFromSkeleton(toSource(s))) }));
    manifest = {
      version: 1, createdAt: new Date().toISOString(), video: "clip.mp4", fps: 9, start: 0, seconds: 1, crop: null,
      character: { file: "character.png", sha256: sha256(sheet) }, maxAttempts: 3,
      frames: [
        { index: 1, source: "source/frame_0001.png", status: "approved", attempts: [{ attempt: 1, at: "", file: "attempts/frame_0001_a1.png", passed: true, checks: [] }], approved: { file: "frames/frame_0001.png", sha256: sha256(first), attempt: 1 } },
        { index: 2, source: "source/frame_0002.png", status: "pending", attempts: [] },
        { index: 3, source: "source/frame_0003.png", status: "pending", attempts: [] },
      ],
    };
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  }, 60_000);
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  const guide = (index: number) => poseFromSkeleton(poses[index - 1]);
  const marks = { head: 200, feet: 1400, center: 512 };

  it("analyses the character once, stabilizes the source and deforms straight ahead from the previous frame", async () => {
    const mapping = await openMapping(dir, { manifest, segmenter, estimator });
    expect(mapping.sheet.profile.segmentation.method).toBe("backdrop");
    expect(mapping.sheet.profile.facing).toBe("camera");
    expect(existsSync(path.join(dir, "mapping/source-track.json"))).toBe(true);
    const frame = await mapFrame(mapping, { index: 2, manifest, guide: guide(2), marks, canvas: CANVAS });
    expect(frame.decision.mode).toBe("straight-ahead");
    expect(frame.decision.base?.id).toBe("frame 1");
    expect(frame.outcomes.filter((outcome) => outcome.kind === "constraint" && !outcome.passed)).toEqual([]);
    // The deformed elbow lands where the target puts it.
    expect(dist(frame.result.plan.generated.leftElbow!.p, frame.target.skeleton.leftElbow!.p)).toBeLessThan(3);
    const out = await sharp(frame.png).metadata();
    expect([out.width, out.height]).toEqual([CANVAS.width, CANVAS.height]);
  });

  it("reuses the cached analyses: no second segmentation or pose estimation", async () => {
    const before = { ...calls };
    const mapping = await openMapping(dir, { manifest, segmenter, estimator });
    await mapFrame(mapping, { index: 2, manifest, guide: guide(2), marks, canvas: CANVAS });
    expect(calls).toEqual(before);
  });

  it("deforms the character sheet, placed on the frame's lines, when no approved drawing is usable", async () => {
    const mapping = await openMapping(dir, { manifest, segmenter, estimator });
    const frame = await mapFrame(mapping, { index: 2, manifest, guide: guide(2), marks, canvas: CANVAS, exclude: new Set(["frame 1"]) });
    expect(frame.decision.base?.id).toBe("character sheet");
    expect(frame.decision.mode).toBe("pose-to-pose");
  });

  it("applies a person's joint correction to the target", async () => {
    await writeOverrides(dir, { frames: { "3": { joints: { leftWrist: [800, 500] } } } });
    const mapping = await openMapping(dir, { manifest, segmenter, estimator });
    const frame = await mapFrame(mapping, { index: 3, manifest, guide: guide(3), marks, canvas: CANVAS });
    expect(frame.target.skeleton.leftWrist!.p).toEqual([800, 500]);
    await writeOverrides(dir, {});
  });

  it("stores and reads back an attempt's diagnostics", async () => {
    const record = { version: 1, frame: 2, attempt: 1, at: "", method: "rig-deform", base: null, source: { joints: {}, raw: {}, swapped: false, occluded: [], bridged: [], offSubject: [] }, rig: null, masks: { character: null, segmentation: "backdrop", subjectTracked: false, exposed: null, labels: null }, target: { joints: {}, rotations: [], unseen: [] }, generated: null, jointError: {}, boneError: {}, meanJointError: null, silhouette: null, missing: [], occluded: [], consistency: null, exposedArea: 0, repair: null, policies: [] } satisfies FrameDiagnostics;
    await writeDiagnostics(dir, record);
    expect(await readDiagnostics(dir, 2, 1)).toEqual(record);
    expect(await readDiagnostics(dir, 2, 9)).toBeNull();
  });

  it("falls back to the local mask when SAM 3.1 can't be reached (no key here, so no call is made)", async () => {
    const previous = [process.env.MODEL_API_KEY, process.env.META_API_KEY];
    delete process.env.MODEL_API_KEY;
    delete process.env.META_API_KEY;
    try {
      const result = await samSegmenter("character").character(await readFile(path.join(dir, "character.png")));
      expect(result.method).toBe("backdrop");
    } finally {
      if (previous[0] !== undefined) process.env.MODEL_API_KEY = previous[0];
      if (previous[1] !== undefined) process.env.META_API_KEY = previous[1];
    }
  });
});
