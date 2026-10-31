import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Rgba } from "./alpha";
import type { Pose } from "./pose-match";
import { sourceMotion, temporalReport, type SequenceFrame } from "./temporal";

// Temporal metrics on the wave clip's real source poses (9 frames at 9 fps): a drawing that follows
// the video, one that freezes, one that drifts, one that changes size, and silhouettes that flicker.

const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, "__fixtures__/wave/poses.json"), "utf8")) as { source: Pose[] };
const clip = fixture.source;

/** A pose scaled and moved: the same pose as a drawing on another canvas. */
const placed = (pose: Pose, scale = 1.4, dx = 60, dy = -200): Pose => ({ keypoints: pose.keypoints.map(([x, y]) => (x === null || y === null ? [null, null] : [x * scale + dx, y * scale + dy])), scores: pose.scores });
/** A pose with every limb chain below the shoulders turned by `degrees` about each shoulder. */
function turned(pose: Pose, degrees: number): Pose {
  const t = (degrees * Math.PI) / 180;
  const keypoints = pose.keypoints.map((p) => [...p] as [number | null, number | null]);
  for (const [pivot, chain] of [[5, [7, 9]], [6, [8, 10]]] as const) {
    const [cx, cy] = pose.keypoints[pivot] as [number, number];
    for (const i of chain) {
      const [x, y] = pose.keypoints[i] as [number, number];
      keypoints[i] = [cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t), cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t)];
    }
  }
  return { keypoints, scores: pose.scores };
}
const box = (top: number, height: number, left = 300, width = 200): Rgba => {
  const [w, h] = [1024, 1536];
  const data = Buffer.alloc(w * h * 4);
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) data[(y * w + x) * 4 + 3] = 255;
  return { data, width: w, height: h };
};
const sequence = (drawn: (pose: Pose, i: number) => Pose, image: (i: number) => Rgba = () => box(100, 1300)): SequenceFrame[] =>
  clip.map((source, i) => ({ index: i + 1, source, drawn: drawn(source, i), image: image(i) }));

describe("temporal consistency", () => {
  it("a drawing that follows the video: no motion error, no drift, constant scale, no flicker", () => {
    const report = temporalReport(sequence((pose) => placed(pose)), null);
    expect(report.frames).toBe(9);
    expect(Math.max(...report.motionError.map((value) => value ?? 0))).toBeLessThan(0.5);
    expect(Math.abs(report.driftSlope ?? 0)).toBeLessThan(0.5);
    expect(report.scale.every((value) => Math.abs(value - 1) < 0.001)).toBe(true);
    expect(report.silhouetteChange.every((value) => value === 0)).toBe(true);
  });

  it("a drawing frozen on frame 1 while the video moves: its motion error is the video's motion", () => {
    const report = temporalReport(sequence(() => placed(clip[0])), null);
    const video = clip.slice(1).map((pose, i) => sourceMotion(clip[i], pose) ?? 0);
    // Steps where the video moves by more than 10° show up as error.
    for (const [i, moved] of video.entries()) if (moved > 10) expect(report.motionError[i]!).toBeGreaterThan(5);
  });

  it("arms drifting further from the video each frame: positive drift slope", () => {
    const report = temporalReport(sequence((pose, i) => placed(turned(pose, i * 6))), null);
    expect(report.driftSlope!).toBeGreaterThan(0.5);
  });

  it("a figure that grows over the sequence: scale off 1", () => {
    const report = temporalReport(sequence((pose, i) => placed(pose, 1.2 + i * 0.05)), null);
    expect(Math.max(...report.scale) - Math.min(...report.scale)).toBeGreaterThan(0.2);
  });

  it("a silhouette that jumps around: flicker", () => {
    const report = temporalReport(sequence((pose) => placed(pose), (i) => box(100, 1300, i % 2 ? 300 : 500)), null);
    expect(Math.min(...report.silhouetteChange)).toBeGreaterThan(0.5);
  });
});
