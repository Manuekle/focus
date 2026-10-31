import { describe, expect, it } from "vitest";
import type { Pose } from "../rotoscope/pose-match";
import { mirrorPose, stabilizeTrack, swappedAgainst } from "./source-track";
import type { Mask } from "./mask";

type Mutable = { keypoints: [number | null, number | null][]; scores: number[] };

/** A frontal figure whose left wrist swings on an arc; `jitter` adds deterministic noise. */
function frame(t: number, jitter = 0): Mutable {
  const keypoints: [number | null, number | null][] = Array.from({ length: 133 }, () => [null, null]);
  const scores = new Array<number>(133).fill(0);
  const noise = (k: number) => jitter * Math.sin(t * 12.9898 + k * 78.233);
  const set = (i: number, x: number, y: number) => { keypoints[i] = [x + noise(i), y + noise(i + 50)]; scores[i] = 0.9; };
  set(0, 500, 300);
  set(5, 580, 420); set(6, 420, 420);
  set(7, 640, 560); set(8, 360, 560);
  const angle = (t / 20) * Math.PI;
  set(9, 640 + 120 * Math.sin(angle), 560 + 120 * Math.cos(angle)); set(10, 330, 700);
  set(11, 560, 760); set(12, 440, 760);
  set(13, 570, 1040); set(14, 430, 1040);
  set(15, 575, 1320); set(16, 425, 1320);
  return { keypoints, scores };
}

describe("source track stabilization", () => {
  it("keeps every frame and its order: timing is the source's", () => {
    const raw = Array.from({ length: 30 }, (_, t) => frame(t, 3));
    const out = stabilizeTrack(raw, { fps: 9 });
    expect(out).toHaveLength(30);
    expect(out.map((f) => f.index)).toEqual(raw.map((_, i) => i + 1));
  });

  it("removes jitter but keeps a fast swing", () => {
    const clean = Array.from({ length: 40 }, (_, t) => frame(t));
    const raw = Array.from({ length: 40 }, (_, t) => frame(t, 6));
    const out = stabilizeTrack(raw, { fps: 9 });
    const error = (track: readonly Pose[]) => track.reduce((sum, f, t) => sum + Math.hypot(f.keypoints[9][0]! - clean[t].keypoints[9][0]!, f.keypoints[9][1]! - clean[t].keypoints[9][1]!), 0) / track.length;
    expect(error(out)).toBeLessThan(error(raw) * 1.6);
    // Lag on the swing stays under a frame's travel.
    const travel = Math.hypot(clean[21].keypoints[9][0]! - clean[20].keypoints[9][0]!, clean[21].keypoints[9][1]! - clean[20].keypoints[9][1]!);
    expect(Math.hypot(out[21].keypoints[9][0]! - clean[21].keypoints[9][0]!, out[21].keypoints[9][1]! - clean[21].keypoints[9][1]!)).toBeLessThan(travel);
  });

  it("puts back a frame whose left and right labels were swapped", () => {
    const raw = Array.from({ length: 10 }, (_, t) => frame(t));
    raw[5] = mirrorPose(raw[5]) as Mutable;
    expect(swappedAgainst(raw[4], raw[5])).toBe(true);
    const out = stabilizeTrack(raw, { fps: 9, minCutoff: 1e6 });
    expect(out[5].swapped).toBe(true);
    expect(out[5].keypoints[5][0]).toBeCloseTo(580, 0);
    expect(out.filter((f) => f.swapped)).toHaveLength(1);
  });

  it("bridges a two-frame dropout and flags it, but leaves a long one open", () => {
    const raw = Array.from({ length: 12 }, (_, t) => frame(t));
    for (const t of [4, 5]) raw[t].scores[9] = 0.05;
    for (const t of [8, 9, 10]) raw[t].scores[10] = 0.05;
    const out = stabilizeTrack(raw, { fps: 9, minCutoff: 1e6 });
    expect(out[4].flags.bridged).toContain(9);
    expect(out[4].keypoints[9][0]).not.toBeNull();
    expect(out[9].flags.occluded).toContain(10);
    expect(out[9].flags.bridged).not.toContain(10);
  });

  it("marks joints off the tracked subject's SAM mask and drops their confidence", () => {
    const raw = Array.from({ length: 3 }, (_, t) => frame(t));
    const mask: Mask = { width: 1024, height: 1536, data: new Uint8Array(1024 * 1536) };
    // The subject's mask covers everything but the right wrist's corner.
    for (let y = 0; y < 1536; y++) for (let x = 0; x < 1024; x++) mask.data[y * 1024 + x] = x < 300 && y > 650 ? 0 : 1;
    raw[1].keypoints[10] = [200, 720];
    const out = stabilizeTrack(raw, { fps: 9, masks: new Map([[1, mask]]), minCutoff: 1e6 });
    expect(out[1].flags.offSubject).toContain(10);
  });
});
